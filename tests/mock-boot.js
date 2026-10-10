// Sonance — mock Subsonic backend for browser testing.
//
// Installs a `fetch` mock for the Subsonic REST API and pre-seeds credentials
// in localStorage, so the app boots authenticated with no real server. Loaded
// BEFORE the app scripts.
//
// Fixture sizes are driven by URL query parameters, so one harness serves both
// the small smoke-test case and the large scale rig the v3.9 performance
// programme measures against:
//
//   /tests/mock-index.html?mockAlbums=1200&mockArtists=2000&mockSongs=14000&mockLibraries=3
//
// Defaults (14 albums / 10 artists / 20 songs / 1 library) reproduce the
// pre-v3.9 fixture counts, so existing links behave as before.
//
// WHY cover art and audio are NOT mocked here: `<img>.src` and `<audio>.src`
// never pass through `window.fetch`, so those requests go over real HTTP to
// tests/dev-server.js. That is what makes HTTP-disk-cache behaviour (v3.9 T2)
// measurable at all — a fetch mock can never exercise Chromium's disk cache.
(function() {
    'use strict';

    // --- Fixture sizing -----------------------------------------------------

    function _numParam(name, dflt) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
        if (!m) return dflt;
        var n = parseInt(decodeURIComponent(m[1]), 10);
        return (isNaN(n) || n < 0) ? dflt : n;
    }

    var N_ALBUMS    = _numParam('mockAlbums', 14);
    var N_ARTISTS   = Math.max(1, _numParam('mockArtists', 10));
    var N_SONGS     = _numParam('mockSongs', 20);
    var N_LIBRARIES = Math.max(1, _numParam('mockLibraries', 1));

    // Opt-in (`?mockUserScope=1`): stamp the requesting `u=` username into the
    // album ids that getAlbumList2 returns. Session 3 T4 needs two users whose
    // responses are distinguishable, to prove the in-memory API cache is not
    // serving user A's library to user B after a logout/login inside the 5-min
    // TTL. Off by default so every other fixture id stays stable.
    var USER_SCOPE = /[?&]mockUserScope=1/.test(window.location.search);

    // v3.10 S1 opt-ins for the visual baseline (tests/tools/visual-baseline.js).
    // `?mockNoSession=1` boots with no stored session, so the app shows Login.
    // `?mockLyrics=1` answers getLyricsBySongId with a synced lyric (12 lines,
    // one every 10 s from 5 s), so the Now Playing lyrics panel has content.
    // Both default off, so every existing fixture behaves as before.
    var NO_SESSION = /[?&]mockNoSession=1/.test(window.location.search);
    var LYRICS = /[?&]mockLyrics=1/.test(window.location.search);

    // v3.10 S6 opt-ins. `?mockClassicQueue=1` leaves `indexBasedQueue` out of
    // the advertised OpenSubsonic extensions, so the app takes the classic
    // savePlayQueue / getPlayQueue path. `?mockPlayQueueDelay=N` holds the
    // getPlayQueue answer N ms (A8's restore racing a screen).
    var CLASSIC_QUEUE = /[?&]mockClassicQueue=1/.test(window.location.search);
    var PLAY_QUEUE_DELAY = _numParam('mockPlayQueueDelay', 0);
    // The saved play queue survives a reload, as the server's does: it is
    // kept in this origin's localStorage under a key the app never reads.
    var PLAY_QUEUE_KEY = '__mock_playqueue__';

    // v3.10 S7 opt-ins. `?mockPingDelay=N` holds the ping answer N ms, so the
    // first screen arrives late (R11's splash must wait for it).
    // `?mockEmptyLists=starred,frequent` makes those getAlbumList2 types
    // answer empty (A4: a Home row shows only when its list is non-empty).
    var PING_DELAY = _numParam('mockPingDelay', 0);
    function _typeSet(name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
        var out = {};
        if (m) decodeURIComponent(m[1]).split(',').forEach(function(t) { if (t) out[t] = true; });
        return out;
    }
    var EMPTY_LISTS = _typeSet('mockEmptyLists');
    // `?mockDelayTypes=starred,random&mockDelayMs=800` holds those
    // getAlbumList2 answers (A4: a row landing late, or after Home was left).
    var DELAY_LISTS = _typeSet('mockDelayTypes');
    var DELAY_MS = _numParam('mockDelayMs', 0);
    // `?mockSimilarDelay=N` holds getSimilarSongs2 N ms (live takes up to
    // ~8 s for a new artist); `?mockSimilarFail=N` fails its first N calls.
    var SIMILAR_DELAY = _numParam('mockSimilarDelay', 0);
    var similarFailsLeft = _numParam('mockSimilarFail', 0);

    // v3.12 R7 opt-in. `?mockArtistInfo=1` answers getArtistInfo2 with a
    // biography and three similar artists (the next three in the fixtures),
    // so Artist -> similar Artist can be driven here; off, the answer stays
    // empty, as every earlier Artist screen capture has it.
    // `?mockArtistInfoDelay=N&mockArtistInfoDelayId=artist-K` holds that one
    // artist's answer N ms (an answer landing after its page was left).
    var ARTIST_INFO = /[?&]mockArtistInfo=1/.test(window.location.search);
    var ARTIST_INFO_DELAY = _numParam('mockArtistInfoDelay', 0);
    var ARTIST_INFO_DELAY_ID = (/[?&]mockArtistInfoDelayId=([^&]*)/.exec(window.location.search) || [])[1] || null;
    // v3.12 R5: `?mockTopSongsFail=1` answers getTopSongs with an error.
    var TOP_SONGS_FAIL = /[?&]mockTopSongsFail=1/.test(window.location.search);

    // WHY zero-padded ordinals: byte-order string sort must equal fixture
    // order. `SubsonicAPI._mergeAlbumLists` sorts merged pages by `name`, so
    // unpadded numbering ("Album 2" > "Album 10") would reorder pages against
    // the order the mock emitted them and mask — or fabricate — the
    // multi-library pagination bug this rig exists to reproduce.
    function _pad(n, width) {
        var s = String(n);
        while (s.length < width) s = '0' + s;
        return s;
    }
    var ALBUM_W  = String(N_ALBUMS).length;
    var ARTIST_W = String(N_ARTISTS).length;
    var SONG_W   = String(N_SONGS).length;

    // --- Libraries ----------------------------------------------------------

    var LIB_IDS = [];
    for (var L = 0; L < N_LIBRARIES; L++) LIB_IDS.push(String(L + 1));

    // WHY contiguous blocks rather than interleaving: it makes the libraries
    // DISJOINT alphabetical ranges, which is exactly the shape that breaks
    // `_mergeAlbumLists` + a single shared pagination offset (prompt-3.9
    // Session 4). Interleaving would hide the defect.
    function _libraryForIndex(i, total) {
        var per = Math.ceil(total / N_LIBRARIES) || 1;
        return LIB_IDS[Math.min(N_LIBRARIES - 1, Math.floor(i / per))];
    }

    // --- Fixtures -----------------------------------------------------------

    var mockGenres = [
        { value: 'Rock', albumCount: 12, songCount: 180 },
        { value: 'Jazz', albumCount: 8, songCount: 95 },
        { value: 'Electronic', albumCount: 14, songCount: 200 },
        { value: 'Classical', albumCount: 6, songCount: 68 },
        { value: 'Hip-Hop', albumCount: 9, songCount: 112 },
        { value: 'Pop', albumCount: 11, songCount: 140 },
        { value: 'Folk', albumCount: 5, songCount: 50 },
        { value: 'Metal', albumCount: 7, songCount: 90 },
        { value: 'Indie', albumCount: 10, songCount: 130 },
        { value: 'R&B', albumCount: 6, songCount: 75 },
        { value: 'Country', albumCount: 4, songCount: 40 },
        { value: 'Reggae', albumCount: 3, songCount: 30 }
    ];

    // Artist names carry a leading letter that advances monotonically across
    // the range, so `getArtists` yields a realistic multi-bucket alphabetical
    // index while names still sort in fixture order.
    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    // v3.12 R3 opt-in: `?mockArtistAlbumCounts=1` gives the artists album
    // counts from 1 to 9 (1 + 7k mod 9) for the Artists tab's "Most albums";
    // off, every artist reports 3, as every earlier capture shows.
    var VARIED_COUNTS = /[?&]mockArtistAlbumCounts=1/.test(window.location.search);
    var mockArtists = [];
    for (var k = 0; k < N_ARTISTS; k++) {
        var letter = LETTERS.charAt(Math.min(25, Math.floor(k * 26 / N_ARTISTS)));
        mockArtists.push({
            id: 'artist-' + k,
            name: letter + ' Artist ' + _pad(k + 1, ARTIST_W),
            albumCount: VARIED_COUNTS ? 1 + (k * 7) % 9 : 3,
            coverArt: 'artist-' + k,
            musicFolderId: _libraryForIndex(k, N_ARTISTS)
        });
    }

    var mockAlbums = [];
    for (var j = 0; j < N_ALBUMS; j++) {
        var owner = mockArtists[j % N_ARTISTS];
        mockAlbums.push({
            id: 'album-' + j,
            name: 'Album ' + _pad(j + 1, ALBUM_W),
            title: 'Album ' + _pad(j + 1, ALBUM_W),
            artist: owner.name,
            artistId: owner.id,
            year: 2020 + (j % 6),
            genre: mockGenres[j % mockGenres.length].value,
            songCount: 10,
            duration: 2400,
            created: new Date(Date.UTC(2020, 0, 1) + j * 86400000).toISOString(),
            // v3.10 S5 (A2): play counts for `frequent`. Every third album has
            // none, as on a real server where `frequent` lists played albums.
            playCount: (j % 3 === 0) ? 0 : ((j * 7) % 50) + 1,
            coverArt: 'album-' + j,
            musicFolderId: _libraryForIndex(j, N_ALBUMS)
        });
    }

    // v3.12 R1: every fifth song (song-4, song-9, ...) is an Ogg Opus file,
    // reported as Navidrome reports one (suffix opus, contentType
    // audio/ogg), so the player asks for it transcoded (format=mp3), which
    // tests/dev-server.js answers as a transcoding server does.
    var mockSongs = [];
    for (var i = 0; i < N_SONGS; i++) {
        var alb = mockAlbums.length ? mockAlbums[i % mockAlbums.length] : null;
        var opus = i % 5 === 4;
        mockSongs.push({
            id: 'song-' + i,
            title: 'Track ' + _pad(i + 1, SONG_W),
            artist: alb ? alb.artist : 'Unknown Artist',
            artistId: alb ? alb.artistId : null,
            album: alb ? alb.name : 'Unknown Album',
            albumId: alb ? alb.id : null,
            duration: 180 + (i % 60),
            coverArt: alb ? alb.coverArt : null,
            starred: false,
            track: (i % 10) + 1,
            year: alb ? alb.year : 2020,
            genre: mockGenres[i % mockGenres.length].value,
            suffix: opus ? 'opus' : 'wav',
            contentType: opus ? 'audio/ogg' : 'audio/wav',
            musicFolderId: alb ? alb.musicFolderId : LIB_IDS[0]
        });
    }

    // v3.10 A3: every playlist but the last carries `coverArt` (Navidrome's
    // collage id is the playlist id), so the grid shows both the cover and
    // the gradient fallback.
    var mockPlaylists = [];
    for (var m = 0; m < 5; m++) {
        var pl = {
            id: 'pl-' + m,
            name: 'Playlist ' + (m + 1),
            songCount: mockSongs.length,
            duration: mockSongs.length * 200
        };
        if (m < 4) pl.coverArt = 'pl-' + m;
        mockPlaylists.push(pl);
    }

    // --- Request helpers ----------------------------------------------------

    function _query(u) {
        var q = {};
        var at = u.indexOf('?');
        if (at === -1) return q;
        u.slice(at + 1).split('&').forEach(function(pair) {
            if (!pair) return;
            var eq = pair.indexOf('=');
            var key = eq > -1 ? pair.slice(0, eq) : pair;
            var val = eq > -1 ? pair.slice(eq + 1) : '';
            try {
                q[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '));
            } catch (e) { /* malformed escape — skip */ }
        });
        return q;
    }

    // Restrict a fixture list to one library. Absent/blank musicFolderId means
    // "all libraries", matching Subsonic semantics.
    function _scoped(list, folderId) {
        if (folderId === undefined || folderId === null || folderId === '') return list;
        var want = String(folderId);
        return list.filter(function(it) { return it.musicFolderId === want; });
    }

    function _intParam(q, name, dflt) {
        var n = parseInt(q[name], 10);
        return isNaN(n) ? dflt : n;
    }

    // `alphabeticalByName` (and unknown types) use fixture order, which is
    // already name order. Recency-ish types read from the other end.
    // v3.10 S5 (A2): the sort types the Albums header offers order the way
    // js/api.js `_albumComparator` does for the same type, so a k-way merge
    // across libraries reproduces the unscoped order exactly ("fixture
    // order"). Names are zero-padded, so a plain string compare is the D24
    // normalised order here. byYear's tie-break (name, reversed with the
    // year) is what Navidrome does (measured on live, S5).
    function _cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
    function _orderAlbums(pool, type, q) {
        if (type === 'alphabeticalByArtist') {
            return pool.slice().sort(function(a, b) {
                return _cmpStr(a.artist, b.artist) || _cmpStr(a.name, b.name);
            });
        }
        if (type === 'byYear') {
            var from = _intParam(q, 'fromYear', 0), to = _intParam(q, 'toYear', 9999);
            var lo = Math.min(from, to), hi = Math.max(from, to), desc = from > to;
            return pool.filter(function(a) { return a.year >= lo && a.year <= hi; }).sort(function(a, b) {
                var c = (a.year - b.year) || _cmpStr(a.name, b.name);
                return desc ? -c : c;
            });
        }
        if (type === 'frequent') {
            return pool.filter(function(a) { return a.playCount > 0; }).sort(function(a, b) {
                return (b.playCount - a.playCount) || _cmpStr(a.name, b.name);
            });
        }
        if (type === 'byGenre') {
            return pool.filter(function(a) { return a.genre === q.genre; });
        }
        if (type === 'starred') {
            // v3.10 A4: every fourth album (album-1, -5, -9, ...) is starred,
            // newest star first, as the server lists them.
            return pool.filter(function(a) {
                return (parseInt(String(a.id).replace('album-', ''), 10) || 0) % 4 === 1;
            }).reverse();
        }
        if (type === 'newest' || type === 'recent') {
            return pool.slice().reverse();
        }
        if (type === 'random') {
            // Deterministic shuffle — reproducible across runs, unlike Math.random.
            var out = pool.slice();
            for (var i = out.length - 1; i > 0; i--) {
                var jj = (i * 1103515245 + 12345) % (i + 1);
                var tmp = out[i]; out[i] = out[jj]; out[jj] = tmp;
            }
            return out;
        }
        return pool;
    }

    function _byId(list, id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    // Ten tracks belonging to one album, derived deterministically from its index.
    function _songsForAlbum(album) {
        if (!album) return mockSongs.slice(0, 10);
        var idx = parseInt(String(album.id).replace('album-', ''), 10) || 0;
        var out = [];
        for (var t = 0; t < 10; t++) {
            var base = mockSongs.length ? mockSongs[(idx * 10 + t) % mockSongs.length] : null;
            out.push({
                id: 'song-' + album.id + '-' + t,
                title: 'Track ' + _pad(t + 1, 2),
                artist: album.artist,
                artistId: album.artistId,
                album: album.name,
                albumId: album.id,
                duration: base ? base.duration : 200,
                coverArt: album.coverArt,
                starred: false,
                track: t + 1,
                year: album.year,
                genre: album.genre,
                suffix: 'wav',
                contentType: 'audio/wav'
            });
        }
        return out;
    }

    // v3.10 S6: any song id the fixtures hand out — `song-N` or an album
    // track `song-album-J-T` — back to its object.
    function _songById(id) {
        var m = /^song-album-(\d+)-(\d+)$/.exec(id || '');
        if (m) {
            var tracks = _songsForAlbum(mockAlbums[parseInt(m[1], 10)]);
            return tracks[parseInt(m[2], 10)] || null;
        }
        m = /^song-(\d+)$/.exec(id || '');
        return m ? (mockSongs[parseInt(m[1], 10)] || null) : null;
    }

    // v3.10 R7: the OpenSubsonic fields Navidrome 0.64.1 sends on a song
    // (measured on live, S6). Even-numbered songs carry full credits;
    // odd-numbered ones have no contributors, composer, plays or BPM, so the
    // "Writing & production" and "Listening" sections must be absent.
    function _songWithCredits(base) {
        var s = {};
        Object.keys(base).forEach(function(f) { s[f] = base[f]; });
        var n = parseInt(String(base.id).replace(/\D+/g, ''), 10) || 0;
        s.artists = [{ id: base.artistId, name: base.artist }];
        s.displayArtist = base.artist;
        s.albumArtists = [{ id: 'artist-va', name: 'Various Artists' }];
        s.displayAlbumArtist = 'Various Artists';
        s.genres = [{ name: base.genre }];
        s.bitRate = 1411;
        s.samplingRate = 44100;
        s.bitDepth = 16;
        s.channelCount = 2;
        s.discNumber = 1;
        if (n % 2 === 0) {
            s.contributors = [
                { role: 'composer', artist: { id: 'c1', name: 'B. Von Trax' } },
                { role: 'composer', artist: { id: 'c2', name: 'K. Paris' } },
                { role: 'producer', artist: { id: 'c3', name: 'Baron Von Trax' } },
                { role: 'mixer', artist: { id: 'c4', name: 'D. Morgan' } },
                { role: 'performer', subRole: 'Vocals', artist: { id: 'c5', name: 'Kyla' } },
                { role: 'performer', subRole: 'Guitar', artist: { id: 'c6', name: 'J. Fret' } },
                { role: 'engineer', artist: { id: 'c7', name: 'S. Wave' } },
                { role: 'remixer', artist: { id: 'c8', name: 'StoneBridge' } }
            ];
            s.displayComposer = 'B. Von Trax • K. Paris';
            s.playCount = 12;
            s.played = '2026-09-30T20:15:00Z';
            s.bpm = 124;
        } else {
            s.contributors = [];
            s.displayComposer = '';
            s.bpm = 0;
        }
        return s;
    }

    // Repeated `id` values (savePlayQueue's list) from a query string or a
    // form-encoded POST body; _query keeps only the last of each key.
    function _allIds(qs) {
        var out = [];
        (qs || '').split('&').forEach(function(pair) {
            var eq = pair.indexOf('=');
            if (eq < 0 || pair.slice(0, eq) !== 'id') return;
            try { out.push(decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))); } catch (e) { /* skip */ }
        });
        return out;
    }

    function resp(body) {
        var payload = { 'subsonic-response': { status: 'ok', version: '1.16.1' } };
        for (var key in body) {
            if (body.hasOwnProperty(key)) payload['subsonic-response'][key] = body[key];
        }
        return Promise.resolve(new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
    }

    // --- Jellyfin mock (v3.13 R12.1, D193) -----------------------------------
    //
    // `?mockBackend=jellyfin` answers the Jellyfin 12.x endpoints
    // js/jellyfin-api.js calls, from the SAME fixtures above re-shaped as
    // Jellyfin JSON (PascalCase, ticks, ImageTags, per-track UserData,
    // MediaSources/MediaStreams; null fields left out), and makes /rest/ a
    // 404, as on a Jellyfin server. Off (the default) none of it runs: the
    // Subsonic mock is exactly as before, and /System/Info/Public stays the
    // static server's 404, which is what drives login detection there.
    //
    // Item ids are the fixture ids (not Jellyfin's 32 hex characters; the
    // adapter treats ids as opaque), so a cover is the very PNG
    // tests/dev-server.js serves getCoverArt for that id: the two mocks
    // match pixel for pixel.
    //
    // Where the Subsonic fixtures carry something Jellyfin has no field for
    // (performer sub-roles, BPM, an original release year), it is left out:
    // those are the capability matrix's documented gaps. Two Subsonic-mock
    // shapes are mirrored per query, as that mock answers them:
    //   - play data: `Filters=IsPlayed` with `ArtistIds` is getTopSongs'
    //     answer (an even artist's first album, in track order); without it,
    //     P7's history: one played track per album, the album's play count on
    //     it, later albums played later (Recently played = newest first,
    //     Most played = the album playCount order, as the Subsonic mock);
    //   - favourites: albums 1, 5, 9 … are favourites (its `starred` list);
    //     no favourite songs or artists (its getStarred2 has none).
    // Knobs (the Subsonic ones apply where they mean something here):
    //   mockJfRevoked=1        the seeded token is refused until a sign-in
    //   mockJfPassword=<pw>    the password sign-in accepts (default mockpass;
    //                          empty = a passwordless account)
    //   mockJfFavFail=1        UserFavoriteItems writes answer 500
    //   mockLyricsUnsynced=1   lyrics without timestamps (mockLyrics=1: synced)
    var JELLYFIN = /[?&]mockBackend=jellyfin(&|$)/.test(window.location.search);
    var JF_VERSION = '12.2.0';
    var JF_USER = 'mockuser';
    var JF_USER_ID = 'f00dfeed0000000000000000000000a1';
    var JF_SEED_TOKEN = 'mock-jf-token-seed';
    var JF_PASSWORD = (function() {
        var m = /[?&]mockJfPassword=([^&]*)/.exec(window.location.search);
        return m ? decodeURIComponent(m[1]) : 'mockpass';
    })();
    var JF_REVOKED = /[?&]mockJfRevoked=1/.test(window.location.search);
    var JF_FAV_FAIL = /[?&]mockJfFavFail=1/.test(window.location.search);
    var LYRICS_UNSYNCED = /[?&]mockLyricsUnsynced=1/.test(window.location.search);
    var TICKS = 10000000;

    // Valid tokens, and the token each DeviceId holds: signing in again from
    // the same device revokes that device's previous token, as on 12.x.
    var jfTokens = {};
    var jfDeviceTokens = {};
    var jfTokenSeq = 0;
    if (!JF_REVOKED) jfTokens[JF_SEED_TOKEN] = true;

    // A deterministic 32-hex image tag per image id (FNV-1a, four rounds).
    function _tagFor(id) {
        var out = '';
        for (var r = 0; r < 4; r++) {
            var h = (2166136261 ^ r) >>> 0;
            var s = String(id);
            for (var i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 16777619) >>> 0;
            }
            out += ('00000000' + h.toString(16)).slice(-8);
        }
        return out;
    }

    function _compact(o) {
        Object.keys(o).forEach(function(k) { if (o[k] === undefined || o[k] === null) delete o[k]; });
        return o;
    }

    function _isFavAlbum(a) {
        return (parseInt(String(a.id).replace('album-', ''), 10) || 0) % 4 === 1;
    }

    function _albumOf(id) { return _byId(mockAlbums, id); }

    function _jfAlbum(a, fields, detail) {
        var o = {
            Name: a.name, Id: a.id, Type: 'MusicAlbum', IsFolder: true, MediaType: 'Unknown',
            AlbumArtist: a.artist, AlbumArtists: [{ Name: a.artist, Id: a.artistId }],
            ArtistItems: [{ Name: a.artist, Id: a.artistId }], Artists: [a.artist],
            ProductionYear: a.year, PremiereDate: a.year + '-01-01T00:00:00.0000000Z',
            Genres: [a.genre], RunTimeTicks: a.duration * TICKS,
            ImageTags: { Primary: _tagFor(a.coverArt) },
            UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: _isFavAlbum(a), Played: false, Key: a.id },
            LocationType: 'FileSystem'
        };
        if (fields.ChildCount || detail) o.ChildCount = a.songCount;
        if (fields.DateCreated || detail) o.DateCreated = a.created;
        if (detail) {
            o.ParentId = a.musicFolderId;
            o.Studios = [{ Name: 'Mock Records', Id: 'studio-mock' }];
        }
        return o;
    }

    function _jfStream(s) {
        var opus = s.suffix === 'opus';
        return _compact({
            Type: 'Audio', Index: 0, Codec: opus ? 'opus' : 'pcm_s16le',
            BitRate: (s.bitRate || 1411) * 1000, SampleRate: s.samplingRate || 44100,
            BitDepth: opus ? null : (s.bitDepth || 16), Channels: s.channelCount || 2
        });
    }

    var JF_ROLES = { composer: 'Composer', lyricist: 'Lyricist', producer: 'Producer', mixer: 'Mixer',
        engineer: 'Engineer', arranger: 'Arranger', remixer: 'Remixer', conductor: 'Conductor' };

    function _jfSong(s, fields, detail) {
        var alb = s.albumId ? _albumOf(s.albumId) : null;
        var opus = s.suffix === 'opus';
        var o = {
            Name: s.title, Id: s.id, Type: 'Audio', MediaType: 'Audio', IsFolder: false,
            Album: s.album, AlbumId: s.albumId,
            AlbumPrimaryImageTag: s.coverArt ? _tagFor(s.coverArt) : null,
            AlbumArtist: alb ? alb.artist : null,
            AlbumArtists: alb ? [{ Name: alb.artist, Id: alb.artistId }] : [],
            ArtistItems: s.artistId ? [{ Name: s.artist, Id: s.artistId }] : [], Artists: [s.artist],
            IndexNumber: s.track, ProductionYear: s.year, RunTimeTicks: s.duration * TICKS,
            Container: opus ? 'ogg' : 'wav', HasLyrics: LYRICS || LYRICS_UNSYNCED,
            ImageTags: {},
            UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false, Key: s.id },
            LocationType: 'FileSystem'
        };
        if (fields.MediaStreams) o.MediaStreams = [_jfStream(s)];
        if (detail) {
            var c = _songWithCredits(s);
            o.ParentIndexNumber = c.discNumber;
            o.Genres = (c.genres || []).map(function(g) { return g.name; });
            o.AlbumArtist = c.displayAlbumArtist;
            o.AlbumArtists = (c.albumArtists || []).map(function(a) { return { Name: a.name, Id: a.id }; });
            o.People = (c.contributors || []).filter(function(p) { return JF_ROLES[p.role]; }).map(function(p) {
                return { Name: p.artist.name, Id: p.artist.id, Role: '', Type: JF_ROLES[p.role] };
            });
            o.UserData = _compact({ PlaybackPositionTicks: 0, PlayCount: c.playCount || 0, IsFavorite: false,
                Played: !!c.played, LastPlayedDate: c.played || null, Key: s.id });
            o.MediaStreams = [_jfStream(c)];
            o.MediaSources = [{ Id: s.id, Protocol: 'File', Type: 'Default', Container: opus ? 'ogg' : 'wav',
                Bitrate: (c.bitRate || 1411) * 1000, MediaStreams: o.MediaStreams }];
            o.DateCreated = '2020-01-01T00:00:00.0000000Z';
        }
        return _compact(o);
    }

    function _jfArtist(a, fields, detail) {
        var o = {
            Name: a.name, Id: a.id, Type: 'MusicArtist', ImageTags: { Primary: _tagFor(a.coverArt) },
            UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false, Key: 'Artist-' + a.name },
            LocationType: 'FileSystem'
        };
        if (fields.ItemCounts) o.AlbumCount = a.albumCount;
        if (detail && ARTIST_INFO) {
            var idx = parseInt(String(a.id).replace('artist-', ''), 10) || 0;
            o.Overview = 'Biography of ' + mockArtists[idx % mockArtists.length].name + '.';
        }
        return o;
    }

    function _jfPlaylist(p, fields, detail) {
        var o = { Name: p.name, Id: p.id, Type: 'Playlist', IsFolder: true, MediaType: 'Audio',
            ImageTags: p.coverArt ? { Primary: _tagFor(p.coverArt) } : {}, LocationType: 'FileSystem' };
        if (fields.ChildCount || detail) o.ChildCount = p.songCount;
        if (fields.CumulativeRunTimeTicks || detail) o.CumulativeRunTimeTicks = p.duration * TICKS;
        return o;
    }

    // Every item the fixtures hand out, by id.
    function _jfItem(id, fields) {
        var a = _albumOf(id);
        if (a) return _jfAlbum(a, fields, true);
        var s = _songById(id);
        if (s) return _jfSong(s, fields, true);
        var ar = _byId(mockArtists, id);
        if (ar) return _jfArtist(ar, fields, true);
        var pl = _byId(mockPlaylists, id);
        if (pl) return _jfPlaylist(pl, fields, true);
        return null;
    }

    // The list form of any item (as /Items?Ids= answers), or null when it is
    // not in `folder` (a library id).
    function _jfListItem(id, fields, folder) {
        var a = _albumOf(id);
        if (a) return (!folder || a.musicFolderId === folder) ? _jfAlbum(a, fields, false) : null;
        var s = _songById(id);
        if (s) {
            var lib = s.musicFolderId || (_albumOf(s.albumId) || {}).musicFolderId;
            return (!folder || lib === folder) ? _jfSong(s, fields, false) : null;
        }
        var ar = _byId(mockArtists, id);
        if (ar) return (!folder || ar.musicFolderId === folder) ? _jfArtist(ar, fields, false) : null;
        var pl = _byId(mockPlaylists, id);
        if (pl) return folder ? null : _jfPlaylist(pl, fields, false);
        return null;
    }

    function _fieldSet(q) {
        var out = {};
        String(q.Fields || '').split(',').forEach(function(f) { if (f) out[f] = true; });
        return out;
    }

    // P7's play history, as the Subsonic mock's `recent` and `frequent`.
    function _playedTracks(folder) {
        if (EMPTY_LISTS.recent || EMPTY_LISTS.frequent) return [];
        return _scoped(mockAlbums, folder).slice().reverse().map(function(a, n, arr) {
            var t = _songsForAlbum(a)[0];
            t.musicFolderId = a.musicFolderId;
            t._played = { PlayCount: a.playCount, LastPlayedDate:
                new Date(Date.UTC(2026, 0, 1) + (arr.length - n) * 60000).toISOString(), Played: true };
            return t;
        });
    }

    // getTopSongs' answer, as the Subsonic mock's, with descending plays so
    // PlayCount order is track order.
    function _topTracks(artistId) {
        var idx = parseInt(String(artistId).replace('artist-', ''), 10);
        if (TOP_SONGS_FAIL || isNaN(idx) || idx % 2 !== 0) return [];
        var owned = mockAlbums.filter(function(al) { return al.artistId === artistId; });
        if (!owned.length) return [];
        return _songsForAlbum(owned[0]).map(function(t, n) {
            t._played = { PlayCount: 100 - n, LastPlayedDate: '2026-02-01T00:00:00.0000000Z', Played: true };
            return t;
        });
    }

    function _withPlayed(o, t) {
        if (t._played) Object.keys(t._played).forEach(function(k) { o.UserData[k] = t._played[k]; });
        return o;
    }

    function _matchTerm(list, term) {
        if (!term) return list;
        var needle = term.toLowerCase();
        return list.filter(function(it) {
            return String(it.name || it.title || '').toLowerCase().indexOf(needle) > -1;
        });
    }

    function _page(list, q) {
        var start = _intParam(q, 'StartIndex', 0);
        var limit = q.Limit === undefined ? list.length : _intParam(q, 'Limit', list.length);
        return list.slice(start, start + limit);
    }

    function jfResp(body, status) {
        return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), {
            status: status || 200, headers: { 'Content-Type': 'application/json' }
        }));
    }

    function jfItems(all, q, shape) {
        var items = _page(all, q).map(shape);
        return jfResp({ Items: items, TotalRecordCount: all.length, StartIndex: _intParam(q, 'StartIndex', 0) });
    }

    function _delayed(ms, fn) {
        if (!ms) return fn();
        return new Promise(function(resolve) { setTimeout(resolve, ms); }).then(fn);
    }

    function _albumOrderJf(pool, q) {
        var sortBy = q.SortBy || '';
        var desc = /^Descending/.test(q.SortOrder || '');
        if (/^Random/.test(sortBy)) return _orderAlbums(pool, 'random', q);
        if (/^DateCreated/.test(sortBy)) return desc ? pool.slice().reverse() : pool.slice();
        if (/^AlbumArtist/.test(sortBy)) return _orderAlbums(pool, 'alphabeticalByArtist', q);
        if (/^ProductionYear/.test(sortBy)) {
            return pool.slice().sort(function(a, b) {
                var c = (a.year - b.year) || _cmpStr(a.name, b.name);
                return desc ? -c : c;
            });
        }
        return pool.slice();   // SortName: fixture order is name order
    }

    function _jfAlbums(q, fields) {
        var folder = q.ParentId || null;
        var pool = _scoped(mockAlbums, folder);
        if (q.Ids) {
            var want = q.Ids.split(',');
            pool = want.map(_albumOf).filter(function(a) { return a && (!folder || a.musicFolderId === folder); });
        }
        if (/IsFavorite/.test(q.Filters || '')) pool = EMPTY_LISTS.starred ? [] : pool.filter(_isFavAlbum);
        if (q.Genres) pool = pool.filter(function(a) { return a.genre === q.Genres; });
        if (q.Years) {
            var years = q.Years.split(',').map(Number);
            pool = pool.filter(function(a) { return years.indexOf(a.year) > -1; });
        }
        if (q.AlbumArtistIds) pool = pool.filter(function(a) { return a.artistId === q.AlbumArtistIds; });
        if (q.ArtistIds) pool = pool.filter(function(a) { return a.artistId === q.ArtistIds; });
        pool = _matchTerm(pool, q.searchTerm);
        if (!q.Ids) {
            var type = /^Random/.test(q.SortBy || '') ? 'random'
                : /^DateCreated/.test(q.SortBy || '') ? 'newest'
                : /IsFavorite/.test(q.Filters || '') ? 'starred' : null;
            if (type && EMPTY_LISTS[type]) pool = [];
            pool = _albumOrderJf(pool, q);
        }
        var delay = (DELAY_MS && type && DELAY_LISTS[type]) ? DELAY_MS : 0;
        return _delayed(delay, function() {
            return jfItems(pool, q, function(a) { return _jfAlbum(a, fields, false); });
        });
    }

    function _jfSongs(q, fields) {
        var folder = q.ParentId || null;
        var shape = function(t) { return _withPlayed(_jfSong(t, fields, false), t); };
        if (folder && _albumOf(folder)) return jfItems(_songsForAlbum(_albumOf(folder)), q, shape);
        if (q.Ids) {
            var ids = q.Ids.split(',');
            var found = ids.map(_songById).filter(function(s) {
                if (!s) return false;
                if (!folder) return true;
                var lib = s.musicFolderId || (_albumOf(s.albumId) || {}).musicFolderId;
                return lib === folder;
            });
            return jfItems(found, q, shape);
        }
        if (/IsPlayed/.test(q.Filters || '')) {
            if (q.ArtistIds) {
                if (TOP_SONGS_FAIL) return jfResp(null, 500);
                return jfItems(_topTracks(q.ArtistIds), q, shape);
            }
            return jfItems(_playedTracks(folder), q, shape);
        }
        if (/IsFavorite/.test(q.Filters || '')) return jfItems([], q, shape);
        var pool = _scoped(mockSongs, folder);
        if (q.Genres) pool = pool.filter(function(s) { return s.genre === q.Genres; });
        pool = _matchTerm(pool, q.searchTerm);
        return jfItems(pool, q, shape);
    }

    function _jfArtists(q, fields) {
        var pool = _scoped(mockArtists, q.ParentId || null);
        if (/IsFavorite/.test(q.Filters || '')) pool = [];
        pool = _matchTerm(pool, q.searchTerm);
        return jfItems(pool, q, function(a) { return _jfArtist(a, fields, false); });
    }

    // Each library holds every genre with its share of the counts, so the
    // adapter's per-library sum is the Subsonic mock's getGenres.
    function _jfGenres(q) {
        var n = LIB_IDS.indexOf(String(q.ParentId));
        if (n < 0) n = 0;
        function share(total) {
            var base = Math.floor(total / N_LIBRARIES);
            return base + (n < total % N_LIBRARIES ? 1 : 0);
        }
        var items = mockGenres.map(function(g) {
            return { Name: g.value, Id: 'genre-' + g.value, Type: 'MusicGenre',
                SongCount: share(g.songCount), AlbumCount: share(g.albumCount) };
        });
        return jfResp({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
    }

    function _jfAuthToken(opts) {
        var h = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
        var m = /Token="([^"]*)"/.exec(h);
        return { header: h, token: m ? decodeURIComponent(m[1]) : null,
            device: decodeURIComponent((/DeviceId="([^"]*)"/.exec(h) || [])[1] || '') };
    }

    // The Jellyfin answer for `u`, or null to pass the request through
    // (static files, and media, which tests/dev-server.js serves).
    function _jellyfinFetch(u, opts) {
        var at = u.indexOf('://');
        var path = at > -1 ? u.slice(u.indexOf('/', at + 3)) : u;
        var qAt = path.indexOf('?');
        var pathname = qAt > -1 ? path.slice(0, qAt) : path;
        var q = _query(path);
        var method = (opts && opts.method) || 'GET';

        if (/^\/rest\//.test(pathname)) {
            window.__MOCK__.calls.push({ backend: 'jellyfin', method: method, path: pathname, status: 404, t: performance.now() });
            return Promise.resolve(new Response('', { status: 404 }));
        }
        if (/^\/(Items\/[^/]+\/Images\/|Audio\/[^/]+\/stream)/.test(pathname)) return null;
        if (!/^\/(System|Users|Sessions|UserViews|Items|Artists|Genres|Playlists|Audio|UserFavoriteItems|UserPlayedItems)(\/|$)/.test(pathname)) return null;

        var auth = _jfAuthToken(opts);
        var body = null;
        try { body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch (e) { body = null; }
        var call = { backend: 'jellyfin', method: method, path: pathname, query: q, auth: auth.header, body: body, t: performance.now() };
        window.__MOCK__.calls.push(call);
        window.__MOCK__.hits[pathname] = (window.__MOCK__.hits[pathname] || 0) + 1;
        // As a real fetch: an abort rejects at once with an AbortError.
        var signal = opts && opts.signal;
        function answer(p) {
            p = p.then(function(r) { call.status = r.status; return r; });
            if (!signal) return p;
            return new Promise(function(resolve, reject) {
                function aborted() { call.aborted = true; reject(new DOMException('The user aborted a request.', 'AbortError')); }
                if (signal.aborted) { aborted(); return; }
                signal.addEventListener('abort', aborted);
                p.then(resolve, reject);
            });
        }

        if (pathname === '/System/Info/Public') {
            return answer(jfResp({ LocalAddress: window.location.origin, ServerName: 'Mock Jellyfin', Version: JF_VERSION,
                ProductName: 'Jellyfin Server', OperatingSystem: '', Id: 'mockjellyfinserver00000000000001',
                StartupWizardCompleted: true }));
        }
        if (pathname === '/Users/AuthenticateByName' && method === 'POST') {
            var okUser = body && String(body.Username || '').toLowerCase() === JF_USER;
            var okPw = body && (body.Pw || '') === JF_PASSWORD;
            if (!okUser || !okPw) return answer(jfResp(null, 401));
            if (auth.device && jfDeviceTokens[auth.device]) delete jfTokens[jfDeviceTokens[auth.device]];
            var token = 'mock-jf-token-' + (++jfTokenSeq);
            jfTokens[token] = true;
            if (auth.device) jfDeviceTokens[auth.device] = token;
            return answer(jfResp({ User: { Name: JF_USER, Id: JF_USER_ID, HasPassword: true },
                SessionInfo: { DeviceId: auth.device, UserId: JF_USER_ID }, AccessToken: token,
                ServerId: 'mockjellyfinserver00000000000001' }));
        }
        if (!auth.token || !jfTokens[auth.token]) return answer(jfResp(null, 401));

        if (pathname === '/System/Info') {
            return answer(_delayed(PING_DELAY, function() {
                return jfResp({ Version: JF_VERSION, ProductName: 'Jellyfin Server', ServerName: 'Mock Jellyfin',
                    Id: 'mockjellyfinserver00000000000001' });
            }));
        }
        if (pathname === '/Sessions/Logout' && method === 'POST') {
            delete jfTokens[auth.token];
            return answer(Promise.resolve(new Response(null, { status: 204 })));
        }
        if (pathname === '/UserViews') {
            // The music libraries are hidden from the user's home screen, as the
            // test profile's is: only includeHidden=true lists them.
            var views = [{ Name: 'Films', Id: 'view-movies', CollectionType: 'movies', Type: 'CollectionFolder' }];
            if (q.includeHidden === 'true') {
                LIB_IDS.forEach(function(id, n) {
                    views.push({ Name: 'Library ' + (n + 1), Id: id, CollectionType: 'music', Type: 'CollectionFolder' });
                });
            }
            return answer(jfResp({ Items: views, TotalRecordCount: views.length, StartIndex: 0 }));
        }

        var fields = _fieldSet(q);
        var m;
        if (pathname === '/Items') {
            var types = q.IncludeItemTypes || '';
            if (types === 'MusicAlbum') return answer(_jfAlbums(q, fields));
            if (types === 'Audio') return answer(_jfSongs(q, fields));
            if (types === 'Playlist') return answer(jfItems(mockPlaylists, q, function(p) { return _jfPlaylist(p, fields, false); }));
            if (q.Ids) {
                // List-form items of any type, in the order asked, each once;
                // ParentId keeps those in that library (P10's lookups).
                var seenIds = {};
                var listed = q.Ids.split(',').filter(function(id) {
                    if (seenIds[id]) return false;
                    seenIds[id] = true;
                    return true;
                }).map(function(id) { return _jfListItem(id, fields, q.ParentId || null); }).filter(Boolean);
                return answer(jfItems(listed, q, function(x) { return x; }));
            }
            return answer(jfResp({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
        }
        if ((m = /^\/Items\/([^/]+)\/InstantMix$/.exec(pathname))) {
            var mixId = decodeURIComponent(m[1]);
            if (similarFailsLeft > 0) {
                similarFailsLeft--;
                return answer(jfResp(null, 500));
            }
            var simIdx = parseInt(String(mixId).replace('artist-', ''), 10) || 0;
            var mix = mockSongs.filter(function(sg) { return sg.artistId !== mixId; })
                .slice(0, Math.min(_intParam(q, 'Limit', 50), simIdx % 2 === 0 ? 12 : 3));
            return answer(_delayed(SIMILAR_DELAY, function() {
                return jfItems(mix, {}, function(t) { return _jfSong(t, fields, false); });
            }));
        }
        if ((m = /^\/Items\/([^/]+)$/.exec(pathname))) {
            var item = _jfItem(decodeURIComponent(m[1]), fields);
            return answer(item ? jfResp(item) : jfResp(null, 404));
        }
        if (pathname === '/Artists/AlbumArtists' || pathname === '/Artists') return answer(_jfArtists(q, fields));
        if ((m = /^\/Artists\/([^/]+)\/Similar$/.exec(pathname))) {
            var simArtist = decodeURIComponent(m[1]);
            var infoIdx = Math.max(0, parseInt(String(simArtist).replace('artist-', ''), 10) || 0) % mockArtists.length;
            var similar = ARTIST_INFO ? [1, 2, 3].map(function(d) { return mockArtists[(infoIdx + d) % mockArtists.length]; }) : [];
            var held = (ARTIST_INFO_DELAY && (!ARTIST_INFO_DELAY_ID || simArtist === ARTIST_INFO_DELAY_ID)) ? ARTIST_INFO_DELAY : 0;
            return answer(_delayed(held, function() {
                return jfItems(similar, {}, function(a) { return _jfArtist(a, {}, false); });
            }));
        }
        if (pathname === '/Genres') return answer(_jfGenres(q));
        if ((m = /^\/Playlists\/([^/]+)\/Items$/.exec(pathname))) {
            return answer(jfItems(mockSongs, q, function(t, n) {
                var o = _jfSong(t, fields, false);
                o.PlaylistItemId = 'pli-' + t.id;
                return o;
            }));
        }
        if ((m = /^\/Audio\/([^/]+)\/Lyrics$/.exec(pathname))) {
            if (!LYRICS && !LYRICS_UNSYNCED) return answer(jfResp(null, 404));
            var songId = decodeURIComponent(m[1]);
            var lyr = [];
            for (var ln = 0; ln < 12; ln++) {
                var line = { Text: 'Lyric line ' + (ln + 1) + ' for ' + songId, Cues: [] };
                if (!LYRICS_UNSYNCED) line.Start = (5000 + ln * 10000) * 10000;
                lyr.push(line);
            }
            return answer(jfResp({ Metadata: {}, Lyrics: lyr }));
        }
        if ((m = /^\/UserFavoriteItems\/([^/]+)$/.exec(pathname))) {
            window.__MOCK__.starCalls.push({ op: method === 'DELETE' ? 'unstar' : 'star', id: decodeURIComponent(m[1]) });
            if (JF_FAV_FAIL) return answer(jfResp(null, 500));
            return answer(jfResp({ IsFavorite: method !== 'DELETE', Key: decodeURIComponent(m[1]) }));
        }
        if ((m = /^\/UserPlayedItems\/([^/]+)$/.exec(pathname)) && method === 'POST') {
            window.__MOCK__.jf.scrobbles.push({ id: decodeURIComponent(m[1]), datePlayed: q.datePlayed || null });
            return answer(jfResp({ Played: true, PlayCount: 1, Key: decodeURIComponent(m[1]) }));
        }
        return answer(jfResp(null, 404));
    }

    // --- fetch mock ---------------------------------------------------------

    var origFetch = window.fetch.bind(window);
    window.fetch = function(url, opts) {
        var u = typeof url === 'string' ? url : url.url;
        if (JELLYFIN) {
            var jf = _jellyfinFetch(u, opts);
            if (jf) return jf;
        }
        if (!/\/rest\//.test(u)) return origFetch(url, opts);

        // Media endpoints stay on the wire so the dev server serves real bytes
        // with real cache headers.
        if (/getCoverArt|stream\.view/.test(u)) return origFetch(url, opts);

        // Test-only: tests/dev-server.js answers /rest/__slow.view with a
        // dripped body, which is how Session 3 T8 exercises the body timeout.
        // It must reach the wire, not the mock.
        if (/__slow\.view/.test(u)) return origFetch(url, opts);

        // v3.10 A8: a form POST (OpenSubsonic formPost) carries its params in
        // the body; read them as if they were the query string.
        var post = !!(opts && opts.method === 'POST' && typeof opts.body === 'string');
        var rawQuery = post ? opts.body : (u.indexOf('?') > -1 ? u.slice(u.indexOf('?') + 1) : '');
        var q = post ? _query('?' + opts.body) : _query(u);

        // v3.10 S7: every request this mock answers, by endpoint, so a spec
        // can count server calls (A3: no getPlaylist per playlist card).
        var hitName = (/\/rest\/([A-Za-z0-9]+)/.exec(u) || [])[1];
        if (hitName) {
            window.__MOCK__.hits[hitName] = (window.__MOCK__.hits[hitName] || 0) + 1;
            // v3.12 R2: with the paging and scope of the request.
            window.__MOCK__.calls.push({ endpoint: hitName, type: q.type || null, t: performance.now(),
                size: q.size || null, offset: q.offset || null, folder: q.musicFolderId || null });
        }

        if (/ping\.view/.test(u)) {
            if (!PING_DELAY) return resp({});
            return new Promise(function(resolve) { setTimeout(resolve, PING_DELAY); }).then(function() { return resp({}); });
        }

        if (/getOpenSubsonicExtensions/.test(u)) {
            // What Navidrome 0.64.1 advertises (live, S6).
            var ext = ['transcodeOffset', 'formPost', 'songLyrics', 'indexBasedQueue', 'transcoding', 'playbackReport', 'topSongsByArtistId']
                .filter(function(name) { return !(CLASSIC_QUEUE && name === 'indexBasedQueue'); })
                .map(function(name) { return { name: name, versions: [1] }; });
            return resp({ openSubsonic: true, openSubsonicExtensions: ext });
        }

        if (/savePlayQueue/.test(u)) {
            var ids = _allIds(rawQuery);
            var byIndex = /savePlayQueueByIndex/.test(u);
            var cur = byIndex ? _intParam(q, 'currentIndex', 0) : Math.max(0, ids.indexOf(q.current));
            var saved = { ids: ids, index: cur, position: _intParam(q, 'position', 0), byIndex: byIndex, post: post, urlLength: u.length + (post ? opts.body.length + 1 : 0) };
            try { localStorage.setItem(PLAY_QUEUE_KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ }
            window.__MOCK__.queueSaves.push({ n: ids.length, index: cur, position: saved.position, byIndex: byIndex, post: post, urlLength: saved.urlLength });
            return resp({});
        }

        if (/getPlayQueue/.test(u)) {
            var stored = null;
            try { stored = JSON.parse(localStorage.getItem(PLAY_QUEUE_KEY) || 'null'); } catch (e) { stored = null; }
            var entries = stored ? stored.ids.map(_songById).filter(Boolean) : [];
            var pqBody = /getPlayQueueByIndex/.test(u)
                ? { playQueueByIndex: entries.length
                    ? { currentIndex: stored.index, position: stored.position, entry: entries, username: 'mockuser', changedBy: 'Sonance' }
                    : { username: 'mockuser', changedBy: 'Sonance' } }
                : { playQueue: entries.length
                    ? { current: stored.ids[stored.index], position: stored.position, entry: entries, username: 'mockuser', changedBy: 'Sonance' }
                    : { username: 'mockuser', changedBy: 'Sonance' } };
            if (!PLAY_QUEUE_DELAY) return resp(pqBody);
            return new Promise(function(resolve) { setTimeout(resolve, PLAY_QUEUE_DELAY); }).then(function() { return resp(pqBody); });
        }

        if (/getSong\.view/.test(u)) {
            var song = _songById(q.id);
            return song ? resp({ song: _songWithCredits(song) })
                : resp({ status: 'failed', error: { code: 70, message: 'Song not found' } });
        }

        if (/getAlbumList2|getAlbumList\.view/.test(u)) {
            var pool = EMPTY_LISTS[q.type] ? [] : _orderAlbums(_scoped(mockAlbums, q.musicFolderId), q.type, q);
            var off = _intParam(q, 'offset', 0);
            var size = _intParam(q, 'size', 10);
            var page = pool.slice(off, off + size);
            if (USER_SCOPE) {
                page = page.map(function(a) {
                    var copy = {};
                    Object.keys(a).forEach(function(f) { copy[f] = a[f]; });
                    copy.id = (q.u || 'anon') + '-' + a.id;
                    return copy;
                });
            }
            var listBody = /getAlbumList2/.test(u) ? { albumList2: { album: page } } : { albumList: { album: page } };
            if (DELAY_LISTS[q.type] && DELAY_MS) {
                return new Promise(function(resolve) { setTimeout(resolve, DELAY_MS); }).then(function() { return resp(listBody); });
            }
            return resp(listBody);
        }

        if (/getStarred2/.test(u)) return resp({ starred2: {} });
        if (/getPlaylists/.test(u)) return resp({ playlists: { playlist: mockPlaylists } });

        if (/getPlaylist\.view/.test(u)) {
            var pl = _byId(mockPlaylists, q.id) || mockPlaylists[0];
            return resp({
                playlist: {
                    id: pl.id, name: pl.name,
                    songCount: mockSongs.length, duration: pl.duration,
                    entry: mockSongs
                }
            });
        }

        if (/getArtists/.test(u)) {
            var artistPool = _scoped(mockArtists, q.musicFolderId);
            var buckets = {};
            var order = [];
            artistPool.forEach(function(a) {
                var letter = (a.name.charAt(0) || '#').toUpperCase();
                if (!buckets[letter]) { buckets[letter] = []; order.push(letter); }
                buckets[letter].push(a);
            });
            order.sort();
            var index = order.map(function(letter) {
                return { name: letter, artist: buckets[letter] };
            });
            return resp({ artists: { ignoredArticles: 'The El La', index: index } });
        }

        if (/getArtist\.view/.test(u)) {
            var artist = _byId(mockArtists, q.id) || mockArtists[0];
            var owned = mockAlbums.filter(function(a) { return a.artistId === artist.id; });
            return resp({
                artist: {
                    id: artist.id, name: artist.name,
                    coverArt: artist.coverArt,
                    albumCount: owned.length,
                    album: owned.slice(0, 50)
                }
            });
        }

        if (/getAlbum\.view/.test(u)) {
            var album = _byId(mockAlbums, q.id) || mockAlbums[0];
            if (!album) return resp({ album: null });
            return resp({
                album: {
                    id: album.id, name: album.name, artist: album.artist,
                    artistId: album.artistId, year: album.year, genre: album.genre,
                    coverArt: album.coverArt, duration: album.duration,
                    songCount: 10, song: _songsForAlbum(album),
                    // v3.10 R7 (OpenSubsonic, as Navidrome 0.64.1 sends them):
                    // a label, and an original date before the release on
                    // every other album.
                    recordLabels: [{ name: 'Mock Records' }],
                    releaseDate: { year: album.year },
                    originalReleaseDate: { year: (parseInt(String(album.id).replace('album-', ''), 10) % 2) ? album.year - 20 : album.year }
                }
            });
        }

        if (/getSongsByGenre/.test(u)) {
            var wantGenre = q.genre;
            var byGenre = _scoped(mockSongs, q.musicFolderId).filter(function(s) { return !wantGenre || s.genre === wantGenre; });
            var gCount = _intParam(q, 'count', 10);
            var gOffset = _intParam(q, 'offset', 0);
            return resp({ songsByGenre: { song: byGenre.slice(gOffset, gOffset + gCount) } });
        }

        if (/getGenres/.test(u)) return resp({ genres: { genre: mockGenres } });

        if (/getRandomSongs/.test(u)) {
            var rSize = _intParam(q, 'size', 10);
            var rPool = _scoped(mockSongs, q.musicFolderId);
            return resp({ randomSongs: { song: rPool.slice(0, rSize) } });
        }

        // v3.10 S5: scoped by musicFolderId and paged by the *Offset params,
        // as on the server. An empty query lists everything in fixture order
        // (A1 pages the full Songs list through it; the live server's order
        // is creation order, which the fixtures' order stands in for).
        if (/search3/.test(u)) {
            var needle = (q.query || '').toLowerCase();
            function match(list, cap, off) {
                var scoped = _scoped(list, q.musicFolderId);
                if (needle) {
                    scoped = scoped.filter(function(it) {
                        return String(it.name || it.title || '').toLowerCase().indexOf(needle) > -1;
                    });
                }
                return scoped.slice(off, off + cap);
            }
            return resp({
                searchResult3: {
                    song: match(mockSongs, _intParam(q, 'songCount', 25), _intParam(q, 'songOffset', 0)),
                    album: match(mockAlbums, _intParam(q, 'albumCount', 25), _intParam(q, 'albumOffset', 0)),
                    artist: match(mockArtists, _intParam(q, 'artistCount', 25), _intParam(q, 'artistOffset', 0))
                }
            });
        }

        if (/getLyricsBySongId/.test(u)) {
            if (!LYRICS) return resp({ lyricsList: { structuredLyrics: [] } });
            var lines = [];
            for (var ln = 0; ln < 12; ln++) {
                lines.push({ start: 5000 + ln * 10000, value: 'Lyric line ' + (ln + 1) + ' for ' + (q.id || 'song') });
            }
            return resp({ lyricsList: { structuredLyrics: [{ lang: 'eng', synced: true, line: lines }] } });
        }
        // v3.10 A5: the options sheet's Favourite is a server write the live
        // account must not get (§5.4); here it is logged.
        if (/star\.view/.test(u)) {
            window.__MOCK__.starCalls.push({ op: /unstar\.view/.test(u) ? 'unstar' : 'star', id: q.id || q.albumId || q.artistId });
            return resp({});
        }
        if (/scrobble\.view/.test(u)) return resp({});

        // v3.10 A5: "Start radio" shows only with at least 5 similar songs.
        // Artists with an even index get 12 (other artists' songs), odd ones
        // 3, so both cases are on the default fixtures (song-0's artist is
        // artist-0, song-1's artist-1).
        if (/getSimilarSongs2/.test(u)) {
            if (similarFailsLeft > 0) {
                similarFailsLeft--;
                return resp({ status: 'failed', error: { code: 0, message: 'Agent unavailable' } });
            }
            var simIdx = parseInt(String(q.id || '').replace('artist-', ''), 10) || 0;
            var simCount = Math.min(_intParam(q, 'count', 50), simIdx % 2 === 0 ? 12 : 3);
            var simSongs = mockSongs.filter(function(sg) { return sg.artistId !== q.id; }).slice(0, simCount);
            if (!SIMILAR_DELAY) return resp({ similarSongs2: { song: simSongs } });
            return new Promise(function(resolve) { setTimeout(resolve, SIMILAR_DELAY); }).then(function() {
                return resp({ similarSongs2: { song: simSongs } });
            });
        }
        // v3.12 R5: getTopSongs, by artist name. An even-indexed artist that
        // owns an album gets that album's tracks (up to `count`); the others
        // none, as on a server whose Last.fm agent knows nothing of them.
        if (/getTopSongs/.test(u)) {
            if (TOP_SONGS_FAIL) return resp({ status: 'failed', error: { code: 0, message: 'Agent unavailable' } });
            var topArtist = null;
            for (var ta = 0; ta < mockArtists.length; ta++) {
                if (mockArtists[ta].name === q.artist) { topArtist = mockArtists[ta]; break; }
            }
            var topIdx = topArtist ? parseInt(topArtist.id.replace('artist-', ''), 10) : -1;
            var topOwned = (topArtist && topIdx % 2 === 0)
                ? mockAlbums.filter(function(al) { return al.artistId === topArtist.id; }) : [];
            var top = topOwned.length ? _songsForAlbum(topOwned[0]).slice(0, _intParam(q, 'count', 50)) : [];
            return resp({ topSongs: top.length ? { song: top } : {} });
        }

        if (/getArtistInfo2/.test(u)) {
            if (!ARTIST_INFO) return resp({ artistInfo2: {} });
            var infoIdx = Math.max(0, parseInt(String(q.id || '').replace('artist-', ''), 10) || 0) % mockArtists.length;
            var infoBody = { artistInfo2: {
                biography: 'Biography of ' + mockArtists[infoIdx].name + '.',
                similarArtist: [1, 2, 3].map(function(d) {
                    var sim = mockArtists[(infoIdx + d) % mockArtists.length];
                    return { id: sim.id, name: sim.name, coverArt: sim.coverArt, albumCount: sim.albumCount };
                })
            } };
            if (!ARTIST_INFO_DELAY || (ARTIST_INFO_DELAY_ID && q.id !== ARTIST_INFO_DELAY_ID)) return resp(infoBody);
            return new Promise(function(resolve) { setTimeout(resolve, ARTIST_INFO_DELAY); }).then(function() { return resp(infoBody); });
        }

        if (/getMusicFolders/.test(u)) {
            // A single library is reported as one folder; Settings hides the
            // library picker below 2, so the default matches pre-v3.9 behaviour.
            var folders = LIB_IDS.map(function(id, n) {
                return { id: Number(id), name: 'Library ' + (n + 1) };
            });
            return resp({ musicFolders: { musicFolder: folders } });
        }

        if (/getIndexes/.test(u)) {
            return resp({ indexes: { index: [], lastModified: 0, ignoredArticles: 'The' } });
        }

        return resp({});
    };

    // --- Session seed -------------------------------------------------------

    // WHY the page's own origin rather than a fake host: `<img>` and `<audio>`
    // bypass the fetch mock, so the server URL has to actually resolve for
    // cover art and playback to work at all. tests/dev-server.js answers
    // /rest/getCoverArt and /rest/stream with real bytes and real cache
    // headers, and taking the origin from location keeps the port free.
    // Fixture credentials only — the mock accepts anything, and nothing here
    // ever reaches the real server. Deliberately NOT the real test account's
    // username/password: those live in TEST-ACCOUNT.local.md (gitignored) and
    // must not appear in tracked files.
    if (NO_SESSION) {
        ['sonance_server_url', 'sonance_username', 'sonance_password', 'sonance_logged_in']
            .forEach(function(k) { localStorage.removeItem(k); });
    } else {
        localStorage.setItem('sonance_server_url', window.location.origin);
        localStorage.setItem('sonance_username', 'mockuser');
        localStorage.setItem('sonance_password', 'mockpass');
        localStorage.setItem('sonance_logged_in', 'true');
    }
    // v3.13: a Jellyfin session on top (P5's keys); the device id is the
    // app's own to make.
    var JF_SESSION_KEYS = ['sonance_backend', 'sonance_jf_token', 'sonance_jf_user_id', 'sonance_jf_server_version'];
    if (JELLYFIN && NO_SESSION) {
        JF_SESSION_KEYS.forEach(function(k) { localStorage.removeItem(k); });
    } else if (JELLYFIN) {
        localStorage.setItem('sonance_backend', 'jellyfin');
        localStorage.setItem('sonance_jf_token', JF_SEED_TOKEN);
        localStorage.setItem('sonance_jf_user_id', JF_USER_ID);
        localStorage.setItem('sonance_jf_server_version', JF_VERSION);
    }

    // Exposed so Playwright runs can assert against the fixture set they asked for.
    window.__MOCK__ = {
        albums: mockAlbums,
        artists: mockArtists,
        songs: mockSongs,
        libraries: LIB_IDS,
        // v3.10 A8: every savePlayQueue the app made, in order.
        queueSaves: [],
        // v3.10 S7: requests answered, by endpoint; star/unstar calls.
        hits: {},
        calls: [],
        starCalls: [],
        counts: {
            albums: N_ALBUMS, artists: N_ARTISTS,
            songs: N_SONGS, libraries: N_LIBRARIES
        },
        // v3.13: the Jellyfin mock's state (null on the Subsonic mock).
        jf: JELLYFIN ? {
            version: JF_VERSION,
            userId: JF_USER_ID,
            seedToken: JF_SEED_TOKEN,
            scrobbles: [],
            tokens: function() { return Object.keys(jfTokens); }
        } : null
    };
})();

/* ============================================
   Sonance — Jellyfin adapter (v3.13)
   ============================================ */

// v3.13 (ticket-3.xx-jellyfin P1, R4-R10): JellyfinAPI inherits
// SubsonicAPI.prototype and replaces the transport. `_request(endpoint,
// params, opts)` hands each Subsonic endpoint name the app uses to a
// translator, which calls Jellyfin 12.x and resolves to the same
// `subsonic-response` body SubsonicAPI's public methods already parse. So
// both caches, in-flight joining, abortAll, the library fan-out and merges,
// the D23-D25 album cursor, the SongPager and the memoised fields run
// unchanged on either backend, and every screen sees the same objects.
//
// Overridden whole: the constructor, ping, getStreamUrl, getCoverArtUrl,
// savePlayQueue, getPlayQueue, clearMemoryCache, countAlbums and the Song
// pager's count (D197), and _buildUrl, which throws: no inherited path may
// build a Subsonic URL on a Jellyfin session.
//
// Auth (P4, D-numbers in ticket §9): API calls carry
// `Authorization: MediaBrowser Client=…, Device=…, DeviceId=…, Version=…,
// Token=…`; stream URLs carry `ApiKey=`; image URLs carry nothing (they are
// anonymous on Jellyfin). Never the legacy lower-case query key or the
// legacy token headers: 12.x answers them with 401. Never log the token or
// the header.
//
// Must load after js/api.js (it extends SubsonicAPI.prototype at load).
var JellyfinAPI = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var error = SonanceUtils.error;

    var CLIENT = 'Sonance';
    var VERSION = '3.13.0';
    var REQUEST_TIMEOUT_MS = 10000;      // api.js's, with the same message
    var LOGOUT_TIMEOUT_MS = 3000;
    var TICKS_PER_SECOND = 10000000;
    var TICKS_PER_MS = 10000;
    var IDS_PER_REQUEST = 100;           // ~3.3 KB of query string at 32+1 chars an id

    // D187 (§8 Q2): the codec is only in MediaStreams (an Opus file in Ogg
    // reports Container "ogg"), so every song request asks for it; a
    // 100-song page measured 127.6 KB without, 259.8 KB with.
    var SONG_FIELDS = 'MediaStreams';
    var ALBUM_FIELDS = 'ChildCount,Genres,DateCreated';
    // D189 (§8 Q6, P13): Navidrome lists an empty search3 in creation order;
    // SortName breaks ties (an Audio SortName starts with the track number).
    var SONG_ORDER = 'DateCreated,SortName';
    // The image tag rides in coverArt after this (ids and tags are hex).
    var COVER_SEP = '~';
    // The roles js/components.js CREDIT_ROLES knows, as Jellyfin's
    // PersonKind names lower-cased.
    var CREDIT_ROLES = ['composer', 'lyricist', 'producer', 'mixer', 'engineer', 'arranger', 'remixer', 'djmixer', 'conductor'];

    var MIME = {
        flac: 'audio/flac', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
        ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', wma: 'audio/x-ms-wma',
        webm: 'audio/webm', mka: 'audio/x-matroska', mkv: 'audio/x-matroska', ape: 'audio/x-ape',
        wv: 'audio/x-wavpack', dsf: 'audio/x-dsf', aiff: 'audio/aiff', aif: 'audio/aiff'
    };
    // ffprobe names a format by every alias ("mov,mp4,m4a,3gp,3g2,mj2" for
    // ALAC); the first of these that appears is the file's own.
    var SUFFIXES = ['m4a', 'flac', 'mp3', 'ogg', 'opus', 'wav', 'aac', 'wma', 'webm', 'mka', 'mkv', 'ape', 'wv', 'dsf', 'aiff'];

    // --- Helpers --------------------------------------------------------

    function _list(v) { return Array.isArray(v) ? v : []; }

    function _int(v, dflt) {
        var n = parseInt(v, 10);
        return isNaN(n) ? dflt : n;
    }

    // "A value Jellyfin lacks is omitted, never null or ''" (R5).
    function _set(o, key, v) {
        if (v !== undefined && v !== null && v !== '') o[key] = v;
    }

    function _seconds(ticks) { return Math.round(ticks / TICKS_PER_SECOND); }

    function _names(items) {
        return _list(items).map(function(x) { return x && x.Name; }).filter(Boolean);
    }

    function _idName(x) {
        var o = { id: x.Id };
        _set(o, 'name', x.Name);
        return o;
    }

    function _firstId(items) {
        var x = _list(items)[0];
        return x ? x.Id : undefined;
    }

    function _cover(id, tag) { return tag ? id + COVER_SEP + tag : undefined; }

    function _primaryCover(item) {
        return _cover(item.Id, item.ImageTags && item.ImageTags.Primary);
    }

    function _scope(params) {
        var f = params.musicFolderId;
        return (f === undefined || f === null || f === '') ? null : String(f);
    }

    function _qs(params) {
        var parts = [];
        Object.keys(params || {}).forEach(function(k) {
            var v = params[k];
            if (v === undefined || v === null || v === '') return;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    function _deviceName() {
        return typeof tizen !== 'undefined' ? 'Samsung TV' : 'Browser';
    }

    // Values quoted and URL-encoded (Jellyfin's header guidance).
    function _authorization(deviceId, token) {
        var parts = [
            'Client="' + encodeURIComponent(CLIENT) + '"',
            'Device="' + encodeURIComponent(_deviceName()) + '"',
            'DeviceId="' + encodeURIComponent(deviceId || '') + '"',
            'Version="' + encodeURIComponent(VERSION) + '"'
        ];
        if (token) parts.push('Token="' + encodeURIComponent(token) + '"');
        return 'MediaBrowser ' + parts.join(', ');
    }

    // fetch with api.js's timeout and abort pattern (V3.9 T8): the timeout
    // spans the body, and an AbortController (Chrome 66+, so feature-
    // detected) registered through SubsonicAPI._trackRequest lets
    // SubsonicAPI.abortAll() cancel it. Resolves to the parsed JSON body
    // (null when empty); rejects with `Server returned HTTP <n>` (err.status
    // set) or the network error as it came. `label` is the path only: it
    // never carries the token. opts.quiet: no error line (expected misses).
    function _fetchJson(url, init, timeoutMs, label, quiet) {
        return new Promise(function(resolve, reject) {
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var settled = false;
            var forget = SubsonicAPI._trackRequest({ endpoint: label, controller: controller });

            function done() {
                settled = true;
                clearTimeout(timeoutId);
                forget();
            }

            var timeoutId = setTimeout(function() {
                if (settled) return;
                done();
                if (controller) {
                    try { controller.abort(); } catch (e) { /* ignore */ }
                }
                error('API', label + ' timed out after ' + timeoutMs + 'ms');
                reject(new Error('Request timed out. Check your server connection.'));
            }, timeoutMs);

            if (controller) init.signal = controller.signal;
            fetch(url, init).then(function(response) {
                if (!response.ok) {
                    var httpErr = new Error('Server returned HTTP ' + response.status);
                    httpErr.status = response.status;
                    throw httpErr;
                }
                return response.text();
            }).then(function(text) {
                if (settled) return;
                var data = text ? JSON.parse(text) : null;
                done();
                resolve(data);
            }).catch(function(err) {
                if (settled) return;
                done();
                if (!quiet) error('API', label + ' failed: ' + err.message);
                reject(err);
            });
        });
    }

    // --- Item mapping (R5 field mapping) ----------------------------------

    function _audioStream(item) {
        var streams = _list(item.MediaStreams);
        var src = _list(item.MediaSources)[0];
        if (!streams.length && src) streams = _list(src.MediaStreams);
        for (var i = 0; i < streams.length; i++) {
            if (streams[i] && streams[i].Type === 'Audio') return streams[i];
        }
        return null;
    }

    function _suffix(item) {
        var src = _list(item.MediaSources)[0];
        if (src && src.Container) return String(src.Container).split(',')[0].toLowerCase();
        var names = String(item.Container || '').toLowerCase().split(',');
        for (var i = 0; i < SUFFIXES.length; i++) {
            if (names.indexOf(SUFFIXES[i]) > -1) return SUFFIXES[i];
        }
        return names[0] || '';
    }

    function _song(item, folderId) {
        var s = { id: item.Id };
        _set(s, 'title', item.Name);
        var artist = _names(item.ArtistItems).join(' • ') || item.AlbumArtist;
        _set(s, 'artist', artist);
        _set(s, 'artistId', _firstId(item.ArtistItems) || _firstId(item.AlbumArtists));
        _set(s, 'album', item.Album);
        _set(s, 'albumId', item.AlbumId);
        // A song's cover is its album's (a track has no image of its own).
        _set(s, 'coverArt', item.AlbumId ? _cover(item.AlbumId, item.AlbumPrimaryImageTag) : _primaryCover(item));
        if (item.RunTimeTicks) s.duration = _seconds(item.RunTimeTicks);
        _set(s, 'track', item.IndexNumber);
        _set(s, 'discNumber', item.ParentIndexNumber);
        _set(s, 'year', item.ProductionYear);
        var genres = _list(item.Genres);
        if (genres.length) {
            s.genre = genres[0];
            s.genres = genres.map(function(g) { return { name: g }; });
        }

        // js/player.js _isTranscoded reads suffix and contentType: an Opus
        // stream says "opus" in contentType whatever its container (D187).
        var suffix = _suffix(item);
        var stream = _audioStream(item);
        var codec = stream && stream.Codec ? String(stream.Codec).toLowerCase() : '';
        if (codec === 'opus' && (!suffix || suffix === 'ogg')) suffix = 'opus';
        _set(s, 'suffix', suffix);
        var type = MIME[suffix] || (suffix ? 'audio/' + suffix : '');
        if (codec === 'opus' && type.indexOf('opus') === -1) type = (type || 'audio/ogg') + '; codecs=opus';
        _set(s, 'contentType', type);
        var src = _list(item.MediaSources)[0];
        var bps = (stream && stream.BitRate) || (src && src.Bitrate);
        if (bps) s.bitRate = Math.round(bps / 1000);
        if (stream) {
            _set(s, 'samplingRate', stream.SampleRate);
            _set(s, 'bitDepth', stream.BitDepth);
            _set(s, 'channelCount', stream.Channels);
        }

        var ud = item.UserData;
        if (ud) {
            if (typeof ud.PlayCount === 'number') s.playCount = ud.PlayCount;
            _set(s, 'played', ud.LastPlayedDate);
        }
        _set(s, 'created', item.DateCreated);
        if (item.ArtistItems) s.artists = item.ArtistItems.map(_idName);
        if (item.AlbumArtists) s.albumArtists = item.AlbumArtists.map(_idName);
        _set(s, 'displayArtist', artist);
        _set(s, 'displayAlbumArtist', item.AlbumArtist);

        // Credits: People carries the roles (Composer on the live server).
        var contributors = [];
        var composers = [];
        _list(item.People).forEach(function(p) {
            var role = String((p && p.Type) || '').toLowerCase();
            if (!p || !p.Name || CREDIT_ROLES.indexOf(role) === -1) return;
            var c = { role: role, artist: { name: p.Name } };
            if (p.Id) c.artist.id = p.Id;
            contributors.push(c);
            if (role === 'composer') composers.push(p.Name);
        });
        if (contributors.length) s.contributors = contributors;
        if (composers.length) s.displayComposer = composers.join(' • ');
        if (folderId) s.musicFolderId = folderId;
        return s;
    }

    function _album(item, folderId) {
        var a = { id: item.Id };
        _set(a, 'name', item.Name);
        _set(a, 'title', item.Name);
        var artist = item.AlbumArtist || _names(item.AlbumArtists).join(' • ') ||
            _names(item.ArtistItems).join(' • ');
        _set(a, 'artist', artist);
        // No id: the album page shows a non-focusable artist label.
        _set(a, 'artistId', _firstId(item.AlbumArtists) || _firstId(item.ArtistItems));
        _set(a, 'coverArt', _primaryCover(item));
        _set(a, 'year', item.ProductionYear);
        var genres = _list(item.Genres);
        if (genres.length) {
            a.genre = genres[0];
            a.genres = genres.map(function(g) { return { name: g }; });
        }
        if (typeof item.ChildCount === 'number') a.songCount = item.ChildCount;
        if (item.RunTimeTicks) a.duration = _seconds(item.RunTimeTicks);
        _set(a, 'created', item.DateCreated);
        _set(a, 'displayArtist', artist);
        var labels = _names(item.Studios);
        if (labels.length) a.recordLabels = labels.map(function(n) { return { name: n }; });
        var premiere = parseInt(String(item.PremiereDate || '').slice(0, 4), 10);
        if (premiere > 1) a.releaseDate = { year: premiere };
        if (folderId) a.musicFolderId = folderId;
        return a;
    }

    function _artist(item) {
        var a = { id: item.Id, name: item.Name || '' };
        if (typeof item.AlbumCount === 'number') a.albumCount = item.AlbumCount;
        _set(a, 'coverArt', _primaryCover(item));
        return a;
    }

    function _playlist(item) {
        var p = { id: item.Id, name: item.Name || '' };
        if (typeof item.ChildCount === 'number') p.songCount = item.ChildCount;
        var ticks = item.CumulativeRunTimeTicks || item.RunTimeTicks;
        if (ticks) p.duration = _seconds(ticks);
        _set(p, 'coverArt', _primaryCover(item));
        return p;
    }

    function _songsOf(r, folderId) {
        return _list(r && r.Items).filter(function(it) { return it && it.Type === 'Audio'; })
            .map(function(it) { return _song(it, folderId); });
    }

    function _albumsOf(r, folderId) {
        return _list(r && r.Items).map(function(it) { return _album(it, folderId); });
    }

    // The query that orders an album list like Navidrome's `type` (R5).
    function _albumOrder(type, p) {
        if (type === 'newest') return { SortBy: 'DateCreated,SortName', SortOrder: 'Descending,Ascending' };
        if (type === 'alphabeticalByArtist') return { SortBy: 'AlbumArtist,SortName' };
        if (type === 'random') return { SortBy: 'Random' };
        // P9: no favourited date on Jellyfin, so A-Z.
        if (type === 'starred') return { Filters: 'IsFavorite', SortBy: 'SortName' };
        if (type === 'byGenre') return { Genres: p.genre, SortBy: 'SortName' };
        if (type === 'byYear') {
            var from = _int(p.fromYear, 0);
            var to = _int(p.toYear, 9999);
            var lo = Math.min(from, to);
            var hi = Math.max(from, to);
            // One SortOrder applies to every key (RequestHelpers.GetOrderBy),
            // so a descending year also reverses the name tie, as Navidrome's.
            var q = { SortBy: 'ProductionYear,SortName', SortOrder: from > to ? 'Descending' : 'Ascending' };
            // The Albums header asks 3000 -> 0 for "every album"; only a
            // narrower range filters.
            if (lo > 0 || hi < 3000) {
                var years = [];
                for (var y = Math.max(lo, 1); y <= Math.min(hi, 2999); y++) years.push(y);
                q.Years = years.join(',');
            }
            return q;
        }
        return { SortBy: 'SortName' };
    }

    // Normalised as js/api.js _albumSortValue does (D24), so a k-way merge
    // across libraries agrees with this order.
    function _nameKey(s) {
        return String(s || '').toLowerCase().replace(/^(?:the|a|an|el|la|los|las|le|les|il|der|die|das)\s+/, '');
    }

    // --- The adapter -----------------------------------------------------

    /**
     * config: { serverUrl, username, password, token, userId, deviceId,
     *           onSession(fields), selectedLibraries() }
     * onSession receives { token, userId } after a sign-in and { version }
     * after a ping, for AuthManager to persist. selectedLibraries returns the
     * library selection (P10).
     */
    function JellyfinAPI(config) {
        this.serverUrl = config.serverUrl.replace(/\/+$/, '');
        this.username = config.username;
        this.password = config.password || '';
        this.accessToken = config.token || '';
        this.userId = config.userId || '';
        this.deviceId = config.deviceId || '';
        this._onSession = config.onSession || null;
        this._selectedLibraries = config.selectedLibraries || null;
        this._artistIds = {};   // D194 (§8 Q8): artist name -> id, from getArtist
        log('API', 'Initialized (Jellyfin) for ' + this.serverUrl + ' as ' + this.username);
    }

    JellyfinAPI.prototype = Object.create(SubsonicAPI.prototype);
    JellyfinAPI.prototype.constructor = JellyfinAPI;

    // P1: an inherited path that reaches here would build a Subsonic URL
    // with no usable auth. None should; the tests look for any that does.
    JellyfinAPI.prototype._buildUrl = function(endpoint) {
        throw new Error('Jellyfin adapter: no Subsonic URL for ' + endpoint);
    };

    // opts: { timeout, auth: 'token' (default) | 'device' (no token) |
    //         'none' (no header: no CORS preflight), quiet }
    JellyfinAPI.prototype._send = function(method, path, query, body, opts) {
        opts = opts || {};
        var headers = { 'Accept': 'application/json' };
        if (opts.auth !== 'none') {
            headers['Authorization'] = _authorization(this.deviceId, opts.auth === 'device' ? null : this.accessToken);
        }
        var init = { method: method, headers: headers };
        if (body) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        return _fetchJson(this.serverUrl + path + _qs(query), init,
            opts.timeout || REQUEST_TIMEOUT_MS, method + ' ' + path, opts.quiet);
    };

    JellyfinAPI.prototype._get = function(path, query, opts) {
        return this._send('GET', path, query, null, opts);
    };

    JellyfinAPI.prototype._request = function(endpoint, params, opts) {
        var translate = TRANSLATORS[endpoint];
        if (!translate) {
            error('API', 'Jellyfin adapter: no translation for ' + endpoint);
            return Promise.reject(new Error('Not available on Jellyfin: ' + endpoint));
        }
        log('API', 'Request: ' + endpoint + ' (Jellyfin)');
        return translate.call(this, params || {}, opts || {});
    };

    // --- Session (R2, R3) -------------------------------------------------

    /** POST /Users/AuthenticateByName; a 401 rejects "Wrong username or password". */
    JellyfinAPI.prototype.signIn = function() {
        var self = this;
        return this._send('POST', '/Users/AuthenticateByName', null,
                { Username: this.username, Pw: this.password || '' }, { auth: 'device', quiet: true })
            .catch(function(err) {
                if (err && err.status === 401) throw new Error('Wrong username or password');
                throw err;
            })
            .then(function(res) {
                if (!res || !res.AccessToken) throw new Error('Invalid response from server');
                self.accessToken = res.AccessToken;
                self.userId = (res.User && res.User.Id) || '';
                if (self._onSession) self._onSession({ token: self.accessToken, userId: self.userId });
                return { token: self.accessToken, userId: self.userId };
            });
    };

    /**
     * GET /System/Info with the token; refreshes the stored server version.
     * R3: a 401 (a revoked token) signs in once with the stored username and
     * password and tries again; if that fails, the rejection sends boot to
     * Login, as any ping failure does.
     */
    JellyfinAPI.prototype.ping = function() {
        var self = this;
        return this._get('/System/Info', null, { quiet: true }).catch(function(err) {
            if (!err || err.status !== 401) throw err;
            log('API', 'Jellyfin token refused; signing in again');
            return self.signIn().then(function() { return self._get('/System/Info'); });
        }).then(function(info) {
            if (info && info.Version && self._onSession) self._onSession({ version: info.Version });
            return { ok: true };
        });
    };

    /** R3: revoke this token on the server, best effort (never rejects). */
    JellyfinAPI.prototype.endSession = function() {
        if (!this.accessToken) return Promise.resolve(false);
        return this._send('POST', '/Sessions/Logout', null, null, { timeout: LOGOUT_TIMEOUT_MS, quiet: true })
            .then(function() { return true; }, function() { return false; });
    };

    /**
     * P3: GET <url>/System/Info/Public with no header (so no preflight).
     * Resolves to the server's public info when its ProductName starts with
     * "Jellyfin", else null; never rejects (Navidrome answers a redirect to
     * its web page, a static server a 404, a dead address nothing).
     */
    JellyfinAPI.probe = function(serverUrl) {
        var url = String(serverUrl || '').replace(/\/+$/, '') + '/System/Info/Public';
        return _fetchJson(url, { method: 'GET', headers: { 'Accept': 'application/json' } },
                REQUEST_TIMEOUT_MS, 'GET /System/Info/Public', true)
            .then(function(info) {
                var product = info && info.ProductName;
                return (typeof product === 'string' && product.indexOf('Jellyfin') === 0) ? info : null;
            }, function() { return null; });
    };

    JellyfinAPI.CLIENT_VERSION = VERSION;

    // --- Media URLs (R6, P6) ------------------------------------------------

    // The same item, size and token always give the same URL (v3.9 T2:
    // URL stability is what lets the HTTP cache hit).
    JellyfinAPI.prototype.getStreamUrl = function(songId, opts) {
        var base = this.serverUrl + '/Audio/' + encodeURIComponent(songId);
        var key = 'ApiKey=' + encodeURIComponent(this.accessToken);
        if (opts && opts.format) {
            var q = 'audioCodec=' + encodeURIComponent(opts.format);
            if (opts.maxBitRate) q += '&audioBitRate=' + (opts.maxBitRate * 1000);
            if (opts.timeOffset) q += '&startTimeTicks=' + (opts.timeOffset * TICKS_PER_SECOND);
            return base + '/stream.' + encodeURIComponent(opts.format) + '?' + q + '&' + key;
        }
        return base + '/stream?static=true&' + key;
    };

    // `id` is a coverArt this adapter made (item id, then the image tag) or a
    // bare item id (`track.coverArt || track.albumId`). format=Jpg (P14): the
    // decoder path 3.12 is proven on, rather than WebP.
    // D201 (refines P6): js/components.js's 'ar-' + artist id means "no
    // coverArt", and every artist this adapter builds has coverArt exactly
    // when Jellyfin has its Primary image, so that request could only 404
    // (369 of 973 album artists live, again on every scroll: ImageCache does
    // not keep failures). An empty URL loads nothing and the card keeps its
    // placeholder, as for any image that fails.
    JellyfinAPI.prototype.getCoverArtUrl = function(id, size) {
        var s = String(id);
        if (s.indexOf('ar-') === 0) return '';
        var tag = null;
        var at = s.indexOf(COVER_SEP);
        if (at > -1) {
            tag = s.slice(at + 1);
            s = s.slice(0, at);
        }
        var q = [];
        if (size) {
            q.push('maxWidth=' + size);
            q.push('maxHeight=' + size);
        }
        q.push('quality=90');
        q.push('format=Jpg');
        if (tag) q.push('tag=' + encodeURIComponent(tag));
        return this.serverUrl + '/Items/' + encodeURIComponent(s) + '/Images/Primary?' + q.join('&');
    };

    // --- Shared lookups ---------------------------------------------------

    JellyfinAPI.prototype._musicLibraryIds = function() {
        return this.getMusicFolders().then(function(folders) {
            return _list(folders).map(function(f) { return String(f.id); });
        });
    };

    // Items by id, in `ids` order, duplicates kept; ids the server no longer
    // has are left out. Chunked to keep URLs short.
    JellyfinAPI.prototype._itemsByIds = function(ids, fields, extra) {
        var self = this;
        var chunks = [];
        for (var i = 0; i < ids.length; i += IDS_PER_REQUEST) chunks.push(ids.slice(i, i + IDS_PER_REQUEST));
        return Promise.all(chunks.map(function(chunk) {
            var q = { Ids: chunk.join(','), Fields: fields };
            if (extra) Object.keys(extra).forEach(function(k) { q[k] = extra[k]; });
            return self._get('/Items', q);
        })).then(function(rs) {
            var byId = {};
            rs.forEach(function(r) { _list(r && r.Items).forEach(function(it) { byId[it.Id] = it; }); });
            return ids.map(function(id) { return byId[id]; }).filter(Boolean);
        });
    };

    // P10 (refined by D195): with 2+ music libraries and a subset selected,
    // songs from an unscoped answer (a playlist, Instant Mix) get the
    // musicFolderId of the library that holds them, one lookup per library,
    // so the screens' filters can drop the others. Otherwise untouched, and
    // the filters keep untagged songs.
    JellyfinAPI.prototype._tagLibraries = function(songs) {
        var self = this;
        var selected = this._selectedLibraries ? this._selectedLibraries() : null;
        if (!songs.length || !selected || !selected.length) return Promise.resolve(songs);
        return this._musicLibraryIds().then(function(libs) {
            if (libs.length < 2) return songs;
            var ids = [];
            var seen = {};
            songs.forEach(function(s) { if (!seen[s.id]) { seen[s.id] = true; ids.push(s.id); } });
            return Promise.all(libs.map(function(lib) {
                return self._itemsByIds(ids, '', { ParentId: lib, Recursive: 'true', EnableImages: 'false', EnableUserData: 'false' })
                    .then(function(items) { return { lib: lib, items: items }; });
            })).then(function(found) {
                var where = {};
                found.forEach(function(f) { f.items.forEach(function(it) { if (!where[it.Id]) where[it.Id] = f.lib; }); });
                songs.forEach(function(s) { if (where[s.id]) s.musicFolderId = where[s.id]; });
                return songs;
            });
        });
    };

    // P7: Recently played and Most played album lists, from the tracks'
    // play data (Jellyfin does not aggregate it on albums). One request over
    // the played tracks, cached through _cachedRequest under an adapter
    // endpoint so logout and library changes clear it with everything else.
    JellyfinAPI.prototype._playedAlbums = function(type, folder, size, offset) {
        var self = this;
        return this._cachedRequest('jf:playedAlbums', folder ? { folder: folder } : null).then(function(agg) {
            var order = type === 'recent' ? agg.recent : agg.frequent;
            var page = order.slice(offset, offset + size);
            if (!page.length) return { albumList2: { album: [] } };
            return self._itemsByIds(page.map(function(e) { return e.id; }), ALBUM_FIELDS).then(function(items) {
                var byId = {};
                items.forEach(function(it) { byId[it.Id] = it; });
                var albums = [];
                page.forEach(function(e) {
                    var it = byId[e.id];
                    if (!it) return;
                    var a = _album(it, folder);
                    // The keys js/api.js _albumComparator merges on.
                    if (type === 'recent') a.played = e.played;
                    else a.playCount = e.playCount;
                    albums.push(a);
                });
                return { albumList2: { album: albums } };
            });
        });
    };

    // D197: list lengths come from TotalRecordCount, one Limit=0 request per
    // library, where SubsonicAPI binary-searches offsets with one-item
    // probes. Live, the probes cost 1.5 s for the albums count and 6.9 s for
    // the Songs list's (each one sorts the whole library), against ~0.1 s
    // here. Same totals, cached through _cachedRequest like everything else.
    JellyfinAPI.prototype.countAlbums = function(type, libraryIds, extra) {
        var self = this;
        var scope = (libraryIds && libraryIds.length) ? libraryIds : [null];
        return Promise.all(scope.map(function(folderId) {
            var params = { type: type };
            if (extra) Object.keys(extra).forEach(function(k) { params[k] = extra[k]; });
            if (folderId !== null && folderId !== undefined) params.musicFolderId = folderId;
            return self._cachedRequest('jf:albumCount', params).then(function(r) { return r.total; });
        })).then(function(totals) {
            var sum = 0;
            for (var i = 0; i < totals.length; i++) sum += totals[i];
            return sum;
        });
    };

    // The Songs and genre lists (v3.10 A1 SongPager): the same pager, with
    // its per-library total read the D197 way. `_segTotal(seg)` is the
    // pager's one count hook (js/api.js); `seg.id` is the library or null.
    JellyfinAPI.prototype.createSongPager = function(kind, arg, libraryIds, pageSize) {
        var self = this;
        var pager = SubsonicAPI.prototype.createSongPager.call(this, kind, arg, libraryIds, pageSize);
        pager._segTotal = function(seg) {
            var params = { kind: kind };
            if (kind === 'genre') params.genre = arg;
            if (seg.id !== null && seg.id !== undefined) params.folder = String(seg.id);
            return self._cachedRequest('jf:songCount', params).then(function(r) { return r.total; });
        };
        return pager;
    };

    JellyfinAPI.prototype._rememberArtist = function(name, id) {
        if (name && id) this._artistIds[name] = id;
    };

    // D194 (§8 Q8): the artist page asks getArtist(id) before
    // getTopSongs(name), so the name is normally known. Otherwise a search,
    // exact name first; never /Artists/{name} (a name may hold "/").
    JellyfinAPI.prototype._artistIdByName = function(name) {
        if (!name) return Promise.resolve(null);
        if (this._artistIds[name]) return Promise.resolve(this._artistIds[name]);
        return this._cachedRequest('jf:artistIdByName', { name: name }).then(function(r) {
            return r && r.id ? r.id : null;
        });
    };

    // V3.8's instance-level reset (App.applyLibraryChange) also drops the
    // name -> id memo; logout builds a new instance.
    JellyfinAPI.prototype.clearMemoryCache = function() {
        this._artistIds = {};
        return SubsonicAPI.prototype.clearMemoryCache.call(this);
    };

    // --- Resume last queue, on the TV (R9, user decision 7) -------------------

    JellyfinAPI.prototype._queueKey = function() {
        return 'sonance_jf_queue__' + this.serverUrl + '|' + (this.userId || this.username);
    };

    // Not in AuthManager.KEYS, so it survives logout, like Navidrome's
    // server-side queue. Resolves as api.js's does; quota errors swallowed.
    JellyfinAPI.prototype.savePlayQueue = function(ids, currentIndex, positionMs) {
        try {
            localStorage.setItem(this._queueKey(), JSON.stringify({
                ids: ids, index: currentIndex, positionMs: positionMs
            }));
        } catch (e) { /* quota: nothing saved, nothing to report */ }
        return Promise.resolve({ byIndex: true, post: false });
    };

    // { entries, index, positionMs } or null. Order and duplicates kept; ids
    // the server no longer has are dropped and the index corrected.
    JellyfinAPI.prototype.getPlayQueue = function() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(this._queueKey()) || 'null'); } catch (e) { saved = null; }
        var ids = saved && Array.isArray(saved.ids) ? saved.ids.filter(Boolean) : [];
        if (!ids.length) return Promise.resolve(null);
        var index = Math.max(0, Math.min(_int(saved.index, 0), ids.length - 1));
        var positionMs = _int(saved.positionMs, 0);
        return this._itemsByIds(ids, SONG_FIELDS).then(function(items) {
            var byId = {};
            items.forEach(function(it) { if (it.Type === 'Audio') byId[it.Id] = it; });
            var entries = [];
            var newIndex = -1;
            for (var i = 0; i < ids.length; i++) {
                if (i === index && byId[ids[i]]) newIndex = entries.length;
                if (i === index && !byId[ids[i]]) positionMs = 0;
                if (byId[ids[i]]) {
                    if (i > index && newIndex === -1) newIndex = entries.length;
                    entries.push(_song(byId[ids[i]], null));
                }
            }
            if (!entries.length) return null;
            if (newIndex === -1) newIndex = entries.length - 1;
            // js/api.js _memoSongDuration's field, which the queue rows read.
            entries.forEach(function(s) { s._formattedDuration = SonanceUtils.formatDuration(s.duration); });
            return { entries: entries, index: newIndex, positionMs: positionMs };
        });
    };

    // --- Translators (R5, R7, R8) ------------------------------------------
    // Each resolves to the subsonic-response body js/api.js reads.

    var TRANSLATORS = {
        'getMusicFolders.view': function() {
            // includeHidden: a library the user hid from their Jellyfin home
            // screen is still theirs (the test profile's only music library).
            return this._get('/UserViews', { includeHidden: 'true' }).then(function(r) {
                var views = _list(r && r.Items).filter(function(v) { return v && v.CollectionType === 'music'; });
                return { musicFolders: { musicFolder: views.map(function(v) { return { id: v.Id, name: v.Name || '' }; }) } };
            });
        },

        'getAlbumList2.view': function(p) {
            var folder = _scope(p);
            var size = _int(p.size, 10);
            var offset = _int(p.offset, 0);
            if (p.type === 'recent' || p.type === 'frequent') return this._playedAlbums(p.type, folder, size, offset);
            var q = { IncludeItemTypes: 'MusicAlbum', Recursive: 'true', Fields: ALBUM_FIELDS,
                StartIndex: offset, Limit: size, ParentId: folder };
            var order = _albumOrder(p.type, p);
            Object.keys(order).forEach(function(k) { q[k] = order[k]; });
            return this._get('/Items', q).then(function(r) {
                return { albumList2: { album: _albumsOf(r, folder) } };
            });
        },

        'jf:albumCount': function(p) {
            var folder = _scope(p);
            if (p.type === 'recent' || p.type === 'frequent') {
                return this._cachedRequest('jf:playedAlbums', folder ? { folder: folder } : null).then(function(agg) {
                    return { total: (p.type === 'recent' ? agg.recent : agg.frequent).length };
                });
            }
            var q = { IncludeItemTypes: 'MusicAlbum', Recursive: 'true', Limit: 0, ParentId: folder };
            var order = _albumOrder(p.type, p);
            Object.keys(order).forEach(function(k) { if (k !== 'SortBy' && k !== 'SortOrder') q[k] = order[k]; });
            return this._get('/Items', q).then(function(r) { return { total: (r && r.TotalRecordCount) || 0 }; });
        },

        'jf:songCount': function(p) {
            return this._get('/Items', { IncludeItemTypes: 'Audio', Recursive: 'true', Limit: 0,
                Genres: p.kind === 'genre' ? p.genre : null, ParentId: p.folder || null
            }).then(function(r) { return { total: (r && r.TotalRecordCount) || 0 }; });
        },

        // P7's aggregate: albums by their newest play, and by their tracks'
        // summed play count (only albums with plays, ties by name).
        'jf:playedAlbums': function(p) {
            return this._get('/Items', { IncludeItemTypes: 'Audio', Recursive: 'true', Filters: 'IsPlayed',
                SortBy: 'DatePlayed', SortOrder: 'Descending', EnableImages: 'false', ParentId: p.folder || null
            }).then(function(r) {
                var recent = [];
                var seen = {};
                var sums = {};
                var names = {};
                _list(r && r.Items).forEach(function(t) {
                    if (!t || !t.AlbumId) return;
                    var ud = t.UserData || {};
                    if (!seen[t.AlbumId]) {
                        seen[t.AlbumId] = true;
                        var e = { id: t.AlbumId };
                        _set(e, 'played', ud.LastPlayedDate);
                        recent.push(e);
                    }
                    sums[t.AlbumId] = (sums[t.AlbumId] || 0) + (ud.PlayCount || 0);
                    if (!names[t.AlbumId]) names[t.AlbumId] = t.Album;
                });
                var frequent = Object.keys(sums).filter(function(id) { return sums[id] > 0; })
                    .map(function(id) { return { id: id, playCount: sums[id], key: _nameKey(names[id]) }; });
                frequent.sort(function(a, b) {
                    if (a.playCount !== b.playCount) return b.playCount - a.playCount;
                    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
                });
                return { recent: recent, frequent: frequent };
            });
        },

        'getAlbum.view': function(p) {
            return Promise.all([
                this._get('/Items/' + encodeURIComponent(p.id)),
                this._get('/Items', { ParentId: p.id, IncludeItemTypes: 'Audio', Recursive: 'true',
                    SortBy: 'ParentIndexNumber,IndexNumber,SortName', Fields: SONG_FIELDS })
            ]).then(function(r) {
                var album = _album(r[0], null);
                var songs = _songsOf(r[1], null);
                album.song = songs;
                album.songCount = songs.length;
                return { album: album };
            });
        },

        'getSong.view': function(p) {
            return this._get('/Items/' + encodeURIComponent(p.id)).then(function(item) {
                return { song: _song(item, null) };
            });
        },

        'jf:item': function(p) {
            return this._get('/Items/' + encodeURIComponent(p.id));
        },

        // Buckets of consecutive first letters, in the server's (SortName)
        // order: SubsonicAPI.getArtists and its localStorage projection read
        // `artists.index[].artist[]`.
        'getArtists.view': function(p) {
            var folder = _scope(p);
            return this._get('/Artists/AlbumArtists', { ParentId: folder, SortBy: 'SortName', Fields: 'ItemCounts' })
                .then(function(r) {
                    var index = [];
                    _list(r && r.Items).forEach(function(it) {
                        var a = _artist(it);
                        var letter = (a.name.charAt(0) || '#').toUpperCase();
                        if (!/[A-Z]/.test(letter)) letter = '#';
                        var last = index[index.length - 1];
                        if (!last || last.name !== letter) index.push(last = { name: letter, artist: [] });
                        last.artist.push(a);
                    });
                    return { artists: { ignoredArticles: '', index: index } };
                });
        },

        // P11: the albums the artist is album artist of, by year as
        // Navidrome orders them (D191); a track-only artist (reached from a
        // song or a similar artist) falls back to the albums they appear on
        // (D190).
        'getArtist.view': function(p) {
            var self = this;
            var q = { IncludeItemTypes: 'MusicAlbum', Recursive: 'true', SortBy: 'ProductionYear,SortName',
                Fields: ALBUM_FIELDS };
            return Promise.all([
                this._cachedRequest('jf:item', { id: p.id }),
                this._get('/Items', Object.assign({ AlbumArtistIds: p.id }, q))
            ]).then(function(r) {
                var item = r[0] || {};
                var albums = _list(r[1] && r[1].Items);
                var more = albums.length ? Promise.resolve(albums)
                    : self._get('/Items', Object.assign({ ArtistIds: p.id }, q)).then(function(x) { return _list(x && x.Items); });
                return more.then(function(items) {
                    var artist = { id: item.Id || p.id, name: item.Name || '' };
                    _set(artist, 'coverArt', _primaryCover(item));
                    artist.album = items.map(function(it) { return _album(it, null); });
                    artist.albumCount = artist.album.length;
                    self._rememberArtist(artist.name, artist.id);
                    return { artist: artist };
                });
            });
        },

        // Overview is Jellyfin's biography; similar artists are Jellyfin's
        // own. D192: no image URLs, because the artist's Primary image is
        // already its coverArt, which the photo shows.
        'getArtistInfo2.view': function(p) {
            return Promise.all([
                this._cachedRequest('jf:item', { id: p.id }),
                this._get('/Artists/' + encodeURIComponent(p.id) + '/Similar', { Limit: _int(p.count, 20) })
            ]).then(function(r) {
                var info = {};
                _set(info, 'biography', r[0] && r[0].Overview);
                var similar = _list(r[1] && r[1].Items).map(_artist);
                if (similar.length) info.similarArtist = similar;
                return { artistInfo2: info };
            });
        },

        'jf:artistIdByName': function(p) {
            return this._get('/Artists', { searchTerm: p.name, Limit: 50 }).then(function(r) {
                var items = _list(r && r.Items);
                var lower = String(p.name).toLowerCase();
                var hit = null;
                for (var i = 0; i < items.length && !hit; i++) if (items[i].Name === p.name) hit = items[i];
                for (var j = 0; j < items.length && !hit; j++) if (String(items[j].Name).toLowerCase() === lower) hit = items[j];
                return hit ? { id: hit.Id } : {};
            });
        },

        // User decision 8: this user's most played tracks by the artist;
        // none (the section hides) when they have played nothing of theirs.
        'getTopSongs.view': function(p) {
            var self = this;
            return this._artistIdByName(p.artist).then(function(id) {
                if (!id) return { topSongs: {} };
                return self._get('/Items', { ArtistIds: id, IncludeItemTypes: 'Audio', Recursive: 'true',
                    Filters: 'IsPlayed', SortBy: 'PlayCount,SortName', SortOrder: 'Descending,Ascending',
                    Limit: _int(p.count, 50), Fields: SONG_FIELDS
                }).then(function(r) {
                    var songs = _songsOf(r, null);
                    return { topSongs: songs.length ? { song: songs } : {} };
                });
            });
        },

        // Start radio: Jellyfin's Instant Mix (local, fast).
        'getSimilarSongs2.view': function(p, opts) {
            var self = this;
            return this._get('/Items/' + encodeURIComponent(p.id) + '/InstantMix',
                    { Limit: _int(p.count, 50), Fields: SONG_FIELDS }, { timeout: opts.timeout })
                .then(function(r) { return self._tagLibraries(_songsOf(r, null)); })
                .then(function(songs) { return { similarSongs2: { song: songs } }; });
        },

        // P12, D188: an unscoped /Genres does not sum the libraries (4 genres
        // against 692 on the test server), so one request per music library,
        // merged by name with the counts summed, in the server's order.
        'getGenres.view': function() {
            var self = this;
            return this._musicLibraryIds().then(function(libs) {
                return Promise.all((libs.length ? libs : [null]).map(function(lib) {
                    return self._get('/Genres', { ParentId: lib, IncludeItemTypes: 'MusicAlbum,Audio', Recursive: 'true' });
                }));
            }).then(function(rs) {
                var out = [];
                var byName = {};
                rs.forEach(function(r) {
                    _list(r && r.Items).forEach(function(g) {
                        if (!g || !g.Name) return;
                        var e = byName[g.Name];
                        if (!e) {
                            e = byName[g.Name] = { value: g.Name, songCount: 0, albumCount: 0 };
                            out.push(e);
                        }
                        e.songCount += g.SongCount || 0;
                        e.albumCount += g.AlbumCount || 0;
                    });
                });
                return { genres: { genre: out } };
            });
        },

        'getSongsByGenre.view': function(p) {
            var folder = _scope(p);
            return this._get('/Items', { Genres: p.genre, IncludeItemTypes: 'Audio', Recursive: 'true',
                StartIndex: _int(p.offset, 0), Limit: _int(p.count, 10), ParentId: folder,
                SortBy: SONG_ORDER, Fields: SONG_FIELDS
            }).then(function(r) { return { songsByGenre: { song: _songsOf(r, folder) } }; });
        },

        'getRandomSongs.view': function(p) {
            var folder = _scope(p);
            return this._get('/Items', { IncludeItemTypes: 'Audio', Recursive: 'true', SortBy: 'Random',
                Limit: _int(p.size, 10), ParentId: folder, Fields: SONG_FIELDS
            }).then(function(r) { return { randomSongs: { song: _songsOf(r, folder) } }; });
        },

        // Each type with its own offset and count; a type asked 0 is not
        // requested. An empty query lists in a stable order (P13).
        'search3.view': function(p) {
            var folder = _scope(p);
            var term = String(p.query || '').trim() || null;
            var counts = [_int(p.artistCount, 20), _int(p.albumCount, 20), _int(p.songCount, 20)];
            var jobs = [
                counts[0] > 0 ? this._get('/Artists/AlbumArtists', { searchTerm: term, StartIndex: _int(p.artistOffset, 0),
                    Limit: counts[0], ParentId: folder, SortBy: term ? null : 'SortName', Fields: 'ItemCounts' }) : null,
                counts[1] > 0 ? this._get('/Items', { searchTerm: term, IncludeItemTypes: 'MusicAlbum', Recursive: 'true',
                    StartIndex: _int(p.albumOffset, 0), Limit: counts[1], ParentId: folder,
                    SortBy: term ? null : SONG_ORDER, Fields: ALBUM_FIELDS }) : null,
                counts[2] > 0 ? this._get('/Items', { searchTerm: term, IncludeItemTypes: 'Audio', Recursive: 'true',
                    StartIndex: _int(p.songOffset, 0), Limit: counts[2], ParentId: folder,
                    SortBy: term ? null : SONG_ORDER, Fields: SONG_FIELDS }) : null
            ];
            return Promise.all(jobs).then(function(r) {
                var out = {};
                if (r[0]) out.artist = _list(r[0].Items).map(_artist);
                if (r[1]) out.album = _albumsOf(r[1], folder);
                if (r[2]) out.song = _songsOf(r[2], folder);
                return { searchResult3: out };
            });
        },

        'getStarred2.view': function(p) {
            var folder = _scope(p);
            var fav = { Filters: 'IsFavorite', Recursive: 'true', ParentId: folder, SortBy: 'SortName' };
            return Promise.all([
                this._get('/Items', Object.assign({ IncludeItemTypes: 'MusicAlbum', Fields: ALBUM_FIELDS }, fav)),
                this._get('/Items', Object.assign({ IncludeItemTypes: 'Audio', Fields: SONG_FIELDS }, fav)),
                this._get('/Artists/AlbumArtists', { Filters: 'IsFavorite', ParentId: folder, SortBy: 'SortName', Fields: 'ItemCounts' })
            ]).then(function(r) {
                return { starred2: {
                    album: _albumsOf(r[0], folder),
                    song: _songsOf(r[1], folder),
                    artist: _list(r[2] && r[2].Items).map(_artist)
                } };
            });
        },

        // Audio playlists (a video playlist says MediaType Video; an empty
        // one may say Unknown). D198: the list carries no duration (12.2's
        // DtoService copies a playlist's own RunTimeTicks, empty in lists),
        // so a card shows the song count alone; the detail has it.
        'getPlaylists.view': function() {
            return this._get('/Items', { IncludeItemTypes: 'Playlist', Recursive: 'true',
                Fields: 'ChildCount' }).then(function(r) {
                var lists = _list(r && r.Items).filter(function(it) {
                    return it && (it.MediaType === 'Audio' || it.MediaType === 'Unknown' || !it.MediaType);
                });
                return { playlists: { playlist: lists.map(_playlist) } };
            });
        },

        'getPlaylist.view': function(p) {
            var self = this;
            return Promise.all([
                this._get('/Items/' + encodeURIComponent(p.id)),
                this._get('/Playlists/' + encodeURIComponent(p.id) + '/Items', { Fields: SONG_FIELDS })
            ]).then(function(r) {
                var playlist = _playlist(r[0]);
                return self._tagLibraries(_songsOf(r[1], null)).then(function(entries) {
                    playlist.entry = entries;
                    playlist.songCount = entries.length;
                    return { playlist: playlist };
                });
            });
        },

        'getOpenSubsonicExtensions.view': function() {
            return Promise.resolve({ openSubsonicExtensions: [] });
        },

        // R8: OpenSubsonic's structured lyrics from /Audio/{id}/Lyrics.
        // `Start` is in ticks; lines without it are unsynced; a 404 is "no
        // lyrics" (an empty list), not an error.
        'getLyricsBySongId.view': function(p) {
            return this._get('/Audio/' + encodeURIComponent(p.id) + '/Lyrics', null, { quiet: true }).then(function(r) {
                var lines = _list(r && r.Lyrics);
                if (!lines.length) return { lyricsList: { structuredLyrics: [] } };
                var meta = (r && r.Metadata) || {};
                var synced = meta.IsSynced === true || lines.some(function(l) { return typeof l.Start === 'number'; });
                return { lyricsList: { structuredLyrics: [{
                    lang: meta.Language || 'xxx',
                    synced: synced,
                    line: lines.map(function(l) {
                        var o = { value: l.Text || '' };
                        if (synced && typeof l.Start === 'number') o.start = Math.round(l.Start / TICKS_PER_MS);
                        return o;
                    })
                }] } };
            }, function(err) {
                if (err && err.status === 404) return { lyricsList: { structuredLyrics: [] } };
                throw err;
            });
        },

        // R7: the only writes. Favourites for song, album and artist ids.
        'star.view': function(p) {
            return this._send('POST', '/UserFavoriteItems/' + encodeURIComponent(p.id || p.albumId || p.artistId))
                .then(function() { return {}; });
        },
        'unstar.view': function(p) {
            return this._send('DELETE', '/UserFavoriteItems/' + encodeURIComponent(p.id || p.albumId || p.artistId))
                .then(function() { return {}; });
        },

        // P8, D185: with datePlayed, MarkPlayedItem increments PlayCount
        // (BaseItem.MarkPlayed at v12.2) and sets the last-played date.
        'scrobble.view': function(p) {
            return this._send('POST', '/UserPlayedItems/' + encodeURIComponent(p.id),
                    { datePlayed: new Date().toISOString() })
                .then(function() { return {}; });
        }
    };

    return JellyfinAPI;
})();

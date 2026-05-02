// Installs a fetch mock for the Subsonic REST API + pre-seeds credentials.
// Loaded BEFORE app scripts so the app runs as if it were authenticated to
// a real Navidrome server.
(function() {
    var mockSongs = [];
    for (var i = 0; i < 20; i++) {
        mockSongs.push({
            id: 'song-'+i,
            title: 'Track '+(i+1),
            artist: 'Test Artist '+((i%3)+1),
            album: 'Test Album',
            duration: 180 + i*7,
            coverArt: 'album-'+(i%5),
            starred: false,
            track: i+1
        });
    }
    var mockAlbums = [];
    for (var j = 0; j < 14; j++) {
        mockAlbums.push({
            id: 'album-'+j,
            name: 'Album '+(j+1),
            title: 'Album '+(j+1),
            artist: 'Artist '+((j%4)+1),
            year: 2020+(j%6),
            songCount: 10,
            duration: 2400,
            coverArt: 'album-'+j
        });
    }
    var mockArtists = [];
    for (var k = 0; k < 10; k++) {
        mockArtists.push({ id: 'artist-'+k, name: 'Artist '+(k+1), albumCount: 3 });
    }
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
    var mockPlaylists = [];
    for (var m = 0; m < 5; m++) {
        mockPlaylists.push({ id: 'pl-'+m, name: 'Playlist '+(m+1), songCount: 20 });
    }

    function resp(body) {
        var payload = { 'subsonic-response': { status: 'ok', version: '1.16.1' } };
        for (var key in body) { if (body.hasOwnProperty(key)) payload['subsonic-response'][key] = body[key]; }
        return Promise.resolve(new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        }));
    }

    var origFetch = window.fetch.bind(window);
    window.fetch = function(url, opts) {
        var u = typeof url === 'string' ? url : url.url;
        if (!/\/rest\//.test(u)) return origFetch(url, opts);
        if (/ping\.view/.test(u)) return resp({});
        if (/getAlbumList2/.test(u)) return resp({ albumList2: { album: mockAlbums } });
        if (/getAlbumList/.test(u)) return resp({ albumList: { album: mockAlbums } });
        if (/getStarred2/.test(u)) return resp({ starred2: {} });
        if (/getPlaylists/.test(u)) return resp({ playlists: { playlist: mockPlaylists } });
        if (/getPlaylist\.view/.test(u)) return resp({ playlist: { id: 'pl-0', name: 'Playlist', entry: mockSongs } });
        if (/getArtists/.test(u)) return resp({ artists: { index: [{ name: 'A', artist: mockArtists }] } });
        if (/getArtist\.view/.test(u)) return resp({ artist: { id: 'artist-0', name: 'Test Artist', album: mockAlbums.slice(0, 4) } });
        if (/getAlbum\.view/.test(u)) return resp({ album: { id: 'album-0', name: 'Test Album', artist: 'Test Artist', year: 2023, song: mockSongs } });
        if (/getSongsByGenre/.test(u)) return resp({ songsByGenre: { song: mockSongs } });
        if (/getGenres/.test(u)) return resp({ genres: { genre: mockGenres } });
        if (/getRandomSongs/.test(u)) return resp({ randomSongs: { song: mockSongs } });
        if (/search3/.test(u)) return resp({ searchResult3: { song: mockSongs.slice(0, 3), album: mockAlbums.slice(0, 2), artist: mockArtists.slice(0, 2) } });
        if (/getCoverArt/.test(u)) {
            var hue = (u.length * 17) % 360;
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect fill="hsl('+hue+',65%,50%)" width="120" height="120"/><text x="60" y="72" fill="white" text-anchor="middle" font-size="36">♪</text></svg>';
            return Promise.resolve(new Response(svg, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }));
        }
        if (/stream\.view/.test(u)) return Promise.resolve(new Response('', { status: 200 }));
        if (/getLyricsBySongId/.test(u)) return resp({ lyricsList: { structuredLyrics: [] } });
        if (/star\.view|unstar\.view|scrobble\.view/.test(u)) return resp({});
        if (/getArtistInfo2/.test(u)) return resp({ artistInfo2: {} });
        if (/getMusicFolders/.test(u)) return resp({ musicFolders: { musicFolder: [] } });
        if (/getTopSongs/.test(u)) return resp({ topSongs: { song: mockSongs.slice(0, 10) } });
        if (/getIndexes/.test(u)) return resp({ indexes: { index: [], lastModified: 0, ignoredArticles: 'The' } });
        return resp({});
    };

    localStorage.setItem('sonance_server_url', 'http://mock.test');
    localStorage.setItem('sonance_username', 'test');
    localStorage.setItem('sonance_password', 'test');
    localStorage.setItem('sonance_logged_in', 'true');
})();

/* ============================================
   Sonance — Subsonic API Client
   ============================================ */

var SubsonicAPI = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var error = SonanceUtils.error;

    // --- Response Cache ---
    var _cache = {};
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // V3.7-fix6: localStorage second tier for static metadata. Survives cold
    // app launches and acts as an offline fallback. Scoped per (username +
    // server) so logging in as a different user can't see stale data.
    var LS_PREFIX = 'sonance_apicache_v1__';
    var LS_TTL = 24 * 60 * 60 * 1000; // 24 hours
    var LS_ALLOWLIST = [
        'getArtists.view',
        'getGenres.view',
        'getPlaylists.view',
        'getMusicFolders.view'
    ];

    function _isLsAllowlisted(endpoint, params) {
        if (LS_ALLOWLIST.indexOf(endpoint) !== -1) return true;
        // Special case: only the alphabetical first page of getAlbumList2 is
        // safe to persist — other types (recent / random) are mutable.
        if (endpoint === 'getAlbumList2.view' &&
            params && params.type === 'alphabeticalByName' &&
            (!params.offset || params.offset === 0)) {
            return true;
        }
        return false;
    }

    // --- Helper: ensure value is array ---
    function _ensureArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        return [val];
    }

    // V3.7-fix11: pre-format strings on each model item once so render code
    // paths can read primitives instead of recomputing per row. Idempotent —
    // skips items that already carry the memoised field. Cached responses
    // (_cachedRequest) reuse the same object identity so a second normalise
    // pass over the same array is a no-op walk.
    function _memoSongDuration(song) {
        if (!song) return song;
        if (typeof song._formattedDuration !== 'string') {
            song._formattedDuration = SonanceUtils.formatDuration(song.duration);
        }
        return song;
    }
    function _memoSongList(songs) {
        if (!songs || !songs.length) return songs;
        for (var i = 0; i < songs.length; i++) _memoSongDuration(songs[i]);
        return songs;
    }
    function _memoAlbum(album) {
        if (!album) return album;
        if (typeof album._metaString !== 'string') {
            var parts = [];
            if (album.artist) parts.push(album.artist);
            if (album.year) parts.push(album.year);
            // join with ' · ' (middle dot) to match existing render output
            album._metaString = parts.join(' · ');
        }
        return album;
    }
    function _memoAlbumList(albums) {
        if (!albums || !albums.length) return albums;
        for (var i = 0; i < albums.length; i++) _memoAlbum(albums[i]);
        return albums;
    }
    function _memoPlaylist(playlist) {
        if (!playlist) return playlist;
        if (!playlist._gradient && typeof SonanceComponents !== 'undefined' && SonanceComponents.hashColor) {
            playlist._gradient = SonanceComponents.hashColor(playlist.name || '');
        }
        return playlist;
    }
    function _memoPlaylistList(playlists) {
        if (!playlists || !playlists.length) return playlists;
        for (var i = 0; i < playlists.length; i++) _memoPlaylist(playlists[i]);
        return playlists;
    }

    function SubsonicAPI(config) {
        this.serverUrl = config.serverUrl.replace(/\/+$/, ''); // strip trailing slashes
        this.username = config.username;
        this.password = config.password;

        log('API', 'Initialized for ' + this.serverUrl + ' as ' + this.username);
    }

    // Build full URL with auth params
    SubsonicAPI.prototype._buildUrl = function(endpoint, params) {
        var salt = SonanceUtils.generateSalt(12);
        var token = SonanceUtils.md5(this.password + salt);

        var url = this.serverUrl + '/rest/' + endpoint;
        var queryParts = [
            'u=' + encodeURIComponent(this.username),
            't=' + token,
            's=' + salt,
            'v=1.16.1',
            'c=Sonance',
            'f=json'
        ];

        if (params) {
            Object.keys(params).forEach(function(key) {
                if (params[key] !== undefined && params[key] !== null) {
                    queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
                }
            });
        }

        return url + '?' + queryParts.join('&');
    };

    // Fetch wrapper with error handling and timeout
    SubsonicAPI.prototype._request = function(endpoint, params) {
        var url = this._buildUrl(endpoint, params);
        log('API', 'Request: ' + endpoint);

        return new Promise(function(resolve, reject) {
            var timeoutId = setTimeout(function() {
                reject(new Error('Request timed out. Check your server connection.'));
            }, 10000);

            fetch(url).then(function(response) {
                clearTimeout(timeoutId);
                if (!response.ok) {
                    throw new Error('Server returned HTTP ' + response.status);
                }
                return response.json();
            }).then(function(data) {
                var subResponse = data['subsonic-response'];
                if (!subResponse) {
                    throw new Error('Invalid response from server');
                }
                if (subResponse.status !== 'ok') {
                    var errMsg = (subResponse.error && subResponse.error.message) || 'Unknown server error';
                    var errCode = (subResponse.error && subResponse.error.code) || 0;
                    throw new Error(errMsg + ' (code ' + errCode + ')');
                }
                resolve(subResponse);
            }).catch(function(err) {
                clearTimeout(timeoutId);
                error('API', endpoint + ' failed: ' + err.message);
                reject(err);
            });
        });
    };

    // V3.7-fix6: localStorage helpers (per-instance because they include
    // username + serverUrl in the key). Wrapped in try/catch so quota or
    // parse errors silently fall through to a fresh network request.
    SubsonicAPI.prototype._lsKey = function(endpoint, params) {
        return LS_PREFIX + this.username + '|' + this.serverUrl +
               '|' + endpoint + '|' + JSON.stringify(params || {});
    };

    SubsonicAPI.prototype._lsRead = function(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed; // { data, time }
        } catch (e) {
            return null;
        }
    };

    SubsonicAPI.prototype._lsWrite = function(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ data: data, time: Date.now() }));
        } catch (e) { /* quota / disabled — ignore */ }
    };

    // Cached request — returns cached data if within TTL.
    // Two tiers:
    //   1. In-memory _cache (5 min TTL) — within-session refresh.
    //   2. localStorage (24 h TTL, allowlist only) — survives cold launches
    //      and falls back to stale data on network failure.
    SubsonicAPI.prototype._cachedRequest = function(endpoint, params) {
        var self = this;
        var memKey = endpoint + '|' + JSON.stringify(params || {});
        var memCached = _cache[memKey];
        if (memCached && (Date.now() - memCached.time) < CACHE_TTL) {
            log('API', 'Cache hit: ' + endpoint);
            return Promise.resolve(memCached.data);
        }

        var lsAllowed = _isLsAllowlisted(endpoint, params);
        var lsKey = lsAllowed ? self._lsKey(endpoint, params) : null;

        if (lsKey) {
            var lsCached = self._lsRead(lsKey);
            if (lsCached && lsCached.data && (Date.now() - lsCached.time) < LS_TTL) {
                log('API', 'LS cache hit: ' + endpoint);
                _cache[memKey] = { data: lsCached.data, time: lsCached.time };
                return Promise.resolve(lsCached.data);
            }
        }

        return self._request(endpoint, params).then(function(data) {
            _cache[memKey] = { data: data, time: Date.now() };
            if (lsKey) self._lsWrite(lsKey, data);
            return data;
        }).catch(function(err) {
            // Offline fallback: serve stale localStorage data if we have it.
            if (lsKey) {
                var stale = self._lsRead(lsKey);
                if (stale && stale.data) {
                    warn('API', 'Stale cache served for ' + endpoint);
                    _cache[memKey] = { data: stale.data, time: stale.time };
                    return stale.data;
                }
            }
            throw err;
        });
    };

    // --- Public Methods ---

    SubsonicAPI.prototype.ping = function() {
        return this._request('ping.view').then(function() {
            return { ok: true };
        });
    };

    SubsonicAPI.prototype.getStreamUrl = function(songId, extraParams) {
        var params = { id: songId };
        if (extraParams) {
            Object.keys(extraParams).forEach(function(key) {
                params[key] = extraParams[key];
            });
        }
        return this._buildUrl('stream.view', params);
    };

    SubsonicAPI.prototype.getCoverArtUrl = function(id, size) {
        var params = { id: id };
        if (size) params.size = size;
        return this._buildUrl('getCoverArt.view', params);
    };

    // V3.8: helpers for library-scoped fan-out + merge.
    // _normaliseLibraryIds collapses an array selection to either:
    //   - null (all libraries, or empty/missing input, or full set)
    //   - a deduped array of ids (1..N-1 elements)
    // The "all libraries" check is performed by the caller (Settings) which
    // owns the canonical library list; this helper just compares against the
    // list it's handed.
    SubsonicAPI._normaliseLibraryIds = function(libraryIds, allLibraryIds) {
        if (!libraryIds || !libraryIds.length) return null;
        var seen = {};
        var deduped = [];
        for (var i = 0; i < libraryIds.length; i++) {
            var id = libraryIds[i];
            if (id === undefined || id === null) continue;
            if (!seen[id]) {
                seen[id] = true;
                deduped.push(id);
            }
        }
        if (!deduped.length) return null;
        if (allLibraryIds && allLibraryIds.length === deduped.length) {
            var allSeen = {};
            for (var j = 0; j < allLibraryIds.length; j++) {
                allSeen[allLibraryIds[j]] = true;
            }
            var allMatch = true;
            for (var k = 0; k < deduped.length; k++) {
                if (!allSeen[deduped[k]]) { allMatch = false; break; }
            }
            if (allMatch) return null;
        }
        return deduped;
    };

    // V3.8: merge helpers for fan-out responses.
    function _dedupeById(items) {
        var seen = {};
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it) continue;
            var id = it.id;
            if (id === undefined || id === null) {
                out.push(it);
                continue;
            }
            if (!seen[id]) {
                seen[id] = true;
                out.push(it);
            }
        }
        return out;
    }

    function _albumSortKeyForType(type) {
        if (type === 'newest') return 'created';
        if (type === 'recent') return 'played';
        if (type === 'frequent') return 'played';
        if (type === 'alphabeticalByArtist') return 'artist';
        if (type === 'alphabeticalByName') return 'name';
        if (type === 'starred') return 'starred';
        return 'name';
    }

    function _albumSortDescForType(type) {
        return type === 'newest' || type === 'recent' || type === 'frequent' || type === 'starred';
    }

    function _sortAlbums(albums, type) {
        var key = _albumSortKeyForType(type);
        var desc = _albumSortDescForType(type);
        albums.sort(function(a, b) {
            var av = a && a[key];
            var bv = b && b[key];
            if (av === bv) return 0;
            if (av === undefined || av === null) return 1;
            if (bv === undefined || bv === null) return -1;
            if (av < bv) return desc ? 1 : -1;
            return desc ? -1 : 1;
        });
        return albums;
    }

    function _mergeAlbumLists(perLibrary, type, size) {
        var combined = [];
        for (var i = 0; i < perLibrary.length; i++) {
            var arr = perLibrary[i];
            if (!arr || !arr.length) continue;
            for (var j = 0; j < arr.length; j++) combined.push(arr[j]);
        }
        combined = _dedupeById(combined);
        _sortAlbums(combined, type);
        if (size && combined.length > size) combined = combined.slice(0, size);
        return combined;
    }

    function _mergeArtistLists(perLibrary) {
        var combined = [];
        for (var i = 0; i < perLibrary.length; i++) {
            var arr = perLibrary[i];
            if (!arr || !arr.length) continue;
            for (var j = 0; j < arr.length; j++) combined.push(arr[j]);
        }
        combined = _dedupeById(combined);
        combined.sort(function(a, b) {
            var an = (a && a.name) || '';
            var bn = (b && b.name) || '';
            if (an === bn) return 0;
            return an < bn ? -1 : 1;
        });
        return combined;
    }

    function _mergeSongLists(perLibrary, cap) {
        var combined = [];
        for (var i = 0; i < perLibrary.length; i++) {
            var arr = perLibrary[i];
            if (!arr || !arr.length) continue;
            for (var j = 0; j < arr.length; j++) {
                combined.push(arr[j]);
                if (cap && combined.length >= cap) return combined;
            }
        }
        return combined;
    }

    function _mergeSearchResults(perLibrary) {
        var artists = [];
        var albums = [];
        var songs = [];
        for (var i = 0; i < perLibrary.length; i++) {
            var r = perLibrary[i];
            if (!r) continue;
            if (r.artist) artists = artists.concat(r.artist);
            if (r.album) albums = albums.concat(r.album);
            if (r.song) songs = songs.concat(r.song);
        }
        return {
            artist: _dedupeById(artists),
            album: _dedupeById(albums),
            song: _dedupeById(songs)
        };
    }

    function _normaliseScopeArg(libraryIds) {
        if (!libraryIds) return null;
        if (!libraryIds.length) return null;
        return libraryIds;
    }

    // --- Album List ---
    // types: 'recent', 'frequent', 'newest', 'random', 'alphabeticalByName', 'alphabeticalByArtist', 'starred'
    SubsonicAPI.prototype.getAlbumList2 = function(type, size, offset, libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = { type: type };
            if (size) params.size = size;
            if (offset) params.offset = offset;
            if (folderId !== undefined && folderId !== null) {
                params.musicFolderId = folderId;
            }
            return self._cachedRequest('getAlbumList2.view', params).then(function(data) {
                var list = data && data.albumList2;
                return _memoAlbumList(_ensureArray(list && list.album));
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            return _memoAlbumList(_mergeAlbumLists(perLibrary, type, size));
        });
    };

    // --- Single Album with tracks ---
    SubsonicAPI.prototype.getAlbum = function(id) {
        return this._cachedRequest('getAlbum.view', { id: id }).then(function(data) {
            var album = data && data.album;
            if (album && album.song) {
                album.song = _memoSongList(_ensureArray(album.song));
            }
            return album ? _memoAlbum(album) : null;
        });
    };

    // --- Artists (ID3-based) ---
    SubsonicAPI.prototype.getArtists = function(libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = null;
            if (folderId !== undefined && folderId !== null) {
                params = { musicFolderId: folderId };
            }
            return self._cachedRequest('getArtists.view', params).then(function(data) {
                var indices = data && data.artists && data.artists.index;
                if (!indices) return [];
                var artists = [];
                _ensureArray(indices).forEach(function(idx) {
                    _ensureArray(idx && idx.artist).forEach(function(a) {
                        artists.push(a);
                    });
                });
                return artists;
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            return _mergeArtistLists(perLibrary);
        });
    };

    // --- Single Artist ---
    SubsonicAPI.prototype.getArtist = function(id) {
        return this._cachedRequest('getArtist.view', { id: id }).then(function(data) {
            var artist = data && data.artist;
            if (artist && artist.album) {
                artist.album = _memoAlbumList(_ensureArray(artist.album));
            }
            return artist || null;
        });
    };

    // --- Artist Info (biography, images, similar artists) ---
    SubsonicAPI.prototype.getArtistInfo2 = function(id) {
        return this._cachedRequest('getArtistInfo2.view', { id: id }).then(function(data) {
            var info = data && data.artistInfo2;
            if (info && info.similarArtist) {
                info.similarArtist = _ensureArray(info.similarArtist);
            }
            return info || null;
        });
    };

    // --- Genres ---
    SubsonicAPI.prototype.getGenres = function() {
        return this._cachedRequest('getGenres.view').then(function(data) {
            var genres = data && data.genres;
            return _ensureArray(genres && genres.genre);
        });
    };

    // --- Playlists ---
    SubsonicAPI.prototype.getPlaylists = function() {
        return this._cachedRequest('getPlaylists.view').then(function(data) {
            var playlists = data && data.playlists;
            return _memoPlaylistList(_ensureArray(playlists && playlists.playlist));
        });
    };

    SubsonicAPI.prototype.getPlaylist = function(id) {
        return this._cachedRequest('getPlaylist.view', { id: id }).then(function(data) {
            var playlist = (data && data.playlist) || null;
            if (playlist) {
                _memoPlaylist(playlist);
                if (playlist.entry) {
                    playlist.entry = _memoSongList(_ensureArray(playlist.entry));
                }
            }
            return playlist;
        });
    };

    // --- Starred / Favourites ---
    SubsonicAPI.prototype.getStarred2 = function(libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = null;
            if (folderId !== undefined && folderId !== null) {
                params = { musicFolderId: folderId };
            }
            return self._cachedRequest('getStarred2.view', params).then(function(data) {
                var starred = data && data.starred2;
                return {
                    album: _memoAlbumList(_ensureArray(starred && starred.album)),
                    song: _memoSongList(_ensureArray(starred && starred.song)),
                    artist: _ensureArray(starred && starred.artist)
                };
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            var albums = [];
            var songs = [];
            var artists = [];
            for (var i = 0; i < perLibrary.length; i++) {
                var r = perLibrary[i];
                if (!r) continue;
                if (r.album) albums = albums.concat(r.album);
                if (r.song) songs = songs.concat(r.song);
                if (r.artist) artists = artists.concat(r.artist);
            }
            return {
                album: _memoAlbumList(_dedupeById(albums)),
                song: _memoSongList(_dedupeById(songs)),
                artist: _dedupeById(artists)
            };
        });
    };

    // --- Random Songs ---
    SubsonicAPI.prototype.getRandomSongs = function(size, libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = {};
            if (size) params.size = size;
            if (folderId !== undefined && folderId !== null) {
                params.musicFolderId = folderId;
            }
            return self._cachedRequest('getRandomSongs.view', params).then(function(data) {
                var songs = data && data.randomSongs;
                return _memoSongList(_ensureArray(songs && songs.song));
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            return _memoSongList(_mergeSongLists(perLibrary, size));
        });
    };

    // --- Search ---
    SubsonicAPI.prototype.search3 = function(query, params, libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var p = { query: query || '' };
            if (params) {
                Object.keys(params).forEach(function(key) {
                    p[key] = params[key];
                });
            }
            if (folderId !== undefined && folderId !== null) {
                p.musicFolderId = folderId;
            }
            return self._cachedRequest('search3.view', p).then(function(data) {
                var result = data && data.searchResult3;
                return {
                    artist: _ensureArray(result && result.artist),
                    album: _memoAlbumList(_ensureArray(result && result.album)),
                    song: _memoSongList(_ensureArray(result && result.song))
                };
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            var merged = _mergeSearchResults(perLibrary);
            merged.album = _memoAlbumList(merged.album);
            merged.song = _memoSongList(merged.song);
            return merged;
        });
    };

    // --- Songs By Genre ---
    SubsonicAPI.prototype.getSongsByGenre = function(genre, count, offset, libraryIds) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = { genre: genre };
            if (count) params.count = count;
            if (offset) params.offset = offset;
            if (folderId !== undefined && folderId !== null) {
                params.musicFolderId = folderId;
            }
            return self._cachedRequest('getSongsByGenre.view', params).then(function(data) {
                var songs = data && data.songsByGenre;
                return _memoSongList(_ensureArray(songs && songs.song));
            });
        }

        if (!scope) return fetchOne(null);
        if (scope.length === 1) return fetchOne(scope[0]);

        var promises = [];
        for (var i = 0; i < scope.length; i++) promises.push(fetchOne(scope[i]));
        return Promise.all(promises).then(function(perLibrary) {
            return _memoSongList(_mergeSongLists(perLibrary, count));
        });
    };

    // --- Music Folders (V3.8) ---
    SubsonicAPI.prototype.getMusicFolders = function() {
        return this._cachedRequest('getMusicFolders.view').then(function(data) {
            var folders = data && data.musicFolders;
            return _ensureArray(folders && folders.musicFolder);
        });
    };

    // --- Scrobble (not cached — write operation) ---
    SubsonicAPI.prototype.scrobble = function(id) {
        return this._request('scrobble.view', { id: id });
    };

    // --- Lyrics (OpenSubsonic) ---
    // Returns the raw subsonic-response. Use SonanceUtils.parseLyricsResponse to extract.
    SubsonicAPI.prototype.getLyricsBySongId = function(songId) {
        return this._cachedRequest('getLyricsBySongId.view', { id: songId });
    };

    // --- Star / Unstar (not cached — write operations) ---
    // type: 'song' | 'album' | 'artist' — selects which id param the server expects
    function _starParams(id, type) {
        if (type === 'album') return { albumId: id };
        if (type === 'artist') return { artistId: id };
        return { id: id };
    }

    SubsonicAPI.prototype.star = function(id, type) {
        return this._request('star.view', _starParams(id, type));
    };

    SubsonicAPI.prototype.unstar = function(id, type) {
        return this._request('unstar.view', _starParams(id, type));
    };

    // --- Static: clear cache ---
    SubsonicAPI.clearCache = function() {
        _cache = {};
        log('API', 'Cache cleared');
    };

    // V3.8: instance-level memory cache reset, used by App.applyLibraryChange.
    // Mirrors the static clearCache (the in-memory cache is shared across
    // instances) but exposed on the prototype so the orchestrator can call it
    // off whichever instance AuthManager hands back.
    SubsonicAPI.prototype.clearMemoryCache = function() {
        _cache = {};
        log('API', 'Memory cache cleared');
    };

    // V3.7-fix6: drop every localStorage entry for the supplied identity.
    // Called from AuthManager.logout so a different user can't see the prior
    // user's cached library.
    SubsonicAPI.clearLocalCache = function(username, serverUrl) {
        if (!username || !serverUrl) return;
        var prefix = LS_PREFIX + username + '|' + serverUrl.replace(/\/+$/, '') + '|';
        try {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(prefix) === 0) keys.push(k);
            }
            keys.forEach(function(k) { localStorage.removeItem(k); });
            if (keys.length) log('API', 'LS cache cleared (' + keys.length + ' entries)');
        } catch (e) { /* ignore */ }
    };

    return SubsonicAPI;
})();

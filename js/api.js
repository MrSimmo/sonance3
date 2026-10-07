/* ============================================
   Sonance — Subsonic API Client
   ============================================ */

var SubsonicAPI = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var error = SonanceUtils.error;

    // --- Response Cache ---
    // V3.9 T4: this was an unbounded object whose TTL was only checked on
    // read, so an expired entry stayed resident holding its parsed JSON for
    // the life of the session — 300 distinct calls measured 300 resident
    // entries with nothing ever evicted, both the first and the last still
    // served from memory. Insertion-ordered Map, LRU capped, expired entries
    // swept on write. Map is Chrome 38+, inside the Tizen 5.0 / Chromium 63
    // envelope.
    var _cache = new Map();        // memKey → { data, time }
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    var CACHE_MAX = 100;

    // V3.9 T7: memKey → the in-flight promise for that key. _cachedRequest
    // wrote the cache only in `.then`, so two concurrent identical calls both
    // opened a socket (js/starred.js:46 races js/screens/search.js:369 on
    // getStarred2). Entries are removed on settle, success or failure, so a
    // rejection cannot poison the map.
    var _inflight = {};

    // V3.9 T8: open fetches, so a logout or a library change can stop paying
    // for results nobody is going to read.
    var _openRequests = [];
    var REQUEST_TIMEOUT_MS = 10000;
    // v3.10 D150: getSimilarSongs2 only. Navidrome asks an external agent the
    // first time it sees an artist; live, that took 0.2-7.6 s (S7) and once
    // 26.8 s (S8), past the 10 s above, so "Start radio" never appeared.
    var SIMILAR_TIMEOUT_MS = 45000;

    function _cacheRead(key) {
        var hit = _cache.get(key);
        if (!hit) return null;
        if ((Date.now() - hit.time) >= CACHE_TTL) {
            _cache.delete(key);
            return null;
        }
        _cache.delete(key);   // LRU touch: re-insert at the young end
        _cache.set(key, hit);
        return hit;
    }

    function _cacheWrite(key, data, time) {
        var now = Date.now();
        // Full sweep rather than an early break: LRU touching moves a young
        // key past older ones, so insertion order no longer tracks `time`.
        // At CACHE_MAX = 100 this is 100 comparisons on a path that has just
        // finished a network round trip.
        _cache.forEach(function(entry, k) {
            if (entry && (now - entry.time) >= CACHE_TTL) _cache.delete(k);
        });
        _cache.delete(key);
        _cache.set(key, { data: data, time: time });
        while (_cache.size > CACHE_MAX) {
            _cache.delete(_cache.keys().next().value);
        }
    }

    function _forgetRequest(rec) {
        var i = _openRequests.indexOf(rec);
        if (i > -1) _openRequests.splice(i, 1);
    }

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

    // V3.9 T5: getArtists.view is the one allowlisted payload that scales with
    // library size — measured at 1 076 675 chars for the live server's 2493
    // artists, JSON.stringify'd and setItem'd synchronously, and stored once
    // per musicFolderId when the user scopes to several libraries. Against
    // Tizen's ~5 MB quota, seven scoped copies plus the unscoped one is enough
    // to fill it, after which _lsWrite's swallowed quota error killed the whole
    // localStorage tier permanently and silently.
    //
    // The UI reads only id / name / albumCount / coverArt off an artist (see
    // _renderArtistCard in js/screens/library.js); the alphabetical index
    // structure is kept because SubsonicAPI.getArtists parses it. Anything
    // else the server sends (artistImageUrl, musicBrainzId, sortName, roles…)
    // is dropped on the way into localStorage only — the in-memory cache and
    // the live response still carry the full object.
    var LS_ARTIST_FIELDS = ['id', 'name', 'albumCount', 'coverArt'];

    function _projectForLs(endpoint, data) {
        if (endpoint !== 'getArtists.view') return data;
        var indices = data && data.artists && data.artists.index;
        if (!indices) return data;
        var out = [];
        _ensureArray(indices).forEach(function(bucket) {
            var slim = [];
            _ensureArray(bucket && bucket.artist).forEach(function(a) {
                if (!a) return;
                var o = {};
                for (var f = 0; f < LS_ARTIST_FIELDS.length; f++) {
                    var field = LS_ARTIST_FIELDS[f];
                    if (a[field] !== undefined) o[field] = a[field];
                }
                slim.push(o);
            });
            out.push({ name: bucket && bucket.name, artist: slim });
        });
        return { artists: { index: out, ignoredArticles: data.artists.ignoredArticles } };
    }

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

    // V3.9 T2: stable auth salt.
    //
    // WHY: `_buildUrl` used to mint a fresh salt and recompute the md5 token on
    // every call, so `getCoverArtUrl` / `getStreamUrl` returned a different URL
    // for the same resource each time. Chromium's HTTP disk cache is keyed on
    // the URL, so it could never hit — measured at 0 disk-cache hits over a
    // reload, with 0 of 53 cover URLs reused (docs/perf-baseline.md §3). Every
    // cold launch refetched 100% of visible art, and any ImageCache eviction
    // guaranteed a refetch even though the bytes were already on disk.
    //
    // URL stability is therefore load-bearing for cover-art caching. Do NOT
    // reintroduce per-call salting. The salt is persisted per
    // (username + server) so it survives a cold launch, which is where the
    // refetch hurt most; the token is always recomputed from the current
    // password, so a password change needs no salt change. The Subsonic auth
    // scheme has no nonce and no replay protection, so salt reuse is
    // spec-legal and is what most clients do.
    var SALT_PREFIX = 'sonance_authsalt_v1__';

    function _stableSalt(username, serverUrl) {
        var key = SALT_PREFIX + username + '|' + serverUrl;
        try {
            var existing = localStorage.getItem(key);
            if (existing && /^[0-9a-f]{12}$/.test(existing)) return existing;
            var fresh = SonanceUtils.generateSalt(12);
            localStorage.setItem(key, fresh);
            return fresh;
        } catch (e) {
            // localStorage unavailable or full: a per-instance salt still fixes
            // the within-session churn, just not the cold-launch refetch.
            return SonanceUtils.generateSalt(12);
        }
    }

    function SubsonicAPI(config) {
        this.serverUrl = config.serverUrl.replace(/\/+$/, ''); // strip trailing slashes
        this.username = config.username;
        this.password = config.password;
        this.salt = _stableSalt(this.username, this.serverUrl);
        this.token = SonanceUtils.md5(this.password + this.salt);

        log('API', 'Initialized for ' + this.serverUrl + ' as ' + this.username);
    }

    // Build full URL with auth params
    SubsonicAPI.prototype._buildUrl = function(endpoint, params) {
        var url = this.serverUrl + '/rest/' + endpoint;
        var queryParts = [
            'u=' + encodeURIComponent(this.username),
            't=' + this.token,
            's=' + this.salt,
            'v=1.16.1',
            'c=Sonance',
            'f=json'
        ];

        if (params) {
            Object.keys(params).forEach(function(key) {
                var value = params[key];
                if (value === undefined || value === null) return;
                // v3.10 A8: an array is a repeated parameter (savePlayQueue's
                // `id`), which is how the Subsonic API takes a list.
                if (Array.isArray(value)) {
                    for (var i = 0; i < value.length; i++) {
                        queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value[i]));
                    }
                    return;
                }
                queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
            });
        }

        return url + '?' + queryParts.join('&');
    };

    // Fetch wrapper with error handling and timeout.
    //
    // V3.9 T8: two defects fixed here.
    //   1. `clearTimeout` fired on the response HEADERS, so a slow BODY had no
    //      timeout at all — a 30 s dripped body resolved after 29.6 s against
    //      a nominal 10 s limit. The timeout now spans the body as well.
    //   2. There was no AbortController anywhere, so a timed-out request kept
    //      running and held its socket, and a request whose result had been
    //      discarded still spent the bandwidth. Every request now carries one
    //      and is registered in `_openRequests` so abortAll() can cancel it.
    //
    // v3.10 A8: `opts.post` sends the same parameters, auth included, as a
    // form-encoded POST body instead of a query string (OpenSubsonic
    // `formPost`), for requests whose URL would be too long.
    // v3.10 D150: `opts.timeout` (ms) replaces REQUEST_TIMEOUT_MS for this call.
    SubsonicAPI.prototype._request = function(endpoint, params, opts) {
        var url = this._buildUrl(endpoint, params);
        var init = null;
        var timeoutMs = (opts && opts.timeout) || REQUEST_TIMEOUT_MS;
        if (opts && opts.post) {
            var q = url.indexOf('?');
            init = {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: url.slice(q + 1)
            };
            url = url.slice(0, q);
        }
        log('API', 'Request: ' + endpoint + (init ? ' (POST)' : ''));

        return new Promise(function(resolve, reject) {
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var settled = false;
            var rec = { endpoint: endpoint, controller: controller };
            _openRequests.push(rec);

            function done() {
                settled = true;
                clearTimeout(timeoutId);
                _forgetRequest(rec);
            }

            var timeoutId = setTimeout(function() {
                if (settled) return;
                done();
                if (controller) {
                    try { controller.abort(); } catch (e) { /* ignore */ }
                }
                error('API', endpoint + ' timed out after ' + timeoutMs + 'ms');
                reject(new Error('Request timed out. Check your server connection.'));
            }, timeoutMs);

            if (controller) {
                init = init || {};
                init.signal = controller.signal;
            }
            fetch(url, init || undefined).then(function(response) {
                if (!response.ok) {
                    throw new Error('Server returned HTTP ' + response.status);
                }
                return response.json();
            }).then(function(data) {
                if (settled) return;
                var subResponse = data['subsonic-response'];
                if (!subResponse) {
                    throw new Error('Invalid response from server');
                }
                if (subResponse.status !== 'ok') {
                    var errMsg = (subResponse.error && subResponse.error.message) || 'Unknown server error';
                    var errCode = (subResponse.error && subResponse.error.code) || 0;
                    throw new Error(errMsg + ' (code ' + errCode + ')');
                }
                done();
                resolve(subResponse);
            }).catch(function(err) {
                if (settled) return;   // already timed out or aborted
                done();
                error('API', endpoint + ' failed: ' + err.message);
                reject(err);
            });
        });
    };

    // V3.7-fix6: localStorage helpers (per-instance because they include
    // username + serverUrl in the key). Wrapped in try/catch so quota or
    // parse errors silently fall through to a fresh network request.
    // V3.9 T4: the in-memory key omitted username and serverUrl while the
    // localStorage key included both, so the two tiers disagreed and the
    // memory tier was shared across identities — after a logout and a login as
    // someone else inside the 5-minute TTL, the next user was served the
    // previous user's library (reproduced on the mock rig). Both keys are now
    // built from one function, and clearLocalCache's LS_PREFIX still matches.
    // NOTE: S6 T5's key sort can rename an existing localStorage entry whose
    // params were not already alphabetical; the orphan expires on LS_TTL or is
    // reclaimed by _lsPrune, so no cache is lost, only re-fetched once.
    // V3.9 S6 T5: JSON.stringify walks an object's own keys in insertion
    // order, so two call sites building the same logical params in a different
    // order (`{type,size}` vs `{size,type}`) produced two cache entries for one
    // request. That is a silent miss, never a wrong answer, but it is invisible
    // when it happens. Sorting the keys makes equal params produce equal keys.
    // Params are flat primitives at every call site; JSON.stringify handles the
    // value side, and an `undefined` value is skipped exactly as it would be.
    function _stableParams(params) {
        if (!params) return '{}';
        var keys = Object.keys(params).sort();
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            var v = params[keys[i]];
            if (v === undefined) continue;
            parts.push(JSON.stringify(keys[i]) + ':' + JSON.stringify(v));
        }
        return '{' + parts.join(',') + '}';
    }

    SubsonicAPI.prototype._memKey = function(endpoint, params) {
        return this.username + '|' + this.serverUrl +
               '|' + endpoint + '|' + _stableParams(params);
    };

    SubsonicAPI.prototype._lsKey = function(endpoint, params) {
        return LS_PREFIX + this._memKey(endpoint, params);
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

    // V3.9 T5: prune this app's own API-cache entries, largest first, when a
    // write hits the quota. Only keys under LS_PREFIX are touched — the
    // credentials, the auth salt and the library selection live under their
    // own prefixes and must survive. Returns the number of characters freed.
    function _lsPrune(exceptKey, needChars) {
        var freed = 0;
        try {
            var entries = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(LS_PREFIX) !== 0 || k === exceptKey) continue;
                entries.push({ key: k, len: (localStorage.getItem(k) || '').length });
            }
            entries.sort(function(a, b) { return b.len - a.len; });
            for (var j = 0; j < entries.length; j++) {
                localStorage.removeItem(entries[j].key);
                freed += entries[j].len;
                if (freed >= needChars) break;
            }
        } catch (e) { /* storage unavailable — nothing to do */ }
        if (freed) warn('API', 'LS quota: pruned ' + freed + ' chars');
        return freed;
    }

    SubsonicAPI.prototype._lsWrite = function(key, data, endpoint) {
        var payload;
        try {
            payload = JSON.stringify({ data: _projectForLs(endpoint, data), time: Date.now() });
        } catch (e) { return; }

        try {
            localStorage.setItem(key, payload);
            return;
        } catch (e) {
            // Quota. Before v3.9 this was swallowed and nothing pruned, so the
            // localStorage tier died permanently and silently the first time it
            // filled and every cold launch refetched everything from then on.
            if (!_lsPrune(key, payload.length)) return;
            try { localStorage.setItem(key, payload); }
            catch (e2) { warn('API', 'LS quota: still full after prune, skipping ' + endpoint); }
        }
    };

    // Cached request — returns cached data if within TTL.
    // Two tiers:
    //   1. In-memory _cache (5 min TTL) — within-session refresh.
    //   2. localStorage (24 h TTL, allowlist only) — survives cold launches
    //      and falls back to stale data on network failure.
    // `opts` is passed to _request (v3.10 D150: `opts.timeout`).
    SubsonicAPI.prototype._cachedRequest = function(endpoint, params, opts) {
        var self = this;
        var memKey = self._memKey(endpoint, params);
        var memCached = _cacheRead(memKey);
        if (memCached) {
            log('API', 'Cache hit: ' + endpoint);
            return Promise.resolve(memCached.data);
        }

        var lsAllowed = _isLsAllowlisted(endpoint, params);
        var lsKey = lsAllowed ? self._lsKey(endpoint, params) : null;

        if (lsKey) {
            var lsCached = self._lsRead(lsKey);
            if (lsCached && lsCached.data && (Date.now() - lsCached.time) < LS_TTL) {
                log('API', 'LS cache hit: ' + endpoint);
                _cacheWrite(memKey, lsCached.data, lsCached.time);
                return Promise.resolve(lsCached.data);
            }
        }

        // V3.9 T7: join an identical request that is already on the wire.
        var pending = _inflight[memKey];
        if (pending) {
            log('API', 'In-flight join: ' + endpoint);
            return pending;
        }

        var promise = self._request(endpoint, params, opts).then(function(data) {
            _cacheWrite(memKey, data, Date.now());
            if (lsKey) self._lsWrite(lsKey, data, endpoint);
            return data;
        }).catch(function(err) {
            // Offline fallback: serve stale localStorage data if we have it.
            if (lsKey) {
                var stale = self._lsRead(lsKey);
                if (stale && stale.data) {
                    warn('API', 'Stale cache served for ' + endpoint);
                    _cacheWrite(memKey, stale.data, stale.time);
                    return stale.data;
                }
            }
            throw err;
        });

        // Registered on the fully-built chain so a joiner sees the same result
        // the first caller does, stale-fallback included. Cleared on settle
        // either way, so a rejection cannot poison the map.
        _inflight[memKey] = promise;
        function forget() {
            if (_inflight[memKey] === promise) delete _inflight[memKey];
        }
        promise.then(forget, forget);

        return promise;
    };

    // --- Public Methods ---

    SubsonicAPI.prototype.ping = function() {
        return this._request('ping.view').then(function() {
            return { ok: true };
        });
    };

    SubsonicAPI.prototype.getStreamUrl = function(songId) {
        return this._buildUrl('stream.view', { id: songId });
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

    // v3.10 A2: `frequent` is ordered by play count (it was the `played`
    // timestamp, which is `recent`'s key), `byYear` by year, `byGenre` by
    // name. The Albums header pages every sort through these.
    function _albumSortKeyForType(type) {
        if (type === 'newest') return 'created';
        if (type === 'recent') return 'played';
        if (type === 'frequent') return 'playCount';
        if (type === 'byYear') return 'year';
        if (type === 'alphabeticalByArtist') return 'artist';
        if (type === 'alphabeticalByName') return 'name';
        if (type === 'starred') return 'starred';
        return 'name';
    }

    // byYear runs newest-first when fromYear > toYear, as the server does.
    function _albumSortDescForType(type, extra) {
        if (type === 'byYear') return !!(extra && extra.fromYear > extra.toYear);
        return type === 'newest' || type === 'recent' || type === 'frequent' || type === 'starred';
    }

    // V3.9 S4 T1: Navidrome orders alphabetical album lists by a normalised
    // sort name, not by code-point order. Measured against the live server's
    // seven libraries — 1 896 adjacent pairs of server-ordered names, counting
    // the pairs each candidate comparator would put the other way round:
    //
    //   code-point order (pre-v3.9)   161 inversions  8.49 %
    //   lowercase                     128             6.75 %
    //   lowercase + leading article     9             0.47 %   <- used
    //   localeCompare                 138             7.28 %
    //
    // For a single library the app shows the server's order untouched, so this
    // comparator only ever decided the order WITHIN one merged page. With a
    // k-way merge across per-library cursors it decides the whole presentation
    // order, and an 8.49 % disagreement is not cosmetic: under code-point
    // order the live server's largest library (2 989 albums) contributed none
    // of the first 1 250 merged albums, because its first page begins with
    // punctuation- and article-leading titles that sort late.
    var _LEADING_ARTICLE = /^(?:the|a|an|el|la|los|las|le|les|il|der|die|das)\s+/;

    // Only the two name-ish keys are normalised. `created` / `played` /
    // `starred` are timestamps and must compare raw.
    function _isNameSortKey(key) {
        return key === 'name' || key === 'artist';
    }

    function _albumSortValue(item, key, normalise) {
        var v = item && item[key];
        if (!normalise || typeof v !== 'string') return v;
        return v.toLowerCase().replace(_LEADING_ARTICLE, '');
    }

    // Hoisted out of _sortAlbums so AlbumListCursor's k-way merge orders items
    // with exactly the comparator _mergeAlbumLists uses. If the two ever
    // diverged, a paged merge would disagree with a single-shot one.
    function _compareBy(a, b, key, normalise, desc) {
        var av = _albumSortValue(a, key, normalise);
        var bv = _albumSortValue(b, key, normalise);
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        if (av < bv) return desc ? 1 : -1;
        return desc ? -1 : 1;
    }

    // v3.10 A2: items equal under a non-name key (an artist's albums, a
    // year, a play count) are ordered by name, so a k-way merge across
    // libraries is one total order: by name with the year, reversed with it
    // (Navidrome's byYear, measured on live in S5), ascending otherwise.
    // `year` and `playCount` are numbers and compare as numbers; timestamps
    // compare raw (D25).
    function _albumComparator(type, extra) {
        var key = _albumSortKeyForType(type);
        var desc = _albumSortDescForType(type, extra);
        var normalise = _isNameSortKey(key);
        var tieDesc = (type === 'byYear') ? desc : false;
        return function(a, b) {
            var c = _compareBy(a, b, key, normalise, desc);
            if (c !== 0 || key === 'name') return c;
            return _compareBy(a, b, 'name', true, tieDesc);
        };
    }

    function _sortAlbums(albums, type, extra) {
        albums.sort(_albumComparator(type, extra));
        return albums;
    }

    // V3.9 S4 T1: correct for a SINGLE non-paginated fan-out call, and only
    // for that. Concatenating each library's first `size` items, sorting, and
    // taking `size` is exactly the k-way merge of the first `size` items — so
    // home.js (6 newest / 6 recent), search.js (10) and settings.js (1) are
    // right. It breaks the moment a caller asks for the NEXT page, because the
    // items truncated here are never re-requested: see
    // SubsonicAPI.prototype.createAlbumListCursor.
    function _mergeAlbumLists(perLibrary, type, size, extra) {
        var combined = [];
        for (var i = 0; i < perLibrary.length; i++) {
            var arr = perLibrary[i];
            if (!arr || !arr.length) continue;
            for (var j = 0; j < arr.length; j++) combined.push(arr[j]);
        }
        combined = _dedupeById(combined);
        _sortAlbums(combined, type, extra);
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
    // types: 'recent', 'frequent', 'newest', 'random', 'alphabeticalByName', 'alphabeticalByArtist', 'starred',
    // v3.10 A2: 'byYear' (extra { fromYear, toYear }) and 'byGenre' (extra { genre }).
    SubsonicAPI.prototype.getAlbumList2 = function(type, size, offset, libraryIds, extra) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds);

        function fetchOne(folderId) {
            var params = { type: type };
            if (extra) {
                Object.keys(extra).forEach(function(k) { params[k] = extra[k]; });
            }
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
            return _memoAlbumList(_mergeAlbumLists(perLibrary, type, size, extra));
        });
    };

    // V3.9 S4 T1: paginating a multi-library fan-out through getAlbumList2 is
    // lossy and cannot be made safe statelessly. Each library is asked for
    // `size` items at the SAME shared offset, the merge keeps the `size`
    // best of the up-to-N×size fetched, and the next round advances every
    // library past what it already returned — so the truncated items are
    // never asked for again. Measured on the scale rig at 1200 albums:
    // 3 libraries reached 400 distinct albums, 7 libraries reached 200.
    //
    // AlbumListCursor keeps one offset per library and performs a real k-way
    // merge, advancing only the cursor whose head it consumed. A library whose
    // items lose every comparison keeps its buffer and is re-asked at the same
    // offset only once that buffer drains.
    //
    // WHY here and not in the screen: the merge has to order items with
    // _albumComparator, and it needs _cachedRequest / _memoAlbumList. The
    // screen owns the cursor INSTANCE (js/screens/library.js `_loadAlbums`,
    // where the old shared `apiOffset` lived); api.js owns the ordering.
    function AlbumListCursor(api, type, libraryIds, fetchSize, extra) {
        this._api = api;
        this._type = type;
        this._extra = extra || null;
        this._cmp = _albumComparator(type, extra);
        this._fetchSize = fetchSize > 0 ? fetchSize : 50;
        this._seen = {};
        this._libs = [];
        for (var i = 0; i < libraryIds.length; i++) {
            this._libs.push({
                id: libraryIds[i],
                buf: [],
                pos: 0,
                offset: 0,
                exhausted: false
            });
        }
    }

    // A one-element scope short-circuits getAlbumList2 to a plain per-library
    // request, so this does not re-enter the lossy merge.
    AlbumListCursor.prototype._fetchInto = function(lib) {
        var self = this;
        return this._api.getAlbumList2(this._type, this._fetchSize, lib.offset, [lib.id], this._extra)
            .then(function(albums) {
                // Re-sort the buffered page with our own comparator. The
                // server's collation is close to it but not identical (see
                // _albumComparator), and a k-way merge parks an entire library
                // behind a head that sorts late: on the live server library 1's
                // first page opens with a curly-quote title, which under any
                // client comparator loses to every ASCII title in the other six
                // libraries — so library 1 contributed 0 of the first 1 250
                // merged albums until this sort was added. A copy, because the
                // array belongs to the response held in `_cache`.
                lib.buf = (albums || []).slice();
                _sortAlbums(lib.buf, self._type, self._extra);
                lib.pos = 0;
                // Advance by what actually came back, not by fetchSize, so a
                // short page cannot skip items.
                lib.offset += lib.buf.length;
                if (lib.buf.length < self._fetchSize) lib.exhausted = true;
            });
    };

    // Refill every library that is drained and not exhausted, in parallel.
    // A drained library MUST be refilled before the next comparison — its
    // unfetched head may sort ahead of every buffered one.
    AlbumListCursor.prototype._fill = function() {
        var pending = [];
        for (var i = 0; i < this._libs.length; i++) {
            var lib = this._libs[i];
            if (lib.exhausted || lib.pos < lib.buf.length) continue;
            pending.push(this._fetchInto(lib));
        }
        if (!pending.length) return Promise.resolve();
        return Promise.all(pending);
    };

    /**
     * Emit the next `count` albums in merged order. Resolves with fewer than
     * `count` (possibly zero) only when every library is exhausted, which is
     * what PaginatedLoader reads as "no more pages".
     */
    AlbumListCursor.prototype.next = function(count) {
        var self = this;
        var out = [];
        if (!(count > 0)) return Promise.resolve(out);

        // Emit synchronously while every non-exhausted library has a buffered
        // head to compare; only a drained one costs a round trip, so a full
        // page normally costs one promise hop rather than `count` of them.
        function drain() {
            while (out.length < count) {
                var best = -1;
                var needFill = false;
                for (var i = 0; i < self._libs.length; i++) {
                    var lib = self._libs[i];
                    if (lib.pos >= lib.buf.length) {
                        if (!lib.exhausted) { needFill = true; break; }
                        continue;
                    }
                    if (best === -1) { best = i; continue; }
                    var cur = self._libs[best];
                    if (self._cmp(lib.buf[lib.pos], cur.buf[cur.pos]) < 0) best = i;
                }
                if (needFill) return false;
                if (best === -1) return true;   // all drained and exhausted
                var winner = self._libs[best];
                var item = winner.buf[winner.pos++];
                var id = item && item.id;
                if (id === undefined || id === null) {
                    out.push(item);
                } else if (!self._seen[id]) {
                    self._seen[id] = true;
                    out.push(item);
                }
            }
            return true;
        }

        function pump() {
            if (drain()) return Promise.resolve(out);
            return self._fill().then(pump);
        }
        return pump();
    };

    /**
     * Cursor over `type` across `libraryIds`, safe to paginate. A null/empty
     * or single-element scope yields a single stream, i.e. the same requests
     * the unscoped path makes today.
     */
    SubsonicAPI.prototype.createAlbumListCursor = function(type, libraryIds, fetchSize, extra) {
        var scope = _normaliseScopeArg(libraryIds);
        return new AlbumListCursor(this, type, scope || [null], fetchSize, extra);
    };

    /**
     * v3.10 A2: the exact length of an album list (the Albums header's
     * count), summed over the libraries in scope, by the same offset binary
     * search as the song lists (SongPager). Kept for CACHE_TTL.
     */
    SubsonicAPI.prototype.countAlbums = function(type, libraryIds, extra) {
        var self = this;
        var scope = _normaliseScopeArg(libraryIds) || [null];
        return Promise.all(scope.map(function(folderId) {
            var params = { type: type };
            if (extra) Object.keys(extra).forEach(function(k) { params[k] = extra[k]; });
            if (folderId !== null) params.musicFolderId = folderId;
            var key = self._memKey('getAlbumList2.view#count', params);
            var hit = _songTotals.get(key);
            if (hit && (Date.now() - hit.time) < CACHE_TTL) return hit.total;
            return _findTotal(function(offset) {
                var p = Object.assign({}, params, { size: 1, offset: offset });
                return self._request('getAlbumList2.view', p).then(function(data) {
                    var list = data && data.albumList2;
                    return _ensureArray(list && list.album).length > 0;
                });
            }, 0).then(function(total) {
                _songTotals.set(key, { total: total, time: Date.now() });
                return total;
            });
        })).then(function(totals) {
            var sum = 0;
            for (var i = 0; i < totals.length; i++) sum += totals[i];
            return sum;
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

    // --- Single song (v3.10 R7, credits) ---
    // On an OpenSubsonic server the song carries `contributors`,
    // `displayComposer`, `samplingRate`, `bitDepth`, `channelCount`… (the
    // credits panel's data; Navidrome 0.64.1 measured in S6).
    SubsonicAPI.prototype.getSong = function(id) {
        return this._cachedRequest('getSong.view', { id: id }).then(function(data) {
            return (data && data.song) ? _memoSongDuration(data.song) : null;
        });
    };

    // --- Similar songs (v3.10 A5, "Start radio from this song") ---
    // getSimilarSongs2 takes an artist id. Navidrome fills it from an
    // external agent (Last.fm and the like), so it may well be empty.
    SubsonicAPI.prototype.getSimilarSongs2 = function(artistId, count) {
        return this._cachedRequest('getSimilarSongs2.view', { id: artistId, count: count || 50 },
                { timeout: SIMILAR_TIMEOUT_MS }).then(function(data) {
            var list = data && data.similarSongs2;
            return _memoSongList(_ensureArray(list && list.song));
        });
    };

    // --- OpenSubsonic extensions (v3.10 A8) ---
    // Resolves to the extension names the server advertises ([] on a plain
    // Subsonic server, which answers this endpoint with an error). Asked once
    // per API instance: the answer cannot change within a session.
    SubsonicAPI.prototype.getOpenSubsonicExtensions = function() {
        if (!this._extensions) {
            this._extensions = this._cachedRequest('getOpenSubsonicExtensions.view').then(function(data) {
                return _ensureArray(data && data.openSubsonicExtensions).map(function(e) { return e && e.name; });
            }).catch(function() {
                return [];
            });
        }
        return this._extensions;
    };

    // --- Play queue (v3.10 A8, resume) ---
    // URLs longer than this go as a form POST (a 1,000-id queue is about
    // 26,000 characters of query string on Navidrome's 22-character ids).
    var PLAY_QUEUE_URL_MAX = 6000;

    // Saves `ids` with the current entry and the position in ms. Uses the
    // index-based call when the server advertises `indexBasedQueue`: the
    // classic call names the current entry by song id, which is ambiguous in
    // a queue that holds a song twice. Not cached: a write.
    SubsonicAPI.prototype.savePlayQueue = function(ids, currentIndex, positionMs) {
        var self = this;
        return this.getOpenSubsonicExtensions().then(function(ext) {
            var byIndex = ext.indexOf('indexBasedQueue') !== -1;
            var endpoint = byIndex ? 'savePlayQueueByIndex.view' : 'savePlayQueue.view';
            var params = byIndex
                ? { id: ids, currentIndex: currentIndex, position: positionMs }
                : { id: ids, current: ids[currentIndex], position: positionMs };
            var post = self._buildUrl(endpoint, params).length > PLAY_QUEUE_URL_MAX;
            return self._request(endpoint, params, post ? { post: true } : null).then(function() {
                return { byIndex: byIndex, post: post };
            });
        });
    };

    // Resolves to { entries, index, positionMs } for the saved queue, or null
    // when nothing is saved. Not cached: another device may have saved since.
    SubsonicAPI.prototype.getPlayQueue = function() {
        var self = this;
        return this.getOpenSubsonicExtensions().then(function(ext) {
            var byIndex = ext.indexOf('indexBasedQueue') !== -1;
            return self._request(byIndex ? 'getPlayQueueByIndex.view' : 'getPlayQueue.view').then(function(data) {
                var q = data && (byIndex ? data.playQueueByIndex : data.playQueue);
                var entries = _ensureArray(q && q.entry);
                if (!entries.length) return null;
                var index = 0;
                if (byIndex) {
                    index = parseInt(q.currentIndex, 10) || 0;
                } else if (q.current !== undefined) {
                    for (var i = 0; i < entries.length; i++) {
                        if (String(entries[i].id) === String(q.current)) { index = i; break; }
                    }
                }
                return {
                    entries: _memoSongList(entries),
                    index: Math.max(0, Math.min(index, entries.length - 1)),
                    positionMs: parseInt(q.position, 10) || 0
                };
            });
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

    // --- Song pager (v3.10 A1) ---
    // Random access into a song list the server pages by offset: Library →
    // Songs (search3 with an empty query, which v3.9 S6 measured to page
    // stably and completely) and a genre's songs (getSongsByGenre). The
    // screen shows the whole list at once (a virtual list), so it needs the
    // exact length up front and any page on demand; neither endpoint reports
    // a total.
    //
    // The total comes from a binary search on offsets with one-item probes,
    // about 2·log2(n) uncached requests per library: 24 for the live
    // server's 30,458 songs, 221 ms on the LAN (S5). getScanStatus.count is
    // no substitute: it counts the whole server (82,524 against the 30,458
    // this account sees). Totals are kept for CACHE_TTL.
    //
    // With two or more libraries in scope the list is each library's songs
    // in turn, server order within each, so a global offset maps to one
    // offset in one library. Sending the same offset to every library and
    // merging would skip items, as D23's album fan-out did.
    var SONG_LISTS = {
        all: {
            endpoint: 'search3.view', offsetParam: 'songOffset', countParam: 'songCount',
            params: function() { return { query: '', artistCount: 0, albumCount: 0 }; },
            pick: function(data) { return data && data.searchResult3 && data.searchResult3.song; }
        },
        genre: {
            endpoint: 'getSongsByGenre.view', offsetParam: 'offset', countParam: 'count',
            params: function(genre) { return { genre: genre }; },
            pick: function(data) { return data && data.songsByGenre && data.songsByGenre.song; }
        }
    };
    var _songTotals = new Map();   // memKey of the list → { total, time }

    // The length of a list the server pages by offset, given has(offset) →
    // Promise<boolean> and `lo`, a count known to exist. `up` doubles until
    // an offset is empty; `down` bisects [lo, hi] where offset hi is empty.
    function _findTotal(has, lo) {
        function up(hi) {
            return has(hi).then(function(yes) {
                if (!yes) return down(hi);
                lo = hi + 1;
                return up(hi * 2);
            });
        }
        function down(hi) {
            if (lo >= hi) return lo;
            var mid = Math.floor((lo + hi) / 2);
            return has(mid).then(function(yes) {
                if (yes) lo = mid + 1; else hi = mid;
                return down(hi);
            });
        }
        if (lo >= 1) return up(lo * 2);
        return has(0).then(function(any) {
            if (!any) return 0;
            lo = 1;
            return up(2);
        });
    }

    function SongPager(api, kind, arg, libraryIds, pageSize) {
        this._api = api;
        this._spec = SONG_LISTS[kind];
        this._arg = arg;
        this.pageSize = pageSize > 0 ? pageSize : 100;
        this.total = -1;
        var scope = _normaliseScopeArg(libraryIds) || [null];
        this._segs = scope.map(function(id) { return { id: id, start: 0, total: 0 }; });
    }

    SongPager.prototype._params = function(seg, offset, count) {
        var p = this._spec.params(this._arg);
        if (offset !== null) p[this._spec.offsetParam] = offset;
        if (count !== null) p[this._spec.countParam] = count;
        if (seg.id !== null) p.musicFolderId = seg.id;
        return p;
    };

    SongPager.prototype._fetch = function(seg, offset, count) {
        var self = this;
        return this._api._cachedRequest(this._spec.endpoint, this._params(seg, offset, count))
            .then(function(data) { return _memoSongList(_ensureArray(self._spec.pick(data))); });
    };

    // Is there a song at `offset`? Uncached: 24 one-item answers would push
    // real pages out of the 100-entry response cache.
    SongPager.prototype._has = function(seg, offset) {
        var self = this;
        return this._api._request(this._spec.endpoint, this._params(seg, offset, 1))
            .then(function(data) { return _ensureArray(self._spec.pick(data)).length > 0; });
    };

    SongPager.prototype._segTotal = function(seg) {
        var self = this;
        var key = this._api._memKey(this._spec.endpoint, this._params(seg, null, null));
        var hit = _songTotals.get(key);
        if (hit && (Date.now() - hit.time) < CACHE_TTL) return Promise.resolve(hit.total);
        // The first page is wanted anyway, and a short one is the answer.
        return this._fetch(seg, 0, this.pageSize).then(function(first) {
            if (first.length < self.pageSize) return first.length;
            return _findTotal(function(offset) { return self._has(seg, offset); }, first.length);
        }).then(function(total) {
            _songTotals.set(key, { total: total, time: Date.now() });
            return total;
        });
    };

    /** The list's length (also left on `.total`). */
    SongPager.prototype.count = function() {
        var self = this;
        return Promise.all(this._segs.map(function(seg) { return self._segTotal(seg); }))
            .then(function(totals) {
                var start = 0;
                for (var i = 0; i < self._segs.length; i++) {
                    self._segs[i].start = start;
                    self._segs[i].total = totals[i];
                    start += totals[i];
                }
                self.total = start;
                return start;
            });
    };

    /** Songs [from, to) of the whole list, in order. Call after count(). */
    SongPager.prototype.range = function(from, to) {
        var parts = [];
        for (var i = 0; i < this._segs.length; i++) {
            var seg = this._segs[i];
            var a = Math.max(from, seg.start);
            var b = Math.min(to, seg.start + seg.total);
            if (a < b) parts.push(this._fetch(seg, a - seg.start, b - a));
        }
        return Promise.all(parts).then(function(lists) {
            var out = [];
            for (var j = 0; j < lists.length; j++) out = out.concat(lists[j]);
            return out;
        });
    };

    /**
     * kind 'all' (Library → Songs) or 'genre' (arg = the genre name).
     * Same scope rules as every other call: null / [] = all libraries.
     */
    SubsonicAPI.prototype.createSongPager = function(kind, arg, libraryIds, pageSize) {
        return new SongPager(this, kind, arg, libraryIds, pageSize);
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
        _cache = new Map();
        _inflight = {};
        _songTotals.clear();
        log('API', 'Cache cleared');
    };

    // V3.9 T4: the acceptance evidence for the cache bound, and the sibling of
    // ImageCache.size(). Diagnostic only.
    SubsonicAPI.cacheSize = function() {
        return _cache.size;
    };

    // V3.9 T8: cancel every request still on the wire. Called where the result
    // is certain to be unwanted AND the caches are being emptied anyway —
    // AuthManager.logout and App.applyLibraryChange.
    SubsonicAPI.abortAll = function() {
        var open = _openRequests.slice();
        _openRequests.length = 0;
        for (var i = 0; i < open.length; i++) {
            if (open[i].controller) {
                try { open[i].controller.abort(); } catch (e) { /* ignore */ }
            }
        }
        if (open.length) log('API', 'Aborted ' + open.length + ' in-flight request(s)');
        return open.length;
    };

    // V3.8: instance-level memory cache reset, used by App.applyLibraryChange.
    // Mirrors the static clearCache (the in-memory cache is shared across
    // instances) but exposed on the prototype so the orchestrator can call it
    // off whichever instance AuthManager hands back.
    SubsonicAPI.prototype.clearMemoryCache = function() {
        _cache = new Map();
        _inflight = {};
        _songTotals.clear();
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

/* ============================================
   Sonance — Starred (Favourites) Cache
   In-memory mirror of the Subsonic getStarred2 response.
   Optimistic toggles roll back on network error.
   ============================================ */

var StarredCache = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;

    var _songs = {};
    var _albums = {};
    var _artists = {};
    var _listeners = [];

    function _emitChange(kind, id, starred) {
        for (var i = 0; i < _listeners.length; i++) {
            try {
                _listeners[i](kind, id, starred);
            } catch (e) {
                warn('Starred', 'Listener error: ' + e.message);
            }
        }
    }

    function on(fn) {
        if (typeof fn === 'function') _listeners.push(fn);
    }

    function off(fn) {
        _listeners = _listeners.filter(function(f) { return f !== fn; });
    }

    function load(api) {
        if (!api || typeof api.getStarred2 !== 'function') {
            return Promise.reject(new Error('No API'));
        }
        // V3.8: scope the favourites cache to the user's library selection
        // so deselected libraries' starred items don't appear as starred
        // until a re-select.
        var libraryIds = (typeof AuthManager !== 'undefined' && AuthManager.getSelectedLibraries)
            ? AuthManager.getSelectedLibraries()
            : null;
        return api.getStarred2(libraryIds).then(function(data) {
            _songs = {};
            _albums = {};
            _artists = {};
            if (data.song) {
                data.song.forEach(function(s) { if (s && s.id) _songs[s.id] = true; });
            }
            if (data.album) {
                data.album.forEach(function(a) { if (a && a.id) _albums[a.id] = true; });
            }
            if (data.artist) {
                data.artist.forEach(function(a) { if (a && a.id) _artists[a.id] = true; });
            }
            log('Starred', 'Loaded: ' +
                Object.keys(_songs).length + ' songs, ' +
                Object.keys(_albums).length + ' albums, ' +
                Object.keys(_artists).length + ' artists');
        });
    }

    function isSongStarred(id)  { return !!_songs[id]; }
    function isAlbumStarred(id) { return !!_albums[id]; }
    function isArtistStarred(id) { return !!_artists[id]; }

    function _toggle(map, kind, id, api) {
        var wasStarred = !!map[id];
        if (wasStarred) {
            delete map[id];
        } else {
            map[id] = true;
        }
        _emitChange(kind, id, !wasStarred);

        var call = wasStarred ? api.unstar(id, kind) : api.star(id, kind);
        call.catch(function(err) {
            warn('Starred', kind + ' toggle failed (' + id + '): ' + (err && err.message));
            if (wasStarred) {
                map[id] = true;
            } else {
                delete map[id];
            }
            _emitChange(kind, id, wasStarred);
        });
        return !wasStarred;
    }

    function toggleSong(id, api)   { return _toggle(_songs,   'song',   id, api); }
    function toggleAlbum(id, api)  { return _toggle(_albums,  'album',  id, api); }
    function toggleArtist(id, api) { return _toggle(_artists, 'artist', id, api); }

    function clear() {
        _songs = {};
        _albums = {};
        _artists = {};
    }

    return {
        load: load,
        isSongStarred: isSongStarred,
        isAlbumStarred: isAlbumStarred,
        isArtistStarred: isArtistStarred,
        toggleSong: toggleSong,
        toggleAlbum: toggleAlbum,
        toggleArtist: toggleArtist,
        on: on,
        off: off,
        clear: clear
    };
})();

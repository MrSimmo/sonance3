/* ============================================
   Sonance — Track options sheet (v3.10 A5)
   Opened by holding OK on a track row or an Up Next tile (FocusManager's
   onLongPress, js/focus.js). A right-side panel over a scrim, with its own
   isolated focus zone. docs/UI-MOCKUP-REFERENCE.md "Options sheet".
   ============================================ */

var OptionsSheet = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;

    var ZONE = 'options-sheet';
    // "Start radio" is offered only with this many similar songs (ticket A5).
    var RADIO_MIN = 5;
    var RADIO_COUNT = 50;

    var _root = null;       // .options-sheet (scrim + panel), in #app
    var _body = null;       // the scrolling list: actions or credit rows
    var _bodyView = null;   // fix2 F3: SonanceComponents.createScrollView over _body
    var _items = [];        // the zone's elements, in order
    var _actions = [];      // the action list behind _items (actions view)
    var _ctx = null;        // { song, origin, queueIndex, onStar }
    var _originEl = null;   // the row it opened on, marked under the scrim
    var _view = 'actions';  // 'actions' | 'credits'
    // A getSimilarSongs2, getSong or getAlbum answer for a sheet that has
    // since closed (or reopened on another row) is dropped.
    var _gen = 0;
    // Similar songs per artist id, for the session: holding OK on the same
    // artist's rows asks once.
    var _similar = {};

    function _api() {
        return (typeof App !== 'undefined' && App.getApi) ? App.getApi() : null;
    }

    function isOpen() {
        return !!_root;
    }

    /**
     * Open the sheet for ctx.song. ctx: { song, queueIndex (queue rows: Play
     * now and Remove from queue), onStar(starred) (the caller's own star
     * icon), origin ({ zone, index }; default: the current focus, where Back
     * returns) }.
     */
    function open(ctx) {
        if (!ctx || !ctx.song) return;
        close(false);
        _gen++;
        _ctx = ctx;
        if (!_ctx.origin) _ctx.origin = FocusManager.snapshot();
        // Mockup 17: the row stays marked behind the scrim.
        _originEl = FocusManager.getCurrentFocused();
        if (_originEl) _originEl.classList.add('is-options-origin');
        _build();
        _showActions(0);
        _askSimilar(_gen);
        log('Options', 'Opened for ' + (ctx.song.title || ctx.song.id));
    }

    /** Close; `restoreFocus` puts the focus back on the row it came from. */
    function close(restoreFocus) {
        if (!_root) return;
        if (_root.parentNode) _root.parentNode.removeChild(_root);
        _root = null;
        if (_originEl) _originEl.classList.remove('is-options-origin');
        _originEl = null;
        _body = null;
        _bodyView = null;
        _items = [];
        _actions = [];
        _view = 'actions';
        _gen++;
        FocusManager.unregisterZone(ZONE);
        var origin = _ctx && _ctx.origin;
        _ctx = null;
        if (!restoreFocus) return;
        if (origin && FocusManager.hasZone(origin.zone)) {
            FocusManager.setActiveZone(origin.zone, origin.index, true);
        } else if (typeof App !== 'undefined' && App.returnToTopNav) {
            App.returnToTopNav();
        }
    }

    /** App.goBack: the credits view goes back to the actions, else close. */
    function handleBack() {
        if (!_root) return false;
        if (_view === 'credits') {
            _showActions(_indexOf('credits'));
        } else {
            close(true);
        }
        return true;
    }

    // =========================================
    //  Build
    // =========================================

    function _build() {
        var song = _ctx.song;
        _root = el('div', { className: 'options-sheet', id: 'options-sheet' });
        var panel = el('div', { className: 'options-sheet-panel' });

        var header = el('div', { className: 'options-sheet-header' });
        var art = el('div', { className: 'options-sheet-art' });
        var cover = song.coverArt || song.albumId;
        if (cover && _api()) {
            var img = document.createElement('img');
            img.setAttribute('alt', '');
            // The small-thumb bucket (D70): the row's own thumbnail URL.
            img.src = ImageCache.getUrl(cover, SonanceUtils.artSize(100));
            img.onerror = function() { if (img.parentNode) img.parentNode.removeChild(img); };
            art.appendChild(img);
        }
        header.appendChild(art);
        var text = el('div', { className: 'options-sheet-head-text' });
        text.appendChild(el('div', { className: 'options-sheet-title' }, song.title || 'Unknown'));
        text.appendChild(el('div', { className: 'options-sheet-artist' }, song.artist || 'Unknown artist'));
        header.appendChild(text);
        panel.appendChild(header);

        _body = el('div', { className: 'options-sheet-body' });
        _bodyView = SonanceComponents.createScrollView(_body);
        panel.appendChild(_bodyView.root);
        _root.appendChild(panel);
        var host = document.getElementById('app') || document.body;
        host.appendChild(_root);

        // Isolated: nothing leaves the sheet but Back (and the actions).
        FocusManager.registerZone(ZONE, {
            getElements: function() { return _items; },
            columns: 1,
            onActivate: function(idx) {
                if (_view === 'actions' && _actions[idx]) _run(_actions[idx]);
            },
            onFocus: function(idx, element) {
                // The credits view's one stop is the body itself.
                if (element !== _body) SonanceUtils.revealInScroller(element, _body, SonanceUtils.px(12));
            },
            onKey: function(direction) {
                if (direction === 'left' || direction === 'right') return true;
                // fix2 F3 (D154): the credits view scrolls; it has no rows to
                // move between, and nothing to leave to.
                if (_view === 'credits') {
                    if (direction === 'up' || direction === 'down') _bodyView.step(direction);
                    return true;
                }
                var idx = (FocusManager.snapshot() || {}).index || 0;
                if (direction === 'up' && idx === 0) return true;
                if (direction === 'down' && idx >= _items.length - 1) return true;
                return false;
            },
            neighbors: {}
        });
    }

    // =========================================
    //  Actions
    // =========================================

    // The closures keep their own ctx: _run closes the sheet (clearing _ctx)
    // before it runs an action.
    function _actionList() {
        var ctx = _ctx;
        var song = ctx.song;
        var onQueue = typeof ctx.queueIndex === 'number';
        var list = [];
        if (onQueue) {
            list.push({ id: 'play-now', label: 'Play now', icon: 'play', run: function() {
                Player.jumpToQueueIndex(ctx.queueIndex);
            } });
        }
        list.push({ id: 'play-next', label: 'Play next', icon: 'skipNext', run: function() {
            Player.addToQueueNext(song);
            App.showToast('Playing next');
        } });
        list.push({ id: 'add-to-queue', label: 'Add to queue', icon: 'queue', run: function() {
            Player.addToQueue(song);
            App.showToast('Added to queue');
        } });
        var starred = typeof StarredCache !== 'undefined' && StarredCache.isSongStarred(song.id);
        list.push({ id: 'favourite', label: starred ? 'Remove from favourites' : 'Add to favourites', icon: 'star', run: function() {
            var api = _api();
            if (!api) return;
            var now = StarredCache.toggleSong(song.id, api);
            App.showToast(now ? 'Added to favourites' : 'Removed from favourites');
            if (ctx.onStar) ctx.onStar(now);
        } });
        if (song.albumId) {
            list.push({ id: 'album', label: 'Go to album', icon: 'album', nav: true, run: function() {
                App.navigateTo('album', { id: song.albumId, title: song.album || '' }, 'zoom-in');
            } });
        }
        if (song.artistId) {
            list.push({ id: 'artist', label: 'Go to artist', icon: 'artist', nav: true, run: function() {
                App.navigateTo('artist', { id: song.artistId }, 'zoom-in');
            } });
        }
        var similar = song.artistId ? _similar[song.artistId] : null;
        if (similar && similar.length >= RADIO_MIN) {
            list.push({ id: 'radio', label: 'Start radio from this song', icon: 'radio', run: function() {
                var queue = [song];
                similar.forEach(function(s) { if (s.id !== song.id) queue.push(s); });
                Player.playAlbum(queue, 0);
            } });
        }
        list.push({ id: 'credits', label: 'Show credits', icon: 'info', stay: true, run: _showCredits });
        if (onQueue) {
            list.push({ id: 'remove', label: 'Remove from queue', icon: 'remove', run: function() {
                Player.removeFromQueue(ctx.queueIndex);
                App.showToast('Removed from queue');
            } });
        }
        return list;
    }

    function _indexOf(id) {
        for (var i = 0; i < _actions.length; i++) if (_actions[i].id === id) return i;
        return 0;
    }

    // An action either changes the sheet (credits) or closes it, putting the
    // focus back on the row first: so Play now's auto Now Playing, or Go to
    // album's zoom, starts from the row, and Back from the album returns to it.
    function _run(action) {
        if (action.stay) {
            action.run();
            return;
        }
        close(true);
        if (action.nav && App.saveCurrentFocus) App.saveCurrentFocus();
        action.run();
    }

    function _showActions(focusIndex) {
        _view = 'actions';
        _actions = _actionList();
        _root.classList.remove('credits-view');
        _body.textContent = '';
        _body.scrollTop = 0;
        _items = _actions.map(function(a) {
            var row = el('div', { className: 'options-sheet-item focusable', 'data-action': a.id });
            var icon = SonanceUtils.createSvg(SonanceUtils.SVG_PATHS[a.icon]);
            icon.setAttribute('class', 'options-sheet-icon');
            row.appendChild(icon);
            row.appendChild(el('span', { className: 'options-sheet-label' }, a.label));
            row.addEventListener('click', function() { _run(a); });
            _body.appendChild(row);
            return row;
        });
        FocusManager.setActiveZone(ZONE, Math.min(focusIndex || 0, _items.length - 1), true);
    }

    // Start radio appears when getSimilarSongs2 has answered with enough;
    // the focus stays on the action it was on. Navidrome asks an external
    // agent the first time it sees an artist: 0.2-7.6 s on the live server
    // (S7), once 26.8 s (S8), so the row often appears a few seconds after
    // the sheet. A failure (or the call's 45 s timeout, D150) is not
    // remembered: the next sheet for that artist asks again.
    function _askSimilar(gen) {
        var song = _ctx.song, api = _api();
        if (!song.artistId || !api || !api.getSimilarSongs2 || _similar[song.artistId]) return;
        var artistId = song.artistId;
        api.getSimilarSongs2(artistId, RADIO_COUNT).then(function(songs) {
            _similar[artistId] = _inScope(songs || []);
            if (gen !== _gen || _view !== 'actions' || _similar[artistId].length < RADIO_MIN) return;
            var current = _actions[(FocusManager.snapshot() || {}).index || 0];
            _showActions(0);
            if (current) FocusManager.setActiveZone(ZONE, _indexOf(current.id), true);
        }).catch(function(err) {
            log('Options', 'getSimilarSongs2 failed: ' + (err && err.message));
        });
    }

    // The user's library selection (V3.8), as the playlists filter it: songs
    // with no musicFolderId are kept.
    function _inScope(songs) {
        var ids = (typeof AuthManager !== 'undefined' && AuthManager.getSelectedLibraries)
            ? AuthManager.getSelectedLibraries() : null;
        if (!ids || !ids.length) return songs;
        var allowed = {};
        ids.forEach(function(id) { allowed[String(id)] = true; });
        return songs.filter(function(s) {
            return s.musicFolderId === undefined || s.musicFolderId === null || !!allowed[String(s.musicFolderId)];
        });
    }

    // =========================================
    //  Credits (R7's renderer)
    // =========================================

    // The track's own fields at once, then getSong's and the album's as they
    // answer (both cached 5 min by the API), as Now Playing does (D116).
    // fix2 F3 (D154, D155): the body is the view's one focus stop (no row
    // is highlighted); Up/Down scroll it, and a redraw keeps the position.
    function _showCredits() {
        var gen = _gen;
        var song = _ctx.song;
        var full = song, album = null;
        _view = 'credits';
        _root.classList.add('credits-view');
        function draw() {
            var top = _body.scrollTop;
            _body.textContent = '';
            SonanceComponents.renderCreditSections(_body,
                SonanceComponents.creditSections(full, album));
            _body.scrollTop = top;
            _bodyView.measure();
            _items = [_body];
            FocusManager.setActiveZone(ZONE, 0, true);
        }
        _body.scrollTop = 0;
        draw();
        var api = _api();
        if (!api) return;
        function redraw() {
            if (gen !== _gen || _view !== 'credits') return;
            draw();
        }
        api.getSong(song.id).then(function(s) { if (s) { full = s; redraw(); } }).catch(function() {});
        if (song.albumId) {
            api.getAlbum(song.albumId).then(function(a) { if (a) { album = a; redraw(); } }).catch(function() {});
        }
    }

    return {
        open: open,
        close: close,
        isOpen: isOpen,
        handleBack: handleBack
    };
})();

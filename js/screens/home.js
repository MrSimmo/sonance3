/* ============================================
   Sonance — Home Screen
   Hero banner, recently played, playlists
   ============================================ */

var HomeScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var rem = SonanceUtils.rem;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _heroAlbum = null;
    var _newestAlbums = [];
    var _recentAlbums = [];
    var _playlists = [];
    // v3.10 A4: whether the hero/newest/recent/playlists data has landed (the
    // extra rows below may land before or after it).
    var _mainLoaded = false;
    // v3.10 A4: extra-row requests not answered yet (extraRowsPending()).
    var _extraPending = 0;
    // v3.10 D88: activation generation. A data response for an activation
    // that has ended (no input lock since D52, so Home can be left before
    // its data lands) must not render or register zones under the next screen.
    var _gen = 0;

    // v3.10 A4 (mockup 18): rows that load after the first paint, each shown
    // only when its list comes back non-empty. `before` is the section they
    // sit above: favourites and most played after Recently Played, Rediscover
    // last (D131).
    var EXTRA_ROWS = [
        { key: 'favourites', type: 'starred', title: 'Your favourites', before: 'home-playlists-section' },
        { key: 'frequent', type: 'frequent', title: 'Most played', before: 'home-playlists-section' },
        { key: 'rediscover', type: 'random', title: 'Rediscover', before: null }
    ];
    var EXTRA_ROW_SIZE = 6;

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.home-screen');
        if (!container || !element) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + SonanceUtils.px(20);
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - SonanceUtils.px(20);
        }
        _scrollRowToFocused(element);
    }

    // v3.10 R4, D68: the rows are horizontal carousels (.home-row,
    // overflow-x: auto). Up to 150 % every row fits and this never scrolls;
    // at 175 % and 200 % six cards are wider than the screen, so the focused
    // card is brought inside the row's padding box. The card's centre is
    // read from its rect (it scales about its centre, so the centre does not
    // move while the focus transition runs) and its half-width from layout.
    // Instant on purpose: the row's CSS `scroll-behavior: smooth` would make
    // this a compositor-driven smooth scroll, which ships only behind the
    // Advanced flag until seen on the TV (D58).
    function _scrollRowToFocused(element) {
        var row = element.closest ? element.closest('.home-row') : null;
        if (!row || row.scrollWidth <= row.clientWidth) return;
        var rr = row.getBoundingClientRect();
        var er = element.getBoundingClientRect();
        var centre = (er.left + er.right) / 2;
        var half = element.offsetWidth / 2;
        var pad = SonanceUtils.px(20);   // the row's 2rem side padding (D76)
        var delta = 0;
        if (centre + half > rr.right - pad) delta = centre + half - (rr.right - pad);
        else if (centre - half < rr.left + pad) delta = centre - half - (rr.left + pad);
        if (!delta) return;
        var target = row.scrollLeft + delta;
        try {
            row.scrollTo({ left: target, behavior: 'instant' });
        } catch (e) {
            row.scrollLeft = target;
        }
    }

    // =========================================
    //  Render (builds DOM with loading skeletons)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'home-screen' });

        // Hero banner — loading skeleton
        var hero = el('div', { className: 'home-hero', id: 'home-hero' });
        var heroSkeleton = el('div', { className: 'skeleton home-hero-skeleton' });
        hero.appendChild(heroSkeleton);
        wrapper.appendChild(hero);

        // Recently Added section (P4.9)
        var newestSection = el('div', { className: 'home-section' });
        newestSection.appendChild(el('div', { className: 'home-section-heading' }, 'Recently Added'));
        var newestRow = el('div', { className: 'home-row', id: 'home-newest-row' });
        newestRow.appendChild(SonanceComponents.renderSkeletonCards(6, 162, 220, 'skeleton-card'));
        newestSection.appendChild(newestRow);
        wrapper.appendChild(newestSection);

        // Recently Played section
        var recentSection = el('div', { className: 'home-section' });
        recentSection.appendChild(el('div', { className: 'home-section-heading', id: 'home-recent-heading' }, 'Recently Played'));
        var recentRow = el('div', { className: 'home-row', id: 'home-recent-row' });
        recentRow.appendChild(SonanceComponents.renderSkeletonCards(6, 162, 220, 'skeleton-card'));
        recentSection.appendChild(recentRow);
        wrapper.appendChild(recentSection);

        // v3.10 A4: the extra rows' sections, empty and hidden until their
        // lists arrive (_renderExtraRow).
        var extraSections = {};
        EXTRA_ROWS.forEach(function(row) {
            var section = el('div', { className: 'home-section', id: 'home-' + row.key + '-section' });
            section.style.display = 'none';
            section.appendChild(el('div', { className: 'home-section-heading' }, row.title));
            var rowEl = el('div', { className: 'home-row', id: 'home-' + row.key + '-row' });
            rowEl.addEventListener('click', _onAlbumRowClick);
            section.appendChild(rowEl);
            extraSections[row.key] = section;
        });
        wrapper.appendChild(extraSections.favourites);
        wrapper.appendChild(extraSections.frequent);

        // Your Playlists section
        var playlistSection = el('div', { className: 'home-section', id: 'home-playlists-section' });
        playlistSection.appendChild(el('div', { className: 'home-section-heading' }, 'Your Playlists'));
        var playlistRow = el('div', { className: 'home-row', id: 'home-playlists-row' });
        playlistRow.appendChild(SonanceComponents.renderSkeletonCards(4, 162, 220, 'skeleton-card'));
        playlistSection.appendChild(playlistRow);
        wrapper.appendChild(playlistSection);
        wrapper.appendChild(extraSections.rediscover);

        container.appendChild(wrapper);

        // V3.7-fix10: one delegated click listener per row container; cards
        // carry data-album-id / data-playlist-id so we can navigate without
        // a per-card listener.
        newestRow.addEventListener('click', _onAlbumRowClick);
        recentRow.addEventListener('click', _onAlbumRowClick);
        playlistRow.addEventListener('click', _onPlaylistRowClick);

        log('Home', 'Home screen rendered (loading state)');
    }

    function _onAlbumRowClick(ev) {
        var card = ev.target.closest('.album-card');
        if (!card) return;
        var id = card.getAttribute('data-album-id');
        if (!id) return;
        var title = card.getAttribute('data-album-title') || '';
        App.navigateTo('album', { id: id, title: title }, 'zoom-in');
    }

    function _onPlaylistRowClick(ev) {
        var card = ev.target.closest('.playlist-card');
        if (!card) return;
        var id = card.getAttribute('data-playlist-id');
        if (!id) return;
        App.navigateTo('playlists', { id: id }, 'zoom-in');
    }

    // =========================================
    //  Activate (fetch data and populate)
    // =========================================

    function activate(params) {
        var api = App.getApi();
        if (!api) {
            log('Home', 'No API instance available');
            return;
        }

        // V3.8: scope the album rows to the user's library selection.
        var libraryIds = AuthManager.getSelectedLibraries();

        var gen = ++_gen;
        _mainLoaded = false;
        _extraPending = EXTRA_ROWS.length;

        // Fetch all data in parallel
        var newestPromise = api.getAlbumList2('newest', 6, 0, libraryIds);
        var recentPromise = api.getAlbumList2('recent', 6, 0, libraryIds);
        var playlistPromise = api.getPlaylists();

        Promise.all([newestPromise, recentPromise, playlistPromise]).then(function(results) {
            if (gen !== _gen) return;
            _newestAlbums = results[0] || [];
            _recentAlbums = results[1] || [];
            _playlists = results[2] || [];

            // Use first newest album as hero
            if (_newestAlbums.length > 0) {
                _heroAlbum = _newestAlbums[0];
            } else if (_recentAlbums.length > 0) {
                _heroAlbum = _recentAlbums[0];
            }

            _renderHero(api);
            _renderNewestAlbums(api);
            _renderRecentAlbums(api);
            _renderPlaylists(api);
            _mainLoaded = true;
            _registerFocusZones(true);

            log('Home', 'Home screen data loaded');
        }).catch(function(err) {
            if (gen !== _gen) return;
            log('Home', 'Error loading home data: ' + err.message);
            _renderError();
        });

        // v3.10 A4: the extra rows' requests go out after the first paint
        // (two frames: one rAF still runs before it, D123), so Home's
        // synchronous render and first frame do not grow (R1.4). A response
        // for an activation that has ended is dropped (D88).
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (gen !== _gen) return;
                EXTRA_ROWS.forEach(function(row) {
                    api.getAlbumList2(row.type, EXTRA_ROW_SIZE, 0, libraryIds).then(function(albums) {
                        if (gen !== _gen) return;
                        _extraPending--;
                        _renderExtraRow(row, albums || [], api);
                    }).catch(function(err) {
                        if (gen !== _gen) return;
                        _extraPending--;
                        log('Home', row.title + ' failed: ' + err.message);
                    });
                });
            });
        });
    }

    // v3.10 A4: fill and show an extra row (kept hidden when its list is
    // empty), then re-chain the zones if they are already registered. A row
    // that appears above the focused card would push it down the screen:
    // the scroll moves by the same amount, so the card stays where it was.
    function _renderExtraRow(row, albums, api) {
        var section = document.getElementById('home-' + row.key + '-section');
        var rowEl = document.getElementById('home-' + row.key + '-row');
        if (!section || !rowEl || !albums.length) return;
        albums.forEach(function(album) {
            rowEl.appendChild(_albumCard(album, api));
        });
        var scroller = document.querySelector('.home-screen');
        var focused = FocusManager.getCurrentFocused();
        var anchor = (scroller && focused && scroller.contains(focused)) ? focused : null;
        var before = anchor ? anchor.getBoundingClientRect().top : 0;
        section.style.display = '';
        if (anchor) {
            var moved = anchor.getBoundingClientRect().top - before;
            if (moved) scroller.scrollTop += moved;
        }
        if (_mainLoaded) _registerFocusZones(false);
    }

    function _albumCard(album, api) {
        var card = el('div', {
            className: 'album-card focusable',
            'data-album-id': album.id,
            'data-album-title': album.name || album.title || ''
        });
        card.appendChild(SonanceComponents.renderAlbumArt(album, 162, api));
        card.appendChild(el('div', { className: 'album-card-title' }, album.name || album.title || 'Unknown'));
        card.appendChild(el('div', { className: 'album-card-artist' }, album.artist || 'Unknown Artist'));
        return card;
    }

    // =========================================
    //  Hero Banner
    // =========================================

    function _renderHero(api) {
        var heroContainer = document.getElementById('home-hero');
        if (!heroContainer) return;
        heroContainer.textContent = '';

        if (!_heroAlbum) {
            // Welcome state — no recent albums
            var welcome = el('div', { className: 'home-hero-content' });
            welcome.appendChild(el('div', { className: 'home-hero-label' }, 'WELCOME TO'));
            welcome.appendChild(el('div', { className: 'home-hero-title' }, 'Sonance'));
            welcome.appendChild(el('div', { className: 'home-hero-subtitle' }, 'Start playing music to see your activity here'));
            heroContainer.appendChild(welcome);
            return;
        }

        var album = _heroAlbum;

        // Album art (V3-5: 200px) with accent glow behind it
        var artWrap = el('div', { className: 'home-hero-art' });
        artWrap.appendChild(el('div', { className: 'hero-glow' }));
        artWrap.appendChild(SonanceComponents.renderAlbumArt(album, 200, api));
        heroContainer.appendChild(artWrap);

        // Info panel
        var info = el('div', { className: 'home-hero-info' });
        var heroLabel = 'LATEST ADDITION';
        info.appendChild(el('div', { className: 'home-hero-label' }, heroLabel));
        info.appendChild(el('div', { className: 'home-hero-title' }, album.name || album.title || 'Unknown Album'));

        var meta = album._metaString;
        if (typeof meta !== 'string' || !meta) {
            meta = album.artist || 'Unknown Artist';
            if (album.year) meta += ' \u00B7 ' + album.year;
        }
        info.appendChild(el('div', { className: 'home-hero-subtitle' }, meta));

        // Play + Shuffle buttons
        var buttons = el('div', { className: 'home-hero-buttons' });

        var playBtn = el('button', { className: 'hero-play-btn focusable' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = rem(16);
        playIcon.style.height = rem(16);
        playIcon.style.fill = 'white';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play'));
        playBtn.addEventListener('click', function() {
            log('Home', 'Play hero album: ' + album.id);
            App.navigateTo('album', { id: album.id, title: album.name || album.title }, 'zoom-in');
        });
        buttons.appendChild(playBtn);

        var shuffleBtn = el('button', { className: 'hero-shuffle-btn focusable' });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = rem(16);
        shuffleIcon.style.height = rem(16);
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle'));
        shuffleBtn.addEventListener('click', function() {
            log('Home', 'Shuffle hero album: ' + album.id);
        });
        buttons.appendChild(shuffleBtn);

        info.appendChild(buttons);
        heroContainer.appendChild(info);
    }

    // =========================================
    //  Recently Added Row (P4.9)
    // =========================================

    function _renderNewestAlbums(api) {
        var row = document.getElementById('home-newest-row');
        if (!row) return;
        row.textContent = '';

        if (!_newestAlbums || _newestAlbums.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No recently added albums'));
            return;
        }

        _newestAlbums.forEach(function(album) {
            var card = el('div', {
                className: 'album-card focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });

            card.appendChild(SonanceComponents.renderAlbumArt(album, 162, api));
            card.appendChild(el('div', { className: 'album-card-title' }, album.name || album.title || 'Unknown'));
            card.appendChild(el('div', { className: 'album-card-artist' }, album.artist || 'Unknown Artist'));

            row.appendChild(card);
        });
    }

    // =========================================
    //  Recently Played Row
    // =========================================

    function _renderRecentAlbums(api) {
        var row = document.getElementById('home-recent-row');
        if (!row) return;
        row.textContent = '';

        if (!_recentAlbums || _recentAlbums.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No recently played albums'));
            return;
        }

        _recentAlbums.forEach(function(album) {
            var card = el('div', {
                className: 'album-card focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });

            card.appendChild(SonanceComponents.renderAlbumArt(album, 162, api));
            card.appendChild(el('div', { className: 'album-card-title' }, album.name || album.title || 'Unknown'));
            card.appendChild(el('div', { className: 'album-card-artist' }, album.artist || 'Unknown Artist'));

            row.appendChild(card);
        });
    }

    // =========================================
    //  Playlists Row
    // =========================================

    function _renderPlaylists(api) {
        var row = document.getElementById('home-playlists-row');
        if (!row) return;
        row.textContent = '';

        if (!_playlists || _playlists.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No playlists yet'));
            return;
        }

        // v3.10 A3: the same cover cards as the Playlists grid, at the Home
        // cards' 16.2rem and their request bucket (D70).
        _playlists.forEach(function(playlist) {
            row.appendChild(SonanceComponents.renderPlaylistCard(playlist, SonanceUtils.artSize(180), api));
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    // Every row with something focusable, top to bottom, is a zone chained to
    // the next (Down) and the previous (Up); the last one's Down is the NP
    // bar, which returns Up to it (R9). The first row is also registered as
    // 'content', where Down from the top nav lands (the hero is registered
    // under that name only, as before). v3.10 A4: called again, `initial`
    // false, when an extra row lands after the rest, to re-chain without
    // moving the focus (re-registration keeps each zone's index).
    function _registerFocusZones(initial) {
        var rows = [
            { zone: 'content', sel: '#home-hero .focusable', hero: true },
            { zone: 'home-newest', sel: '#home-newest-row .focusable' },
            { zone: 'home-recent', sel: '#home-recent-row .focusable' },
            { zone: 'home-favourites', sel: '#home-favourites-row .focusable' },
            { zone: 'home-frequent', sel: '#home-frequent-row .focusable' },
            { zone: 'home-playlists', sel: '#home-playlists-row .focusable' },
            { zone: 'home-rediscover', sel: '#home-rediscover-row .focusable' }
        ].filter(function(r) {
            r.count = document.querySelectorAll(r.sel).length;
            return r.count > 0;
        });

        rows.forEach(function(r, i) {
            var neighbors = {
                left: 'topnav',
                down: i < rows.length - 1 ? rows[i + 1].zone : 'nowplaying-bar'
            };
            if (i > 0) neighbors.up = rows[i - 1].zone;
            FocusManager.registerZone(r.zone, {
                selector: r.sel,
                columns: r.count,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: neighbors
            });
        });

        // No hero: the first row doubles as 'content' (Up from it: the top nav).
        if (rows.length && !rows[0].hero) {
            FocusManager.registerZone('content', {
                selector: rows[0].sel,
                columns: rows[0].count,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    down: rows.length > 1 ? rows[1].zone : 'nowplaying-bar'
                }
            });
        }

        // The NP bar's Up goes to the last row.
        App.registerNowPlayingBarZone(rows.length ? rows[rows.length - 1].zone : 'content');

        // Set initial focus
        if (initial && rows.length) {
            FocusManager.setActiveZone('content', 0);
        }
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError() {
        var heroContainer = document.getElementById('home-hero');
        if (heroContainer) {
            heroContainer.textContent = '';
            heroContainer.style.background = 'var(--bg-card)';
            var errDiv = el('div', { className: 'home-error' });
            errDiv.appendChild(el('div', { className: 'home-error-text' }, 'Unable to load data. Check your connection.'));
            heroContainer.appendChild(errDiv);
        }
        // Clear skeleton rows
        var newestRow = document.getElementById('home-newest-row');
        if (newestRow) newestRow.textContent = '';
        var recentRow = document.getElementById('home-recent-row');
        if (recentRow) recentRow.textContent = '';
        var playlistRow = document.getElementById('home-playlists-row');
        if (playlistRow) playlistRow.textContent = '';
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _gen++;
        _mainLoaded = false;
        _extraPending = 0;
        _container = null;
        _heroAlbum = null;
        _newestAlbums = [];
        _recentAlbums = [];
        _playlists = [];
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate,
        // v3.10 A4: how many extra rows are still on the wire (0 once each
        // has been shown or found empty). The e2e helper waits on it.
        extraRowsPending: function() { return _extraPending; }
    };
})();

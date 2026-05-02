/* ============================================
   Sonance — Home Screen
   Hero banner, recently played, playlists
   ============================================ */

var HomeScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _heroAlbum = null;
    var _newestAlbums = [];
    var _recentAlbums = [];
    var _randomAlbums = [];
    var _playlists = [];

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
            container.scrollTop = elBottom - container.clientHeight + 20;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 20;
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
        newestRow.appendChild(SonanceComponents.renderSkeletonCards(9, 162, 220, 'skeleton-card'));
        newestSection.appendChild(newestRow);
        wrapper.appendChild(newestSection);

        // Recently Played section
        var recentSection = el('div', { className: 'home-section' });
        recentSection.appendChild(el('div', { className: 'home-section-heading', id: 'home-recent-heading' }, 'Recently Played'));
        var recentRow = el('div', { className: 'home-row', id: 'home-recent-row' });
        recentRow.appendChild(SonanceComponents.renderSkeletonCards(9, 162, 220, 'skeleton-card'));
        recentSection.appendChild(recentRow);
        wrapper.appendChild(recentSection);

        // Random Albums section
        var randomSection = el('div', { className: 'home-section' });
        randomSection.appendChild(el('div', { className: 'home-section-heading' }, 'Random Albums'));
        var randomRow = el('div', { className: 'home-row', id: 'home-random-row' });
        randomRow.appendChild(SonanceComponents.renderSkeletonCards(9, 162, 220, 'skeleton-card'));
        randomSection.appendChild(randomRow);
        wrapper.appendChild(randomSection);

        // Your Playlists section
        var playlistSection = el('div', { className: 'home-section' });
        playlistSection.appendChild(el('div', { className: 'home-section-heading' }, 'Your Playlists'));
        var playlistRow = el('div', { className: 'home-row', id: 'home-playlists-row' });
        playlistRow.appendChild(SonanceComponents.renderSkeletonCards(4, 230, 120, 'skeleton-card'));
        playlistSection.appendChild(playlistRow);
        wrapper.appendChild(playlistSection);

        container.appendChild(wrapper);

        // V3.7-fix10: one delegated click listener per row container; cards
        // carry data-album-id / data-playlist-id so we can navigate without
        // a per-card listener.
        newestRow.addEventListener('click', _onAlbumRowClick);
        recentRow.addEventListener('click', _onAlbumRowClick);
        randomRow.addEventListener('click', _onAlbumRowClick);
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

        // Fetch all data in parallel
        var newestPromise = api.getAlbumList2('newest', 9, 0, libraryIds);
        var recentPromise = api.getAlbumList2('recent', 9, 0, libraryIds);
        var randomPromise = api.getAlbumList2('random', 9, 0, libraryIds);
        var playlistPromise = api.getPlaylists();

        Promise.all([newestPromise, recentPromise, randomPromise, playlistPromise]).then(function(results) {
            _newestAlbums = results[0] || [];
            _recentAlbums = results[1] || [];
            _randomAlbums = results[2] || [];
            _playlists = results[3] || [];

            // Use first newest album as hero
            if (_newestAlbums.length > 0) {
                _heroAlbum = _newestAlbums[0];
            } else if (_recentAlbums.length > 0) {
                _heroAlbum = _recentAlbums[0];
            }

            _renderHero(api);
            _renderNewestAlbums(api);
            _renderRecentAlbums(api);
            _renderRandomAlbums(api);
            _renderPlaylists(api);
            _registerFocusZones();

            log('Home', 'Home screen data loaded');
        }).catch(function(err) {
            log('Home', 'Error loading home data: ' + err.message);
            _renderError();
        });
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
        playIcon.style.width = '16px';
        playIcon.style.height = '16px';
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
        shuffleIcon.style.width = '16px';
        shuffleIcon.style.height = '16px';
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
    //  Random Albums Row
    // =========================================

    function _renderRandomAlbums(api) {
        var row = document.getElementById('home-random-row');
        if (!row) return;
        row.textContent = '';

        if (!_randomAlbums || _randomAlbums.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No albums available'));
            return;
        }

        _randomAlbums.forEach(function(album) {
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

        _playlists.forEach(function(playlist) {
            var colors = playlist._gradient || SonanceComponents.hashColor(playlist.name || '');
            var card = el('div', {
                className: 'playlist-card focusable',
                'data-playlist-id': playlist.id
            });
            card.style.background = 'linear-gradient(135deg, ' + colors.base + ' 0%, var(--bg-card) 100%)';

            card.appendChild(el('div', { className: 'playlist-card-name' }, playlist.name || 'Untitled'));
            card.appendChild(el('div', { className: 'playlist-card-count' },
                (playlist.songCount || 0) + ' tracks'));

            row.appendChild(card);
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var heroButtons = document.querySelectorAll('#home-hero .focusable');
        var newestCards = document.querySelectorAll('#home-newest-row .focusable');
        var recentCards = document.querySelectorAll('#home-recent-row .focusable');
        var randomCards = document.querySelectorAll('#home-random-row .focusable');
        var playlistCards = document.querySelectorAll('#home-playlists-row .focusable');

        // Determine which zones exist for neighbor wiring
        var hasHero = heroButtons.length > 0;
        var hasNewest = newestCards.length > 0;
        var hasRecent = recentCards.length > 0;
        var hasRandom = randomCards.length > 0;
        var hasPlaylists = playlistCards.length > 0;

        // Helper: next zone down from current
        function nextDown(fromNewest, fromRecent, fromRandom) {
            if (fromNewest && hasRecent) return 'home-recent';
            if ((fromNewest || fromRecent) && hasRandom) return 'home-random';
            if ((fromNewest || fromRecent || fromRandom) && hasPlaylists) return 'home-playlists';
            return 'nowplaying-bar';
        }

        // Hero buttons zone (registered as 'content' — top nav → down lands here)
        if (hasHero) {
            FocusManager.registerZone('content', {
                selector: '#home-hero .focusable',
                columns: heroButtons.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    down: nextDown(true, false, false)
                }
            });
        }

        // Recently Added zone (P4.9)
        if (hasNewest) {
            FocusManager.registerZone('home-newest', {
                selector: '#home-newest-row .focusable',
                columns: newestCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasHero ? 'content' : 'topnav',
                    down: nextDown(true, false, false)
                }
            });

            // If no hero, register newest as 'content' so top nav → down lands here
            if (!hasHero) {
                FocusManager.registerZone('content', {
                    selector: '#home-newest-row .focusable',
                    columns: newestCards.length,
                    onActivate: function(idx, element) { element.click(); },
                    onFocus: function(idx, element) { _scrollToFocused(element); },
                    neighbors: {
                        left: 'topnav',
                        down: nextDown(true, false, false)
                    }
                });
            }
        }

        // Recently Played zone
        if (hasRecent) {
            FocusManager.registerZone('home-recent', {
                selector: '#home-recent-row .focusable',
                columns: recentCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasNewest ? 'home-newest' : (hasHero ? 'content' : 'topnav'),
                    down: nextDown(false, true, false)
                }
            });

            // If no hero and no newest, register recent as 'content'
            if (!hasHero && !hasNewest) {
                FocusManager.registerZone('content', {
                    selector: '#home-recent-row .focusable',
                    columns: recentCards.length,
                    onActivate: function(idx, element) { element.click(); },
                    onFocus: function(idx, element) { _scrollToFocused(element); },
                    neighbors: {
                        left: 'topnav',
                        down: nextDown(false, true, false)
                    }
                });
            }
        }

        // Random Albums zone
        if (hasRandom) {
            FocusManager.registerZone('home-random', {
                selector: '#home-random-row .focusable',
                columns: randomCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasRecent ? 'home-recent' : (hasNewest ? 'home-newest' : (hasHero ? 'content' : 'topnav')),
                    down: hasPlaylists ? 'home-playlists' : 'nowplaying-bar'
                }
            });

            // If no hero, newest, or recent, register random as 'content'
            if (!hasHero && !hasNewest && !hasRecent) {
                FocusManager.registerZone('content', {
                    selector: '#home-random-row .focusable',
                    columns: randomCards.length,
                    onActivate: function(idx, element) { element.click(); },
                    onFocus: function(idx, element) { _scrollToFocused(element); },
                    neighbors: {
                        left: 'topnav',
                        down: hasPlaylists ? 'home-playlists' : 'nowplaying-bar'
                    }
                });
            }
        }

        // Playlists zone
        if (hasPlaylists) {
            FocusManager.registerZone('home-playlists', {
                selector: '#home-playlists-row .focusable',
                columns: playlistCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasRandom ? 'home-random' : (hasRecent ? 'home-recent' : (hasNewest ? 'home-newest' : (hasHero ? 'content' : 'topnav'))),
                    down: 'nowplaying-bar'
                }
            });
        }

        // Update NP bar to point up to last content zone
        var lastZone = 'content';
        if (hasPlaylists) lastZone = 'home-playlists';
        else if (hasRandom) lastZone = 'home-random';
        else if (hasRecent) lastZone = 'home-recent';
        else if (hasNewest) lastZone = 'home-newest';

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: lastZone,
                left: 'topnav'
            }
        });

        // Set initial focus
        if (hasHero) {
            FocusManager.setActiveZone('content', 0);
        } else if (hasNewest) {
            FocusManager.setActiveZone('content', 0);
        } else if (hasRecent) {
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
        _container = null;
        _heroAlbum = null;
        _newestAlbums = [];
        _recentAlbums = [];
        _playlists = [];
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();

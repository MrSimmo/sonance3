/* ============================================
   Sonance — Library Screen
   Albums, Artists, Songs, Genres tabs
   ============================================ */

var LibraryScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _contentContainer = null;
    var _activeTab = 'albums'; // persists across navigations
    var _genreMode = false;    // true when showing genre songs
    var _currentGenre = null;
    var _currentSongs = null;  // Track list for colour button support
    var _albumLoader = null;   // PaginatedLoader for albums tab
    var _artistsAll = null;    // V3-6-fix2: full artists list (chunked or virtual render)
    var _artistsRenderedCount = 0; // chunked-render progress (≤80 artists path)
    var _artistsChunkRaf = null;
    var _artistsChunkedZoneRegistered = false; // V3.7-fix9: zone registered once per chunked render
    var _artistsVirtualGrid = null; // VirtualGrid instance when count > 80
    var ARTISTS_VIRTUAL_THRESHOLD = 80;
    var ARTISTS_CHUNK_SIZE = 50;
    var ARTIST_ITEM_HEIGHT = 180; // px — 100 avatar + name + count + 8px×2 padding + 24px row gap
    var ARTIST_ITEM_MIN_WIDTH = 130;

    // Sort state
    var _albumSort = 'alphabeticalByName'; // 'alphabeticalByName' | 'random'
    var _artistSort = 'name';              // 'name' | 'albums' | 'random'

    // V3-3 vertical sub-nav
    var LIBRARY_TABS = [
        { key: 'albums',  label: 'Albums'  },
        { key: 'artists', label: 'Artists' },
        { key: 'songs',   label: 'Songs'   },
        { key: 'genres',  label: 'Genres'  }
    ];

    function _tabIndex(key) {
        for (var i = 0; i < LIBRARY_TABS.length; i++) {
            if (LIBRARY_TABS[i].key === key) return i;
        }
        return 0;
    }

    // V3.7-fix10: single delegated click handler for the library content area.
    // Routes to the right action based on which kind of card/row was clicked.
    function _onContentClick(ev) {
        var t = ev.target;
        // Album grid card (Albums tab)
        var albumCard = t.closest('.album-grid-card');
        if (albumCard) {
            var aid = albumCard.getAttribute('data-album-id');
            var atitle = albumCard.getAttribute('data-album-title') || '';
            if (aid) App.navigateTo('album', { id: aid, title: atitle }, 'zoom-in');
            return;
        }
        // Artist grid card (Artists tab — chunked + virtual)
        var artistCard = t.closest('.artist-grid-card');
        if (artistCard) {
            var artistId = artistCard.getAttribute('data-artist-id');
            if (artistId) {
                log('Library', 'Artist clicked: ' + artistId);
                App.navigateTo('artist', { id: artistId }, 'zoom-in');
            }
            return;
        }
        // Song row (Songs tab + Genre songs)
        var songRow = t.closest('.song-row');
        if (songRow) {
            var rawIdx = songRow.getAttribute('data-song-index');
            if (rawIdx !== null && _currentSongs && _currentSongs.length) {
                var startIdx = parseInt(rawIdx, 10);
                if (!isNaN(startIdx) && _currentSongs[startIdx]) {
                    // V3.7-fix10: songs tab still kicks off player playback;
                    // genre-songs tab navigates to album. Distinguish by the
                    // genre-mode flag or by the presence of data-album-id.
                    var sAlbumId = songRow.getAttribute('data-album-id');
                    if (_genreMode && sAlbumId) {
                        var sAlbumTitle = songRow.getAttribute('data-album-title') || '';
                        log('Library', 'Genre song clicked');
                        App.navigateTo('album', { id: sAlbumId, title: sAlbumTitle }, 'zoom-in');
                    } else {
                        log('Library', 'Song clicked');
                        Player.playAlbum(_currentSongs, startIdx);
                    }
                }
            }
            return;
        }
        // Genre card (Genres tab)
        var genreCard = t.closest('.genre-card');
        if (genreCard) {
            var name = genreCard.getAttribute('data-genre');
            if (!name) return;
            log('Library', 'Genre clicked: ' + name);
            var api = App.getApi();
            if (!api) return;
            _genreMode = true;
            _currentGenre = name;
            if (App.zoomContent) {
                App.zoomContent(_contentContainer, function() {
                    _loadGenreSongs(api, name);
                }, 'in');
            } else {
                _loadGenreSongs(api, name);
            }
            return;
        }
    }

    // =========================================
    //  Sort Bars
    // =========================================

    function _renderAlbumSortBar() {
        var bar = el('div', { className: 'library-sort-bar', id: 'album-sort-bar' });
        var sorts = [
            { key: 'alphabeticalByName', label: 'A-Z' },
            { key: 'random', label: 'Random' }
        ];
        sorts.forEach(function(s) {
            var btn = el('button', {
                className: 'library-sort-btn focusable' + (_albumSort === s.key ? ' active' : '')
            }, s.label);
            btn.addEventListener('click', function() {
                if (_albumSort === s.key) return;
                _albumSort = s.key;
                _switchTabInstant('albums');
            });
            bar.appendChild(btn);
        });
        return bar;
    }

    function _renderArtistSortBar() {
        var bar = el('div', { className: 'library-sort-bar', id: 'artist-sort-bar' });
        var sorts = [
            { key: 'name', label: 'A-Z' },
            { key: 'albums', label: 'Albums' },
            { key: 'random', label: 'Random' }
        ];
        sorts.forEach(function(s) {
            var btn = el('button', {
                className: 'library-sort-btn focusable' + (_artistSort === s.key ? ' active' : '')
            }, s.label);
            btn.addEventListener('click', function() {
                if (_artistSort === s.key) return;
                _artistSort = s.key;
                _switchTabInstant('artists');
            });
            bar.appendChild(btn);
        });
        return bar;
    }

    function _sortArtists(artists, sortType) {
        if (sortType === 'albums') {
            return artists.slice().sort(function(a, b) {
                var ac = (b && b.albumCount) || 0;
                var bc = (a && a.albumCount) || 0;
                if (ac !== bc) return ac - bc;
                return ((a && a.name) || '').localeCompare((b && b.name) || '');
            });
        } else if (sortType === 'random') {
            var shuffled = artists.slice();
            for (var i = shuffled.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = shuffled[i];
                shuffled[i] = shuffled[j];
                shuffled[j] = t;
            }
            return shuffled;
        }
        return artists;
    }

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
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

    function _getScrollContainer() {
        return document.getElementById('library-content');
    }

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'library-screen' });

        // Vertical pill sub-nav (Albums / Artists / Songs / Genres)
        var subnav = el('div', { className: 'library-subnav', id: 'library-subnav' });

        // Sliding pill highlight — starts in 'selected' (grey) because on
        // arrival focus is still on the top nav; it transitions to 'focused'
        // (accent) once the user presses Down into the sub-nav.
        var pill = el('div', { className: 'library-subnav-pill selected', id: 'library-subnav-pill' });
        subnav.appendChild(pill);

        LIBRARY_TABS.forEach(function(tab, i) {
            var item = el('div', {
                className: 'library-subnav-item' + (tab.key === _activeTab ? ' selected' : ''),
                'data-tab': tab.key,
                'data-index': String(i)
            }, tab.label);

            item.addEventListener('click', function() {
                _onSubNavItemClicked(tab.key);
            });

            subnav.appendChild(item);
        });

        wrapper.appendChild(subnav);

        // Content area for tab content — keeps `library-content` class for
        // back-compat with existing scroll/padding rules; CSS now gives it a
        // margin-left so the grid clears the sub-nav.
        _contentContainer = el('div', { className: 'library-content', id: 'library-content' });
        // V3.7-fix10: single delegated click handler for all grid cards/rows
        // inside the content area, keyed off card class names + data-* attrs.
        _contentContainer.addEventListener('click', _onContentClick);
        wrapper.appendChild(_contentContainer);

        container.appendChild(wrapper);

        // Position the pill once the items are on the DOM (deferred — offsets
        // are 0 until layout completes). Read the `.selected` item from the
        // DOM so that if focus has already entered the sub-nav and moved the
        // pill synchronously (via onFocus), we don't clobber that with a
        // stale `_activeTab`.
        setTimeout(function() {
            var items = document.querySelectorAll('.library-subnav-item');
            var idx = -1;
            for (var i = 0; i < items.length; i++) {
                if (items[i].classList.contains('selected')) { idx = i; break; }
            }
            if (idx < 0) idx = _tabIndex(_activeTab);
            _updateLibraryPill(idx, false);
        }, 0);

        log('Library', 'Library screen rendered');
    }

    // =========================================
    //  Sub-nav pill position + state
    // =========================================

    function _updateLibraryPill(index, animate) {
        var pill = document.getElementById('library-subnav-pill');
        var items = document.querySelectorAll('.library-subnav-item');
        if (!items[index] || !pill) return;

        var firstTop = items[0].offsetTop;
        var itemTop = items[index].offsetTop - firstTop;
        var itemHeight = items[index].offsetHeight;

        if (itemHeight === 0) {
            // Not yet laid out — retry next frame
            setTimeout(function() { _updateLibraryPill(index, animate); }, 16);
            return;
        }

        pill.style.top = firstTop + 'px';
        pill.style.height = itemHeight + 'px';

        if (animate) {
            pill.style.transition = 'transform 0.2s ease';
        } else {
            pill.style.transition = 'none';
        }
        pill.style.transform = 'translateY(' + itemTop + 'px)';
    }

    function _setLibraryPillState(state) {
        var pill = document.getElementById('library-subnav-pill');
        if (!pill) return;
        pill.classList.remove('focused', 'selected');
        pill.classList.add(state);
    }

    function _markSubNavSelected(index) {
        var items = document.querySelectorAll('.library-subnav-item');
        for (var i = 0; i < items.length; i++) {
            if (i === index) items[i].classList.add('selected');
            else items[i].classList.remove('selected');
        }
    }

    function _onSubNavItemClicked(tabKey) {
        // Clicking an item acts like Up/Down: focus the sub-nav and cross-fade.
        var idx = _tabIndex(tabKey);
        FocusManager.setActiveZone('library-subnav', idx, true);
        // setActiveZone triggers onFocus which handles pill + content swap.
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        if (params && params.tab) {
            _activeTab = params.tab;
        }
        // Reset genre mode on fresh activation (unless coming back with genre)
        if (params && params.genre) {
            _genreMode = true;
            _currentGenre = params.genre;
            var api = App.getApi();
            if (api) {
                _loadGenreSongs(api, params.genre);
            }
            _registerSubNavZone();
            return;
        }
        _genreMode = false;
        _currentGenre = null;
        _loadTabContent();
        _registerSubNavZone();
    }

    // =========================================
    //  Sub-Nav Focus Zone (V3-3)
    // =========================================

    function _registerSubNavZone() {
        FocusManager.registerZone('library-subnav', {
            selector: '.library-subnav-item',
            columns: 1,
            defaultIndex: _tabIndex(_activeTab),
            onFocus: function(idx) {
                var newTab = LIBRARY_TABS[idx] ? LIBRARY_TABS[idx].key : _activeTab;
                _setLibraryPillState('focused');
                _updateLibraryPill(idx, true);
                _markSubNavSelected(idx);
                // Cross-fade only when the tab actually changes. A focus-only
                // return from content (Left at leftmost column) keeps the
                // current view intact — including genre-detail mode.
                if (newTab !== _activeTab) {
                    _genreMode = false;
                    _currentGenre = null;
                    _switchTabAnimated(newTab);
                }
            },
            onActivate: function(idx) {
                // Enter — same as Right (drop into grid).
                _enterLibraryContent();
            },
            onKey: function(direction) {
                var items = document.querySelectorAll('.library-subnav-item');
                var idx = _tabIndex(_activeTab);

                if (direction === 'up' && idx === 0) {
                    // Return to top nav; pill transitions to selected (accent).
                    _setLibraryPillState('selected');
                    FocusManager.setActiveZone('topnav', undefined, true);
                    return true;
                }
                if (direction === 'down' && idx === items.length - 1) {
                    // Wrap to first item (Albums).
                    FocusManager.setActiveZone('library-subnav', 0, true);
                    return true;
                }
                if (direction === 'right') {
                    _enterLibraryContent();
                    return true;
                }
                if (direction === 'left') {
                    // Nothing to the left of the sub-nav — eat the press.
                    return true;
                }
                return false;
            },
            neighbors: {}
        });
    }

    function _enterLibraryContent() {
        // Pill becomes "selected" (accent) when focus leaves sub-nav into content.
        _setLibraryPillState('selected');
        var targetZone = FocusManager.hasZone('library-grid') ? 'library-grid'
                        : (FocusManager.hasZone('content') ? 'content' : null);
        if (targetZone) {
            FocusManager.setActiveZone(targetZone, 0, true);
        }
    }

    // =========================================
    //  Tab switching (content cross-fade)
    // =========================================

    function _switchTabAnimated(tabKey) {
        if (!_contentContainer) { _switchTabInstant(tabKey); return; }
        var container = _contentContainer;
        container.style.transition = 'opacity 0.15s ease';
        container.style.opacity = '0';
        setTimeout(function() {
            _switchTabInstant(tabKey);
            // Force reflow so the fade-in transition applies cleanly.
            void container.offsetHeight;
            container.style.transition = 'opacity 0.15s ease';
            container.style.opacity = '1';
        }, 160);
    }

    function _switchTabInstant(tabKey) {
        _currentSongs = null; // Clear song list when switching tabs
        _albumLoader = null;  // Reset album pagination

        // V3-6-fix2: tear down artists virtual grid / chunked-render state.
        if (_artistsVirtualGrid) {
            _artistsVirtualGrid.destroy();
            _artistsVirtualGrid = null;
        }
        if (_artistsChunkRaf !== null) {
            cancelAnimationFrame(_artistsChunkRaf);
            _artistsChunkRaf = null;
        }
        _artistsAll = null;
        _artistsRenderedCount = 0;

        _activeTab = tabKey;
        _markSubNavSelected(_tabIndex(tabKey));

        // Unregister old grid zone (resets focus index)
        FocusManager.unregisterZone('library-grid');

        _loadTabContent();
    }

    // Back-compat wrapper for call sites (e.g. genre detail back button)
    // that expect a synchronous tab switch.
    function _switchTab(tabKey) {
        _switchTabInstant(tabKey);
    }

    // =========================================
    //  Loading State
    // =========================================

    function _showLoading() {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';

        var loading = el('div', { className: 'library-loading' });

        if (_activeTab === 'songs') {
            // Song list skeletons
            for (var i = 0; i < 10; i++) {
                var row = el('div', { className: 'skeleton skeleton-song-row' });
                loading.appendChild(row);
            }
        } else {
            // Grid skeletons
            var cols = _activeTab === 'genres' ? 4 : 6;
            var grid = el('div', { className: 'library-grid' });
            grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
            for (var j = 0; j < cols * 2; j++) {
                var card = el('div', { className: 'skeleton skeleton-grid-card' });
                grid.appendChild(card);
            }
            loading.appendChild(grid);
        }

        _contentContainer.appendChild(loading);
    }

    // =========================================
    //  Tab Content Loaders
    // =========================================

    function _loadTabContent() {
        _showLoading();

        var api = App.getApi();
        if (!api) {
            _renderEmpty('Not connected to server');
            return;
        }

        switch (_activeTab) {
            case 'albums':
                _loadAlbums(api);
                break;
            case 'artists':
                _loadArtists(api);
                break;
            case 'songs':
                _loadSongs(api);
                break;
            case 'genres':
                _loadGenres(api);
                break;
        }
    }

    // --- Albums Tab (Paginated) ---

    function _loadAlbums(api) {
        var expected = _activeTab;
        // V3.8: capture the library selection at fetch time so subsequent
        // pages stay scoped consistently across pagination.
        var libraryIds = AuthManager.getSelectedLibraries();
        // V3.8-fix1: in the multi-library case the per-page fan-out can
        // surface the same album id on more than one merged page, so wrap
        // the fetch with cross-page dedupe and an internally-managed
        // upstream cursor. Single- and all-libraries paths short-circuit
        // to the v3.8 call shape (no extra promise hop).
        var multi = libraryIds && libraryIds.length >= 2;
        var seenIds = multi ? {} : null;
        var apiOffset = 0;
        var apiExhausted = false;

        function fetchPage(count, loaderOffset) {
            if (!multi) {
                return api.getAlbumList2(
                    _albumSort, count, loaderOffset, libraryIds
                );
            }
            // Refill from upstream until `count` fresh items have been
            // collected or upstream is exhausted.
            var collected = [];
            function step() {
                if (apiExhausted || collected.length >= count) {
                    return Promise.resolve(collected.slice(0, count));
                }
                return api.getAlbumList2(
                    _albumSort, count, apiOffset, libraryIds
                ).then(function(albums) {
                    apiOffset += count;
                    if (!albums.length) {
                        apiExhausted = true;
                        return collected;
                    }
                    if (albums.length < count) apiExhausted = true;
                    for (var i = 0; i < albums.length; i++) {
                        var a = albums[i];
                        var id = a && a.id;
                        if (id === undefined || id === null) {
                            collected.push(a);
                            continue;
                        }
                        if (seenIds[id]) continue;
                        seenIds[id] = true;
                        collected.push(a);
                    }
                    return step();
                });
            }
            return step();
        }

        _albumLoader = new SonanceUtils.PaginatedLoader(fetchPage, 50);

        _albumLoader.loadNext(function(albums, hasMore) {
            if (_activeTab !== expected) {
                log('Library', 'Stale albums response ignored (active=' + _activeTab + ')');
                return;
            }
            if (!_contentContainer) return;
            _contentContainer.textContent = '';
            _contentContainer.appendChild(_renderAlbumSortBar());

            FocusManager.registerZone('library-sort', {
                selector: '#album-sort-bar .focusable',
                columns: 2,
                onActivate: function(idx, element) { element.click(); },
                neighbors: {
                    left: 'library-subnav',
                    up: 'topnav',
                    down: 'library-grid'
                }
            });

            if (albums.length === 0) {
                _renderEmpty('No albums found');
                return;
            }

            var grid = el('div', { className: 'library-grid library-albums-grid', id: 'library-grid' });
            _contentContainer.appendChild(grid);

            _appendAlbumsToGrid(grid, albums, api);
            _updateLoadingIndicator(hasMore);

            // Register grid zone with pagination support
            var cols = _getGridColumnCount(grid);
            _registerAlbumsGridZone(cols || 8, api);
        });
    }

    function _appendAlbumsToGrid(grid, albums, api) {
        albums.forEach(function(album) {
            var card = el('div', {
                className: 'album-grid-card focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });

            card.appendChild(SonanceComponents.renderAlbumArt(album, 0, api));

            var info = el('div', { className: 'album-grid-info' });
            info.appendChild(el('div', { className: 'album-grid-title' }, album.name || 'Unknown'));
            // V3.7-fix11: prefer the API-side memoised _metaString
            var meta = album._metaString;
            if (typeof meta !== 'string' || !meta) {
                meta = album.artist || 'Unknown Artist';
                if (album.year) meta += ' \u00B7 ' + album.year;
            }
            info.appendChild(el('div', { className: 'album-grid-meta' }, meta));
            card.appendChild(info);

            grid.appendChild(card);
        });
    }

    function _updateLoadingIndicator(hasMore) {
        var existing = document.getElementById('library-loading-more');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        if (hasMore && _contentContainer) {
            var indicator = el('div', {
                className: 'library-loading-more',
                id: 'library-loading-more'
            }, 'Loading...');
            _contentContainer.appendChild(indicator);
        }
    }

    function _registerAlbumsGridZone(cols, api) {
        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                // V3-6-fix NAV-1: snapshot grid focus before drilling down
                // so Back from the album/artist detail (or NP) restores it.
                if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                element.click();
            },
            onFocus: function(idx, element) {
                // Scroll focused item into view
                _scrollToFocused(_getScrollContainer(), element);

                // Pagination: load more when near bottom
                if (_albumLoader && _albumLoader.hasMore && !_albumLoader.loading) {
                    var elements = document.querySelectorAll('#library-grid .focusable');
                    if (elements.length - idx <= 5) {
                        _albumLoader.loadNext(function(albums, hasMore) {
                            // Abort if user switched away from albums tab
                            if (_activeTab !== 'albums') return;
                            var grid = document.getElementById('library-grid');
                            if (grid) {
                                _appendAlbumsToGrid(grid, albums, api);
                            }
                            _updateLoadingIndicator(hasMore);
                            // Re-register zone so FocusManager picks up new elements
                            var newCols = grid ? _getGridColumnCount(grid) : cols;
                            _registerAlbumsGridZone(newCols || cols, api);
                        });
                    }
                }
            },
            neighbors: {
                /* V3-6-fix NAV-2: Up goes to sort bar, Left enters side sub-nav. */
                left: 'library-subnav',
                up: 'library-sort',
                down: 'nowplaying-bar'
            }
        });

        // Update NP bar to point up to grid
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-grid',
                left: 'topnav'
            }
        });

        App.hideColourHints();
    }

    // --- Artists Tab ---

    function _loadArtists(api) {
        var expected = _activeTab;
        var libraryIds = AuthManager.getSelectedLibraries();
        api.getArtists(libraryIds).then(function(artists) {
            if (_activeTab !== expected) {
                log('Library', 'Stale artists response ignored (active=' + _activeTab + ')');
                return;
            }
            artists = _sortArtists(artists || [], _artistSort);
            _renderArtists(artists, api);
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            log('Library', 'Error loading artists: ' + err.message);
            _renderEmpty('Unable to load artists');
        });
    }

    // V3-6-fix2 PERF-1/2: build a single artist card. Used for both the
    // chunked-render path (≤ ARTISTS_VIRTUAL_THRESHOLD) and the virtualised
    // render path so the markup stays identical.
    function _renderArtistCard(artist, api) {
        var card = el('div', {
            className: 'artist-grid-card focusable',
            'data-artist-id': artist.id
        });

        card.appendChild(SonanceComponents.renderArtistAvatar(artist, 100, api));
        card.appendChild(el('div', { className: 'artist-grid-name' }, artist.name || 'Unknown'));

        var albumCount = artist.albumCount || 0;
        var countText = albumCount + ' album' + (albumCount !== 1 ? 's' : '');
        card.appendChild(el('div', { className: 'artist-grid-count' }, countText));

        return card;
    }

    function _renderArtists(artists, api) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _contentContainer.appendChild(_renderArtistSortBar());

        FocusManager.registerZone('library-sort', {
            selector: '#artist-sort-bar .focusable',
            columns: 3,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'library-subnav',
                up: 'topnav',
                down: 'library-grid'
            }
        });

        if (artists.length === 0) {
            _renderEmpty('No artists found');
            return;
        }

        _artistsAll = artists;
        _artistsRenderedCount = 0;

        if (artists.length > ARTISTS_VIRTUAL_THRESHOLD) {
            _renderArtistsVirtual(artists, api);
        } else {
            _renderArtistsChunked(artists, api);
        }
    }

    // ≤80 artists: render in chunks of 50 via rAF so the first paint isn't
    // blocked by a single big DOM insertion. The grid zone is re-registered
    // after each chunk so newly-added cards become focusable.
    function _renderArtistsChunked(artists, api) {
        var grid = el('div', { className: 'library-grid library-artists-grid', id: 'library-grid' });
        _contentContainer.appendChild(grid);

        // V3.7-fix9: register the focus zone once after the final chunk lands,
        // not after every chunk — registerZone caches a querySelectorAll
        // (prompt-3.7-fix4) and re-registering per chunk wastes the cache.
        _artistsChunkedZoneRegistered = false;

        function appendChunk() {
            _artistsChunkRaf = null;
            if (_activeTab !== 'artists' || !_artistsAll) return;
            if (!grid.parentNode) return;

            var stop = Math.min(artists.length, _artistsRenderedCount + ARTISTS_CHUNK_SIZE);
            for (var i = _artistsRenderedCount; i < stop; i++) {
                grid.appendChild(_renderArtistCard(artists[i], api));
            }
            _artistsRenderedCount = stop;

            // Lazy images for the new cards are picked up automatically by
            // SonanceComponents.renderArtistAvatar → LazyLoader.observe.

            if (_artistsRenderedCount < artists.length) {
                _artistsChunkRaf = requestAnimationFrame(appendChunk);
            } else if (!_artistsChunkedZoneRegistered) {
                var artCols = _getGridColumnCount(grid) || 6;
                _registerGridZone(artCols, 'library-sort');
                _artistsChunkedZoneRegistered = true;
            }
        }

        if (_artistsChunkRaf !== null) cancelAnimationFrame(_artistsChunkRaf);
        _artistsChunkRaf = requestAnimationFrame(appendChunk);
    }

    // >80 artists: VirtualGrid renders only the visible rows + buffer. The
    // focus zone is registered with a `virtual` config so FocusManager can
    // navigate the full collection while the DOM stays small.
    function _renderArtistsVirtual(artists, api) {
        // The mount hosts the spacer + an absolutely-positioned inner grid.
        // It must NOT be display:grid itself (that would lay out the spacer).
        // The inner grid carries the layout classes.
        var mount = el('div', {
            className: 'library-artists-virtual-mount',
            id: 'library-grid'
        });
        _contentContainer.appendChild(mount);

        // The virtual grid renders an absolutely-positioned inner grid that
        // gets the layout class. The outer #library-grid acts as the
        // mount/spacer host so the existing focus-zone selector still works.
        var scrollContainer = _getScrollContainer();
        if (!scrollContainer) {
            // Fallback: render as straight chunked render.
            _renderArtistsChunked(artists, api);
            return;
        }

        _artistsVirtualGrid = new SonanceUtils.VirtualGrid({
            scrollContainer: scrollContainer,
            mountContainer: mount,
            items: artists,
            renderItem: function(artist /*, index*/) {
                return _renderArtistCard(artist, api);
            },
            itemHeight: ARTIST_ITEM_HEIGHT,
            itemMinWidth: ARTIST_ITEM_MIN_WIDTH,
            gridClassName: 'library-grid library-artists-grid',
            bufferRows: 2,
            onRangeRender: function(/* elements, startIndex, endIndex */) {
                // Re-apply focus class if the focused card just re-mounted
                // (FocusManager keeps the index but may have lost the node).
                if (FocusManager.getActiveZone && FocusManager.getActiveZone() === 'library-grid') {
                    var focused = FocusManager.getCurrentFocused();
                    if (!focused || !focused.parentNode) {
                        // Defer to next tick — let VG finish its DOM insertion.
                        setTimeout(function() {
                            if (FocusManager.getActiveZone && FocusManager.getActiveZone() === 'library-grid') {
                                FocusManager.setActiveZone('library-grid', undefined, true);
                            }
                        }, 0);
                    }
                }
            }
        });
        _artistsVirtualGrid.init();

        // Register the artists virtual zone. FocusManager will use the
        // virtual hooks below for count + node lookup; selector remains as
        // a fallback for any stale calls.
        _registerArtistsVirtualZone();
    }

    function _registerArtistsVirtualZone() {
        if (!_artistsVirtualGrid) return;
        var cols = _artistsVirtualGrid.getColumns();

        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            virtual: {
                getCount: function() {
                    return _artistsVirtualGrid ? _artistsVirtualGrid.getCount() : 0;
                },
                getItemAt: function(idx) {
                    if (!_artistsVirtualGrid) return null;
                    return _artistsVirtualGrid.ensureIndexVisible(idx);
                }
            },
            onActivate: function(idx, element) {
                if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                if (element) element.click();
            },
            onFocus: function(/* idx, element */) {
                // VirtualGrid handles scroll via ensureIndexVisible — nothing
                // extra to do here. (No layout reads per keypress.)
            },
            neighbors: {
                left: 'library-subnav',
                up: 'library-sort',
                down: 'nowplaying-bar'
            }
        });

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-grid',
                left: 'topnav'
            }
        });

        App.hideColourHints();
    }

    // --- Songs Tab ---

    function _loadSongs(api) {
        var expected = _activeTab;
        var libraryIds = AuthManager.getSelectedLibraries();
        api.getRandomSongs(50, libraryIds).then(function(songs) {
            if (_activeTab !== expected) {
                log('Library', 'Stale songs response ignored (active=' + _activeTab + ')');
                return;
            }
            _renderSongs(songs || [], api);
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            log('Library', 'Error loading songs: ' + err.message);
            _renderEmpty('Unable to load songs');
        });
    }

    function _renderSongs(songs, api) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _currentSongs = songs;

        if (songs.length === 0) {
            _currentSongs = null;
            _renderEmpty('No songs found');
            return;
        }

        var list = el('div', { className: 'library-song-list', id: 'library-grid' });

        songs.forEach(function(song, index) {
            var row = el('div', {
                className: 'song-row focusable',
                'data-song-id': song.id,
                'data-song-index': String(index)
            });

            // Track number
            row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

            // Song info
            var info = el('div', { className: 'song-row-info' });
            info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));

            var meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' \u00B7 ' + song.album;
            info.appendChild(el('div', { className: 'song-row-meta' }, meta));
            row.appendChild(info);

            // Duration
            row.appendChild(el('div', { className: 'song-row-duration' },
                (song._formattedDuration || formatDuration(song.duration))));

            list.appendChild(row);
        });

        _contentContainer.appendChild(list);
        _registerGridZone(1);
    }

    // --- Genres Tab ---

    function _loadGenres(api) {
        var expected = _activeTab;
        api.getGenres().then(function(genres) {
            if (_activeTab !== expected) {
                log('Library', 'Stale genres response ignored (active=' + _activeTab + ')');
                return;
            }
            _renderGenres(genres || []);
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            log('Library', 'Error loading genres: ' + err.message);
            _renderEmpty('Unable to load genres');
        });
    }

    // V3-5: gradient card palette (Apple Music style). Each genre gets a
    // unique gradient from this curated list; cycled by index.
    var GENRE_GRADIENTS = [
        'linear-gradient(135deg, #7c3aed, #4f46e5)',
        'linear-gradient(135deg, #0891b2, #0e7490)',
        'linear-gradient(135deg, #e44d8a, #be185d)',
        'linear-gradient(135deg, #ea580c, #c2410c)',
        'linear-gradient(135deg, #16a34a, #15803d)',
        'linear-gradient(135deg, #ca8a04, #a16207)',
        'linear-gradient(135deg, #2563eb, #1d4ed8)',
        'linear-gradient(135deg, #dc2626, #b91c1c)',
        'linear-gradient(135deg, #7c3aed, #be185d)',
        'linear-gradient(135deg, #0891b2, #16a34a)',
        'linear-gradient(135deg, #ea580c, #ca8a04)',
        'linear-gradient(135deg, #2563eb, #7c3aed)'
    ];

    function _renderGenres(genres) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';

        if (genres.length === 0) {
            _renderEmpty('No genres found');
            return;
        }

        var grid = el('div', { className: 'library-grid library-genres-grid', id: 'library-grid' });

        genres.forEach(function(genre, index) {
            var name = genre.value || genre.name || 'Unknown';
            var gradient = GENRE_GRADIENTS[index % GENRE_GRADIENTS.length];

            var card = el('div', {
                className: 'genre-card focusable',
                'data-genre': name
            });
            card.style.background = gradient;

            card.appendChild(el('div', { className: 'genre-card-name' }, name));

            var countParts = [];
            if (genre.albumCount) countParts.push(genre.albumCount + ' albums');
            if (genre.songCount) countParts.push(genre.songCount + ' songs');
            if (countParts.length > 0) {
                card.appendChild(el('div', { className: 'genre-card-count' }, countParts.join(' \u00B7 ')));
            }

            grid.appendChild(card);
        });

        _contentContainer.appendChild(grid);
        _registerGridZone(4);
    }

    // =========================================
    //  Genre Song Browsing
    // =========================================

    function _loadGenreSongs(api, genreName) {
        if (!_contentContainer) return;

        // Unregister existing zones
        FocusManager.unregisterZone('library-grid');
        FocusManager.unregisterZone('content');

        _contentContainer.textContent = '';

        // Heading (non-focusable) \u2014 hardware Back returns to the genre grid
        var header = el('div', { className: 'genre-songs-header' });
        header.appendChild(el('div', { className: 'genre-songs-title' }, genreName));
        _contentContainer.appendChild(header);

        // Loading state
        var loadingWrap = el('div', { id: 'library-grid' });
        for (var i = 0; i < 10; i++) {
            loadingWrap.appendChild(el('div', { className: 'skeleton skeleton-song-row' }));
        }
        _contentContainer.appendChild(loadingWrap);

        var libraryIds = AuthManager.getSelectedLibraries();
        api.getSongsByGenre(genreName, 50, 0, libraryIds).then(function(songs) {
            if (!_genreMode || _currentGenre !== genreName) return;
            _renderGenreSongs(songs || [], api, genreName);
        }).catch(function(err) {
            if (!_genreMode || _currentGenre !== genreName) return;
            log('Library', 'Error loading genre songs: ' + err.message);
            var gridEl = document.getElementById('library-grid');
            if (gridEl) {
                gridEl.textContent = '';
                gridEl.appendChild(el('div', { className: 'home-empty' },
                    'Unable to load songs for ' + genreName));
            }
        });
    }

    // Back handling for in-screen genre detail mode \u2014 called by App.goBack
    // before its default flow. Returns true when handled.
    function handleBack() {
        if (!_genreMode) return false;
        _genreMode = false;
        _currentGenre = null;
        _activeTab = 'genres';
        if (App.zoomContent) {
            App.zoomContent(_contentContainer, function() {
                _switchTab('genres');
            }, 'out');
        } else {
            _switchTab('genres');
        }
        // V3-6-fix NAV-1: prefer restoring the genre tile the user came
        // from. The genre grid re-renders asynchronously, so tryRestoreFocus
        // schedules a poll. Fall back to the sub-nav only when no snapshot
        // is available (e.g. came from a deep link).
        var restored = (typeof App !== 'undefined' && App.tryRestoreFocus)
            ? App.tryRestoreFocus()
            : false;
        if (!restored) {
            FocusManager.setActiveZone('library-subnav', _tabIndex('genres'), true);
        }
        return true;
    }

    function _renderGenreSongs(songs, api, genreName) {
        var gridEl = document.getElementById('library-grid');
        if (gridEl) gridEl.parentNode.removeChild(gridEl);

        if (!_contentContainer) return;
        _currentSongs = songs;

        if (songs.length === 0) {
            _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                'No songs found in ' + genreName));
            return;
        }

        var list = el('div', { className: 'library-song-list', id: 'library-grid' });

        songs.forEach(function(song, index) {
            var rowAttrs = {
                className: 'song-row focusable',
                'data-song-id': song.id,
                'data-song-index': String(index)
            };
            if (song.albumId) {
                rowAttrs['data-album-id'] = song.albumId;
                rowAttrs['data-album-title'] = song.album || '';
            }
            var row = el('div', rowAttrs);

            row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

            var info = el('div', { className: 'song-row-info' });
            info.appendChild(el('div', { className: 'song-row-title' },
                song.title || 'Unknown'));
            var meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' \u00B7 ' + song.album;
            info.appendChild(el('div', { className: 'song-row-meta' }, meta));
            row.appendChild(info);

            row.appendChild(el('div', { className: 'song-row-duration' },
                (song._formattedDuration || formatDuration(song.duration))));

            list.appendChild(row);
        });

        _contentContainer.appendChild(list);

        _registerGridZone(1);
        // V3-6-fix3 NAV-2: focus the first song row when a genre opens. The
        // active zone is usually 'library-subnav' coming in, so pass force=true.
        FocusManager.setActiveZone('library-grid', 0, true);
    }

    // =========================================
    //  Grid Column Count Helper (P8.1)
    // =========================================

    function _getGridColumnCount(gridEl) {
        if (!gridEl || !gridEl.children || gridEl.children.length === 0) return 0;
        var style = window.getComputedStyle(gridEl);
        var cols = style.getPropertyValue('grid-template-columns');
        if (cols) {
            return cols.split(/\s+/).length;
        }
        return 0;
    }

    // =========================================
    //  Focus Zone Registration (non-albums)
    // =========================================

    function _registerGridZone(cols, upNeighbor) {
        var zoneConfig = {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                // V3-6-fix NAV-1: snapshot grid focus before drilling down
                // so Back from the detail (or NP) restores it.
                if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                element.click();
            },
            onFocus: function(idx, element) {
                _scrollToFocused(_getScrollContainer(), element);
            },
            neighbors: {
                /* V3-6-fix NAV-2: Up goes to sort bar or top nav, Left enters side sub-nav. */
                left: 'library-subnav',
                up: upNeighbor || 'topnav',
                down: 'nowplaying-bar'
            }
        };

        // Add colour button support for song lists
        if (cols === 1 && _currentSongs && _currentSongs.length > 0) {
            zoneConfig.onColourButton = function(colour, idx) {
                var track = _currentSongs[idx];
                if (!track) return;
                if (colour === 'yellow') {
                    Player.addToQueue(track);
                    App.showToast('Added to queue');
                } else if (colour === 'blue') {
                    Player.addToQueueNext(track);
                    App.showToast('Playing next');
                }
            };
            App.showColourHints([
                { colour: 'yellow', label: 'Add to queue' },
                { colour: 'blue', label: 'Play next' }
            ]);
        } else {
            App.hideColourHints();
        }

        FocusManager.registerZone('library-grid', zoneConfig);

        // Update NP bar to point up to grid
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-grid',
                left: 'topnav'
            }
        });
    }

    // =========================================
    //  Empty State
    // =========================================

    function _renderEmpty(message) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        var empty = el('div', { className: 'home-empty library-empty' });
        empty.appendChild(el('div', null, message));
        _contentContainer.appendChild(empty);

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-subnav',
                left: 'topnav'
            }
        });
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _contentContainer = null;
        _genreMode = false;
        _currentGenre = null;
        _currentSongs = null;
        _albumLoader = null;

        if (_artistsVirtualGrid) {
            _artistsVirtualGrid.destroy();
            _artistsVirtualGrid = null;
        }
        if (_artistsChunkRaf !== null) {
            cancelAnimationFrame(_artistsChunkRaf);
            _artistsChunkRaf = null;
        }
        _artistsAll = null;
        _artistsRenderedCount = 0;
        // V3.7-fix9: reset so a re-entry re-registers cleanly.
        _artistsChunkedZoneRegistered = false;
    }

    function getActiveTab() {
        return _activeTab;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate,
        handleBack: handleBack,
        getActiveTab: getActiveTab
    };
})();

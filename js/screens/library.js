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
    // v3.10 A1, R1.7: Library → Songs and a genre's songs are virtual lists
    // over a SongPager (js/api.js): the whole list, each page fetched when the
    // band reaches it. `_songList` = { pager, kind: 'songs'|'genre', items
    // (sparse, length = the list's), pages (page → promise), loaded (page
    // order, for the memory bound), vg }.
    var _songList = null;
    var SONG_PAGE_SIZE = 100;
    var SONG_PAGES_KEPT = 40;     // the screen holds at most 4,000 songs
    var SONG_QUEUE_SPAN = 200;    // Enter on a song queues it and the next 199
    var _albumLoader = null;   // PaginatedLoader for albums tab
    var _tabFadeClearTimer = null; // V3.9 T4: clears the cross-fade will-change hint
    // v3.10 R1.3 (D51, D90): the sub-nav dwell. Up/Down moves the pill and
    // the selected label at once and starts the content fade-out; the tab
    // is built SUBNAV_DWELL_MS after the last press (a setTimeout restarted
    // by each press), so a run of presses builds one tab, not one per press.
    var SUBNAV_DWELL_MS = 180;
    var _tabDwellTimer = null;
    var _tabDwellTarget = null;    // the tab key the dwell will build
    // v3.10 R1.5 (D97): an Albums-grid card focused for PREFETCH_DWELL_MS
    // fetches its album, so Enter opens it from the API's memory cache.
    var PREFETCH_DWELL_MS = 400;
    var _prefetchTimer = null;
    var _artistsAll = null;    // V3-6-fix2: full artists list (chunked or virtual render)
    var _artistsRenderedCount = 0; // chunked-render progress (≤80 artists path)
    var _artistsChunkRaf = null;
    var _artistsChunkedZoneRegistered = false; // V3.7-fix9: zone registered once per chunked render
    var _artistsVirtualGrid = null; // VirtualGrid instance when count > 80
    var ARTISTS_VIRTUAL_THRESHOLD = 80;
    var ARTISTS_CHUNK_SIZE = 50;
    // v3.10 R4: the four ITEM_* sizes below are px at interface size 100 %;
    // they are passed through SonanceUtils.px() where the grids are built.
    var ARTIST_ITEM_HEIGHT = 180; // px — 100 avatar + name + count + 8px×2 padding + 24px row gap
    var ARTIST_ITEM_MIN_WIDTH = 130;
    // V3.9 T1: the Albums tab is virtualised too. `_albumsAll` is the backing
    // store the PaginatedLoader appends into; the grid renders a view over it.
    var _albumsAll = null;
    var _albumsVirtualGrid = null;
    // Measured on the rendered grid at 1920 wide: 153px card + 42px info block
    // = 195px, plus `.library-albums-grid`'s 28px row gap. `_measureAlbumGeometry`
    // corrects both this and the column count from the CSS after first render,
    // so these are only the starting estimate for the first band.
    var ALBUM_ITEM_HEIGHT = 223;
    var ALBUM_ITEM_MIN_WIDTH = 140; // matches `.library-albums-grid` minmax()

    // v3.10 A2: the Albums header's sort and genre filter, kept for the
    // session (they survive leaving Library, not a restart). Every list
    // pages as Name always has: plain pages for one library or all, an
    // AlbumListCursor (D23) with a per-type comparator for 2+ libraries.
    var ALBUM_SORTS = [
        { type: 'alphabeticalByName', label: 'Name' },
        { type: 'alphabeticalByArtist', label: 'Artist' },
        { type: 'newest', label: 'Recently added' },
        // 3000 -> 0: newest year first, and albums with no year last, so the
        // sort reaches all of them (live S5: 2,996 of 2,996; toYear 1 left
        // out 47).
        { type: 'byYear', label: 'Year', extra: { fromYear: 3000, toYear: 0 } },
        { type: 'frequent', label: 'Most played' },
        // v3.12 R2 (D177): one random sample of the libraries in scope, not
        // a paged list (_loadAlbumSample).
        { type: 'random', label: 'Random', sample: true }
    ];
    var RANDOM_SAMPLE_SIZE = 500;   // the most one getAlbumList2 returns
    // The sample Random shows, { scope, albums }: kept until Random is
    // chosen again, so leaving Library or Back from an album keeps its order
    // (and the focus restore its album).
    var _albumRandom = null;
    var _albumSort = 0;
    var _albumGenre = null;     // a genre name, or null for all genres
    var _albumLoadGen = 0;      // a page or a count for a list since replaced is dropped
    var _genrePicker = null;    // { panel, vg } while the genre picker is open

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
            var rawIdx = parseInt(songRow.getAttribute('data-song-index'), 10);
            if (!isNaN(rawIdx)) _activateSong(rawIdx);
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
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
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
                // current view intact — including genre-detail mode. A
                // pending dwell is restarted even when the press came back to
                // the shown tab, which then just fades back in (D90).
                if (newTab !== _activeTab || _tabDwellTimer !== null) {
                    _scheduleTabSwitch(newTab);
                }
            },
            onActivate: function(idx) {
                // Enter — same as Right (drop into grid).
                _enterLibraryContent();
            },
            onKey: function(direction) {
                var items = document.querySelectorAll('.library-subnav-item');
                // The focused index, not _activeTab: during the dwell the tab
                // shown is not yet the tab focused (D90).
                var snap = FocusManager.snapshot();
                var idx = snap ? snap.index : _tabIndex(_activeTab);

                if (direction === 'up' && idx === 0) {
                    // Return to top nav; pill transitions to selected (accent).
                    _setLibraryPillState('selected');
                    FocusManager.setActiveZone('topnav', undefined, true);
                    return true;
                }
                // v3.10 R9 (D56): the last tab leads down to the NP bar (it
                // used to wrap to Albums). Returning false lets FocusManager
                // make the transition to the `down` neighbour, which records
                // this tab as the bar's origin. With the bar hidden there is
                // nowhere to go.
                if (direction === 'down' && idx === items.length - 1) {
                    if (!App.isNowPlayingBarAvailable()) return true;
                    _setLibraryPillState('selected');
                    return false;
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
            neighbors: { down: 'nowplaying-bar' }
        });
    }

    function _enterLibraryContent() {
        // D90: Right/Enter during the dwell builds the focused tab now.
        _flushTabSwitch();
        if (_enterGrid()) return;
        // The tab's grid registers when its data arrives; enter it then,
        // unless focus has moved on or the content has been replaced.
        var container = _contentContainer;
        FocusManager.onceZoneRegistered('library-grid', function() {
            if (_contentContainer === container &&
                    FocusManager.getActiveZone() === 'library-subnav') {
                _enterGrid();
            }
        });
    }

    function _enterGrid() {
        var targetZone = FocusManager.hasZone('library-grid') ? 'library-grid'
                        : (FocusManager.hasZone('content') ? 'content' : null);
        if (!targetZone) return false;
        // Pill becomes "selected" (accent) when focus leaves sub-nav into content.
        _setLibraryPillState('selected');
        FocusManager.setActiveZone(targetZone, 0, true);
        return true;
    }

    // =========================================
    //  Tab switching (content cross-fade, dwell D90)
    // =========================================

    function _scheduleTabSwitch(tabKey) {
        _tabDwellTarget = tabKey;
        if (_tabDwellTimer !== null) clearTimeout(_tabDwellTimer);
        else _fadeContent(0);   // the first press of a run starts the fade-out
        _tabDwellTimer = setTimeout(_flushTabSwitch, SUBNAV_DWELL_MS);
    }

    // Build the tab the dwell is waiting on, now, and fade the content back
    // in. Called by the timer, and by Right/Enter. No-op with no dwell.
    function _flushTabSwitch() {
        if (_tabDwellTimer === null) return;
        clearTimeout(_tabDwellTimer);
        _tabDwellTimer = null;
        var tabKey = _tabDwellTarget;
        _tabDwellTarget = null;
        if (tabKey && tabKey !== _activeTab) {
            _genreMode = false;
            _currentGenre = null;
            _switchTabInstant(tabKey);
        }
        _fadeContent(1);
    }

    // The 0.15 s content cross-fade (opacity only). V3.9 T4: .library-content
    // carries no static `will-change: opacity` (it promoted the tallest
    // scrolling content in the app permanently); the hint is owned here for
    // the fades and cleared once the fade-in has settled.
    function _fadeContent(opacity) {
        var container = _contentContainer;
        if (!container) return;
        if (_tabFadeClearTimer !== null) {
            clearTimeout(_tabFadeClearTimer);
            _tabFadeClearTimer = null;
        }
        container.style.willChange = 'opacity';
        // Fading in: commit the new content's layout first so the
        // transition applies cleanly.
        if (opacity === 1) void container.offsetHeight;
        container.style.transition = 'opacity 0.15s ease';
        container.style.opacity = String(opacity);
        if (opacity === 1) {
            _tabFadeClearTimer = setTimeout(function() {
                _tabFadeClearTimer = null;
                if (_contentContainer) _contentContainer.style.willChange = '';
            }, 200);
        }
    }

    function _switchTabInstant(tabKey) {
        _closeGenrePicker(false);
        _destroySongList();
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

        // V3.9 T1: same for the albums virtual grid — destroy() removes its
        // scroll listener from #library-content, which survives the tab swap.
        if (_albumsVirtualGrid) {
            _albumsVirtualGrid.destroy();
            _albumsVirtualGrid = null;
        }
        _albumsAll = null;

        _activeTab = tabKey;
        _markSubNavSelected(_tabIndex(tabKey));

        // Unregister old grid zone (resets focus index)
        FocusManager.unregisterZone('library-grid');
        FocusManager.unregisterZone('library-header');

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

    // The list the header asks for: a genre filter is `byGenre` (the server
    // orders it by name and has no sort for it), otherwise the chosen sort.
    function _albumList() {
        if (_albumGenre) return { type: 'byGenre', label: 'Name', extra: { genre: _albumGenre } };
        return ALBUM_SORTS[_albumSort];
    }

    function _loadAlbums(api) {
        var expected = _activeTab;
        var gen = ++_albumLoadGen;
        var list = _albumList();
        // V3.8: capture the library selection at fetch time so subsequent
        // pages stay scoped consistently across pagination.
        var libraryIds = AuthManager.getSelectedLibraries();
        // V3.9 S4 T1: with two or more libraries in scope, page through an
        // AlbumListCursor — one offset per library plus a k-way merge. The
        // V3.8-fix1 shape this replaces advanced ONE shared upstream offset
        // across the whole fan-out, so every library whose items lost the
        // merge's truncation was skipped past and could never appear again:
        // measured 400 of 1200 albums reachable with 3 libraries, 200 of 1200
        // with 7. The cursor also subsumes that code's cross-page dedupe.
        // Single-library and all-libraries (`libraryIds` null) keep the v3.8
        // call shape exactly — one unscoped request per page, no extra hop.
        var multi = libraryIds && libraryIds.length >= 2;
        var albumCursor = null;

        // A2: the header is there (and focusable) while the first page loads.
        if (!document.getElementById('library-header')) _mountAlbumsHeader(api);

        if (list.sample) {
            _albumLoader = null;
            _loadAlbumSample(api, gen, libraryIds);
            return;
        }

        function fetchPage(count, loaderOffset) {
            if (!multi) {
                return api.getAlbumList2(list.type, count, loaderOffset, libraryIds, list.extra);
            }
            if (!albumCursor) {
                albumCursor = api.createAlbumListCursor(list.type, libraryIds, count, list.extra);
            }
            return albumCursor.next(count);
        }

        _albumLoader = new SonanceUtils.PaginatedLoader(fetchPage, 50);

        _albumLoader.loadNext(function(albums, hasMore) {
            if (_activeTab !== expected || gen !== _albumLoadGen) {
                log('Library', 'Stale albums response ignored (active=' + _activeTab + ')');
                return;
            }
            if (!_contentContainer) return;
            _clearBelowHeader();

            if (albums.length === 0) {
                // The header stays, so another sort or filter is one press away.
                _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                    'No albums found'));
                _registerHeaderZone(_albumChips, 'nowplaying-bar');
                App.registerNowPlayingBarZone('library-header');
                return;
            }

            _renderAlbumsVirtual(albums, api);
            _updateLoadingIndicator(hasMore);
            _registerAlbumsGridZone(api);
        });

        // A2: the count, only because it is exact (the list's length, found
        // by offsets; js/api.js countAlbums). The line is blank until then.
        api.countAlbums(list.type, libraryIds, list.extra).then(function(n) {
            if (gen !== _albumLoadGen || _activeTab !== 'albums') return;
            var line = document.getElementById('library-header-count');
            if (line) {
                line.textContent = SonanceUtils.formatCount(n) + (n === 1 ? ' album' : ' albums') +
                    (_albumGenre ? ' \u00B7 ' + _albumGenre : '');
            }
        }).catch(function(err) {
            log('Library', 'Album count failed: ' + err.message);
        });
    }

    // =========================================
    //  Albums header: sort and filter (v3.10 A2, mockup 20)
    // =========================================

    var _albumChips = null;

    function _mountAlbumsHeader(api) {
        _albumChips = [
            { id: 'library-chip-sort', icon: 'sort', label: '',
                onActivate: function() { _cycleAlbumSort(api); } },
            { id: 'library-chip-filter', label: '',
                onActivate: function() { _openGenrePicker(api); } }
        ];
        _contentContainer.insertBefore(_renderHeader('Albums', '', _albumChips),
            _contentContainer.firstChild);
        _updateAlbumsHeader();
        _registerHeaderZone(_albumChips, 'library-grid');
    }

    function _updateAlbumsHeader() {
        var sortChip = document.getElementById('library-chip-sort');
        var filterChip = document.getElementById('library-chip-filter');
        var count = document.getElementById('library-header-count');
        if (sortChip) {
            sortChip.querySelector('.library-chip-label').textContent = 'Sort: ' + _albumList().label;
            // Under a genre filter the server's order is fixed (D55 pattern:
            // dimmed, still focusable, Enter does nothing).
            if (_albumGenre) sortChip.classList.add('is-unavailable');
            else sortChip.classList.remove('is-unavailable');
        }
        if (filterChip) {
            filterChip.querySelector('.library-chip-label').textContent =
                'Filter: ' + (_albumGenre || 'All genres');
        }
        if (count) count.textContent = '\u00A0';
    }

    function _cycleAlbumSort(api) {
        if (_albumGenre) return;
        _albumSort = (_albumSort + 1) % ALBUM_SORTS.length;
        // v3.12 R2: choosing Random (again) rolls a new sample.
        if (ALBUM_SORTS[_albumSort].sample) _albumRandom = null;
        _reloadAlbums(api);
    }

    // v3.12 R2 (D177): Random's list, one sample (getRandomAlbumSample), the
    // kept one when there is one for this scope. No PaginatedLoader, no
    // offsets and no offset-search count; the count line is the sample's
    // size, worded as a sample.
    function _loadAlbumSample(api, gen, libraryIds) {
        var scope = JSON.stringify(libraryIds || null);
        var kept = (_albumRandom && _albumRandom.scope === scope) ? _albumRandom.albums : null;
        var sample = kept ? Promise.resolve(kept) : api.getRandomAlbumSample(RANDOM_SAMPLE_SIZE, libraryIds);
        sample.then(function(albums) {
            if (_activeTab !== 'albums' || gen !== _albumLoadGen || !_contentContainer) return;
            _albumRandom = { scope: scope, albums: albums };
            _clearBelowHeader();
            var line = document.getElementById('library-header-count');
            if (line) {
                line.textContent = 'Random sample of ' + SonanceUtils.formatCount(albums.length) +
                    (albums.length === 1 ? ' album' : ' albums');
            }
            if (albums.length === 0) {
                _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                    'No albums found'));
                _registerHeaderZone(_albumChips, 'nowplaying-bar');
                App.registerNowPlayingBarZone('library-header');
                return;
            }
            _renderAlbumsVirtual(albums, api);
            _updateLoadingIndicator(false);
            _registerAlbumsGridZone(api);
        }).catch(function(err) {
            if (_activeTab !== 'albums' || gen !== _albumLoadGen || !_contentContainer) return;
            log('Library', 'Random albums failed: ' + err.message);
            _clearBelowHeader();
            _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                'Unable to load albums'));
            _registerHeaderZone(_albumChips, 'nowplaying-bar');
            App.registerNowPlayingBarZone('library-header');
        });
    }

    // A new sort or filter: the grid is rebuilt under the header, which keeps
    // its nodes (and the focus on its chip).
    function _reloadAlbums(api) {
        if (_albumsVirtualGrid) {
            _albumsVirtualGrid.destroy();
            _albumsVirtualGrid = null;
        }
        _albumsAll = null;
        _albumLoader = null;
        FocusManager.unregisterZone('library-grid');
        _clearBelowHeader();
        _updateAlbumsHeader();
        _loadAlbums(api);
    }

    // Everything in the content area after the header; its lazy images are
    // released and cancelled (D17's teardown path: nothing will show them).
    function _clearBelowHeader() {
        var header = document.getElementById('library-header');
        var c = _contentContainer;
        while (c.lastChild && c.lastChild !== header) {
            if (typeof LazyLoader !== 'undefined') LazyLoader.unobserveWithin(c.lastChild);
            c.removeChild(c.lastChild);
        }
    }

    function _openGenrePicker(api) {
        if (_genrePicker) return;
        var screen = _container && _container.querySelector('.library-screen');
        if (!screen) return;
        api.getGenres().then(function(genres) {
            if (_activeTab !== 'albums' || !_contentContainer || _genrePicker || !screen.parentNode) return;
            var items = [{ value: null, label: 'All genres', count: null }];
            (genres || []).slice().sort(function(a, b) {
                var an = String(a.value || '').toLowerCase();
                var bn = String(b.value || '').toLowerCase();
                return an < bn ? -1 : (an > bn ? 1 : 0);
            }).forEach(function(g) {
                if (g.value) items.push({ value: g.value, label: g.value, count: g.albumCount });
            });

            var panel = el('div', { className: 'library-genre-picker', id: 'library-genre-picker' });
            panel.appendChild(el('div', { className: 'genre-picker-title' }, 'Filter by genre'));
            var scroller = el('div', { className: 'genre-picker-scroll' });
            var mount = el('div', { className: 'genre-picker-list', id: 'genre-picker-list' });
            mount.addEventListener('click', function(ev) {
                var row = ev.target.closest('.genre-pick-row');
                if (row) _chooseGenre(api, items[parseInt(row.getAttribute('data-index'), 10)].value);
            });
            scroller.appendChild(mount);
            panel.appendChild(scroller);
            screen.appendChild(panel);

            var vg = SonanceUtils.createVirtualList({
                scrollContainer: scroller,
                mount: mount,
                items: items,
                renderItem: _renderGenrePickRow,
                zone: 'library-genre-picker'
            });
            _genrePicker = { panel: panel, vg: vg };
            FocusManager.registerZone('library-genre-picker', {
                selector: '#genre-picker-list .focusable',
                columns: 1,
                virtual: vg.zoneVirtual,
                onActivate: function(idx) { _chooseGenre(api, items[idx].value); },
                onKey: function(direction) {
                    // Nothing above the first row: Up would otherwise leave
                    // for the top nav. Back closes the picker.
                    var snap = FocusManager.snapshot();
                    return direction === 'up' && snap && snap.index === 0;
                },
                neighbors: {}
            });
            var current = 0;
            for (var i = 0; i < items.length; i++) {
                if (items[i].value === _albumGenre) { current = i; break; }
            }
            FocusManager.setActiveZone('library-genre-picker', current, true);
        }).catch(function(err) {
            log('Library', 'Genres for the filter failed: ' + err.message);
        });
    }

    function _renderGenrePickRow(item, index) {
        var row = el('div', { className: 'genre-pick-row focusable', 'data-index': String(index) });
        row.appendChild(el('div', { className: 'genre-pick-name' }, item.label));
        if (item.count) {
            row.appendChild(el('div', { className: 'genre-pick-count' },
                SonanceUtils.formatCount(item.count) + (item.count === 1 ? ' album' : ' albums')));
        }
        if (item.value === _albumGenre) row.appendChild(el('div', { className: 'genre-pick-check' }, '\u2713'));
        return row;
    }

    // Close the picker; with `refocus`, focus returns to the Filter chip.
    function _closeGenrePicker(refocus) {
        if (!_genrePicker) return;
        _genrePicker.vg.destroy();
        if (_genrePicker.panel.parentNode) _genrePicker.panel.parentNode.removeChild(_genrePicker.panel);
        _genrePicker = null;
        FocusManager.unregisterZone('library-genre-picker');
        if (refocus && FocusManager.hasZone('library-header')) {
            FocusManager.setActiveZone('library-header', 1, true);
        }
    }

    function _chooseGenre(api, value) {
        _closeGenrePicker(true);
        if (value === _albumGenre) return;
        _albumGenre = value;
        _reloadAlbums(api);
    }

    // V3.9 T1: per-item renderer for the albums VirtualGrid. The markup,
    // class names and data-* attributes are byte-identical to the pre-virtual
    // `_appendAlbumsToGrid` because `_onContentClick` routes on
    // `.album-grid-card` + `data-album-id`.
    function _renderAlbumCard(album, api) {
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

        return card;
    }

    // V3.9 T1: a recycle rebuilds the whole mounted band, so the node
    // FocusManager holds can go detached. Same handling as the Artists tab:
    // re-resolve the zone on the next tick, once VirtualGrid has finished its
    // DOM insertion. FocusManager keeps the logical index, so re-resolving is
    // enough — nothing needs to remember the element.
    function _reapplyGridFocusAfterRecycle() {
        if (!FocusManager.getActiveZone || FocusManager.getActiveZone() !== 'library-grid') return;
        var focused = FocusManager.getCurrentFocused();
        if (focused && focused.parentNode) return;
        setTimeout(function() {
            if (FocusManager.getActiveZone && FocusManager.getActiveZone() === 'library-grid') {
                FocusManager.setActiveZone('library-grid', undefined, true);
            }
        }, 0);
    }

    // V3.9 T1: read the real column count and row pitch back out of the
    // rendered grid. `VirtualGrid._calcColumns` assumes a 16px gap allowance;
    // `.library-albums-grid` uses a 20px column gap, which makes it over-count
    // by one (9 against the real 8) at 1920 wide. A wrong column count would
    // put the focus zone's row arithmetic out of step with what the user sees.
    function _measureAlbumGeometry() {
        if (!_albumsVirtualGrid) return null;
        var grid = _albumsVirtualGrid.getGridElement();
        if (!grid) return null;
        var cols = _getGridColumnCount(grid);
        if (!cols) return null;
        var out = { columns: cols };
        var cards = grid.children;
        if (cards.length > cols) {
            // Both offsetTops are inside the same absolutely-positioned inner
            // grid, so the difference is the exact row pitch including the gap.
            var pitch = cards[cols].offsetTop - cards[0].offsetTop;
            if (pitch > 0) out.itemHeight = pitch;
        }
        return out;
    }

    // V3.9 T1: mount the Albums tab as a VirtualGrid over `_albumsAll`.
    // Unlike Artists there is no item-count threshold: the tab is paginated,
    // so it always grows past any threshold worth having, and a single render
    // path is cheaper to keep correct than two.
    function _renderAlbumsVirtual(albums, api) {
        // activate() can re-enter _loadTabContent without a deactivate(), and
        // _showLoading() has already orphaned the old mount — destroy first or
        // the previous instance keeps its scroll listener on #library-content,
        // which outlives the mount.
        if (_albumsVirtualGrid) {
            _albumsVirtualGrid.destroy();
            _albumsVirtualGrid = null;
        }

        // The mount hosts the spacer + an absolutely-positioned inner grid, so
        // it must not be display:grid itself. It carries #library-grid so the
        // existing focus-zone selector and click delegation still resolve.
        var mount = el('div', {
            className: 'library-albums-virtual-mount',
            id: 'library-grid'
        });
        _contentContainer.appendChild(mount);

        _albumsAll = albums.slice();

        _albumsVirtualGrid = new SonanceUtils.VirtualGrid({
            scrollContainer: _getScrollContainer(),
            mountContainer: mount,
            items: _albumsAll,
            renderItem: function(album /*, index */) {
                return _renderAlbumCard(album, api);
            },
            itemHeight: SonanceUtils.px(ALBUM_ITEM_HEIGHT),
            itemMinWidth: SonanceUtils.px(ALBUM_ITEM_MIN_WIDTH),
            gridClassName: 'library-grid library-albums-grid',
            bufferRows: 2,
            onRangeRender: function(elements, startIndex, endIndex) {
                _reapplyGridFocusAfterRecycle();
                // v3.10 R1.6: the band (viewport + 2 buffer rows) reaches the
                // end of the loaded albums before the focus does; triggered
                // by the focus alone, the next page came late, the band sat
                // cut short and then grew by 2-3 rows at once. Its last
                // index triggers the page too.
                _maybeLoadMoreAlbums(endIndex - 1, api);
            }
        });
        _albumsVirtualGrid.init();

        var geom = _measureAlbumGeometry();
        if (geom) _albumsVirtualGrid.refresh(geom);
    }

    // V3.9 T1: pagination trigger, carried over from T5. `_albumLoader.offset`
    // is the loaded item count — PaginatedLoader advances it by items.length —
    // so no DOM query is needed, and with a virtual grid the mounted card
    // count is no longer the loaded count anyway. Trigger two full rows ahead:
    // on an 8-column grid the old 5-item margin was under one row, so the user
    // reached the bottom before the next page landed.
    function _maybeLoadMoreAlbums(idx, api) {
        if (!_albumLoader || !_albumLoader.hasMore || _albumLoader.loading) return;
        if (!_albumsVirtualGrid || !_albumsAll) return;
        var cols = _albumsVirtualGrid.getColumns();
        if (_albumLoader.offset - idx > cols * 2) return;

        var loader = _albumLoader;
        _albumLoader.loadNext(function(albums, hasMore) {
            if (_activeTab !== 'albums' || loader !== _albumLoader) return;
            if (!_albumsVirtualGrid || !_albumsAll) return;
            for (var i = 0; i < albums.length; i++) {
                _albumsAll.push(albums[i]);
            }
            _albumsVirtualGrid.refresh({ items: _albumsAll });
            _updateLoadingIndicator(hasMore);
        });
    }

    // R1.5 (D97): restarted by every focus move, so passing over cards
    // prefetches nothing. When it fires the card must still be the focused
    // one (focus may have left the grid meanwhile). getAlbum goes through
    // _cachedRequest: the album screen's own request for it, and a second
    // prefetch, join the one in flight (v3.9 T7) or hit memory. No DOM reads.
    function _schedulePrefetch(idx, api) {
        if (_prefetchTimer !== null) clearTimeout(_prefetchTimer);
        _prefetchTimer = setTimeout(function() {
            _prefetchTimer = null;
            if (_activeTab !== 'albums' || !_albumsAll || !_albumsAll[idx]) return;
            if (FocusManager.getActiveZone() !== 'library-grid') return;
            var snap = FocusManager.snapshot();
            if (!snap || snap.index !== idx) return;
            api.getAlbum(_albumsAll[idx].id).catch(function() {});
        }, PREFETCH_DWELL_MS);
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

    // v3.10 D76: the virtual grids' scroll-follow. scrollIntoView left a
    // focused card's scale(1.12) and 0.4rem ring cut at the edge of
    // #library-content (8-15 px of the card itself at 100-200 % before S3).
    function _revealGridCard(idx, element) {
        SonanceUtils.revealInScroller(element, _getScrollContainer(), SonanceUtils.px(24));
    }

    function _registerAlbumsGridZone(api) {
        var cols = _albumsVirtualGrid ? _albumsVirtualGrid.getColumns() : 8;

        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            // V3.9 T1: FocusManager navigates the full logical collection via
            // these hooks while the DOM holds only the visible band + buffer.
            virtual: {
                getCount: function() {
                    return _albumsVirtualGrid ? _albumsVirtualGrid.getCount() : 0;
                },
                getItemAt: function(idx) {
                    if (!_albumsVirtualGrid) return null;
                    return _albumsVirtualGrid.ensureIndexVisible(idx);
                },
                // D76: room for the 1.12 card and its ring at the edge.
                reveal: _revealGridCard
            },
            onActivate: function(idx, element) {
                // V3-6-fix NAV-1: snapshot grid focus before drilling down
                // so Back from the album/artist detail (or NP) restores it.
                // The snapshot is zone + index, so it survives the card being
                // recycled out of the DOM while the detail screen is open.
                if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                if (element) element.click();
            },
            onFocus: function(idx) {
                // VirtualGrid owns the scroll via ensureIndexVisible, so there
                // are no layout reads and no DOM queries here — that is what
                // keeps V3.9 T5's zero-querySelectorAll guarantee intact.
                _maybeLoadMoreAlbums(idx, api);
                _schedulePrefetch(idx, api);
            },
            neighbors: {
                /* V3-6-fix NAV-2: Left enters side sub-nav. v3.10 A2: Up
                   goes to the header (Sort, Filter), then the top nav. */
                left: 'library-subnav',
                up: 'library-header',
                down: 'nowplaying-bar'
            }
        });

        // Update NP bar to point up to grid
        App.registerNowPlayingBarZone('library-grid');

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
            _renderArtists(artists || [], api);
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

            // V3.9 T6: build the chunk into a fragment and attach it once
            // rather than appending up to ARTISTS_CHUNK_SIZE nodes into the
            // live grid one at a time.
            var stop = Math.min(artists.length, _artistsRenderedCount + ARTISTS_CHUNK_SIZE);
            var chunk = document.createDocumentFragment();
            for (var i = _artistsRenderedCount; i < stop; i++) {
                chunk.appendChild(_renderArtistCard(artists[i], api));
            }
            grid.appendChild(chunk);
            _artistsRenderedCount = stop;

            // Lazy images for the new cards are picked up automatically by
            // SonanceComponents.renderArtistAvatar → LazyLoader.observe.

            if (_artistsRenderedCount < artists.length) {
                _artistsChunkRaf = requestAnimationFrame(appendChunk);
            } else if (!_artistsChunkedZoneRegistered) {
                var artCols = _getGridColumnCount(grid) || 6;
                _registerGridZone(artCols);
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
            itemHeight: SonanceUtils.px(ARTIST_ITEM_HEIGHT),
            itemMinWidth: SonanceUtils.px(ARTIST_ITEM_MIN_WIDTH),
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
        // v3.10 S5 (D11): columns and row pitch from the rendered grid, as
        // the Albums tab does; the px(180) pitch and the minmax column
        // estimate were never corrected, so deep rows drifted from the band.
        var artistCols = _getGridColumnCount(_artistsVirtualGrid.getGridElement());
        if (artistCols) _artistsVirtualGrid.refresh({ columns: artistCols });
        var artistPitch = _artistsVirtualGrid.measureRowPitch();
        if (artistPitch > 0) _artistsVirtualGrid.refresh({ itemHeight: artistPitch });

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
                },
                // D76: room for the 1.12 card and its ring at the edge.
                reveal: _revealGridCard
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
                up: 'topnav',
                down: 'nowplaying-bar'
            }
        });

        App.registerNowPlayingBarZone('library-grid');

        App.hideColourHints();
    }

    // --- Songs Tab (v3.10 A1: the whole library; R1.7: virtual) ---

    function _loadSongs(api) {
        var expected = _activeTab;
        var pager = api.createSongPager('all', null, AuthManager.getSelectedLibraries(), SONG_PAGE_SIZE);
        pager.count().then(function(total) {
            if (_activeTab !== expected || _genreMode || !_contentContainer) return;
            if (total === 0) {
                _renderEmpty('No songs found');
                return;
            }
            var list = _newSongList(pager, 'songs');
            // Page 0 is in the response cache (count() read it): fill it in
            // before mounting, so the first band shows rows, not placeholders.
            _loadSongPage(list, 0).then(function() {
                if (_songList !== list || !_contentContainer) return;
                _contentContainer.textContent = '';
                // A1: the count is the list's exact length. No Sort chip and
                // no A–Z rail: the server's empty-query order is creation
                // order, and it cannot sort songs another way (S5, live).
                var chips = [{ id: 'library-chip-shuffle', label: 'Shuffle all',
                    onActivate: function() { _shuffleAll(api); } }];
                _contentContainer.appendChild(_renderHeader('Songs',
                    SonanceUtils.formatCount(total) + ' songs', chips, true));
                _mountSongList(list, _renderSongsTabRow);
                _registerHeaderZone(chips, 'library-grid');
            });
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            log('Library', 'Error loading songs: ' + err.message);
            _renderEmpty('Unable to load songs');
        });
    }

    // A1: "Shuffle all" plays 200 random songs from the libraries in scope.
    function _shuffleAll(api) {
        api.getRandomSongs(200, AuthManager.getSelectedLibraries()).then(function(songs) {
            if (songs && songs.length) Player.playAlbum(songs, 0);
        }).catch(function(err) {
            log('Library', 'Shuffle all failed: ' + err.message);
        });
    }

    // A row of the Songs tab (mockup 16): thumbnail, title, artist, album,
    // duration. `song` is undefined while its page is on the way: the same
    // row, empty (.song-row-pending), so the pitch and the indices hold.
    function _renderSongsTabRow(song, index) {
        var row = el('div', {
            className: 'song-row song-row-wide focusable' + (song ? '' : ' song-row-pending'),
            'data-song-index': String(index)
        });
        if (song) row.setAttribute('data-song-id', song.id);
        row.appendChild(SonanceComponents.renderRowThumb(song, 'song-row-thumb song-row-thumb-wide'));
        row.appendChild(el('div', { className: 'song-row-title' },
            song ? (song.title || 'Unknown') : '\u00A0'));
        row.appendChild(el('div', { className: 'song-row-artist' },
            song ? (song.artist || 'Unknown Artist') : '\u00A0'));
        row.appendChild(el('div', { className: 'song-row-album' },
            song ? (song.album || '') : '\u00A0'));
        row.appendChild(el('div', { className: 'song-row-duration' },
            song ? (song._formattedDuration || formatDuration(song.duration)) : ''));
        return row;
    }

    // A genre's song row (unchanged markup since v3; R5 artist line).
    function _renderGenreSongRow(song, index) {
        var row = el('div', {
            className: 'song-row focusable' + (song ? '' : ' song-row-pending'),
            'data-song-index': String(index)
        });
        if (song) row.setAttribute('data-song-id', song.id);
        row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));
        var info = el('div', { className: 'song-row-info' });
        info.appendChild(el('div', { className: 'song-row-title' },
            song ? (song.title || 'Unknown') : '\u00A0'));
        var meta = '\u00A0';
        if (song) {
            meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' \u00B7 ' + song.album;
        }
        info.appendChild(el('div', { className: 'song-row-meta' }, meta));
        row.appendChild(info);
        row.appendChild(el('div', { className: 'song-row-duration' },
            song ? (song._formattedDuration || formatDuration(song.duration)) : ''));
        return row;
    }

    // =========================================
    //  Paged song lists (v3.10 A1, R1.7)
    // =========================================

    function _newSongList(pager, kind) {
        _destroySongList();
        _songList = {
            pager: pager, kind: kind,
            items: new Array(pager.total),
            pages: {}, loaded: [], vg: null
        };
        return _songList;
    }

    function _destroySongList() {
        if (_songList && _songList.vg) _songList.vg.destroy();
        _songList = null;
    }

    // Fetch page p once; on arrival fill the items and re-render the rows of
    // it that are mounted. A failed page is forgotten, so the next band
    // movement asks again.
    function _loadSongPage(list, p) {
        if (list.pages[p]) return list.pages[p];
        var from = p * SONG_PAGE_SIZE;
        var to = Math.min(list.items.length, from + SONG_PAGE_SIZE);
        var promise = list.pager.range(from, to).then(function(songs) {
            if (_songList !== list) return;
            for (var i = 0; i < songs.length; i++) list.items[from + i] = songs[i];
            list.loaded.push(p);
            _trimSongPages(list, p);
            if (list.vg) list.vg.updateItems(from, to);
        }, function(err) {
            delete list.pages[p];
            log('Library', 'Song page ' + p + ' failed: ' + err.message);
        });
        list.pages[p] = promise;
        return promise;
    }

    // Keep the band's pages loaded, half a page ahead either way.
    function _loadSongPagesFor(list, start, end) {
        var last = Math.floor((list.items.length - 1) / SONG_PAGE_SIZE);
        var p0 = Math.max(0, Math.floor((start - SONG_PAGE_SIZE / 2) / SONG_PAGE_SIZE));
        var p1 = Math.min(last, Math.floor((end + SONG_PAGE_SIZE / 2) / SONG_PAGE_SIZE));
        for (var p = p0; p <= p1; p++) _loadSongPage(list, p);
    }

    // Memory bound: past SONG_PAGES_KEPT pages, forget the one farthest from
    // the page just loaded (so never one the band shows; it is re-fetched,
    // usually from the response cache, if the user scrolls back).
    function _trimSongPages(list, near) {
        while (list.loaded.length > SONG_PAGES_KEPT) {
            var far = 0;
            for (var i = 1; i < list.loaded.length; i++) {
                if (Math.abs(list.loaded[i] - near) > Math.abs(list.loaded[far] - near)) far = i;
            }
            var q = list.loaded.splice(far, 1)[0];
            delete list.pages[q];
            var from = q * SONG_PAGE_SIZE;
            var to = Math.min(list.items.length, from + SONG_PAGE_SIZE);
            for (var k = from; k < to; k++) list.items[k] = undefined;
        }
    }

    function _mountSongList(list, renderRow) {
        var mount = el('div', { className: 'library-song-list', id: 'library-grid' });
        _contentContainer.appendChild(mount);
        list.vg = SonanceUtils.createVirtualList({
            scrollContainer: _getScrollContainer(),
            mount: mount,
            items: list.items,
            renderItem: renderRow,
            zone: 'library-grid',
            onRangeRender: function(elements, start, end) {
                _loadSongPagesFor(list, start, end);
            }
        });
        _registerSongListZone(list);
    }

    // Enter (or a click) on row idx. Songs: play it and the next 199 in list
    // order. A genre's song opens its album, as since V3.7-fix10. A row whose
    // page is still on the way acts when it arrives.
    function _activateSong(idx) {
        var list = _songList;
        if (!list || idx < 0 || idx >= list.items.length) return;
        var end = list.kind === 'genre' ? idx + 1 : Math.min(list.items.length, idx + SONG_QUEUE_SPAN);
        var loads = [];
        for (var p = Math.floor(idx / SONG_PAGE_SIZE); p * SONG_PAGE_SIZE < end; p++) {
            loads.push(_loadSongPage(list, p));
        }
        Promise.all(loads).then(function() {
            if (_songList !== list || !list.items[idx]) return;
            if (list.kind === 'genre') {
                var song = list.items[idx];
                if (!song.albumId) return;
                log('Library', 'Genre song activated');
                App.navigateTo('album', { id: song.albumId, title: song.album || '' }, 'zoom-in');
                return;
            }
            var songs = [];
            for (var i = idx; i < end && list.items[i]; i++) songs.push(list.items[i]);
            log('Library', 'Song activated');
            Player.playAlbum(songs, 0);
        });
    }

    // v3.10 A5: the options sheet for row idx. A row whose page has not
    // arrived (.song-row-pending) opens it when the page lands, as Enter
    // plays it then, unless the focus has moved on meanwhile.
    function _longPressSong(idx) {
        var list = _songList;
        if (!list || idx < 0 || idx >= list.items.length) return;
        if (list.items[idx]) {
            OptionsSheet.open({ song: list.items[idx] });
            return;
        }
        _loadSongPage(list, Math.floor(idx / SONG_PAGE_SIZE)).then(function() {
            if (_songList !== list || !list.items[idx]) return;
            var snap = FocusManager.snapshot();
            if (!snap || snap.zone !== 'library-grid' || snap.index !== idx) return;
            OptionsSheet.open({ song: list.items[idx] });
        });
    }

    function _registerSongListZone(list) {
        var hasHeader = !!document.getElementById('library-header');
        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: 1,
            virtual: list.vg.zoneVirtual,
            onActivate: function(idx) {
                // V3-6-fix NAV-1: Back from the album (or NP) restores the row.
                if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                _activateSong(idx);
            },
            // v3.10 A5: hold OK for the options sheet.
            onLongPress: function(idx) { _longPressSong(idx); },
            onColourButton: function(colour, idx) {
                var track = _songList && _songList.items[idx];
                if (!track) return;
                if (colour === 'yellow') {
                    Player.addToQueue(track);
                    App.showToast('Added to queue');
                } else if (colour === 'blue') {
                    Player.addToQueueNext(track);
                    App.showToast('Playing next');
                }
            },
            neighbors: {
                left: 'library-subnav',
                up: hasHeader ? 'library-header' : 'topnav',
                down: 'nowplaying-bar'
            }
        });
        App.showColourHints([
            { colour: 'yellow', label: 'Add to queue' },
            { colour: 'blue', label: 'Play next' }
        ]);
        App.registerNowPlayingBarZone('library-grid');
    }

    // =========================================
    //  Header (v3.10 A1/A2): title, count, chips
    // =========================================

    // chips: [{ id, label, icon (an SVG_PATHS key, optional), onActivate }]
    function _renderHeader(title, count, chips, listHeader) {
        var header = el('div', { className: 'library-header' + (listHeader ? ' library-header-list' : ''), id: 'library-header' });
        var text = el('div', { className: 'library-header-text' });
        text.appendChild(el('div', { className: 'library-header-title' }, title));
        // A blank line keeps its height, so the list does not move when the
        // count arrives.
        text.appendChild(el('div', { className: 'library-header-count', id: 'library-header-count' },
            count || '\u00A0'));
        header.appendChild(text);
        var row = el('div', { className: 'library-header-chips' });
        chips.forEach(function(chip) {
            var node = el('div', { className: 'library-chip focusable', id: chip.id });
            if (chip.icon) {
                var icon = SonanceUtils.createSvg(SonanceUtils.SVG_PATHS[chip.icon]);
                icon.setAttribute('class', 'library-chip-icon');
                node.appendChild(icon);
            }
            node.appendChild(el('span', { className: 'library-chip-label' }, chip.label));
            node.addEventListener('click', function() { if (chip.onActivate) chip.onActivate(); });
            row.appendChild(node);
        });
        header.appendChild(row);
        return header;
    }

    function _registerHeaderZone(chips, down) {
        FocusManager.registerZone('library-header', {
            selector: '#library-header .focusable',
            columns: chips.length,
            // D54: Up from the list enters on the first chip, not the last
            // (FocusManager's default from below).
            entryIndex: 0,
            onActivate: function(idx) {
                if (chips[idx] && chips[idx].onActivate) chips[idx].onActivate();
            },
            onFocus: function() {
                // The header scrolls with the list: bring it back into view.
                var sc = _getScrollContainer();
                if (sc) sc.scrollTop = 0;
            },
            neighbors: { left: 'library-subnav', up: 'topnav', down: down || 'library-grid' }
        });
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
        FocusManager.unregisterZone('library-header');
        FocusManager.unregisterZone('content');
        _destroySongList();

        _contentContainer.textContent = '';

        // Heading (non-focusable) \u2014 hardware Back returns to the genre grid
        var header = el('div', { className: 'genre-songs-header' });
        header.appendChild(el('div', { className: 'genre-songs-title' }, genreName));
        // v3.10 A1: the genre's exact song count, once the pager knows it.
        var countEl = el('div', { className: 'library-header-count' }, '\u00A0');
        header.appendChild(countEl);
        _contentContainer.appendChild(header);

        // Loading state
        var loadingWrap = el('div', { id: 'library-grid' });
        for (var i = 0; i < 10; i++) {
            loadingWrap.appendChild(el('div', { className: 'skeleton skeleton-song-row' }));
        }
        _contentContainer.appendChild(loadingWrap);

        // v3.10 A1: every song of the genre, paged by offset (it stopped at 50).
        var pager = api.createSongPager('genre', genreName, AuthManager.getSelectedLibraries(), SONG_PAGE_SIZE);
        var stale = function() { return !_genreMode || _currentGenre !== genreName || !_contentContainer; };
        pager.count().then(function(total) {
            if (stale()) return;
            if (total === 0) {
                if (loadingWrap.parentNode) loadingWrap.parentNode.removeChild(loadingWrap);
                _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                    'No songs found in ' + genreName));
                return;
            }
            var list = _newSongList(pager, 'genre');
            return _loadSongPage(list, 0).then(function() {
                if (stale() || _songList !== list) return;
                if (loadingWrap.parentNode) loadingWrap.parentNode.removeChild(loadingWrap);
                countEl.textContent = SonanceUtils.formatCount(total) + ' songs';
                _mountSongList(list, _renderGenreSongRow);
                // V3-6-fix3 NAV-2: focus the first song row when a genre
                // opens. The active zone is usually 'library-subnav' coming
                // in, so pass force=true.
                FocusManager.setActiveZone('library-grid', 0, true);
            });
        }).catch(function(err) {
            if (stale()) return;
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
        if (_genrePicker) {
            _closeGenrePicker(true);
            return true;
        }
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

    function _registerGridZone(cols) {
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
                /* V3-6-fix NAV-2: Up goes to top nav, Left enters side sub-nav. */
                left: 'library-subnav',
                up: 'topnav',
                down: 'nowplaying-bar'
            }
        };

        // v3.10 R1.7: the song lists register their own virtual zone
        // (_registerSongListZone), with the colour buttons.
        App.hideColourHints();

        FocusManager.registerZone('library-grid', zoneConfig);

        // Update NP bar to point up to grid
        App.registerNowPlayingBarZone('library-grid');
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

        App.registerNowPlayingBarZone('library-subnav');
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        // D90: a dwell still pending when the screen goes is not built, but
        // its tab stays the selected one for the next visit.
        if (_tabDwellTimer !== null) {
            clearTimeout(_tabDwellTimer);
            _tabDwellTimer = null;
            if (_tabDwellTarget) _activeTab = _tabDwellTarget;
            _tabDwellTarget = null;
        }
        if (_prefetchTimer !== null) {
            clearTimeout(_prefetchTimer);
            _prefetchTimer = null;
        }
        _closeGenrePicker(false);
        _container = null;
        _contentContainer = null;
        _genreMode = false;
        _currentGenre = null;
        _destroySongList();
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

        // V3.9 T1
        if (_albumsVirtualGrid) {
            _albumsVirtualGrid.destroy();
            _albumsVirtualGrid = null;
        }
        _albumsAll = null;
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

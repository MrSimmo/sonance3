/* ============================================
   Sonance — Search Screen
   On-screen keyboard + live search results
   ============================================ */

var SearchScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _query = '';
    var _debounceTimer = null;
    var _searchInputDisplay = null;
    var _resultsContainer = null;
    // V3.7-fix12: track screen activity so late-arriving search promises that
    // resolve after a Back can ignore their result. Also track any virtual
    // grid instances spun up for very long result sections (>30 rows) so we
    // can tear them down on deactivate.
    var _active = false;
    var _virtualGrids = [];
    var SEARCH_VIRTUAL_THRESHOLD = 30;
    // v3.10 R1.6: one slot per result, in focus order: the row node of a
    // short section, or { vg, i } for row i of a virtualised one. With a
    // virtualised section the results zone navigates these slots (a
    // `virtual` zone), so focus reaches rows that are not mounted; the
    // selector zone it had only ever saw the mounted band.
    var _resultSlots = [];

    // V3.7-fix10: delegated click handler for all search result types and
    // quick-access tiles. Routes by data-type / data-category.
    function _onResultsClick(ev) {
        var t = ev.target;
        var qa = t.closest('.search-qa-tile');
        if (qa) {
            var qaName = qa.getAttribute('data-category');
            var qaType = qa.getAttribute('data-type');
            for (var k = 0; k < QA_ITEMS.length; k++) {
                if (QA_ITEMS[k].name === qaName && QA_ITEMS[k].type === qaType) {
                    _handleQuickAccess(QA_ITEMS[k]);
                    return;
                }
            }
            return;
        }
        var item = t.closest('.search-result-item');
        if (!item) return;
        var type = item.getAttribute('data-type');
        var id = item.getAttribute('data-id');
        if (!id) return;
        if (type === 'artist') {
            log('Search', 'Artist result clicked');
            App.navigateTo('artist', { id: id }, 'zoom-in');
        } else if (type === 'album') {
            var albumTitle = item.getAttribute('data-album-title') || '';
            App.navigateTo('album', { id: id, title: albumTitle }, 'zoom-in');
        } else if (type === 'song') {
            var songAlbumId = item.getAttribute('data-album-id');
            if (songAlbumId) {
                var songAlbumTitle = item.getAttribute('data-album-title') || '';
                log('Search', 'Song result clicked');
                App.navigateTo('album', { id: songAlbumId, title: songAlbumTitle }, 'zoom-in');
            }
        }
    }
    var _currentResultSongs = null; // Song data for colour button support

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.search-right');
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

    // Keyboard characters: A-Z then 0-9
    var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;
        _query = '';

        var wrapper = el('div', { className: 'search-screen' });

        // --- LEFT PANEL (380px) ---
        var leftPanel = el('div', { className: 'search-left' });

        // Heading
        leftPanel.appendChild(el('div', { className: 'search-heading' }, 'Search'));

        // Search input display bar
        var inputBar = el('div', { className: 'search-input-bar' });

        var searchIcon = createSvg(SVG_PATHS.search);
        searchIcon.style.width = SonanceUtils.rem(20);
        searchIcon.style.height = SonanceUtils.rem(20);
        searchIcon.style.fill = 'var(--text-muted)';
        searchIcon.style.flexShrink = '0';
        inputBar.appendChild(searchIcon);

        _searchInputDisplay = el('div', {
            className: 'search-input-text',
            id: 'search-input-text'
        }, 'Search artists, albums, songs...');
        inputBar.appendChild(_searchInputDisplay);

        // Clear button (hidden when query empty)
        var clearBtn = el('button', {
            className: 'search-clear-btn',
            id: 'search-clear-btn',
            style: { display: 'none' }
        }, '\u00D7');
        clearBtn.addEventListener('click', function() {
            _clearSearch();
        });
        inputBar.appendChild(clearBtn);

        leftPanel.appendChild(inputBar);

        // On-screen keyboard (9-column grid)
        var keyboard = el('div', { className: 'search-keyboard', id: 'search-keyboard' });

        // A-Z, 0-9 keys
        KEYS.forEach(function(key) {
            var btn = el('button', {
                className: 'kb-key focusable',
                'data-key': key
            }, key);
            btn.addEventListener('click', function() {
                _appendChar(key);
            });
            keyboard.appendChild(btn);
        });

        // SPACE key (spans 4 columns)
        var spaceBtn = el('button', {
            className: 'kb-space focusable',
            'data-key': 'SPACE'
        }, 'SPACE');
        spaceBtn.addEventListener('click', function() {
            _appendChar(' ');
        });
        keyboard.appendChild(spaceBtn);

        // Spacer (2 columns, non-focusable)
        keyboard.appendChild(el('div', { className: 'kb-spacer' }));

        // DEL key (spans 3 columns)
        var delBtn = el('button', {
            className: 'kb-del focusable',
            'data-key': 'DEL'
        }, '\u232B DEL');
        delBtn.addEventListener('click', function() {
            _deleteChar();
        });
        keyboard.appendChild(delBtn);

        leftPanel.appendChild(keyboard);
        wrapper.appendChild(leftPanel);

        // --- RIGHT PANEL (results) ---
        var rightPanel = el('div', { className: 'search-right' });
        _resultsContainer = el('div', {
            className: 'search-results-container',
            id: 'search-results'
        });
        rightPanel.appendChild(_resultsContainer);
        wrapper.appendChild(rightPanel);

        // V3.7-fix10: one delegated click handler for all result tiles/rows.
        _resultsContainer.addEventListener('click', _onResultsClick);

        container.appendChild(wrapper);

        // Initial: show quick access
        _renderQuickAccess();

        log('Search', 'Search screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;
        _registerFocusZones();
    }

    // =========================================
    //  Input Management
    // =========================================

    function _appendChar(ch) {
        _query += ch;
        _updateInputDisplay();
        _triggerSearch();
    }

    function _deleteChar() {
        if (_query.length > 0) {
            _query = _query.slice(0, -1);
            _updateInputDisplay();
            _triggerSearch();
        }
    }

    function _clearSearch() {
        _query = '';
        _updateInputDisplay();
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        _renderQuickAccess();
        _registerResultsZone();
    }

    function _updateInputDisplay() {
        if (!_searchInputDisplay) return;

        var clearBtn = document.getElementById('search-clear-btn');

        if (_query.length > 0) {
            _searchInputDisplay.textContent = _query;
            _searchInputDisplay.classList.add('has-text');
            if (clearBtn) clearBtn.style.display = 'flex';
        } else {
            _searchInputDisplay.textContent = 'Search artists, albums, songs...';
            _searchInputDisplay.classList.remove('has-text');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    // =========================================
    //  Search Logic (debounced)
    // =========================================

    function _triggerSearch() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
        }

        if (_query.trim().length === 0) {
            _renderQuickAccess();
            _registerResultsZone();
            return;
        }

        _debounceTimer = setTimeout(function() {
            _performSearch(_query);
        }, 300);
    }

    function _performSearch(query) {
        var api = App.getApi();
        if (!api) return;

        _renderLoading();

        var libraryIds = AuthManager.getSelectedLibraries();
        api.search3(query, {
            artistCount: 5,
            albumCount: 10,
            songCount: 10
        }, libraryIds).then(function(results) {
            // V3.7-fix12: ignore late results when the user has already
            // navigated away (Back during a 300 ms debounce or fetch in flight).
            if (!_active) return;
            // Ignore stale results if query changed
            if (_query !== query) return;
            _renderResults(results, api);
            _registerResultsZone();
        }).catch(function(err) {
            if (!_active) return;
            log('Search', 'Search error: ' + err.message);
            _renderEmpty('Search failed. Please try again.');
        });
    }

    // =========================================
    //  Quick Access (empty state)
    // =========================================

    // V3-6-fix GFX-5: Quick Access tiles now mirror the Library → Genres
    // tile style — coloured gradient block with a label, scale(1.08) on
    // focus, no horizontal icon row. Each tile gets a unique gradient
    // (Apple Music style) that matches the existing genre palette.
    var QA_ITEMS = [
        { name: 'Favourites',     type: 'starred',  gradient: 'linear-gradient(135deg, #e44d8a, #be185d)' },
        { name: 'Recently Added', type: 'newest',   gradient: 'linear-gradient(135deg, #16a34a, #15803d)' },
        { name: 'Most Played',    type: 'frequent', gradient: 'linear-gradient(135deg, #2563eb, #1d4ed8)' },
        { name: 'Rock',           type: 'genre',    gradient: 'linear-gradient(135deg, #ea580c, #c2410c)' },
        { name: 'Jazz',           type: 'genre',    gradient: 'linear-gradient(135deg, #7c3aed, #4f46e5)' },
        { name: 'Electronic',     type: 'genre',    gradient: 'linear-gradient(135deg, #0891b2, #0e7490)' }
    ];

    function _renderQuickAccess() {
        if (!_resultsContainer) return;
        log('Search', 'renderSearchQuickAccess called');
        _destroyVirtualGrids();
        _resultsContainer.textContent = '';

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' }, 'Quick Access'));

        var grid = el('div', { className: 'search-quickaccess-grid', id: 'search-quickaccess' });

        QA_ITEMS.forEach(function(cat) {
            var card = el('div', {
                className: 'search-qa-tile focusable',
                'data-category': cat.name,
                'data-type': cat.type
            });
            card.style.background = cat.gradient;
            card.appendChild(el('div', { className: 'search-qa-tile-name' }, cat.name));

            grid.appendChild(card);
        });

        _resultsContainer.appendChild(grid);
    }

    function _handleQuickAccess(cat) {
        var api = App.getApi();
        if (!api) return;

        var libraryIds = AuthManager.getSelectedLibraries();

        if (cat.type === 'genre') {
            _query = cat.name;
            _updateInputDisplay();
            _performSearch(cat.name);
        } else if (cat.type === 'newest') {
            _renderLoading();
            api.getAlbumList2('newest', 10, 0, libraryIds).then(function(albums) {
                if (!_active) return;
                _renderAlbumResults(albums || [], api, 'Recently Added');
                _registerResultsZone();
            }).catch(function() { if (_active) _renderEmpty('Unable to load.'); });
        } else if (cat.type === 'frequent') {
            _renderLoading();
            api.getAlbumList2('frequent', 10, 0, libraryIds).then(function(albums) {
                if (!_active) return;
                if (!albums || albums.length === 0) {
                    // Navidrome may not have play stats — fall back to random
                    return api.getAlbumList2('random', 10, 0, libraryIds).then(function(rand) {
                        if (!_active) return;
                        _renderAlbumResults(rand || [], api, 'Most Played');
                        _registerResultsZone();
                    });
                }
                _renderAlbumResults(albums, api, 'Most Played');
                _registerResultsZone();
            }).catch(function() { if (_active) _renderEmpty('Unable to load.'); });
        } else if (cat.type === 'starred') {
            _renderLoading();
            api.getStarred2(libraryIds).then(function(starred) {
                if (!_active) return;
                var albums = (starred && starred.album) || [];
                _renderAlbumResults(albums, api, 'Favourites');
                _registerResultsZone();
            }).catch(function() { if (_active) _renderEmpty('Unable to load.'); });
        }
    }

    // =========================================
    //  Render: Album Results (for Quick Access)
    // =========================================

    function _renderAlbumResults(albums, api, label) {
        if (!_resultsContainer) return;
        _destroyVirtualGrids();
        _resultsContainer.textContent = '';

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' }, label));

        if (albums.length === 0) {
            _resultsContainer.appendChild(el('div', { className: 'search-no-results' },
                'No albums found'));
            return;
        }

        var list = el('div', { className: 'search-results-list', id: 'search-results-list' });
        albums.forEach(function(album) {
            list.appendChild(_createAlbumResultItem(album, api));
        });
        _resultsContainer.appendChild(list);
    }

    // =========================================
    //  Render: Search Results
    // =========================================

    function _renderResults(results, api) {
        if (!_resultsContainer) return;
        _destroyVirtualGrids();
        _resultsContainer.textContent = '';
        _currentResultSongs = []; // Maps focusable index → song data (null for non-songs)
        _resultSlots = [];

        var totalResults = results.artist.length + results.album.length + results.song.length;

        if (totalResults === 0) {
            _renderEmpty('No results for \u201C' + _query + '\u201D');
            return;
        }

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' },
            'Results (' + totalResults + ')'));

        var list = el('div', { className: 'search-results-list', id: 'search-results-list' });

        _renderResultSection(list, 'artist', results.artist, api);
        _renderResultSection(list, 'album', results.album, api);
        _renderResultSection(list, 'song', results.song, api);

        _resultsContainer.appendChild(list);
    }

    // V3.7-fix12: render one result-type section. When the section length
    // exceeds SEARCH_VIRTUAL_THRESHOLD (30) the section is mounted as a
    // SonanceUtils.VirtualGrid so DOM stays bounded.
    function _renderResultSection(list, type, items, api) {
        if (!items || items.length === 0) return;

        var factory = function(item) {
            if (type === 'artist') return _createArtistResultItem(item, api);
            if (type === 'album') return _createAlbumResultItem(item, api);
            return _createSongResultItem(item, api);
        };

        if (items.length <= SEARCH_VIRTUAL_THRESHOLD) {
            for (var i = 0; i < items.length; i++) {
                _currentResultSongs.push(type === 'song' ? items[i] : null);
                var row = factory(items[i]);
                _resultSlots.push(row);
                list.appendChild(row);
            }
            return;
        }

        // Virtualised path: each section is mounted into its own
        // position:relative host so VirtualGrid can manage spacer + grid.
        var mount = el('div', { className: 'search-section-virtual-mount' });
        mount.style.position = 'relative';
        list.appendChild(mount);

        var scrollContainer = document.querySelector('.search-right');
        if (!scrollContainer) {
            for (var k = 0; k < items.length; k++) {
                _currentResultSongs.push(type === 'song' ? items[k] : null);
                var plain = factory(items[k]);
                _resultSlots.push(plain);
                list.appendChild(plain);
            }
            return;
        }
        var vg = new SonanceUtils.VirtualGrid({
            scrollContainer: scrollContainer,
            mountContainer: mount,
            items: items,
            renderItem: factory,
            itemHeight: SonanceUtils.px(72),   // v3.10 R4: 72px row pitch at 100 %
            columns: 1,
            gridClassName: 'search-results-list',
            bufferRows: 4,
            onRangeRender: _reapplyResultsFocus
        });
        vg.init();
        // v3.10 R1.6: the 72px pitch is an estimate; use the rendered one
        // (D11), or rows overlap or gap and the band drifts off its rows.
        var pitch = vg.measureRowPitch();
        if (pitch > 0) vg.refresh({ itemHeight: pitch });
        _virtualGrids.push(vg);
        // Colour buttons read _currentResultSongs by zone index, so the
        // virtualised rows need their entries too (they had none).
        for (var v = 0; v < items.length; v++) {
            _currentResultSongs.push(type === 'song' ? items[v] : null);
            _resultSlots.push({ vg: vg, i: v });
        }
    }

    // v3.10 R1.6: a recycle can remove the focused row; re-resolve it once
    // VirtualGrid has finished (as library.js _reapplyGridFocusAfterRecycle).
    function _reapplyResultsFocus() {
        if (FocusManager.getActiveZone() !== 'search-results') return;
        var focused = FocusManager.getCurrentFocused();
        if (focused && focused.parentNode) return;
        setTimeout(function() {
            if (FocusManager.getActiveZone() === 'search-results') {
                FocusManager.setActiveZone('search-results', undefined, true);
            }
        }, 0);
    }

    function _resultAt(idx) {
        var slot = _resultSlots[idx];
        if (!slot) return null;
        return slot.vg ? slot.vg.ensureIndexVisible(slot.i) : slot;
    }

    function _createArtistResultItem(artist, api) {
        var item = el('div', {
            className: 'search-result-item focusable',
            'data-type': 'artist',
            'data-id': artist.id
        });
        item.appendChild(SonanceComponents.renderArtistAvatar(artist, 52, api));

        var info = el('div', { className: 'search-result-info' });
        info.appendChild(el('div', { className: 'search-result-title' },
            artist.name || 'Unknown'));
        var meta = 'Artist';
        if (artist.albumCount) meta += ' \u00B7 ' + artist.albumCount + ' albums';
        info.appendChild(el('div', { className: 'search-result-meta' }, meta));
        item.appendChild(info);
        return item;
    }

    function _createSongResultItem(song, api) {
        var item = el('div', {
            className: 'search-result-item focusable',
            'data-type': 'song',
            'data-id': song.id
        });
        item.appendChild(SonanceComponents.renderAlbumArt(
            { coverArt: song.coverArt, name: song.album }, 52, api));

        var info = el('div', { className: 'search-result-info' });
        info.appendChild(el('div', { className: 'search-result-title' },
            song.title || 'Unknown'));
        // v3.10 R5: the artist is always shown, as on every track list.
        var meta = 'Song \u00B7 ' + (song.artist || 'Unknown artist');
        if (song.album) meta += ' \u00B7 ' + song.album;
        info.appendChild(el('div', { className: 'search-result-meta' }, meta));

        var dur = el('div', { className: 'search-result-duration' },
            (song._formattedDuration || formatDuration(song.duration)));
        item.appendChild(info);
        item.appendChild(dur);

        // V3.7-fix10: stash albumId on the row so the delegated handler
        // can route the click without keeping a per-row closure.
        if (song.albumId) {
            item.setAttribute('data-album-id', song.albumId);
            item.setAttribute('data-album-title', song.album || '');
        }
        return item;
    }

    function _createAlbumResultItem(album, api) {
        var item = el('div', {
            className: 'search-result-item focusable',
            'data-type': 'album',
            'data-id': album.id
        });
        item.appendChild(SonanceComponents.renderAlbumArt(album, 52, api));

        var info = el('div', { className: 'search-result-info' });
        info.appendChild(el('div', { className: 'search-result-title' },
            album.name || album.title || 'Unknown'));
        var meta = 'Album';
        if (album.artist) meta += ' \u00B7 ' + album.artist;
        if (album.year) meta += ' \u00B7 ' + album.year;
        info.appendChild(el('div', { className: 'search-result-meta' }, meta));
        item.setAttribute('data-album-title', album.name || album.title || '');
        item.appendChild(info);

        return item;
    }

    // =========================================
    //  Render: Loading + Empty states
    // =========================================

    function _renderLoading() {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';
        var loading = el('div', { className: 'search-loading' });
        for (var i = 0; i < 5; i++) {
            loading.appendChild(el('div', { className: 'skeleton skeleton-result-row' }));
        }
        _resultsContainer.appendChild(loading);
    }

    function _renderEmpty(message) {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';
        _resultsContainer.appendChild(el('div', { className: 'search-no-results' }, message));
    }

    // =========================================
    //  Focus Zones
    // =========================================

    // v3.10 D84 (D108): at 200 % the keyboard is taller than the page; the
    // left panel scrolls so the focused key (the last row, SPACE / DEL) is
    // on screen.
    function _revealKey(idx, element) {
        SonanceUtils.revealInScroller(element, element.closest('.search-left'), SonanceUtils.px(24));
    }

    function _registerFocusZones() {
        // Keyboard character keys (9 columns)
        FocusManager.registerZone('content', {
            selector: '#search-keyboard .kb-key',
            columns: 9,
            onActivate: function(idx, element) {
                element.click();
            },
            onFocus: _revealKey,
            neighbors: {
                left: 'topnav',
                right: 'search-results',
                down: 'search-special'
            }
        });

        // SPACE + DEL zone (2 items in a row)
        FocusManager.registerZone('search-special', {
            getElements: function() {
                var space = document.querySelector('#search-keyboard .kb-space');
                var del = document.querySelector('#search-keyboard .kb-del');
                var result = [];
                if (space) result.push(space);
                if (del) result.push(del);
                return result;
            },
            columns: 2,
            onActivate: function(idx, element) {
                element.click();
            },
            onFocus: _revealKey,
            neighbors: {
                left: 'topnav',
                right: 'search-results',
                up: 'content',
                down: 'nowplaying-bar'
            }
        });

        // Register results zone
        _registerResultsZone();

        // NP bar
        App.registerNowPlayingBarZone('search-special');

        // V3-6-fix3 NAV-4: force-transition off topnav so the keyboard
        // 'A' key actually receives focus on entry. Without force=true the
        // FocusManager blocks the call while the active zone is 'topnav'.
        FocusManager.setActiveZone('content', 0, true);
    }

    function _registerResultsZone() {
        // Check what's displayed on the right panel
        var resultItems = document.querySelectorAll('#search-results-list .focusable');
        var quickAccessItems = document.querySelectorAll('#search-quickaccess .focusable');

        if (resultItems.length > 0) {
            var hasSongs = _currentResultSongs && _currentResultSongs.some(function(s) { return s !== null; });
            // v3.10 R1.6: with a virtualised section the zone walks the
            // slots; the reveal keeps px(20) clear for the 1.02 row (D76).
            // Virtual zones get no onFocus scroll (D32).
            var virtual = (_virtualGrids.length && _resultSlots.length) ? {
                getCount: function() { return _resultSlots.length; },
                getItemAt: _resultAt,
                reveal: function(idx, element) {
                    SonanceUtils.revealInScroller(element,
                        document.querySelector('.search-right'), SonanceUtils.px(20));
                }
            } : null;
            FocusManager.registerZone('search-results', {
                selector: '#search-results-list .focusable',
                columns: 1,
                virtual: virtual,
                onActivate: function(idx, element) { element.click(); },
                onFocus: virtual ? null : function(idx, element) { _scrollToFocused(element); },
                // v3.10 A5: hold OK on a song for the options sheet. The zone
                // index is the slot index (_resultSlots, D100), and
                // _currentResultSongs is kept in the same order; artists and
                // albums keep OK on keydown.
                hasLongPress: hasSongs ? function(idx) {
                    return !!(_currentResultSongs && _currentResultSongs[idx]);
                } : null,
                onLongPress: hasSongs ? function(idx) {
                    var track = _currentResultSongs && _currentResultSongs[idx];
                    if (track) OptionsSheet.open({ song: track });
                } : null,
                onColourButton: hasSongs ? function(colour, idx) {
                    if (!_currentResultSongs) return;
                    var track = _currentResultSongs[idx];
                    if (!track) return; // Not a song (artist/album)
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    }
                } : null,
                neighbors: {
                    left: 'content',
                    down: 'nowplaying-bar'
                }
            });
            if (hasSongs) {
                App.showColourHints([
                    { colour: 'yellow', label: 'Add to queue' },
                    { colour: 'blue', label: 'Play next' }
                ]);
            }
        } else if (quickAccessItems.length > 0) {
            FocusManager.registerZone('search-results', {
                selector: '#search-quickaccess .focusable',
                columns: 2,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'content',
                    down: 'nowplaying-bar'
                }
            });
        } else {
            // No results — unregister so right-press does nothing
            FocusManager.unregisterZone('search-results');
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;
        _container = null;
        _searchInputDisplay = null;
        _resultsContainer = null;
        _query = '';
        _currentResultSongs = null;
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        // V3.7-fix12: tear down any virtualised result sections.
        _destroyVirtualGrids();
    }

    function _destroyVirtualGrids() {
        for (var i = 0; i < _virtualGrids.length; i++) {
            try { _virtualGrids[i].destroy(); } catch (e) {}
        }
        _virtualGrids = [];
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();

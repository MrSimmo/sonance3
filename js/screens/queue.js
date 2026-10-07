/* ============================================
   Sonance — Queue Screen
   Split layout: now playing card + up next list
   ============================================ */

var QueueScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _active = false;

    // DOM references
    var _npArt = null;
    var _npTitle = null;
    var _npArtist = null;
    var _npProgressFill = null;
    var _npTimeCurrent = null;
    var _npTimeTotal = null;
    var _queueList = null;
    // v3.10 R1.7: the Up Next list is a virtual list over `_upNext`
    // ({ track, queueIdx } in play order). A 14,000-track queue rendered
    // every row (112,054 elements, 2.5 s to paint, 418 ms a press); the
    // V3.7-fix13 per-row diff it replaces needed every row in the DOM.
    var _upNext = [];
    var _upNextList = null;
    var _currentPlayingRow = null;    // marks .queue-row-playing row, when applicable

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'queue-screen' });

        // LEFT PANEL (320px) — Now Playing card
        var leftPanel = el('div', { className: 'queue-left' });
        leftPanel.appendChild(el('div', { className: 'queue-section-heading' }, 'Now Playing'));

        var card = el('div', { className: 'queue-np-card focusable', id: 'queue-np-card' });
        card.addEventListener('click', function() {
            if (Player.getState().currentTrack) {
                // v3.10 R2 (D93): rises, as from the NP bar.
                App.navigateTo('nowplaying', null, 'rise');
            }
        });

        _npArt = el('div', { className: 'queue-np-art' });
        card.appendChild(_npArt);

        _npTitle = el('div', { className: 'queue-np-title' }, 'No track playing');
        card.appendChild(_npTitle);

        _npArtist = el('div', { className: 'queue-np-artist' }, 'Select a song to begin');
        card.appendChild(_npArtist);

        // Mini progress bar in card
        var progressWrap = el('div', { className: 'queue-np-progress-wrap' });
        var progressBar = el('div', { className: 'queue-np-progress' });
        _npProgressFill = el('div', { className: 'queue-np-progress-fill' });
        progressBar.appendChild(_npProgressFill);
        progressWrap.appendChild(progressBar);

        var timeRow = el('div', { className: 'queue-np-time-row' });
        _npTimeCurrent = el('span', { className: 'queue-np-time' }, '0:00');
        _npTimeTotal = el('span', { className: 'queue-np-time' }, '0:00');
        timeRow.appendChild(_npTimeCurrent);
        timeRow.appendChild(_npTimeTotal);
        progressWrap.appendChild(timeRow);

        card.appendChild(progressWrap);
        leftPanel.appendChild(card);
        wrapper.appendChild(leftPanel);

        // RIGHT PANEL — Up Next list
        var rightPanel = el('div', { className: 'queue-right' });
        rightPanel.appendChild(el('div', { className: 'queue-section-heading' }, 'Up Next'));

        _queueList = el('div', { className: 'queue-list', id: 'queue-list' });
        _queueList.addEventListener('click', _onQueueListClick);
        rightPanel.appendChild(_queueList);
        wrapper.appendChild(rightPanel);

        container.appendChild(wrapper);
        log('Queue', 'Queue screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        var pState = Player.getState();
        _updateNowPlaying(pState.currentTrack);
        _updateProgress(pState.currentTime, pState.duration);
        _renderQueueList(pState);

        // Subscribe to events
        Player.on('trackchange', _onTrackChange);
        Player.on('progress', _onProgress);
        Player.on('queuechange', _onQueueChange);

        _registerFocusZones();
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        _updateNowPlaying(track);
        // trackchange shifts the queueIndex, which usually drops the head
        // row from the up-next list.
        var hadRows = _upNext.length > 0;
        _updateQueueList(Player.getState());
        var hasRows = _upNext.length > 0;
        // Re-register zones only when the empty/non-empty state flipped.
        if (hadRows !== hasRows) _registerFocusZones();
    }

    function _onProgress(data) {
        if (!_active) return;
        _updateProgress(data.currentTime, data.duration);
    }

    function _onQueueChange() {
        if (!_active) return;
        var hadRows = _upNext.length > 0;
        _updateQueueList(Player.getState());
        var hasRows = _upNext.length > 0;
        if (hadRows !== hasRows) _registerFocusZones();
    }

    // =========================================
    //  UI Updates
    // =========================================

    function _updateNowPlaying(track) {
        if (!track) {
            if (_npTitle) _npTitle.textContent = 'No track playing';
            if (_npArtist) _npArtist.textContent = 'Select a song to begin';
            if (_npArt) _npArt.textContent = '';
            return;
        }

        if (_npTitle) _npTitle.textContent = track.title || 'Unknown';
        if (_npArtist) _npArtist.textContent = track.artist || 'Unknown Artist';

        if (_npArt) {
            _npArt.textContent = '';
            var api = AuthManager.getApi();
            if (api) {
                var artEl = SonanceComponents.renderAlbumArt(track, 280, api);
                _npArt.appendChild(artEl);
            }
        }
    }

    function _updateProgress(currentTime, duration) {
        var ratio = (duration > 0) ? (currentTime / duration) : 0;
        if (_npProgressFill) _npProgressFill.style.setProperty('--progress', ratio.toString());
        if (_npTimeCurrent) _npTimeCurrent.textContent = formatDuration(currentTime);
        if (_npTimeTotal) _npTimeTotal.textContent = formatDuration(duration);
    }

    // V3.7-fix13: build the up-next item list (source of truth for the diff).
    function _computeUpNext(pState) {
        var queue = pState.queue;
        var currentIdx = pState.queueIndex;
        var upNext = [];
        for (var i = currentIdx + 1; i < queue.length; i++) {
            upNext.push({ track: queue[i], queueIdx: i });
        }
        if (pState.repeat === 'all' && currentIdx > 0) {
            for (var j = 0; j < currentIdx; j++) {
                upNext.push({ track: queue[j], queueIdx: j });
            }
        }
        return upNext;
    }

    // V3.9 T7: one delegated click handler for the whole list. The focus
    // zone's onActivate calls element.click() on the row, which bubbles here.
    function _onQueueListClick(e) {
        var row = e.target && e.target.closest ? e.target.closest('.queue-row') : null;
        if (!row || !_queueList.contains(row)) return;
        var idx = row.getAttribute('data-queue-idx');
        if (idx === null) return;
        Player.jumpToQueueIndex(parseInt(idx, 10));
    }

    function _createRow(track, queueIdx, displayIdx, api) {
        var row = el('div', {
            className: 'queue-row focusable',
            'data-queue-idx': String(queueIdx),
            'data-song-id': track.id || ''
        });

        var numEl = el('div', { className: 'queue-row-num' }, String(displayIdx + 1));
        row.appendChild(numEl);

        var thumb = el('div', { className: 'queue-row-thumb' });
        var coverId = track.coverArt || track.albumId;
        if (api && coverId) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('data-coverart', coverId);
            img.setAttribute('data-size', String(SonanceUtils.artSize(100)));   // v3.10 D70
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = SonanceUtils.rem(4);
            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };
            thumb.appendChild(img);
            if (typeof LazyLoader !== 'undefined') LazyLoader.observe(img);
        }
        row.appendChild(thumb);

        var info = el('div', { className: 'queue-row-info' });
        info.appendChild(el('div', { className: 'queue-row-title' }, track.title || 'Unknown'));
        info.appendChild(el('div', { className: 'queue-row-artist' }, track.artist || 'Unknown artist'));
        row.appendChild(info);

        row.appendChild(el('div', { className: 'queue-row-duration' }, (track._formattedDuration || formatDuration(track.duration))));

        // V3.9 T7: no per-row click listener. Queue was the only screen that
        // attached one per row — a 500-track queue meant 500 listeners. The
        // container handles it (_onQueueListClick), reading the
        // data-queue-idx the row already carries and :430 already reads.
        return row;
    }

    function _destroyUpNextList() {
        if (_upNextList) _upNextList.destroy();
        _upNextList = null;
    }

    // Mount the list (or the empty message) for pState.
    function _renderQueueList(pState) {
        if (!_queueList) return;
        _destroyUpNextList();
        _queueList.textContent = '';
        _upNext = _computeUpNext(pState);
        if (_upNext.length === 0) {
            _queueList.appendChild(el('div', { className: 'queue-empty' }, 'Queue is empty'));
            return;
        }
        var api = AuthManager.getApi();
        _upNextList = SonanceUtils.createVirtualList({
            scrollContainer: _queueList.parentNode,   // .queue-right
            mount: _queueList,
            items: _upNext,
            renderItem: function(item, i) { return _createRow(item.track, item.queueIdx, i, api); },
            zone: 'queue-list'
        });
    }

    // A queue or track change. The list keeps its scroll and the focused
    // index; the mounted band (about 30 rows) is re-rendered from the new
    // list (a new items array means new content, VirtualGrid.refresh).
    function _updateQueueList(pState) {
        if (!_queueList) return;
        var upNext = _computeUpNext(pState);
        if (!_upNextList || upNext.length === 0) {
            _renderQueueList(pState);
            return;
        }
        _upNext = upNext;
        _upNextList.refresh({ items: upNext });
    }

    // V3.7-fix13: indicator-only update for a now-playing row, mirroring the
    // album.js _updatePlayingIndicator pattern. Used if a future layout shows
    // the current track inside the queue list — currently a no-op visually
    // because the up-next list excludes the playing track, but kept so that
    // the trackchange path has a clean handle.
    function _updateQueuePlayingIndicator(songId) {
        if (_currentPlayingRow) {
            _currentPlayingRow.classList.remove('queue-row-playing');
            _currentPlayingRow = null;
        }
        if (!songId || !_queueList) return;
        var row = _queueList.querySelector('[data-song-id="' + songId + '"]');
        if (row) {
            row.classList.add('queue-row-playing');
            _currentPlayingRow = row;
        }
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var hasQueue = !!_upNextList;

        // V3-6-fix3 NAV-1: register the cover card as 'queue-card' (not 'content')
        // so the topnav→Down candidates list in app.js falls through to
        // 'queue-list' when the queue has items. 'queue-card' is appended to
        // the candidates list so it's still the destination when the queue is empty.
        FocusManager.registerZone('queue-card', {
            selector: '#queue-np-card',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'topnav',
                right: hasQueue ? 'queue-list' : null,
                down: 'nowplaying-bar'
            }
        });

        if (hasQueue) {
            FocusManager.registerZone('queue-list', {
                selector: '#queue-list .focusable',
                columns: 1,
                // R1.7: VirtualGrid mounts the row, the reveal scrolls it
                // (D32, D76).
                virtual: _upNextList.zoneVirtual,
                onActivate: function(idx, element) { element.click(); },
                // v3.10 A5: hold OK for the options sheet, with Play now and
                // Remove from queue for a queue entry.
                onLongPress: function(idx, element) {
                    var qi = parseInt(element.getAttribute('data-queue-idx'), 10);
                    var track = Player.getState().queue[qi];
                    if (track) OptionsSheet.open({ song: track, queueIndex: qi });
                },
                onColourButton: function(colour, idx, element) {
                    if (colour === 'red') {
                        var queueIdx = element.getAttribute('data-queue-idx');
                        if (queueIdx !== null) {
                            Player.removeFromQueue(parseInt(queueIdx, 10));
                            App.showToast('Removed from queue');
                        }
                    }
                },
                neighbors: {
                    left: 'queue-card',
                    down: 'nowplaying-bar'
                }
            });
        }

        // Show colour button hints on queue screen
        if (hasQueue) {
            App.showColourHints([
                { colour: 'red', label: 'Remove' }
            ]);
        }

        FocusManager.setActiveZone(hasQueue ? 'queue-list' : 'queue-card', 0);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        Player.off('trackchange', _onTrackChange);
        Player.off('progress', _onProgress);
        Player.off('queuechange', _onQueueChange);

        _container = null;
        _npArt = null;
        _npTitle = null;
        _npArtist = null;
        _npProgressFill = null;
        _npTimeCurrent = null;
        _npTimeTotal = null;
        _destroyUpNextList();
        _queueList = null;
        _upNext = [];
        _currentPlayingRow = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();

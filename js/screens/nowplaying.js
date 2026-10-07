/* ============================================
   Sonance — Now Playing Screen
   Full-screen player with album art, progress,
   transport controls, volume, and synced lyrics (P14b).
   ============================================ */

var NowPlayingScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var rem = SonanceUtils.rem;
    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;
    var parseLyricsResponse = SonanceUtils.parseLyricsResponse;

    var _container = null;
    var _active = false;

    // V3-6-fix4 PERF-6: cached progress-bar pixel width. _updateProgress
    // used to call getBoundingClientRect() on every progress tick; the
    // bar width is fixed for the duration of the screen (unless the
    // viewport resizes), so we cache it.
    var _progressBarWidth = 0;
    // V3.7-fix15: cache the full rect (left + width) so the click-to-seek
    // handler doesn't read getBoundingClientRect() on every click.
    var _progressBarLeft = 0;
    var _progressMeasureRaf = null;
    var _progressResizeBound = null;

    // V3-6-fix5 FIX-2: deferred initial-focus handle. The synchronous
    // setActiveZone('content', 2) call was being undone by navigateTo's
    // post-activate `wasInTopNav` re-grab (app.js ~line 1535) when NP was
    // opened from the top nav, so play/pause never visibly received focus
    // until the nav-bar auto-hide timer fired ~5 s later. Scheduling the
    // focus call via rAF lets the navigateTo() pass complete first; the
    // rAF then forces focus onto the play button regardless of whether
    // the user came from topnav, the persistent NP bar, or auto-open.
    var _initialFocusRaf = null;

    // DOM references for live updates
    var _artImg = null;
    // V3.7-fix19: persistent <img> + placeholder elements created once at
    // render-time. Track changes mutate _artImgEl.src in place.
    var _artImgEl = null;
    var _artPlaceholderEl = null;
    var _titleEl = null;
    var _subtitleEl = null;
    var _progressFill = null;
    var _progressScrubber = null;
    var _timeCurrent = null;
    var _timeTotal = null;
    // V3.9 T3: last string written to each time node, so _updateProgress can
    // skip the DOM write when the formatted value has not changed.
    var _timeCurrentText = '0:00';
    var _timeTotalText = '0:00';
    var _playBtn = null;
    var _shuffleBtn = null;
    var _repeatBtn = null;
    var _starBtn = null;
    var _lyricsBtn = null;
    var _creditsBtn = null;
    var _bgEl = null;
    var _progressBar = null;

    // v3.10 R7: the ⓘ button's index in the np-controls row (shuffle, prev,
    // play, next, repeat, star, lyrics, credits, and since v3.10-fix2 F7
    // focus). Up from the credits list lands here; every other Up/Down entry
    // lands on Play (R3).
    var CONTROLS_COUNT = 9;
    var PLAY_INDEX = 2;
    var CREDITS_INDEX = 7;

    // v3.10-fix2 F7 (D159): Focus mode's button and its overlay.
    var _focusBtn = null;
    var _focusDimEl = null;

    // Credits panel (R7). The song and album caches last the session, so a
    // song's getSong is asked once ("1 getSong request per song per session")
    // however often the panel opens; a failed request caches {}.
    var _creditsPanel = null;
    var _creditsSubtitle = null;
    var _creditsScroll = null;
    var _creditsView = null;      // fix2 F3: SonanceComponents.createScrollView over _creditsScroll
    var _creditsVisible = false;
    var _creditsOverflow = false;
    var _creditsSongCache = {};   // songId → getSong result
    var _creditsAlbumCache = {};  // albumId → getAlbum result
    var _creditsPending = {};

    // Up Next strip (A6) and its sleep chip (A7).
    var UP_NEXT_COUNT = 5;
    var _upNextEl = null;
    var _upNextLabel = null;
    var _upNextEmpty = null;
    var _upNextTiles = [];        // the fixed pool of UP_NEXT_COUNT tiles
    var _upNextIndices = [];      // queue index shown by each visible tile
    var _upNextEls = [];          // the zone's elements: visible tiles, then the chip
    var _sleepChip = null;
    var _sleepChipLabel = null;
    var _upNextBuildRaf = null;   // the post-first-frame build (two rAFs)
    // v3.10-fix2 F2 (D156): Settings -> "Up next on Now Playing" Hide, read
    // at render. Hidden, there is no strip; the sleep chip sits alone under
    // the controls (D157) and is np-upnext's one element.
    var _upNextHidden = false;

    // Layout + lyrics
    var _layoutEl = null;
    var _leftEl = null;
    var _lyricsPanel = null;
    var _lyricsWrapper = null;
    var _lyricsLinesEl = null;
    var _lyricsBuildRaf = null;        // V3-6-fix4 PERF-3: deferred-build handle
    var _willChangeClearTimer = null;  // V3-6-fix4 PERF-4: clear-after-transition

    // Lyrics state
    var _lyricsCache = {};        // songId → parsed lyrics | null
    var _pendingFetches = {};     // songId → true while a request is in flight
    var _currentLyrics = null;    // parsed structured lyrics for current track (or null)
    var _lyricsVisible = false;
    // V3-6-fix4 PERF-1: deferred-fetch handles. rAF first guarantees the
    // current paint cycle ran; rIC then waits for browser idle time so the
    // network request never races first paint.
    var _lyricsRaf = null;
    var _lyricsIdleHandle = null;

    var _hasRic = (typeof requestIdleCallback === 'function');
    function _ric(fn) {
        if (_hasRic) {
            return requestIdleCallback(fn, { timeout: 1500 });
        }
        return setTimeout(fn, 0);
    }
    function _cancelRic(handle) {
        if (handle === null || handle === undefined) return;
        if (_hasRic && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(handle);
        } else {
            clearTimeout(handle);
        }
    }
    function _cancelLyricsDefer() {
        if (_lyricsRaf !== null) {
            cancelAnimationFrame(_lyricsRaf);
            _lyricsRaf = null;
        }
        if (_lyricsIdleHandle !== null) {
            _cancelRic(_lyricsIdleHandle);
            _lyricsIdleHandle = null;
        }
    }

    // Remove all children of a node (safer than innerHTML = '')
    function _clearNode(node) {
        if (!node) return;
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    // =========================================
    //  Sleep timer (v3.10 A7)
    // =========================================

    // Off → 15 → 30 → 45 → 60 min → End of track → Off. Not persisted. It
    // lives at module level, not on the screen: the countdown keeps running
    // (and pauses playback) after the user leaves Now Playing.
    var SLEEP_STEPS = [0, 15, 30, 45, 60, 'end'];
    var SleepTimer = {
        _step: 0,
        _deadline: 0,
        _timer: null,

        // Enter on the chip: the next option, started afresh.
        cycle: function() {
            this._step = (this._step + 1) % SLEEP_STEPS.length;
            this._arm();
        },

        mode: function() {
            return SLEEP_STEPS[this._step];
        },

        minutesLeft: function() {
            return Math.max(0, Math.ceil((this._deadline - Date.now()) / 60000));
        },

        label: function() {
            var m = this.mode();
            if (m === 'end') return 'Sleep: end of track';
            if (m > 0) return 'Sleep in ' + this.minutesLeft() + ' min';
            return 'Sleep timer';
        },

        _arm: function() {
            if (this._timer !== null) {
                clearTimeout(this._timer);
                this._timer = null;
            }
            var m = this.mode();
            Player.setStopAtTrackEnd(m === 'end');
            Player.off('trackendstop', _onSleepTrackEnd);
            if (m === 'end') {
                Player.on('trackendstop', _onSleepTrackEnd);
            } else if (m > 0) {
                this._deadline = Date.now() + m * 60000;
                this._schedule();
            }
            _renderSleepChip();
        },

        // A setTimeout chain (interval timers are banned) that wakes on each
        // minute boundary of the time left, so the label's rounded-up minute
        // changes exactly when it should, and at the deadline.
        _schedule: function() {
            var self = this;
            var left = this._deadline - Date.now();
            if (left <= 0) {
                this._expire();
                return;
            }
            var wait = left % 60000 || 60000;
            this._timer = setTimeout(function() {
                self._timer = null;
                self._schedule();
                _renderSleepChip();
            }, wait);
        },

        _expire: function() {
            this._step = 0;
            this._timer = null;
            Player.pause();
            App.showToast('Sleep timer: playback paused');
            _renderSleepChip();
        }
    };

    // "End of track": Player paused at the end of the track and cued the next.
    function _onSleepTrackEnd() {
        Player.off('trackendstop', _onSleepTrackEnd);
        SleepTimer._step = 0;
        App.showToast('Sleep timer: paused at the end of the track');
        _renderSleepChip();
    }

    function _renderSleepChip() {
        if (!_sleepChipLabel) return;
        _sleepChipLabel.textContent = SleepTimer.label();
        if (SleepTimer.mode()) _sleepChip.classList.add('is-active');
        else _sleepChip.classList.remove('is-active');
    }

    // =========================================
    //  LyricsScroller
    // =========================================

    var LyricsScroller = {
        _wrapper: null,
        _container: null,
        _lines: [],
        _lineElements: [],
        _activeIndex: -1,
        _synced: false,
        _currentOffset: 0,
        // V3-6-fix4 PERF-2: cache layout dimensions populated once on init
        // (and on window resize). _scrollToActive used to read offsetTop /
        // offsetHeight / clientHeight every progress tick (~250 ms while
        // playing); now those are array lookups.
        _wrapperHeight: 0,
        _contentHeight: 0,
        _lineOffsets: [],
        _lineHeights: [],
        _scrollRaf: null,
        _resizeBound: null,

        init: function(wrapper, container, lyricsData) {
            this._wrapper = wrapper;
            this._container = container;
            this._lines = (lyricsData && lyricsData.line) ? lyricsData.line : [];
            this._synced = !!(lyricsData && lyricsData.synced);
            // V3.7-fix16: ensure ascending sort by start so the binary
            // search in update() is correct. Most parsers emit sorted
            // input but defensively re-sort if any pair is out of order.
            if (this._synced && this._lines.length > 1) {
                var sorted = true;
                for (var s = 1; s < this._lines.length; s++) {
                    var prevT = this._lines[s - 1].start;
                    var curT = this._lines[s].start;
                    if (typeof prevT === 'number' && typeof curT === 'number' && curT < prevT) {
                        sorted = false; break;
                    }
                }
                if (!sorted) {
                    this._lines = this._lines.slice().sort(function(a, b) {
                        return (a.start || 0) - (b.start || 0);
                    });
                }
            }
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._render();
            this._refreshLayoutCache();
            if (!this._resizeBound) {
                var self = this;
                this._resizeBound = function() { self._refreshLayoutCache(); };
                window.addEventListener('resize', this._resizeBound);
            }
        },

        _refreshLayoutCache: function() {
            if (!this._wrapper || !this._container) {
                this._wrapperHeight = 0;
                this._contentHeight = 0;
                this._lineOffsets = [];
                this._lineHeights = [];
                return;
            }
            this._wrapperHeight = this._wrapper.clientHeight || 0;
            this._contentHeight = this._container.scrollHeight || 0;
            var n = this._lineElements.length;
            this._lineOffsets = new Array(n);
            this._lineHeights = new Array(n);
            for (var i = 0; i < n; i++) {
                var lineEl = this._lineElements[i];
                this._lineOffsets[i] = lineEl.offsetTop;
                this._lineHeights[i] = lineEl.offsetHeight;
            }
        },

        _render: function() {
            _clearNode(this._container);
            this._lineElements = [];
            if (!this._lines.length) {
                var empty = document.createElement('div');
                empty.className = 'np-lyrics-empty';
                empty.textContent = 'No lyrics available';
                this._container.appendChild(empty);
                return;
            }
            var frag = document.createDocumentFragment();
            // D48: unsynced lines are tagged so they can be styled as fully
            // legible body text. None of them can ever be marked active, so
            // rendering the whole panel at the dimmed `upcoming` weight reads
            // as "everything is switched off".
            var initialClass = this._synced ? 'lyrics-line lyrics-upcoming' : 'lyrics-line lyrics-unsynced';
            for (var i = 0; i < this._lines.length; i++) {
                var line = this._lines[i];
                var lineEl = document.createElement('div');
                lineEl.className = initialClass;
                lineEl.textContent = (line && line.value) ? line.value : '';
                frag.appendChild(lineEl);
                this._lineElements.push(lineEl);
            }
            this._container.appendChild(frag);
            this._container.style.transition = 'none';
            this._container.style.transform = 'translateY(0)';
        },

        update: function(currentTimeMs) {
            if (!this._synced || !this._lines.length) return;

            // V3.7-fix16: binary search for the largest index whose start
            // <= currentTimeMs. Constant cost per update regardless of
            // song length. -1 means "before the first line".
            var lo = 0, hi = this._lines.length - 1, newIndex = -1;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                var t = this._lines[mid].start;
                if (typeof t !== 'number') {
                    // Lines without timestamps are skipped — fall back to
                    // a left-walk to find the previous indexed line.
                    var k = mid - 1;
                    while (k >= 0 && typeof this._lines[k].start !== 'number') k--;
                    if (k >= 0 && this._lines[k].start <= currentTimeMs) {
                        newIndex = k;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                } else if (t <= currentTimeMs) {
                    newIndex = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }

            if (newIndex === this._activeIndex) return;
            var oldIndex = this._activeIndex;
            this._activeIndex = newIndex;

            // V3.9 T2: only the lines whose class actually changes are
            // written. The old loop reassigned className on every line, so a
            // 60-line lyric cost 60 style invalidations (each with a
            // transition to evaluate) per active-line change where 2 do. The
            // range between the old and the new index is the general case —
            // a seek or a backward jump moves more than one line.
            var j;
            if (newIndex > oldIndex) {
                // Advancing: the old active line and everything up to the
                // line before the new one become past.
                for (j = (oldIndex < 0 ? 0 : oldIndex); j < newIndex; j++) {
                    this._lineElements[j].className = 'lyrics-line lyrics-past';
                }
            } else {
                // Jumping back: everything after the new active line, up to
                // and including the old one, returns to upcoming.
                for (j = newIndex + 1; j <= oldIndex; j++) {
                    this._lineElements[j].className = 'lyrics-line lyrics-upcoming';
                }
            }
            if (newIndex >= 0) {
                this._lineElements[newIndex].className = 'lyrics-line lyrics-active';
            }

            this._scrollToActive();
        },

        _scrollToActive: function() {
            if (this._activeIndex < 0) return;
            if (!this._wrapper || !this._container) return;
            // Lazy-recompute if cache was cleared (e.g. resize between ticks).
            if (!this._lineOffsets.length && this._lineElements.length) {
                this._refreshLayoutCache();
            }
            var lineTop = this._lineOffsets[this._activeIndex] || 0;
            var lineH = this._lineHeights[this._activeIndex] || 0;
            var wrapperH = this._wrapperHeight || this._wrapper.clientHeight;
            var targetScroll = lineTop - (wrapperH * 0.33) + (lineH / 2);
            if (targetScroll < 0) targetScroll = 0;
            this._currentOffset = targetScroll;
            var container = this._container;
            if (this._scrollRaf !== null) cancelAnimationFrame(this._scrollRaf);
            this._scrollRaf = requestAnimationFrame(function() {
                container.style.transition = 'transform 0.3s ease';
                container.style.transform = 'translateY(' + (-targetScroll) + 'px)';
            });
        },

        // D48 / v3.9-fix1 R3: unsynchronised lyrics carry no per-line
        // timestamps, so there is no line to mark active and no time to scroll
        // to. Elapsed fraction of the track is the only signal available, and
        // mapping it onto the scrollable range is what keeps a long lyric
        // reachable: Navidrome returns 145 unsynced lines for some tracks and
        // only ~7 fit the panel, so without this the rest cannot be reached by
        // any input (LyricsScroller.scrollBy has never had a caller).
        //
        // Called from _onProgress at 2-10 Hz — it must not touch style on a
        // tick where the rounded target has not moved.
        updateUnsynced: function(currentTimeSec, durationSec) {
            if (this._synced || !this._lines.length) return;
            if (!this._wrapper || !this._container) return;
            if (!(durationSec > 0)) return;
            if (!this._contentHeight) this._refreshLayoutCache();
            var maxScroll = this._contentHeight - this._wrapperHeight;
            if (maxScroll <= 0) return;    // lyric fits the panel — never scroll
            var frac = currentTimeSec / durationSec;
            if (frac < 0) frac = 0;
            else if (frac > 1) frac = 1;
            var target = Math.round(frac * maxScroll);
            if (target === this._currentOffset) return;
            this._currentOffset = target;
            var container = this._container;
            if (this._scrollRaf !== null) cancelAnimationFrame(this._scrollRaf);
            this._scrollRaf = requestAnimationFrame(function() {
                // Linear, not ease: progress ticks are ~250ms apart and easing
                // each one in and out reads as a stutter rather than a crawl.
                container.style.transition = 'transform 0.3s linear';
                container.style.transform = 'translateY(' + (-target) + 'px)';
            });
        },

        jumpTo: function(currentTimeMs) {
            if (!this._container) return;
            this._container.style.transition = 'none';
            this._activeIndex = -1;
            this.update(currentTimeMs);
            var self = this;
            setTimeout(function() {
                if (self._container) {
                    self._container.style.transition = 'transform 0.3s ease';
                }
            }, 50);
        },

        scrollBy: function(deltaPx) {
            if (!this._container) return;
            var current = this._currentOffset || 0;
            current += deltaPx;
            var contentH = this._contentHeight || (this._container.scrollHeight || 0);
            var wrapperH = this._wrapperHeight || (this._wrapper ? this._wrapper.clientHeight : 0);
            var maxScroll = Math.max(0, contentH - wrapperH);
            if (current < 0) current = 0;
            if (current > maxScroll) current = maxScroll;
            this._currentOffset = current;
            this._container.style.transition = 'transform 0.3s ease';
            this._container.style.transform = 'translateY(' + (-current) + 'px)';
        },

        reset: function() {
            // V3.7-fix29 Bug 2: leave .np-lyrics-lines genuinely empty so
            // reset() doubles as the swap-to-empty-state path used when a
            // track without lyrics arrives while the panel is open. Stale
            // line nodes from the previous track must not remain visible.
            // Safe to call repeatedly and on a freshly-constructed scroller
            // (no _container yet) — both branches no-op cleanly.
            this._activeIndex = -1;
            this._currentOffset = 0;
            if (this._container) {
                this._container.style.transition = 'none';
                this._container.style.transform = 'translateY(0)';
                _clearNode(this._container);
            }
            this._lineElements = [];
            this._lines = [];
            this._synced = false;
            this._wrapperHeight = 0;
            this._contentHeight = 0;
            this._lineOffsets = [];
            this._lineHeights = [];
        },

        destroy: function() {
            _clearNode(this._container);
            if (this._scrollRaf !== null) {
                cancelAnimationFrame(this._scrollRaf);
                this._scrollRaf = null;
            }
            if (this._resizeBound) {
                window.removeEventListener('resize', this._resizeBound);
                this._resizeBound = null;
            }
            this._wrapper = null;
            this._container = null;
            this._lineElements = [];
            this._lines = [];
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._synced = false;
            this._wrapperHeight = 0;
            this._contentHeight = 0;
            this._lineOffsets = [];
            this._lineHeights = [];
        }
    };

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'np-screen' });

        // Blurred album art background (P5.3)
        _bgEl = el('div', { className: 'np-bg-image' });
        wrapper.appendChild(_bgEl);

        // Dark overlay for text readability
        wrapper.appendChild(el('div', { className: 'np-bg-overlay' }));

        // Two-column layout (P14b): .np-left + .np-lyrics-panel
        _layoutEl = el('div', { className: 'np-layout' });

        var left = el('div', { className: 'np-left' });
        _leftEl = left;

        // Album art (280px) — V3.7-fix19: build the cover container once
        // with a persistent <img> + placeholder; track changes only mutate
        // src and toggle visibility.
        var artWrap = el('div', { className: 'np-screen-art' });
        _artImg = el('div', { className: 'np-screen-art-inner' });
        _artImgEl = document.createElement('img');
        _artImgEl.className = 'lazy-art loaded';
        _artImgEl.style.width = '100%';
        _artImgEl.style.height = '100%';
        _artImgEl.style.objectFit = 'cover';
        _artImgEl.style.borderRadius = rem(16);
        _artImgEl.setAttribute('decoding', 'async');
        // Browser-only: lazy attribute is harmless on Tizen but skip if it
        // would cause an instant fetch suppression we don't want.
        if (typeof window.webapis === 'undefined') {
            _artImgEl.setAttribute('loading', 'lazy');
        }
        _artImgEl.onerror = function() {
            _showArtPlaceholder(null);
        };
        _artImg.appendChild(_artImgEl);
        artWrap.appendChild(_artImg);
        left.appendChild(artWrap);

        // Track title
        _titleEl = el('div', { className: 'np-screen-title' }, 'No track playing');
        left.appendChild(_titleEl);

        // Artist — Album
        _subtitleEl = el('div', { className: 'np-screen-subtitle' }, 'Select a song to begin');
        left.appendChild(_subtitleEl);

        // Progress bar
        var progressWrap = el('div', { className: 'np-screen-progress-wrap' });

        _progressBar = el('div', { className: 'np-screen-progress focusable', id: 'np-progress-bar' });
        var progressTrack = el('div', { className: 'np-screen-progress-track' });
        _progressFill = el('div', { className: 'np-screen-progress-fill' });
        _progressScrubber = el('div', { className: 'np-screen-progress-scrubber' });
        progressTrack.appendChild(_progressFill);
        progressTrack.appendChild(_progressScrubber);
        _progressBar.appendChild(progressTrack);

        _progressBar.addEventListener('click', function(e) {
            // V3.7-fix15: prefer the cached rect (populated on activate +
            // resize). Fall back to a one-off measure if not yet cached.
            var left = _progressBarLeft;
            var width = _progressBarWidth;
            if (!width) {
                var r = _progressBar.getBoundingClientRect();
                left = r.left;
                width = r.width;
                _progressBarLeft = left;
                _progressBarWidth = width;
            }
            if (!width) return;
            var pct = ((e.clientX - left) / width) * 100;
            pct = Math.max(0, Math.min(100, pct));
            Player.seekPercent(pct);
        });

        progressWrap.appendChild(_progressBar);

        var timeRow = el('div', { className: 'np-screen-time-row' });
        _timeCurrent = el('div', { className: 'np-screen-time' }, '0:00');
        _timeTotal = el('div', { className: 'np-screen-time' }, '0:00');
        _timeCurrentText = '0:00';
        _timeTotalText = '0:00';
        timeRow.appendChild(_timeCurrent);
        timeRow.appendChild(_timeTotal);
        progressWrap.appendChild(timeRow);

        left.appendChild(progressWrap);

        // Transport controls
        var controls = el('div', { className: 'np-screen-controls' });

        _shuffleBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-shuffle' });
        var shuffleSvg = createSvg(SVG_PATHS.shuffle);
        shuffleSvg.style.width = rem(22);
        shuffleSvg.style.height = rem(22);
        shuffleSvg.style.fill = 'currentColor';
        _shuffleBtn.appendChild(shuffleSvg);
        _shuffleBtn.addEventListener('click', function() { Player.toggleShuffle(); });
        controls.appendChild(_shuffleBtn);

        var prevBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-prev' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = rem(28);
        prevSvg.style.height = rem(28);
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        controls.appendChild(prevBtn);

        _playBtn = el('button', { className: 'np-ctrl-play focusable', id: 'np-play' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = rem(22);
        playIcon.style.height = rem(22);
        _playBtn.appendChild(playIcon);
        _playBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        controls.appendChild(_playBtn);

        var nextBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-next' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = rem(28);
        nextSvg.style.height = rem(28);
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        controls.appendChild(nextBtn);

        _repeatBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-repeat' });
        var repeatSvg = createSvg('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z');
        repeatSvg.style.width = rem(22);
        repeatSvg.style.height = rem(22);
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);
        _repeatBtn.addEventListener('click', function() { Player.toggleRepeat(); });
        controls.appendChild(_repeatBtn);

        _starBtn = el('button', { className: 'np-ctrl-btn np-ctrl-star focusable', id: 'np-star' });
        _starBtn.addEventListener('click', function() {
            var track = Player.getState().currentTrack;
            var api = AuthManager.getApi();
            if (!track || !api) return;
            var nowStarred = StarredCache.toggleSong(track.id, api);
            _updateStar(nowStarred);
            App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
        });
        controls.appendChild(_starBtn);

        // Lyrics button (P14b) — last in the row
        _lyricsBtn = el('button', {
            className: 'np-ctrl-btn np-ctrl-lyrics focusable is-unavailable',
            id: 'np-lyrics'
        });
        // v3.10-fix2 F4 (D153): the four lines are drawn x 4-20, y 5-19 with
        // their round caps, centred on the 24-unit box (they were x 2-18,
        // y 4-18: 3 px left and 1.5 px up of the focus platter at 150 %).
        var lyricsSvg = createSvg('M5 6h14M5 10h10M5 14h12M5 18h8');
        lyricsSvg.style.width = rem(24);
        lyricsSvg.style.height = rem(24);
        var lyricsPath = lyricsSvg.querySelector('path');
        if (lyricsPath) {
            lyricsPath.setAttribute('stroke', 'currentColor');
            lyricsPath.setAttribute('stroke-width', '2');
            lyricsPath.setAttribute('stroke-linecap', 'round');
            lyricsPath.setAttribute('fill', 'none');
        }
        lyricsSvg.setAttribute('fill', 'none');
        _lyricsBtn.appendChild(lyricsSvg);
        _lyricsBtn.addEventListener('click', _toggleLyrics);
        controls.appendChild(_lyricsBtn);

        // v3.10 R7: ⓘ credits, after Lyrics. A ring with an "i": the inner
        // circle is drawn the other way round, so the non-zero fill leaves it
        // open. Dimmed with no track (D55), like the lyrics button.
        _creditsBtn = el('button', {
            className: 'np-ctrl-btn np-ctrl-credits focusable is-unavailable',
            id: 'np-credits'
        });
        var creditsSvg = createSvg('M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM11 7h2v2h-2zM11 11h2v6h-2z');
        creditsSvg.style.width = rem(24);
        creditsSvg.style.height = rem(24);
        creditsSvg.style.fill = 'currentColor';
        _creditsBtn.appendChild(creditsSvg);
        _creditsBtn.addEventListener('click', _toggleCredits);
        controls.appendChild(_creditsBtn);

        // v3.10-fix2 F7 (D158, D159): Focus mode, after ⓘ. A ring with its
        // left half filled: the inner circle runs the other way (a hole), and
        // the half disc runs with the outer ring, so it fills the hole's left
        // half. Never D55-dimmed: it works with or without a track.
        _focusBtn = el('button', {
            className: 'np-ctrl-btn np-ctrl-focus focusable' + (SonanceSettings.npFocus ? ' is-active' : ''),
            id: 'np-focus'
        });
        var focusSvg = createSvg('M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM12 4a8 8 0 0 0 0 16z');
        focusSvg.style.width = rem(24);
        focusSvg.style.height = rem(24);
        focusSvg.style.fill = 'currentColor';
        _focusBtn.appendChild(focusSvg);
        _focusBtn.addEventListener('click', _toggleFocusMode);
        controls.appendChild(_focusBtn);

        left.appendChild(controls);

        // v3.10-fix2 F2 (D157): with Up Next hidden, the sleep chip sits
        // under the controls, absolute in the room the column already keeps
        // below them, so the column keeps its pre-S6 size and place.
        _upNextHidden = SonanceSettings.npUpNext === 'hide';
        if (_upNextHidden) {
            var sleepRow = el('div', { className: 'np-sleep-row' });
            sleepRow.appendChild(_buildSleepChip());
            left.appendChild(sleepRow);
        }

        _layoutEl.appendChild(left);

        // Lyrics panel (P14b) — V3-6-fix4 PERF-3: outer panel only on the
        // synchronous render path. Inner wrapper + lines container are built
        // in a rAF below so the screen can paint and become interactive
        // before any lyrics-side DOM work runs. _ensureLyricsPanelInner()
        // synchronously back-fills if the user toggles lyrics ON first.
        _lyricsPanel = el('div', { className: 'np-lyrics-panel' });
        _layoutEl.appendChild(_lyricsPanel);

        // v3.10 R7: the credits panel's box, in its closed state from the
        // start so the first open slides in. Its content is built on open.
        _creditsPanel = el('div', { className: 'np-credits-panel' });
        _layoutEl.appendChild(_creditsPanel);

        if (_upNextHidden) {
            // fix2 F2 (D157): below 60rem of screen height (200 % on a
            // 1080 px screen) the 58.3rem column would put the chip under
            // the bottom edge, so it moves up (css `.sleep-tight`).
            _layoutEl.classList.add('upnext-hidden');
            if (window.innerHeight < SonanceUtils.px(600)) _layoutEl.classList.add('sleep-tight');
        } else if (window.innerHeight < SonanceUtils.px(692)) {
            // v3.10 A6: below 69.2rem of screen height (175 % and 200 % on a
            // 1080 px screen) the column cannot also clear the top nav and
            // stay above the strip with an art of at least 18rem, so it gives
            // up the nav's room (css/styles.css `.upnext-tight`; the nav
            // auto-hides).
            _layoutEl.classList.add('upnext-tight');
        }

        wrapper.appendChild(_layoutEl);
        // v3.10 A6: the strip's box only; its content is built after the
        // first frame (activate), so the synchronous render + activate stays
        // under 16 ms at CPU 6x (R1.4: it was 13–14 ms before S6). Not built
        // at all with Up Next hidden (fix2 F2).
        if (!_upNextHidden) {
            _upNextEl = el('div', { className: 'np-upnext' });
            wrapper.appendChild(_upNextEl);
        }
        // v3.10-fix2 F7 (D159): Focus mode's dim, last, over everything on
        // the screen (css z-index 4); at its stored state from the first
        // frame, so a remembered dim does not fade in on every visit.
        _focusDimEl = el('div', { className: 'np-focus-dim' + (SonanceSettings.npFocus ? ' is-shown is-on' : '') });
        _focusDimEl.addEventListener('transitionend', _onFocusDimFaded);
        wrapper.appendChild(_focusDimEl);
        container.appendChild(wrapper);

        _lyricsBuildRaf = requestAnimationFrame(function() {
            _lyricsBuildRaf = null;
            _ensureLyricsPanelInner();
        });

        log('NowPlaying', 'Now Playing screen rendered');
    }

    function _ensureLyricsPanelInner() {
        if (!_lyricsPanel || _lyricsWrapper) return;
        _lyricsWrapper = el('div', { className: 'np-lyrics-scroll-wrapper' });
        _lyricsLinesEl = el('div', { className: 'np-lyrics-lines' });
        _lyricsWrapper.appendChild(_lyricsLinesEl);
        _lyricsPanel.appendChild(_lyricsWrapper);
    }

    // =========================================
    //  Up Next strip (v3.10 A6) + sleep chip (A7)
    // =========================================

    // The strip's header and a fixed pool of tiles, built once per render
    // (after the first frame); _updateUpNext() fills the tiles in place, so a
    // track change never replaces the node focus is on.
    // The sleep chip (A7): in the strip's header, or alone under the
    // controls with Up Next hidden (fix2 F2).
    function _buildSleepChip() {
        _sleepChip = el('div', { className: 'library-chip np-sleep-chip focusable', id: 'np-sleep-chip' });
        var moon = createSvg('M14.5 2.5a9.5 9.5 0 1 0 7 13.6A7.6 7.6 0 1 1 14.5 2.5z');
        moon.setAttribute('class', 'library-chip-icon');
        _sleepChip.appendChild(moon);
        _sleepChipLabel = el('span', { className: 'np-sleep-chip-label' }, SleepTimer.label());
        _sleepChip.appendChild(_sleepChipLabel);
        _sleepChip.addEventListener('click', function() { SleepTimer.cycle(); });
        _renderSleepChip();
        return _sleepChip;
    }

    function _buildUpNext() {
        if (!_upNextEl || _upNextLabel) return;
        var header = el('div', { className: 'np-upnext-header' });
        _upNextLabel = el('div', { className: 'np-upnext-label' }, 'Up next');
        header.appendChild(_upNextLabel);
        header.appendChild(_buildSleepChip());
        _upNextEl.appendChild(header);

        var row = el('div', { className: 'np-upnext-row' });
        _upNextTiles = [];
        for (var i = 0; i < UP_NEXT_COUNT; i++) {
            var tile = el('div', { className: 'np-upnext-item focusable' });
            var thumb = el('div', { className: 'np-upnext-thumb' });
            var img = document.createElement('img');
            img.setAttribute('decoding', 'async');
            img.onerror = function() { this.style.visibility = 'hidden'; };
            thumb.appendChild(img);
            tile.appendChild(thumb);
            var text = el('div', { className: 'np-upnext-text' });
            text.appendChild(el('div', { className: 'np-upnext-title' }));
            text.appendChild(el('div', { className: 'np-upnext-artist' }));
            tile.appendChild(text);
            tile.addEventListener('click', _onUpNextClick);
            row.appendChild(tile);
            _upNextTiles.push(tile);
        }
        _upNextEmpty = el('div', { className: 'np-upnext-empty' }, 'End of the queue');
        row.appendChild(_upNextEmpty);
        _upNextEl.appendChild(row);
    }

    function _onUpNextClick() {
        var i = _upNextTiles.indexOf(this);
        if (i >= 0 && i < _upNextIndices.length) Player.jumpToQueueIndex(_upNextIndices[i]);
    }

    // The queue indices of the next UP_NEXT_COUNT tracks in play order: the
    // queue after the current one (the shuffled order when shuffle is on),
    // wrapping to the start with repeat all, as Next would.
    function _upNextQueueIndices(s) {
        var out = [];
        var n = s.queue.length;
        if (!s.currentTrack || !n) return out;
        for (var k = 1; k < n && out.length < UP_NEXT_COUNT; k++) {
            var j = s.queueIndex + k;
            if (j >= n) {
                if (s.repeat !== 'all') break;
                j -= n;
            }
            out.push(j);
        }
        return out;
    }

    function _updateUpNext() {
        _updateUpNextVisibility();
        if (_upNextHidden) {
            // fix2 F2: no tiles; the chip is the zone's one element.
            _upNextEls = _sleepChip ? [_sleepChip] : [];
            return;
        }
        if (!_upNextLabel) return;   // not built yet (the first frame)
        var s = Player.getState();
        _upNextIndices = _upNextQueueIndices(s);
        var left = s.currentTrack
            ? (s.repeat === 'all' ? s.queue.length - 1 : s.queue.length - s.queueIndex - 1)
            : 0;
        _upNextLabel.textContent = left > 0
            ? 'Up next · ' + SonanceUtils.formatCount(left) + (left === 1 ? ' song' : ' songs')
            : 'Up next';

        var api = AuthManager.getApi();
        _upNextEls = [];
        for (var i = 0; i < _upNextTiles.length; i++) {
            var tile = _upNextTiles[i];
            var track = i < _upNextIndices.length ? s.queue[_upNextIndices[i]] : null;
            if (!track) {
                tile.style.display = 'none';
                continue;
            }
            tile.style.display = '';
            var img = tile.firstChild.firstChild;
            var cover = track.coverArt || track.albumId;
            // The small-thumb bucket, the NP bar's (D70): the same URL, so
            // the bar's art is a cache hit when this track comes up.
            var src = (api && cover) ? ImageCache.getUrl(cover, SonanceUtils.artSize(100)) : null;
            if (src) {
                if (img.getAttribute('src') !== src) {
                    img.style.visibility = '';
                    img.src = src;
                }
            } else {
                img.removeAttribute('src');
                img.style.visibility = 'hidden';
            }
            var text = tile.lastChild;
            text.firstChild.textContent = track.title || 'Unknown';
            text.lastChild.textContent = track.artist || 'Unknown artist';
            _upNextEls.push(tile);
        }
        _upNextEmpty.style.display = _upNextIndices.length ? 'none' : '';
        _upNextEls.push(_sleepChip);
    }

    // The strip shows with a track and no side panel open (A6). The class
    // also moves the column up and caps the art (css `.upnext-on`). With Up
    // Next hidden (fix2 F2) the same rule shows the lone sleep chip instead
    // (`.sleep-on`), and the column keeps its pre-S6 place.
    function _updateUpNextVisibility() {
        if (!_layoutEl) return;
        var on = !!Player.getState().currentTrack && !_lyricsVisible && !_creditsVisible;
        _layoutEl.classList.toggle(_upNextHidden ? 'sleep-on' : 'upnext-on', on);
        // Focus inside a strip that just hid goes back to the controls.
        if (!on && FocusManager.getActiveZone() === 'np-upnext') {
            FocusManager.setActiveZone('np-controls', PLAY_INDEX, true);
        }
    }

    function _onQueueChange() {
        if (!_active) return;
        _updateUpNext();
        _refocusUpNext();
    }

    // The zone's elements may have changed under the focus (a tile hidden,
    // the chip moved left): re-apply it at the remembered index, clamped.
    function _refocusUpNext() {
        if (FocusManager.getActiveZone() === 'np-upnext') {
            FocusManager.setActiveZone('np-upnext', undefined, true);
        }
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        var pState = Player.getState();
        if (pState.currentTrack) {
            _updateTrack(pState.currentTrack);
            // V3-6-fix4 PERF-1: defer lyrics off the open critical path.
            // Cache hit applies synchronously; cache miss schedules a fetch
            // for the next idle window so first paint + focus aren't blocked.
            _scheduleLyricsForTrack(pState.currentTrack);
        }
        _updateProgress(pState.currentTime, pState.duration);
        _updatePlayIcon(pState.isPlaying);
        _updateShuffle(pState.shuffle);
        _updateRepeat(pState.repeat);
        _updateStar(pState.currentTrack && StarredCache.isSongStarred(pState.currentTrack.id));
        _updateCreditsAvailability(pState.currentTrack);
        _updateUpNext();

        Player.on('trackchange', _onTrackChange);
        Player.on('progress', _onProgress);
        Player.on('play', _onPlay);
        Player.on('pause', _onPause);
        Player.on('shufflechange', _onShuffleChange);
        Player.on('repeatchange', _onRepeatChange);
        Player.on('seeked', _onSeeked);
        // v3.10 A6: shuffle, repeat, a jump or a queue edit re-orders what
        // plays next (toggleShuffle emits queuechange too).
        Player.on('queuechange', _onQueueChange);

        _registerFocusZones();
        // v3.10 A6: build the Up Next tiles in the frame after the first one
        // (a rAF requested now would still run before the first paint).
        // Hidden (fix2 F2), there is nothing to build.
        if (_upNextBuildRaf !== null) cancelAnimationFrame(_upNextBuildRaf);
        if (!_upNextHidden) _upNextBuildRaf = requestAnimationFrame(function() {
            _upNextBuildRaf = requestAnimationFrame(function() {
                _upNextBuildRaf = null;
                if (!_active) return;
                _buildUpNext();
                _updateUpNext();
                _refocusUpNext();
            });
        });
        // V3-6-fix5 FIX-2: defer the focus flip past navigateTo()'s
        // wasInTopNav re-grab (app.js) and force=true to bypass the
        // topnav guard inside FocusManager. By the time this rAF fires,
        // the np-controls zone is registered, the DOM is mounted, and
        // any earlier focus calls from the navigation pass have settled.
        if (_initialFocusRaf !== null) cancelAnimationFrame(_initialFocusRaf);
        _initialFocusRaf = requestAnimationFrame(function() {
            _initialFocusRaf = null;
            if (!_active) return;
            // V3.7-fix29 Bug 3: don't yank focus out of the top nav. If
            // the user arrived via a top-nav slide (or pressed Up to
            // return), let them stay on the nav pill. The Down handler /
            // 5 s auto-hide drops focus into np-controls when the user
            // is ready.
            if (FocusManager.getActiveZone() === 'topnav') return;
            // Cold-open from the now-playing-bar / track-play / Auto-NP
            // setting: focus stays here, on the play button.
            FocusManager.setActiveZone('np-controls', 2, true);
        });

        // V3-6-fix4 PERF-6 / V3.7-fix15: measure the progress bar once
        // after layout settles. _updateProgress reuses the cached width;
        // the click-to-seek handler reuses the cached left + width.
        _progressBarWidth = 0;
        _progressBarLeft = 0;
        if (_progressMeasureRaf !== null) cancelAnimationFrame(_progressMeasureRaf);
        _progressMeasureRaf = requestAnimationFrame(function() {
            _progressMeasureRaf = null;
            if (_progressBar) {
                var r = _progressBar.getBoundingClientRect();
                _progressBarWidth = r.width || 0;
                _progressBarLeft = r.left || 0;
            }
        });
        if (!_progressResizeBound) {
            // V3.7-fix15: debounce the resize re-measure so a drag-resize
            // doesn't thrash layout reads.
            var resizeTimer = null;
            _progressResizeBound = function() {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function() {
                    resizeTimer = null;
                    if (_progressBar) {
                        var r2 = _progressBar.getBoundingClientRect();
                        _progressBarWidth = r2.width || 0;
                        _progressBarLeft = r2.left || 0;
                    } else {
                        _progressBarWidth = 0;
                        _progressBarLeft = 0;
                    }
                }, 120);
            };
            window.addEventListener('resize', _progressResizeBound);
        }
    }

    function _registerFocusZones() {
        // V3-6-fix5 FIX-2: the duplicate 'content' zone (same selector as
        // 'np-controls') was removed. _getPageFirstZone() in app.js falls
        // through to 'np-controls' for NP, so Down-from-topnav and the
        // nav-auto-hide drop both still resolve correctly.
        // NP screen is fullbleed with the top nav hidden — Up/Left do not escape.
        // V3.7-fix29 Bug 1: keep the zone shape stable (constant selector +
        // columns: 7) so the lyrics button is always reachable regardless
        // of whether the current track has lyrics. The is-unavailable
        // class is visual only; the click handler treats it as a no-op.
        // v3.10 R7: 8 columns with the ⓘ button; v3.10-fix2 F7: 9 with Focus
        // mode after it. Still the constant selector.
        FocusManager.registerZone('np-controls', {
            selector: '.np-screen-controls .focusable',
            columns: CONTROLS_COUNT,
            // v3.10 R3 (D54): Down from the progress bar, Down from the top
            // nav and the nav auto-hide drop all land on Play/Pause, not on
            // shuffle. Left/Right inside the row keep their position.
            // R7: Up from the credits list lands on ⓘ, the button that
            // opened it (resolved while np-credits is still the active zone).
            entryIndex: function() {
                return FocusManager.getActiveZone() === 'np-credits' ? CREDITS_INDEX : PLAY_INDEX;
            },
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                up: 'np-progress',
                // Down: the credits list while that panel is open (when it
                // overflows), nothing under lyrics, else Up Next (A6).
                down: _creditsVisible ? 'np-credits' : (_lyricsVisible ? null : 'np-upnext')
            }
        });

        // v3.10 A6/A7: the Up Next tiles, then the sleep chip, in one row.
        // Up returns to Play through np-controls' entryIndex. Empty (so Down
        // does nothing) while the strip is hidden.
        FocusManager.registerZone('np-upnext', {
            getElements: function() { return _upNextEls; },
            columns: UP_NEXT_COUNT + 1,
            entryIndex: 0,
            isAvailable: function() {
                return !!_layoutEl && _layoutEl.classList.contains(_upNextHidden ? 'sleep-on' : 'upnext-on');
            },
            onActivate: function(idx, element) {
                if (element === _sleepChip) SleepTimer.cycle();
                else element.click();
            },
            // v3.10 A5: hold OK on a tile for the options sheet; the sleep
            // chip (after the tiles) keeps OK on keydown.
            hasLongPress: function(idx) { return idx < _upNextIndices.length; },
            onLongPress: function(idx) {
                var track = Player.getState().queue[_upNextIndices[idx]];
                if (track) OptionsSheet.open({ song: track });
            },
            neighbors: {
                up: 'np-controls'
            }
        });

        // v3.10 R7, fix2 F3 (D154): the credits body itself, only while the
        // panel is open and taller than its box. No row is a stop (a
        // highlighted row read as a menu option on the TV); Up/Down scroll
        // the body, Down at the bottom does nothing, and Up at the top falls
        // through to np-controls, whose entryIndex lands on ⓘ.
        FocusManager.registerZone('np-credits', {
            getElements: function() { return _creditsScroll ? [_creditsScroll] : []; },
            columns: 1,
            entryIndex: 0,
            isAvailable: function() { return _creditsVisible && _creditsOverflow; },
            onActivate: function() {},
            onKey: function(direction) {
                if (direction === 'down') {
                    _creditsView.step('down');
                    return true;
                }
                if (direction === 'up') return _creditsView.step('up');
                return false;
            },
            neighbors: {
                up: 'np-controls'
            }
        });

        FocusManager.registerZone('np-progress', {
            selector: '#np-progress-bar',
            columns: 1,
            onActivate: function() {},
            onFocus: function() {},
            onKey: function(direction) {
                if (direction === 'left' || direction === 'right') {
                    var delta = (direction === 'right') ? 10 : -10;
                    var pState = Player.getState();
                    Player.seekTo(Math.max(0, pState.currentTime + delta));
                    return true;
                }
                return false;
            },
            neighbors: {
                down: 'np-controls'
            }
        });
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        _updateTrack(track);
        _updateStar(track && StarredCache.isSongStarred(track.id));
        _scheduleLyricsForTrack(track);
        _updateCreditsAvailability(track);
        // R7: the panel stays open across a track change and shows the new
        // track's credits.
        if (_creditsVisible) {
            if (track) _showCredits(track);
            else _closeCredits();
        }
        _updateUpNext();
        _refocusUpNext();
    }

    function _onProgress(data) {
        if (!_active) return;
        _updateProgress(data.currentTime, data.duration);
        if (_lyricsVisible && _currentLyrics) {
            if (_currentLyrics.synced) {
                LyricsScroller.update(data.currentTime * 1000);
            } else {
                LyricsScroller.updateUnsynced(data.currentTime, data.duration);
            }
        }
    }

    function _onSeeked(currentTime) {
        if (!_active) return;
        if (!_lyricsVisible || !_currentLyrics) return;
        if (_currentLyrics.synced) {
            LyricsScroller.jumpTo(currentTime * 1000);
        } else {
            // D48: seeked carries no duration, and Player refines
            // state.duration after load, so read it back rather than caching.
            LyricsScroller.updateUnsynced(currentTime, Player.getState().duration);
        }
    }

    function _onPlay() {
        if (!_active) return;
        _updatePlayIcon(true);
    }

    function _onPause() {
        if (!_active) return;
        _updatePlayIcon(false);
    }

    function _onShuffleChange(val) {
        if (!_active) return;
        _updateShuffle(val);
    }

    function _onRepeatChange(val) {
        if (!_active) return;
        _updateRepeat(val);
    }

    // =========================================
    //  Lyrics
    // =========================================

    // V3-6-fix4 PERF-1: synchronous cache lookup + post-paint idle fetch on
    // miss. Called from activate() / trackchange instead of
    // _ensureLyricsForTrack so the screen-open critical path never blocks
    // on getLyricsBySongId. rAF + rIC chain: the rAF callback runs at the
    // top of the next frame (so first paint is complete), then rIC defers
    // the network request to browser idle time.
    function _scheduleLyricsForTrack(track) {
        _cancelLyricsDefer();

        if (!track || !track.id) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }
        var songId = track.id;

        // Cache hit: apply synchronously (warm-open path).
        if (_lyricsCache.hasOwnProperty(songId)) {
            _currentLyrics = _lyricsCache[songId];
            _updateLyricsUI();
            return;
        }

        // Cache miss: clear current state, schedule the network fetch for
        // when the main thread is idle. The screen has already painted by then.
        _currentLyrics = null;
        _updateLyricsUI();

        _lyricsRaf = requestAnimationFrame(function() {
            _lyricsRaf = null;
            if (!_active) return;
            _lyricsIdleHandle = _ric(function() {
                _lyricsIdleHandle = null;
                if (!_active) return;
                var ps = Player.getState();
                if (!ps.currentTrack || ps.currentTrack.id !== songId) return;
                _ensureLyricsForTrack(ps.currentTrack);
            });
        });
    }

    function _ensureLyricsForTrack(track) {
        if (!track || !track.id) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }
        var songId = track.id;

        if (_lyricsCache.hasOwnProperty(songId)) {
            _currentLyrics = _lyricsCache[songId];
            _updateLyricsUI();
            return;
        }

        if (_pendingFetches[songId]) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }

        _currentLyrics = null;
        _updateLyricsUI();

        var api = AuthManager.getApi();
        if (!api) return;
        _pendingFetches[songId] = true;
        api.getLyricsBySongId(songId).then(function(response) {
            delete _pendingFetches[songId];
            var parsed = parseLyricsResponse(response);
            _lyricsCache[songId] = parsed;
            if (!_active) return;
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = parsed;
                _updateLyricsUI();
            }
        }).catch(function(err) {
            delete _pendingFetches[songId];
            _lyricsCache[songId] = null;
            warn('NowPlaying', 'Lyrics fetch failed for ' + songId + ': ' + err.message);
            if (!_active) return;
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = null;
                _updateLyricsUI();
            }
        });
    }

    function _updateLyricsUI() {
        if (!_lyricsBtn) return;

        var available = !!(_currentLyrics && _currentLyrics.line && _currentLyrics.line.length);

        // V3.7-fix29 Bug 2: is-unavailable is visual only. _lyricsVisible
        // (the user's intent: panel open vs closed) is decoupled from the
        // data state and must only flip via _toggleLyrics / _openLyrics /
        // _closeLyrics in response to user input. Track changes no longer
        // close the panel.
        if (available) {
            _lyricsBtn.classList.remove('is-unavailable');
        } else {
            _lyricsBtn.classList.add('is-unavailable');
        }

        if (_lyricsVisible && available) {
            _ensureLyricsPanelInner();
            LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
            var ps = Player.getState();
            if (_currentLyrics.synced) {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            } else {
                LyricsScroller.updateUnsynced(ps.currentTime || 0, ps.duration || 0);
            }
        } else if (_lyricsVisible && !available) {
            // Panel still open but the new track has no lyrics — empty
            // the lines so the previous track's content doesn't linger.
            // _onProgress / _onSeeked guard with `_currentLyrics &&` so
            // they're already safe in this state.
            _ensureLyricsPanelInner();
            LyricsScroller.reset();
        }

        if (_active) _registerFocusZones();
    }

    function _toggleLyrics() {
        // V3.7-fix29 Bug 1: clicks/Enter while the button is visually
        // disabled (no lyrics for the current track) are a no-op. The
        // button stays focusable so the user can pass Right through it,
        // but pressing it must not flip _lyricsVisible.
        if (_lyricsBtn && _lyricsBtn.classList.contains('is-unavailable')) return;
        if (_lyricsVisible) {
            _closeLyrics();
        } else {
            _openLyrics();
        }
    }

    // V3-6-fix4 PERF-4: replaces the static will-change declarations on
    // .np-left, .np-lyrics-panel, .np-lyrics-lines. Set just before the
    // class flip kicks off the transition; cleared 300ms later (after
    // the 250ms slide settles) so the GPU layers don't stay reserved.
    function _enableLyricsCompositingHints() {
        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
            _willChangeClearTimer = null;
        }
        if (_leftEl) _leftEl.style.willChange = 'transform';
        if (_lyricsPanel) _lyricsPanel.style.willChange = 'transform, opacity';
        if (_lyricsLinesEl) _lyricsLinesEl.style.willChange = 'transform';
    }

    function _scheduleClearLyricsCompositingHints() {
        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
        }
        _willChangeClearTimer = setTimeout(function() {
            _willChangeClearTimer = null;
            if (_leftEl) _leftEl.style.willChange = '';
            if (_lyricsPanel) _lyricsPanel.style.willChange = '';
            if (_lyricsLinesEl) _lyricsLinesEl.style.willChange = '';
            // R7: one timer for both panels, so a swap from lyrics to
            // credits (which restarts it) still clears the lyrics hints.
            if (_creditsPanel) _creditsPanel.style.willChange = '';
        }, 300);
    }

    function _openLyrics() {
        if (!_currentLyrics || !_currentLyrics.line || !_currentLyrics.line.length) return;
        // R7: one side panel at a time; the column stays where it is.
        if (_creditsVisible) _closeCredits();
        _ensureLyricsPanelInner();
        _enableLyricsCompositingHints();
        _lyricsVisible = true;
        _layoutEl.classList.add('lyrics-active');
        _lyricsBtn.classList.add('is-active');
        _updateUpNextVisibility();
        _registerFocusZones();
        LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
        var ps = Player.getState();
        if (_currentLyrics.synced) {
            setTimeout(function() {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            }, 50);
        } else {
            // D48: same 50ms defer as the synced path, so the panel's slide has
            // started and the layout cache is measured against the settled box.
            setTimeout(function() {
                LyricsScroller.updateUnsynced(ps.currentTime || 0, ps.duration || 0);
            }, 50);
        }
    }

    function _closeLyrics() {
        _lyricsVisible = false;
        _enableLyricsCompositingHints(); // hold hints through the close slide
        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        if (_lyricsBtn) _lyricsBtn.classList.remove('is-active');
        LyricsScroller.reset();
        _scheduleClearLyricsCompositingHints();
        _updateUpNextVisibility();
        if (_active) _registerFocusZones();
    }

    // =========================================
    //  Credits (v3.10 R7)
    // =========================================

    // Available whenever there is a track: the queue's track object alone
    // has enough for the Release and File sections. With no track the button
    // is dimmed and Enter does nothing (D55).
    function _updateCreditsAvailability(track) {
        if (!_creditsBtn) return;
        if (track) _creditsBtn.classList.remove('is-unavailable');
        else _creditsBtn.classList.add('is-unavailable');
    }

    function _toggleCredits() {
        if (_creditsBtn && _creditsBtn.classList.contains('is-unavailable')) return;
        if (_creditsVisible) _closeCredits();
        else _openCredits();
    }

    function _openCredits() {
        var track = Player.getState().currentTrack;
        if (!track || !_creditsPanel) return;
        if (_lyricsVisible) _closeLyrics();
        if (!_creditsScroll) {
            _creditsPanel.appendChild(el('div', { className: 'np-credits-title' }, 'Credits'));
            _creditsSubtitle = el('div', { className: 'np-credits-subtitle' });
            _creditsPanel.appendChild(_creditsSubtitle);
            _creditsScroll = el('div', { className: 'np-credits-scroll' });
            _creditsView = SonanceComponents.createScrollView(_creditsScroll);
            _creditsPanel.appendChild(_creditsView.root);
        }
        // The lyrics panel's compositing hints (V3-6-fix4 PERF-4), held for
        // the slide and cleared after it.
        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
            _willChangeClearTimer = null;
        }
        if (_leftEl) _leftEl.style.willChange = 'transform';
        _creditsPanel.style.willChange = 'transform, opacity';
        _creditsVisible = true;
        _layoutEl.classList.add('credits-active');
        _creditsBtn.classList.add('is-active');
        _showCredits(track);
        _updateUpNextVisibility();
        _scheduleClearLyricsCompositingHints();
    }

    function _closeCredits() {
        if (!_creditsVisible) return;
        _creditsVisible = false;
        var hadFocus = FocusManager.getActiveZone() === 'np-credits';
        if (_leftEl) _leftEl.style.willChange = 'transform';
        if (_creditsPanel) _creditsPanel.style.willChange = 'transform, opacity';
        if (_layoutEl) _layoutEl.classList.remove('credits-active');
        if (_creditsBtn) _creditsBtn.classList.remove('is-active');
        _creditsOverflow = false;
        _updateUpNextVisibility();
        if (_active) {
            _registerFocusZones();
            if (hadFocus) FocusManager.setActiveZone('np-controls', CREDITS_INDEX, true);
        }
        _scheduleClearLyricsCompositingHints();
    }

    // Draw what is known now (the track; getSong / getAlbum once they have
    // answered), then ask for whichever has not been asked this session.
    function _showCredits(track) {
        _renderCredits(track);
        var api = AuthManager.getApi();
        if (!api) return;
        var songId = track.id;
        if (songId && !_creditsSongCache.hasOwnProperty(songId) && !_creditsPending['s' + songId]) {
            _creditsPending['s' + songId] = true;
            api.getSong(songId).then(function(song) {
                _creditsSongCache[songId] = song || {};
            }, function(err) {
                _creditsSongCache[songId] = {};
                warn('NowPlaying', 'getSong failed for credits: ' + (err && err.message));
            }).then(function() {
                delete _creditsPending['s' + songId];
                _refreshCreditsFor(songId);
            });
        }
        var albumId = track.albumId;
        if (albumId && !_creditsAlbumCache.hasOwnProperty(albumId) && !_creditsPending['a' + albumId]) {
            _creditsPending['a' + albumId] = true;
            api.getAlbum(albumId).then(function(album) {
                _creditsAlbumCache[albumId] = album || {};
            }, function() {
                _creditsAlbumCache[albumId] = {};
            }).then(function() {
                delete _creditsPending['a' + albumId];
                var t = Player.getState().currentTrack;
                if (t && t.albumId === albumId) _refreshCreditsFor(t.id);
            });
        }
    }

    // A late answer is drawn only if its song is still the one on screen.
    function _refreshCreditsFor(songId) {
        if (!_active || !_creditsVisible) return;
        var t = Player.getState().currentTrack;
        if (t && t.id === songId) _renderCredits(t);
    }

    function _renderCredits(track) {
        if (!_creditsScroll) return;
        // The fetched song wins field by field over the queue's copy.
        var song = {};
        var k;
        for (k in track) if (track.hasOwnProperty(k)) song[k] = track[k];
        var fetched = _creditsSongCache[track.id];
        if (fetched) for (k in fetched) if (fetched.hasOwnProperty(k)) song[k] = fetched[k];
        var album = track.albumId ? (_creditsAlbumCache[track.albumId] || null) : null;

        _creditsSubtitle.textContent = (song.title || 'Unknown') + (song.artist ? ' — ' + song.artist : '');
        var hadFocus = FocusManager.getActiveZone() === 'np-credits';
        _clearNode(_creditsScroll);
        SonanceComponents.renderCreditSections(_creditsScroll,
            SonanceComponents.creditSections(song, album));
        _creditsScroll.scrollTop = 0;
        // One layout read per render: the body is a focus stop only when it
        // has to scroll.
        _creditsOverflow = _creditsScroll.scrollHeight > _creditsScroll.clientHeight + 1;
        _creditsView.measure();
        _registerFocusZones();
        // New content starts at the top: the scroller keeps the focus, or
        // it goes back to ⓘ if the new content fits.
        if (hadFocus) {
            if (_creditsOverflow) FocusManager.setActiveZone('np-credits', 0, true);
            else FocusManager.setActiveZone('np-controls', CREDITS_INDEX, true);
        }
    }

    // =========================================
    //  Focus mode (v3.10-fix2 F7)
    // =========================================

    // D159: Enter on #np-focus dims the whole screen by half (css
    // `.np-focus-dim.is-on`, an opacity fade) and remembers it until it is
    // toggled off; the button shows the on state like an open panel's. Off,
    // the overlay is not rendered (`.is-shown`): shown, then faded in; faded
    // out, then hidden, by its transitionend or, if that never comes, a
    // timer just past the 0.25 s fade.
    var _focusDimHideTimer = null;

    function _toggleFocusMode() {
        SonanceSettings.npFocus = !SonanceSettings.npFocus;
        try {
            localStorage.setItem('sonance-np-focus', SonanceSettings.npFocus ? 'on' : 'off');
        } catch (e) { /* storage full: the change holds for this session */ }
        if (_focusBtn) _focusBtn.classList.toggle('is-active', SonanceSettings.npFocus);
        if (_focusDimEl) {
            if (_focusDimHideTimer !== null) {
                clearTimeout(_focusDimHideTimer);
                _focusDimHideTimer = null;
            }
            if (SonanceSettings.npFocus) {
                _focusDimEl.classList.add('is-shown');
                // Commit the shown, transparent state so the fade runs.
                void _focusDimEl.offsetWidth;
                _focusDimEl.classList.add('is-on');
            } else {
                _focusDimEl.classList.remove('is-on');
                _focusDimHideTimer = setTimeout(_onFocusDimFaded, 300);
            }
        }
        log('NowPlaying', 'Focus mode: ' + (SonanceSettings.npFocus ? 'on' : 'off'));
    }

    function _onFocusDimFaded() {
        if (_focusDimHideTimer !== null) {
            clearTimeout(_focusDimHideTimer);
            _focusDimHideTimer = null;
        }
        if (_focusDimEl && !SonanceSettings.npFocus) _focusDimEl.classList.remove('is-shown');
    }

    // v3.10 R7: Back closes the credits panel before it leaves Now Playing.
    // App.goBack asks the screen first, so the sink (D93) does not run.
    function handleBack() {
        if (!_active || !_creditsVisible) return false;
        _closeCredits();
        return true;
    }

    // =========================================
    //  UI Update Functions
    // =========================================

    // V3.7-fix19: show/hide a single placeholder element rather than
    // rebuilding the cover container on every error/no-art frame.
    function _showArtPlaceholder(track) {
        if (!_artImg) return;
        if (_artImgEl) _artImgEl.style.display = 'none';
        if (!_artPlaceholderEl) {
            _artPlaceholderEl = document.createElement('div');
            _artPlaceholderEl.className = 'np-art-placeholder';
            _artPlaceholderEl.style.width = '100%';
            _artPlaceholderEl.style.height = '100%';
            _artImg.appendChild(_artPlaceholderEl);
        }
        // Re-skin the placeholder in place (avoid swapping nodes).
        while (_artPlaceholderEl.firstChild) {
            _artPlaceholderEl.removeChild(_artPlaceholderEl.firstChild);
        }
        if (track) {
            var ph = SonanceComponents.renderAlbumArt(track, 280, null);
            _artPlaceholderEl.appendChild(ph);
        }
        _artPlaceholderEl.style.display = '';
    }

    function _hideArtPlaceholder() {
        if (_artPlaceholderEl) _artPlaceholderEl.style.display = 'none';
    }

    function _updateTrack(track) {
        if (!track) return;

        if (_titleEl) _titleEl.textContent = track.title || 'Unknown';
        if (_subtitleEl) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _subtitleEl.textContent = parts.join(' — ') || 'Unknown';
        }

        // V3.7-fix19: mutate the persistent <img> src in place rather than
        // tearing down and rebuilding the cover container.
        if (_artImg) {
            var api = AuthManager.getApi();
            var npCover = track.coverArt || track.albumId;
            if (api && npCover && _artImgEl) {
                _hideArtPlaceholder();
                _artImgEl.style.display = '';
                // Pull through cache so re-opening NP for the same track
                // is instant (warm hit), or kick off a fresh fetch.
                // V3.9 T1: 320, matching the >220 renderAlbumArt bucket for the
                // 280 px .np-screen-art-inner. Was 600 (2.1x over-fetch at DPR 1).
                _artImgEl.src = ImageCache.getUrl(npCover, SonanceUtils.artSize(320));   // v3.10 D70
            } else {
                _showArtPlaceholder(track);
            }
        }

        if (_bgEl) {
            var api2 = AuthManager.getApi();
            if (api2 && (track.coverArt || track.albumId)) {
                // V3-5 perf: 60px source image upscaled + blur(30px) is
                // visually equivalent to 600px + blur(100px) at a fraction
                // of the cost. URL routed through ImageCache so it doesn't
                // refetch when the user opens NP for the same track twice.
                _bgEl.style.backgroundImage = 'url(' + ImageCache.getUrl(track.coverArt || track.albumId, SonanceUtils.artSize(100)) + ')';   // D70
            } else {
                var colors = SonanceComponents.hashColor(track.album || track.title || 'unknown');
                _bgEl.style.backgroundImage = 'none';
                _bgEl.style.background = 'radial-gradient(ellipse at center, ' +
                    colors.base + ' 0%, ' + colors.dark + ' 50%, var(--bg-primary) 100%)';
            }
        }
    }

    function _updateProgress(currentTime, duration) {
        var pct = (duration > 0) ? (currentTime / duration) * 100 : 0;

        if (_progressFill) {
            _progressFill.style.setProperty('--progress', (pct / 100).toString());
        }
        if (_progressScrubber && _progressBar) {
            // V3-6-fix4 PERF-6: cached width; fall back to a live read
            // only on the very first tick before the rAF measure lands.
            var trackW = _progressBarWidth;
            if (!trackW) {
                trackW = _progressBar.getBoundingClientRect().width;
                _progressBarWidth = trackW;
            }
            _progressScrubber.style.setProperty('--scrub-x', ((pct / 100) * trackW) + 'px');
        }
        // V3.9 T3: both time nodes were rewritten on every progress tick
        // (2-10 Hz), dirtying the space-between flex row they share, while
        // the strings change at most once a second and, for the total, once
        // per track. The total is NOT moved into _updateTrack: Player refines
        // state.duration from the media element's own metadata after load
        // (js/player.js:182/216/317/503), so track.duration is not the final
        // value. Comparing the formatted string covers both cases.
        var curText = formatDuration(currentTime);
        if (_timeCurrent && curText !== _timeCurrentText) {
            _timeCurrent.textContent = curText;
            _timeCurrentText = curText;
        }
        var totText = formatDuration(duration);
        if (_timeTotal && totText !== _timeTotalText) {
            _timeTotal.textContent = totText;
            _timeTotalText = totText;
        }
    }

    function _updatePlayIcon(isPlaying) {
        if (!_playBtn) return;
        _clearNode(_playBtn);
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = rem(22);
        icon.style.height = rem(22);
        _playBtn.appendChild(icon);
    }

    function _updateShuffle(active) {
        if (!_shuffleBtn) return;
        if (active) {
            _shuffleBtn.classList.add('active');
        } else {
            _shuffleBtn.classList.remove('active');
        }
    }

    function _updateStar(starred) {
        if (!_starBtn) return;
        _clearNode(_starBtn);
        var icon = createStarSvg(!!starred);
        icon.style.width = rem(20);
        icon.style.height = rem(20);
        _starBtn.appendChild(icon);
        if (starred) {
            _starBtn.classList.add('is-starred');
        } else {
            _starBtn.classList.remove('is-starred');
        }
    }

    function _updateRepeat(mode) {
        if (!_repeatBtn) return;
        _clearNode(_repeatBtn);

        var svgPath = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
        var repeatSvg = createSvg(svgPath);
        repeatSvg.style.width = rem(22);
        repeatSvg.style.height = rem(22);
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);

        if (mode === 'none') {
            _repeatBtn.classList.remove('active');
        } else {
            _repeatBtn.classList.add('active');
        }

        if (mode === 'one') {
            var badge = el('span', { className: 'np-repeat-badge' }, '1');
            _repeatBtn.appendChild(badge);
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        _cancelLyricsDefer();

        // V3-6-fix5 FIX-2: drop a still-pending initial-focus rAF so we
        // don't yank focus into a zone that's about to be unregistered.
        if (_initialFocusRaf !== null) {
            cancelAnimationFrame(_initialFocusRaf);
            _initialFocusRaf = null;
        }

        if (_lyricsBuildRaf !== null) {
            cancelAnimationFrame(_lyricsBuildRaf);
            _lyricsBuildRaf = null;
        }
        if (_upNextBuildRaf !== null) {
            cancelAnimationFrame(_upNextBuildRaf);
            _upNextBuildRaf = null;
        }

        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
            _willChangeClearTimer = null;
        }

        if (_progressMeasureRaf !== null) {
            cancelAnimationFrame(_progressMeasureRaf);
            _progressMeasureRaf = null;
        }
        if (_progressResizeBound) {
            window.removeEventListener('resize', _progressResizeBound);
            _progressResizeBound = null;
        }
        _progressBarWidth = 0;
        _progressBarLeft = 0;

        Player.off('trackchange', _onTrackChange);
        Player.off('progress', _onProgress);
        Player.off('play', _onPlay);
        Player.off('pause', _onPause);
        Player.off('shufflechange', _onShuffleChange);
        Player.off('repeatchange', _onRepeatChange);
        Player.off('seeked', _onSeeked);
        Player.off('queuechange', _onQueueChange);

        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        _lyricsVisible = false;
        LyricsScroller.destroy();

        // R7 / A6: the panel closes with the screen (it is not reopened on
        // the next visit); the sleep timer itself keeps running (A7).
        _creditsVisible = false;
        _creditsOverflow = false;
        _creditsBtn = null;
        _creditsPanel = null;
        _creditsSubtitle = null;
        _creditsScroll = null;
        _creditsView = null;
        _upNextEl = null;
        _upNextLabel = null;
        _upNextEmpty = null;
        _upNextTiles = [];
        _upNextIndices = [];
        _upNextEls = [];
        _sleepChip = null;
        _sleepChipLabel = null;
        _upNextHidden = false;
        if (_focusDimHideTimer !== null) {
            clearTimeout(_focusDimHideTimer);
            _focusDimHideTimer = null;
        }
        _focusBtn = null;
        _focusDimEl = null;

        _container = null;
        _artImg = null;
        // V3.7-fix19: drop persistent <img> + placeholder refs.
        if (_artImgEl) {
            // Releasing the bitmap by clearing src lets the browser GC the
            // decoded image when NP is closed; on re-open the new track
            // will set src again.
            // V3.9 T9: removeAttribute, not `src = ''` — older Chromium
            // resolves the empty string against the document URL and
            // re-requests the page. Same reason ImageCache.cancel does it
            // this way (V3.9 T8a).
            _artImgEl.removeAttribute('src');
        }
        _artImgEl = null;
        _artPlaceholderEl = null;
        _titleEl = null;
        _subtitleEl = null;
        _progressFill = null;
        _progressScrubber = null;
        _timeCurrent = null;
        _timeTotal = null;
        _playBtn = null;
        _shuffleBtn = null;
        _repeatBtn = null;
        _starBtn = null;
        _lyricsBtn = null;
        _bgEl = null;
        _progressBar = null;
        _layoutEl = null;
        _leftEl = null;
        _lyricsPanel = null;
        _lyricsWrapper = null;
        _lyricsLinesEl = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate,
        handleBack: handleBack
    };
})();

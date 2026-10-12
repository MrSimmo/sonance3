/* ============================================
   Sonance — Performance overlay (v3.10 R1.1)
   An on-device readout for the TV, where DevTools are not available:
   FPS and worst frame over the last second, the last key's keydown →
   painted-frame latency, long tasks, #app element count and the screen;
   since 3.14 (H4) also the last 12 key events.
   ============================================ */

var PerfHud = (function() {
    'use strict';

    var STORAGE_KEY = 'sonance-perf-hud';
    // 2 Hz text refresh, as a setTimeout chain: interval timers are banned by the
    // v3.10 regression grep, and a chain cannot pile up behind a busy frame.
    var UPDATE_MS = 500;
    var WINDOW_MS = 1000;
    // Frame timestamps for the last second. 256 slots cover 1 s at up to
    // 240 Hz without allocating per frame.
    var RING = 256;

    var _enabled = false;
    var _el = null;
    var _rafId = null;
    var _timer = null;
    var _observer = null;
    var _longSupported = false;
    var _longCount = 0;
    var _ring = null;
    var _ringPos = 0;
    var _keyLatency = null;
    // 3.14 H4 (D213): the last KEY_TRACE key events, newest last, so a photo
    // of the TV shows what a remote sends while OK is held (ticket-3.14 §8
    // Q1). One formatted line per event; the panel is redrawn at 2 Hz.
    var KEY_TRACE = 12;
    var KEY_NAME_MAX = 16;
    var _keysEl = null;
    var _keys = null;
    var _keysDirty = false;
    var _lastKeyTs = null;

    // When off, NOTHING below is attached: no rAF loop, no listener, no
    // observer (R1.1 acceptance, asserted by e2e/perf-hud.spec.ts and, for
    // keyup, e2e/perf-hud-keys.spec.ts).

    function _onFrame(ts) {
        _ring[_ringPos] = ts;
        _ringPos = (_ringPos + 1) % RING;
        _rafId = requestAnimationFrame(_onFrame);
    }

    // `down  13  Enter  rep  +40 ms`: the gap is from event.timeStamp, the
    // time the platform stamped the event, not when it was handled.
    function _trace(e) {
        var key = e.key === ' ' ? 'Space' : (e.key || '?');
        if (key.length > KEY_NAME_MAX) key = key.slice(0, KEY_NAME_MAX);
        var gap = _lastKeyTs === null ? '-' : '+' + Math.round(e.timeStamp - _lastKeyTs) + ' ms';
        _lastKeyTs = e.timeStamp;
        _keys.push((e.type === 'keyup' ? 'up' : 'down') + '  ' + e.keyCode + '  ' + key +
            (e.repeat ? '  rep' : '') + '  ' + gap);
        if (_keys.length > KEY_TRACE) _keys.shift();
        _keysDirty = true;
    }

    // Capture phase so the clock starts before FocusManager's own (bubble)
    // handler does the work. Two rAFs = the frame that shows the result.
    function _onKey(e) {
        var t0 = performance.now();
        _trace(e);
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (_enabled) _keyLatency = performance.now() - t0;
            });
        });
    }

    function _onKeyUp(e) {
        _trace(e);
    }

    function _startLongTasks() {
        _longSupported = false;
        if (typeof PerformanceObserver === 'undefined') return;
        // PerformanceObserver.supportedEntryTypes only exists from Chrome 73;
        // on Chromium 63 an observe() that does not throw is the only signal.
        var types = PerformanceObserver.supportedEntryTypes;
        if (types && types.indexOf('longtask') < 0) return;
        try {
            _observer = new PerformanceObserver(function(list) {
                _longCount += list.getEntries().length;
            });
            _observer.observe({ entryTypes: ['longtask'] });
            _longSupported = true;
        } catch (e) {
            _observer = null;
        }
    }

    function _update() {
        _timer = null;
        if (!_enabled || !_el) return;

        var now = performance.now();
        var frames = 0;
        var worst = 0;
        var prev = 0;
        // Oldest → newest: _ringPos is the next slot to overwrite.
        for (var i = 0; i < RING; i++) {
            var ts = _ring[(_ringPos + i) % RING];
            if (!ts) continue;
            if (ts >= now - WINDOW_MS) {
                frames++;
                if (prev && ts - prev > worst) worst = ts - prev;
            }
            prev = ts;
        }

        var app = document.getElementById('app');
        var count = app ? app.getElementsByTagName('*').length : 0;
        var screen = (typeof App !== 'undefined' && App.getCurrentScreen) ? (App.getCurrentScreen() || 'login') : '-';

        _el.textContent =
            'FPS ' + frames + '  worst ' + Math.round(worst) + ' ms\n' +
            'key ' + (_keyLatency === null ? '-' : Math.round(_keyLatency) + ' ms') +
            '  long ' + (_longSupported ? _longCount : 'n/a') + '\n' +
            'els ' + count + '  ' + screen;

        if (_keysDirty) {
            _keysDirty = false;
            _keysEl.textContent = 'keys, newest last\n' + _keys.join('\n');
        }

        _timer = setTimeout(_update, UPDATE_MS);
    }

    function _start() {
        if (_enabled) return;
        _enabled = true;
        _ring = new Float64Array(RING);
        _ringPos = 0;
        _longCount = 0;
        _keyLatency = null;

        // Outside #app on purpose: _showLogin() and every screen swap clear
        // #app, and the overlay has to survive navigation.
        _el = document.createElement('div');
        _el.id = 'perf-hud';
        _el.className = 'perf-hud';
        _el.textContent = 'FPS -';
        document.body.appendChild(_el);
        _keys = [];
        _keysDirty = false;
        _lastKeyTs = null;
        _keysEl = document.createElement('div');
        _keysEl.id = 'perf-hud-keys';
        _keysEl.className = 'perf-hud perf-hud-keys';
        _keysEl.textContent = 'keys, newest last';
        document.body.appendChild(_keysEl);

        document.addEventListener('keydown', _onKey, true);
        document.addEventListener('keyup', _onKeyUp, true);
        _startLongTasks();
        _rafId = requestAnimationFrame(_onFrame);
        _timer = setTimeout(_update, UPDATE_MS);
    }

    function _stop() {
        if (!_enabled) return;
        _enabled = false;
        if (_rafId !== null) cancelAnimationFrame(_rafId);
        _rafId = null;
        if (_timer !== null) clearTimeout(_timer);
        _timer = null;
        document.removeEventListener('keydown', _onKey, true);
        document.removeEventListener('keyup', _onKeyUp, true);
        if (_observer) _observer.disconnect();
        _observer = null;
        if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
        _el = null;
        if (_keysEl && _keysEl.parentNode) _keysEl.parentNode.removeChild(_keysEl);
        _keysEl = null;
        _keys = null;
        _ring = null;
    }

    function _persist(on) {
        try { localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false'); } catch (e) {}
    }

    /** Show the overlay and remember the choice (Settings → Advanced). */
    function enable() {
        _persist(true);
        _start();
    }

    /** Hide the overlay, detach everything, and remember the choice. */
    function disable() {
        _persist(false);
        _stop();
    }

    function isEnabled() {
        return _enabled;
    }

    // Restore the stored choice at load. Off by default. This file loads at
    // the end of <body> (core bundle), so document.body exists; the listener
    // fallback is only reached when the overlay is on.
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (stored === 'true') {
        if (document.body) _start();
        else document.addEventListener('DOMContentLoaded', _start);
    }

    return {
        enable: enable,
        disable: disable,
        isEnabled: isEnabled
    };
})();

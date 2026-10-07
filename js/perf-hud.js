/* ============================================
   Sonance — Performance overlay (v3.10 R1.1)
   An on-device readout for the TV, where DevTools are not available:
   FPS and worst frame over the last second, the last key's keydown →
   painted-frame latency, long tasks, #app element count and the screen.
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

    // When off, NOTHING below is attached: no rAF loop, no listener, no
    // observer (R1.1 acceptance, asserted by e2e/perf-hud.spec.ts).

    function _onFrame(ts) {
        _ring[_ringPos] = ts;
        _ringPos = (_ringPos + 1) % RING;
        _rafId = requestAnimationFrame(_onFrame);
    }

    // Capture phase so the clock starts before FocusManager's own (bubble)
    // handler does the work. Two rAFs = the frame that shows the result.
    function _onKey() {
        var t0 = performance.now();
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (_enabled) _keyLatency = performance.now() - t0;
            });
        });
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

        document.addEventListener('keydown', _onKey, true);
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
        if (_observer) _observer.disconnect();
        _observer = null;
        if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
        _el = null;
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

/* ============================================
   Sonance — scriptable AVPlay stub (TEST ONLY)
   ============================================

   webapis.avplay exists only on Tizen, so js/player.js's AVPlay branch is
   unreachable in a browser and the V3.9 Session 4 guards (T2 load generation,
   T3 error cascade cap) cannot be end-to-end tested on the device from here.
   This stub installs a scriptable `window.webapis.avplay` BEFORE the app's
   scripts run — inject it with Playwright's `addInitScript` — so `IS_TIZEN`
   is true and the real AVPlay code path executes against it.

   It is a test double, not an emulator: it models the call sequence and the
   state machine js/player.js depends on, and nothing else. It never ships —
   nothing under tests/ is listed in build.sh.

   Contract exposed to the test as `window.__avstub`:

     log        ordered [{ call, session, arg }] for every method invoked
     calls(n)   count of `n` in the log
     sessions   how many times open() has been called
     pending    the prepareAsync callbacks not yet fired, each tagged with the
                session that registered it
     mode       'manual' (default) | 'auto-ok' | 'auto-fail'
                auto-* fire each prepareAsync asynchronously on a microtask,
                which is what a real device does and what T3's cascade needs
     setScript(a) one outcome per prepareAsync, consumed in order — e.g.
                ['err','err','ok'] fails two loads then succeeds. Overrides mode.
     prepareErrors the values the next failing prepareAsync calls pass to
                their error callback, in order (default 'STUB_PREPARE_FAILED')
     fire(i, r) fire pending[i] with 'ok' or 'err' (manual mode)
     fireAll(r) fire every pending callback in registration order
     listener   the most recent object passed to setListener
     reset()    clear the log, keep the installed stub
*/
(function () {
    'use strict';

    var log = [];
    var pending = [];
    var session = 0;
    var avState = 'NONE';   // NONE -> IDLE -> READY -> PLAYING/PAUSED
    var listener = null;
    var duration = 214000;  // ms; arbitrary but stable
    var prepareErrors = [];  // v3.12 R6: error values for the next prepareAsync failures

    function rec(call, arg) {
        log.push({ call: call, session: session, arg: arg === undefined ? null : arg });
    }

    var api = {
        mode: 'manual',
        script: null,

        open: function (url) {
            session++;
            rec('open', url);
            avState = 'IDLE';
        },
        close: function () {
            rec('close');
            avState = 'NONE';
            listener = null;
        },
        stop: function () {
            rec('stop');
            avState = 'IDLE';
        },
        setDisplayRect: function (x, y, w, h) {
            rec('setDisplayRect', [x, y, w, h].join(','));
        },
        setListener: function (l) {
            rec('setListener');
            listener = l;
        },
        prepareAsync: function (onOk, onErr) {
            var entry = { session: session, ok: onOk, err: onErr, fired: false };
            pending.push(entry);
            rec('prepareAsync', 'pending#' + (pending.length - 1));
            // `script` wins over `mode`: one outcome per prepareAsync, in
            // order, so a test can fail loads 1-3 and succeed on 4.
            var want = null;
            if (api.script && api.script.length) want = api.script.shift();
            else if (api.mode === 'auto-ok') want = 'ok';
            else if (api.mode === 'auto-fail') want = 'err';
            if (want) {
                // A real device calls back asynchronously; Promise.resolve is
                // the shortest async hop available on Chromium 63.
                Promise.resolve().then(function () { fireEntry(entry, want); });
            }
        },
        play: function () {
            rec('play');
            avState = 'PLAYING';
        },
        pause: function () {
            rec('pause');
            avState = 'PAUSED';
        },
        seekTo: function (ms) {
            rec('seekTo', ms);
        },
        getState: function () {
            return avState;
        },
        getDuration: function () {
            return duration;
        },
        setSilentSubtitle: function () {},
        setStreamingProperty: function () {}
    };

    function fireEntry(entry, result) {
        if (!entry || entry.fired) return false;
        entry.fired = true;
        if (result === 'ok') {
            avState = 'READY';
            rec('prepare:ok', 'session#' + entry.session);
            if (entry.ok) entry.ok();
        } else {
            rec('prepare:err', 'session#' + entry.session);
            // v3.12 R6: a device passes a WebAPIException ({ name:
            // 'NotSupportedError', ... }); a test queues the values to pass.
            var errValue = prepareErrors.length ? prepareErrors.shift() : 'STUB_PREPARE_FAILED';
            if (entry.err) entry.err(errValue);
        }
        return true;
    }

    window.webapis = window.webapis || {};
    window.webapis.avplay = api;
    // js/player.js's _suppressScreenSaver reads this; a no-op keeps that path
    // exercised rather than short-circuited.
    window.webapis.appcommon = {
        AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
        setScreenSaver: function (v, ok) { rec('setScreenSaver', v); if (ok) ok(); }
    };

    window.__avstub = {
        get log() { return log; },
        get sessions() { return session; },
        get listener() { return listener; },
        get state() { return avState; },
        get mode() { return api.mode; },
        set mode(m) { api.mode = m; },
        setScript: function (arr) { api.script = arr ? arr.slice() : null; },
        get prepareErrors() { return prepareErrors; },
        set prepareErrors(arr) { prepareErrors = arr ? arr.slice() : []; },
        get pending() {
            return pending.map(function (p, i) {
                return { i: i, session: p.session, fired: p.fired };
            });
        },
        calls: function (name) {
            var n = 0;
            for (var i = 0; i < log.length; i++) if (log[i].call === name) n++;
            return n;
        },
        // Compact "call@session" trace, which is what the T2 assertions read.
        trace: function () {
            return log.map(function (e) { return e.call + '@' + e.session; });
        },
        fire: function (i, result) { return fireEntry(pending[i], result || 'ok'); },
        fireAll: function (result) {
            var n = 0;
            for (var i = 0; i < pending.length; i++) if (fireEntry(pending[i], result || 'ok')) n++;
            return n;
        },
        // Emit through the listener the app most recently registered.
        emit: function (name, arg) {
            if (!listener || typeof listener[name] !== 'function') return false;
            listener[name](arg);
            return true;
        },
        reset: function () { log.length = 0; }
    };
})();

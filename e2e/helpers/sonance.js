// Sonance e2e helpers (v3.10 Session 1).
//
// Plain CommonJS on purpose: the @playwright/test specs under e2e/ import it,
// and so do the Node-API measurement scripts under tests/tools/ (visual
// baseline, perf baseline), which run outside the test runner. Every helper
// takes a Playwright `Page` and works with either.
//
// All navigation is keyboard-only (prompt-3.10 A3.1): clicking bypasses
// FocusManager and proves nothing about the d-pad.

'use strict';

var path = require('path');

var MOCK_BOOT = path.resolve(__dirname, '..', '..', 'tests', 'mock-boot.js');

// The nine screens App routes to (js/app.js `_screens`).
var SCREENS = {
    home: 'HomeScreen',
    library: 'LibraryScreen',
    search: 'SearchScreen',
    playlists: 'PlaylistsScreen',
    nowplaying: 'NowPlayingScreen',
    queue: 'QueueScreen',
    settings: 'SettingsScreen',
    album: 'AlbumScreen',
    artist: 'ArtistScreen'
};

// Top-nav order (js/app.js NAV_ITEMS).
var NAV = ['home', 'library', 'playlists', 'queue', 'nowplaying', 'search', 'settings'];

function _mockQuery(opts) {
    var q = [];
    if (opts.albums != null) q.push('mockAlbums=' + opts.albums);
    if (opts.artists != null) q.push('mockArtists=' + opts.artists);
    if (opts.songs != null) q.push('mockSongs=' + opts.songs);
    if (opts.libraries != null) q.push('mockLibraries=' + opts.libraries);
    if (opts.extra) q.push(opts.extra);
    return q.join('&');
}

// Seeds per-viewer settings before any app script runs.
//
// WHY auto Now Playing defaults to OFF here: Player.setQueue() goes through
// playAlbum(), which emits `userplay`, and with the app default (On) the shell
// navigates to Now Playing. A spec that starts a track to make the NP bar
// visible would otherwise silently change screen. Pass `autoNp: true` to test
// the real default.
//
// `scale` seeds `sonance-ui-scale` (ticket-3.10 §6.1, R4 since S2), which
// the <head> script applies before first paint. SONANCE_SCALE in the
// environment sets it for the whole run, which is how the suite runs at 100%
// and 150%. `scale: false` seeds nothing even when SONANCE_SCALE is set: for
// tests of the stored value itself (persistence, the 150% default). The seed
// runs on every navigation, so with a seed a reload cannot show persistence.
//
// v3.10 R11: the launch splash is in both HTML files and swallows keys for
// about 1.4 s. By default the seed finishes each of its CSS animations the
// moment it starts (Web Animations `finish()`), so the hold ends at once and
// the splash leaves as soon as the first screen is in the DOM - the app's
// own exit logic, removal and key listener still run, only the animations
// are compressed. `splash: 'real'` leaves them alone (e2e/splash.spec.ts).
function _seedInit(page, opts) {
    var scale = opts.scale === false ? null
        : opts.scale != null ? opts.scale
        : (process.env.SONANCE_SCALE ? parseFloat(process.env.SONANCE_SCALE) : null);
    // v3.10 R1.8: SONANCE_SMOOTH=1 runs with Settings → Advanced → Smooth
    // scrolling on ("all focus-integrity tests also pass with it on").
    var storage = opts.storage || null;
    if (process.env.SONANCE_SMOOTH) {
        storage = Object.assign({ 'sonance-exp-smooth-scroll': 'on' }, storage || {});
    }
    var seed = {
        autoNp: !!opts.autoNp,
        scale: scale,
        storage: storage,
        realSplash: opts.splash === 'real'
    };
    return page.addInitScript(function(s) {
        if (!s.realSplash) {
            document.addEventListener('animationstart', function(e) {
                var t = e.target;
                if (!t || !t.closest || !t.closest('#splash') || !t.getAnimations) return;
                t.getAnimations().forEach(function(a) { a.finish(); });
            }, true);
        }
        try {
            localStorage.setItem('sonance-auto-now-playing', s.autoNp ? 'true' : 'false');
            if (s.scale != null) localStorage.setItem('sonance-ui-scale', String(s.scale));
            if (s.storage) {
                Object.keys(s.storage).forEach(function(k) {
                    if (s.storage[k] === null) localStorage.removeItem(k);
                    else localStorage.setItem(k, s.storage[k]);
                });
            }
        } catch (e) { /* storage blocked: tests that need it will fail loudly */ }
    }, seed);
}

/**
 * Boot the unbundled app on the mock rig (tests/mock-index.html).
 * opts: { albums, artists, songs, libraries, scale, autoNp, storage, extra,
 *         waitFor: 'home' | false, splash: 'real' (see _seedInit),
 *         waitUntil: a page.goto waitUntil (default 'load') }
 * Resolves once Home has rendered its first content zone, unless
 * `waitFor: false`.
 */
async function bootMock(page, opts) {
    opts = opts || {};
    await _seedInit(page, opts);
    var q = _mockQuery(opts);
    await page.goto('/tests/mock-index.html' + (q ? '?' + q : ''), opts.waitUntil ? { waitUntil: opts.waitUntil } : undefined);
    if (opts.waitFor !== false) await waitForScreen(page, 'home');
}

/**
 * Boot the bundled build (/index.html, the same markup the .wgt ships) with
 * tests/mock-boot.js injected ahead of it through addInitScript.
 */
async function bootBundled(page, opts) {
    opts = opts || {};
    await _seedInit(page, opts);
    await page.addInitScript({ path: MOCK_BOOT });
    var q = _mockQuery(opts);
    await page.goto('/index.html' + (q ? '?' + q : ''), opts.waitUntil ? { waitUntil: opts.waitUntil } : undefined);
    if (opts.waitFor !== false) await waitForScreen(page, 'home');
}

/**
 * Wait until App reports `screen` and its first focus zone exists, and the
 * launch splash (R11) has gone (it swallows keys while it is up), and on
 * Home the extra rows (A4) have answered, then let two frames pass so
 * FocusManager's rAF-deferred onFocus has run.
 */
async function waitForScreen(page, screen, timeout) {
    await page.waitForFunction(function(name) {
        if (document.getElementById('splash')) return false;
        if (typeof App === 'undefined' || App.getCurrentScreen() !== name) return false;
        // v3.10 A4: Home's extra rows load after its first paint; wait for
        // them, so a walk sees the whole chain (builds before S7 have none).
        if (name === 'home' && typeof HomeScreen !== 'undefined' && HomeScreen.extraRowsPending &&
            HomeScreen.extraRowsPending() > 0) return false;
        var page = document.getElementById('page-current');
        return !!(page && page.firstChild);
    }, screen, { timeout: timeout || 10000 });
    await settle(page);
}

/** v3.10 R11: resolves once the launch splash has been removed. */
async function splashGone(page, timeout) {
    await page.waitForFunction(function() { return !document.getElementById('splash'); },
        null, { timeout: timeout || 10000 });
}

/** Two rAFs plus a short timeout: lets deferred focus work and async zones land. */
async function settle(page, ms) {
    await page.evaluate(function(wait) {
        return new Promise(function(resolve) {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() { setTimeout(resolve, wait); });
            });
        });
    }, ms == null ? 60 : ms);
}

/**
 * v3.10 R1.8: wait until no element has scrolled for three frames (at most
 * maxMs). With smooth scrolling on, the focus-follow scroll is an animation,
 * so an in-view check must wait for it; with it off this is three frames.
 */
async function scrollIdle(page, maxMs) {
    await page.evaluate(function(max) {
        return new Promise(function(resolve) {
            var t0 = performance.now(), quiet = 0;
            function onScroll() { quiet = 0; }
            document.addEventListener('scroll', onScroll, true);
            function tick() {
                quiet++;
                if (quiet >= 3 || performance.now() - t0 > max) {
                    document.removeEventListener('scroll', onScroll, true);
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        });
    }, maxMs || 1000);
}

/** Press `key` n times, gapMs apart (keyboard only). */
async function press(page, key, n, gapMs) {
    n = n == null ? 1 : n;
    for (var i = 0; i < n; i++) {
        await page.keyboard.press(key);
        if (gapMs) await page.waitForTimeout(gapMs);
    }
}

/**
 * Snapshot of FocusManager state: { zone, index, id, cls, visible }.
 * `visible` = connected, not display:none on it or any ancestor, computed
 * visibility not hidden, and the product of its and its ancestors' opacity
 * is > 0.
 */
async function focus(page) {
    return page.evaluate(function() {
        var snap = FocusManager.snapshot();
        var el = FocusManager.getCurrentFocused();
        var visible = false;
        if (el && el.isConnected) {
            visible = getComputedStyle(el).visibility !== 'hidden';
            var opacity = 1;
            for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
                var cs = getComputedStyle(n);
                if (cs.display === 'none') { visible = false; break; }
                opacity *= parseFloat(cs.opacity);
            }
            if (opacity <= 0) visible = false;
        }
        return {
            zone: snap ? snap.zone : null,
            index: snap ? snap.index : -1,
            id: el ? (el.id || null) : null,
            cls: el ? String(el.className) : null,
            visible: visible
        };
    });
}

/**
 * Press Down until the focus snapshot (zone + index) stops changing, or
 * maxSteps presses. Keyed on zone + index, not on class names.
 * Returns { zones, steps }: `zones` collapses consecutive repeats, `steps` is
 * every snapshot including the starting one.
 */
async function downWalk(page, maxSteps, gapMs) {
    maxSteps = maxSteps || 60;
    var steps = [await focus(page)];
    for (var i = 0; i < maxSteps; i++) {
        await page.keyboard.press('ArrowDown');
        await settle(page, gapMs == null ? 40 : gapMs);
        var f = await focus(page);
        var prev = steps[steps.length - 1];
        if (f.zone === prev.zone && f.index === prev.index) break;
        steps.push(f);
    }
    var zones = [];
    steps.forEach(function(s) {
        if (zones[zones.length - 1] !== s.zone) zones.push(s.zone);
    });
    return { zones: zones, steps: steps };
}

/**
 * Wrap the nine XScreen.render functions. App looks the screen up by
 * property at call time (`screen.render(_pageCurrent)`), so a wrapper
 * installed after boot sees every later render.
 * Returns { read(): {screen: count}, reset() }.
 */
async function countRenders(page) {
    await page.evaluate(function(screens) {
        if (window.__renders) return;
        window.__renders = {};
        Object.keys(screens).forEach(function(name) {
            var obj = window[screens[name]];
            var orig = obj.render;
            window.__renders[name] = 0;
            obj.render = function() {
                window.__renders[name]++;
                return orig.apply(this, arguments);
            };
        });
    }, SCREENS);
    return {
        read: function() { return page.evaluate(function() { return Object.assign({}, window.__renders); }); },
        total: function() {
            return page.evaluate(function() {
                var t = 0;
                Object.keys(window.__renders).forEach(function(k) { t += window.__renders[k]; });
                return t;
            });
        },
        reset: function() {
            return page.evaluate(function() {
                Object.keys(window.__renders).forEach(function(k) { window.__renders[k] = 0; });
            });
        }
    };
}

/**
 * Start the first n mock songs through the real Player, then wait until the
 * NP bar has a track. `paused: true` pauses it straight away (deterministic
 * screenshots, no progress ticks).
 */
async function startTrack(page, n, opts) {
    opts = opts || {};
    await page.evaluate(function(count) {
        Player.setQueue(window.__MOCK__.songs.slice(0, count || 1), 0);
    }, n || 1);
    await page.waitForFunction(function() {
        var s = Player.getState();
        return !!(s && s.currentTrack);
    });
    if (opts.paused) {
        await page.evaluate(function() { Player.pause(); });
    }
    await settle(page);
}

/**
 * Keyboard-navigate along the top nav to a primary screen and wait for it.
 * Assumes focus is on the top nav. Uses Enter-free sliding (Left/Right
 * auto-navigates) one press at a time, waiting out each transition so the
 * v3.9 300 ms input lock never swallows a press.
 */
async function navTo(page, screen) {
    var target = NAV.indexOf(screen);
    if (target < 0) throw new Error('not a top-nav screen: ' + screen);
    var cur = await page.evaluate(function() { return App.getCurrentScreen(); });
    var from = NAV.indexOf(cur);
    if (from < 0) throw new Error('navTo must start from a top-nav screen, on ' + cur);
    var f = await focus(page);
    if (f.zone !== 'topnav') {
        await page.evaluate(function(idx) { FocusManager.setActiveZone('topnav', idx, true); }, from);
    }
    var key = target > from ? 'ArrowRight' : 'ArrowLeft';
    for (var i = 0; i < Math.abs(target - from); i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(340);
    }
    await waitForScreen(page, screen);
}

// v3.10 S7: screenshots decoded by Chromium itself (canvas getImageData), the
// v3.9 method tests/tools/png-diff.js uses, so a spec can compare pixels.
function _pngInPage(page, fn, args) {
    return page.evaluate(async function(a) {
        async function decode(b64) {
            var blob = await (await fetch('data:image/png;base64,' + b64)).blob();
            var bmp = await createImageBitmap(blob);
            var c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            var ctx = c.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
        }
        var imgs = [];
        for (var i = 0; i < a.pngs.length; i++) imgs.push(await decode(a.pngs[i]));
        return (new Function('imgs', 'arg', a.body))(imgs, a.arg);
    }, { pngs: args.pngs, arg: args.arg, body: fn });
}

/** Pixels that differ between two PNG buffers: { n, max } (max channel delta). */
function pngDiff(page, a, b) {
    return _pngInPage(page,
        'var A = imgs[0], B = imgs[1]; if (A.w !== B.w || A.h !== B.h) return { n: -1, max: -1 };' +
        'var n = 0, max = 0; for (var i = 0; i < A.d.length; i += 4) { var m = 0;' +
        'for (var k = 0; k < 3; k++) m = Math.max(m, Math.abs(A.d[i + k] - B.d[i + k]));' +
        'if (m) { n++; if (m > max) max = m; } } return { n: n, max: max };',
        { pngs: [a.toString('base64'), b.toString('base64')] });
}

/** [r, g, b] of a PNG buffer at each [x, y] in `points`. */
function pngPixels(page, png, points) {
    return _pngInPage(page,
        'var A = imgs[0]; return arg.map(function(p) { var i = (p[1] * A.w + p[0]) * 4;' +
        'return [A.d[i], A.d[i + 1], A.d[i + 2]]; });',
        { pngs: [png.toString('base64')], arg: points });
}

/** Collect page errors and non-2xx responses (minus the Tizen-only webapis 404). */
function watchErrors(page) {
    var out = { pageErrors: [], badResponses: [] };
    page.on('pageerror', function(e) { out.pageErrors.push(e.message); });
    page.on('response', function(r) {
        var s = r.status();
        if (s >= 200 && s < 300) return;
        if (s === 404 && /\$WEBAPIS\/webapis\/webapis\.js/.test(decodeURIComponent(r.url()))) return;
        out.badResponses.push(s + ' ' + r.url().replace(/([?&](u|t|s|p)=)[^&]*/g, '$1REDACTED'));
    });
    return out;
}

module.exports = {
    SCREENS: SCREENS,
    NAV: NAV,
    bootMock: bootMock,
    bootBundled: bootBundled,
    waitForScreen: waitForScreen,
    splashGone: splashGone,
    settle: settle,
    scrollIdle: scrollIdle,
    press: press,
    focus: focus,
    downWalk: downWalk,
    countRenders: countRenders,
    startTrack: startTrack,
    navTo: navTo,
    watchErrors: watchErrors,
    pngDiff: pngDiff,
    pngPixels: pngPixels
};

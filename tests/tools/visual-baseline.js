#!/usr/bin/env node
'use strict';

// Sonance v3.10 visual baseline capture (prompt-3.10 S1 T3).
//
// Screenshots every screen state into <outDir>/NN-name.png on the mock rig,
// keyboard-driven, from a fresh browser context per state. Session 2 re-runs
// this at interface size 100% and diffs the result against
// screenshots/v3-10/baseline/ (R4's pixel-identity gate), so the state set and
// the method must stay fixed. Method: docs/perf-baseline.md "v3.10 visual
// baseline".
//
// Usage (dev server on 8091):
//   NODE_PATH="$PWD/node_modules" node tests/tools/visual-baseline.js <outDir> [--scale 1] [--only name,name] [--hide selector] [--geometry]
//
// --hide <selector> removes every match right after each screen's render(),
// before its activate() registers focus zones, so the app under test is the
// app without that element: same layout, same focus stops, same d-pad walk.
// S2 used `--hide '#settings-ui-scale-row'` to diff the Settings states
// against the S1 baseline, which predates the Interface size row (R4 identity
// gate). `display: none` is not enough: the row would stay in the
// settings-actions zone, the walk would stop on it once more, and that extra
// stop changes which elements keep FocusManager's will-change hint (cap 5),
// which changes how the selected swatch's ring is rasterised.

var fs = require('fs');
var path = require('path');
var { chromium } = require('playwright');
var H = require('../../e2e/helpers/sonance.js');
var G = require('../../e2e/helpers/geometry.js');

var BASE = process.env.SONANCE_BASE_URL || 'http://localhost:8091';
var FIXTURES = { albums: 120, artists: 80, songs: 400 };

function arg(name, dflt) {
    var i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : dflt;
}

var outDir = process.argv[2];
if (!outDir || outDir.indexOf('--') === 0) {
    console.error('usage: visual-baseline.js <outDir> [--scale N] [--only a,b]');
    process.exit(2);
}
var scale = arg('--scale', null);
var only = arg('--only', null);
var hide = arg('--hide', null);
// --geometry: after each capture, run the R4 checks (e2e/helpers/geometry.js)
// and write <outDir>/geometry.json; each state's problems are printed.
var geometry = process.argv.indexOf('--geometry') > -1;

async function applyHide(page) {
    if (!hide) return;
    var screens = Object.keys(H.SCREENS).map(function(k) { return H.SCREENS[k]; });
    // DOMContentLoaded: the screen objects exist (scripts are at the end of
    // body) and App.init has not run yet (it waits for this same event and
    // registered its listener after this one).
    await page.addInitScript(function(a) {
        document.addEventListener('DOMContentLoaded', function() {
            a.screens.forEach(function(name) {
                var obj = window[name];
                if (!obj || typeof obj.render !== 'function') return;
                var orig = obj.render;
                obj.render = function() {
                    var r = orig.apply(this, arguments);
                    var nodes = document.querySelectorAll(a.sel);
                    for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
                    return r;
                };
            });
        });
    }, { sel: hide, screens: screens });
}

async function bootWithTrack(page, extra) {
    await H.bootMock(page, Object.assign({}, FIXTURES, { scale: scale, extra: extra }));
    await page.evaluate(function() {
        Player.setQueue(window.__MOCK__.songs.slice(0, 20), 0);
    });
    await page.waitForFunction(function() { return !!Player.getState().currentTrack; });
    await page.evaluate(function() { Player.pause(); Player.seekTo(0); });
    await H.settle(page, 250);
}

async function enterLibraryTab(page, downs) {
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 250);
    if (!downs) return;
    await H.press(page, 'ArrowLeft');
    await H.settle(page, 100);
    for (var i = 0; i < downs; i++) {
        await H.press(page, 'ArrowDown');
        await page.waitForTimeout(400);
    }
}

async function waitLock(page) { await page.waitForTimeout(350); }

// name → function(page) that leaves the app in the state to capture.
var STATES = [
    ['home', async function(p) {
        await bootWithTrack(p);
        await H.press(p, 'ArrowDown');
    }],
    ['library-albums', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 0);
    }],
    ['library-artists', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 1);
    }],
    ['library-songs', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 2);
    }],
    ['library-genres', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 3);
    }],
    ['genre-detail', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 3);
        await H.press(p, 'ArrowRight');
        await H.settle(p, 150);
        await H.press(p, 'Enter');
        await waitLock(p);
    }],
    ['album-detail', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 0);
        await H.press(p, 'Enter');
        await H.waitForScreen(p, 'album');
    }],
    ['artist-detail', async function(p) {
        await bootWithTrack(p);
        await enterLibraryTab(p, 1);
        await H.press(p, 'ArrowRight');
        await H.settle(p, 150);
        await H.press(p, 'Enter');
        await H.waitForScreen(p, 'artist');
    }],
    ['playlists-grid', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'playlists');
        await H.press(p, 'ArrowDown');
    }],
    ['playlist-detail', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'playlists');
        await H.press(p, 'ArrowDown');
        await H.settle(p, 150);
        await H.press(p, 'Enter');
        await waitLock(p);
    }],
    ['queue', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'queue');
        await H.press(p, 'ArrowDown');
    }],
    ['search-empty', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'search');
        await H.press(p, 'ArrowDown');
    }],
    ['search-query', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'search');
        await H.press(p, 'ArrowDown');       // keyboard, on A (index 0)
        await H.settle(p, 100);
        // Gaps between presses: typing re-renders the results, and a press
        // sent with no gap after Enter was lost (first capture typed "T"
        // only). The baseline is about pixels, not key timing.
        await H.press(p, 'ArrowDown', 2, 80); // S (index 18)
        await H.press(p, 'ArrowRight', 1, 80); // T (19)
        await H.press(p, 'Enter');
        await p.waitForTimeout(700);
        // R is index 17, the last key of row 1; S (18) starts row 2, so
        // Left from T stops at S. Up to K (10), then Right x7.
        await H.press(p, 'ArrowUp', 1, 80);   // K (10)
        await H.press(p, 'ArrowRight', 7, 80); // R (17)
        await H.press(p, 'Enter');
        await p.waitForTimeout(900);         // search debounce + mock response
    }],
    ['settings-top', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'settings');
        await H.press(p, 'ArrowDown');
    }],
    ['settings-bottom', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'settings');
        await H.press(p, 'ArrowDown');       // swatches
        await H.settle(p, 100);
        // Down through settings-actions until Logout has focus. Counted, not
        // fixed: S1 added the Advanced row and S2/S6 add more.
        for (var i = 0; i < 12; i++) {
            var f = await H.focus(p);
            if (f.id === 'settings-logout-btn') break;
            await H.press(p, 'ArrowDown');
            await H.settle(p, 40);
        }
        await H.settle(p, 150);
        await p.evaluate(function() {
            var c = document.getElementById('settings-left');
            if (c) c.scrollTop = c.scrollHeight;
        });
    }],
    ['nowplaying', async function(p) {
        await bootWithTrack(p);
        await H.navTo(p, 'nowplaying');
        await H.press(p, 'ArrowDown');
    }],
    ['nowplaying-lyrics', async function(p) {
        await bootWithTrack(p, 'mockLyrics=1');
        await H.navTo(p, 'nowplaying');
        await H.press(p, 'ArrowDown');       // np-controls, Play (R3)
        await H.settle(p, 150);
        await H.press(p, 'ArrowRight', 4);   // lyrics button (Play + 4; ⓘ follows it since S6)
        await H.press(p, 'Enter');
        await p.waitForTimeout(700);         // lyrics slide
    }],
    ['exit-dialog', async function(p) {
        await bootWithTrack(p);
        await H.press(p, 'Escape');          // focus on top nav at Home → exit dialog
    }],
    ['login', async function(p) {
        await H.bootMock(p, Object.assign({}, FIXTURES, { scale: scale, extra: 'mockNoSession=1', waitFor: false }));
        await p.waitForSelector('.login-screen');
        // v3.10 R11: the splash has gone and the page under it has re-rastered
        // (captured at once, 85 px of rounded-corner anti-aliasing differed).
        await H.splashGone(p);
        await p.waitForTimeout(500);
    }]
];

async function waitForImages(page) {
    await page.waitForFunction(function() {
        return Array.prototype.every.call(document.images, function(i) { return i.complete; });
    }, null, { timeout: 10000 });
}

(async function() {
    fs.mkdirSync(outDir, { recursive: true });
    var browser = await chromium.launch();
    var wanted = only ? only.split(',') : null;
    var report = [];
    var geo = [];
    for (var n = 0; n < STATES.length; n++) {
        var name = STATES[n][0];
        if (wanted && wanted.indexOf(name) < 0) continue;
        var ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        var page = await ctx.newPage();
        await applyHide(page);
        if (geometry) await G.installProbes(page);
        var errs = H.watchErrors(page);
        await STATES[n][1](page);
        // 1 s, not 400 ms: after a zoom transition Chromium re-rasters the
        // NP-bar cover art once more, and a capture inside that window
        // differed by up to 36 px (max channel delta 4) between runs.
        await H.settle(page, 1000);
        await waitForImages(page);
        await H.settle(page, 200);
        var file = path.join(outDir, String(n + 1).padStart(2, '0') + '-' + name + '.png');
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        var f = await page.evaluate(function() {
            var s = typeof FocusManager !== 'undefined' && FocusManager.snapshot();
            return {
                screen: typeof App !== 'undefined' ? App.getCurrentScreen() : null,
                zone: s ? s.zone : null, index: s ? s.index : null,
                playing: typeof Player !== 'undefined' && Player.getState().isPlaying
            };
        });
        report.push(path.basename(file) + '  screen=' + f.screen + ' focus=' + f.zone + '[' + f.index + '] playing=' +
            f.playing + ' pageErrors=' + errs.pageErrors.length + ' bad=' + errs.badResponses.length);
        if (geometry) {
            var g = await G.measure(page);
            g.state = name;
            geo.push(g);
            report.push('    geometry: ' + (g.problems.length ? g.problems.length + ' problem(s)\n      ' + g.problems.join('\n      ') : 'ok'));
        }
        await ctx.close();
    }
    await browser.close();
    if (geometry) fs.writeFileSync(path.join(outDir, 'geometry.json'), JSON.stringify(geo, null, 1));
    console.log(report.join('\n'));
})().catch(function(e) { console.error(e); process.exit(1); });

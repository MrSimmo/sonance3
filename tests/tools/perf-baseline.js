#!/usr/bin/env node
'use strict';

// Sonance v3.10 performance baseline (prompt-3.10 S1 T4).
//
// Measures, at CPU 6x (CDP Emulation.setCPUThrottlingRate) on the mock rig,
// the indicators later sessions must move: grid recycling, top-nav flick
// renders, Library sub-nav tab builds, the Enter/Back drop, keypress → first
// frame latency, per-screen synchronous render + activate cost, and long-list
// cost at 500/5,000/14,000 rows. Results print as tables; the method for each
// is in docs/perf-baseline.md "v3.10 baseline (S1)".
//
// Usage (dev server on 8091):
//   NODE_PATH="$PWD/node_modules" node tests/tools/perf-baseline.js [--only a,b] [--runs 3] [--rate 6]
//       [--serve-from <dir>] [--dwell-ms 180]
// --serve-from (v3.10 S3): answer /js/** and /css/** from <dir>/js and
// <dir>/css instead of the working tree, through page.route - the v3.9 D29
// "before" method, for copies of the pre-change files saved elsewhere.
// v3.10 S4: every XScreen.render is also timed from its start to the second
// rAF after it (window.__nav), the navigation's own first frame. Since the
// top-nav dwell (R1.3, D51) a Right press renders 180 ms later, so
// keydown -> frame no longer contains the navigation.
// Sections: grid, flick, subnav, drop, firstframe, render, lists

var { chromium } = require('playwright');
var H = require('../../e2e/helpers/sonance.js');

var BASE = process.env.SONANCE_BASE_URL || 'http://localhost:8091';
function arg(name, dflt) {
    var i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : dflt;
}
var ONLY = arg('--only', null);
var RUNS = parseInt(arg('--runs', '3'), 10);
var RATE = parseFloat(arg('--rate', '6'));
var SERVE_FROM = arg('--serve-from', null);
// --dwell-ms (v3.10 S4): added to the render section's 700 ms window for
// top-nav Left/Right navigations, so that with the R1.3 dwell the window
// still covers 700 ms from the render, as it did when a press rendered at
// once. Pass the app's NAV_DWELL_MS (180) for builds that have the dwell.
var DWELL_MS = parseFloat(arg('--dwell-ms', '0'));

function median(a) {
    var s = a.slice().sort(function(x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function r1(n) { return Math.round(n * 10) / 10; }

// In-page instrumentation, installed before any app script runs:
// - window.__lt: every long task (PerformanceObserver 'longtask');
// - window.__kf: keydown (capture phase) → second rAF latency per key.
function instrument() {
    window.__lt = [];
    try {
        new PerformanceObserver(function(list) {
            list.getEntries().forEach(function(e) { window.__lt.push({ t: e.startTime, d: e.duration }); });
        }).observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__lt = null; }
    window.__kf = [];
    document.addEventListener('keydown', function(ev) {
        var t0 = performance.now();
        var rec = { key: ev.key, t0: t0, frame: null };
        window.__kf.push(rec);
        requestAnimationFrame(function() {
            requestAnimationFrame(function() { rec.frame = performance.now() - t0; });
        });
    }, true);
}

async function newPage(browser, opts) {
    var ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    var page = await ctx.newPage();
    if (SERVE_FROM) {
        var fs = require('fs'), path = require('path');
        await ctx.route(/\/(js|css)\/[^?]+\.(js|css)(\?.*)?$/, function(route) {
            var rel = new URL(route.request().url()).pathname.replace(/^\//, '');
            var file = path.join(SERVE_FROM, rel);
            if (!fs.existsSync(file)) return route.continue();
            return route.fulfill({ body: fs.readFileSync(file),
                contentType: /\.css$/.test(file) ? 'text/css' : 'application/javascript' });
        });
    }
    await page.addInitScript(instrument);
    var cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
    await H.bootMock(page, opts || {});
    await page.evaluate(function(screens) {
        window.__nav = [];
        Object.keys(screens).forEach(function(name) {
            var obj = window[screens[name]];
            var orig = obj.render;
            obj.render = function() {
                var rec = { s: name, t0: performance.now(), frame: null };
                window.__nav.push(rec);
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() { rec.frame = performance.now() - rec.t0; });
                });
                return orig.apply(this, arguments);
            };
        });
    }, H.SCREENS);
    return { ctx: ctx, page: page, cdp: cdp };
}

// ---------------------------------------------------------------------------

async function grid(browser) {
    var s = await newPage(browser, { albums: 1200, artists: 80, songs: 400 });
    var page = s.page;
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 400);
    var geom = await page.evaluate(function() {
        var card = document.querySelector('.album-grid-card');
        return {
            cols: getComputedStyle(card.parentElement).gridTemplateColumns.split(' ').length,
            perCard: 1 + card.querySelectorAll('*').length
        };
    });
    await page.evaluate(function() {
        window.__created = { els: 0, imgs: 0 };
        new MutationObserver(function(recs) {
            recs.forEach(function(r) {
                r.addedNodes.forEach(function(n) {
                    if (n.nodeType !== 1) return;
                    window.__created.els += 1 + n.querySelectorAll('*').length;
                    window.__created.imgs += (n.tagName === 'IMG' ? 1 : 0) + n.querySelectorAll('img').length;
                });
            });
        }).observe(document.getElementById('app'), { childList: true, subtree: true });
    });
    var steps = [];
    for (var i = 0; i < 16; i++) {
        var before = await page.evaluate(function() {
            window.__before = Array.prototype.slice.call(document.querySelectorAll('.album-grid-card'));
            window.__created = { els: 0, imgs: 0 };
            return window.__before.length;
        });
        await H.press(page, 'ArrowDown');
        await H.settle(page, 200);
        var r = await page.evaluate(function() {
            return {
                kept: window.__before.filter(function(x) { return x.isConnected; }).length,
                mounted: document.querySelectorAll('.album-grid-card').length,
                created: window.__created.els, imgs: window.__created.imgs,
                index: FocusManager.snapshot().index
            };
        });
        r.before = before;
        steps.push(r);
    }
    await s.ctx.close();
    var moved = steps.filter(function(x) { return x.created > 0; });
    console.log('\n## grid recycle — mockAlbums=1200, one-row Down steps, CPU ' + RATE + 'x');
    console.log('cols ' + geom.cols + ', elements per card ' + geom.perCard);
    console.log('step  before  kept  mounted  created  imgs  focus');
    steps.forEach(function(x, n) {
        console.log(String(n + 1).padStart(4) + String(x.before).padStart(8) + String(x.kept).padStart(6) +
            String(x.mounted).padStart(9) + String(x.created).padStart(9) + String(x.imgs).padStart(6) + String(x.index).padStart(7));
    });
    console.log('steps that moved the band: ' + moved.length + '/' + steps.length +
        '; on those: kept ' + Math.min.apply(null, moved.map(function(x) { return x.kept; })) + '–' +
        Math.max.apply(null, moved.map(function(x) { return x.kept; })) + ' of ' +
        Math.min.apply(null, moved.map(function(x) { return x.before; })) + '–' + Math.max.apply(null, moved.map(function(x) { return x.before; })) +
        ', created ' + Math.min.apply(null, moved.map(function(x) { return x.created; })) + '–' +
        Math.max.apply(null, moved.map(function(x) { return x.created; })) + ' elements, ' +
        Math.min.apply(null, moved.map(function(x) { return x.imgs; })) + '–' + Math.max.apply(null, moved.map(function(x) { return x.imgs; })) + ' img');
}

async function flick(browser) {
    var rows = [];
    for (var run = 0; run < RUNS; run++) {
        var s = await newPage(browser);
        var rc = await H.countRenders(s.page);
        await H.press(s.page, 'ArrowRight', 4, 90);
        await s.page.waitForTimeout(1200);
        var r = await rc.read();
        var screen = await s.page.evaluate(function() { return App.getCurrentScreen(); });
        var list = Object.keys(r).filter(function(k) { return r[k]; }).map(function(k) { return k + ' ' + r[k]; });
        rows.push(list.join(', ') + ' → ends on ' + screen);
        await s.ctx.close();
    }
    console.log('\n## top-nav flick — Home, 4x Right @90 ms, CPU ' + RATE + 'x');
    rows.forEach(function(x, i) { console.log('run ' + (i + 1) + ': ' + x); });
}

async function subnav(browser) {
    var rows = [];
    for (var run = 0; run < RUNS; run++) {
        var s = await newPage(browser);
        var page = s.page;
        await H.navTo(page, 'library');
        await H.press(page, 'ArrowDown');
        await H.settle(page, 400);
        await H.press(page, 'ArrowLeft');
        await H.settle(page, 300);
        await page.evaluate(function() {
            window.__builds = [];
            new MutationObserver(function(recs) {
                recs.forEach(function(r) {
                    r.addedNodes.forEach(function(n) {
                        if (n.nodeType === 1 && n.classList.contains('library-loading')) {
                            window.__builds.push(LibraryScreen.getActiveTab());
                        }
                    });
                });
            }).observe(document.getElementById('app'), { childList: true, subtree: true });
        });
        await H.press(page, 'ArrowDown', 3, 90);
        await page.waitForTimeout(1500);
        var b = await page.evaluate(function() { return window.__builds; });
        rows.push(b.length + ' builds (' + b.join(', ') + ')');
        await s.ctx.close();
    }
    console.log('\n## Library sub-nav — Albums, Down x3 @90 ms, CPU ' + RATE + 'x');
    rows.forEach(function(x, i) { console.log('run ' + (i + 1) + ': ' + x); });
}

async function drop(browser) {
    var rows = [];
    for (var run = 0; run < RUNS; run++) {
        var s = await newPage(browser);
        var page = s.page;
        await H.navTo(page, 'library');
        await H.press(page, 'ArrowDown');
        await H.settle(page, 300);
        await H.press(page, 'ArrowRight');
        await H.settle(page, 200);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(120);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1200);
        var f = await H.focus(page);
        var screen = await page.evaluate(function() { return App.getCurrentScreen(); });
        rows.push('ends on ' + screen + ', focus ' + f.zone + '[' + f.index + ']');
        await s.ctx.close();
    }
    console.log('\n## transition drop — Library card #1, Enter then Escape @120 ms, CPU ' + RATE + 'x');
    rows.forEach(function(x, i) { console.log('run ' + (i + 1) + ': ' + x); });
}

// One keypress, measured in page: keydown (capture) → second rAF, plus the
// long tasks that started inside that window.
async function measureKey(page, key, waitMs) {
    var n = await page.evaluate(function() { return window.__kf.length; });
    var lt0 = await page.evaluate(function() { return window.__lt ? window.__lt.length : -1; });
    var nv0 = await page.evaluate(function() { return window.__nav.length; });
    await page.keyboard.press(key);
    await page.waitForTimeout(waitMs || 900);
    return page.evaluate(function(args) {
        var rec = window.__kf[args[0]];
        var lts = window.__lt ? window.__lt.slice(args[1]) : null;
        var nav = window.__nav[args[2]];
        return {
            frame: rec ? rec.frame : null,
            // S4: when the screen render began after the keydown, and the
            // render -> 2nd rAF time (null if the key rendered no screen).
            renderAt: (rec && nav) ? nav.t0 - rec.t0 : null,
            navFrame: nav ? nav.frame : null,
            longTasks: lts ? lts.length : 'n/a',
            longMs: lts ? lts.reduce(function(a, e) { return a + e.d; }, 0) : 0
        };
    }, [n, lt0, nv0]);
}

async function firstframe(browser) {
    var cases = {
        'top-nav Right (Home → Library)': [],
        'Enter album (Library grid → Album)': [],
        'Back (Album → Library)': [],
        'Down in Albums grid': [],
        'Open Now Playing (Enter on album track, auto-NP)': []
    };
    var keys = Object.keys(cases);
    for (var run = 0; run < RUNS; run++) {
        var s = await newPage(browser, { albums: 120, artists: 80, songs: 400, autoNp: true });
        var page = s.page;
        cases[keys[0]].push(await measureKey(page, 'ArrowRight'));
        await H.waitForScreen(page, 'library');
        await H.press(page, 'ArrowDown');
        await H.settle(page, 400);
        cases[keys[3]].push(await measureKey(page, 'ArrowDown'));
        await H.press(page, 'ArrowUp');
        await H.settle(page, 400);
        cases[keys[1]].push(await measureKey(page, 'Enter'));
        await H.waitForScreen(page, 'album');
        await page.waitForTimeout(400);
        cases[keys[2]].push(await measureKey(page, 'Escape'));
        await H.waitForScreen(page, 'library');
        await page.waitForTimeout(400);
        await H.press(page, 'Enter');
        await H.waitForScreen(page, 'album');
        await page.waitForTimeout(600);
        cases[keys[4]].push(await measureKey(page, 'Enter', 1200));
        await s.ctx.close();
    }
    console.log('\n## keypress → first frame (keydown capture → 2nd rAF), CPU ' + RATE + 'x, ' + RUNS + ' runs');
    console.log('case'.padEnd(52) + 'median ms   runs               long tasks');
    keys.forEach(function(k) {
        var f = cases[k].map(function(x) { return x.frame; });
        console.log(k.padEnd(52) + String(r1(median(f))).padStart(9) + '   ' + f.map(r1).join(' / ').padEnd(19) +
            cases[k].map(function(x) { return x.longTasks + (x.longTasks ? ' (' + Math.round(x.longMs) + ' ms)' : ''); }).join(' / '));
    });
    console.log('\n## the navigation itself (v3.10 S4): render start after keydown, render start → 2nd rAF (medians)');
    console.log('case'.padEnd(52) + 'render at ms   render → frame ms   runs (render → frame)');
    keys.forEach(function(k) {
        var at = cases[k].map(function(x) { return x.renderAt; }).filter(function(x) { return x != null; });
        var nf = cases[k].map(function(x) { return x.navFrame; }).filter(function(x) { return x != null; });
        if (!nf.length) { console.log(k.padEnd(52) + 'no screen render'); return; }
        console.log(k.padEnd(52) + String(r1(median(at))).padStart(12) + String(r1(median(nf))).padStart(20) + '   ' + nf.map(r1).join(' / '));
    });
}

// Wrap XScreen.render and .activate with performance.now(); the synchronous
// part only. Most screens build their content later, in data callbacks, so
// each navigation also records the CDP Performance.getMetrics ScriptDuration
// delta over a 700 ms window from the keydown: all main-thread script the
// navigation caused, including those async builds (and the transition's own
// timers). The screen keys the row; navigation order is fixed.
async function render(browser) {
    var all = {};
    // { script, task } in ms. ScriptDuration is JS only (forced layout
    // inside a script is LayoutDuration); TaskDuration is all main-thread
    // task time, including the transition's own style/layout/paint.
    async function scriptMs(cdp) {
        var m = await cdp.send('Performance.getMetrics');
        var out = { script: 0, task: 0 };
        for (var i = 0; i < m.metrics.length; i++) {
            if (m.metrics[i].name === 'ScriptDuration') out.script = m.metrics[i].value * 1000;
            if (m.metrics[i].name === 'TaskDuration') out.task = m.metrics[i].value * 1000;
        }
        return out;
    }
    for (var run = 0; run < RUNS; run++) {
        var s = await newPage(browser, { albums: 120, artists: 80, songs: 400 });
        var page = s.page;
        await s.cdp.send('Performance.enable');
        await H.startTrack(page, 20, { paused: true });
        await page.evaluate(function(screens) {
            window.__rt = [];
            Object.keys(screens).forEach(function(name) {
                var obj = window[screens[name]];
                ['render', 'activate'].forEach(function(fn) {
                    var orig = obj[fn];
                    obj[fn] = function() {
                        var t = performance.now();
                        try { return orig.apply(this, arguments); }
                        finally { window.__rt.push({ s: name, f: fn, ms: performance.now() - t }); }
                    };
                });
            });
        }, H.SCREENS);
        var nav = {};
        async function go(screen, key, waitScreen) {
            var a = await scriptMs(s.cdp);
            await page.keyboard.press(key);
            await page.waitForTimeout(700 + (key === 'ArrowRight' || key === 'ArrowLeft' ? DWELL_MS : 0));
            if (waitScreen) await H.waitForScreen(page, screen);
            var b = await scriptMs(s.cdp);
            if (nav[screen] === undefined) nav[screen] = { script: b.script - a.script, task: b.task - a.task };
        }
        for (var i = 1; i < H.NAV.length; i++) await go(H.NAV[i], 'ArrowRight', true);
        for (var j = H.NAV.length - 2; j >= 1; j--) {
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(400);
        }
        await H.waitForScreen(page, 'library');
        await H.press(page, 'ArrowDown');
        await H.settle(page, 300);
        await go('album', 'Enter', true);
        await go('library', 'Escape', true);
        await page.waitForTimeout(300);
        await page.evaluate(function() { FocusManager.setActiveZone('library-grid', 0, true); });
        await H.press(page, 'ArrowLeft');
        await H.settle(page, 100);
        await H.press(page, 'ArrowDown');
        await page.waitForFunction(function() { return LibraryScreen.getActiveTab() === 'artists'; });
        await page.waitForTimeout(600);
        await H.press(page, 'ArrowRight');
        await H.settle(page, 200);
        await go('artist', 'Enter', true);
        await H.press(page, 'Escape');
        await H.waitForScreen(page, 'library');
        await page.waitForTimeout(400);
        await page.evaluate(function() { FocusManager.setActiveZone('topnav', 1, true); });
        await go('home', 'ArrowLeft', true);
        var rt = await page.evaluate(function() { return window.__rt; });
        var navRecs = await page.evaluate(function() { return window.__nav; });
        var navFrame = {};
        navRecs.forEach(function(r) { if (navFrame[r.s] === undefined && r.frame != null) navFrame[r.s] = r.frame; });
        // First render + activate pair per screen in this run.
        var seen = {};
        for (var k = 0; k < rt.length; k++) {
            var e = rt[k];
            if (!seen[e.s]) seen[e.s] = { render: null, activate: null };
            if (seen[e.s][e.f] === null) seen[e.s][e.f] = e.ms;
        }
        Object.keys(seen).forEach(function(name) {
            if (!all[name]) all[name] = { render: [], activate: [], nav: [], frame: [] };
            all[name].render.push(seen[name].render || 0);
            all[name].activate.push(seen[name].activate || 0);
            all[name].nav.push(nav[name] === undefined ? { script: NaN, task: NaN } : nav[name]);
            all[name].frame.push(navFrame[name] === undefined ? NaN : navFrame[name]);
        });
        await s.ctx.close();
    }
    console.log('\n## per screen, first visit in a run, CPU ' + RATE + 'x, median of ' + RUNS);
    console.log('screen'.padEnd(12) + 'render ms  activate ms  sync total   runs (sync total)    nav script ms  nav task ms (700 ms window from keydown)   render → 2nd rAF ms (S4)');
    Object.keys(H.SCREENS).forEach(function(name) {
        var a = all[name];
        if (!a) { console.log(name.padEnd(12) + 'not visited'); return; }
        var tot = a.render.map(function(x, i) { return x + a.activate[i]; });
        console.log(name.padEnd(12) + String(r1(median(a.render))).padStart(9) + String(r1(median(a.activate))).padStart(13) +
            String(r1(median(tot))).padStart(12) + '   ' + tot.map(r1).join(' / ').padEnd(22) +
            String(r1(median(a.nav.map(function(x) { return x.script; })))).padStart(9) +
            String(r1(median(a.nav.map(function(x) { return x.task; })))).padStart(13) +
            '   (' + a.nav.map(function(x) { return Math.round(x.task); }).join(' / ') + ')' +
            String(r1(median(a.frame))).padStart(12) + '   (' + a.frame.map(r1).join(' / ') + ')');
    });
}

async function lists(browser) {
    var sizes = [500, 5000, 14000];
    var out = { playlist: {}, queue: {} };
    for (var si = 0; si < sizes.length; si++) {
        var N = sizes[si];
        ['playlist', 'queue'].forEach(function(kind) { out[kind][N] = { els: [], paint: [], fromRender: [], perKey: [], frameKey: [], ok: [] }; });
        for (var run = 0; run < RUNS; run++) {
            // --- Playlist detail
            var s = await newPage(browser, { albums: 120, artists: 80, songs: N });
            var page = s.page;
            await H.navTo(page, 'playlists');
            await H.press(page, 'ArrowDown');
            await H.settle(page, 300);
            var res = await openAndTime(page, 'Enter', '#playlist-songs .song-row', N);
            await page.waitForTimeout(500);
            var keys = await pressNearEnd(page, '#playlist-songs .song-row', N);
            pushRes(out.playlist[N], res, keys);
            await s.ctx.close();
            // --- Queue (N tracks queued; the queue list shows the N-1 after the current one)
            s = await newPage(browser, { albums: 120, artists: 80, songs: N });
            page = s.page;
            await page.evaluate(function() { Player.setQueue(window.__MOCK__.songs.slice(), 0); });
            await page.waitForFunction(function() { return !!Player.getState().currentTrack; });
            await page.evaluate(function() { Player.pause(); });
            await H.navTo(page, 'playlists');
            await page.waitForTimeout(400);
            res = await openAndTime(page, 'ArrowRight', '#queue-list .queue-row', N - 1);
            await page.waitForTimeout(500);
            keys = await pressNearEnd(page, '#queue-list .queue-row', N - 1);
            pushRes(out.queue[N], res, keys);
            await s.ctx.close();
        }
    }
    console.log('\n## long lists — CPU ' + RATE + 'x, median of ' + RUNS + ' (v3.9 S6 T2 method)');
    ['playlist', 'queue'].forEach(function(kind) {
        console.log((kind === 'playlist' ? 'Playlist detail (Enter → first paint)' : 'Queue (nav Right → first paint)'));
        console.log('rows'.padEnd(30) + sizes.map(function(n) { return String(n).padStart(12); }).join(''));
        var row = function(label, key, fmt) {
            console.log(label.padEnd(30) + sizes.map(function(n) { return (' ' + String(fmt(out[kind][n][key]))).padStart(12); }).join(''));
        };
        row('elements under #app', 'els', function(a) { return median(a); });
        row('key → first paint ms', 'paint', function(a) { return r1(median(a)); });
        row('  runs', 'paint', function(a) { return a.map(Math.round).join('/'); });
        row('render start → first paint ms', 'fromRender', function(a) { return r1(median(a)); });
        row('ms per keypress (wall, /20)', 'perKey', function(a) { return r1(median(a)); });
        row('keydown → 2nd rAF ms (median)', 'frameKey', function(a) { return r1(median(a)); });
        row('focus ok after 20 presses', 'ok', function(a) { return a.every(Boolean) ? 'yes' : 'NO'; });
    });
}

function pushRes(bucket, res, keys) {
    bucket.els.push(res.els);
    bucket.paint.push(res.paint);
    bucket.fromRender.push(res.fromRender);
    bucket.perKey.push(keys.perKey);
    bucket.frameKey.push(keys.frame);
    bucket.ok.push(keys.ok);
}

// t0 = the keydown that opens the view; first paint = second rAF after the
// expected number of rows is in the DOM. v3.10 S5 (R1.7): a virtual list
// (a .virtual-list-band in the DOM) never holds them all, so for it the
// first rows are enough; a list that renders every row is measured as
// before.
async function openAndTime(page, key, selector, expected) {
    await page.evaluate(function(args) {
        window.__open = { t0: 0, t1: 0 };
        document.addEventListener('keydown', function once() {
            document.removeEventListener('keydown', once, true);
            window.__open.t0 = performance.now();
            var mo = new MutationObserver(function() {
                var n = document.querySelectorAll(args[0]).length;
                if (n >= args[1] || (n > 0 && document.querySelector('.virtual-list-band'))) {
                    mo.disconnect();
                    requestAnimationFrame(function() {
                        requestAnimationFrame(function() { window.__open.t1 = performance.now(); });
                    });
                }
            });
            mo.observe(document.getElementById('app'), { childList: true, subtree: true });
        }, true);
    }, [selector, expected]);
    await page.keyboard.press(key);
    await page.waitForFunction(function() { return window.__open.t1 > 0; }, null, { timeout: 60000 });
    // v3.10 S5: also from the start of the screen render that followed the
    // key (the Queue opens by the top nav, so its paint includes the 180 ms
    // dwell, R1.3); the in-screen Playlist detail has no render, so its two
    // numbers are the same.
    return page.evaluate(function() {
        var o = window.__open, after = (window.__nav || []).filter(function(r) { return r.t0 >= o.t0; });
        var from = after.length ? after[after.length - 1].t0 : o.t0;
        return { paint: o.t1 - o.t0, fromRender: o.t1 - from, els: document.querySelectorAll('#app *').length };
    });
}

// Focus 30 rows from the end (position set directly), then 20 real ArrowDown
// presses: wall time / 20, plus the in-page keydown → 2nd rAF median.
// v3.10 S5: `total` is the list's length (a virtual list mounts a band, so
// the DOM row count is not it).
async function pressNearEnd(page, selector, total) {
    var zone = { total: total };
    var zoneName = await page.evaluate(function(sel) {
        var first = document.querySelector(sel);
        // Find the registered zone whose current element is a row: focus the
        // first row's zone by trying the known names.
        var names = ['content', 'playlist-songs', 'queue-list'];
        for (var i = 0; i < names.length; i++) {
            if (FocusManager.hasZone(names[i])) {
                FocusManager.setActiveZone(names[i], 0, true);
                var f = FocusManager.getCurrentFocused();
                if (f && f.matches && f.matches(sel)) return names[i];
            }
        }
        return null;
    }, selector);
    if (!zoneName) return { perKey: NaN, frame: NaN, ok: false };
    await page.evaluate(function(args) { FocusManager.setActiveZone(args[0], args[1] - 30, true); }, [zoneName, zone.total]);
    await H.settle(page, 300);
    var n0 = await page.evaluate(function() { return window.__kf.length; });
    var t = Date.now();
    for (var i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
    var wall = Date.now() - t;
    await page.waitForTimeout(800);
    return page.evaluate(function(args) {
        var recs = window.__kf.slice(args[0]).map(function(r) { return r.frame; }).filter(function(x) { return x != null; });
        recs.sort(function(a, b) { return a - b; });
        var f = FocusManager.getCurrentFocused();
        var snap = FocusManager.snapshot();
        return {
            perKey: args[1] / 20,
            frame: recs.length ? recs[Math.floor(recs.length / 2)] : NaN,
            ok: !!(f && f.isConnected && f.matches(args[2]) && snap.index === args[3] - 10)
        };
    }, [n0, wall, selector, zone.total]);
}

var SECTIONS = { grid: grid, flick: flick, subnav: subnav, drop: drop, firstframe: firstframe, render: render, lists: lists };

(async function() {
    var browser = await chromium.launch();
    var names = ONLY ? ONLY.split(',') : Object.keys(SECTIONS);
    console.log('Sonance perf baseline — CPU ' + RATE + 'x, runs ' + RUNS + ', ' + new Date().toISOString());
    for (var i = 0; i < names.length; i++) await SECTIONS[names[i]](browser);
    await browser.close();
})().catch(function(e) { console.error(e); process.exit(1); });

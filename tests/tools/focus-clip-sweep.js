#!/usr/bin/env node
// Sonance v3.10 S3 focus-clip sweep (D76).
//
// For 14 screen states on the mock rig (S7: + the options sheet and its
// credits view; v3.10-fix2: + both credits views scrolled to the end, Now
// Playing with Up Next hidden and with Focus mode on), focuses the first
// and the last item
// of every registered content zone, waits for the focus transform to settle,
// and reports what a clipping ancestor cuts off:
// - `box`:  e2e/helpers/geometry.js measure().focusClip, the focused element's
//           own transformed box;
// - `ring`: the same box unioned with any descendant's 0-offset box-shadow
//           ring (the v4 card ring), so a ring cut at a scroller's edge shows.
// S3 used it before and after the R6 focus work: 14 / 16 / 22 clipped states
// (of 92 per size) at 100 / 150 / 200 % before, 0 / 0 / 9 after (0 at 125 %
// and 2 at 175 % too); what is left is the D84 residue, panels taller than
// the page. Entries repeat when a zone's first and last item are the same. The library sub-nav is
// focused only on its current tab, because focusing a tab switches it.
//
// Usage (dev server on 8091):
//   NODE_PATH="$PWD/node_modules" node tests/tools/focus-clip-sweep.js <out.json> [scales, e.g. 1,1.5,2]
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const H = require(path.join(__dirname, '..', '..', 'e2e/helpers/sonance.js'));
const G = require(path.join(__dirname, '..', '..', 'e2e/helpers/geometry.js'));
const fs = require('fs');

const OUT = process.argv[2] || 'focusclip.json';
const SCALES = (process.argv[3] || '1,1.5,2').split(',').map(Number);
const BOOT = { albums: 60, artists: 120, songs: 60, libraries: 3 };

async function ringProbe(page) {
    return page.evaluate(function() {
        var el = FocusManager.getCurrentFocused();
        if (!el || !el.isConnected) return [];
        function rings(node) {
            var bs = getComputedStyle(node).boxShadow;
            if (!bs || bs === 'none') return 0;
            // split on commas not inside parentheses
            var parts = [], depth = 0, cur = '';
            for (var i = 0; i < bs.length; i++) {
                var c = bs[i];
                if (c === '(') depth++;
                if (c === ')') depth--;
                if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
            }
            parts.push(cur);
            var best = 0;
            parts.forEach(function(p) {
                var nums = p.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).map(parseFloat);
                // x y blur spread
                if (nums.length >= 4 && nums[0] === 0 && nums[1] === 0 && nums[2] === 0 && nums[3] > 0) best = Math.max(best, nums[3]);
            });
            return best;
        }
        var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
        var box = null;
        nodes.forEach(function(n) {
            var r = n.getBoundingClientRect();
            if (!r.width || !r.height) return;
            var spread = rings(n);
            if (n !== el && !spread) return;
            var k = n.offsetWidth ? r.width / n.offsetWidth : 1;
            var s = spread * k;
            var rr = { left: r.left - s, top: r.top - s, right: r.right + s, bottom: r.bottom + s };
            if (!box) box = rr;
            else box = { left: Math.min(box.left, rr.left), top: Math.min(box.top, rr.top), right: Math.max(box.right, rr.right), bottom: Math.max(box.bottom, rr.bottom) };
        });
        var out = [];
        if (!box) return out;
        for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            var cs = getComputedStyle(a);
            var ar = a.getBoundingClientRect();
            var sides = [];
            if (cs.overflowX !== 'visible') {
                if (ar.left - box.left > 0.5) sides.push('left ' + (ar.left - box.left).toFixed(1));
                if (box.right - ar.right > 0.5) sides.push('right ' + (box.right - ar.right).toFixed(1));
            }
            if (cs.overflowY !== 'visible') {
                if (ar.top - box.top > 0.5) sides.push('top ' + (ar.top - box.top).toFixed(1));
                if (box.bottom - ar.bottom > 0.5) sides.push('bottom ' + (box.bottom - ar.bottom).toFixed(1));
            }
            if (sides.length) out.push((a.id ? '#' + a.id : '.' + String(a.className).split(' ')[0]) + ': ' + sides.join(', '));
        }
        return out;
    });
}

async function sweepZones(page, state, results, opts) {
    opts = opts || {};
    const zones = await page.evaluate(() => FocusManager._debugZones());
    for (const z of zones) {
        if (z === 'topnav' || z === 'exit-dialog' || z === 'confirm-dialog') continue;
        if (opts.only && opts.only.indexOf(z) < 0) continue;
        const idxs = z === 'library-subnav' ? ['cur'] : [0, 'last'];
        for (const which of idxs) {
            const info = await page.evaluate(([zone, w]) => {
                if (!FocusManager.hasZone(zone)) return null;
                if (w === 'cur') {
                    var sel = document.querySelector('.library-subnav-item.selected');
                    var items = document.querySelectorAll('.library-subnav-item');
                    w = Array.prototype.indexOf.call(items, sel);
                }
                FocusManager.setActiveZone(zone, w === 'last' ? 999999 : w, true);
                var s = FocusManager.snapshot();
                var el = FocusManager.getCurrentFocused();
                return { zone: s && s.zone, index: s && s.index, el: el ? (el.id || String(el.className).replace(/ focusable| focused/g, '')) : null };
            }, [z, which]);
            if (!info || info.zone !== z) continue;
            await H.settle(page, 30);
            await G.settled(page).catch(() => {});
            const m = await G.measure(page);
            const ring = await ringProbe(page);
            results.push({ state, zone: z, index: info.index, el: info.el, focusClip: m.focusClip, ring });
        }
    }
}

async function run(scale) {
    const browser = await chromium.launch();
    const results = [];
    const ctx = await browser.newContext({ baseURL: process.env.SONANCE_BASE_URL || 'http://localhost:8091', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    async function fresh(extra) {
        const page = await ctx.newPage();
        await H.bootMock(page, Object.assign({ scale }, BOOT, extra || {}));
        await H.startTrack(page, 20, { paused: true });
        return page;
    }
    // Home
    let page = await fresh();
    await sweepZones(page, 'home', results);
    // Library tabs
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown'); await H.settle(page, 300);
    await sweepZones(page, 'library-albums', results);
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
    await H.press(page, 'ArrowDown', 3, 120); await H.settle(page, 300); await G.settled(page).catch(() => {});
    let m = await G.measure(page);
    results.push({ state: 'library-albums', zone: 'library-grid', index: 'down3', el: 'card', focusClip: m.focusClip, ring: await ringProbe(page) });
    for (const tab of ['artists', 'songs', 'genres']) {
        await page.evaluate(() => FocusManager.setActiveZone('library-subnav', undefined, true));
        await H.settle(page, 100);
        await H.press(page, 'ArrowDown'); await page.waitForTimeout(600);
        await sweepZones(page, 'library-' + tab, results);
    }
    // genre detail: Enter on genre 0
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
    await H.settle(page, 100);
    await H.press(page, 'Enter'); await page.waitForTimeout(700);
    await sweepZones(page, 'genre-detail', results);
    await page.close();
    // Playlists + detail
    page = await fresh();
    await H.navTo(page, 'playlists');
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
    await H.settle(page, 200);
    await sweepZones(page, 'playlists', results);
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
    await H.press(page, 'Enter'); await page.waitForTimeout(800);
    await sweepZones(page, 'playlist-detail', results);
    await page.close();
    // Album + artist
    page = await fresh();
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown'); await H.settle(page, 300);
    await H.press(page, 'Enter'); await H.waitForScreen(page, 'album'); await page.waitForTimeout(500);
    await sweepZones(page, 'album', results);
    // v3.10 S7 (A5): the options sheet on the first track, then its credits
    // view; only the sheet's own zone (the screen is under the scrim).
    await page.evaluate(() => {
        FocusManager.setActiveZone('album-tracks', 0, true);
        OptionsSheet.open({ song: { id: 'song-album-0-0', title: 'Track 01', artist: 'A Artist 01', artistId: 'artist-0', albumId: 'album-0', album: 'Album 01', coverArt: 'album-0' } });
    });
    await page.waitForTimeout(400);
    await sweepZones(page, 'options-sheet', results, { only: ['options-sheet'] });
    await page.evaluate(() => {
        var items = document.querySelectorAll('#options-sheet .options-sheet-item');
        for (var i = 0; i < items.length; i++) if (items[i].getAttribute('data-action') === 'credits') FocusManager.setActiveZone('options-sheet', i, true);
        FocusManager.activateFocused();
    });
    await page.waitForTimeout(500);
    await sweepZones(page, 'options-credits', results, { only: ['options-sheet'] });
    // v3.10-fix2 F3: the credits view's one stop is its body; scrolled to
    // the end by Down, as the user would.
    await H.press(page, 'ArrowDown', 10, 30); await H.settle(page, 100);
    await sweepZones(page, 'options-credits-scrolled', results, { only: ['options-sheet'] });
    await page.evaluate(() => OptionsSheet.close(true));
    await H.settle(page, 100);
    const hasArtistLink = await page.evaluate(() => !!document.querySelector('.album-detail-artist.focusable'));
    if (hasArtistLink) {
        await page.evaluate(() => {
            var els = document.querySelectorAll('.album-detail-left .focusable');
            var i = Array.prototype.indexOf.call(els, document.querySelector('.album-detail-artist.focusable'));
            FocusManager.setActiveZone('content', i, true);
        });
        await H.settle(page, 100);
        await H.press(page, 'Enter');
        await H.waitForScreen(page, 'artist'); await page.waitForTimeout(900);
        await sweepZones(page, 'artist', results);
    }
    await page.close();
    // Search
    page = await fresh();
    await H.navTo(page, 'search');
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
    await H.settle(page, 200);
    await sweepZones(page, 'search', results);
    // type "A" via Enter on key 0, then wait for results
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
    await H.press(page, 'Enter'); await page.waitForTimeout(1200);
    await sweepZones(page, 'search-results', results);
    await page.close();
    // Queue
    page = await fresh();
    await H.navTo(page, 'queue');
    await page.waitForTimeout(300);
    await sweepZones(page, 'queue', results);
    await page.close();
    // Settings
    page = await fresh();
    await H.navTo(page, 'settings');
    await page.waitForTimeout(300);
    await sweepZones(page, 'settings', results);
    await page.close();
    // Now Playing (lyrics available)
    page = await fresh({ extra: 'mockLyrics=1' });
    await H.navTo(page, 'nowplaying');
    await page.waitForTimeout(500);
    await sweepZones(page, 'nowplaying', results);
    await page.close();
    // Now Playing with the credits panel open (v3.10 S6, R7): its body is
    // a zone (v3.10-fix2 F3: the scroller itself, not one stop per row)
    // only while it is open and taller than its box.
    page = await fresh();
    await H.navTo(page, 'nowplaying');
    await page.waitForTimeout(500);
    await page.evaluate(() => { FocusManager.setActiveZone('np-controls', 7, true); FocusManager.activateFocused(); });
    await page.waitForTimeout(700);
    await sweepZones(page, 'nowplaying-credits', results);
    // fix2 F3: scrolled to the end by Down from the controls.
    await page.evaluate(() => FocusManager.setActiveZone('np-controls', 7, true));
    await H.press(page, 'ArrowDown', 12, 30); await H.settle(page, 100);
    await sweepZones(page, 'nowplaying-credits-scrolled', results, { only: ['np-credits'] });
    await page.close();
    // v3.10-fix2 F2: Up Next hidden (the sleep chip alone under the
    // controls); F7: Focus mode on (the dim over the screen).
    page = await fresh({ storage: { 'sonance-np-upnext': 'hide' } });
    await H.navTo(page, 'nowplaying');
    await page.waitForTimeout(500);
    await sweepZones(page, 'nowplaying-upnext-hidden', results);
    await page.close();
    page = await fresh({ storage: { 'sonance-np-focus': 'on' } });
    await H.navTo(page, 'nowplaying');
    await page.waitForTimeout(500);
    await sweepZones(page, 'nowplaying-focus-on', results);
    await page.close();
    await browser.close();
    return results;
}

(async () => {
    const all = {};
    for (const s of SCALES) {
        all[s] = await run(s);
        const clipped = all[s].filter(r => r.focusClip.length || r.ring.length);
        console.log('scale ' + s + ': ' + all[s].length + ' focus states, ' + clipped.length + ' clipped');
        clipped.forEach(r => console.log('  ' + r.state + ' ' + r.zone + '[' + r.index + '] ' + r.el + ' | box: ' + (r.focusClip.join('; ') || '-') + ' | ring: ' + (r.ring.join('; ') || '-')));
    }
    fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
})().catch(e => { console.error(e); process.exit(1); });

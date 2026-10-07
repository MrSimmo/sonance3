#!/usr/bin/env node
'use strict';

// Pixel diff of two PNGs, or of two directories of same-named PNGs, decoded by
// Chromium itself (canvas getImageData) — the v3.9 method, ticket-3.10 §8.
// Reports, per pair: differing pixels, the max per-channel delta and the
// bounding box of the differences.
//
// Usage: NODE_PATH="$PWD/node_modules" node tests/tools/png-diff.js <a.png|dirA> <b.png|dirB>
// Exit code 1 if any pair differs or a file is missing from either side.

var fs = require('fs');
var path = require('path');
var { chromium } = require('playwright');

function pairs(a, b) {
    if (fs.statSync(a).isDirectory()) {
        var names = fs.readdirSync(a).filter(function(f) { return /\.png$/.test(f); }).sort();
        var other = fs.readdirSync(b).filter(function(f) { return /\.png$/.test(f); });
        var out = names.map(function(f) { return [path.join(a, f), path.join(b, f), f]; });
        other.forEach(function(f) { if (names.indexOf(f) < 0) out.push([null, path.join(b, f), f]); });
        return out;
    }
    return [[a, b, path.basename(a)]];
}

async function diff(page, fa, fb) {
    return page.evaluate(async function(args) {
        async function decode(b64) {
            var blob = await (await fetch('data:image/png;base64,' + b64)).blob();
            var bmp = await createImageBitmap(blob);
            var c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            var ctx = c.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
        }
        var A = await decode(args[0]), B = await decode(args[1]);
        if (A.w !== B.w || A.h !== B.h) return { sizeMismatch: [A.w, A.h, B.w, B.h] };
        var n = 0, max = 0, x0 = A.w, y0 = A.h, x1 = -1, y1 = -1;
        for (var i = 0; i < A.d.length; i += 4) {
            var m = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]),
                Math.abs(A.d[i + 2] - B.d[i + 2]), Math.abs(A.d[i + 3] - B.d[i + 3]));
            if (m) {
                n++;
                if (m > max) max = m;
                var p = i / 4, x = p % A.w, y = (p - x) / A.w;
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        return { pixels: A.w * A.h, diff: n, maxDelta: max, bbox: n ? [x0, y0, x1, y1] : null };
    }, [fs.readFileSync(fa).toString('base64'), fs.readFileSync(fb).toString('base64')]);
}

(async function() {
    var a = process.argv[2], b = process.argv[3];
    if (!a || !b) { console.error('usage: png-diff.js <a> <b>'); process.exit(2); }
    var browser = await chromium.launch();
    var page = await browser.newPage();
    var bad = 0;
    var list = pairs(a, b);
    for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p[0] || !fs.existsSync(p[1])) { console.log(p[2] + '  MISSING on one side'); bad++; continue; }
        var r = await diff(page, p[0], p[1]);
        if (r.sizeMismatch) { console.log(p[2] + '  SIZE ' + r.sizeMismatch.join('x')); bad++; continue; }
        if (r.diff) bad++;
        console.log(p[2] + '  diff ' + r.diff + ' / ' + r.pixels + '  maxDelta ' + r.maxDelta +
            (r.bbox ? '  bbox ' + r.bbox.join(',') : ''));
    }
    await browser.close();
    console.log(list.length + ' pair(s), ' + bad + ' differing');
    process.exit(bad ? 1 : 0);
})().catch(function(e) { console.error(e); process.exit(1); });

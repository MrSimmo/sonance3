#!/usr/bin/env node
'use strict';

// Builds icon-oblong-1920.png at the project root (ticket-3.10 R12, D59).
//
// 1. Renders tests/tools/icon-oblong-1920.html in headless Chromium at
//    exactly 1920x1080, DPR 1.
// 2. Re-encodes the screenshot losslessly with Node's built-in zlib only
//    (v3.9 S5 T13 method): decode, check every alpha byte is 255, drop the
//    alpha channel (colour type 2, RGB), re-filter each scanline adaptively
//    (the filter of the five with the smallest sum of absolute residuals),
//    deflate at level 9.
// 3. Decodes the result again and compares every pixel with the screenshot,
//    so "lossless" is checked, not assumed.
//
// Usage: NODE_PATH="$PWD/node_modules" node tests/tools/make-oblong-icon.js [outFile]

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var { chromium } = require('playwright');

var ROOT = path.resolve(__dirname, '..', '..');
var SRC = path.join(__dirname, 'icon-oblong-1920.html');
var OUT = process.argv[2] || path.join(ROOT, 'icon-oblong-1920.png');

function decodePng(buf) {
    var sig = '89504e470d0a1a0a';
    if (buf.slice(0, 8).toString('hex') !== sig) throw new Error('not a PNG');
    var off = 8, ihdr = null, idat = [];
    while (off < buf.length) {
        var len = buf.readUInt32BE(off);
        var type = buf.toString('ascii', off + 4, off + 8);
        var data = buf.slice(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (ihdr.depth !== 8 || ihdr.interlace !== 0 || (ihdr.colour !== 2 && ihdr.colour !== 6)) {
        throw new Error('unsupported PNG: ' + JSON.stringify(ihdr));
    }
    var bpp = ihdr.colour === 6 ? 4 : 3;
    var raw = zlib.inflateSync(Buffer.concat(idat));
    var stride = ihdr.w * bpp;
    var px = Buffer.alloc(ihdr.h * stride);
    for (var y = 0; y < ihdr.h; y++) {
        var f = raw[y * (stride + 1)];
        var line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (var x = 0; x < stride; x++) {
            var a = x >= bpp ? px[y * stride + x - bpp] : 0;
            var b = y > 0 ? px[(y - 1) * stride + x] : 0;
            var c = (x >= bpp && y > 0) ? px[(y - 1) * stride + x - bpp] : 0;
            var v = line[x], p;
            if (f === 0) p = v;
            else if (f === 1) p = v + a;
            else if (f === 2) p = v + b;
            else if (f === 3) p = v + ((a + b) >> 1);
            else if (f === 4) p = v + paeth(a, b, c);
            else throw new Error('bad filter ' + f);
            px[y * stride + x] = p & 0xff;
        }
    }
    return { w: ihdr.w, h: ihdr.h, bpp: bpp, colour: ihdr.colour, px: px };
}

function paeth(a, b, c) {
    var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

function chunk(type, data) {
    var len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    var crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
}

function encodeRgb(w, h, rgb) {
    var stride = w * 3, bpp = 3;
    var out = Buffer.alloc(h * (stride + 1));
    var cand = [0, 1, 2, 3, 4].map(function() { return Buffer.alloc(stride); });
    for (var y = 0; y < h; y++) {
        var best = 0, bestSum = Infinity;
        for (var f = 0; f < 5; f++) {
            var sum = 0, line = cand[f];
            for (var x = 0; x < stride; x++) {
                var v = rgb[y * stride + x];
                var a = x >= bpp ? rgb[y * stride + x - bpp] : 0;
                var b = y > 0 ? rgb[(y - 1) * stride + x] : 0;
                var c = (x >= bpp && y > 0) ? rgb[(y - 1) * stride + x - bpp] : 0;
                var r;
                if (f === 0) r = v;
                else if (f === 1) r = v - a;
                else if (f === 2) r = v - b;
                else if (f === 3) r = v - ((a + b) >> 1);
                else r = v - paeth(a, b, c);
                r &= 0xff;
                line[x] = r;
                sum += r < 128 ? r : 256 - r;
            }
            if (sum < bestSum) { bestSum = sum; best = f; }
        }
        out[y * (stride + 1)] = best;
        cand[best].copy(out, y * (stride + 1) + 1);
    }
    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(out, { level: 9, memLevel: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function toRgb(img) {
    if (img.bpp === 3) return { rgb: img.px, alphaNot255: 0 };
    var n = img.w * img.h, rgb = Buffer.alloc(n * 3), bad = 0;
    for (var i = 0; i < n; i++) {
        rgb[i * 3] = img.px[i * 4];
        rgb[i * 3 + 1] = img.px[i * 4 + 1];
        rgb[i * 3 + 2] = img.px[i * 4 + 2];
        if (img.px[i * 4 + 3] !== 255) bad++;
    }
    return { rgb: rgb, alphaNot255: bad };
}

(async function() {
    var browser = await chromium.launch();
    var page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto('file://' + SRC);
    await page.evaluate(function() { return document.fonts.ready; });
    var shot = await page.screenshot({ type: 'png', omitBackground: false });
    // Bounding box of everything that is not the ground, for the 80% rule.
    var box = await page.evaluate(function() {
        var r = document.querySelector('.lockup').getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    await browser.close();

    var src = decodePng(shot);
    var conv = toRgb(src);
    if (conv.alphaNot255) throw new Error(conv.alphaNot255 + ' pixels are not opaque');
    var png = encodeRgb(src.w, src.h, conv.rgb);
    var back = decodePng(png);
    if (back.w !== src.w || back.h !== src.h || back.colour !== 2) throw new Error('re-encode header mismatch');
    if (Buffer.compare(back.px, conv.rgb) !== 0) throw new Error('re-encode is NOT lossless');
    fs.writeFileSync(OUT, png);
    console.log('screenshot ' + shot.length + ' B (' + src.w + 'x' + src.h + ', colour type ' + src.colour + ')');
    console.log('written    ' + png.length + ' B -> ' + path.relative(ROOT, OUT) + ' (colour type 2 RGB, no alpha)');
    console.log('lossless   ' + src.w * src.h + ' / ' + src.w * src.h + ' pixels identical');
    console.log('artwork bbox ' + JSON.stringify(box) + ' inside central 80% [192,108,1728,972]: ' +
        (box.left >= 192 && box.top >= 108 && box.right <= 1728 && box.bottom <= 972));
})().catch(function(e) { console.error(e); process.exit(1); });

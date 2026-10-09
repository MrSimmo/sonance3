#!/usr/bin/env node
'use strict';

// Sonance — browser test dev server.
//
// Serves the project's static files (as `python3 -m http.server 8080` did) and
// additionally answers the two Subsonic endpoints that CANNOT be handled by the
// fetch mock in tests/mock-boot.js: `<img>.src` and `<audio>.src` never pass
// through `window.fetch`.
//
//   /rest/getCoverArt.view  → a deterministic PNG sized from ?size=, served
//                             with Cache-Control + ETag, so Chromium's HTTP
//                             disk cache behaves as it does against a real
//                             Navidrome. This is what makes the v3.9 T2
//                             `fromDiskCache` measurement possible.
//   /rest/stream.view       → a real WAV with Range support, so the browser's
//                             HTML5 fallback player actually progresses; with
//                             format=mp3 (v3.12 R1), a transcode: MP3, chunked,
//                             no byte ranges, timeOffset honoured.
//
// Static assets are sent `no-store` so an edit is always picked up between
// runs; only the synthetic media is cacheable.
//
// Usage:  node tests/dev-server.js [port]      (default 8080)

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var PORT = parseInt(process.argv[2], 10) || 8080;

var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.xml': 'application/xml'
};

// ---------------------------------------------------------------------------
// PNG synthesis (no dependencies — zlib is built in)
// ---------------------------------------------------------------------------

var CRC_TABLE = (function() {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    var len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    var crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

function hsvToRgb(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Cover aspect ratio. Real libraries hold square, landscape- and
// portrait-cropped covers, and the Now Playing backdrop has to cover the
// viewport for all three (V3-6-fix overscan, v3.9 T3). Default 'square' keeps
// every measurement taken before this switch existed comparable; a test flips
// it at runtime via GET /__cover-aspect?mode=…
var ASPECT_MODES = {
    square: [1, 1],
    landscape: [3, 2],
    portrait: [2, 3]
};
var _aspectMode = process.env.SONANCE_COVER_ASPECT || 'square';

function aspectFor(id) {
    if (_aspectMode !== 'mixed') return ASPECT_MODES[_aspectMode] || ASPECT_MODES.square;
    var keys = ['square', 'landscape', 'portrait'];
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return ASPECT_MODES[keys[h % 3]];
}

// A gradient plus deterministic dither, so the encoded size scales with the
// requested pixel area the way a real cover does. A flat colour would deflate
// to a few hundred bytes at any dimension and make byte-level over-fetch
// measurements meaningless.
function makePng(w, h, hue) {
    var raw = Buffer.alloc(h * (w * 3 + 1));
    var base = hsvToRgb(hue, 0.62, 0.86);
    var seed = (hue * 2654435761) >>> 0;
    var p = 0;
    for (var y = 0; y < h; y++) {
        raw[p++] = 0; // filter type: none
        for (var x = 0; x < w; x++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            var noise = ((seed >>> 24) & 0x1F) - 16;
            var shade = 0.55 + 0.45 * (y / h);
            raw[p++] = Math.max(0, Math.min(255, Math.round(base[0] * shade) + noise));
            raw[p++] = Math.max(0, Math.min(255, Math.round(base[1] * shade) + noise));
            raw[p++] = Math.max(0, Math.min(255, Math.round(base[2] * shade) + noise));
        }
    }

    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // colour type: truecolour
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

// Keyed by (hue bucket, size) rather than by cover id: the bytes only depend on
// those two, and 1200 distinct album ids would otherwise pin ~60 MB here. URLs
// stay distinct per id, which is all the disk-cache measurement needs.
var HUE_BUCKETS = 36;
var _pngCache = {};
function coverPng(id, size) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    var hue = (hash % HUE_BUCKETS) * (360 / HUE_BUCKETS);
    var a = aspectFor(id);
    // Longest side == the requested size, so `size` still bounds the download.
    var w = a[0] >= a[1] ? size : Math.round(size * a[0] / a[1]);
    var h = a[1] >= a[0] ? size : Math.round(size * a[1] / a[0]);
    var key = hue + '_' + w + 'x' + h;
    if (!_pngCache[key]) _pngCache[key] = makePng(w, h, hue);
    return { png: _pngCache[key], w: w, h: h };
}

// ---------------------------------------------------------------------------
// WAV synthesis
// ---------------------------------------------------------------------------

var SAMPLE_RATE = 8000;
var WAV_SECONDS = 20;

var _wav = (function() {
    var samples = SAMPLE_RATE * WAV_SECONDS;
    var dataLen = samples * 2;
    var buf = Buffer.alloc(44 + dataLen);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataLen, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);           // fmt chunk size
    buf.writeUInt16LE(1, 20);            // PCM
    buf.writeUInt16LE(1, 22);            // mono
    buf.writeUInt32LE(SAMPLE_RATE, 24);
    buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
    buf.writeUInt16LE(2, 32);            // block align
    buf.writeUInt16LE(16, 34);           // bits per sample
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataLen, 40);
    for (var n = 0; n < samples; n++) {
        // Quiet 220 Hz tone — audible enough to confirm decode, not a nuisance.
        var v = Math.round(Math.sin(2 * Math.PI * 220 * n / SAMPLE_RATE) * 2000);
        buf.writeInt16LE(v, 44 + n * 2);
    }
    return buf;
})();

// ---------------------------------------------------------------------------
// MP3 synthesis (v3.12 R1: the transcoded stream)
// ---------------------------------------------------------------------------

// Silent MPEG-1 Layer III frames: a 4-byte header (32 kbit/s, 44.1 kHz,
// mono, no CRC: FF FB 10 C0) and 100 zero bytes (17 of side information
// with no main data, so every granule decodes to silence). 144 * 32000 /
// 44100 = 104 bytes a frame, 1152 samples = 26.1 ms. Any MP3 decoder plays
// it; no encoder is needed.
var MP3_FRAME_BYTES = 104;
var MP3_FRAME_SECONDS = 1152 / 44100;
var TRANSCODE_SECONDS = 20;

var _mp3 = (function() {
    var frames = Math.ceil(TRANSCODE_SECONDS / MP3_FRAME_SECONDS);
    var buf = Buffer.alloc(frames * MP3_FRAME_BYTES);
    for (var f = 0; f < frames; f++) {
        buf.writeUInt32BE(0xFFFB10C0, f * MP3_FRAME_BYTES);
    }
    return buf;
})();

// What Navidrome does for `stream.view?format=mp3[&maxBitRate][&timeOffset]`:
// ffmpeg's output streamed as it is made, so no Content-Length, no byte
// ranges (a Range header is ignored: 200, the whole stream) and nothing
// cacheable; `timeOffset` (whole seconds) starts the output that far into
// the track. The synthetic track is silence, so the offset changes nothing
// audible here: every answer is TRANSCODE_SECONDS long, as from a track long
// enough to have that much left, and the offset is echoed in a header for
// anyone reading the response.
function sendTranscoded(req, res, format, timeOffset) {
    if (format !== 'mp3') {
        res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('dev-server transcodes to mp3 only, not ' + format);
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'none',
        'X-Mock-Transcode': format + '; timeOffset=' + (parseInt(timeOffset, 10) || 0)
    });
    if (req.method === 'HEAD') { res.end(); return; }
    // Written in pieces, as a live transcode is.
    var CHUNK = MP3_FRAME_BYTES * 96;
    for (var at = 0; at < _mp3.length; at += CHUNK) res.write(_mp3.slice(at, at + CHUNK));
    res.end();
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function sendMedia(req, res, body, type, etag) {
    var headers = {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
        'ETag': etag,
        'Accept-Ranges': 'bytes'
    };

    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
    }

    var range = req.headers.range;
    if (range) {
        var m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
            var start = m[1] ? parseInt(m[1], 10) : 0;
            var end = m[2] ? parseInt(m[2], 10) : body.length - 1;
            if (start >= body.length) {
                res.writeHead(416, { 'Content-Range': 'bytes */' + body.length });
                res.end();
                return;
            }
            end = Math.min(end, body.length - 1);
            var slice = body.slice(start, end + 1);
            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + body.length;
            headers['Content-Length'] = slice.length;
            res.writeHead(206, headers);
            res.end(req.method === 'HEAD' ? undefined : slice);
            return;
        }
    }

    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
}

var server = http.createServer(function(req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = decodeURIComponent(parsed.pathname);

    // Test-only control: flip the synthetic cover aspect ratio at runtime.
    if (pathname === '/__cover-aspect') {
        var mode = String(parsed.query.mode || 'square');
        if (mode !== 'mixed' && !ASPECT_MODES[mode]) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('unknown mode: ' + mode);
            return;
        }
        _aspectMode = mode;
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('cover aspect = ' + mode);
        return;
    }

    if (pathname.indexOf('/rest/') === 0) {
        // Test-only: a well-formed subsonic-response whose BODY is dripped out
        // over `ms` in `chunks` writes, with headers sent immediately. Session
        // 3 T8 needs this: the pre-change _request cleared its timeout on
        // headers, so a slow body had no timeout at all.
        if (/__slow\.view/.test(pathname)) {
            var totalMs = parseInt(parsed.query.ms, 10) || 30000;
            var chunks = Math.max(1, parseInt(parsed.query.chunks, 10) || 30);
            var payload = JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1',
                pad: new Array(2000).join('x') } });
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            var per = Math.ceil(payload.length / chunks);
            var sent = 0;
            var timer = setInterval(function() {
                if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }
                res.write(payload.slice(sent, sent + per));
                sent += per;
                if (sent >= payload.length) { clearInterval(timer); res.end(); }
            }, Math.max(1, Math.floor(totalMs / chunks)));
            req.on('close', function() { clearInterval(timer); });
            return;
        }
        if (/getCoverArt/.test(pathname)) {
            var id = String(parsed.query.id || 'default');
            var size = parseInt(parsed.query.size, 10) || 300;
            size = Math.max(16, Math.min(1000, size));
            var cover = coverPng(id, size);
            // Aspect is in the ETag: the same URL legitimately yields different
            // bytes after a mode flip, and the cache must notice.
            sendMedia(req, res, cover.png, 'image/png',
                '"art-' + id + '-' + cover.w + 'x' + cover.h + '"');
            return;
        }
        if (/stream/.test(pathname)) {
            // v3.12 R1: `format` other than `raw` asks for a transcode.
            if (parsed.query.format && parsed.query.format !== 'raw') {
                sendTranscoded(req, res, String(parsed.query.format), parsed.query.timeOffset);
                return;
            }
            sendMedia(req, res, _wav, 'audio/wav', '"stream-' + (parsed.query.id || '0') + '"');
            return;
        }
        // Everything else on /rest/ is handled by the in-page fetch mock; a
        // request reaching here means the mock missed it.
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not mocked by dev-server: ' + pathname }));
        return;
    }

    var rel = pathname === '/' ? '/index.html' : pathname;
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(file, function(err, st) {
        if (err || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + rel);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
    });
});

server.listen(PORT, function() {
    console.log('Sonance dev server on http://localhost:' + PORT + ' (root ' + ROOT + ')');
    console.log('  app:  http://localhost:' + PORT + '/index.html');
    console.log('  mock: http://localhost:' + PORT + '/tests/mock-index.html?mockAlbums=1200&mockArtists=2000');
});

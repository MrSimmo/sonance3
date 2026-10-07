/* ============================================
   Sonance — Utility Module
   ============================================ */

var SonanceUtils = (function() {
    'use strict';

    // --- Console Logger ---
    // V3.9 S4 T4: log() was an unconditional console.log at 118 call sites,
    // and on Tizen every console call crosses a slow JS→native bridge. The
    // worst of them is js/player.js's AVPlay `onevent` listener, which fires
    // at an uncontrolled rate *during playback*. log() is therefore gated and
    // off by default; warn() and error() stay live, because they are rare and
    // they are what diagnoses a real failure.
    //
    // Turning it on: set `window.SONANCE_DEBUG = true` before the app scripts
    // load, or call `SonanceUtils.setDebug(true)` at runtime (from the Tizen
    // Web Inspector console, or `?debug=1` in a browser). The gate is a
    // runtime flag rather than a build-time strip precisely so it still works
    // in the shipped .wgt, where adding logging is hardest.
    var DEBUG = false;
    try {
        DEBUG = (window.SONANCE_DEBUG === true) ||
                /[?&]debug=1(&|$)/.test(window.location.search);
    } catch (e) { /* no window / no location — stay off */ }

    function log(module, message) {
        if (!DEBUG) return;
        console.log('[Sonance][' + module + '] ' + message);
    }

    function setDebug(on) {
        DEBUG = !!on;
        console.log('[Sonance][Utils] Debug logging ' + (DEBUG ? 'ON' : 'OFF'));
    }

    function isDebug() {
        return DEBUG;
    }

    function warn(module, message) {
        console.warn('[Sonance][' + module + '] ' + message);
    }

    function error(module, message) {
        console.error('[Sonance][' + module + '] ' + message);
    }

    // --- Interface size (v3.10 R4, D49) ---
    // css/styles.css is rem on a root of 10px x scale. The <head> script in
    // index.html applies the stored scale before first paint, and
    // App.applyUiScale changes it live. JS follows the same scale two ways
    // (ticket-3.10 §6.1):
    //   rem(px) - a design length (icon, art, radius) as a rem string, so it
    //             tracks a live size change with no rebuild;
    //   px(n)   - layout maths that has to be a px number now (scroll
    //             padding, slide distance, VirtualGrid estimates).
    // Measured geometry needs neither: it is read from layout (D11).
    // The head script repeats this list because it runs before this file.
    var UI_SCALES = [1, 1.25, 1.5, 1.75, 2];
    var _uiScale = null;

    // D67: read once from the root's computed font size - what the head
    // script applied, or the stylesheet's 10px if it did not run - then kept
    // in step by setUiScale. Not re-read on every call: px() runs inside
    // focus/scroll handlers, where getComputedStyle could force a style
    // recalc. A computed value outside UI_SCALES (a platform minimum font
    // size clamping the root) is still the truth the rem layout is using.
    function uiScale() {
        if (_uiScale === null) {
            var size = parseFloat(getComputedStyle(document.documentElement).fontSize);
            _uiScale = size > 0 ? size / 10 : 1;
        }
        return _uiScale;
    }

    function setUiScale(scale) {
        _uiScale = scale;
    }

    function rem(px) {
        return (px / 10) + 'rem';
    }

    function px(n) {
        return n * uiScale();
    }

    /**
     * v3.10 D70: the getCoverArt `size` for art whose v3.9 request bucket
     * (chosen for interface size 100 %, v3.9 T1) is `bucket`, scaled with
     * the interface size: at 150 % the grid's 180 becomes 270, as the card
     * is drawn at 212 px (it was upscaled from 180). Every surface and its
     * preload call this with the same bucket, so their URLs stay identical
     * (v3.9 T6 cache-key rule); at 100 % nothing changes.
     */
    function artSize(bucket) {
        return Math.round(bucket * uiScale());
    }

    // --- Smooth scrolling (v3.10 R1.8, D58) ---
    // Settings → Advanced → "Smooth scrolling (experimental)", default Off.
    // Whether animated focus-follow scrolling helps the TV or costs it frames
    // is a compositor question a browser cannot answer (the D47 rule), so it
    // ships behind this flag until the user compares the overlay's FPS off
    // and on. On = the `smooth-scroll` class on <html>: every scroller gets
    // `scroll-behavior: smooth`, and the scrollTop writes the focus-follow
    // already makes animate. VirtualGrid renders for the position it asks
    // for, not the one the animation has reached (ensureIndexVisible).
    var SMOOTH_SCROLL_KEY = 'sonance-exp-smooth-scroll';

    function smoothScroll() {
        try { return localStorage.getItem(SMOOTH_SCROLL_KEY) === 'on'; } catch (e) { return false; }
    }

    function setSmoothScroll(on) {
        try { localStorage.setItem(SMOOTH_SCROLL_KEY, on ? 'on' : 'off'); } catch (e) { /* stays for this run */ }
        document.documentElement.classList.toggle('smooth-scroll', !!on);
    }

    document.documentElement.classList.toggle('smooth-scroll', smoothScroll());

    /**
     * v3.10 D76: scroll `scroller` vertically so `element` is inside it with
     * `margin` px clear above and below - scrollIntoView({block: 'nearest'})
     * with room for a focused card's scale and ring, which that leaves cut
     * at the scroller's edge (no scroll-margin on Chromium 63). Reads the
     * element's centre, which a scale about the centre does not move, so it
     * is right while the focus transition is still running.
     */
    function revealInScroller(element, scroller, margin) {
        if (!element || !scroller) return;
        var er = element.getBoundingClientRect();
        var sr = scroller.getBoundingClientRect();
        var centre = (er.top + er.bottom) / 2;
        var half = element.offsetHeight / 2 + margin;
        if (centre - half < sr.top) {
            scroller.scrollTop -= sr.top - (centre - half);
        } else if (centre + half > sr.bottom) {
            scroller.scrollTop += (centre + half) - sr.bottom;
        }
    }

    // --- DOM Helpers ---
    function el(tag, attrs) {
        var element = document.createElement(tag);
        var children = Array.prototype.slice.call(arguments, 2);

        if (attrs) {
            Object.keys(attrs).forEach(function(key) {
                if (key === 'className') {
                    element.className = attrs[key];
                } else if (key === 'style' && typeof attrs[key] === 'object') {
                    Object.keys(attrs[key]).forEach(function(prop) {
                        element.style[prop] = attrs[key][prop];
                    });
                } else if (key.indexOf('on') === 0) {
                    var eventName = key.substring(2).toLowerCase();
                    element.addEventListener(eventName, attrs[key]);
                } else {
                    element.setAttribute(key, attrs[key]);
                }
            });
        }

        children.forEach(function(child) {
            if (child === null || child === undefined) return;
            if (typeof child === 'string' || typeof child === 'number') {
                element.appendChild(document.createTextNode(String(child)));
            } else if (child instanceof HTMLElement || child instanceof SVGElement) {
                element.appendChild(child);
            }
        });

        return element;
    }

    function $(selector) {
        return document.querySelector(selector);
    }

    function $$(selector) {
        return document.querySelectorAll(selector);
    }

    // --- SVG Helper (safe DOM creation, no innerHTML) ---
    function createSvg(pathData, viewBox) {
        viewBox = viewBox || '0 0 24 24';
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    // --- Star Icon Helper (outline/filled) ---
    // Uses currentColor for stroke/fill so colour is controlled by CSS.
    var STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

    function createStarSvg(filled) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('xmlns', ns);
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', STAR_PATH);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('fill', filled ? 'currentColor' : 'none');
        svg.appendChild(path);
        return svg;
    }

    // --- SVG Path Data Constants ---
    var SVG_PATHS = {
        musicNote: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
        home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        grid: 'M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm0 10h8v8h-8v-8z',
        search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        playlist: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
        nowPlaying: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
        queue: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
        settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
        play: 'M8 5v14l11-7z',
        pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
        skipNext: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
        skipPrev: 'M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z',
        volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.47 4.47 0 0 0 2.5-3.5z',
        // v3.10 A2: the Albums Sort chip (up and down arrows).
        sort: 'M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z',
        shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
        // v3.10 A5: the options sheet's actions (Material icon paths, as above).
        star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
        album: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
        artist: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
        radio: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.89 2 2 2h16c1.11 0 2-.9 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z',
        info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
        remove: 'M19 13H5v-2h14v2z'
    };

    // --- Generate Random Salt ---
    function generateSalt(length) {
        length = length || 12;
        var chars = '0123456789abcdef';
        var salt = '';
        for (var i = 0; i < length; i++) {
            salt += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return salt;
    }

    // --- Format Duration ---
    function formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '0:00';
        seconds = Math.floor(seconds);
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    // --- MD5 Hash ---
    // Lightweight MD5 implementation (based on Joseph Myers' implementation)
    function md5(string) {
        function md5cycle(x, k) {
            var a = x[0], b = x[1], c = x[2], d = x[3];

            a = ff(a, b, c, d, k[0], 7, -680876936);
            d = ff(d, a, b, c, k[1], 12, -389564586);
            c = ff(c, d, a, b, k[2], 17, 606105819);
            b = ff(b, c, d, a, k[3], 22, -1044525330);
            a = ff(a, b, c, d, k[4], 7, -176418897);
            d = ff(d, a, b, c, k[5], 12, 1200080426);
            c = ff(c, d, a, b, k[6], 17, -1473231341);
            b = ff(b, c, d, a, k[7], 22, -45705983);
            a = ff(a, b, c, d, k[8], 7, 1770035416);
            d = ff(d, a, b, c, k[9], 12, -1958414417);
            c = ff(c, d, a, b, k[10], 17, -42063);
            b = ff(b, c, d, a, k[11], 22, -1990404162);
            a = ff(a, b, c, d, k[12], 7, 1804603682);
            d = ff(d, a, b, c, k[13], 12, -40341101);
            c = ff(c, d, a, b, k[14], 17, -1502002290);
            b = ff(b, c, d, a, k[15], 22, 1236535329);

            a = gg(a, b, c, d, k[1], 5, -165796510);
            d = gg(d, a, b, c, k[6], 9, -1069501632);
            c = gg(c, d, a, b, k[11], 14, 643717713);
            b = gg(b, c, d, a, k[0], 20, -373897302);
            a = gg(a, b, c, d, k[5], 5, -701558691);
            d = gg(d, a, b, c, k[10], 9, 38016083);
            c = gg(c, d, a, b, k[15], 14, -660478335);
            b = gg(b, c, d, a, k[4], 20, -405537848);
            a = gg(a, b, c, d, k[9], 5, 568446438);
            d = gg(d, a, b, c, k[14], 9, -1019803690);
            c = gg(c, d, a, b, k[3], 14, -187363961);
            b = gg(b, c, d, a, k[8], 20, 1163531501);
            a = gg(a, b, c, d, k[13], 5, -1444681467);
            d = gg(d, a, b, c, k[2], 9, -51403784);
            c = gg(c, d, a, b, k[7], 14, 1735328473);
            b = gg(b, c, d, a, k[12], 20, -1926607734);

            a = hh(a, b, c, d, k[5], 4, -378558);
            d = hh(d, a, b, c, k[8], 11, -2022574463);
            c = hh(c, d, a, b, k[11], 16, 1839030562);
            b = hh(b, c, d, a, k[14], 23, -35309556);
            a = hh(a, b, c, d, k[1], 4, -1530992060);
            d = hh(d, a, b, c, k[4], 11, 1272893353);
            c = hh(c, d, a, b, k[7], 16, -155497632);
            b = hh(b, c, d, a, k[10], 23, -1094730640);
            a = hh(a, b, c, d, k[13], 4, 681279174);
            d = hh(d, a, b, c, k[0], 11, -358537222);
            c = hh(c, d, a, b, k[3], 16, -722521979);
            b = hh(b, c, d, a, k[6], 23, 76029189);
            a = hh(a, b, c, d, k[9], 4, -640364487);
            d = hh(d, a, b, c, k[12], 11, -421815835);
            c = hh(c, d, a, b, k[15], 16, 530742520);
            b = hh(b, c, d, a, k[2], 23, -995338651);

            a = ii(a, b, c, d, k[0], 6, -198630844);
            d = ii(d, a, b, c, k[7], 10, 1126891415);
            c = ii(c, d, a, b, k[14], 15, -1416354905);
            b = ii(b, c, d, a, k[5], 21, -57434055);
            a = ii(a, b, c, d, k[12], 6, 1700485571);
            d = ii(d, a, b, c, k[3], 10, -1894986606);
            c = ii(c, d, a, b, k[10], 15, -1051523);
            b = ii(b, c, d, a, k[1], 21, -2054922799);
            a = ii(a, b, c, d, k[8], 6, 1873313359);
            d = ii(d, a, b, c, k[15], 10, -30611744);
            c = ii(c, d, a, b, k[6], 15, -1560198380);
            b = ii(b, c, d, a, k[13], 21, 1309151649);
            a = ii(a, b, c, d, k[4], 6, -145523070);
            d = ii(d, a, b, c, k[11], 10, -1120210379);
            c = ii(c, d, a, b, k[2], 15, 718787259);
            b = ii(b, c, d, a, k[9], 21, -343485551);

            x[0] = add32(a, x[0]);
            x[1] = add32(b, x[1]);
            x[2] = add32(c, x[2]);
            x[3] = add32(d, x[3]);
        }

        function cmn(q, a, b, x, s, t) {
            a = add32(add32(a, q), add32(x, t));
            return add32((a << s) | (a >>> (32 - s)), b);
        }

        function ff(a, b, c, d, x, s, t) {
            return cmn((b & c) | ((~b) & d), a, b, x, s, t);
        }

        function gg(a, b, c, d, x, s, t) {
            return cmn((b & d) | (c & (~d)), a, b, x, s, t);
        }

        function hh(a, b, c, d, x, s, t) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }

        function ii(a, b, c, d, x, s, t) {
            return cmn(c ^ (b | (~d)), a, b, x, s, t);
        }

        function md5blk(s) {
            var md5blks = [];
            for (var i = 0; i < 64; i += 4) {
                md5blks[i >> 2] = s.charCodeAt(i) +
                    (s.charCodeAt(i + 1) << 8) +
                    (s.charCodeAt(i + 2) << 16) +
                    (s.charCodeAt(i + 3) << 24);
            }
            return md5blks;
        }

        var hex_chr = '0123456789abcdef'.split('');

        function rhex(n) {
            var s = '';
            for (var j = 0; j < 4; j++) {
                s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] +
                     hex_chr[(n >> (j * 8)) & 0x0F];
            }
            return s;
        }

        function hex(x) {
            return rhex(x[0]) + rhex(x[1]) + rhex(x[2]) + rhex(x[3]);
        }

        function add32(a, b) {
            return (a + b) & 0xFFFFFFFF;
        }

        function md5str(s) {
            var n = s.length;
            var state = [1732584193, -271733879, -1732584194, 271733878];
            var i;

            for (i = 64; i <= n; i += 64) {
                md5cycle(state, md5blk(s.substring(i - 64, i)));
            }

            s = s.substring(i - 64);
            var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (i = 0; i < s.length; i++) {
                tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
            }
            tail[i >> 2] |= 0x80 << ((i % 4) << 3);

            if (i > 55) {
                md5cycle(state, tail);
                for (i = 0; i < 16; i++) tail[i] = 0;
            }

            tail[14] = n * 8;
            md5cycle(state, tail);

            return hex(state);
        }

        return md5str(string);
    }

    // --- Paginated Loader ---
    function PaginatedLoader(fetchFn, pageSize) {
        this.pageSize = pageSize || 50;
        this.offset = 0;
        this.hasMore = true;
        this.loading = false;
        this.fetchFn = fetchFn;
    }

    PaginatedLoader.prototype.loadNext = function(callback) {
        if (this.loading || !this.hasMore) return;
        this.loading = true;
        var self = this;
        this.fetchFn(this.pageSize, this.offset).then(function(items) {
            self.offset += items.length;
            self.hasMore = items.length >= self.pageSize;
            self.loading = false;
            callback(items, self.hasMore);
        }).catch(function(err) {
            self.loading = false;
            error('Pagination', err.message || String(err));
        });
    };

    PaginatedLoader.prototype.reset = function() {
        this.offset = 0;
        this.hasMore = true;
        this.loading = false;
    };

    // --- Virtual Grid (V3-6-fix2 PERF-2) ---
    // For libraries with hundreds of cards, mounting every card is expensive
    // even with lazy image loading. VirtualGrid keeps only the visible rows
    // (plus a buffer) in the DOM. The scroll container gets a tall spacer so
    // scroll height matches the full collection; an absolutely-positioned
    // grid translates by `startRow * itemHeight` to land in the right place.
    //
    // Usage:
    //   var vg = new VirtualGrid({
    //       scrollContainer: ...,   // element that scrolls
    //       mountContainer: ...,    // becomes position:relative; spacer + grid live inside
    //       items: [...],
    //       renderItem: function(item, index) { return cardElement; },
    //       itemHeight: 220,
    //       columns: 8,             // optional; auto-detected if itemMinWidth provided
    //       itemMinWidth: 130,      // px; used to compute columns from container width
    //       gridClassName: 'library-grid library-artists-grid',
    //       bufferRows: 2,
    //       onRangeRender: function(elements, startIndex, endIndex) { ... }
    //   });
    //   vg.init();
    //   ...
    //   vg.destroy();
    function VirtualGrid(opts) {
        this.scrollContainer = opts.scrollContainer;
        this.mountContainer = opts.mountContainer;
        this.items = opts.items || [];
        this.renderItem = opts.renderItem;
        // v3.10 R4: callers pass their own estimate (or a measured pitch);
        // the fallback is a 100 %-size estimate scaled to the interface size.
        this.itemHeight = opts.itemHeight || px(220);
        this.itemMinWidth = opts.itemMinWidth || 0;
        this.fixedColumns = opts.columns || 0;
        this.gridClassName = opts.gridClassName || '';
        this.bufferRows = (opts.bufferRows !== undefined) ? opts.bufferRows : 2;
        this.onRangeRender = opts.onRangeRender || function(){};
        this._columns = 1;
        this._range = { start: -1, end: -1 };
        // v3.10 R1.6: the mounted nodes in index order, `_nodes[i]` being item
        // `_range.start + i` (null where renderItem returned nothing).
        this._nodes = [];
        this._spacer = null;
        this._grid = null;
        this._scrollHandler = null;
        this._scrollRafId = null;
    }

    VirtualGrid.prototype._calcColumns = function() {
        if (this.fixedColumns) {
            this._columns = this.fixedColumns;
            return;
        }
        var w = this.mountContainer.clientWidth || this.scrollContainer.clientWidth || 0;
        if (!w || !this.itemMinWidth) { this._columns = 1; return; }
        // Mirror auto-fill minmax behaviour (approximate). 16px gap allowance
        // at 100 %, scaled with the rem grid gaps (v3.10 R4).
        var gap = px(16);
        var c = Math.floor((w + gap) / (this.itemMinWidth + gap));
        this._columns = Math.max(1, c);
    };

    VirtualGrid.prototype.init = function() {
        var mount = this.mountContainer;
        mount.textContent = '';
        this._nodes = [];
        this._range = { start: -1, end: -1 };
        mount.style.position = 'relative';

        this._spacer = document.createElement('div');
        this._spacer.style.width = '100%';
        mount.appendChild(this._spacer);

        this._grid = document.createElement('div');
        if (this.gridClassName) this._grid.className = this.gridClassName;
        this._grid.style.cssText = 'position:absolute;top:0;left:0;right:0;';
        mount.appendChild(this._grid);

        this._calcColumns();
        var totalRows = Math.ceil(this.items.length / this._columns);
        this._spacer.style.height = (totalRows * this.itemHeight) + 'px';

        var self = this;
        this._scrollHandler = function() {
            // Coalesce into one rAF — Tizen's TV scroll fires aggressively.
            if (self._scrollRafId !== null) return;
            self._scrollRafId = requestAnimationFrame(function() {
                self._scrollRafId = null;
                self._updateVisibleRange(false);
            });
        };
        this.scrollContainer.addEventListener('scroll', this._scrollHandler);

        this._updateVisibleRange(true);
    };

    VirtualGrid.prototype._mountTopWithin = function() {
        // offsetTop of mountContainer relative to scrollContainer.
        var top = 0;
        var node = this.mountContainer;
        while (node && node !== this.scrollContainer) {
            top += node.offsetTop || 0;
            node = node.offsetParent;
        }
        return top;
    };

    /**
     * Mount the band for the current scroll position (or `scrollTop`, when
     * given: ensureIndexVisible passes the position it has just asked for,
     * which a smooth scroll (R1.8) has not reached yet).
     *
     * v3.10 R1.6: when the range moves, only the nodes that left are removed
     * and only those that entered are created; the rest stay mounted, so a
     * one-row step costs two rows of cards, not the whole band. Every card is
     * a compositor layer on the TV (D6 translateZ(0)), which is what made the
     * whole-band rebuild expensive there. `force` (first build, geometry or
     * content change) still rebuilds the band.
     */
    VirtualGrid.prototype._updateVisibleRange = function(force, scrollTopOverride) {
        if (!this._grid || !this.scrollContainer) return;
        var sc = this.scrollContainer;
        var scrollTop = (scrollTopOverride !== undefined) ? scrollTopOverride : sc.scrollTop;
        var viewportH = sc.clientHeight;
        var mountTop = this._mountTopWithin();

        var relTop = scrollTop - mountTop;
        var firstRow = Math.floor(relTop / this.itemHeight);
        var lastRow = Math.ceil((relTop + viewportH) / this.itemHeight);

        var totalRows = Math.ceil(this.items.length / this._columns);
        var startRow = Math.max(0, firstRow - this.bufferRows);
        var endRow = Math.min(totalRows, lastRow + this.bufferRows);

        var startIndex = startRow * this._columns;
        var endIndex = Math.min(endRow * this._columns, this.items.length);

        if (!force && startIndex === this._range.start && endIndex === this._range.end) {
            return;
        }

        var old = this._range;
        var created = [];
        if (force || Math.max(startIndex, old.start) >= Math.min(endIndex, old.end)) {
            // Nothing to keep: rebuild. V3.9 T3: the outgoing band's lazy
            // images are released from the IntersectionObserver first, or
            // every recycled card that never intersected stayed registered
            // for the session (4146–5038 live targets after one 1200-album
            // traversal). Release, not unobserve (D17): most of these cover
            // ids are re-requested by the incoming band, so cancelling their
            // in-flight loads would only restart them.
            if (typeof LazyLoader !== 'undefined' && LazyLoader.releaseWithin) {
                LazyLoader.releaseWithin(this._grid);
            }
            this._grid.textContent = '';
            this._nodes = this._build(startIndex, endIndex, created);
            this._grid.appendChild(this._fragment(this._nodes));
        } else {
            // D17, narrowed to the removed nodes (ticket §5.3 allows it):
            // release only.
            var head = this._nodes.slice(0, Math.max(0, startIndex - old.start));
            var tail = this._nodes.slice(this._nodes.length - Math.max(0, old.end - endIndex));
            this._detach(head);
            this._detach(tail);
            var kept = this._nodes.slice(head.length, this._nodes.length - tail.length);
            var before = (startIndex < old.start) ? this._build(startIndex, old.start, created) : [];
            var after = (endIndex > old.end) ? this._build(old.end, endIndex, created) : [];
            // The grid holds only item nodes, so its first child is the
            // first kept one.
            if (before.length) this._grid.insertBefore(this._fragment(before), this._grid.firstChild);
            if (after.length) this._grid.appendChild(this._fragment(after));
            this._nodes = before.concat(kept, after);
        }
        this._grid.style.transform = 'translateY(' + (startRow * this.itemHeight) + 'px)';

        // LazyLoader.observe runs on attached nodes: an IntersectionObserver
        // on a detached element never intersects.
        this._observe(created);

        this._range = { start: startIndex, end: endIndex };
        // The full ordered mounted list, every node in the document, which
        // _reapplyGridFocusAfterRecycle depends on.
        this.onRangeRender(this._nodes.slice(), startIndex, endIndex);
    };

    // Render items [from, to). Returns them in index order (null where
    // renderItem returned nothing) and pushes the real nodes onto `created`.
    VirtualGrid.prototype._build = function(from, to, created) {
        var out = [];
        for (var i = from; i < to; i++) {
            var node = this.renderItem(this.items[i], i);
            if (node) {
                node.setAttribute('data-vg-index', String(i));
                created.push(node);
            }
            out.push(node || null);
        }
        return out;
    };

    // V3.9 T6: nodes go into the document through one fragment, not one by one.
    VirtualGrid.prototype._fragment = function(nodes) {
        var frag = document.createDocumentFragment();
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i]) frag.appendChild(nodes[i]);
        }
        return frag;
    };

    VirtualGrid.prototype._detach = function(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!node) continue;
            if (typeof LazyLoader !== 'undefined' && LazyLoader.releaseWithin) {
                LazyLoader.releaseWithin(node);
            }
            if (node.parentNode) node.parentNode.removeChild(node);
        }
    };

    VirtualGrid.prototype._observe = function(nodes) {
        if (typeof LazyLoader === 'undefined') return;
        for (var e = 0; e < nodes.length; e++) {
            if (!nodes[e].querySelectorAll) continue;
            var imgs = nodes[e].querySelectorAll('img.lazy-art');
            for (var k = 0; k < imgs.length; k++) {
                LazyLoader.observe(imgs[k]);
            }
        }
    };

    /**
     * v3.10 A1: re-render the mounted items in [from, to) in place, after
     * their data changed (a page of a sparse list arrived). The rest of the
     * band is untouched. onRangeRender fires, so a screen can re-resolve a
     * focused node that was replaced.
     */
    VirtualGrid.prototype.updateItems = function(from, to) {
        if (!this._grid) return;
        var start = Math.max(from, this._range.start);
        var end = Math.min(to, this._range.end);
        if (start >= end) return;
        var created = [];
        for (var i = start; i < end; i++) {
            var oldNode = this._nodes[i - this._range.start];
            var node = this._build(i, i + 1, created)[0];
            if (oldNode && node) {
                if (typeof LazyLoader !== 'undefined' && LazyLoader.releaseWithin) {
                    LazyLoader.releaseWithin(oldNode);
                }
                this._grid.replaceChild(node, oldNode);
            } else if (oldNode) {
                this._detach([oldNode]);
            } else if (node) {
                // A null slot gaining a node: insert before the next real one.
                var next = null;
                for (var j = i - this._range.start + 1; j < this._nodes.length && !next; j++) {
                    next = this._nodes[j];
                }
                this._grid.insertBefore(node, next);
            }
            this._nodes[i - this._range.start] = node;
        }
        this._observe(created);
        this.onRangeRender(this._nodes.slice(), this._range.start, this._range.end);
    };

    /**
     * Force the visible range to include `index`. Adjusts scrollTop if the
     * index is currently outside the rendered band. Returns the rendered
     * DOM node for that index (or null if beyond items length).
     */
    VirtualGrid.prototype.ensureIndexVisible = function(index) {
        if (index < 0 || index >= this.items.length) return null;
        // Already rendered?
        if (index >= this._range.start && index < this._range.end) {
            return this._nodes[index - this._range.start];
        }
        // Scroll so that the row containing `index` is on screen.
        var row = Math.floor(index / this._columns);
        var sc = this.scrollContainer;
        var mountTop = this._mountTopWithin();
        var targetTop = mountTop + row * this.itemHeight;
        // Keep some padding — aim for a quarter of the viewport above.
        var pad = Math.floor(sc.clientHeight * 0.25);
        var newScroll = Math.max(0, targetTop - pad);
        // If row is already partly visible just nudge into bounds.
        var currentTop = sc.scrollTop - mountTop;
        var rowTop = row * this.itemHeight;
        if (rowTop < currentTop) {
            newScroll = mountTop + rowTop;
        } else if (rowTop + this.itemHeight > currentTop + sc.clientHeight) {
            newScroll = mountTop + rowTop - sc.clientHeight + this.itemHeight + px(20);
        }
        newScroll = Math.max(0, Math.min(newScroll, sc.scrollHeight - sc.clientHeight));
        // R1.8: a jump to an item outside the band is instant even with smooth
        // scrolling on. Animated, the band followed the scroll's position back
        // past the focused item (unmounting it) until the animation caught
        // up; only the in-band focus-follow (the zone's reveal) animates.
        var behavior = sc.style.scrollBehavior;
        sc.style.scrollBehavior = 'auto';
        sc.scrollTop = newScroll;
        sc.style.scrollBehavior = behavior;
        // Render synchronously so the caller can grab the node. R1.6:
        // incremental, like any other range move.
        if (this._scrollRafId !== null) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        this._updateVisibleRange(false, newScroll);
        if (index < this._range.start || index >= this._range.end) return null;
        return this._nodes[index - this._range.start];
    };

    /**
     * v3.10 R1.6/R1.7: the rendered row pitch, from the first mounted item
     * and the first one of the next row (D11: measured, not assumed), or 0
     * when fewer than two rows are mounted. Both sit in the same
     * absolutely-positioned band, so the offsetTop difference includes any
     * gap. Pass the result to refresh({ itemHeight }).
     */
    VirtualGrid.prototype.measureRowPitch = function() {
        var a = this._nodes[0];
        var b = this._nodes[this._columns];
        if (!a || !b) return 0;
        return b.offsetTop - a.offsetTop;
    };

    VirtualGrid.prototype.getColumns = function() {
        return this._columns;
    };

    VirtualGrid.prototype.getCount = function() {
        return this.items.length;
    };

    /**
     * Return the absolutely-positioned inner grid element. Callers need it to
     * read the real, CSS-resolved geometry (`grid-template-columns`, row
     * pitch) rather than trusting `_calcColumns`'s minmax approximation.
     */
    VirtualGrid.prototype.getGridElement = function() {
        return this._grid;
    };

    /**
     * Re-sync the grid after the item list has grown, or after the caller has
     * measured the real column count / row pitch from the rendered grid.
     *
     * opts (all optional): { items, columns, itemHeight }. Omitted values are
     * kept. Needed because (a) the Albums tab pages items in behind a live
     * grid via PaginatedLoader, and (b) `_calcColumns`'s fixed 16px gap
     * allowance disagrees with `.library-albums-grid`'s 20px column gap, so
     * the column count has to be corrected from the CSS after the first
     * render (V3.9 T1).
     *
     * A pure item-count change (the same array, grown) re-renders only if
     * the visible range actually moved, and then incrementally (R1.6); a
     * geometry change always rebuilds, because the inner grid's translateY
     * offset depends on `itemHeight`. v3.10: so does a different `items`
     * array — new content at the same indices (the Queue after a change, a
     * new sort).
     */
    VirtualGrid.prototype.refresh = function(opts) {
        var geomChanged = false;
        if (opts) {
            if (opts.items) {
                if (opts.items !== this.items) geomChanged = true;
                this.items = opts.items;
            }
            if (opts.columns && opts.columns !== this._columns) {
                this.fixedColumns = opts.columns;
                this._columns = opts.columns;
                geomChanged = true;
            }
            if (opts.itemHeight && opts.itemHeight !== this.itemHeight) {
                this.itemHeight = opts.itemHeight;
                geomChanged = true;
            }
        }
        if (!this._spacer || !this._grid) return;
        var totalRows = Math.ceil(this.items.length / this._columns);
        this._spacer.style.height = (totalRows * this.itemHeight) + 'px';
        this._updateVisibleRange(geomChanged);
    };

    VirtualGrid.prototype.scrollToIndex = function(index) {
        var row = Math.floor(index / this._columns);
        var mountTop = this._mountTopWithin();
        this.scrollContainer.scrollTop = mountTop + row * this.itemHeight;
    };

    VirtualGrid.prototype.destroy = function() {
        if (this._scrollHandler && this.scrollContainer) {
            this.scrollContainer.removeEventListener('scroll', this._scrollHandler);
        }
        if (this._scrollRafId !== null) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        this._scrollHandler = null;
        this._spacer = null;
        this._grid = null;
        this._nodes = [];
        this._range = { start: -1, end: -1 };
    };

    /**
     * v3.10 R1.7: a one-column VirtualGrid for a track list, with the focus
     * zone's `virtual` config on `.zoneVirtual`. The list keeps its look:
     * `mount` (already in the document) carries the list's own class, so its
     * max-width, centring and padding hold; the moving band inherits that
     * padding (`.virtual-list-band`), so each row lands where it did when
     * the list rendered every row. The row pitch is measured (D11).
     *
     * opts: { scrollContainer (positioned: VirtualGrid measures the mount's
     * offsetTop within it), mount, items, renderItem(item, index), zone
     * (focus zone name), itemHeight (estimate), onRangeRender }
     */
    function createVirtualList(opts) {
        var zone = opts.zone;
        var vg = new VirtualGrid({
            scrollContainer: opts.scrollContainer,
            mountContainer: opts.mount,
            items: opts.items,
            renderItem: opts.renderItem,
            itemHeight: opts.itemHeight || px(72),
            columns: 1,
            gridClassName: 'virtual-list-band',
            // 8 rows each side: a d-pad step mounts one row; the margin
            // keeps a held key ahead of the band.
            bufferRows: 8,
            onRangeRender: function(elements, start, end) {
                // A recycle (or updateItems) can remove the focused row:
                // re-resolve it once VirtualGrid has finished, as library.js
                // _reapplyGridFocusAfterRecycle does for the grids.
                if (FocusManager.getActiveZone() === zone) {
                    var focused = FocusManager.getCurrentFocused();
                    if (!focused || !focused.parentNode) {
                        setTimeout(function() {
                            if (FocusManager.getActiveZone() === zone) {
                                FocusManager.setActiveZone(zone, undefined, true);
                            }
                        }, 0);
                    }
                }
                if (opts.onRangeRender) opts.onRangeRender(elements, start, end);
            }
        });
        vg.init();
        var pitch = vg.measureRowPitch();
        if (pitch > 0) vg.refresh({ itemHeight: pitch });
        vg.zoneVirtual = {
            getCount: function() { return vg.getCount(); },
            getItemAt: function(idx) { return vg.ensureIndexVisible(idx); },
            // D76: room for the 1.02 row at the scroller's edge.
            reveal: function(idx, element) {
                revealInScroller(element, opts.scrollContainer, px(20));
            }
        };
        return vg;
    }

    // "30458" -> "30,458", for counts in headers.
    function formatCount(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // v3.10 A3: a list's total length, "42 min" or "1 h 7 min" ("15 h").
    function formatTotalDuration(seconds) {
        var mins = Math.round((seconds || 0) / 60);
        if (mins < 60) return mins + ' min';
        var h = Math.floor(mins / 60), m = mins % 60;
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    // --- Lyrics Parser (OpenSubsonic) ---
    // Accepts the subsonic-response object returned by SubsonicAPI._request.
    // Returns a single structuredLyrics entry (synced preferred) or null.
    function parseLyricsResponse(subResponse) {
        if (!subResponse || !subResponse.lyricsList) return null;
        var all = subResponse.lyricsList.structuredLyrics;
        if (!all) return null;
        if (!Array.isArray(all)) all = [all];
        if (!all.length) return null;
        var synced = null;
        var unsynced = null;
        for (var i = 0; i < all.length; i++) {
            var entry = all[i];
            if (!entry) continue;
            // Navidrome may return the line list under `line` (can be array or single object)
            var lines = entry.line;
            if (!lines) continue;
            if (!Array.isArray(lines)) lines = [lines];
            if (!lines.length) continue;
            var normalized = {
                lang: entry.lang || '',
                synced: !!entry.synced,
                line: lines
            };
            if (normalized.synced && !synced) synced = normalized;
            if (!normalized.synced && !unsynced) unsynced = normalized;
        }
        return synced || unsynced || null;
    }

    // --- Public API ---
    return {
        log: log,
        setDebug: setDebug,
        isDebug: isDebug,
        warn: warn,
        error: error,
        UI_SCALES: UI_SCALES,
        uiScale: uiScale,
        setUiScale: setUiScale,
        rem: rem,
        px: px,
        artSize: artSize,
        smoothScroll: smoothScroll,
        setSmoothScroll: setSmoothScroll,
        revealInScroller: revealInScroller,
        el: el,
        $: $,
        $$: $$,
        createSvg: createSvg,
        createStarSvg: createStarSvg,
        SVG_PATHS: SVG_PATHS,
        generateSalt: generateSalt,
        formatDuration: formatDuration,
        md5: md5,
        PaginatedLoader: PaginatedLoader,
        VirtualGrid: VirtualGrid,
        createVirtualList: createVirtualList,
        formatCount: formatCount,
        formatTotalDuration: formatTotalDuration,
        parseLyricsResponse: parseLyricsResponse
    };
})();

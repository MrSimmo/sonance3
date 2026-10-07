/* ============================================
   Sonance — Image Cache + Lazy Loader (V3-6)
   In-memory cover-art cache and IntersectionObserver-based
   lazy loading. The TV's HTTP cache evicts album art aggressively;
   this module holds decoded URLs in memory for the session so that
   navigating Library/Home back and forth does NOT refetch art.
   ============================================ */

/* global SonanceUtils */

var ImageCache = (function() {
    'use strict';

    var log = (typeof SonanceUtils !== 'undefined' && SonanceUtils.log)
        ? SonanceUtils.log
        : function() {};

    // V3.9 T2: entries carry the URL and a loaded flag only. They used to hold
    // the live `Image` that performed the load, which nothing ever read — its
    // only effect was pinning the decoded bitmap in memory for the whole
    // session, on top of whatever the HTTP disk cache already held.
    //
    // Insertion-ordered Map rather than an object plus an LRU key array:
    // `_touchKey` was an indexOf + splice over up to 500 keys on EVERY cache
    // hit (measured at 8020 calls scanning 3 548 368 array elements over a
    // 200-keypress grid walk). Map delete+set is O(1) and preserves the same
    // LRU order. Map is Chrome 38+, well inside the Tizen 5.0 / Chromium 63
    // envelope.
    var _cache = new Map();   // key → { url: string, loaded: boolean }

    // key → load record. `refs` counts DISPLAYING parties — callers that
    // supplied an onLoad callback, i.e. an <img> waiting for the URL — so
    // cancel() can never abort a load some other live element still needs.
    // Fire-and-forget warmers (preload, _preloadNpArt) pass no callback and
    // therefore hold no ref: a preload for a screen the user has since left is
    // exactly what cancellation is for.
    var _loading = {};

    // 500 was a desktop number. After v3.9 the largest mounted band in the app
    // is ~80 cards, so 128 covers the visible set plus a screen of history.
    var MAX_SIZE = 128;

    // V3.9 T8: the TV has ~6 connections per host and the audio stream shares
    // them. Uncapped, a fast scroll enqueued hundreds of image loads that
    // head-of-line-blocked playback (measured at 48 concurrent cover-art
    // sockets over a 200-keypress grid walk).
    var MAX_CONCURRENT = 5;
    var _inFlight = 0;
    var _queue = [];

    function _getApi() {
        // App.getApi is added in app.js — fall back to AuthManager during boot.
        if (typeof App !== 'undefined' && App.getApi) {
            var a = App.getApi();
            if (a) return a;
        }
        if (typeof AuthManager !== 'undefined' && AuthManager.getApi) {
            return AuthManager.getApi();
        }
        return null;
    }

    /** Move an existing key to the most-recently-used end. O(1). */
    function _touchKey(key) {
        var entry = _cache.get(key);
        if (entry === undefined) return;
        _cache.delete(key);
        _cache.set(key, entry);
    }

    function _put(key, url) {
        _cache.delete(key);
        _cache.set(key, { url: url, loaded: true });
        while (_cache.size > MAX_SIZE) {
            _cache.delete(_cache.keys().next().value);
        }
    }

    function _pump() {
        while (_inFlight < MAX_CONCURRENT && _queue.length) {
            var rec = _queue.shift();
            if (rec.cancelled || rec.done) continue;
            _start(rec);
        }
    }

    function _start(rec) {
        _inFlight++;
        rec.queued = false;
        var img = new Image();
        rec.img = img;
        img.onload = function() { _settle(rec, true); };
        img.onerror = function() { _settle(rec, false); };
        img.src = rec.url;
    }

    function _settle(rec, ok) {
        if (rec.done) return;
        rec.done = true;
        _inFlight--;
        delete _loading[rec.key];
        // Drop the loader reference: the bytes live in the HTTP cache and the
        // decoded bitmap is owned by whichever <img> displays the URL.
        rec.img = null;
        if (ok) _put(rec.key, rec.url);
        // On error, deliberately do not cache — allow a retry.
        var cbs = rec.callbacks;
        rec.callbacks = [];
        if (ok) {
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](rec.url); } catch (e) {}
            }
        }
        _pump();
    }

    /**
     * Get a cached image URL or trigger loading.
     * @param {string} coverArtId - Subsonic cover art ID
     * @param {number} size       - requested image pixel size
     * @param {function} onLoad   - callback(url) when ready (optional)
     * @returns {string|null}     - cached URL if already available, else null
     */
    function get(coverArtId, size, onLoad) {
        if (!coverArtId) return null;

        var key = coverArtId + '_' + size;

        // Already cached and loaded
        var entry = _cache.get(key);
        if (entry && entry.loaded) {
            _touchKey(key);
            if (onLoad) onLoad(entry.url);
            return entry.url;
        }

        // Currently queued or in flight — join it.
        var pending = _loading[key];
        if (pending) {
            if (onLoad) {
                pending.refs++;
                pending.callbacks.push(onLoad);
            }
            return null;
        }

        var api = _getApi();
        if (!api) return null;

        var rec = {
            key: key,
            url: api.getCoverArtUrl(coverArtId, size),
            callbacks: onLoad ? [onLoad] : [],
            refs: onLoad ? 1 : 0,
            queued: true,
            cancelled: false,
            done: false,
            img: null
        };
        _loading[key] = rec;
        _queue.push(rec);
        _pump();

        return null;
    }

    /**
     * V3.9 T8: drop a pending load for (coverArtId, size) when the element
     * that asked for it is going away. Refcounted, so a load another live
     * element is still waiting on is never aborted. Returns true if the load
     * was actually dropped.
     */
    function cancel(coverArtId, size) {
        if (!coverArtId) return false;
        var key = coverArtId + '_' + size;
        var rec = _loading[key];
        if (!rec || rec.done) return false;

        rec.refs--;
        if (rec.refs > 0) return false;
        rec.refs = 0;

        rec.cancelled = true;
        rec.done = true;
        rec.callbacks = [];
        delete _loading[key];

        if (rec.queued) {
            var i = _queue.indexOf(rec);
            if (i > -1) _queue.splice(i, 1);
            return true;
        }

        // In flight. Removing the attribute (rather than assigning '') aborts
        // the fetch without older Chromium re-resolving the empty string
        // against the document URL and re-requesting the page.
        if (rec.img) {
            rec.img.onload = null;
            rec.img.onerror = null;
            rec.img.removeAttribute('src');
            rec.img = null;
        }
        _inFlight--;
        _pump();
        return true;
    }

    /**
     * Preload a batch of cover art IDs. Fire and forget.
     */
    function preload(coverArtIds, size) {
        if (!coverArtIds) return;
        for (var i = 0; i < coverArtIds.length; i++) {
            if (coverArtIds[i]) get(coverArtIds[i], size, null);
        }
    }

    /**
     * Synchronous URL lookup. Returns the cached URL if available, otherwise
     * a freshly-built URL (which the browser will fetch). Does NOT trigger
     * lazy loading — use get() / LazyLoader for that.
     */
    function getUrl(coverArtId, size) {
        if (!coverArtId) return '';
        var key = coverArtId + '_' + size;
        var entry = _cache.get(key);
        if (entry && entry.loaded) {
            _touchKey(key);
            return entry.url;
        }
        var api = _getApi();
        if (!api) return '';
        return api.getCoverArtUrl(coverArtId, size);
    }

    // V3.9 T2: clear() existed but was called from nowhere. It is now wired
    // into AuthManager.logout and App.applyLibraryChange, both of which
    // invalidate every URL in here (the URLs carry the previous identity's
    // auth params, and a library change changes what the user may see).
    function clear() {
        // Abandon queued work; in-flight loads are left to settle into a cache
        // that has already been emptied, which is harmless.
        for (var k = 0; k < _queue.length; k++) _queue[k].cancelled = true;
        _queue = [];
        _cache = new Map();
        _loading = {};
        _urlCache = new Map();
        _urlLoading = {};
        log('ImageCache', 'cleared');
    }

    function size() {
        return _cache.size;
    }

    /* ============================================
       URL-keyed cache (V3-6-fix2 PERF-5)
       Some images are addressed by raw URL rather than Subsonic coverArt
       id — most notably the artist hero photo from Last.fm
       (`info.largeImageUrl`). LRU-capped sibling to the coverArt cache so
       returning to a previously-viewed artist hits the cache instantly.
       ============================================ */
    var _urlCache = new Map();   // url → { loaded: boolean }
    var _urlLoading = {};        // url → [callbacks]

    function _touchUrlKey(k) {
        var entry = _urlCache.get(k);
        if (entry === undefined) return;
        _urlCache.delete(k);
        _urlCache.set(k, entry);
    }

    function _putUrl(k) {
        _urlCache.delete(k);
        _urlCache.set(k, { loaded: true });
        while (_urlCache.size > MAX_SIZE) {
            _urlCache.delete(_urlCache.keys().next().value);
        }
    }

    /**
     * Get a cached image by raw URL or trigger loading.
     * @param {string} url      - the absolute URL of the image
     * @param {function} onLoad - callback(url) when ready (optional)
     * @returns {string|null}   - the URL if already cached, else null
     */
    function getByUrl(url, onLoad) {
        if (!url) return null;

        var entry = _urlCache.get(url);
        if (entry && entry.loaded) {
            _touchUrlKey(url);
            if (onLoad) onLoad(url);
            return url;
        }

        if (_urlLoading[url]) {
            if (onLoad) _urlLoading[url].push(onLoad);
            return null;
        }

        _urlLoading[url] = onLoad ? [onLoad] : [];
        var img = new Image();
        img.onload = function() {
            _putUrl(url);
            var cbs = _urlLoading[url] || [];
            delete _urlLoading[url];
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](url); } catch (e) {}
            }
        };
        img.onerror = function() {
            delete _urlLoading[url];
            // Don't cache errors — allow retry
        };
        img.src = url;
        return null;
    }

    return {
        get: get,
        cancel: cancel,
        preload: preload,
        getUrl: getUrl,
        getByUrl: getByUrl,
        clear: clear,
        size: size
    };
})();

/* ============================================
   LazyLoader
   IntersectionObserver-based image loader.
   Cards render with a placeholder. As they scroll into view (with a 200px
   buffer) the observer kicks off the cache fetch; when the image is ready
   the `loaded` class triggers the GPU-friendly opacity fade-in.
   ============================================ */

var LazyLoader = (function() {
    'use strict';

    var log = (typeof SonanceUtils !== 'undefined' && SonanceUtils.log)
        ? SonanceUtils.log
        : function() {};

    var _observer = null;

    // V3.9 T3: `_onIntersect` unobserved only the images that actually
    // intersected, and there was no `unobserve` on the public surface at all,
    // so every <img> torn down below the fold — tab switch, screen navigation,
    // and every VirtualGrid recycle — stayed registered with the observer for
    // the life of the session and Chromium re-tested its geometry on every
    // pass. Measured at 4146–5038 live targets after one 1200-album traversal.
    //
    // The registration count is tracked with a flag on the element rather than
    // an array: VirtualGrid observes each card's img in addition to
    // renderAlbumArt doing so, and IntersectionObserver dedupes that while an
    // array would not.
    var _observedCount = 0;

    function _onIntersect(entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry.isIntersecting) continue;
            var img = entry.target;
            _loadImage(img);
            // Release only: the load was just started, so cancelling it here
            // would defeat the whole point.
            _release(img);
        }
    }

    function _loadImage(img) {
        var coverArtId = img.getAttribute('data-coverart');
        var sizeAttr = img.getAttribute('data-size');
        var size = parseInt(sizeAttr, 10) || 300;
        if (!coverArtId) return;

        var cachedUrl = ImageCache.get(coverArtId, size, function(url) {
            // Defensive: img may have been removed by re-render
            if (!img || !img.parentNode) return;
            img.src = url;
            img.classList.add('loaded');
        });
        if (cachedUrl) {
            img.src = cachedUrl;
            img.classList.add('loaded');
        }
    }

    function _release(img) {
        if (_observer) _observer.unobserve(img);
        if (img.__sonanceObserved) {
            img.__sonanceObserved = false;
            _observedCount--;
        }
    }

    function init() {
        if (typeof IntersectionObserver === 'undefined') {
            console.warn('[Sonance][LazyLoader] IntersectionObserver not available — eager loading');
            _observer = null;
            return;
        }
        // v3.10 R4: 200px of look-ahead at 100 %, scaled with the interface
        // size so it still covers about one row of art. Read once at boot; a
        // live size change keeps the boot-time margin until the next launch.
        _observer = new IntersectionObserver(_onIntersect, {
            root: null,
            rootMargin: SonanceUtils.px(200) + 'px 0px',
            threshold: 0.01
        });
        log('LazyLoader', 'initialized');
    }

    /**
     * Register an <img> element for lazy loading.
     * The element must have data-coverart and data-size attributes set.
     */
    function observe(img) {
        if (!img) return;
        if (_observer) {
            _observer.observe(img);
            if (!img.__sonanceObserved) {
                img.__sonanceObserved = true;
                _observedCount++;
            }
        } else {
            // Fallback: load immediately (no IntersectionObserver)
            _loadImage(img);
        }
    }

    /**
     * Force-load now, regardless of viewport visibility. Used for above-the-fold
     * elements like the Now Playing bar where we never want a placeholder shown.
     */
    function forceLoad(img) {
        if (!img) return;
        if (_observer) _release(img);
        _loadImage(img);
    }

    /**
     * V3.9 T3: stop observing one image and drop any pending byte fetch it
     * started. For an element that is going away for good.
     */
    function unobserve(img) {
        if (!img) return;
        _release(img);
        var id = img.getAttribute('data-coverart');
        if (id) {
            ImageCache.cancel(id, parseInt(img.getAttribute('data-size'), 10) || 300);
        }
    }

    /**
     * Release every lazy image under `root` WITHOUT cancelling in-flight
     * loads. This is the VirtualGrid recycle path: most of the outgoing band's
     * cover ids are re-requested by the incoming band a few lines later, so
     * cancelling here would abort loads only to restart them.
     * @returns {number} how many were released
     */
    function releaseWithin(root) {
        if (!root || !root.querySelectorAll) return 0;
        var imgs = root.querySelectorAll('img.lazy-art');
        for (var i = 0; i < imgs.length; i++) _release(imgs[i]);
        return imgs.length;
    }

    /**
     * Release AND cancel every lazy image under `root`. This is the screen
     * teardown path: nothing on the outgoing screen will consume the bytes.
     * @returns {number} how many were unobserved
     */
    function unobserveWithin(root) {
        if (!root || !root.querySelectorAll) return 0;
        var imgs = root.querySelectorAll('img.lazy-art');
        for (var i = 0; i < imgs.length; i++) unobserve(imgs[i]);
        return imgs.length;
    }

    function disconnect() {
        if (_observer) _observer.disconnect();
        _observedCount = 0;
    }

    /** Live observed-target count. Diagnostic only. */
    function observedCount() {
        return _observedCount;
    }

    return {
        init: init,
        observe: observe,
        forceLoad: forceLoad,
        unobserve: unobserve,
        releaseWithin: releaseWithin,
        unobserveWithin: unobserveWithin,
        disconnect: disconnect,
        observedCount: observedCount
    };
})();

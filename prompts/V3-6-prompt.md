You are performing performance optimisation on Sonance — a music player app for Samsung Tizen TVs. This is V3-6: Image Caching, Lazy Loading, and GPU Performance.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read js/api.js — find where cover art URLs are constructed (getCoverArtUrl or similar)
4. Read js/screens/library.js — find how album/artist grids render, how images load
5. Read js/screens/home.js — find how recently added/played sections render
6. Read js/screens/artist.js — find how discography/similar artists render
7. Read css/styles.css — find all `will-change` declarations
8. Run `grep -rn 'will-change' css/styles.css js/` to count them

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client (you may ADD methods but not modify existing ones)
- `js/auth.js` — authentication manager
- `js/starred.js` — favourites cache
- `config.xml` — Tizen widget configuration and privileges

## THE PROBLEM
The Albums, Artists, and Home screens are slow and juddery on the Samsung Q90R. Three compounding causes:

1. **No image caching** — every time the user navigates to Library or back, ALL album art re-fetches from the server. The TV's Chromium 63 WebView has a limited HTTP cache and frequently evicts entries.
2. **Too many `will-change` declarations** — V3-4 added `will-change: transform` to every focusable card. With 50+ visible cards, each reserves a GPU compositing layer. The TV's GPU runs out of texture memory and falls back to CPU compositing, which is slow.
3. **All images load at once** — the grid renders 50+ `<img>` elements simultaneously, all firing HTTP requests. The TV's network stack and image decoder get overwhelmed.

## PART 1: In-Memory Image Cache

Create a cover art cache that stores decoded `Image` objects in memory. Once an album's art is loaded, it never re-fetches during the session.

### New module: js/image-cache.js

```javascript
var ImageCache = {
    _cache: {},        // coverArtId → { img: Image, url: string, loaded: boolean }
    _loading: {},      // coverArtId → [callback, callback, ...]
    _maxSize: 500,     // max cached images (prevent memory overflow)
    _keys: [],         // LRU order tracking

    /**
     * Get a cached image URL or trigger loading
     * @param {string} coverArtId - the coverArt ID from Subsonic API
     * @param {number} size - image size in px
     * @param {function} onLoad - callback(url) when image is ready
     * @returns {string|null} - cached URL if available, null if loading
     */
    get: function(coverArtId, size, onLoad) {
        if (!coverArtId) return null;

        var key = coverArtId + '_' + size;

        // Already cached and loaded
        if (this._cache[key] && this._cache[key].loaded) {
            this._touchKey(key);
            if (onLoad) onLoad(this._cache[key].url);
            return this._cache[key].url;
        }

        // Currently loading — queue the callback
        if (this._loading[key]) {
            if (onLoad) this._loading[key].push(onLoad);
            return null;
        }

        // Not cached — start loading
        this._loading[key] = onLoad ? [onLoad] : [];
        var self = this;
        var url = api.getCoverArtUrl(coverArtId, size);

        var img = new Image();
        img.onload = function() {
            self._cache[key] = { img: img, url: url, loaded: true };
            self._addKey(key);

            // Notify all waiting callbacks
            var callbacks = self._loading[key] || [];
            delete self._loading[key];
            callbacks.forEach(function(cb) { cb(url); });
        };
        img.onerror = function() {
            delete self._loading[key];
            // Don't cache errors — allow retry
        };
        img.src = url;

        return null;  // not yet available
    },

    /**
     * Preload a batch of cover art IDs (fire and forget)
     */
    preload: function(coverArtIds, size) {
        var self = this;
        coverArtIds.forEach(function(id) {
            if (id) self.get(id, size, null);
        });
    },

    /**
     * Get URL synchronously (returns placeholder if not cached)
     */
    getUrl: function(coverArtId, size) {
        if (!coverArtId) return '';
        var key = coverArtId + '_' + size;
        if (this._cache[key] && this._cache[key].loaded) {
            this._touchKey(key);
            return this._cache[key].url;
        }
        return api.getCoverArtUrl(coverArtId, size);
    },

    _touchKey: function(key) {
        var idx = this._keys.indexOf(key);
        if (idx > -1) this._keys.splice(idx, 1);
        this._keys.push(key);
    },

    _addKey: function(key) {
        this._keys.push(key);
        // Evict oldest if over max
        while (this._keys.length > this._maxSize) {
            var oldest = this._keys.shift();
            delete this._cache[oldest];
        }
    },

    clear: function() {
        this._cache = {};
        this._loading = {};
        this._keys = [];
    }
};
```

Add `<script src="js/image-cache.js"></script>` to index.html before screens.

## PART 2: Lazy Loading Images (Intersection Observer)

Only load images that are visible (or about to become visible) in the viewport. Images outside the viewport show a placeholder until they scroll into view.

### Check Intersection Observer Support

Chromium 63 supports `IntersectionObserver` (added in Chrome 51). Verify:
```javascript
var hasIntersectionObserver = typeof IntersectionObserver !== 'undefined';
```

### Lazy Image Implementation

```javascript
var LazyLoader = {
    _observer: null,

    init: function() {
        if (typeof IntersectionObserver === 'undefined') {
            // Fallback: load everything immediately
            console.warn('[Sonance][LazyLoader] IntersectionObserver not available');
            return;
        }

        this._observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    var img = entry.target;
                    var coverArtId = img.dataset.coverart;
                    var size = parseInt(img.dataset.size, 10) || 300;

                    if (coverArtId) {
                        var cachedUrl = ImageCache.get(coverArtId, size, function(url) {
                            img.src = url;
                            img.classList.add('loaded');
                        });
                        if (cachedUrl) {
                            img.src = cachedUrl;
                            img.classList.add('loaded');
                        }
                    }

                    // Stop observing once loaded
                    LazyLoader._observer.unobserve(img);
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',  // start loading 200px before visible
            threshold: 0.01
        });
    },

    observe: function(imgElement) {
        if (this._observer) {
            this._observer.observe(imgElement);
        } else {
            // Fallback: load immediately
            var coverArtId = imgElement.dataset.coverart;
            var size = parseInt(imgElement.dataset.size, 10) || 300;
            if (coverArtId) {
                imgElement.src = api.getCoverArtUrl(coverArtId, size);
            }
        }
    },

    disconnect: function() {
        if (this._observer) {
            this._observer.disconnect();
        }
    }
};
```

Call `LazyLoader.init()` once after app loads.

### Rendering Cards with Lazy Loading

When rendering album/artist cards, use `data-` attributes instead of `src`:

```javascript
function renderAlbumCard(album) {
    var card = document.createElement('div');
    card.className = 'card-item focusable';

    var img = document.createElement('img');
    img.className = 'card-art';
    img.dataset.coverart = album.coverArt || '';
    img.dataset.size = '300';
    img.alt = album.name;
    // Do NOT set img.src here — let LazyLoader handle it

    // Show placeholder initially
    img.src = '';  // or a tiny inline data URI placeholder
    img.style.background = 'rgba(255, 255, 255, 0.05)';

    card.appendChild(img);
    // ... add title, artist text

    // Register for lazy loading
    LazyLoader.observe(img);

    return card;
}
```

### Placeholder Style

```css
.card-art {
    width: 100%;
    aspect-ratio: 1;  /* WAIT — Chromium 63 doesn't support this */
    /* Use padding-bottom trick instead: */
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    object-fit: cover;
    transition: opacity 0.2s ease;  /* fade in when loaded */
    opacity: 0.3;
}

.card-art.loaded {
    opacity: 1;
    background: transparent;
}
```

The `opacity` transition gives a nice fade-in as images load. GPU-friendly.

### Image Wrapper for Aspect Ratio (Chromium 63 compatible)

Since `aspect-ratio` isn't supported, use the padding-bottom trick:
```html
<div class="card-art-wrapper">
    <img class="card-art" data-coverart="..." data-size="300" />
</div>
```
```css
.card-art-wrapper {
    position: relative;
    width: 100%;
    padding-bottom: 100%;  /* 1:1 aspect ratio */
    overflow: hidden;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
}
.card-art-wrapper .card-art {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.2s ease;
}
.card-art-wrapper .card-art.loaded {
    opacity: 1;
}
```

## PART 3: Reduce will-change Abuse

### The Problem
V3-4 added `will-change: transform` to every `.card-item`. With 50+ cards visible, each creates a separate GPU compositing layer. The TV's GPU has limited VRAM and starts thrashing.

### The Fix
Only apply `will-change` to the FOCUSED item and its immediate neighbours:

**Remove from CSS:**
```css
/* REMOVE THIS: */
.card-item {
    will-change: transform;  /* DELETE */
}
```

**Add dynamically via JS when focus changes:**
```javascript
var _lastWillChangeElements = [];

function updateWillChange(focusedElement) {
    // Remove from previous elements
    _lastWillChangeElements.forEach(function(el) {
        el.style.willChange = 'auto';
    });
    _lastWillChangeElements = [];

    if (!focusedElement) return;

    // Apply to focused element only
    focusedElement.style.willChange = 'transform';
    _lastWillChangeElements.push(focusedElement);

    // Optionally apply to adjacent siblings (left, right, up, down)
    var prev = focusedElement.previousElementSibling;
    var next = focusedElement.nextElementSibling;
    if (prev && prev.classList.contains('card-item')) {
        prev.style.willChange = 'transform';
        _lastWillChangeElements.push(prev);
    }
    if (next && next.classList.contains('card-item')) {
        next.style.willChange = 'transform';
        _lastWillChangeElements.push(next);
    }
}
```

Call `updateWillChange()` in the FocusManager's `onFocus` callback for card grids.

**Also remove `will-change` from these (if present):**
- `.track-row` — too many rows
- `.genre-card` — not needed, only a few on screen
- `.search-qa-card` — not needed
- Any element where there are more than ~10 instances visible at once

**Keep `will-change` in CSS for these (only a few instances):**
- `#top-nav-pill` — one element
- `.library-subnav-pill` — one element
- `.page-layer` — two elements
- `#now-playing-bar` — one element

## PART 4: Preload Next Screen's Images

When the user is on the Library Albums tab, preload the first batch of images immediately. Also preload when navigating the top nav — start loading the next screen's images before the transition completes.

```javascript
// When top nav focus changes (user is about to slide to a new screen):
function onNavFocusChange(screenId) {
    // Start preloading the next screen's images
    if (screenId === 'library') {
        // Preload first 20 album covers
        api.getAlbumList2('alphabeticalByName', 20, 0).then(function(albums) {
            var ids = albums.map(function(a) { return a.coverArt; }).filter(Boolean);
            ImageCache.preload(ids, 300);
        });
    } else if (screenId === 'home') {
        // Preload hero + recent albums
        api.getAlbumList2('newest', 10, 0).then(function(albums) {
            var ids = albums.map(function(a) { return a.coverArt; }).filter(Boolean);
            ImageCache.preload(ids, 300);
        });
    }
}
```

Call this when the top nav pill moves to a new item (during the slide transition).

## PART 5: Reduce DOM Size on Large Grids

For libraries with 500+ albums, even lazy loading isn't enough — the DOM itself becomes heavy with hundreds of card elements.

### Virtual Scrolling (simplified)

Instead of rendering all 500 albums at once, only render the visible rows plus a buffer:

```javascript
var VirtualGrid = {
    _container: null,
    _allItems: [],
    _renderedRange: { start: 0, end: 0 },
    _itemHeight: 220,     // approx height of one card + text
    _columns: 8,          // cards per row at 1920px
    _bufferRows: 2,       // extra rows above and below viewport

    init: function(container, items, renderFn) {
        this._container = container;
        this._allItems = items;
        this._renderFn = renderFn;

        // Set total height based on total items
        var totalRows = Math.ceil(items.length / this._columns);
        this._spacer = document.createElement('div');
        this._spacer.style.height = (totalRows * this._itemHeight) + 'px';
        container.appendChild(this._spacer);

        // Grid container for visible items
        this._grid = document.createElement('div');
        this._grid.className = 'virtual-grid';
        this._grid.style.cssText = 'position:absolute;top:0;left:0;right:0;';
        container.style.position = 'relative';
        container.appendChild(this._grid);

        // Initial render
        this._updateVisibleRange();

        // Listen for scroll
        var self = this;
        container.addEventListener('scroll', function() {
            self._updateVisibleRange();
        });
    },

    _updateVisibleRange: function() {
        var scrollTop = this._container.scrollTop;
        var viewportHeight = this._container.clientHeight;

        var firstVisibleRow = Math.floor(scrollTop / this._itemHeight);
        var lastVisibleRow = Math.ceil((scrollTop + viewportHeight) / this._itemHeight);

        var startRow = Math.max(0, firstVisibleRow - this._bufferRows);
        var endRow = Math.min(
            Math.ceil(this._allItems.length / this._columns),
            lastVisibleRow + this._bufferRows
        );

        var startIndex = startRow * this._columns;
        var endIndex = Math.min(endRow * this._columns, this._allItems.length);

        if (startIndex === this._renderedRange.start && endIndex === this._renderedRange.end) {
            return;  // No change needed
        }

        // Re-render visible items
        this._grid.innerHTML = '';
        this._grid.style.transform = 'translateY(' + (startRow * this._itemHeight) + 'px)';

        for (var i = startIndex; i < endIndex; i++) {
            var card = this._renderFn(this._allItems[i]);
            this._grid.appendChild(card);
            // Lazy load the image
            var img = card.querySelector('.card-art');
            if (img) LazyLoader.observe(img);
        }

        this._renderedRange = { start: startIndex, end: endIndex };
    },

    scrollToIndex: function(index) {
        var row = Math.floor(index / this._columns);
        this._container.scrollTop = row * this._itemHeight;
    },

    destroy: function() {
        if (this._grid) this._grid.innerHTML = '';
    }
};
```

**Use VirtualGrid for large lists only** — if the library has fewer than 80 items, render normally. Virtual scrolling adds complexity and is only needed when DOM size is the bottleneck.

```javascript
if (albums.length > 80) {
    VirtualGrid.init(container, albums, renderAlbumCard);
} else {
    // Render all directly
    albums.forEach(function(album) {
        var card = renderAlbumCard(album);
        container.appendChild(card);
        LazyLoader.observe(card.querySelector('.card-art'));
    });
}
```

## PART 6: Image Size Optimisation

Request smaller images from the server where possible:

- **Grid cards** (album art in grids): request `size=300` (150px displayed × 2 for retina-like sharpness)
- **Album detail left panel** (240px art): request `size=500`
- **Artist detail photo** (220px): request `size=500`
- **NP screen large art** (280px): request `size=600`
- **NP bar thumbnail** (48px): request `size=100`
- **Search result thumbnails**: request `size=100`

Smaller images = faster download + less memory.

Check the current `getCoverArtUrl` calls across all screens and ensure they pass an appropriate `size` parameter.

## PART 7: Throttle Scroll Events

If scroll event handlers fire too frequently, they can cause jank:

```javascript
var _scrollThrottleTimer = null;

function throttledScrollHandler(fn) {
    return function() {
        if (_scrollThrottleTimer) return;
        _scrollThrottleTimer = setTimeout(function() {
            _scrollThrottleTimer = null;
            fn();
        }, 50);  // Max 20 updates/second
    };
}

// Usage:
container.addEventListener('scroll', throttledScrollHandler(function() {
    VirtualGrid._updateVisibleRange();
}));
```

## PART 8: Script Loading

Add to `index.html` before screens:
```html
<script src="js/image-cache.js"></script>
```

Init in app.js after login:
```javascript
LazyLoader.init();
```

## HARDWARE ACCELERATION REMINDER
- Image fade-in uses `opacity` only (GPU)
- No `transition: all`
- `will-change` only on focused item + neighbours, not all items
- Virtual grid uses `transform: translateY()` for positioning (GPU)

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- No `aspect-ratio` CSS — use padding-bottom trick
- `IntersectionObserver` is available on Chromium 63 (Chrome 51+)
- LRU cache max 500 images — prevent memory overflow on the TV
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Performance (browser — compare before/after):
1. Open Network tab in browser DevTools
2. Navigate to Library Albums
3. Count HTTP requests for images — should only load visible images
4. Scroll down — new images load as they enter viewport
5. Navigate away and back — images load from cache (no new HTTP requests)
6. Check memory usage — shouldn't grow unbounded

### Performance (TV):
1. Navigate to Library Albums — page should load faster
2. Scroll through albums — smooth, no jank
3. Focus on cards — scale animation is smooth (will-change only on focused item)
4. Navigate away and back to Library — instant (cached images)
5. Home screen — recently added/played load quickly
6. Artist detail — discography images load from cache if already seen

### Functional:
- [ ] All album art displays correctly
- [ ] All artist photos display correctly
- [ ] Images fade in smoothly when loaded
- [ ] Placeholder shown before images load
- [ ] Scrolling through large libraries is smooth
- [ ] PaginatedLoader still works (loads more items on scroll)
- [ ] No broken images
- [ ] NP bar thumbnail loads correctly
- [ ] NP screen large art loads correctly
- [ ] Search result thumbnails load correctly

### Verify will-change reduction:
```bash
grep -rn 'will-change' css/styles.css
# Should only have: #top-nav-pill, .library-subnav-pill, .page-layer, #now-playing-bar
# Should NOT have: .card-item, .track-row, .genre-card
```

Update PROGRESS.md.

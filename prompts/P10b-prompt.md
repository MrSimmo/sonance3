You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P10b: Split-Pane Album Detail & Pagination.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 Constraints (NO flex `gap`, use `grid-gap`, NO `aspect-ratio`, NO optional chaining)
2. Read tickets/P10-v1.3-polish.md — do tasks P10.4 and P10.5
3. Read PROGRESS.md
4. Read js/screens/album.js carefully to understand the current layout

## TASK 1: P10.4 — Split-Pane Album Detail

The album detail screen currently scrolls the entire page including the cover art and metadata. Rewrite the layout so:

**Left panel (cover art, title, artist, metadata, Play/Shuffle):** FIXED — never scrolls
**Right panel (tracklist):** Scrolls independently

Layout structure:
```
.album-detail (flex column, height: 100%, overflow: hidden)
  .album-detail-back (flex-shrink: 0, padding)
    [← Back button]
  .album-detail-body (display: flex, flex: 1, min-height: 0, overflow: hidden)
    .album-detail-left (width: 200px, flex-shrink: 0, NO scroll)
      [cover art 180px]
      [title, artist, metadata]
      [Play button]
      [Shuffle button]
    .album-detail-right (flex: 1, overflow-y: auto, overflow-x: hidden)
      [TRACKLIST header]
      [track rows...]
```

CRITICAL CSS:
- `min-height: 0` on `.album-detail-body` — without this, flex children won't shrink below content height and the right panel won't scroll
- `overflow: hidden` on the album detail root AND on `#content-area` when album detail is active
- The right panel is the ONLY element with `overflow-y: auto`
- Use `margin-left: 48px` on the right panel (NOT `gap` — Chromium 63!)

**Scroll-into-view for focused tracks:**
When focus moves to a track that's below the visible area of `.album-detail-right`, scroll it into view.

`scrollIntoView({ behavior: 'smooth', block: 'nearest' })` may not work on Chromium 63. Use manual scroll:
```javascript
function scrollToFocused(container, element) {
    var trackTop = element.offsetTop;
    var trackBottom = trackTop + element.offsetHeight;
    var viewTop = container.scrollTop;
    var viewBottom = viewTop + container.clientHeight;
    if (trackBottom > viewBottom) {
        container.scrollTop = trackBottom - container.clientHeight + 20;
    } else if (trackTop < viewTop) {
        container.scrollTop = trackTop - 20;
    }
}
```
Call this in the FocusManager's `onFocus` callback for the tracklist zone, or in the album screen's focus handler.

**Content area overflow:**
- When album detail activates: add `.album-active` class to `#content-area` → `overflow: hidden !important`
- When album detail deactivates: remove the class

## TASK 2: P10.5 — Pagination for Library Albums

Create a reusable `PaginatedLoader` in `js/utils.js`:
```javascript
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
        console.error('[Sonance][Pagination]', err);
    });
};
PaginatedLoader.prototype.reset = function() {
    this.offset = 0;
    this.hasMore = true;
    this.loading = false;
};
```

Wire into Library Albums tab:
- Create loader: `new PaginatedLoader(function(count, offset) { return api.getAlbumList2('alphabeticalByName', count, offset); }, 50)`
- On initial load: `loader.loadNext(appendAlbumsToGrid)`
- When focus reaches within 5 items of the last loaded item: `loader.loadNext(appendAlbumsToGrid)`
- `appendAlbumsToGrid` creates new album card elements and appends them to the existing grid
- Show a small "Loading..." text at the bottom of the grid while fetching
- When `hasMore` is false, remove the loading indicator

This keeps DOM size manageable — the TV only has ~50-100 album cards in the DOM at a time until the user scrolls deep.

## RULES:
- Vanilla JS, ES2017. No ?., ??, Array.flat(), Object.fromEntries()
- **NO flex `gap`** — use margin-left, margin-top, margin-right, margin-bottom on children
- Use `grid-gap` not `gap` for grids
- No `aspect-ratio` CSS — use padding-bottom trick
- No `scrollIntoView` with options object — use manual scroll function
- Run autonomously
- Rebuild Sonance.wgt when done

Test in browser:
- Album detail: left panel stays fixed while tracklist scrolls
- Focus auto-scrolls tracklist to keep focused track visible
- Pressing Up at top of tracklist moves focus to Play/Shuffle/Back
- Library Albums: initial 50 load, scrolling near bottom loads more
- No regressions

Update PROGRESS.md.

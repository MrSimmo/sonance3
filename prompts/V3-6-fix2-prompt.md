You are doing performance work on Library → Artists in Sonance — a music player app for Samsung Tizen TVs (Q90R / Tizen 5.0 / Chromium ~63). Vanilla JS, no build step. This is the SECOND post-3.6 fix run; complete `prompts/V3-6-fix-prompt.md` first if it has not yet shipped.

## Parent prompts to read first
- `CLAUDE.md` (project rules — Tizen constraints, animation rules, protected files)
- `PROGRESS.md` (current state)
- `prompts/V3-6-prompt.md` (parent run — image cache + lazy load + virtual grid + dynamic will-change). The infrastructure introduced there is the foundation for this work.
- `prompts/V3-6-fix-prompt.md` (immediately preceding fix round — should already be merged)

## Test configuration
- Test Navidrome server: `http://192.168.0.2:4534`
- Dev server: `python3 -m http.server 8080` from project root
- Browser test all changes; **leave the dev server running at the end** so the user can manually verify on TV/local browser

## DO NOT MODIFY — protected files
- `js/player.js`
- `js/auth.js`
- `js/starred.js`
- `config.xml`
- `js/api.js` — you may ADD new methods (e.g. small helpers around existing endpoints) but NOT modify or remove existing ones

## Tizen constraints
- No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`
- No flex `gap`. Grid uses `grid-gap` (legacy, not `gap`).
- No `aspect-ratio` — padding-bottom trick.
- Animate `transform` and `opacity` only. No `transition: all`.
- IntersectionObserver IS available (Chrome 51+).
- Do not regress V3-6 — image-cache.js, lazy loader, virtual grid, dynamic `will-change`. Build on top of them.

---

## THE PROBLEM

The user reports two issues with Library → Artists, both confirmed by code reading:

**A. Slow d-pad navigation between artists.** Pressing Left/Right/Up/Down to move between artist tiles is laggy/juddery on the TV.

**B. Slow artist-detail entry.** Pressing Enter on an artist tile takes too long before the detail page is usable.

### Root causes (from code analysis)

For (A):
1. `js/screens/library.js:486-535` (`_loadArtists` / `_renderArtists`) renders ALL artists at once — no `PaginatedLoader` and no `VirtualGrid`. Albums use `PaginatedLoader`. With 100+ artists, the DOM becomes heavy.
2. `css/styles.css:2040` declares `will-change: transform` STATICALLY on `.artist-grid-card`. V3-6 added a dynamic `will-change` system in `js/focus.js:124-147` for focused + adjacent siblings only — but the static rule defeats it. Every artist card reserves a GPU layer at render time → VRAM thrash on the TV.
3. `js/focus.js:183-189` calls `scrollIntoView()` synchronously on every focus change. Combined with layout reads in `_scrollToFocused` (`offsetHeight` / `offsetWidth`), this triggers layout thrash per d-pad press.
4. Artist avatars lazy-load via `LazyLoader` but every artist card still observes the IntersectionObserver — at high counts the observer setup cost is non-trivial.

For (B):
1. `js/screens/artist.js:107-130` does `Promise.all([api.getArtist(id), api.getArtistInfo2(id)])` (good) but then the `.then()` builds the WHOLE detail page (hero, bio, discography, similar artists) before first paint. There's no progressive rendering.
2. `js/screens/artist.js:218-246` `_renderArtistPhoto` uses `info.largeImageUrl` (Last.fm) directly with no `ImageCache` warming — re-fetched on every visit.
3. Discography album cards lazy-load each cover individually; for 50+ discography albums this is many small observer/fetch interactions.

---

## FIXES

### PERF-1 — Apply PaginatedLoader to Library → Artists

**File:** `js/screens/library.js`

**Pattern to mirror:** the existing albums-tab use of `PaginatedLoader` (around `js/screens/library.js:361-363`). Read that section carefully — it's the template.

**Steps:**
1. Wrap the artists fetch behind a `PaginatedLoader` instance with page size 50 (match albums).
2. Initial load: render the first page (50 artists). Render placeholders / nothing for the remainder.
3. As the user scrolls (or as focus moves into the bottom buffer rows), call `.loadMore()` to append the next page.
4. Make sure FocusManager re-registers the artists grid zone after each page append so newly-added tiles are focusable.
5. Do NOT clear the focus index on page append — only on tab change.
6. If the project's API method is `api.getArtists()` (which returns ALL artists in one Subsonic call), keep that single fetch but render in chunks. Use `requestAnimationFrame` between chunks so the main thread stays responsive. If `getArtists` supports a `size`/`offset` (it doesn't in Subsonic spec — just `getArtists`), keep the single fetch and chunk client-side.

**Acceptance:**
- [ ] Initial Library → Artists load shows the first 50 artists quickly.
- [ ] Scrolling reveals the rest in chunks.
- [ ] No JS console errors. Focus still moves correctly across page boundaries.

### PERF-2 — Use VirtualGrid for >80 artists

**File:** `js/screens/library.js` artists rendering

**Pattern to mirror:** the V3-6 `VirtualGrid` introduced in `prompts/V3-6-prompt.md` Part 5. Verify it's wired up for Albums; replicate for Artists with the same threshold (≥80 items).

**Steps:**
1. After PERF-1, when the total artist count exceeds 80, switch from straight DOM rendering to `VirtualGrid.init(container, allArtists, renderArtistCard)`.
2. Reuse the existing `renderArtistCard` function — DO NOT inline a new copy. Pass it to `VirtualGrid` so each visible row gets the same card markup the rest of the app expects.
3. Confirm `VirtualGrid` supports the artists row height (taller than albums because of artist name placement) — adjust `_itemHeight` per-screen if needed (or accept the default if it's already correct).

**Acceptance:**
- [ ] On a library with >80 artists, only visible rows + buffer are in the DOM (verify via DevTools Elements panel — should NOT see all artists).
- [ ] Scrolling smoothly fills in rows. No flash of empty space.
- [ ] Lazy-loaded images on virtual rows still load via `LazyLoader.observe()` (which `VirtualGrid` should call after rendering — confirm).

### PERF-3 — Remove static `will-change` from `.artist-grid-card`

**File:** `css/styles.css:2040`

**Steps:**
1. Remove the `will-change: transform;` declaration from `.artist-grid-card`.
2. Run a sweep:
   ```bash
   grep -nE 'will-change' css/styles.css
   ```
   Expected results AFTER this fix (per V3-6 prompt's "keep these" list):
   - `#top-nav-pill`
   - `.library-subnav-pill`
   - `.page-layer`
   - `#now-playing-bar`
   - (any other element where there is exactly one or two instances on screen)
   Anything else (cards, rows, tiles in grids) should NOT have static `will-change`.
3. Verify the dynamic `will-change` system in `js/focus.js:124-147` runs for the artists grid zone. If it doesn't, register the artists grid with the same `_updateWillChange`-aware focus callback used for albums.

**Acceptance:**
- [ ] grep reports only the four expected static `will-change` rules.
- [ ] Focused artist card animates smoothly (scale).
- [ ] Adjacent siblings of the focused artist also pre-promote (so left/right movement is smooth).

### PERF-4 — Replace synchronous `scrollIntoView` in focus updates

**File:** `js/focus.js:183-189` and any `_scrollToFocused` helpers

**Problem:** `scrollIntoView()` triggers a full layout. For grids this is expensive on Tizen.

**Fix:**
1. Replace `scrollIntoView()` with a manual scroll that doesn't read layout properties on every keypress. Cache the scrollable container's `clientHeight` / `clientWidth` once per zone activation. Cache the focused element's `offsetTop` / `offsetLeft` if needed and update only when the layout actually changes (column width change, resize event).
2. Or: schedule the scroll inside a `requestAnimationFrame` so it runs after the focus class change has been applied, batching layout reads/writes.
3. The simplest effective change: use `container.scrollTop = targetScrollTop` directly with an arithmetic computation (`focusedRowIndex * itemHeight - visibleHeight/2`) instead of `scrollIntoView`. Only fall back to `scrollIntoView` when the row size isn't known.

**Constraints:**
- Must keep working for ALL grid zones (albums, artists, songs, genres, queue, search results, playlist tracks).
- Must not break Smooth scroll behaviour. Smooth scrolling is OK at this stage; the goal is removing per-keypress layout thrash.

**Acceptance:**
- [ ] Per-keypress focus changes on Artists are visibly smoother on Chrome DevTools Performance trace (fewer "Layout" bars per frame).
- [ ] Focus still scrolls into view correctly when moving past the visible viewport.
- [ ] No regression on other grids — sample at least Albums + Songs + Queue.

### PERF-5 — Cache the artist hero photo

**File:** `js/screens/artist.js:218-246` — `_renderArtistPhoto`

**Steps:**
1. Whenever `info.largeImageUrl` (or whatever Last.fm URL is being used) is non-empty, route it through a small in-memory cache keyed by URL — sibling to `ImageCache`. Add to `js/image-cache.js` (or co-located helper):
   ```js
   ImageCache.getByUrl = function(url, onLoad) { /* ... */ };
   ```
   (LRU like `ImageCache.get`, but keyed by raw URL since these are not Subsonic coverArt IDs.)
2. On detail load, if `getByUrl` returns a cached URL synchronously, set `img.src` immediately. Otherwise set on the `onLoad` callback.
3. Optionally: when the user is hovering on an artist tile in the grid (focus change events), pre-warm the `getArtistInfo2` request so when they press Enter the data is already loading. Use a 200–300 ms debounce so quick scrolling doesn't fire 50 requests. **Do not implement this if the API is rate-limited or it complicates retries** — keep it gated behind a clearly named helper.

**Acceptance:**
- [ ] Returning to a previously-viewed artist shows the hero photo instantly (no re-fetch).
- [ ] Network tab confirms hero URL is fetched once per session per artist.
- [ ] Optional pre-warm: focus an artist tile → wait 300 ms → Enter → detail page renders faster than baseline. (If you skipped pre-warm, document why in PROGRESS.md.)

### PERF-6 — Progressive render of artist detail

**File:** `js/screens/artist.js:107-215`

**Steps:**
1. Split `_renderArtist` into stages:
   - Stage 1 (immediate, on `getArtist` resolve): render hero, name, action buttons (Play / Shuffle), and stub containers for bio + discography + similar.
   - Stage 2 (on `getArtistInfo2` resolve): fill bio + similar artists.
   - Stage 3 (after Stage 1, deferred via `requestAnimationFrame`): render discography rows. Lazy-load images via existing `LazyLoader`.
2. Make sure focus lands on the Play button (or whatever the default focus is) as soon as Stage 1 renders. Subsequent stages must NOT steal focus.

**Acceptance:**
- [ ] Time-to-interactive on the artist detail page is visibly faster (manual timing OK; ideally use Chrome Performance).
- [ ] No flash of incorrect/empty content (placeholders are styled, not blank).
- [ ] Focus on Play button is reliable.

---

## RULES
- Vanilla JS, ES2017. No `?.`, no `??`, no `Array.flat()`.
- `transform` and `opacity` only for animations. No `transition: all`.
- No flex `gap`. Use `grid-gap` for grid.
- Build on V3-6 infrastructure (`ImageCache`, `LazyLoader`, `VirtualGrid`, `PaginatedLoader`). Do NOT replace them.
- Run autonomously. Test in browser. Use the test config above.
- After all changes pass, **rebuild `Sonance.wgt` via `./build.sh`** and **leave `python3 -m http.server 8080` running** so the user can manually inspect on localhost:8080 and on the TV.
- Update `PROGRESS.md` at the end with: what shipped, what was tested, before/after timings, any deviations.

## TESTING

Functional (browser):
- [ ] Library → Artists loads
- [ ] All artists are reachable via d-pad (paginate as needed)
- [ ] Enter on artist → detail loads
- [ ] Hero photo, bio, discography all eventually render
- [ ] Play All / Shuffle All from artist detail still work
- [ ] Returning to an already-viewed artist is faster than first visit

Performance (browser DevTools Performance + Network panels):
- [ ] Initial Artists tab paint includes only the first 50 artist tiles in the DOM
- [ ] Scrolling reveals more tiles (lazy / virtual)
- [ ] Focus movement on Artists shows fewer layout/paint bars per keystroke than baseline (record a 10-second trace before and after)
- [ ] grep `will-change` in css/styles.css reports only allowlisted selectors
- [ ] Re-entering a previously-viewed artist re-uses cached image data (Network panel shows no image re-fetch)

Sanity (no regressions):
- [ ] Library → Albums still works (PaginatedLoader + VirtualGrid intact)
- [ ] Library → Songs still works
- [ ] Library → Genres still works
- [ ] Home screen still works
- [ ] Now Playing still works (post V3-6-fix changes intact)
- [ ] Search still works (post V3-6-fix changes intact)

End state:
- [ ] `./build.sh` produced a fresh `Sonance.wgt`
- [ ] `python3 -m http.server 8080` is running and printed in the final message
- [ ] PROGRESS.md updated with timing notes

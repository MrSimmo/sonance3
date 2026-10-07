You are doing the fourth post-3.6 fix run on Sonance — a music player app for Samsung Tizen TVs (Q90R / Tizen 5.0 / Chromium ~63). Vanilla JS, no build step. **Single goal:** make the Now Playing screen open noticeably faster. Other v3.6 work is out of scope.

Complete `prompts/V3-6-fix3-prompt.md` first if it has not yet shipped.

## Parent prompts to read first
- `CLAUDE.md` (project rules — Tizen constraints, animation rules, protected files)
- `PROGRESS.md` (current state)
- `prompts/V3-6-prompt.md` (parent v3.6 ticket — image cache, lazy load, virtual grid, focus restoration)
- `prompts/V3-6-fix-prompt.md` (first post-3.6 fix)
- `prompts/V3-6-fix2-prompt.md` (Library → Artists perf — ImageCache.getByUrl pattern, progressive render pattern)
- `prompts/V3-6-fix3-prompt.md` (immediately preceding fix — should already be merged)
- `prompts/P14b-add synced lyrics-prompt.md` (introduced lyrics fetching on Now Playing — primary perf suspect)

## Test configuration
- Test Navidrome server: `http://192.168.0.2:4534`
- Dev server: `python3 -m http.server 8080` from project root
- Browser test all changes; **leave the dev server running at the end** so the user can manually verify on TV/local browser
- Take a Chrome DevTools Performance trace of "open Now Playing" before any change to capture a baseline. Save as `np-trace-before.json` (or screenshot the timeline). Repeat after each major fix.

## DO NOT MODIFY — protected files
- `js/player.js`
- `js/auth.js`
- `js/starred.js`
- `config.xml`
- `js/api.js` — you may ADD new methods (e.g. small helpers around existing endpoints) but NOT modify or remove existing ones

## Tizen constraints
- No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`
- Animate `transform` and `opacity` only. No `transition: all`. No `backdrop-filter`.
- Do not regress any prior V3-6-* work, especially the lyrics feature (P14b) — lyrics must still appear when toggled on, just not block the open animation.

---

## THE PROBLEM

The Now Playing screen takes longer to open than other screens. The user perceives a stutter / wait between pressing Enter (or hitting the NP nav pill) and the screen being usable. Other screens feel instant by comparison.

### Suspects ranked by impact (from code analysis)

1. **Lyrics fetch on activate** — `js/screens/nowplaying.js:370` (`activate()` calls `_ensureLyricsForTrack`). `_ensureLyricsForTrack` (lines 483-527) hits `api.getLyricsBySongId(songId)` synchronously at the start of every screen open. The fetch is async, but it fires during activation and blocks subsequent zone registration / interactive readiness when the response is slow. **50-70% of perceived slowness.**
2. **LyricsScroller layout reads** — `js/screens/nowplaying.js:135-147`. Reads `offsetTop` / `offsetHeight` / `clientHeight` repeatedly on init and on every progress tick (~250 ms while playing).
3. **Heavy synchronous render** — `js/screens/nowplaying.js:205-357` builds 40+ DOM elements + event listeners every time the screen mounts; no template caching. Includes lyrics panel DOM even if lyrics are off.
4. **Static `will-change` + mask-image** — `css/styles.css:3213` (`.np-left { will-change: transform }`), `:3249-3250` (`.np-lyrics-panel`), `:3274` (`.np-lyrics-lines`), and `:3269-3270` (`mask-image`/`-webkit-mask-image` on lyrics wrapper). Permanent GPU layer reservations + a mask-image evaluated at paint time (mask-image is NOT GPU-accelerated on Chromium 63).
5. **Focus zone re-registration** — `js/screens/nowplaying.js:391-430` and the call at line 552 re-register zones whenever lyrics UI updates, re-querying the DOM each time.
6. **Background blur filter** — `css/styles.css:3355` `filter: blur(60px)` on the background image. Re-evaluated at paint time. Image set via `ImageCache.getUrl(track.coverArt || track.albumId, 100)` at line 631 of nowplaying.js.

(Suspect 1 is the dominant one. If it goes away, the screen will likely feel fast even before tackling the others. Tackle in order; stop after each and re-measure — you may be done after PERF-1.)

---

## PERF-1 — Defer lyrics fetch until user interaction or idle time

**File:** `js/screens/nowplaying.js`

**Goal:** Lyrics must NOT fetch as part of the screen-open critical path. The screen must be visible, focused, and interactive before any lyrics-related network work begins.

**Steps.**
1. In `activate()` (around line 370), remove the direct call to `_ensureLyricsForTrack`. Replace with one of:
   - **Lazy fetch:** Only call `_ensureLyricsForTrack` when (a) the user actually toggles lyrics on, OR (b) the lyrics panel is already visible because the user previously enabled it AND we're idle. For (b), wrap the call in `requestIdleCallback(fn, { timeout: 1500 })` (with a `setTimeout` polyfill fallback for Chromium 63 if `requestIdleCallback` is unavailable — it landed in Chrome 47 so it should exist, but verify).
   - **Background fetch:** If you choose to keep fetching unconditionally (e.g. because the user has lyrics-on by default), still wrap the call in `requestIdleCallback` / `setTimeout(..., 0)` so it runs AFTER the screen is painted, focus is set, and the user can interact.
2. The on-demand path (user toggles lyrics ON when there's no cached data) must still fetch. Confirm this code path still works.
3. Cache lyrics per `songId` in a small in-memory map within nowplaying.js (or a module-level `LyricsCache`). Subsequent visits to the same song skip the fetch entirely.
4. If the lyrics fetch is in flight when the user navigates away, cancel/ignore the response (track an `_active` / abort flag). Avoid setting state on a deactivated screen.

**Acceptance:**
- [ ] Performance trace: cold open of Now Playing on a song with lyrics shows NO `getLyricsBySongId` request in the critical path. The request (if it fires at all) appears AFTER first interactive paint.
- [ ] If the user has lyrics ON and there's a cache hit, lyrics appear within ~50 ms of the screen open.
- [ ] If the user has lyrics ON and it's a cache miss, lyrics appear after a brief delay but the screen itself is interactive within ~100 ms of open.
- [ ] If the user has lyrics OFF, no lyrics fetch ever fires.
- [ ] Toggling lyrics ON manually still works and triggers a fetch on demand.

---

## PERF-2 — Cache LyricsScroller wrapper dimensions; remove per-tick layout reads

**File:** `js/screens/nowplaying.js:135-147` (and any callers)

**Steps.**
1. In `LyricsScroller`, capture `this._wrapper.clientHeight` once at scroller init (or whenever the lyrics panel actually becomes visible / resizes). Store on `this._wrapperHeight`.
2. Replace `this._wrapper.clientHeight` reads in `_scrollToActive` with the cached value.
3. Cache each line element's `offsetTop` and `offsetHeight` once after lyrics render (build a `_lineOffsets[]` array). Reads against `lineEl.offsetTop` per scroll-to-active become array lookups.
4. Listen for window `resize` to invalidate the caches; lazily recompute on next access.
5. Wrap the scroll itself in `requestAnimationFrame` to batch with paint.

**Acceptance:**
- [ ] Performance trace during playback (with lyrics visible) shows fewer "Recalculate Style" / "Layout" bars per progress tick.
- [ ] Scroll-to-active behaviour visually unchanged.
- [ ] Resizing the browser window still re-aligns lyrics (cache invalidates).

---

## PERF-3 — Defer lyrics-panel DOM construction

**File:** `js/screens/nowplaying.js:205-357` (`render()`), particularly around lines 348-353 where the lyrics panel structure is created.

**Steps.**
1. Do not build the lyrics panel DOM inside the synchronous `render()` path. Either:
   - (a) Build a placeholder/sentinel div and replace it with the real panel on the first lyrics-toggle ON, OR
   - (b) Move the panel construction into a `requestAnimationFrame` callback after `render()` returns.
2. Make sure focus zone registration doesn't reference lyrics-panel elements that don't yet exist. Re-register the lyrics zone (if any) once the panel is in the DOM.
3. Do NOT re-build the panel every time it toggles — once built, just hide/show it.

**Acceptance:**
- [ ] Cold open shows fewer DOM nodes created in the synchronous `render()` block (DevTools Coverage / Performance panel).
- [ ] Toggling lyrics ON still works on first toggle and subsequent toggles.
- [ ] No flash of empty space when the panel first appears.

---

## PERF-4 — Remove static `will-change` from `.np-*` selectors; promote on demand

**Files:** `css/styles.css:3213, 3249-3250, 3274`, plus `js/screens/nowplaying.js` for the dynamic activation.

**Steps.**
1. Remove `will-change: transform` from `.np-left` (line 3213).
2. Remove `will-change: transform, opacity` from `.np-lyrics-panel` (line 3249-3250).
3. Remove `will-change: transform` from `.np-lyrics-lines` (line 3274).
4. Apply `will-change` dynamically in JS only during the panel transition (toggle on before opening the lyrics panel, remove on transition end). Mirror the dynamic pattern from `js/focus.js:124-147`.
5. After this fix, run:
   ```bash
   grep -nE 'will-change' css/styles.css
   ```
   The output should show only the V3-6-fix2 PERF-3 allowlist (`#top-nav-pill`, `.library-subnav-pill`, `.page-layer`, `#now-playing-bar`).

**Acceptance:**
- [ ] grep result matches the V3-6-fix2 allowlist.
- [ ] Lyrics-panel toggle animation still smooth.
- [ ] Now Playing slide / zoom-in transition unchanged.

---

## PERF-5 — Eliminate or downscale the lyrics-wrapper `mask-image`

**File:** `css/styles.css:3269-3270`

**Steps.**
1. The `mask-image` (and `-webkit-mask-image`) on the lyrics wrapper provides a top/bottom fade. On Chromium 63 this is evaluated on CPU.
2. Replace the mask with two CSS-only `::before` / `::after` pseudo-elements that use `background: linear-gradient` to fade the top and bottom edges. These are purely paint-only and do not block compositing.
3. Confirm the visual fade matches the previous mask (semi-aggressive fade over ~30-40 px on both ends).

**Acceptance:**
- [ ] Lyrics top/bottom fade visually unchanged.
- [ ] Performance trace shows no remaining `mask-image` paint cost on the lyrics wrapper.
- [ ] No new fixed-size assumptions that break at different viewport heights (1080 only is fine, but the fade should adapt to lyrics-panel height changes).

---

## PERF-6 — Cache the progress-bar width; remove per-tick `getBoundingClientRect`

**File:** `js/screens/nowplaying.js:648`

**Steps.**
1. `_updateProgress` calls `_progressBar.getBoundingClientRect().width` on every tick. Cache once at activate / after a window resize / after the screen layout settles.
2. Use the cached value for percentage → pixel conversion.

**Acceptance:**
- [ ] Performance trace during playback shows fewer layout reads per progress tick.
- [ ] Progress bar visually tracks playback at 60fps.
- [ ] Resizing the window still re-aligns the progress bar (cache invalidates).

---

## PERF-7 (optional, only if PERF-1..6 don't get the screen feeling instant) — Skip / downgrade the background blur

**File:** `css/styles.css:3355` (and `js/screens/nowplaying.js:624-638`).

**Steps.**
1. Try `filter: blur(40px)` instead of `60px` (cheaper paint).
2. If that's still slow, replace the live blur with a pre-blurred canvas image generated once per track from the 100-px cover art. Cache the result by `albumId` in a small in-memory store. This is more code but fully removes the live `filter: blur` from the render path.
3. Only do this if the perceived open time after PERF-1..6 is still bad. Measure first.

**Acceptance:**
- [ ] If implemented: NP open paint time drops further on Tizen TV (user-confirmed).
- [ ] If skipped: PROGRESS.md notes the measurement and explains why it was skipped.

---

## RULES
- Vanilla JS, ES2017. No `?.`, no `??`, no `Array.flat()`.
- `transform` and `opacity` only for animations. No `transition: all`.
- Build on V3-6 / V3-6-fix / V3-6-fix2 / V3-6-fix3 infrastructure. Do NOT replace `ImageCache`, `LazyLoader`, etc.
- Measure before and after. Save Performance traces or numbers.
- Run autonomously. Use the test config above.
- After all changes pass, **rebuild `Sonance.wgt` via `./build.sh`** and **leave `python3 -m http.server 8080` running** so the user can manually inspect on localhost:8080 and on the TV.
- Update `PROGRESS.md` with: what shipped, before/after timings (cold and warm), what was skipped and why, any deviations.

## TESTING

Functional (browser):
- [ ] Now Playing opens from the top nav (cold)
- [ ] Now Playing opens from the persistent NP bar (warm)
- [ ] Auto-open NP on track start still works (V3-5-fix2 behaviour)
- [ ] Lyrics ON: lyrics appear (instant from cache, deferred from network)
- [ ] Lyrics OFF: no fetch, panel stays hidden
- [ ] Toggling lyrics ON for the first time on a track still fetches and displays
- [ ] Progress bar tracks playback smoothly
- [ ] Background image / blur appears (or its pre-blurred replacement)
- [ ] Transport controls (prev / play / next / seek) all work
- [ ] Back from NP returns to the previous screen with focus restored

Performance (browser DevTools Performance + Network panels):
- [ ] Cold open of NP: time-to-interactive measurably faster than baseline (record before/after).
- [ ] No `getLyricsBySongId` in the open critical path.
- [ ] Per-tick layout reads reduced (fewer Layout bars per second during playback).
- [ ] grep `will-change` matches V3-6-fix2 allowlist.

Regression sanity:
- [ ] Library, Search, Queue, Settings all unchanged
- [ ] V3-6-fix3 NAV / GFX fixes still in effect
- [ ] No console errors

End state:
- [ ] `./build.sh` produced a fresh `Sonance.wgt`
- [ ] `python3 -m http.server 8080` running
- [ ] PROGRESS.md updated with timing notes

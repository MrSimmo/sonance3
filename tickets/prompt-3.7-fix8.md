# Prompt 3.7-fix8 — Item 2.1: Cache top-nav pill rects

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Stop calling `getBoundingClientRect()` on every top-nav focus change. Pre-compute the per-item rects once on render and on `window.resize`; reuse the cache for subsequent pill moves.

## Context

- `js/app.js:571-572` — `_updatePillPosition()` calls `item.getBoundingClientRect()` and `bar.getBoundingClientRect()` on every focus change in the top nav.
- The top-nav layout is fixed once the app shell is laid out; rects only change on `window.resize`.
- A similar precedent exists in `js/screens/nowplaying.js` for `_progressBarWidth`.

## Task

1. Add module-level `_navItemRects = null` and `_navBarLeft = 0` in `js/app.js`.
2. Implement `_measureNavRects()`:
   - Iterates the rendered nav items, stores `{ left, width }` per index.
   - Caches `bar.getBoundingClientRect().left` once.
3. Call `_measureNavRects()` once after the top nav is rendered (find the existing render path) and once on every `window.resize` event (debounce ≥ 100 ms).
4. Modify `_updatePillPosition(index, animated)` to compute the pill `transform: translateX(...)` from `_navItemRects[index]` and `_navBarLeft`, with no DOM reads.
5. Invalidate `_navItemRects = null` whenever the top-nav content is re-rendered (e.g. login/logout flow).

## Constraints

- Do not change the pill animation timing or transform value.
- Do not change the DOM structure of the top-nav.
- Use a debounced resize listener (single setTimeout cleared on each resize).

## Acceptance criteria

- D-pad Left/Right across the top nav triggers zero `getBoundingClientRect` calls per press (verify with temporary instrumentation).
- Pill still moves smoothly and lands exactly on each item.
- Resize events (browser only) re-measure correctly.
- Browser Smoke Test passes.

## Out of scope

- Other `getBoundingClientRect` callsites (each addressed by other prompts).

## Verification

1. Add `var _grbc = 0; var _orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function(){ _grbc++; return _orig.apply(this, arguments); };` in DevTools.
2. Press Left/Right across the top nav 20 times; confirm `_grbc` does not grow per press (only on resize).
3. Resize the browser window; confirm pill still aligns.
4. Browser Smoke Test from ticket-3.7.md.

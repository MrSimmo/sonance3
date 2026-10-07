# Prompt 3.7-fix15 — Item 2.8: Cache album-detail progress-bar rect

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Mirror the NP-screen progress-bar caching pattern (`_progressBarWidth`) for the Album-detail mini progress bar so click/seek interactions don't read `getBoundingClientRect()` per event.

## Context

- `js/screens/album.js:355-360` — progress-bar click handler reads `getBoundingClientRect()` on every click.
- `js/screens/nowplaying.js:531` — already caches `_progressBarWidth` once on activate, invalidated on resize.

## Task

1. Add module-level `_progressBarRect = null` in `js/screens/album.js`.
2. Implement `_measureProgressBar()`: reads `getBoundingClientRect()` once on the album-detail progress bar element and stores the rect.
3. Call `_measureProgressBar()` after the album DOM is rendered (end of `_renderAlbum`) and on `window.resize` (debounced ≥ 100 ms; share the resize listener with NP if convenient).
4. Modify the click handler to compute the seek ratio from the cached rect rather than calling `getBoundingClientRect` per click.
5. Invalidate `_progressBarRect = null` on `deactivate()`.

## Constraints

- Do not change the visual appearance or hit area of the bar.
- Maintain identical seek precision.

## Acceptance criteria

- Clicking the album-detail progress bar produces the same playback position jump as before.
- Repeated clicks trigger zero `getBoundingClientRect` calls on the bar element after the initial measurement (verify with temporary instrumentation).
- Resizing the browser still produces correct seeks.
- Browser Smoke Test passes.

## Out of scope

- Visual changes to the progress bar.
- NP-screen progress bar (already cached).

## Verification

1. Patch `Element.prototype.getBoundingClientRect` to count calls (see `prompt-3.7-fix8.md`'s verify section); click the album-detail progress bar 10 times; confirm count grew by zero (only by initial measurement).
2. Click various positions and verify the resulting playback position matches the click ratio.
3. Browser Smoke Test from ticket-3.7.md.

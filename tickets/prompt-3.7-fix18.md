# Prompt 3.7-fix18 — Item 2.11: Coordinate image-preload response cache

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Have the screen-image-preload path share the same cached response as `SubsonicAPI._cachedRequest`, so a preload that fires within the cache TTL costs zero network round-trips.

## Context

- `js/app.js:771-798` — `_preloadScreenImages(screenId)` is throttled to 1 / second per screen.
- `js/app.js:918` — called on every nav focus change.
- The throttle prevents network spam, but the inner `getAlbumList2` (and similar) calls inside the preload routine still hit the network unless the result is already in `_cachedRequest`'s in-memory map.
- After `prompt-3.7-fix6.md` lands, `_cachedRequest` also has a localStorage fallback.

## Task

1. Audit each branch in `_preloadScreenImages` to confirm every fetch goes through `api.getX()` methods (which already use `_cachedRequest`). If any branch fetches direct (e.g. `fetch(...)`), route it through the API class instead.
2. Add a per-screen "preload completion" marker in `js/app.js`:
   - `_preloadDone = {}` (map of `screenId → timestamp`).
   - On successful preload, set `_preloadDone[screenId] = Date.now()`.
   - At the start of `_preloadScreenImages(screenId)`, if `Date.now() - _preloadDone[screenId] < 5*60*1000`, return early.
3. Replace any extra throttles or duplicate guards that target the same purpose; keep just the 5-min completion gate plus the API-cache.
4. Make sure `_preloadDone` is reset when the user logs out (find the existing logout flow).

## Constraints

- Do not change the visible preloading effect (cards flash less because images warm up before navigation).
- Do not change cover-art URLs or the `ImageCache` behaviour.

## Acceptance criteria

- Rapid nav left/right across the top nav 5 times within 5 seconds triggers at most one preload per screen.
- DevTools Network tab shows zero duplicate `getAlbumList2.view` calls in that window.
- Browser Smoke Test passes.

## Out of scope

- Changing `ImageCache` itself.
- Pre-fetching cover-art binaries.

## Verification

1. Open DevTools Network; clear; rapidly press nav Left/Right between Home and Library 10 times.
2. Filter by `getAlbumList2`; confirm the unique-request count is small (≤ 2, not per nav).
3. Browser Smoke Test from ticket-3.7.md.

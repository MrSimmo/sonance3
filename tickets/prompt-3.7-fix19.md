# Prompt 3.7-fix19 — Item 2.12: NP cover — mutate `<img src>` instead of rebuild

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

On the Now Playing screen, swap the cover image by mutating an existing `<img>` element's `src` (and dimensions, if needed) instead of clearing the container and rebuilding the DOM.

## Context

- `js/screens/nowplaying.js:826-846` — current code does `_artImg.textContent = ''` then re-renders the cover container.
- `_artImg` should be one persistent `<img>` whose `src` changes on track change.
- `js/image-cache.js` (`ImageCache.getByUrl`) provides warm-cache hits for previously-seen URLs.

## Task

1. Refactor the NP cover render so the `<img>` element is created once at activate-time and stored in `_artImg`.
2. On track change, call `_artImg.src = newCoverUrl` directly (do not clear/rebuild).
3. If `ImageCache.getByUrl(newCoverUrl)` has a warm hit, set the data-URL or blob URL straight onto `_artImg.src`. Otherwise set the remote URL and let the browser fetch.
4. Add `decoding="async"` and (browser-only) `loading="lazy"` attributes to the image once on creation.
5. Ensure the placeholder / fallback (if cover is missing) is also mutated in place — e.g. swap a single class rather than rebuilding.
6. On `deactivate()`, optionally `_artImg.src = ''` to release the bitmap (verify this doesn't trigger a flash on re-activate).

## Constraints

- Do not change the visible art size, position, or fade animation timing.
- Do not change the placeholder visual when art is unavailable.
- The cover container's other children (badges, captions, etc.) must not be removed by the new path.

## Acceptance criteria

- Track change on the NP screen does not produce a brief blank cover frame in the common case.
- DevTools Performance trace on track change shows no `Element.removeChild` / `Element.appendChild` storm in the cover container.
- Cached covers paint instantly.
- Browser Smoke Test passes.

## Out of scope

- Cover-art prefetching of upcoming queue items.
- Crossfade animations between covers (current behaviour preserved).

## Verification

1. Open NP, skip through 5 tracks; observe no flash.
2. DevTools Elements: pin `_artImg` and watch — only `src` should change between skips.
3. Browser Smoke Test from ticket-3.7.md.

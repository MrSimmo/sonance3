# Prompt 3.7-fix11 — Item 2.4: Memoise per-item formatted strings

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

When the API response is normalised into the in-memory model, attach pre-formatted strings (`_formattedDuration`, `_metaString`, `_gradient`) once. Subsequent renders read the precomputed field instead of recomputing per row.

## Context

- `js/screens/library.js:756-760` — `formatDuration(song.duration)` called per song row in the songs tab.
- `js/screens/library.js:836-844` — album metadata string `[year, ' · ', trackCount, ...]` joined per album.
- `js/screens/album.js:213-219` — same metadata pattern per album.
- `js/screens/playlists.js:119-125` — `SonanceComponents.hashColor(playlist.name)` called per render to compute a gradient.
- `formatDuration` is defined in `js/utils.js`. It is pure given immutable input.

## Task

1. Identify the data-loading callsite for each list (e.g. inside the `then(...)` of `api.getSongs`, `api.getAlbumList2`, `api.getPlaylists`). Add a normalisation pass that mutates each item:
   - `song._formattedDuration = SonanceUtils.formatDuration(song.duration)`
   - `album._metaString = <existing join expression>`
   - `playlist._gradient = SonanceComponents.hashColor(playlist.name)`
2. Modify the render code paths to read `item._formattedDuration` (etc.) directly. Fall back to recomputing only if the field is missing (defensive).
3. Add the same normalisation to anywhere a partial fetch returns the same items (e.g. cache hits via `_cachedRequest`) so the field is always present after first computation. If the cached path returns the already-normalised object, no re-work is needed.
4. Where an item appears on multiple screens, make sure all its consumers prefer the pre-computed field.

## Constraints

- Do not move `formatDuration` or `hashColor` themselves; just call them at load instead of at render.
- Do not change the visible string format.
- Do not introduce circular references; precomputed fields should be primitive strings only.

## Acceptance criteria

- Long song lists (≥100 songs) render with `formatDuration` called at most once per song over the screen's lifetime, regardless of focus / re-render churn.
- Album cards show identical metadata strings.
- Playlist gradients are stable across re-renders.
- Browser Smoke Test passes.

## Out of scope

- Memoising remote-fetched cover-art URLs (those are already URL-cached via `ImageCache`).
- Pre-computing search-result snippets.

## Verification

1. Add a temporary `console.count('formatDuration')` inside `SonanceUtils.formatDuration` (just for verification; remove before commit).
2. Visit Library → Songs with a 200-song library; arrow through to scroll; check the count grew by exactly 200 (one per song), not per scroll event.
3. Pre-and-post: confirm visible strings are identical.
4. Browser Smoke Test from ticket-3.7.md.

# Ticket 3.8 — Multi-Library Support

## Version & scope

V3.8 adds support for Navidrome's multi-library feature (server v0.58+). The
user can multi-select which libraries Sonance pulls from via Settings; the
selection persists across launches and is honoured by every content surface
(Home, Library tabs, Playlists, Queue, Search, starred / random surfaces).
When the selection changes, all media caches and the play queue are cleared
and the user is told so via hint text in Settings. No other UI, layout,
animation, or feature changes are introduced in v3.8.

## Background

Navidrome v0.58 introduced multiple-music-library support: an admin can
define several music folders, regular users can be granted per-library
access, and the server filters by user permissions automatically.

The Subsonic API exposes this via `getMusicFolders.view` plus an optional
`musicFolderId` query parameter on a subset of endpoints. The parameter is
**single-valued** in the spec — selecting N libraries requires N parallel
calls and a client-side merge.

Sonance v3.7 has no concept of multiple libraries: every API call is
unscoped, all results render globally, and the cache is keyed by
`(endpoint, params, username, serverUrl)` only.

## Goals

- New "Libraries" section in Settings allowing multi-select of libraries
  the user has access to on the connected Navidrome server.
- Selection persists across app close/reopen.
- Every API surface that fetches a list of media is scoped to the
  selected libraries: Home recents/newest/playlists, Library
  Albums/Artists/Songs/Genres, Playlists (track filter), Queue (cleared
  on change), Search results + quick-access tiles, Starred (favourites).
- Library change side-effects: stop playback, clear queue, clear API
  caches (in-memory + localStorage tier), clear StarredCache, force user
  back to Home, then re-load fresh data.
- Hint text in Settings explains that changing the selection will clear
  caches and the play queue.
- Servers reporting only one library hide the section entirely — no
  visible feature change for single-library users.

## Non-goals

- No changes to UI design, animations, focus model, or transitions.
- No changes to playback engine, AVPlay lifecycle, or gapless prefetch.
- No new screens.
- No changes to the login flow or auth model.
- No per-library favourite/star scoping (favourites are global per user
  on the server; we don't add an extra layer).
- No background re-sync on library change beyond the immediate cache
  clear and Home re-load.
- No CSS layout-property transitions added (transform/opacity only —
  current rule). No `transition: all`.

## Constraints

- **Tizen 5.0 / Chromium ~63.** ES2017 only. No optional chaining (`?.`),
  no nullish coalescing (`??`), no `Object.fromEntries`, no `Array.flat`,
  no top-level `await`, no `BigInt`.
- **CSS:** No `backdrop-filter`. No `gap` on flex (child margins only).
  Legacy `grid-gap` on grid. Transform/opacity-only animation. Never
  `transition: all`.
- **Audio:** AVPlay is the only TV playback path; HTML5 `<audio>` is the
  browser fallback. Do not change AVPlay lifecycle.
- **Network:** App may only contact the configured `sonance_server_url`.
- **Workflow:** Update `PROGRESS.md` with what was completed, what was
  tested, and any deferred follow-ups.

## Behaviour spec

### Library discovery

On Settings activation, call `getMusicFolders()` once. Returns
`[{id, name}]`. Navidrome already filters this list by the logged-in
user's permissions, so no extra access logic is needed.

If the response contains **fewer than 2** libraries, the Libraries
section is not rendered in Settings. The rest of the app behaves as
v3.7 (no `musicFolderId` ever passed).

### Persistence

- New localStorage key: `sonance_selected_libraries` — JSON-encoded array
  of library IDs (strings, matching what `getMusicFolders` returns).
- Default value (key missing or `null`): treated as **all libraries** —
  no `musicFolderId` is sent on any request.
- Clear-on-logout: removed alongside the other `sonance_*` auth keys.
- The value is mirrored into `AuthManager._creds.selectedLibraries` at
  module init, matching the v3.7-fix14 read-cache pattern.

### "All libraries" semantics

- A selection equal in length to (and containing every member of)
  `getMusicFolders()` is internally normalised to `null` (= "all"). This
  ensures the cheap unfiltered path is taken when the user has every
  library checked.
- A selection of exactly 1 ID passes that ID directly via `musicFolderId`.
- A selection of 2..N-1 IDs triggers fan-out + merge in the API layer
  (see "API contract" below).

### API contract

Every scopable API method accepts an optional `libraryIds` argument
(array of IDs, or `null`/`undefined` for "all"):

- `getMusicFolders()` — new method.
- `getAlbumList2(type, size, offset, libraryIds)`
- `getArtists(libraryIds)`
- `getSongsByGenre(genre, count, offset, libraryIds)`
- `getRandomSongs(size, libraryIds)`
- `search3(query, params, libraryIds)`
- `getStarred2(libraryIds)`

Internal behaviour:

- `null` / empty / "all" → call once with no `musicFolderId`.
- 1 element → single call with `musicFolderId=<id>`.
- 2..N-1 elements → `Promise.all` per library, then merge. Merge rules
  per method:
  - **List endpoints (`getAlbumList2`, `getArtists`, `getStarred2`,
    `search3`)** — concatenate, dedupe by item `id`, sort by the same
    field the server would have used (`name` for alphabetical, `created`
    for newest, `played` for recent, etc.). Take the first `size` results.
  - **`getSongsByGenre`, `getRandomSongs`** — concatenate up to `size`
    total items from across libraries, preserving server order.

For the alphabetical Albums tab paginated path, the simplest reliable
approach is: when `libraryIds.length >= 2`, fetch per-library with the
same `(type, size, offset)` and merge. Imperfect at page boundaries on
very large mixed libraries, but acceptable for v3.8. Document this
caveat in `PROGRESS.md` if it surfaces during browser testing.

### Per-screen behaviour

| Screen / surface | Behaviour |
|---|---|
| Home — Newest / Recent rows | Pass `libraryIds` to `getAlbumList2`. |
| Home — Playlists row | Unchanged at fetch (`getPlaylists` is global). |
| Library — Albums | Pass `libraryIds` to paginated `getAlbumList2('alphabeticalByName', …)`. |
| Library — Artists | Pass `libraryIds` to `getArtists`. |
| Library — Songs | Same as Albums (the screen iterates `album.song`). |
| Library — Genres list | `getGenres()` unchanged (no `musicFolderId` support). |
| Library — Genres → genre detail | Pass `libraryIds` to `getSongsByGenre`. |
| Search — quick access (newest/frequent/random/starred) | Pass `libraryIds` to `getAlbumList2` and `getStarred2`. |
| Search — query results | Pass `libraryIds` to `search3`. |
| Playlists — grid | `getPlaylists()` unchanged (global). |
| Playlists — detail view | After `getPlaylist(id)`, filter `entry[]` to entries whose `musicFolderId` is in the selected set. If a track lacks a `musicFolderId` field on the response, leave it visible (defensive default — never silently hide content for missing metadata). |
| Queue | No fetch; queue itself is cleared on library change. |
| Now Playing | No fetch; lyrics endpoint is per-song-id and unaffected. |
| Album detail / Artist detail | No fetch change (item-scoped). |
| StarredCache | Loaded via `getStarred2(libraryIds)` on app start and after a library change. |

### Library-change side-effects

When the user toggles a checkbox in the Settings → Libraries section:

1. Validate the candidate selection (must contain ≥1 id; the last checked
   row's checkbox is non-interactive when it would empty the selection).
2. Persist the new array (or `null` if all-selected) via
   `AuthManager.setSelectedLibraries(newIds)`.
3. `Player.stop()` then `Player.clearQueue()` (release AVPlay if active).
4. Clear `SubsonicAPI._cache` (in-memory) and call
   `SubsonicAPI.clearLocalCache(username, serverUrl)` (LS tier).
5. `StarredCache.clear()` then trigger an async `StarredCache.load(api)`
   so favourites repopulate scoped to the new selection.
6. Emit a `libraries-changed` event on a central bus (or call back into
   `App`).
7. `App.navigateTo('home')` so the user lands on a freshly-fetched Home.

The Settings screen **does not** show a confirmation modal — the hint
text under the checkbox list always reads:

> "Changing your library selection will clear cached data and your current play queue."

### Settings UI

A new section labelled **"Libraries"** between **Server** and **Appearance**.
Layout matches the existing `.settings-toggle-row` pattern but with one
focusable row per library carrying a checkbox state:

- Row content: `[checkbox icon] [library name]`
- Row class: `.settings-library-row.focusable`
- Click / Enter toggles the checkbox.
- Disabled visual state for the row representing the "last checked" library
  while it is the only one checked (`.is-locked`, no scale on focus).
- Hint text below the list: see "Library-change side-effects" above.
- Focus zone: registered alongside the existing `settings-actions` zone;
  Down from accent swatches enters the Libraries list, Down from the last
  library row enters the Playback / Account area.

For visual rules: scale-on-focus matches the existing toggle-row pattern
(no border/outline), checked state shown by a filled accent square in the
checkbox slot; unchecked is a hollow rounded square. CSS animates only
`transform` and `opacity`; checkbox fill change is instant (no transition).

### Cache-bust + version label

- `index.html` cache-bust querystring: bump `?v=v3-7` → `?v=v3-8`.
- Settings → About section: bump version label to **V3.8**.

## Acceptance criteria

1. With a Navidrome server reporting ≥2 libraries, a "Libraries" section
   appears in Settings between Server and Appearance, listing every
   library returned by `getMusicFolders()`.
2. Default selection on first run after upgrade is **all libraries
   selected** (stored as `null`); the user sees no behaviour change vs.
   v3.7 until they uncheck a library.
3. Toggling a library's checkbox: persists the new selection, stops
   playback, clears the queue, clears API + Starred caches, returns the
   user to Home, and Home re-fetches with the new scope.
4. With **only one** library checked, every list endpoint
   (`getAlbumList2`, `getArtists`, `getSongsByGenre`, `getRandomSongs`,
   `search3`, `getStarred2`) sends `musicFolderId=<id>`.
5. With **all libraries** checked, no `musicFolderId` is sent.
6. With **2..N-1** libraries checked, each list endpoint fans out per
   library, deduplicates by `id`, and merges into the requested page size.
7. Playlist detail filters `entry[]` to tracks whose `musicFolderId` is
   in the selected set; tracks lacking the field stay visible.
8. The user cannot deselect the last checked library — the checkbox is
   non-interactive in that state.
9. On a server reporting **exactly 1** library, the Libraries section is
   hidden, no `musicFolderId` is ever sent, and v3.7 behaviour is preserved.
10. Hint text "Changing your library selection will clear cached data and
    your current play queue." is visible under the Libraries list.
11. Logging out clears `sonance_selected_libraries`.
12. `index.html` cache-bust is `?v=v3-8`; About section shows V3.8.
13. No console errors during the Browser Smoke Test (see ticket-3.7.md).
14. No `?.`, `??`, `Object.fromEntries`, `Array.flat`, `BigInt` introduced
    in any committed JS source.

## Browser Smoke Test (extension of ticket-3.7's)

In addition to the canonical Browser Smoke Test in `ticket-3.7.md`,
verify the following against the test Navidrome at `http://192.168.0.2:4534`:

1. With the test server (one library), confirm the Libraries section is
   hidden in Settings.
2. (Manual fixture) On a server with ≥2 libraries:
   - Open Settings → Libraries; uncheck one library.
   - Confirm: queue cleared, navigated to Home, Home rows refresh, and
     the unchecked library's content is absent from Library Albums and
     Search results.
   - Re-check the library; confirm content reappears after re-fetch.
   - Try to uncheck the last remaining checked library; confirm the
     checkbox does not toggle.
3. Confirm Playlists detail filters tracks when the playlist contains
   tracks from multiple libraries.
4. Confirm logging out and back in restores the persisted selection
   (when re-logging-in to the same user).

## Open questions

- **Multi-library pagination at boundaries.** The simple
  per-library-then-merge approach can produce slight ordering glitches at
  page boundaries when N libraries are very large. Acceptable for v3.8;
  flag in `PROGRESS.md` if observed in testing and address in a follow-up
  prompt (`prompt-3.8-fixN.md`) if needed.
- **Multi-library test server.** The dev test server at `192.168.0.2:4534`
  is single-library, so the multi-library code paths are exercised against
  a stand-in (mocked `getMusicFolders` response or a second test server)
  during browser testing. Document the chosen approach in `PROGRESS.md`.

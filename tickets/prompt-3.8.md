# Prompt 3.8 — Multi-Library Support: full implementation

**Parent ticket:** `tickets/ticket-3.8.md` — read it first for the full v3.8
scope, behaviour spec, constraints, and acceptance criteria. The executor
must read the ticket before starting; this prompt assumes that context.

## Objective

Implement v3.8 multi-library support end-to-end in a single session: API
threading, persistent selection, Settings UI, per-screen call-site updates,
library-change side-effects, and verification.

## Context

- Sonance v3.7 has no library awareness. `js/api.js` SubsonicAPI methods
  send only their documented params; `getMusicFolders.view` is in the LS
  cache allowlist (~line 25) but no method calls it.
- Auth state lives in `AuthManager._creds` (mirrored from `localStorage`
  keys `sonance_server_url`, `sonance_username`, `sonance_password`,
  `sonance_logged_in`); `clearLocalCache(username, serverUrl)` is a
  static method on `SubsonicAPI` already wired into `AuthManager.logout()`.
- Caches: `SubsonicAPI._cache` (in-memory, 5-min TTL), localStorage
  allowlist tier (24h TTL on `getArtists`, `getGenres`, `getPlaylists`,
  `getMusicFolders`, alphabetical `getAlbumList2`).
- `Player` queue lives in `state.queue` / `state.originalQueue`; not
  persisted; `Player.stop()` exists; queue mutators include `addToQueue`,
  `addToQueueNext`, `playAlbum(tracks, startIndex)`. Add a public
  `Player.clearQueue()` if not already exposed.
- `StarredCache` exposes `load(api)`, `clear()`, and per-id getters.
- Settings screen sections in order today: Server, Appearance, Playback,
  Account; About panel pinned right. Existing toggle-row pattern at
  `js/screens/settings.js` lines 81-91.
- `index.html` cache-bust currently `?v=v3-7`.
- Bundled mode: `index.html` may currently be in `--dev` (unbundled) mode
  per the most recent `PROGRESS.md` entry. Re-run `./build.sh` after the
  source edits to rebuild bundles, then re-run the smoke test in bundled
  mode.

## Task

Implement in roughly this order. Verify each step compiles + loads in the
browser before moving on; commit working state between major steps.

### 1. API: `getMusicFolders` + library-aware threading

In `js/api.js`:

1. Add method `getMusicFolders()` that hits `getMusicFolders.view` and
   returns `response.musicFolders.musicFolder` (an array of `{id, name}`).
   Empty array on missing/empty.
2. Add an internal helper `_normaliseLibraryIds(libraryIds, allLibraryIds)`
   that returns:
   - `null` if `libraryIds` is null/undefined/empty.
   - `null` if `libraryIds.length === allLibraryIds.length` and every id
     is present (treat as "all").
   - The de-duped array otherwise.
   - The helper does **not** itself fetch `getMusicFolders` — pass the
     "all" list in from the caller (Settings is the only place that
     needs the comparison; the API layer just trusts what's passed).
3. Add an optional `libraryIds` arg (final position) to:
   - `getAlbumList2(type, size, offset, libraryIds)`
   - `getArtists(libraryIds)`
   - `getSongsByGenre(genre, count, offset, libraryIds)`
   - `getRandomSongs(size, libraryIds)`
   - `search3(query, params, libraryIds)`
   - `getStarred2(libraryIds)`
4. Each scoped method's behaviour:
   - `null` / undefined / empty array → existing behaviour, no
     `musicFolderId` parameter.
   - `[singleId]` → existing path with `musicFolderId=singleId`.
   - `[id1, id2, …]` → `Promise.all` per id, then merge:
     - List endpoints: concatenate, dedupe by item `id`, sort by the
       canonical sort key (`name` for alphabetical types, `created` desc
       for newest, `played` desc for recent / frequent), then slice to
       the requested `size`.
     - `search3`: merge per-section (artist / album / song), dedupe per
       section by `id`, no extra sort (server returns relevance order).
     - `getSongsByGenre` / `getRandomSongs`: concatenate; cap at `count`
       / `size`; preserve server order across the per-library batches.
5. **Cache keys must already differ** (different params produce different
   keys). The new `musicFolderId` param naturally namespaces results.
   Confirm by inspection — no key-format change required.
6. Add `musicFolderId` (or its absence) into the LS cache key path. The
   existing `_lsKey` builder already serialises params; verify the new
   param flows through unchanged.
7. Add a public `SubsonicAPI.prototype.clearMemoryCache()` method that
   resets `this._cache = {}`. Used by the library-change orchestrator.

### 2. Auth: persistent selection

In `js/auth.js`:

1. Add `KEYS.SELECTED_LIBRARIES = 'sonance_selected_libraries'`.
2. Extend `_creds` init to read and JSON-parse the value (with try/catch;
   on parse error or missing key, default to `null`).
3. Add `getSelectedLibraries()` — returns the parsed array or `null`.
4. Add `setSelectedLibraries(ids)` — accepts an array or `null`. Persists
   via `_safeSet`; mirrors into `_creds`. Removes the key when `ids` is
   `null` or empty (treat empty/null identically — both mean "all").
5. In `logout()`, remove `KEYS.SELECTED_LIBRARIES` along with the other
   keys; clear the in-memory mirror.

### 3. App-level orchestrator + event

In `js/app.js`:

1. Add a tiny event bus or extend any existing one (`App.on(name, fn)` /
   `App.emit(name, payload)` — keep ES2017-compatible).
2. Add `App.applyLibraryChange(newIds)`:
   - `Player.stop()`.
   - `Player.clearQueue()` (add this method to `js/player.js` if absent;
     it must zero `state.queue`, `state.originalQueue`, `state.queueIndex`
     and emit a `queuechange` event so the Queue screen redraws).
   - Get the SubsonicAPI instance via `AuthManager.getApi()`. Call
     `api.clearMemoryCache()` and `SubsonicAPI.clearLocalCache(username,
     serverUrl)`.
   - `StarredCache.clear()` then `StarredCache.load(api)` (fire-and-forget).
   - `AuthManager.setSelectedLibraries(newIds)`.
   - `App.emit('libraries-changed')`.
   - `App.navigateTo('home')` — forces fresh fetches because Home
     re-runs its activate path.
3. Bump `index.html` cache-bust querystring `?v=v3-7` → `?v=v3-8`.

### 4. Settings UI

In `js/screens/settings.js`:

1. On `activate`, call `api.getMusicFolders()` (await before render).
2. If the result has fewer than 2 entries, do not render the Libraries
   section. Return.
3. Otherwise, build a new section between Server and Appearance:
   - Heading: "Libraries".
   - One `.settings-library-row.focusable` per library, structured as
     `[checkbox] [library name]`. Class `.is-checked` reflects state.
     Class `.is-locked` is added to the only-remaining-checked row when
     the candidate selection would otherwise drop to zero (the row's
     click/Enter handler early-returns in that state).
   - Hint paragraph below the rows reading exactly:
     "Changing your library selection will clear cached data and your
     current play queue."
4. On Enter / click of a library row:
   - Compute the candidate selection. If unchecking would empty the
     selection, no-op.
   - Build the normalised value: if the candidate equals the full set
     of library IDs, set `null` (= "all"); otherwise keep the array.
   - Call `App.applyLibraryChange(candidate)`.
5. Focus zone: register a new `settings-libraries` zone (vertical
   columns=1, neighbours: Up → accent swatches' zone, Down →
   `settings-actions`). Update neighbour links on the existing zones
   accordingly.
6. CSS: add the rules for `.settings-library-row`,
   `.settings-library-row.is-checked .settings-library-checkbox`, and
   `.settings-library-row.is-locked` to `css/styles.css`. Animate only
   `transform` (focus scale) and `opacity` (locked state). No
   `transition: all`. No `gap` on flex containers — child margin only.
7. About section: bump version label to **V3.8**.

### 5. Per-screen call-site updates

Read selected libraries via `AuthManager.getSelectedLibraries()` at the
top of each screen's `activate` (or wherever the API call is made).
Pass through to API:

- `js/screens/home.js` — `getAlbumList2('newest', 6, 0, libraryIds)` and
  `getAlbumList2('recent', 6, 0, libraryIds)`. `getPlaylists()` unchanged.
- `js/screens/library.js`:
  - Albums tab `PaginatedLoader` factory must include `libraryIds` in
    its fetch closure.
  - Artists tab — pass `libraryIds` to `getArtists`.
  - Songs tab — same pattern as Albums.
  - Genres tab — `getGenres()` unchanged. On genre click,
    `getSongsByGenre(genre, 50, 0, libraryIds)`.
- `js/screens/search.js` — `getAlbumList2(type, 10, 0, libraryIds)` for
  QA tiles, `getStarred2(libraryIds)` for the Starred QA, `search3(query,
  params, libraryIds)` for live search.
- `js/screens/playlists.js`:
  - Grid: `getPlaylists()` unchanged.
  - Detail: after `getPlaylist(id)`, filter `playlist.entry` to entries
    whose `musicFolderId` is in `libraryIds` (when `libraryIds` is `null`
    skip filtering). If an entry has no `musicFolderId` field, keep it.
- `js/screens/queue.js` — no fetch change; relies on the queue being
  cleared by `applyLibraryChange`.
- `js/screens/album.js`, `artist.js`, `nowplaying.js` — no changes; item
  detail lookups are unaffected.

### 6. StarredCache

In `js/starred.js`:

- `load(api)` already calls `api.getStarred2()`. Update to read
  `AuthManager.getSelectedLibraries()` and pass through:
  `api.getStarred2(libraryIds)`. Keep the function signature
  `load(api)` — the auth lookup happens inside.

### 7. Build + verify

1. Run `./build.sh` to rebundle `js/sonance-core.min.js` and
   `js/sonance-screens.min.js`.
2. `grep -nE '\?\.|\?\?' js/sonance-core.min.js js/sonance-screens.min.js`
   must return zero hits.
3. Run `python3 -m http.server 8080` from project root.
4. Complete the v3.7 Browser Smoke Test (see `tickets/ticket-3.7.md`)
   plus the v3.8 multi-library checks (see `tickets/ticket-3.8.md`'s
   "Browser Smoke Test (extension)").
5. The dev test server (`http://192.168.0.2:4534`) is single-library;
   exercise the multi-library code paths via a temporary stub: in
   DevTools, override `SubsonicAPI.prototype.getMusicFolders` to return
   a synthetic two-entry array, and override the merge endpoints'
   per-library responses to disjoint sets, then verify Settings UI,
   library-toggle side-effects, and per-screen filtering. Document the
   exact stub used in `PROGRESS.md`.
6. Update `PROGRESS.md` with what was completed, what was tested, and
   any deferred items (especially any pagination-at-boundaries
   observations from the multi-library merge path).

## Constraints

- ES2017 only. No `?.`, `??`, `Object.fromEntries`, `Array.flat`,
  top-level `await`, `BigInt`. Verify with `grep` after build (step 7.2).
- CSS: no `backdrop-filter`, no `gap` on flex containers, legacy
  `grid-gap` on grids. Animate only `transform` + `opacity`. No
  `transition: all`.
- AVPlay lifecycle untouched. `Player.stop()` is the existing hook.
- Network: only the configured `sonance_server_url`. No CDNs, no externs.
- "All libraries selected" is represented internally and on disk as
  `null` (or absent localStorage key) — never as the full array. This
  guarantees the cheap unfiltered path is used and avoids stale-list
  drift if the server gains a new library.
- The `null` ⇄ array ⇄ single-id semantics live entirely inside
  `js/api.js` and the Settings → `App.applyLibraryChange` boundary.
  Screens just pass the array through.
- Do not modify `tickets/ticket-3.7.md`, the existing v3.7 fix prompts,
  or any source file unrelated to the multi-library feature.

## Acceptance criteria

1-14: as enumerated in `tickets/ticket-3.8.md` § "Acceptance criteria".

## Out of scope

- Background re-sync of caches on library change beyond the immediate clear.
- Per-library favourites or per-library queues.
- Visual / focus / animation changes outside the new Settings → Libraries
  rows and the version label bump.
- CSS minification, SW changes, source-map publishing.
- Optimised pagination across multiple libraries at very large scale —
  follow up with `prompt-3.8-fixN.md` if needed.

## Verification

Run all of:

1. `./build.sh` clean rebuild succeeds.
2. `grep -nE '\?\.|\?\?' js/sonance-core.min.js js/sonance-screens.min.js`
   → zero hits.
3. v3.7 Browser Smoke Test passes against `http://192.168.0.2:4534` with
   no console errors.
4. v3.8 multi-library Browser Smoke Test (synthetic 2-library stub)
   passes per `tickets/ticket-3.8.md`.
5. Logout/login round-trip clears and restores the selection correctly.
6. `Sonance3.wgt` rebuilt and inspectable via `unzip -l Sonance3.wgt`.
7. `PROGRESS.md` appended with V3.8 entry.

# Prompt 3.8-fix1 — Cross-page dedupe for multi-library Albums tab

**Parent ticket:** `tickets/ticket-3.8.md` — read it first. This
prompt assumes the v3.8 multi-library implementation as recorded
in `PROGRESS.md` § "V3.8 — Multi-library support (2026-04-29)".

## Objective

Fix the v3.8 deferred caveat *"Multi-library pagination at
boundaries"* by adding cross-page id dedupe to the Library →
Albums paginated loader, so that an album surfaced via more than
one library (or via per-library offset overlap during merge)
cannot appear on more than one merged page. Keep the
single-library and all-libraries paths unchanged.

## Context

Files involved:

- `js/screens/library.js` `_loadAlbums(api)` — currently captures
  `libraryIds` once and passes `(count, offset)` straight through
  to `api.getAlbumList2('alphabeticalByName', count, offset,
  libraryIds)`. The wrapper closure is the only thing that needs
  to change.
- `js/utils.js` `PaginatedLoader` (l. 294-322) — sets
  `self.hasMore = items.length >= self.pageSize` after each fetch,
  so any wrapper that returns fewer items than requested will
  prematurely terminate pagination. Do **not** modify
  `PaginatedLoader`.
- `js/api.js` `SubsonicAPI.prototype.getAlbumList2` (l. 402-427)
  — already fans out per library, dedupes within a single page
  via `_dedupeById`, sorts via `_sortAlbums`, slices to `size`.
  Do **not** modify.
- `js/api.js` `_normaliseLibraryIds` (l. 257-282) — collapses
  full-set or empty selections to `null`. The wrapper relies on
  the caller (Settings) having already normalised, which v3.8
  already does. Inside `_loadAlbums` it is safe to treat
  `libraryIds && libraryIds.length >= 2` as the multi-library
  trigger; v3.8 ensures `libraryIds` is either `null`, a single-id
  array, or a 2..N-1 array — never the full set as an array.
- `PROGRESS.md` § "V3.8 — Multi-library support (2026-04-29)" §
  "Deferred / known caveats" — bullet 1 ("Multi-library
  pagination at boundaries") becomes the basis for the V3.8-fix1
  PROGRESS entry; bullet 2 ("Settings library list re-fetch on
  activate") is **not** a defect (see "Task" step 3) and gets
  removed.

Bundled mode: `index.html` is on `?v=v3-8`. **Do not bump the
cache-bust querystring**; this is a fix on the v3.8 line, not a
new version. The build script's `CACHE_BUST="v3-8"` stays as-is.
The bundles must, however, be rebuilt — bundle contents change.

## Task

### 1. Modify `js/screens/library.js` `_loadAlbums`

Replace the existing factory body so that the multi-library case
takes a wrapped fetch path with cross-page dedupe and an
internally-managed upstream cursor. Approximate target shape:

```js
function _loadAlbums(api) {
    var expected = _activeTab;
    var libraryIds = AuthManager.getSelectedLibraries();
    var multi = libraryIds && libraryIds.length >= 2;
    var seenIds = multi ? {} : null;
    var apiOffset = 0;
    var apiExhausted = false;
    var pageSize = 50;

    function fetchPage(count, loaderOffset) {
        if (!multi) {
            return api.getAlbumList2(
                'alphabeticalByName', count, loaderOffset, libraryIds
            );
        }
        // V3.8-fix1: refill from upstream until `count` fresh items
        // have been collected or upstream is exhausted, since merged
        // pages can contain ids already surfaced on a prior page.
        var collected = [];
        function step() {
            if (apiExhausted || collected.length >= count) {
                return Promise.resolve(collected.slice(0, count));
            }
            return api.getAlbumList2(
                'alphabeticalByName', count, apiOffset, libraryIds
            ).then(function(albums) {
                apiOffset += count;
                if (!albums.length) {
                    apiExhausted = true;
                    return collected;
                }
                if (albums.length < count) apiExhausted = true;
                for (var i = 0; i < albums.length; i++) {
                    var a = albums[i];
                    var id = a && a.id;
                    if (id === undefined || id === null) {
                        collected.push(a);
                        continue;
                    }
                    if (seenIds[id]) continue;
                    seenIds[id] = true;
                    collected.push(a);
                }
                return step();
            });
        }
        return step();
    }

    _albumLoader = new SonanceUtils.PaginatedLoader(fetchPage, pageSize);
    _albumLoader.loadNext(function(albums, hasMore) {
        // Existing body unchanged — stale-tab check, render, zone register.
    });
}
```

Behavioural rules:

- The single-library and all-libraries paths must be identical to
  v3.8 — no extra promise wrapping, no extra dedupe map, no extra
  closure state. `multi === false` short-circuits to the v3.8
  call shape.
- `seenIds`, `apiOffset`, `apiExhausted` live in the
  `_loadAlbums` closure and reset every time the user re-enters
  the Albums tab (which already calls `_loadAlbums(api)` afresh).
- `loaderOffset` is intentionally ignored on the multi path — the
  wrapper owns the upstream cursor. `PaginatedLoader.offset` will
  still advance based on the deduped count returned, which is
  what we want for `hasMore` semantics.
- Return short on the very last page: when upstream genuinely
  has fewer than `count` items left, `apiExhausted` flips and the
  wrapper returns whatever it has. `PaginatedLoader.hasMore` then
  correctly evaluates to false.

### 2. Do NOT change

- `js/api.js` — leave `getAlbumList2`, `_mergeAlbumLists`,
  `_dedupeById`, `_normaliseLibraryIds` alone.
- `js/utils.js` `PaginatedLoader` — leave alone.
- `js/screens/settings.js` — leave alone. The Item 2 bullet is
  removed from PROGRESS.md only (step 3); no code change.
- `index.html` cache-bust querystring — stays at `?v=v3-8`.
- `build.sh` `CACHE_BUST` — stays at `"v3-8"`.
- All other screens, all other library tabs (Artists / Songs /
  Genres), the Settings screen, the player, auth, starred cache.

### 3. PROGRESS.md update

Append a new section under the V3.8 entry (after "Files
changed" / "Build") titled:

```
### V3.8-fix1 — Multi-library Albums pagination dedupe (<today's date>)
```

Document:

- Scope: cross-page dedupe in the Library → Albums paginated
  loader for the multi-library (2..N-1) case. Single- and
  all-library paths unchanged.
- Files changed: `js/screens/library.js` only.
- What was tested (per "Verification" below).
- A note that **Item 2 of v3.8's "Deferred / known caveats"
  ("Settings library list re-fetch on activate") has been
  re-classified as not-a-defect** because `getMusicFolders.view`
  is in `LS_ALLOWLIST` (`js/api.js` l. 21-25) with the standard
  24h TTL, so re-entries are served from localStorage. Remove
  that bullet from the v3.8 "Deferred / known caveats" list to
  reflect the re-classification. (Edit the existing v3.8 section
  in place; do not delete the V3.8 entry.)

## Constraints

- ES2017 only. No `?.`, `??`, `Object.fromEntries`, `Array.flat`,
  top-level `await`, `BigInt`. Verify in source and after build
  with `grep -nE '\?\.|\?\?' js/sonance-core.min.js
  js/sonance-screens.min.js`.
- CSS: no changes expected. If any are made, `transform` /
  `opacity` only. No `transition: all`. No `gap` on flex
  containers. Legacy `grid-gap` on grids.
- AVPlay lifecycle untouched.
- Network: only the configured `sonance_server_url`.
- Do not modify `tickets/ticket-3.8.md`, `tickets/prompt-3.8.md`,
  or any v3.7 ticket / prompt files.
- Do not bump the cache-bust querystring or the V3.8 version
  label in Settings → About.

## Acceptance criteria

1. Fresh entry to Library → Albums with `libraryIds = null` (all
   libraries) makes a single `getAlbumList2` call per page (no
   wrapping, no extra promise hop). Inspection of the network
   panel must show one request per page.
2. Fresh entry with `libraryIds = ['1']` (single library) is
   byte-identical at the network level to (1) except the request
   carries `musicFolderId=1`. Wrapper does not engage.
3. Fresh entry with `libraryIds = ['1', '2']` (multi):
   - Each merged page returned by the loader contains zero
     duplicate ids vs. any earlier page in the same session.
   - `hasMore` correctly stays true while upstream has more
     items, and flips to false only when at least one library
     returns a partial / empty page from the merge fan-out.
   - Pagination still terminates (no infinite refill loop on a
     server that legitimately returns all-duplicate pages — if
     `albums.length` is non-zero but every id is already in
     `seenIds`, `apiExhausted` must still flip on the next
     short / empty upstream page so the loader can finish).
4. Returning to Library → Albums (after navigating away and back)
   resets the dedupe state — `seenIds` is empty on re-entry, so
   pages render normally. (This already happens because
   `_loadAlbums` is called fresh; just verify.)
5. Library → Artists, Library → Songs, Library → Genres are
   unchanged.
6. Settings → Libraries multi-select still works exactly as in
   v3.8 (toggle library, queue clears, navigate Home, Home
   refetches with new scope).
7. `grep -nE '\?\.|\?\?' js/sonance-core.min.js
   js/sonance-screens.min.js` returns zero hits after the
   rebuild.
8. `Sonance3.wgt` rebuilt; bundle bytes change but version label
   in Settings → About is still **V3.8**, and the cache-bust on
   `index.html` is still `?v=v3-8`.
9. `PROGRESS.md` has the new V3.8-fix1 section, and the v3.8
   "Deferred / known caveats" list no longer mentions the
   Settings re-fetch (Item 2). The Multi-library pagination
   bullet (Item 1) can stay if reframed to "addressed in V3.8-fix1"
   or be removed — author's choice; the V3.8-fix1 section makes
   it self-documenting.

## Out of scope

- Per-library cursor / k-way merge across libraries (Plan B).
  Item 1's pre-condition — duplicate ids across pages — is
  resolved by Plan A; remaining ordering imperfection at very
  large multi-library scale is acceptable.
- Any change to single-library or all-libraries paths.
- Any change to other screens, other library tabs, search,
  starred, or queue.
- Any change to `PaginatedLoader`, `getAlbumList2`,
  `_mergeAlbumLists`, or the API merge helpers.
- New tests; v3.8 has no automated test harness for this and the
  smoke test below is sufficient.

## Verification

Smoke test against `http://192.168.0.2:4534`:

1. `./build.sh` succeeds. Bundle gzip sizes log out.
2. `grep -nE '\?\.|\?\?' js/sonance-core.min.js
   js/sonance-screens.min.js` → no hits.
3. `python3 -m http.server 8080`. Open
   `http://localhost:8080/index.html`.
4. Log in. Settings → Libraries: confirm both libraries listed,
   default all-checked. About panel still says **V3.8**.
5. Library → Albums (all libraries selected → `null` →
   single-call path): scroll to trigger pagination at least
   twice (initial + 2 more pages = ~150 items). Confirm via
   DevTools Network that each page issues exactly one
   `getAlbumList2.view` request **without** `musicFolderId`.
6. Settings → Libraries: uncheck "HiRes Music" (id=2), leaving
   `["1"]`. Library → Albums: same as (5) but every request now
   carries `musicFolderId=1`. Wrapper does not engage; one
   request per page.
7. Synthetic multi (force 2..N-1) — necessary because the
   2-library dev server normalises 2-of-2 to `null`, so the wild
   never hits the multi path. In DevTools console, run:

   ```js
   var api = AuthManager.getApi();
   var seen = {};
   var dupesAcrossPages = 0;
   var apiOffset = 0;
   var pageSize = 50;
   function pull() {
     return api.getAlbumList2('alphabeticalByName', pageSize, apiOffset, ['1','2'])
       .then(function(albums) {
         apiOffset += pageSize;
         var fresh = 0;
         for (var i = 0; i < albums.length; i++) {
           var id = albums[i] && albums[i].id;
           if (seen[id]) { dupesAcrossPages++; continue; }
           seen[id] = true; fresh++;
         }
         console.log('page items=' + albums.length + ' fresh=' + fresh +
                     ' dupes-so-far=' + dupesAcrossPages);
         if (albums.length < pageSize) return;
         return pull();
       });
   }
   pull();
   ```

   This demonstrates the *underlying* duplicate behaviour against
   the unwrapped API. Then navigate to Library → Albums after
   forcing `AuthManager._creds.selectedLibraries = ['1','2']` (so
   the loader takes the multi path) and scroll through several
   pages. Track dupes via:

   ```js
   var seen = {};
   var dupesInGrid = 0;
   document.querySelectorAll('.album-grid-card').forEach(function(c) {
     var id = c.getAttribute('data-album-id');
     if (seen[id]) dupesInGrid++; else seen[id] = true;
   });
   console.log('grid dupes=' + dupesInGrid);
   ```

   Expected: `dupesInGrid === 0` after the fix; before the fix it
   would equal whatever the upstream page-overlap count is.

8. Library → Artists, → Songs, → Genres each load and paginate
   normally with the multi selection still active.
9. Toggle a library again to re-trigger
   `App.applyLibraryChange`: queue clears, navigate Home, Home
   re-fetches with new scope.
10. Logout / login round-trip preserves the persisted selection.
11. `Sonance3.wgt` rebuilt; `unzip -l Sonance3.wgt` lists the new
    bundles.
12. `PROGRESS.md` appended with the V3.8-fix1 section; the
    v3.8 "Deferred / known caveats" list updated per Acceptance
    criterion 9.

If step 7's grid-dupes count is non-zero on the fix branch, the
fix has regressed: investigate `seenIds` lifecycle and the
`apiExhausted` flip logic before declaring complete.

# Prompt 3.8-fix2 — Settings stay-on-toggle + home card layer fix

**Parent ticket:** `tickets/ticket-3.8.md` — read it first. This
prompt assumes the v3.8 multi-library implementation as recorded in
`PROGRESS.md` § "V3.8 — Multi-library support (2026-04-29)" and the
v3.8-fix1 cross-page dedupe recorded in
`PROGRESS.md` § "V3.8-fix1".

**Note on supersession:** This prompt overrides one bullet of v3.8's
"Library-change side-effects" (ticket-3.8.md l. 156–171, step 7
`navigateTo('home')`). The other six side-effects are unchanged.

## Objective

Fix two TV-only UI defects observed in v3.8:

1. **Settings → Libraries** toggles must be in-place — the user must
   stay on the Settings screen after checking/unchecking a library
   so they can make further changes before leaving on their own.
2. **Home → Recently Added (and any `.album-card` row)** cards must
   not cause a transient `border-radius` flicker on a sibling
   card's cover art when focus moves between them. Classic Tizen
   Chromium 63 layer-promotion glitch; already solved for
   `.album-grid-card` by V3-6-fix3 GFX-1 — apply the same pattern
   to `.album-card`.

## Context

### Issue 1 — Settings library navigation

Files involved:

- `js/app.js` l. 1815–1856 — `applyLibraryChange(newIds)`. Sequence
  today:
  1. `Player.stop()` + `Player.clearQueue()`
  2. `api.clearMemoryCache()` and `SubsonicAPI.clearLocalCache(...)`
  3. `StarredCache.clear()`
  4. `AuthManager.setSelectedLibraries(newIds)`
  5. async `StarredCache.load(api)` (fire-and-forget)
  6. `emit('libraries-changed', { libraryIds: newIds })`
  7. `navigateTo('home')`  ← **this is the only step removed.**

- `js/screens/settings.js` l. 527–566 — `_onLibraryRowClicked`.
  Relies on the screen being torn down + re-rendered (via the
  Home navigation) for the `.is-checked` class change to surface
  visually. With the navigation removed, the click handler must
  perform the visual update itself after `App.applyLibraryChange`
  returns:
  - Toggle `clickedRow.classList`'s `is-checked`.
  - Call `_refreshLockState()` (already defined at l. 513–525) so
    the lock-last-checked visual updates correctly when the
    selection becomes a single item.

  **Side-effect ordering matters.** Call `applyLibraryChange` first
  (so persistence + cache-clear happens with the *current* DOM
  state used to derive `normalised`), then mutate the DOM.

- `js/screens/home.js` `activate()` — reads
  `AuthManager.getSelectedLibraries()` on every activation; LS cache
  was already cleared by `applyLibraryChange`. **No change needed.**
- `js/screens/library.js` `activate()` and the Albums tab loader —
  same. **No change needed.**
- The hint text under the libraries list ("Changing your library
  selection will clear cached data and your current play queue.")
  is still accurate after the fix; **leave it as-is.**

### Issue 2 — Home card cover-art flicker

Repro from the user: focus moves between two cards in the
"Recently Added" row → a card on a *different* row briefly loses
its cover-art rounded corners, then recovers. The cover art's
`border-radius` is set inline in `js/components.js` l. 105
(`container.style.borderRadius = (size > 100 || fillMode) ? '10px'
: '6px'`); the inline clip momentarily detaches when the GPU
compositor reorganises layer boundaries on the focused-card scale
transform.

The reference fix (already shipped for the album grid):

- `css/styles.css` l. 2033–2079 — `.album-grid-card` has at-rest
  `transform: translateZ(0)` + `backface-visibility: hidden`, and
  on `.focused` chains `translateZ(0)` onto the scale: `transform:
  scale(1.08) translateZ(0)`. Comment marker: `V3-6-fix3 GFX-1`.

The home row card lacks both:

- `css/styles.css` l. 1793–1813 — `.album-card` and
  `.album-card.focused`. Currently no `translateZ`, just
  `transform: scale(1.08)` on focus.

## Task

### 1. `js/app.js` — drop the navigation step

In `applyLibraryChange(newIds)` (around l. 1822–1856):

- Delete the line `navigateTo('home');` (currently l. 1855).
- Update the function's leading comment block (currently l.
  1815–1821) so the last bullet no longer says "Force a navigation
  back to Home so every list refetches." Replace it with: "Leave
  the user on the current screen; Home / Library re-fetch with the
  new scope on their next activation, since their `activate()`
  reads `AuthManager.getSelectedLibraries()` afresh and the LS
  cache has been cleared."
- All other side-effects stay exactly as v3.8: stop playback, clear
  queue, clear in-memory + LS API caches, clear StarredCache,
  persist via `setSelectedLibraries`, async `StarredCache.load`,
  emit `libraries-changed`. Order unchanged.

### 2. `js/screens/settings.js` — in-place visual update

In `_onLibraryRowClicked(libraryId)` (l. 527–566):

After the existing `App.applyLibraryChange(normalised);` call (l.
565), append:

```js
// V3.8-fix2: applyLibraryChange no longer navigates away; update
// the row's checked state in-place and refresh the lock visual.
clickedRow.classList.toggle('is-checked');
_refreshLockState();
```

Notes:

- Use the existing `clickedRow` reference captured at l. 533 — do
  not re-query the DOM.
- `_refreshLockState()` is defined at l. 513–525 in the same file
  and is already used by `_renderLibrariesSection` (l. 474). Reuse
  it; do not duplicate its logic.
- Do not call `_renderLibrariesSection` (full rebuild). The
  in-place class toggle is sufficient and preserves focus on the
  toggled row.
- `FocusManager`'s focus stays on the row naturally because the
  DOM element is not replaced. No focus-management code is needed.

### 3. `css/styles.css` — promote `.album-card` to its own layer

In the `.album-card` rule (currently l. 1793–1803), add at the end
of the declaration block (before the closing `}`):

```css
    /* V3.8-fix2 (was V3-6-fix3 GFX-1 for grid cards): force the card
       onto its own compositor layer at rest so the focused scale
       doesn't briefly drop the border-radius clip on neighbouring
       cards' cover art (Tizen 5.0 / Chromium 63 layer recomposition
       artefact). */
    transform: translateZ(0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
```

In the `.album-card.focused` rule (currently l. 1807–1813), change:

```css
    transform: scale(1.08);
```

to:

```css
    /* V3.8-fix2: keep translateZ on focus so the focused state stays
       on the same compositor layer as the at-rest state. */
    transform: scale(1.08) translateZ(0);
```

Do not change `transform-origin`, `border-radius`, `padding-bottom`,
the focused outline/shadow resets, or `z-index: 5`.

Do not modify `.album-card .album-art` selectors, the
inline-borderRadius logic in `components.js`, or any other card
selector.

### 4. `PROGRESS.md` update

Append a new section under the V3.8-fix1 entry titled exactly:

```
### V3.8-fix2 — Settings stay-on-toggle + home card layer (2026-04-29)
```

Document:

- Scope: two TV-side UI defects fixed.
  1. Settings → Libraries toggle no longer navigates back to Home;
     stays in-place on the Settings screen with the same toggled
     row focused. All other library-change side-effects (stop
     playback, clear queue, clear caches, reload StarredCache,
     persist, emit event) unchanged from v3.8.
  2. `.album-card` (home row) promoted to its own GPU compositor
     layer at rest and on focus, matching the grid-card pattern,
     to eliminate transient `border-radius` loss on neighbouring
     cards' cover art during focus transitions on Tizen 5.0.
- Files changed: `js/app.js`, `js/screens/settings.js`,
  `css/styles.css`.
- What was tested (per "Verification" below).
- Note that `tickets/ticket-3.8.md` § "Library-change side-effects"
  step 7 is **superseded** by V3.8-fix2 — the navigateTo('home')
  step is intentionally removed.

### 5. Rebuild

`./build.sh` to refresh `Sonance3.wgt` + bundles. Cache-bust
querystring stays at `?v=v3-8`. Settings → About still says **V3.8**.

## Constraints

- ES2017 only. No `?.`, `??`, `Object.fromEntries`, `Array.flat`,
  top-level `await`, `BigInt`. Verify with `grep -nE '\?\.|\?\?'
  js/sonance-core.min.js js/sonance-screens.min.js` after the
  rebuild — must return zero hits.
- CSS: only `transform` / `opacity` may be transitioned. No
  `transition: all`. No `gap` on flex containers (legacy
  `grid-gap` only on grids). No `backdrop-filter`. The new
  `transform: translateZ(0)` / `backface-visibility` declarations
  are not transitions and are safe.
- AVPlay lifecycle untouched. The `Player.stop()` /
  `Player.clearQueue()` calls inside `applyLibraryChange` stay.
- Network: only the configured `sonance_server_url`.
- Do **not** modify `tickets/ticket-3.8.md`,
  `tickets/prompt-3.8.md`, `tickets/prompt-3.8-fix1.md`, or any
  v3.7 ticket / prompt files.
- Do **not** bump the cache-bust querystring or the About-panel
  version label.
- Do **not** change `js/components.js` line 105's inline
  `borderRadius` logic. The fix is on the parent card's compositor
  layer, not the inline clip.
- Do **not** add a confirmation modal or a deferred-commit pattern
  to library toggles. Side-effects fire per-toggle as before.
- Do **not** touch `.album-grid-card`, `.artist-grid-card`,
  `.genre-grid-card`, `.playlist-grid-card`, `.search-quick-tile`,
  or any other card selector. Only `.album-card` and
  `.album-card.focused`.

## Acceptance criteria

1. Toggling a library checkbox in Settings → Libraries (multi-
   library server, 2..N libraries available) keeps the user on
   the Settings screen. The Settings DOM is not torn down, the
   focused row is the same row that was clicked, and the
   `.is-checked` class on that row reflects the new state.
2. After the toggle, all of: Player is stopped, queue is empty,
   `SubsonicAPI._cache` is empty, the LS API cache for
   `(username, serverUrl)` is empty, `StarredCache` has been
   cleared and a fresh load has been kicked off,
   `localStorage.sonance_selected_libraries` reflects the new
   selection (or has been removed if all libraries are checked,
   per `_normaliseLibraryIds`).
3. The lock-last-checked rule still works: when the new state
   would leave only one library checked, that row gains
   `.is-locked` and clicking it again is a no-op (existing l.
   538–542 early return).
4. Navigating to Home from Settings (via top nav) after a
   library toggle re-fetches Home with the new scope (Newest /
   Recent rows reflect the selection). Same for Library →
   Albums / Artists / Songs / Genres on next activation.
5. Logout still clears `sonance_selected_libraries` (unchanged
   from v3.8). Hint text under the libraries list is unchanged.
6. On the Home screen, focusing across cards in the "Recently
   Added" row no longer causes any visible `border-radius`
   change on cover art belonging to other cards / other rows.
   Verified at the test cases the user reported (e.g. cycling
   between "Helter Skelter Presents…" and "2 RUFF, Vol. 1" with
   a card on the row below — the row-below cover art's rounded
   corners stay consistent throughout the focus moves).
7. The home `.album-card` focused-scale animation still looks
   identical (scale 1.08, same easing, same shadow lift). No
   visible regression in the focus indicator. No regression in
   `.album-grid-card`, which already has the layer pattern.
8. `grep -nE '\?\.|\?\?' js/sonance-core.min.js
   js/sonance-screens.min.js` returns zero hits after the
   rebuild.
9. `Sonance3.wgt` rebuilt; bundle bytes change but
   `index.html` cache-bust querystring is still `?v=v3-8` and
   Settings → About still says **V3.8**.
10. `PROGRESS.md` has the new V3.8-fix2 section.

## Out of scope

- Any change to other library-change side-effects (cache clear,
  starred reload, queue clear, playback stop). They continue to
  fire per-toggle.
- Multi-toggle batching, debouncing, or commit-on-leave. Each
  toggle is its own commit, same as v3.8.
- Any change to `js/components.js` or the inline `borderRadius`
  logic.
- Any change to other focus / animation behaviour, the focus
  manager, or the keyboard map.
- Any change to single-library or "all libraries" cache paths.
- Any change to the Albums-tab pagination dedupe shipped in
  v3.8-fix1.
- New automated tests; the v3.8 line continues to rely on the
  Browser Smoke Test.

## Verification

Smoke test against `http://192.168.0.2:4534`:

1. `./build.sh` succeeds. Bundle gzip sizes log out.
2. `grep -nE '\?\.|\?\?' js/sonance-core.min.js
   js/sonance-screens.min.js` → no hits.
3. `python3 -m http.server 8080`. Open
   `http://localhost:8080/index.html`. Log in.
4. **Issue 1 (synthetic multi).** Because the dev test server is
   single-library, force the multi-library UI path by mocking the
   `getMusicFolders` response (DevTools console):

   ```js
   var api = AuthManager.getApi();
   api.getMusicFolders = function() {
     return Promise.resolve([
       { id: '1', name: 'Library One' },
       { id: '2', name: 'Library Two' }
     ]);
   };
   App.navigateTo('settings');
   ```

   Or, alternatively, point the `sonance_server_url` at a
   multi-library Navidrome if available. Either gets you a
   "Libraries" section with ≥2 rows.
5. With the Libraries section visible:
   - Note the focus position on a library row.
   - Press Enter to toggle it. Confirm the screen does not
     navigate to Home — the URL hash / the visible content stays
     on Settings, and the same row remains focused with its
     `.is-checked` class flipped to match the new state.
   - Toggle a different library. Same behaviour.
   - Toggle libraries until only one remains checked. Confirm
     that one row gains `.is-locked` and pressing Enter on it
     does nothing visible (no toggle, no nav).
6. Confirm side-effects after a toggle:
   - `localStorage.getItem('sonance_selected_libraries')` reflects
     the new selection.
   - `AuthManager.getApi()._cache` is empty (or check
     `api._cache` if exposed; otherwise observe a network
     request on the next list call).
   - `Player.getQueue().length === 0` (or the Now-Playing bar is
     empty / hidden).
   - The next navigation to Home triggers fresh
     `getAlbumList2.view` requests reflecting the new scope (no
     `musicFolderId` if all checked, `musicFolderId=<id>` if a
     single library selected, no `musicFolderId` then merged
     fan-out happens inside the API for 2..N-1 selections — same
     as v3.8).
7. **Issue 2.** On the Home screen with several albums in the
   Recently Added row and at least one populated row below it:
   - D-pad-cycle focus left/right within the Recently Added row
     across at least 5 cards. While doing so, watch the cover
     art of cards on the row(s) below.
   - Acceptance: no perceptible loss of rounded corners on any
     non-focused card during or immediately after the focus
     move. The `border-radius` clip stays continuously applied.
   - Re-test on the album grid (Library → Albums) — should be
     unchanged from v3.8 (the grid card already had the layer
     pattern).
8. DevTools → Animations / Performance: confirm the focused-card
   transform animates as a compositor-only change (no layout, no
   paint on neighbouring cards). The new `translateZ(0)` should
   eliminate the prior paint event on neighbours.
9. Logout / login round-trip: the persisted selection is preserved
   for the same user (unchanged from v3.8). Hint text below the
   libraries list still reads "Changing your library selection
   will clear cached data and your current play queue."
10. `unzip -l Sonance3.wgt` lists the rebuilt bundles; cache-bust
    querystring on `index.html` is still `?v=v3-8`; Settings →
    About still says **V3.8**.
11. `PROGRESS.md` has the new V3.8-fix2 section per "Task" step 4.

If on any toggle the screen still navigates to Home, the fix has
regressed — check that `js/app.js` `applyLibraryChange` no longer
calls `navigateTo('home')` and that the bundles were rebuilt.

If neighbouring-card cover-art flicker is still visible on focus
moves, check that `transform: translateZ(0)` is present on
`.album-card` at rest and that `.album-card.focused`'s
`transform` includes both `scale(1.08)` and `translateZ(0)` (in
that order). Re-build and re-test.

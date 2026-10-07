You are doing the third post-3.6 fix run on Sonance — a music player app for Samsung Tizen TVs (Q90R / Tizen 5.0 / Chromium ~63). Vanilla JS, no build step. This run covers four navigation bugs and two graphics bugs identified after `prompts/V3-6-fix2-prompt.md` shipped.

## Parent prompts to read first
- `CLAUDE.md` (project rules — Tizen constraints, animation rules, protected files)
- `PROGRESS.md` (current state)
- `prompts/V3-6-prompt.md` (parent v3.6 ticket — image cache, lazy load, virtual grid, focus restoration)
- `prompts/V3-6-fix-prompt.md` (first post-3.6 fix — graphics polish + GFX-5 introduced gradient Search QA tiles)
- `prompts/V3-6-fix2-prompt.md` (second post-3.6 fix — Library → Artists perf, immediately preceding this run)

## Test configuration
- Test Navidrome server: `http://192.168.0.2:4534`
- Dev server: `python3 -m http.server 8080` from project root
- Browser test all changes; **leave the dev server running at the end** so the user can manually verify on TV/local browser

## DO NOT MODIFY — protected files
- `js/player.js`
- `js/auth.js`
- `js/starred.js`
- `config.xml`
- `js/api.js` — you may ADD new methods (e.g. small helpers around existing endpoints) but NOT modify or remove existing ones

## Tizen constraints
- No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`
- No flex `gap`. Grid uses `grid-gap` (legacy, not `gap`).
- No `aspect-ratio` — padding-bottom trick.
- No `backdrop-filter` (not supported on Tizen 5.0).
- Animate `transform` and `opacity` only. No `transition: all`.
- Do not regress any V3-6 / V3-6-fix / V3-6-fix2 work.

---

## NAV-1 — Queue: Down from top nav must land on the queue list, not the cover art

**Problem.** From the Queue page with the top nav focused, pressing Down focuses the album-cover card (`#queue-np-card`) on the left side. Expected: focus the FIRST item in the queue list on the right.

**Why it happens.**
- `js/screens/queue.js:263-272` registers the cover-card under the zone name `'content'`.
- `js/app.js:667-677` `_getPageFirstZone()` candidates list is `['content', 'library-grid', 'library-subnav', 'queue-list', ...]` so `'content'` wins on Down-from-topnav before `'queue-list'` is even checked.
- `js/screens/queue.js:303` calls `setActiveZone(hasQueue ? 'queue-list' : 'content', 0)` but `js/focus.js:89-99` blocks the call when the active zone is `'topnav'` unless `force: true` is passed.

**Fix (recommended approach — pick whichever is cleaner once you've read the code).**
Either:
- (a) Rename the queue's left-panel zone from `'content'` to something queue-specific (e.g. `'queue-card'`) and update its `neighbors` references in queue.js. The priority list in `_getPageFirstZone` will then naturally fall through to `'queue-list'` when on Queue. Update any other zones (incl. NP bar `up:` neighbour) that referred to `'content'` on this screen.
- (b) Add a per-page first-zone hint. E.g. let a screen optionally export `getFirstFocusZone()` that the router calls before falling back to the candidates list. Implement on `queue.js` returning `'queue-list'` when items exist, else `'content'`.

(a) is the smaller diff. Either is acceptable; do not regress other screens.

**Acceptance:**
- [ ] Top nav → Queue → Down lands on the FIRST queue row when there is at least one queued track.
- [ ] When the queue is empty, Down lands on the cover-card (the existing fallback).
- [ ] Left from the first queue row still moves to the cover-card; Right from the cover-card moves to the queue-list. Both directions still work.
- [ ] No regression on other screens' Down-from-topnav behaviour.

---

## NAV-2 — Genre detail: opening a genre must focus the first song

**Problem.** Top nav → Library → sub-nav Genres → Enter on a genre tile (e.g. "Rock") opens a song list on the right. Currently nothing is highlighted. Expected: the FIRST song row at the top of the list is focused (NOT the left sub-nav).

**Why it happens.** `js/screens/library.js:934-981` `_renderGenreSongs` calls `_registerGridZone(1)` at line 980 but never calls `setActiveZone`, so focus stays wherever it was (often invisible).

**Fix.** After `_registerGridZone(1)` in `_renderGenreSongs`, add:
```js
FocusManager.setActiveZone('library-grid', 0, true);
```
Verify the row's `.focusable` selector matches what `_registerGridZone` registers (rows are `.song-row.focusable` per line 951).

**Acceptance:**
- [ ] Genre tile Enter → first song row visibly highlighted (scale + bg per v3 track-row focus style).
- [ ] Left from the song list still returns to the genres sub-nav / grid.
- [ ] Up/Down moves through song rows.
- [ ] Empty genre still renders the empty-state message and does not crash on focus.

---

## NAV-3 — Album & Artist detail: opening must focus the first track

**Problem.** From Library Albums grid OR an Artist page, pressing Enter on an album/artist opens the detail page. Currently the LEFT panel (Play/Shuffle buttons) is focused. Expected: the FIRST track in the right-hand track list is focused.

**Why it happens.** `js/screens/album.js:449` ends `_registerFocusZones` with:
```js
FocusManager.setActiveZone('content', 0);
```
The same pattern almost certainly exists in `js/screens/artist.js`.

**Fix.**
1. In `js/screens/album.js`, change line 449 to:
   ```js
   FocusManager.setActiveZone(hasTracks ? 'album-tracks' : 'content', 0);
   ```
2. Open `js/screens/artist.js` and apply the equivalent change. The artist detail likely has its own track-list zone (e.g. `'artist-tracks'` or it may reuse `'album-tracks'`); use whatever name is registered. If the artist page doesn't have a flat track list (it has a discography of albums) then focus the first discography card / first album in the discography zone instead. Match the user's intent: "top item in the list (not left hand menu)".

**Acceptance:**
- [ ] Album detail open → first track row focused.
- [ ] Artist detail open → first item in the right-hand content (top of the visible list) focused, not the left action buttons.
- [ ] Left from the focused track returns to Play/Shuffle.
- [ ] Back from the detail still restores focus on the previous album/artist tile (do not regress the V3-6-fix NAV-1 snapshot/restore behaviour).

---

## NAV-4 — Search page: opening must focus the letter "A"

**Problem.** Top nav → Search opens the search page with NOTHING focused. Expected: the letter "A" key on the on-screen keyboard is focused.

**Why it happens.** `js/screens/search.js:539` calls:
```js
FocusManager.setActiveZone('content', 0);
```
The third argument (`force`) is omitted. `js/focus.js:89-99` then blocks the transition because the active zone is still `'topnav'` from the nav slide.

**Fix.** Change line 539 to:
```js
FocusManager.setActiveZone('content', 0, true);
```
Verify by inspection that the first element in the `'content'` zone selector `'#search-keyboard .kb-key'` is the "A" key (per the keyboard layout in lines 92-101 of search.js). If for any reason it isn't, fix the keyboard render order so "A" is index 0.

**Acceptance:**
- [ ] Top nav → Search lands with the letter "A" highlighted.
- [ ] Up/Down/Left/Right keyboard navigation works as before.
- [ ] Down from the bottom keyboard row reaches SPACE/DEL; from there reaches the NP bar.
- [ ] Going back to the topnav and re-entering Search still focuses "A" reliably (cold and warm).

---

## GFX-1 — Album/Artist grid "ghost text" on focus

**Problem.** When a card on the Library Albums or Artists grid is focused (`transform: scale(1.08)`), the user sees the title/name text rendered TWICE — once where it would be unzoomed, once at the zoomed scale. Looks like the un-scaled text is bleeding through behind the scaled card.

**Likely cause (Tizen 5.0 Chromium 63 specific).** The cards animate `transform: scale(1.08)` but are not promoted to a dedicated compositor layer at rest. On Chromium 63, glyph caches can render both pre- and post-transform glyphs during the transition / when the card has been promoted just-in-time, especially when the scaled card overlaps adjacent cards.

**Investigate first, then fix.**
1. Open the library Albums tab in a browser (test config above) and reproduce. Take a screenshot. If you cannot reproduce in browser, the bug may be Tizen-only — note that, then ship the fix below as a precaution and ask the user to verify on the TV.
2. Inspect `.album-grid-card`, `.album-grid-info`, `.album-grid-title`, `.album-grid-meta`, `.artist-grid-card`, `.artist-grid-name`, `.artist-grid-count` in DevTools while a card is focused. Confirm whether there is in fact a second text node or just a paint artefact.

**Fix (try in this order — stop when ghosting is gone):**
1. **Apply `backface-visibility: hidden` and `transform: translateZ(0)` to the card at rest** (not only on focus). This forces the card onto its own GPU layer permanently so the compositor doesn't have to re-rasterize on focus. Do this for `.album-grid-card` AND `.artist-grid-card`. Do NOT apply globally — only these two card selectors. Do NOT add static `will-change` (V3-6-fix2 PERF-3 explicitly removed it; the dynamic system in `js/focus.js` is authoritative).
   - Tradeoff: a small VRAM cost. Acceptable here because grids are paginated/virtualised post-V3-6.
2. If (1) doesn't help, also set `text-rendering: geometricPrecision` and `-webkit-font-smoothing: antialiased` on the title/meta text inside the card.
3. If (1) and (2) don't help, scope the scale to a child wrapper that's already on its own layer (wrap the inner content in a `.album-grid-card-inner` and apply the scale to the inner element instead of the outer card). This is a bigger refactor — only do this if the simpler fixes fail.

**Acceptance:**
- [ ] Focused album card shows ONE copy of its title/meta text (no ghost layer).
- [ ] Focused artist card shows ONE copy of its name/count text.
- [ ] Scale animation still smooth (60fps target). No regression on focus visuals.
- [ ] No new static `will-change` declarations introduced (verify via `grep -nE 'will-change' css/styles.css`).

---

## GFX-2 — Search Quick Access tiles must use the genres-style gradient fill

**Problem reported.** The Search page's Quick Access tiles (`Favourites`, `Recently Added`, etc.) "now have nice coloured boxes as of 3.6fix1, but they do not have the gradient fill style that the genre page has".

**Code-side state.** `js/screens/search.js:248-283` defines `QA_ITEMS` with `gradient` strings (linear-gradient) and applies them inline via `card.style.background = cat.gradient`. The genres equivalent (`js/screens/library.js:797-833`) does the same. CSS `.search-qa-tile` (`css/styles.css:2661-2688`) and `.genre-card` (`css/styles.css:2164-2197`) are structurally identical and neither sets a `background` rule, so the inline gradient should win.

**This means one of three things, and you must figure out which before changing code:**
1. The bug has been resolved by prior work and the user is looking at a stale build / cache.
2. A later CSS rule with higher specificity is overriding the inline `background` on the search tiles (e.g. an `.search-qa-tile:focus` or a theme override clobbering `background` rather than `background-color`).
3. The inline assignment is being silently dropped on Tizen for some reason (linear-gradient strings via `style.background` are well-supported in Chromium 63, so this is unlikely — but rule it out).

**Steps.**
1. Start the dev server, open `/` in Chromium, navigate to Search. **Screenshot the QA tiles.** Compare visually to the Genres tiles in Library → Genres. Save both screenshots (suggested names `v3-6-fix3-search-qa.png`, `v3-6-fix3-genres.png`) at the project root for the user to inspect.
2. If they look identical (gradients present on both): mark GFX-2 RESOLVED in PROGRESS.md and skip the remaining steps.
3. If the search tiles ARE flat:
   - In DevTools, inspect the first QA tile and check the `background` computed value.
   - If the inline `background: linear-gradient(...)` is being overridden, find the rule winning specificity (search `styles.css` for `.search-qa-tile` and any later override). Common culprit: theme tweaks added between V3-6-fix and V3-6-fix2 that set `background: var(--surface-1)` or similar with higher specificity.
   - Fix by either (a) bumping the inline assignment to `card.style.setProperty('background', cat.gradient, 'important')` or (b) removing the offending CSS rule. Prefer (b) — `!important` is a smell; only use it if the override is in a third-party-style file we shouldn't touch.
4. After fixing, re-screenshot and confirm visual parity with the genres tiles.

**Acceptance:**
- [ ] Search Quick Access tiles render with linear-gradient fills matching the Genres tile style.
- [ ] Each QA tile has the gradient defined in `QA_ITEMS` (Pink for Favourites, Green for Recently Added, etc.).
- [ ] Focus animation (scale 1.08) still works on QA tiles.
- [ ] No regression on the Genres tiles.

---

## RULES
- Vanilla JS, ES2017. No `?.`, no `??`, no `Array.flat()`.
- `transform` and `opacity` only for animations. No `transition: all`.
- No flex `gap`. Use `grid-gap` for grid.
- Build on V3-6 / V3-6-fix / V3-6-fix2 infrastructure (`ImageCache`, `LazyLoader`, `VirtualGrid`, `PaginatedLoader`, dynamic `will-change`, focus snapshot/restore). Do NOT replace them.
- Run autonomously. Test in browser. Use the test config above.
- After all changes pass, **rebuild `Sonance.wgt` via `./build.sh`** and **leave `python3 -m http.server 8080` running** so the user can manually inspect on localhost:8080 and on the TV.
- Update `PROGRESS.md` at the end with: what shipped, what was tested, any deviations, and (for GFX-2) which of the three states was actually true.

## TESTING

Functional (browser):
- [ ] NAV-1 — Queue Down-from-topnav focuses queue list (with items) / cover card (empty)
- [ ] NAV-2 — Genre detail open focuses first song row
- [ ] NAV-3 — Album detail open focuses first track row
- [ ] NAV-3 — Artist detail open focuses first list item (not left action panel)
- [ ] NAV-4 — Search page open focuses letter "A"
- [ ] GFX-1 — Album / Artist focused cards show single text rendering, no ghost
- [ ] GFX-2 — Search QA tiles render with gradient fills matching genres

Regression sanity:
- [ ] V3-6-fix NAV-1 focus restoration still works (Back from album → tile re-focused)
- [ ] V3-6-fix2 PERF-3 grep `will-change` allowlist still holds (no static `will-change` reintroduced)
- [ ] Library → Albums/Artists/Songs/Genres all still navigate correctly
- [ ] Now Playing screen unchanged (perf work happens in fix4)

End state:
- [ ] `./build.sh` produced a fresh `Sonance.wgt`
- [ ] `python3 -m http.server 8080` running and printed in the final message
- [ ] PROGRESS.md updated

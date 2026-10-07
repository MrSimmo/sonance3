You are fixing a batch of post-3.6 navigation and visual bugs in Sonance — a music player app for Samsung Tizen TVs (Q90R / Tizen 5.0 / Chromium ~63). Vanilla JS, no build step.

## Parent prompts to read first
- `CLAUDE.md` (project rules — Tizen constraints, animation rules, protected files)
- `PROGRESS.md` (current state, what was done in V3-6)
- `prompts/V3-6-prompt.md` (last shipped run — image cache / lazy load / will-change reduction)
- `prompts/V3-5-fix3-prompt.md` (previous nav-pill / focused-row work — superseded by this prompt for fix #4)

## Test configuration
- Test Navidrome server: `http://192.168.0.2:4534`
- Dev server: `python3 -m http.server 8080` from project root
- Browser test all changes before declaring complete
- **Leave the dev server running at the end** — the user will do TV/manual smoke tests

## DO NOT MODIFY — protected files
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client (you may ADD methods, NOT modify existing)
- `js/auth.js`
- `js/starred.js`
- `config.xml`
- `js/utils.js` (read-only this round — do not touch `PaginatedLoader`)

## Tizen constraints (CRITICAL — break the build if violated)
- No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`
- No flex `gap` — use `> * + *` margins or explicit margins per child
- Grid `gap` shorthand NOT supported — use `grid-gap`
- No `backdrop-filter` — use solid semi-transparent backgrounds
- No `aspect-ratio` — use the padding-bottom trick
- Animate ONLY `transform` and `opacity`. Never `transition: all`
- Keep durations 0.12–0.25s

---

## NAVIGATION FIXES

### NAV-1 — Restore grid focus on Back from a detail/now-playing screen

**Symptom:** From Library → Albums (or Artists / Songs / Genres), the user
focuses a tile, presses Enter, browses the detail page or starts a song,
then presses Back. Instead of returning focus to the tile they came from,
both the top nav and the side sub-nav are highlighted and the grid focus
is gone.

**Root cause:** `js/focus.js:55-77` `clearContentZones()` deletes
`_focusIndex[zoneName]` for every content zone on every screen change.
There is no snapshot/restore of the previously-focused zone+index.

**Fix:**
1. In `js/focus.js`, expose a small public API on `FocusManager` for
   focus snapshotting:
   ```js
   FocusManager.snapshot = function() {
       return { zone: _activeZone, index: _focusIndex[_activeZone] || 0 };
   };
   FocusManager.restore = function(snap) {
       if (!snap || !snap.zone) return false;
       if (!_zones[snap.zone]) return false;  // zone not registered
       FocusManager.setActiveZone(snap.zone, snap.index, true);
       return true;
   };
   ```
2. Add a small in-memory map keyed by `(screen, sub-tab)` — e.g.
   `_savedFocus['library:albums']`, `'library:artists'`, etc.
3. **Capture** the snapshot in the grid's `onActivate` (Enter handler) just
   before navigating to the detail / now-playing screen — see
   `js/screens/library.js` activate hooks for albums/artists/genres/songs.
4. **Restore** the snapshot in `js/app.js` when navigating back to a
   Library tab. Do this AFTER the tab is rendered and zones are
   re-registered. If `FocusManager.restore()` returns false (zone not yet
   ready), fall through to current default behaviour.
5. Verify Back from Now Playing also restores grid focus when the
   originating screen was a Library grid (not just for detail screens).

**Acceptance:**
- [ ] On Library Albums, focus the 7th tile, press Enter → Back. The 7th tile is focused. Top nav and sub-nav are NOT highlighted.
- [ ] Same for Artists, Songs, Genres.
- [ ] Same for Now Playing back-out (focus a tile, Enter to detail, play song, navigate to Now Playing, press Back twice — grid focus is restored).
- [ ] Switching tabs (Albums → Artists) and coming back later does NOT restore stale focus from a different tab — only the matching tab restores.

### NAV-2 — Up from grid goes to top nav (not side sub-nav)

**Symptom:** From Now Playing, press Back to return to a Library grid,
then press Up. Focus lands on the side sub-nav (Albums / Artists / Songs /
Genres pill column). The user expects Up to land on the **top nav bar**
instead.

**Root cause:** `js/screens/library.js:820-873` — every grid zone declares
`neighbors: { up: 'library-subnav', left: 'library-subnav', ... }`.

**Fix:**
1. Change every Library grid zone (albums / artists / songs / genres /
   playlists if applicable) so `up` points to `'topnav'`.
2. Keep `left: 'library-subnav'` — Left is how the user reaches the side
   sub-nav from a grid. (User confirmed.)
3. The side sub-nav itself should keep `up: 'topnav'` so Up from sub-nav
   still goes to top nav.

**Acceptance:**
- [ ] In Library Albums grid, Up takes focus to the top nav bar (Home / Library / Playlists / etc.) — not the sub-nav.
- [ ] Left from the grid still enters the side sub-nav.
- [ ] Up from the side sub-nav still takes focus to the top nav.
- [ ] After Back from NP → grid, pressing Up reaches top nav directly.

### NAV-3 — Down from top nav lands on top-left grid item (not sub-nav)

**Symptom:** User slides Left/Right in the top nav onto Library, then
presses Down. Focus lands on the side sub-nav (Albums) instead of the
first grid tile.

**Root cause:** `js/app.js:660-667` — `_getPageFirstZone()` priority list
contains `'library-subnav'` ahead of (or alongside) the grid zones.

**Fix:**
1. Reorder `_getPageFirstZone()` so the active grid zone is preferred over
   `library-subnav`. The current Library tab's grid zone name should win.
   - On Library, the grid zone is one of `'library-albums-grid'`,
     `'library-artists-grid'`, `'library-songs-list'`,
     `'library-genres-grid'` (use whatever names are actually registered).
2. The side sub-nav remains reachable only via Left from the grid
   (per NAV-2).

**Acceptance:**
- [ ] Slide top nav onto Library → press Down → focus is on the first tile of the active sub-tab's grid.
- [ ] Switch sub-tab (Left from grid → Down on Artists in sub-nav → Right back into grid). Then Up to top nav, Down again — first tile of the *currently selected* sub-tab is focused.

### NAV-4 — Login dialog: Right and Down should both advance fields; Up and Left should both retreat

**Symptom:** On the login screen, the user must press Down to move from
the IP/URL field to the Port field. Right key is ignored. They want Down
and Right to behave identically; Up and Left to behave identically.

**Root cause:** `js/screens/login.js:151-206` only intercepts Up (38) and
Down (40). Left (37) and Right (39) fall through to default browser
behaviour (caret movement inside the input).

**Fix:**
1. In the input keydown handler, add cases for keyCode 37 (Left) and 39
   (Right). They should call the same handlers as Up and Down respectively.
2. Be careful not to intercept Left/Right when the cursor is mid-text — or
   simply always advance/retreat regardless. The user's instruction is
   explicit: Down/Right identical, Up/Left identical. Apply unconditionally
   for the IP/Port/User/Password fields and the Connect button.
3. Make sure focus order matches the visual order on the login screen:
   IP → Port → Username → Password → Connect button. Confirm by reading
   `js/screens/login.js` and the rendered DOM.

**Acceptance:**
- [ ] In IP/URL field, press Right → focus moves to Port. Press Left → back to IP.
- [ ] In IP/URL field, press Down → focus moves to Port. Press Up → back to IP (or stays — match current Up behaviour).
- [ ] All four arrow keys behave consistently across all login fields and the Connect button.
- [ ] Typing into a field still works. Backspace and character entry are not broken.

---

## GRAPHICS FIXES

### GFX-1 — Now Playing background blur: 2× stronger

**Symptom:** The blurred cover-art background on Now Playing is too crisp.

**File:** `css/styles.css:3336-3351` — `.np-bg-image`

**Fix:**
- Change `filter: blur(30px) saturate(1.3);` → `filter: blur(60px) saturate(1.3);`
- Keep `opacity: 0.6;`
- Verify GPU compositing isn't broken (no `transition: filter` — `filter` is
  expensive but applied once on render; a single `blur` is fine on Tizen 5.0).

**Acceptance:**
- [ ] NP background looks visibly softer/blurrier than v3-6-nowplaying.png reference (in project root).
- [ ] No layout shift, no jank when entering NP.

### GFX-2 — Now Playing background: widen so no black bars at left/right

**Symptom:** With certain cover art (especially landscape-cropped sources),
the NP background shows black bars on the left and right edges of the
viewport. The blurred image isn't wide enough.

**File:** `css/styles.css:3336-3351` — `.np-bg-image`

**Current:** `top: -10%; left: -10%; width: 120%; height: 120%;`

**Fix:** Increase to `top: -25%; left: -25%; width: 150%; height: 150%;`
(symmetric overscan of 25%). Combined with the larger blur from GFX-1,
the edges fall well off-screen and the image always covers full width.

**Acceptance:**
- [ ] Test with at least 3 different albums (square art, narrow art, wide art).
- [ ] No black bars on left/right of NP screen for any of them.

### GFX-3 — Album / Artist left menu pills truncated

**Symptom:** On Album detail and Artist detail, the Play / Shuffle pills
are wider than the panel/tile they sit in. The pill rounded edges get
clipped at the panel boundary. See `v3-6-artist.png` in project root.

**Files:**
- `css/styles.css:2270-2333` — `.album-play-btn`, `.album-shuffle-btn`
- `css/styles.css:3531-3602` — `.artist-play-btn`, `.artist-shuffle-btn`
- DOM: `js/screens/album.js:221-255`, `js/screens/artist.js:162-193`

**Fix:** Do **NOT** change the panel/tile width. Reduce the pill width
slightly so it fits comfortably inside.

Apply to all four button rules:
```css
.album-play-btn,
.album-shuffle-btn,
.artist-play-btn,
.artist-shuffle-btn {
    width: calc(100% - 16px);   /* was: 100% */
    margin-left: 8px;
    margin-right: 8px;
    box-sizing: border-box;
}
```
Adjust the `16px` (8px each side) up if the screenshot shows the pill
still touching the edge — the goal is a comfortable inset where the
rounded corners are fully visible.

If the buttons are already centered by the parent flex, the
`margin-left` / `margin-right` declarations may be unnecessary — `width:
calc(100% - 16px)` plus parent centering may suffice. Verify in the
browser.

**Acceptance:**
- [ ] Album detail: Play and Shuffle pills are fully visible with their rounded ends not clipped by the panel.
- [ ] Artist detail: same — Play and Shuffle pills both fit inside the panel.
- [ ] Pill width remains equal between Play and Shuffle (don't regress V3-5-fix3 equalisation).

### GFX-4 — Focused-row accent shade is too dark on Album / Songs / Playlist / Queue

**Symptom:** When a track row is focused, its background tint is darker
than the actual accent colour. The top-nav pill uses the correct shade.
The user wants rows to MATCH the pill's shade. See
`v3-5-fix2-songs-focused.png` in project root.

**Reference (correct shade):** `css/styles.css:389-392` —
`#top-nav-pill.focused { background: rgba(var(--accent-rgb), 0.55); }`

**Files to change:**
- `css/styles.css:2381-2387` — `.track-row.focused` → `0.55`
- `css/styles.css:2100-2106` — `.song-row.focused` → `0.55`
- `css/styles.css:1112-1118` — `.queue-row.focused` → `0.55`
- `css/styles.css:2700-2706` — `.search-result-item.focused` → `0.55`
- Plus any playlist-row focus rule (search for `playlist-row.focused` /
  `playlist-track.focused` / similar)

**Important — scope:** **Only** these row types. Do NOT change focused
backgrounds on cards, sub-nav pills, top nav pills, action buttons,
quick-access cards, or anything else. Run:
```bash
grep -nE 'rgba\(var\(--accent-rgb\), 0\.(15|20|25|30|35|40|45|50)\)' css/styles.css
```
to enumerate every place that uses an accent rgba and confirm you're only
adjusting the row selectors listed above.

**Acceptance:**
- [ ] Focused track rows on Album detail have the same shade as the focused top-nav pill.
- [ ] Focused song rows on Library Songs tab match.
- [ ] Focused queue rows match.
- [ ] Focused search result rows match.
- [ ] Focused playlist tracks match (if applicable).
- [ ] Top-nav pill shade is unchanged. Quick-access cards unchanged. Sub-nav pill unchanged.

### GFX-5 — Search Quick Access cards should match the Genres tile style

**Symptom:** Search → right panel quick access cards currently use a
horizontal icon+label layout (V3-5-fix3). The user wants them to look like
the **Genres** tiles on Library → Genres. See `v3-5-fix-genre-focused.png`
(target) vs `v3-5-fix2-search.png` (current) in project root.

**Reference style:** `css/styles.css:1965-2006` — `.album-grid-card` /
genre tile rendering. Look at how genre tiles render in
`js/screens/library.js` (Genres tab).

**Files:**
- `js/screens/search.js` — find `renderSearchQuickAccess` (the V3-5-fix3
  function name) or equivalent that builds the right panel
- `css/styles.css:2643-2681` — `.quickaccess-card`, `.quickaccess-card-icon`,
  `.quickaccess-card-name`

**Fix:**
1. Rewrite `renderSearchQuickAccess` (or wherever the right panel is built)
   to produce DOM that mirrors the Genres tiles: a stacked `image / coloured
   block on top, label below` layout, not a horizontal flex row.
2. Reuse the existing `.album-grid-card` / genre-tile class names and
   container layout where possible — i.e. add the QA cards as siblings
   inside a grid container styled identically to the Genres grid. If a
   shared class works, prefer that; otherwise create
   `.search-qa-tile` mirroring the Genres tile rules.
3. Keep the same six items the user has now (Favourites, Recently Added,
   Most Played, Rock, Jazz, Electronic) but render each as a vertical tile
   with its coloured square "art" area on top and a label below.
4. Delete the now-unused `.quickaccess-card*` CSS rules at lines 2643-2681.
5. Make sure the focus behaviour (scale 1.08, no border/outline, per the
   v3 design system in CLAUDE.md) matches the Genres tile focus.
6. Verify the cards still register with FocusManager and Enter still
   triggers the right action (filter to favourites / recent / genre).

**Acceptance:**
- [ ] Search → right panel QA tiles look the same as Library → Genres tiles (stacked, coloured tile + label, same border-radius, same focus scale).
- [ ] Each QA tile is keyboard-focusable and Enter still works (favourites, recent, most played, genres).
- [ ] No leftover `.quickaccess-card` styles or DOM in the project.
- [ ] Genres tab itself is unchanged (visual regression check).

---

## RULES
- Vanilla JS, ES2017. No `?.`, no `??`, no `Array.flat()`.
- Animate `transform` and `opacity` only. No `transition: all`. No animating `width`/`margin`/`color`.
- No flex `gap`. Use `grid-gap` (NOT `gap`) on grid containers.
- Run autonomously — do NOT pause to ask questions mid-implementation. Use the test config above.
- After all changes pass browser tests, **rebuild `Sonance.wgt` via `./build.sh`** and **leave `python3 -m http.server 8080` running** so the user can manually inspect on localhost:8080 and on the TV.
- Update `PROGRESS.md` at the end with: what shipped, what was tested, screenshots taken, any deviations from this prompt.

## TESTING

Browser test (Chrome/Firefox at http://localhost:8080):

NAV-1 (back-nav focus restoration):
- [ ] Library Albums → focus 4th tile → Enter → Back → 4th tile focused
- [ ] Library Artists → focus 8th artist → Enter → Back → 8th artist focused
- [ ] Library Genres → focus 3rd genre → Enter → Back → 3rd genre focused
- [ ] Library Songs → focus 5th song → Enter → Back → 5th song row focused
- [ ] Album detail → play song → NP → Back → Album detail (track focus restored)
- [ ] Album from Library → play track → NP → Back → Back → Library Albums tile focused

NAV-2 (Up from grid → top nav):
- [ ] Up from any Library grid → top nav focused (sub-nav unfocused)
- [ ] Left from any Library grid → side sub-nav focused
- [ ] Up from side sub-nav → top nav focused

NAV-3 (Down from top nav → top-left grid item):
- [ ] Slide top nav to Library → Down → first grid tile focused
- [ ] Switch to Artists tab → Up to top nav → Down → first artist focused

NAV-4 (login keyboard):
- [ ] Cold start (clear localStorage) → IP field → Right → Port focused
- [ ] Right repeatedly: IP → Port → User → Password → Connect
- [ ] Left repeatedly reverses
- [ ] Down/Up still work identically to Right/Left

GFX-1, 2 (NP blur + width):
- [ ] NP background visibly more blurred
- [ ] Three different albums tested — no black bars

GFX-3 (pills):
- [ ] Album detail Play/Shuffle pills visually inset, fully rounded ends
- [ ] Artist detail Play/Shuffle pills visually inset, fully rounded ends
- [ ] Both pills equal width

GFX-4 (row accent):
- [ ] grep run; row .focused selectors all use 0.55; non-row selectors unchanged
- [ ] Track / song / queue / search-result / playlist row focus colour matches top-nav pill on a side-by-side screenshot

GFX-5 (search QA = genres):
- [ ] Search QA tiles visually match Genres tiles
- [ ] Focus animation matches
- [ ] Activation still works for each tile

End state:
- [ ] `./build.sh` produced a fresh `Sonance.wgt`
- [ ] `python3 -m http.server 8080` is running and printed in the final message
- [ ] PROGRESS.md updated

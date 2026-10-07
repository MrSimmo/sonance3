# v3.10-fix2 — TV-test findings: Now Playing polish, Focus mode, oblong tile, splash

**Parent ticket:** `tickets/ticket-3.10.md`. **Read it first** — the whole
file, and §11 Amendments to the end (S1–S8 and "S8 follow-up"). Requirement
IDs (R1–R12, A1–A8) and D-numbers below refer to it.

**Hand this file to a fresh Claude Code session started at the project root.**
It is self-contained; assume no memory of earlier sessions.

Reported by the user on 2026-10-05 after testing build **V3.10-fix1** on the
Samsung Q90R ("looking really good so far"):

1. "Transition into now playing leaves the previous screen hanging and then
   it disappears in an instant — there is no fading."
2. "Option to hide Up Next in the Now Playing screen."
3. "Song information modal for Now Playing — don't highlight each row, it
   makes the user think they are menu options. Just have Up/Down to scroll."
4. "Now Playing lyrics button icon is not centred in the pill when
   highlighted."
5. "Oblong icon isn't oblong in the home row."
6. "Intro loading screen is a bit jerky."
7. New feature: "Option to 'focus' in Now Playing — it makes the screen 50%
   darker so the user can focus on the music."

The user settled the design questions on 2026-10-05:
- **Focus** is a **9th button in the Now Playing controls row**.
- **Focus mode** dims Now Playing until it is toggled off, and it is
  **remembered across launches**.
- **Hide Up Next** is a **Settings row**, remembered.
- The no-highlight scrolling applies to **both credits views** (Now Playing's
  ⓘ panel and the options sheet's "Show credits" view).

A planning session (read-only) investigated each item; its findings, with
file:line references checked on 2026-10-05, are under each task. Re-check
the line numbers before editing.

---

## Read first, in this order

1. `CLAUDE.md` (project rules; "v3 UI Design System" is authoritative).
2. `tickets/ticket-3.10.md` — the spec, all of it, §11 included.
3. `PROGRESS.md` — tail only: the last two entries, from
   `## 2026-10-04 08:45 — v3.10 Session 8` (about 380 lines). The file is
   about 570 KB.
4. `docs/UI-MOCKUP-REFERENCE.md` — the design spec. New tokens go here
   **before** CSS.
5. `docs/v3-10-report.md` §4 (the 12-item TV checklist) and §6.
6. `docs/perf-baseline.md` — the "v3.10" part (method for before/after).

Then print the session-start confirmation line the global CLAUDE.md requires.

---

## Standing orders

### Autonomy

Run to completion without asking questions; nobody is watching.
- **Ambiguous and reversible:** make the pragmatic choice, log it with its
  reasoning as a D-number in `PROGRESS.md` and in `tickets/ticket-3.10.md`
  §11 (new subsection "v3.10-fix2 (date)"), and continue. **D-numbers
  continue from D152** (D149–D151 were fix1).
- **Pre-authorised:** editing `js/`, `css/`, `tests/`, `e2e/`, `docs/`,
  `screenshots/`, `index.html`, `build.sh` (cache-bust, packaging),
  `playwright.config.ts`; appending to `tickets/ticket-3.10.md` §11 (never
  edit earlier text silently); `CLAUDE.md` "Navigation" and "v3 UI Design
  System" bullets that this work changes, each citing its D-number; starting
  and stopping the dev server, running Playwright and `./build.sh`, writing
  screenshots; overwriting `Sonance3.wgt` and `Sonance3-Oblong.wgt`, and
  creating the diagnostic package of F5.
- **Stop and log (do not do):** installing any package (`@playwright/test` is
  already in `node_modules`; no `npm install`); deleting files you did not
  create; touching credentials; any live-server write other than those
  allowed below.
- If a task proves wrong or already done, say so, mark it `[~]` with the
  reason, and move on.

### Environment

| | |
|---|---|
| Project root | `/Users/agents/Agent Working Directory/sonance 3` |
| Target | Samsung Q90R, Tizen 5.0, Chromium ~63, 1920×1080, DPR 1 |
| Node | `/Users/agents/.nvm/versions/node/v24.16.0/bin/node`. A bare `node`/`npm`/`npx` recurses in a broken nvm loader and runs nothing |
| Build | `(unset -f node npm npx; PATH="/Users/agents/.nvm/versions/node/v24.16.0/bin:$PATH" ./build.sh)`. Always end with `index.html` bundled |
| Dev server | `node tests/dev-server.js 8091` in the background (port 8080 is taken). Stop it at the end |
| e2e | `node node_modules/@playwright/test/cli.js test` (Playwright 1.63, project-local). A plain run is at 150 % (the app default); `SONANCE_SCALE=1` / `=2` for 100 % / 200 % |
| Node scripts | `require('playwright')` with `NODE_PATH="<project>/node_modules"`; throwaway scripts in the session scratchpad |
| Mock rig | `/tests/mock-index.html?mockAlbums=&mockArtists=&mockSongs=&mockLibraries=…`; fixtures on `window.__MOCK__`; knobs listed at the top of `tests/mock-boot.js`. Helpers: `e2e/helpers/sonance.js` (`bootMock`, `bootBundled`, `navTo`, `downWalk`, `focus`, `settle`, `startTrack`, `watchErrors`, `pngDiff`…). CDP key events for hold/no-keyup: see `e2e/options-sheet.spec.ts` `keys()` |
| Live server | `http://192.168.0.2:4534`, Navidrome 0.64.1, one library; the test account has one playlist, "Test for Claude" (68 songs, one album) |
| LAN proxy | The sandboxed browser cannot reach `192.168.0.2`. Serve live requests through `ctx.route(/^http:\/\/192\.168\.0\.2:4534\//, async (r) => { const resp = await r.fetch({ timeout: 60000 }); await r.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) }); })` |
| Credentials | Only in `TEST-ACCOUNT.local.md` (a table, values in backticks). Parse it inside Node; never print, log, screenshot or write the values, never put them on a command line. Seed a live session via `addInitScript` with `sonance_server_url`, `sonance_username`, `sonance_password`, `sonance_logged_in`, plus `sonance-resume-queue: off`. Never screenshot Settings on live |
| Live writes | Allowed: none needed. Forbidden: star/unstar, playlist edits, any server config. Do not start playback on live |
| Shell | zsh: redirect a run to a file, then read `$?`. Foreground `sleep` is blocked; wait for background jobs with `until [ -f done ]; do sleep 5; done`. Quote heredocs (`<<'EOF'`) |

**Tizen 5.0 / Chromium 63 — non-negotiable:**
- **JS:** ES2017 in the `var`/`function` style. No `?.`, `??`, `Array.flat`,
  `Object.fromEntries` or top-level `await`.
- **CSS:** no `backdrop-filter`. No flex `gap` (use `> * + *` margins); grid
  uses `grid-gap`.
- **Animation:** animate only `transform`/`opacity`. Never `transition: all`;
  never transition layout properties; colour and background snap. Durations
  ≤ 0.25 s.
- **Units:** every new CSS length in rem (`Npx` → `(N/10)rem`); never CSS
  `zoom` (D49). JS design lengths go through `SonanceUtils.rem()`, layout
  maths through `SonanceUtils.px()`.
- **Assets:** no external resources.

### Invariants — never undo (ticket §5.3)

- D6: `translateZ(0)` on the three card classes, at rest and focused.
- D11: grid geometry is measured.
- D17: LazyLoader's two teardown paths.
- D23–D25: album list cursors.
- D32: `scrollIntoView` is gated on `zone.virtual`.
- D33: `.eq-bar` keeps `scaleY(0)`.
- D40: the Search VirtualGrid branch.
- **D47: `.np-bg-image` gets no transform, no translateZ, no scale trick and
  no opacity animation.** A filtered, composited, transformed layer vanished
  on this TV in v3.9.
- V3.7-fix29: the `np-controls` zone keeps a constant selector and a stable
  shape.
- v3.9 NEW-1: the Settings zones are rooted at `#settings-left`.

### Traps

- `build.sh` rewrites the `<script>` block but **not** the stylesheet
  `<link>` `?v=` in `index.html`: bump it by hand. `tests/mock-index.html`
  has its own `?v=` (22 tags) and script list.
- **Never edit an app file or a spec file while a suite is running**; add new
  spec files instead.
- `FocusManager.moveFocus` does not wrap. `setActiveZone` needs `force=true`
  to leave the top nav. A test that calls `setActiveZone` skips the top nav's
  Down handler (the pill stays pink in screenshots).
- Down-walk helpers stop when the zone and index stop changing.
- Tests that hard-code a 150 % pixel size fail at `SONANCE_SCALE=1`: compute
  from the root font size.

### Verification protocol

- **Keyboard only** (`ArrowUp/Down/Left/Right`, `Enter`, `Escape` = Back);
  clicking proves nothing about the d-pad.
- **Viewport:** 1920×1080, DPR 1, headless Chromium.
- **Test first.** Every behaviour added or fixed gets an e2e test. Run each
  new test against the unfixed code and paste its failure (RED), then the
  pass. A guard test that must pass before and after is labelled as such.
- **The suite at the end:** whole suite at 150 % and 100 %; at 200 % at least
  `focus-paths`, `npbar`, `np-controls`, `np-credits`, `np-upnext`,
  `options-sheet`, `transitions`, `focus-style`, `splash`, `bundled-walk` and
  the new specs. Exit 0; paste the tails.
- **Focus clip:** `tests/tools/focus-clip-sweep.js <out.json in the
  scratchpad> 1,1.25,1.5,1.75,2` must stay 0 at every size, with the new
  states added (Focus on, Up Next hidden, credits scrolling).
- **Visual, 100 %:** `tests/tools/visual-baseline.js <dir> --scale 1
  --geometry` against `screenshots/v3-10/baseline-s7/`. Only the intended
  states may differ; report each diff's bounding box.
- **Performance:** CPU 6× via CDP. Before/after numbers go into
  `docs/perf-baseline.md` under "v3.10-fix2", with the "before" served from
  saved copies through `page.route` (the D29 method).
- **Screenshots:** to `screenshots/v3-10/fix2-<name>.png`; read them back.
- **TV-only behaviour cannot be proven in a browser** (D47): it goes into the
  `docs/v3-10-report.md` §4 checklist with what a failure looks like.

---

## Tasks

Suggested order: F4, F1, F3, F2, F7, F6, F5, then close-out.

### F1 — Fade the page under Now Playing's rise (item 1)

**Found.** `js/app.js` `TRANSITIONS` (~:1861):
```
'rise': { inFrom: 'translateY(6rem)', inTo: 'translateY(0)', inMs: 250, outTo: null, ghostBelow: true },
'sink': { inFrom: null, outFrom: 'translateY(0)', outTo: 'translateY(6rem)', outMs: 250, outFadeMs: 200 }
```
- With `outTo: null`, `_runTransition` (~:1906) leaves the outgoing ghost
  still, at full opacity, under Now Playing. `_trackTransition`'s cleanup
  then removes it in one step about 280 ms later.
- Now Playing is not opaque with the Solid background: the opaque base is
  scoped to Gradient (D132, `html.backdrop-gradient .np-screen`). So the old
  page shows through Now Playing during the rise, then pops out. On the TV
  the first frames are slower (the 120 px backdrop, R8/D128), so the old page
  "hangs".
- Rise is used from the bottom bar, by Auto Now Playing and from the Queue's
  Now Playing card (D93); sink only on Back from a Now Playing that rose.
- The top-nav slide into Now Playing already fades and is not affected.

**Change.**
- **Rise:** the ghost stays below and does not move, but fades 1 → 0 over the
  rise (≤ 250 ms, the one easing `TRANSITION_EASE`). It is at opacity 0
  before cleanup removes it.
- **Sink (the mirror, added by the planning session):** the incoming page
  fades 0 → 1 (no movement) while Now Playing sinks, instead of appearing at
  once beneath it.
- Keep the D98 pin, the zoom origin logic and every other transition
  unchanged. Do not touch `.np-bg-image` (D47).

**Acceptance.**
- e2e: sample the ghost mid-rise (≈ 100–150 ms): its computed opacity is
  strictly between 0 and 1. A second sample later is lower. The last sample
  before removal is ≤ 0.1.
- Mid-sink, the incoming page's opacity is strictly between 0 and 1.
- Only `transform`/`opacity` `transitionstart` events occur; every duration
  ≤ 250 ms.
- The existing R2/D98 tests pass. Update `e2e/transitions.spec.ts`
  (`'[R2] Now Playing rises from the bar and sinks on Back'` ~:420, which
  checks the rise ghost) for the new opacity, and say so.
- Mid-rise and mid-sink screenshots at 150 % are read back.
- Now Playing's first-frame time after the bar's OK, at CPU 6×, before and
  after, goes in `docs/perf-baseline.md` (informational).
- TV checklist item 6 says what to look for: the old page fades out under
  Now Playing as it rises, and nothing pops.

### F2 — Settings: hide Up Next (item 2)

**Found.**
- The strip is built in `js/screens/nowplaying.js` `_buildUpNext` (~:785).
  Its header holds the "Up next" label **and the sleep-timer chip**
  (`#np-sleep-chip`, A7).
- `_updateUpNextVisibility` (~:895) toggles `.upnext-on` on `.np-layout`,
  which also moves the column up and caps the cover (D122, `.upnext-tight`
  at 175–200 %).
- Zone `np-upnext` (~:1057) holds the tiles then the chip.
- Settings rows follow the Background row's pattern
  (`js/screens/settings.js` `settings-backdrop-row`, `TOGGLE_ROWS`;
  `SonanceSettings` in `js/app.js:8`).

**Change.**
- **The row:** Settings → Appearance, after Background: "Up next on Now
  Playing ◄ Show / Hide ►". Stored in `localStorage['sonance-np-upnext']`
  (`show`/`hide`), default Show, the same keys as the Background row
  (Left/Right step, Enter toggles). It applies the next time Now Playing
  renders (or live if Now Playing is the current screen: your choice, log
  it).
- **Hidden:**
  - No tiles and no "Up next" label, and no strip build work.
  - `.upnext-on` and `.upnext-tight` are never set, so the column is centred
    and the cover has its pre-S6 size (no D122 cap).
- **The sleep timer must stay reachable** (A7 must not regress): the chip
  alone, centred under the controls, as the only element of `np-upnext`.
  Down from the controls → the chip; Up → Play; Enter cycles it as today. It
  is hidden while lyrics or credits are open, as the strip is.
- `CLAUDE.md` "Navigation" says repeated Down on Now Playing ends on the Up
  Next strip; amend it with the D-number ("…or on the sleep-timer chip when
  Up Next is hidden").

**Acceptance (e2e).**
- **The setting:** cycles and persists across a fresh page; default Show.
- **Hidden:** 0 visible `.np-upnext-tile`; the `np-upnext` zone holds only
  `#np-sleep-chip`; Down from Play → the chip; Enter cycles the sleep label;
  Up → `#np-play`.
- **Layout when hidden:** `.np-layout` lacks `upnext-on` and `upnext-tight`
  at 100–200 %; the cover's rect is the uncapped size; the chip does not
  overlap the controls.
- **Lyrics or credits open:** the chip is not a focus stop.
- **Shown:** everything as today (`e2e/np-upnext.spec.ts` passes unchanged).
- **Focus clip:** 0 with Up Next hidden at every size.
- Screenshots (150 %, hidden and shown) read back.
- `docs/UI-MOCKUP-REFERENCE.md` "Settings" and "Now Playing" updated first.

### F3 — Credits: scroll with Up/Down, no row highlight (item 3, both views)

**Found.**
- **Now Playing ⓘ panel:** zone `np-credits` (`js/screens/nowplaying.js`
  ~:1082) has one stop per `.credit-row` when the panel overflows (D118).
  The focused row takes the v4 row fill, which reads as a menu.
- **The options sheet's credits view:** `js/options-sheet.js` `_showCredits`
  (~:287) makes every row a stop (D140).
- Both render through `SonanceComponents.renderCreditSections` /
  `creditSections` (`js/components.js` ~:520).

**Change, in both views.**
- No credit row is a focus stop and no row is ever highlighted.
- While the view is active, Up/Down scroll its body by a fixed step: about a
  third of the visible height, or three rows; pick one and log it.
- A slim scroll-position indicator on the body's right edge shows the
  position while the view is active. It is not an outline or border focus
  ring (CLAUDE.md bans those): define it in `docs/UI-MOCKUP-REFERENCE.md`
  first, with a token.
- **Implementation hint:** one zone with a single element (the scroller) and
  an `onKey` handler that consumes up/down while it can scroll and returns
  false otherwise, as `np-progress` handles left/right (~:1096). Respect
  the smooth-scroll flag (`html.smooth-scroll`, R1.8, default off: instant
  steps).
- **Now Playing:** Down from the controls enters only when the panel
  overflows (as now). Up at the top returns to ⓘ (np-controls' `entryIndex`
  rule, D118, unchanged). Down at the bottom does nothing.
- **Sheet:** the credits view's zone is its body. Back returns to the
  actions, on "Show credits" (D140 kept). A body that fits does not scroll.

**Acceptance (e2e).**
- Overflowing NP credits: Down from ⓘ makes `np-credits` active. No element
  matches `.credit-row.focused`, and every row's computed background stays
  transparent.
- Each Down raises `scrollTop` by the step until the end; each Up lowers it.
  Up at `scrollTop` 0 → `np-controls` index 7 (`#np-credits`). The indicator
  is visible only while the view is active.
- Sheet credits view: the same, plus Back → the actions with focus on
  "Show credits", and a second Back → the row.
- Rewrite the tests that assert row focus, and say so: `e2e/np-credits.spec.ts`
  (`'R7 overflowing credits…'` ~:217, `'R7 credits that fit…'` ~:267) and
  `e2e/options-sheet.spec.ts` (`'A5 Show credits…'` ~:286). Update the
  credits states in `tests/tools/focus-clip-sweep.js` (~:167–181, ~:226).
- Screenshots of both views mid-scroll (150 %) read back. TV checklist item 9
  updated.

### F4 — Centre the lyrics icon (item 4)

**Found.** `js/screens/nowplaying.js` ~:701:
`createSvg('M3 5h14M3 9h10M3 13h12M3 17h8')`, viewBox `0 0 24 24`, stroke 2
with round caps. The drawn box is x 2–18, y 4–18, centred at (10, 11), not
(12, 12). That is about 3 px left and 1.5 px up at 150 %, visible only when
the round focus platter shows.

**Change.**
- Centre the glyph in its box, e.g. `M5 6h14M5 10h10M5 14h12M5 18h8` (drawn
  box x 4–20, y 5–19).
- Audit every Now Playing control icon (and F7's new one) the same way and
  fix any other that is off by more than 0.5 unit.

**Acceptance.**
- e2e at 100 / 150 / 200 %: for each focused button in
  `.np-screen-controls`, the drawn content's centre (the `path`'s
  `getBoundingClientRect()`, stroke included; or `getBBox()` plus half the
  stroke) is within 1 px of the button's centre on both axes.
- A zoomed crop of the focused lyrics button, before and after, read back.

### F5 — The oblong home-row tile (item 5)

**Found.**
- `Sonance3-Oblong.wgt` is correct as specified by R12: its `icon.png` is a
  1920×1080 RGB PNG, and `config.xml` is byte-identical to the square
  package's. The user reports the tile is still square on the Q90R.
- Research by the planning session, 2026-10-05:
  - **Litefin:** its `normal-oblong` build also only swaps the icon
    (`webpack.config.cjs` on `github.com/MoazSalem/litefin`, branch
    `development`).
  - **A user report:** in Litefin issue #242, a user with a 2019 Tizen 5 TV
    got a "proper sized app banner" by renaming the 1920×1080 file to
    `icon.png`.
  - **Another installer:** Apps2Samsung (formerly Jellyfin2Samsung) patches
    only the icon bytes (`WgtIconPatcher.cs`).
  - **Litefin's metadata tile key:** its `<tizen:metadata
    key="http://samsung.com/tv/metadata/app_tile">` attempt was "just
    ignored" for sideloaded apps (commit 36a7a9b).
  - **Nothing documented** about the TV caching launcher icons.
  - **One forum post** says 2019 sets show sideloaded apps square.
  - **`config.xml` differences:** every working example has a
    `<tizen:profile name="tv"/"tv-samsung"/>`, which Sonance's config lacks.
    Litefin uses `required_version="2.3"`; Sonance uses `5.0`.
- **Most likely causes, ranked (inference):**
  1. The home row keeps a cached square tile, because the oblong package was
     installed over the same app id `S0nance003.Sonance`.
  2. The missing profile element.
  3. The TV's firmware.

**Change.**
1. **TV-side tests for the user** (no build), written into the report §4 item
   1 and the closing reply, in this order:
   1. Remove Sonance's tile from the home row and re-add it from Apps.
   2. Uninstall Sonance, cold-reboot the TV (unplug for 30 s), then install
      `Sonance3-Oblong.wgt` fresh.
   3. Control: install Litefin's own oblong build
      (`Litefin-1.9.0-Tizen-Normal-Oblong.wgt` from its GitHub releases). If
      Litefin is square too, the TV or firmware is the limit, not Sonance.
2. **One diagnostic package, `Sonance3-Oblong-Diag.wgt`**, built by
   `build.sh` from the same build:
   - The oblong package's files, with its **packaged** `config.xml` changed
     in three ways: a new package and app id the TV has never seen
     (`S0nanceOb1` / `S0nanceOb1.Sonance`, 10 alphanumeric characters), the
     name "Sonance Diag", and `<tizen:profile name="tv-samsung"/>`.
   - Stage it in a temp directory as R12 does; the working-tree `config.xml`
     is never edited.
   - It installs as a separate app with its own storage (sign in again;
     uninstall after the test).
   - Keep `required_version="5.0"`. Changing it is a later step, only if
     this package is still square while Litefin's is wide.
   - `build.sh`'s deploy note says the diagnostic package is for that test
     only.
3. **The decision tree, recorded in the report and the ticket:**
   - Diag wide → a later round bisects: the profile, or the new id.
   - Diag square but Litefin wide → try `required_version` next.
   - Everything square → close R12 for this TV with a D-number; the square
     package stays the default.

**Acceptance.**
- Unzip all three packages.
  - The Diag `config.xml` differs from the Oblong one only in the id,
    package, name and profile lines (paste the `diff`).
  - Its `icon.png` is the 1920×1080 RGB one, and every other member is
    byte-identical.
- The working-tree `config.xml` sha256 is unchanged (`78a2f511…`).
- All three packages pass the build gates.
- TV checklist item 1 holds the steps and the decision tree.

### F6 — A smoother launch splash (item 6)

**Found.** `index.html` ~:22–97 (the same text is copied in
`tests/mock-index.html`):
- `.splash-logo` animates `transform: scale(0 → 1)` with an overshoot easing
  over 450 ms, holds, then exits with `scale(1 → 2.2)` and a fade over
  500 ms (§6.7, D138).
- `.splash-tile` carries a large blurred `box-shadow: 0 2rem 8rem` (120 px at
  150 %), and the title is 10rem text. Nothing sets `will-change`.
- **Likely causes (inference; only the TV can confirm):**
  - Chromium 63 re-rasters the scaled layer at changing scales.
  - The 2.2× exit rasters a much larger layer.
  - The bundles (~230 KB) parse and run synchronously during the grow, and
    Home is built during the hold and exit.

**Change** (compositor-friendly, keeping the look):
- **Measure first.** At CPU 6× with CDP tracing on the bundled build
  (`H.bootBundled(page, { splash: 'real' })`), record:
  - the raster and paint tasks during the splash;
  - whether `.splash-logo` has its own layer from the first frame (CDP
    LayerTree);
  - any raster-scale changes.
- **Then, as the measurements justify, in this order:**
  1. `will-change: transform, opacity` on the animated element from the
     first frame.
  2. Take the glow out of the scaled layer (or soften it).
  3. A smaller exit scale (e.g. 1.4).
- A change to §6.7's keyframes is a ticket amendment with a D-number, and
  `e2e/splash.spec.ts` (keyframes sampled through WAAPI) is updated to match.
- Deferring the bundles' execution is out of scope unless the trace shows
  main-thread work stalling the animation in the browser.

**Acceptance.**
- Before/after numbers in `docs/perf-baseline.md`: raster tasks during the
  splash, and layers.
- R11's acceptance still holds: `e2e/splash.spec.ts` passes, with the exit
  within 600 ms of max(hold, first screen) and keys still swallowed.
- TV checklist item 11 says what to compare (smooth grow and exit, no
  stutter).

### F7 — Focus mode: a 9th Now Playing button that dims the screen (new)

**Spec** (the user's choices):
- **The button:** `#np-focus` (`np-ctrl-btn np-ctrl-focus focusable`), after
  ⓘ in `.np-screen-controls`. Its icon is inline SVG, sized in rem, centred
  (F4's check), for example a half-filled circle. Add it to the design doc
  first.
- **The zone:** `CONTROLS_COUNT` 8 → 9 (`js/screens/nowplaying.js` ~:72). The
  selector stays constant (V3.7-fix29). `PLAY_INDEX` 2 and `CREDITS_INDEX` 7
  are unchanged, and every Up/Down entry still lands on Play (R3).
- **The row must fit** the 48rem column at 100–200 %. Eight buttons measured
  47.2rem at a 2rem gap (D120); a ninth needs about 6rem more, so the gap
  drops to about 1.2rem (a 9-button row ≈ 37.2rem plus gaps). Measure,
  choose, and log the D-number. Focus clip must stay 0.
- **Enter toggles Focus mode:**
  - A full-screen overlay inside the Now Playing screen, `.np-focus-dim`:
    black at **50 %**, a token such as `--np-focus-dim: rgba(0, 0, 0, 0.5)`,
    added to the design doc first.
  - It fades in and out with `opacity` over 0.25 s and takes no pointer
    events. It sits over the backdrop, cover, text, controls and Up Next.
  - It dims only the Now Playing page; the top nav, when it shows, is not
    dimmed.
  - The remote keeps working through the dim.
- **Button state:** the button shows the "on" state like an open panel's
  button (accent icon at rest, ink when focused: the `.is-active.focused`
  pattern, D121). It is available with or without a track (not D55-dimmed).
- **Remembered:** `localStorage['sonance-np-focus']` (`on`/`off`), default
  off, applied when Now Playing renders. It stays on until toggled off.
- **Layers:** no animation at rest; record the CDP LayerTree count at rest,
  off and on. D47 is untouched: the overlay is a sibling, and `.np-bg-image`
  gets nothing.
- Update the tests that assume 8 buttons or ⓘ as the last one, and say so:
  `e2e/np-credits.spec.ts` (`ROW`, `'R7 the controls row is 8 wide…'`) and
  any check in `e2e/np-controls.spec.ts`, `e2e/focus-style.spec.ts` or the
  focus-clip sweep that counts the row. The walks that reach lyrics by
  Right ×4 from Play are unaffected (the new button comes after ⓘ).

**Acceptance (e2e).**
- 9 buttons in order; Down from the progress bar and from the top nav →
  `#np-play`.
- Enter on `#np-focus` → the overlay's computed opacity reaches 0.5 and the
  button is active; Enter again → 0.
- The overlay's rect covers the viewport; the state persists across a fresh
  page.
- The row's width ≤ the column's at 100 / 125 / 150 / 175 / 200 %; focus clip
  is 0.
- Screenshots at 150 %, off and on, read back. New TV checklist line (in item
  9 or 10): the dim is even and smooth, with no backdrop flicker (D47).

---

## Close-out (definition of done)

1. Every task is `[x]`, `[!]` (with reason) or `[~]` (with reason and
   unblocking condition).
2. **Version marker (as D151):**
   - cache-bust `v3-10-fix2`: `build.sh` `CACHE_BUST`, the `index.html`
     stylesheet link (by hand), and `tests/mock-index.html`;
   - Settings → About reads `V3.10-fix2`.
3. `node --check` passes on every modified `.js`.
4. **Regression greps all hold:**
   ```bash
   grep -rn "innerHTML" js/*.js js/screens/*.js | grep -v "no innerHTML" | grep -v min.js   # only the nowplaying.js comment
   grep -nE "transition: *all" css/styles.css                                              # only the comment near the top
   grep -nE "transition[^;]*(width|height|margin|padding|left|right|top|bottom|font-size|border)" css/styles.css   # none
   grep -n "backdrop-filter" css/styles.css                                                # none
   grep -nE "(^|[^-a-z])gap:" css/styles.css                                               # none
   grep -rn "setInterval" js/                                                              # none
   grep -nE "(^|[;{ ]) *zoom *:" css/styles.css; grep -rn "style\.zoom" js/                # none
   grep -nE "transition:[^;]*background" css/styles.css                                   # none
   ```
   - D6 holds.
   - The `.np-bg-image` rule has no `transform` and no `transition`.
5. The suite exits 0 as the protocol requires; paste the tails.
6. **Build:**
   - `./build.sh` exits 0 with its gates (`?.`/`??` in the bundles;
     `backdrop-filter` / `transition: all` / bare `gap:` in the packaged CSS).
   - `Sonance3.wgt`, `Sonance3-Oblong.wgt` and `Sonance3-Oblong-Diag.wgt` are
     rebuilt and checked by unzip.
   - `index.html` is left bundled.
7. **Docs:**
   - `tickets/ticket-3.10.md` §11 "v3.10-fix2" (each change, its D-number,
     how acceptance was read);
   - `docs/UI-MOCKUP-REFERENCE.md` (tokens and surfaces first);
   - `docs/perf-baseline.md` "v3.10-fix2";
   - `docs/v3-10-report.md`: §1 a "v3.10-fix2" section, §4 items 1, 6, 9,
     10, 11 updated, §6 if a decision changed;
   - `next_prompt.md` (the programme-complete report): one bullet for
     fix2;
   - `CLAUDE.md` Navigation, if F2 changed it.
8. **`PROGRESS.md`:** a new entry appended at the bottom in the house format
   (`## YYYY-MM-DD HH:MM — v3.10-fix2: …`, then Scope / Model / Tasks /
   Changes / Spec / Decisions / Verified / Next), with the pasted evidence.
9. **Credential hygiene:** no value in any file you wrote. A live probe
   prints counts and timings only. Any request URL recorded anywhere has `t`
   and `s` redacted.
10. The dev server is stopped.

## Out of scope

- The other `docs/v3-10-report.md` §6 decisions:
  - `CLAUDE.md` "Transitions";
  - the content width;
  - D119 (Back with lyrics open);
  - D122, D127, D131, D139, D140 (beyond F3's scrolling) and D142;
  - the two S7 findings.
- The §7 security items: `.playwright-mcp/`, password rotation, history
  redaction. Report only, never edit `PROGRESS.md` history.
- Any change to the backdrop blur (R8/D47), the auth flow, AVPlay, or the
  sleep timer's behaviour (only the chip's placement when Up Next is hidden).
- Bisecting the oblong tile beyond the one diagnostic package.
- Deleting the stray `Sonance3udEx.wgt` / `Sonance3uDYB.wgt` or any file you
  did not create.

## Verification (how the executor confirms it worked)

- **RED then GREEN** pasted for each new or changed behaviour (F1, F2, F3,
  F4, F7; F6 only if a keyframe changes).
- **Suite:** whole suite at 150 % and 100 %, the listed specs at 200 %, each
  exit 0.
- **Checks:** focus-clip sweep 0 at five sizes; the 100 % visual diff
  confined to the intended states (the About row, Settings' new row, Now
  Playing's controls).
- **Measurements:** NP first frame (F1), splash raster/layers (F6), and the
  Focus overlay's layer count (F7).
- **Live:** the bundled build through the proxy (resume off, no playback, no
  Settings screenshot). Now Playing with Up Next hidden and with Focus on;
  credits scrolling on a live song; "Test for Claude"'s songs reach Now
  Playing with the rise fade. 0 page errors, 0 responses ≥ 400, no write
  endpoints.
- **Packages:** all three unzipped and compared; the working-tree
  `config.xml` and `icon.png` unchanged.
- **The closing reply** gives the user the F5 TV tests in order, and which
  package to install for the rest (`Sonance3.wgt` or `Sonance3-Oblong.wgt`),
  with "About reads V3.10-fix2" as the check.

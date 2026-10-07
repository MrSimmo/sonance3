# Sonance v3.10 — TV-scale UI & snappiness programme

**Chained session prompt.** Hand this file to a **fresh Claude Code session
(Opus 5.5 @ xhigh)** started at the project root. It is self-contained.

Each session:
1. executes **one** session of PART B;
2. verifies it with Playwright;
3. rebuilds the `.wgt`;
4. writes `next_prompt.md` at the project root for the next fresh session;
5. stops.

Repeat until PART B is exhausted.

**Read first, every session, in this order:**
1. `CLAUDE.md`
2. `tickets/ticket-3.10.md` — the spec. Requirement IDs R1–R12 and A1–A8 refer
   to it.
3. `PROGRESS.md` — tail only (`tail -250`). The file is about 420 KB.
4. `docs/UI-MOCKUP-REFERENCE.md`
5. The mockups the session's tasks name (`tickets/mockup-3.10-*.jpg`).
   Read them as images.

Then print the session-start confirmation line that the global CLAUDE.md
requires.

---

# PART A — Standing orders

> **Copy PART A verbatim into every `next_prompt.md`. Do not edit or summarise it.**

## A1. Autonomy

Run to completion without asking questions. Nobody is watching.

- **Ambiguous and reversible:** make the pragmatic choice, log it and the
  reasoning as a D-number in `PROGRESS.md`, and continue. D-numbers continue
  from **D60**; D49–D59 are pre-assigned in `ticket-3.10.md` §3.2.
- Never stop to ask "shall I…?". Never end a turn on a plan or a promise.
- **Pre-authorised (do not ask):**
  - editing anything under `js/`, `css/`, `tests/`, `e2e/`, `docs/` and
    `screenshots/`;
  - editing `index.html`, `build.sh` (`CACHE_BUST`, the file lists, the dev
    block, the oblong packaging for R12) and `playwright.config.ts`;
  - creating `icon-oblong-1920.png` at the project root (R12), and rebuilding
    `Sonance3-Oblong.wgt`, which overwrites the stale v3.9 build output;
  - editing `tickets/ticket-3.10.md` (spec amendments: note them, never
    silently) and `tickets/prompt-3.10.md` (PART B status marks only);
  - editing `CLAUDE.md`, **only** for the amendments listed in
    `ticket-3.10.md` §5.5, each citing its D-number;
  - replacing the boilerplate `e2e/example.spec.ts`. It loads playwright.dev, an
    external site, which breaks the no-external-requests rule.
  - starting and stopping the dev server, running Playwright, running
    `./build.sh`, and writing screenshots.
- **Stop and log only for:**
  - installing any package (`@playwright/test` is already in `node_modules`;
    do not run `npm install`);
  - deleting user data or any file not named above;
  - touching credentials;
  - server writes beyond `ticket-3.10.md` §5.4.
- **If the live server is unreachable or the credentials are rejected, do not
  stop.** Use the mock rig. Mark live-only checks `[!]` with the reason and
  carry them forward.
- If a task proves wrong, unnecessary or already done, say so, mark it `[~]`
  with the reason, and move on. If the brief's premise is wrong, record that
  (v3.9 D40 style) rather than working around it.

## A2. Environment

| | |
|---|---|
| Project root | `/Users/agents/Agent Working Directory/sonance 3` |
| Target | Samsung Q90R, Tizen 5.0, Chromium ~63, 1920×1080, DPR 1 |
| Node | `/Users/agents/.nvm/versions/node/v24.16.0/bin/node`. A bare `node`/`npm`/`npx` recurses in a broken nvm lazy-loader and runs nothing. Call the absolute path. For `build.sh`, use `PATH="/Users/agents/.nvm/versions/node/v24.16.0/bin:$PATH" ./build.sh` |
| Dev server | `node tests/dev-server.js 8091`, run in the background. **Port 8080 is taken by OrbStack.** It serves static files plus synthetic `getCoverArt` PNGs and a `stream.view` WAV. Stop it at the end |
| Unbundled build | `./build.sh --dev` restores individual `<script>` tags. `./build.sh` re-bundles. Always end with `index.html` **bundled** |
| e2e runner | `node node_modules/@playwright/test/cli.js test` (Playwright 1.63.0, project-local) |
| Node API scripts | `require('playwright')` with `NODE_PATH="<project>/node_modules"`. Put throwaway scripts in the session scratchpad |
| Playwright MCP | **Broken** (`ENOENT: npx`). Do not use it |
| Mock rig | `/tests/mock-index.html?mockAlbums=&mockArtists=&mockSongs=&mockLibraries=&mockUserScope=1`, which seeds `mockuser`/`mockpass`. Fixtures are on `window.__MOCK__`. `tests/avplay-stub.js` is a scriptable AVPlay double; its `pending` array is page-global and `reset()` clears only the log. New endpoints the sessions need are added to `tests/mock-boot.js` |
| Bundled build under test | `/index.html` with `tests/mock-boot.js` injected through `addInitScript` |
| Live server | `http://192.168.0.2:4534`: Navidrome 0.63.2, OpenSubsonic, 7 libraries, 14,000+ songs |
| LAN proxy | **The sandboxed browser cannot reach `192.168.0.2`** (`Failed to fetch`), while Node can. Serve live requests through the Node-side driver with `ctx.route(/^http:\/\/192\.168\.0\.2:4534\//, async (r) => { const resp = await r.fetch({ timeout: 30000 }); await r.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) }); })`. Do not try to disable the sandbox |
| Credentials | `TEST-ACCOUNT.local.md` only, as a table (`\| Username \| \`…\` \|`). **On 2026-10-01 they were rejected (Subsonic error 40), probably rotated.** At session start, verify with a Node-side `ping.view` that parses the file and prints only ok/failed. Never print, log, screenshot or write the values, and never put them on a command line |

**Tizen 5.0 / Chromium 63 — non-negotiable:**
- ES2017 only: no `?.`, `??`, `Array.flat`, `Object.fromEntries`, `BigInt` or
  top-level `await`. Match the `var`/`function` style.
- No `backdrop-filter`. No flex `gap`. Grid uses `grid-gap`.
- Animate only `transform`/`opacity`. Never `transition: all`. Never
  transition layout properties.
- No CSS `zoom` for scaling (D49).
- No external resources. Everything ships in the `.wgt`.

## A3. Verification protocol

The user's manual TV testing should be a short checklist, not a bug hunt.

1. **Keyboard only.** `ArrowUp/Down/Left/Right`, `Enter`, and `Escape` as Back.
   Clicking bypasses `FocusManager` and proves nothing about the d-pad.
2. **Viewport 1920×1080, DPR 1, headless Chromium.** Run at interface size
   100% **and** 150% (the default); 200% where the task says so.
3. **The e2e suite is the regression net.** Every behaviour a session adds or
   fixes gets a spec under `e2e/`. Known bugs are first encoded as
   `test.fail()` with the requirement ID, then flipped when fixed. The suite
   must exit 0 at the end of the session; paste the tail of the output. A test
   may be skipped only with a recorded reason.
4. **Performance.** CPU 6× via CDP (`Emulation.setCPUThrottlingRate`) as an
   indicator. Every performance claim is a measured before/after number in
   `docs/perf-baseline.md` under "v3.10". For "before", serve copies of the
   pre-change files saved to the scratchpad through `page.route` (v3.9 D29
   method).
5. **Screenshots** go to `screenshots/v3-10/s<N>-<name>.png`. **Read them back**
   and compare them against the mockups and against the session's intent. Use
   canvas pixel diffs where identity is claimed.
6. **TV-only behaviour cannot be proven in a browser** (D47). Anything whose
   correctness depends on Chromium 63, the compositor or Tizen input goes into
   the `docs/v3-10-report.md` TV checklist, with what a failure would look
   like. Never claim it is verified.

## A4. Invariants — never undo

The v3.9 invariants are listed with reasons in `ticket-3.10.md` §5.3: D6, D11,
D17, D23–D25, D32, D33, D40, D47, fix29 zone-shape stability, and the Settings
zones rooted at `#settings-left`. Read them before editing `utils.js`,
`library.js`, `focus.js`, `api.js`, `nowplaying.js` or `settings.js`.

**Traps:**
- `build.sh` rewrites the `<script>` block but **not** the stylesheet `<link>`
  `?v=`. Bump `index.html`'s CSS link by hand.
- `tests/mock-index.html` has its own `?v=` and its own script list. New JS
  files go into `build.sh` `CORE_FILES`/`SCREEN_FILES`, the `--dev` block, and
  `tests/mock-index.html`.
- `FocusManager.moveFocus` does not wrap. `setActiveZone` needs `force=true` to
  leave the top nav.
- The Albums grid pages by Down. Use Down, not a serpentine walk, unless
  per-index integrity is what is being measured.
- `_albumsAll` is module-private. To read what the grid holds, wrap
  `SonanceUtils.VirtualGrid.prototype.init` and stash `this`.
- Playwright's Chromium cannot decode some of the test server's FLACs. Use mp3
  tracks for playback-progress checks.

## A5. Definition of done — every session

Evidence for each item goes into `PROGRESS.md` as pasted output.

1. Every task in PART C is `[x]`, `[!]` (with reason) or `[~]` (with reason and
   unblocking condition).
2. Every acceptance criterion has a pasted measurement, test output or
   screenshot path.
3. `node --check` passes on every modified `.js` file.
4. **Regression greps** — every one must hold:
   ```bash
   grep -rn "innerHTML" js/*.js js/screens/*.js | grep -v "no innerHTML"    # only the nowplaying.js comment
   grep -nE "transition: *all" css/styles.css                               # only the comment near the top
   grep -nE "transition[^;]*(width|height|margin|padding|left|right|top|bottom|font-size|border)" css/styles.css   # none
   grep -n "backdrop-filter" css/styles.css                                 # none
   grep -nE "(^|[^-a-z])gap:" css/styles.css                                # none
   grep -rn "setInterval" js/                                               # none
   grep -nE "(^|[;{ ]) *zoom *:" css/styles.css; grep -rn "style\.zoom" js/ # none (D49)
   grep -nE "transition:[^;]*background" css/styles.css                     # none once S3 is done
   ```
   - D6 holds: `translateZ(0)` is still on `.album-card`, `.album-grid-card`
     and `.artist-grid-card`, at rest and focused.
   - D47 holds: the `.np-bg-image` rule has no `transform`.
5. `node node_modules/@playwright/test/cli.js test` exits 0. Paste the summary.
6. `./build.sh` completes with both gates passing (`?.`/`??` in the bundles;
   `backdrop-filter`/`transition: all`/bare `gap:` in the packaged CSS).
   `Sonance3.wgt` and (from Session 1 on) `Sonance3-Oblong.wgt` are rebuilt,
   and `index.html` is left bundled.
7. Cache-bust is `v3-10` everywhere: the `index.html` CSS link and scripts,
   `build.sh` `CACHE_BUST`, and `tests/mock-index.html`. The Settings About row
   reads `V3.10`.
8. The spec and design docs are updated for every behaviour or token change
   (`ticket-3.10.md` amendments, `docs/UI-MOCKUP-REFERENCE.md`, the
   `CLAUDE.md` §5.5 amendments). `docs/v3-10-report.md` TV checklist is
   appended.
9. `PROGRESS.md` gets a new entry **appended at the bottom** in the house
   format: `## YYYY-MM-DD HH:MM — title`, then Scope / Model / Tasks / Changes /
   Spec / Decisions / Verified / Next.
10. `next_prompt.md` is written per A6.
11. The dev server is stopped.

## A6. The `next_prompt.md` contract

Overwrite `next_prompt.md` at the project root. It must be self-contained:

- **PART A** — this section, verbatim.
- **PART B** — the full programme, with completed items marked `[x]` and the
  session that did them. Carry `[!]` and `[ ]` items forward. Append newly
  found work to the right session.
- **PART C** — the next session's tasks only, at the detail of the PART C
  below: paths, line references (re-checked against the current code), the
  change, and checkable acceptance criteria taken from `ticket-3.10.md`.
- **PART D** — state carried forward: baselines, decisions so far, `[!]` items,
  environment facts (live server reachable? credentials valid?), and anything
  the next session needs.

The session that finishes Session 8 writes a short **programme-complete
report** instead: what shipped, the before/after numbers, what was not done,
and the TV checklist.

---

# PART B — The programme

Eight sessions, one per fresh Claude Code session. Requirement IDs refer to
`tickets/ticket-3.10.md` §7.

| Session | Content | Requirements | Risk | Status |
|---|---|---|---|---|
| **1** | Test harness, baselines, performance overlay, version bump, design-spec rewrite, oblong-icon package | R1.1, R12 + foundations | Low | [x] S1 2026-10-01 |
| **2** | Interface size (px → rem, Settings row, live apply) | R4 | **High** — touches every rule | [x] S2 2026-10-01 |
| **3** | Focus and navigation: v4 focus, NP entry index, bottom-bar target, artist on rows | R6, R3, R9, R5 | Medium (focus core) | [x] S3 2026-10-01 |
| **4** | Navigation speed and transitions | R1.2–R1.5, R2 | Medium (router) | [x] S4 2026-10-01 |
| **5** | Lists at scale: incremental `VirtualGrid`, virtual song lists, full Songs, album sort/filter, smooth-scroll experiment | R1.6–R1.8, A1, A2 | Medium (D11/D17/D23 areas) | [x] S5 2026-10-02 |
| **6** | Now Playing: 2× blur, credits, Up Next, sleep timer, resume queue | R8, R7, A6, A7, A8 | Medium | [x] S6 2026-10-02 |
| **7** | Shell and discovery: splash, gradient backdrop, playlist mosaics, Home rows, hold-OK options sheet | R11, R10, A3, A4, A5 | Medium (Enter semantics) | [x] S7 2026-10-02 |
| **8** | Final verification, credential audit, TV readiness, report | all | Low | [x] S8 2026-10-04 |

**Why this order.**
- S1 builds the net that every later session relies on.
- S2 comes before any visual work, so all new CSS is written in rem once.
- S3's focus tokens and `FocusManager` options are used by S4–S7.
- S4's router changes come before the new screens and zones.
- S8 only verifies.

## Session 1 — Harness, baselines, overlay, version — [x] (2026-10-01)

- [x] T1 Environment and credential check; dev server on 8091
- [x] T2 e2e suite foundation; replace the boilerplate spec; characterisation specs, including known bugs as `test.fail()`
- [x] T3 Visual baselines at 100% for every screen state
- [x] T4 v3.10 performance baseline in `docs/perf-baseline.md`
- [x] T5 Performance overlay plus Settings → Advanced section (R1.1)
- [x] T6 Version bump to v3.10
- [x] T7 Rewrite `docs/UI-MOCKUP-REFERENCE.md` (as-built v3 plus v4 targets); create `docs/v3-10-report.md`
- [x] T8 Oblong home-row package `Sonance3-Oblong.wgt` (R12, supersedes D46 via D59)
- [x] T9 Log D49–D59 and the planning session in `PROGRESS.md`

## Session 2 — Interface size — [x] (2026-10-01)

- [x] Add the v4 scale tokens to the design doc first. Then convert
      `css/styles.css` px → rem per `ticket-3.10.md` §6.1, keeping hairlines
      and the NP blur in px.
- [x] Add `SonanceUtils.uiScale()`, `rem(px)` and `px(n)`. Convert JS inline
      lengths (about 74 `style.*` px assignments) and px layout maths.
      Measured geometry stays measured (D11).
- [x] Add a pre-paint inline `<head>` script in `index.html` and
      `tests/mock-index.html`, defaulting to 1.5.
- [x] Settings → Appearance "Interface size" row. Generalise
      `settings-actions` `onKey` from the Auto-NP special case to a per-row
      handler map.
- [x] `App.applyUiScale` live apply: nav rect re-measure, current-screen
      re-render, focus kept on the row, playback uninterrupted.
- [x] Acceptance per R4. The 100% pixel-identity gate against the S1 baseline
      is the primary evidence. e2e passes at 100/150; focus paths pass at 200.
- [x] CLAUDE.md Layout amendment (D49). Add R4 to the TV checklist (rem
      rendering on Chromium 63).

## Session 3 — Focus and navigation — [x] (2026-10-01)

- [x] v4 focus tokens (§6.3). `applyAccentColor` computes `--focus-ink` and
      `--focus-ink-soft` (D50). Replace every `.focused` rule. Remove
      `transition: background` and the outline on `.settings-toggle-row`.
      Acceptance per R6.
- [x] `FocusManager` zone options `entryIndex` and `isAvailable` (D54, D56).
      `np-controls` enters on Play. Dim the lyrics button instead of hiding it
      (D55). Acceptance per R3.
- [x] `App.registerNowPlayingBarZone`; `.np-bar-open` target; Up returns to
      the origin item; the Library sub-nav's last tab reaches the bar.
      Acceptance per R9, an all-zones Down-walk e2e.
- [x] Artist line on album rows; playlist rows get thumbnails; audit all six
      lists. Acceptance per R5.
- [x] CLAUDE.md Focus Styles + Navigation amendments (D50, D54–D57).

## Session 4 — Navigation speed and transitions — [x] (2026-10-01)

- [x] Interruptible transitions; remove `TRANSITION_LOCK_MS`; finish-now
      helper for slide, zoom and `zoomContent` (R1.2).
- [x] Dwell auto-navigation for the top nav and the Library sub-nav (R1.3,
      D51). CLAUDE.md Navigation amendment.
- [x] Per-screen render/activate timing table at CPU 6×; defer work over
      16 ms (R1.4). (No screen over 16 ms; no deferral, D96.)
- [x] Prefetch on 400 ms focus dwell (R1.5).
- [x] Zoom from origin, rise/sink for Now Playing, new slide easing (R2).
      Screenshots taken mid-transition.

## Session 5 — Lists at scale — [x] (2026-10-02)

- [x] Incremental `VirtualGrid` recycling (R1.6); D17 semantics kept; full
      traversal integrity.
- [x] Virtualise Playlist detail, Queue, Genre songs and Songs (R1.7) against
      the 14,000-row targets.
- [x] Complete Songs list through `search3` paging, with order/A–Z determined
      on live (A1): creation order, so no rail. Genre detail pages by offset.
- [x] Album sort/filter header through `AlbumListCursor` per-type comparators;
      counts only where exact (A2).
- [x] Smooth-scroll experiment behind Advanced, default Off (R1.8). Add it to
      the TV checklist.

## Session 6 — Now Playing — [x] (2026-10-02)

- [x] Blur 120 px on the same element (R8); edge-luminance check on 3 aspect
      ratios (within 0.3 %; raster ~2x, D128).
- [x] `SubsonicAPI.getSong`; credits button and panel; `np-credits` scroll
      zone; mock OpenSubsonic fields (R7; live fields recorded, D115–D121).
- [x] Up Next strip zone (A6); sleep-timer chip (A7) (D122–D125).
- [x] Resume queue: Settings row, save throttling, `Player.restoreQueue`
      (A8). Mock `getPlayQueue`/`savePlayQueue`; live POST save and
      fresh-context restore (D126, D127).

## Session 7 — Shell and discovery — [x] (2026-10-02)

- [x] Splash in `index.html` (R11), outside the script markers; key
      swallowing; exit conditions; e2e on the bundled build (D129, D135–D138).
- [x] Gradient backdrop setting (R10) (D130, D132).
- [x] Playlist cover mosaics (A3); Home rows (A4) (D131, D139). A3's live
      check is `[!]`: the test account has no playlists.
- [x] Hold-OK options sheet, including press/hold detection with the no-keyup
      fallback (A5). TV checklist item 28 (D133, D134, D140–D144).

## Session 8 — Final verification and report — [x] (2026-10-04)

- [x] Full e2e at 100/150/200% on the mock rig; live checked by the
      bundled-build walk through the LAN proxy (the suite is mock-rig only).
- [x] Bundled-build walk of every screen (`e2e/bundled-walk.spec.ts`, and
      live).
- [x] Credential audit: shape-based, plus derived `t`/`s` tokens
      (`prompts/pre-release-security-scan.md` §1g/§1h), widened to
      `.playwright-mcp/` and every session's scratch files. The known prose
      leak (`PROGRESS.md` lines 281 and 2366) reported, not edited
      (`docs/v3-10-report.md` §7, D145).
- [x] `docs/v3-10-report.md`: what shipped, before/after table (checked
      against its sources), deviations, the final TV checklist (12 items),
      and the overlay readings to take on the TV.
- [x] Programme-complete `next_prompt.md`.

---

# PART C — THIS SESSION: Session 1 — Harness, baselines, performance overlay, version

Work the tasks in order. T2–T4 must finish before T5 changes any behaviour,
because they are the "before".

## T1 — Environment and credential check

- **Dev server.** Start `node tests/dev-server.js 8091` in the background.
  Confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:8091/index.html`
  returns 200.
- **Credentials.** From a Node one-off that parses `TEST-ACCOUNT.local.md`
  (never printing values): compute `t = md5(pass + salt)` and call
  `http://192.168.0.2:4534/rest/ping.view?...&f=json`. Print only `ok` or
  `failed <code>`.
- **If ok:** confirm the browser path works through the LAN proxy (A2) by
  booting the app with a seeded session, and record "live available" in PART D.
- **If failed:** record "live unavailable (code N)". Every live-only check this
  programme becomes `[!]` until the user updates the file.

**Acceptance:** both results pasted. No credential value appears in any
output.

## T2 — e2e suite foundation

**Config.** Rewrite `playwright.config.ts`:
- `testDir: 'e2e'`, Chromium project only;
- `viewport {1920,1080}`, `deviceScaleFactor: 1`;
- `` webServer: { command: `"${process.execPath}" tests/dev-server.js 8091`, url: 'http://localhost:8091/index.html', reuseExistingServer: true } ``.
  Using `process.execPath` avoids the broken bare `node` (A2).
- `baseURL: 'http://localhost:8091'`;
- `reporter: 'list'`, `workers: 1`, `fullyParallel: false`. Deterministic
  timing matters more than speed here.

**Boilerplate.** Replace `e2e/example.spec.ts` (pre-authorised).

**Helpers** (`e2e/helpers/`):
- `bootMock(page, {albums, artists, songs, libraries, scale})` navigates to
  `/tests/mock-index.html?...`. `scale` seeds `sonance-ui-scale` once S2
  exists; until then it is ignored.
- `bootBundled(page)` loads `/index.html` with `tests/mock-boot.js` through
  `addInitScript`.
- `press(page, key, n, gapMs)`.
- `focus(page)` → `{ zone, index, id, visible }`. `visible` means not
  `display:none`, not `visibility:hidden`, opacity > 0, and inside an ancestor
  that is not hidden.
- `downWalk(page, maxSteps)` presses Down until the focus snapshot stops
  changing, keyed on zone + index, not class names.
- `countRenders(page)` wraps the nine `XScreen.render` functions.
- `startTrack(page, n)` calls `Player.setQueue(window.__MOCK__.songs.slice(0, n), 0)`.

**Characterisation specs.** Each encodes **today's** behaviour. Use
`test.fail()` with the requirement ID where today's behaviour is the bug:

| Spec | What it encodes |
|---|---|
| `focus-paths.spec.ts` | Per screen, the zone sequence of a Down-walk from the top nav (with and without a track) |
| `np-controls.spec.ts` | R3: Up then Down → shuffle today, `test.fail` expecting Play. Also Right ×6 lands on the hidden lyrics button, `test.fail` expecting a visible element |
| `npbar.spec.ts` | R9: no track → Down enters the invisible bar, `test.fail`. Enter on the bar's first item → previous track, `test.fail` expecting Now Playing. Library sub-nav Down on the last tab wraps, `test.fail` |
| `transitions.spec.ts` | R1.2: Enter then Back @120 ms → still on the album, `test.fail`. R1.3: 4× Right @90 ms → 2 renders today, `test.fail` expecting 1 |
| `grid-recycle.spec.ts` | R1.6: nodes created and kept per one-row Down step on `mockAlbums=1200` (today 350–953 created, 0 kept). `test.fail` against the R1.6 thresholds; log the numbers |
| `album-rows.spec.ts` | R5: album track rows have an artist line, `test.fail` |
| `smoke.spec.ts` | Every primary screen renders with 0 page errors on mock and on the bundled build. The only non-2xx allowed is the Tizen-only `$WEBAPIS/webapis/webapis.js` 404 |

**Acceptance:** the suite exits 0, with the expected failures counted as
expected. Paste the summary.

## T3 — Visual baselines at 100%

On the mock rig (`mockAlbums=120&mockArtists=80&mockSongs=400`, with a track
started and then paused), screenshot every screen state to
`screenshots/v3-10/baseline/`:
- Home;
- Library Albums, Artists, Songs and Genres, plus genre detail;
- Album detail; Artist detail;
- Playlists grid and detail;
- Queue; Search (empty, and with a query);
- Settings, top and scrolled to the bottom;
- Now Playing, and Now Playing with lyrics (mock lyrics if needed);
- the exit dialog; Login, with no session.

Use the same deterministic state for each: same fixture query (the mock
fixtures are deterministic), same focus target, paused playback. Then capture
them twice and confirm 0 differing pixels between the runs. S2's
pixel-identity gate depends on it. **If anything animates (equaliser bars,
progress), freeze it** for the capture: pause playback, and use
`page.emulateMedia` or an injected `animation-play-state: paused`. Document
the method.

**Acceptance:** about 20 PNGs, a determinism check showing 0-pixel diffs
between two runs, and the method written into `docs/perf-baseline.md`
"v3.10 visual baseline".

## T4 — v3.10 performance baseline

Add a "v3.10 baseline (S1)" section to `docs/perf-baseline.md` with method and
numbers, at CPU 6×:
- **Grid recycle:** nodes created and kept per one-row step at
  `mockAlbums=1200`.
- **Top-nav flick:** renders for 4× Right @90 ms.
- **Library sub-nav:** tab builds for Down ×3 @90 ms.
- **Transition drop:** Enter/Back @120 ms outcome.
- **First frame:** keypress → first-frame latency (keydown → 2 rAF) for top-nav
  Right, Enter album, Back, Down in grid, opening Now Playing.
- **Render cost:** per-screen synchronous `render` + `activate` ms (wrap both).
- **Long lists:** playlist detail and Queue at 500/5,000/14,000 rows —
  elements, first paint, ms per keypress (re-run v3.9 S6 T2's method).

The planning session's numbers, to reproduce: grid 0 of 50–72 kept,
350–953 created; flick 2 renders; Back dropped; first frame 17–54 ms with
0 long tasks.

**Acceptance:** every row filled or marked "not measurable: reason".

## T5 — Performance overlay (R1.1)

**New file** `js/perf-hud.js`, exposing global `PerfHud` with
`enable()`/`disable()`/`isEnabled()`. Add it to `build.sh` `CORE_FILES` after
`components.js`, to the `--dev` block, and to `tests/mock-index.html`.

**Settings.** Add an "Advanced" section between Playback and Account in
`js/screens/settings.js`, with a `.settings-toggle-row` "Performance overlay"
(Off/On) stored in `localStorage['sonance-perf-hud']`.
- The row joins `settings-actions` automatically, because that selector is
  rooted at `#settings-left`.
- Generalise the Left/Right toggle in `settings-actions` `onKey` (today it
  special-cases `settings-auto-np-row`) into a map of row id → toggle
  function. S2 and S6 will add rows to it.

**Overlay content.**
- FPS and worst frame over a 1 s rAF window.
- Last keydown → second-rAF latency, from a capture-phase keydown listener
  attached only while enabled.
- Long tasks (`PerformanceObserver` `entryTypes: ['longtask']` in try/catch,
  else "n/a").
- `#app` element count, sampled at the 2 Hz update, not per frame.
- `App.getCurrentScreen()`.

**Overlay rendering.**
- One fixed element at top-left, `pointer-events: none`, high `z-index`.
- `textContent` only. Updated through a `setTimeout(…, 500)` chain. No
  `setInterval`.

**Acceptance (e2e `perf-hud.spec.ts`):**
- Off by default.
- With it off: wrap `requestAnimationFrame` and `addEventListener` in
  `addInitScript` and show 0 calls attributable to `PerfHud`, plus 0
  `PerformanceObserver` instances.
- Toggling via the d-pad on Settings shows the overlay with numeric fields
  within 1 s.
- It survives navigation across all 7 screens.
- Its own scripting cost is ≤ 0.5 ms per frame at CPU 1× (CDP
  `Performance.getMetrics` `ScriptDuration` delta over 5 s, on vs off).
- A screenshot is read back.
- Add "read the overlay" steps to the TV checklist.

## T6 — Version bump to v3.10

`v3-9-fix1` → `v3-10` in:
- `build.sh` `CACHE_BUST`;
- the `index.html` CSS `<link>` and script `?v=`;
- `tests/mock-index.html` (all `?v=`).

The About row in `js/screens/settings.js:186` becomes `V3.10`.

**Acceptance:**
`grep -rn "v3-9\|V3.9" index.html build.sh tests/mock-index.html js/screens/settings.js`
returns no hits.

## T7 — Design spec and report scaffold

**Rewrite `docs/UI-MOCKUP-REFERENCE.md`.** It still describes the pre-v3
sidebar layout and outline focus rings. Make it describe:
- the as-built v3 app: top nav, sub-nav, cards, rows, NP, bar, Settings, with
  today's token values;
- then a "v4 targets (v3.10)" section copying `ticket-3.10.md` §6 tokens,
  marked "pending: lands in S2/S3/S4/S6/S7".

Keep the V3.9 T1 equaliser and T5 placeholder notes.

**Create `docs/v3-10-report.md`** with these sections:
- What shipped (filled per session);
- Before/after;
- Deviations;
- TV checklist (start it with R1.1);
- Open questions (copy `ticket-3.10.md` §10).

## T8 — Oblong home-row package (R12)

Implement `ticket-3.10.md` §7 R12 exactly. Read ticket §2's "Oblong home-row
icon" bullet first: it holds the Litefin evidence and explains why v3.9 D46's
512×423 attempt failed.

- Create `icon-oblong-1920.png`: 1920×1080, opaque, full-bleed. Render it from
  HTML with Playwright and re-encode losslessly with Node `zlib`.
- Extend `build.sh` to stage and zip `Sonance3-Oblong.wgt` alongside
  `Sonance3.wgt`. Only the packaged `icon.png` differs; `config.xml` and the
  app id are identical.
- Replace the D46 comment in `build.sh` with a D59 one.
- Update the `build.sh` deploy note.

Acceptance per R12: an unzip comparison of both packages, sha256 of the
working-tree icons and `config.xml` before and after, and the new image read
back. Put R12 first in the `docs/v3-10-report.md` TV checklist: the user can
test the tile right after this session.

## T9 — PROGRESS and decisions

Append the Session 1 entry, including:
- a **Decisions** block logging **D49–D59** verbatim from `ticket-3.10.md` §3.2;
- a note: "Planning session 2026-10-01 (Opus 5.5) produced
  `tickets/ticket-3.10.md`, `tickets/prompt-3.10.md` and 22
  `tickets/mockup-3.10-*.jpg`. It did not edit PROGRESS.md: the ticket-authoring
  workflow forbids it. User decisions recorded in ticket §3.1."

Carry forward from the last entry:
- the v3.9 `[~]` items (S3 T8b, S2 NEW-3, S4 NEW-4, S4 NEW-5, S5 T10);
- the `[ ]` "reinstall `Sonance3.wgt` on the TV and confirm R1/R2/R3 (v3.9-fix1)";
- the stale `Sonance3-Oblong.wgt`: T8 regenerates it with the new 1920×1080
  icon. Record that the old 512×423 build is superseded.

## Session 1 close-out

Complete A5 in full. Then write `next_prompt.md` per A6:
- PART C = Session 2 (Interface size), expanded with current line references
  from `css/styles.css` and the JS px inventory you measured;
- PART D carrying the T1 environment results, the T3 baseline paths and the
  T4 numbers.

---

# PART D — State carried forward (from the planning session, 2026-10-01)

- **No code has changed since v3.9-fix1** (2026-09-04).
  - `index.html` is bundled at `?v=v3-9-fix1`.
  - `Sonance3.wgt` is 76,445 B.
  - `Sonance3-Oblong.wgt` (128,306 B, 2026-09-04) is a stale v3.9 build with
    the wrong 512×423 icon. Session 1 T8 replaces it.
  - `next_prompt.md` is the v3.9 programme-complete report, now superseded by
    this file.
- **Live server status:** reachable from Node (HTTP 200 on `ping.view`), but
  the **test credentials were rejected (error 40)**. Assume the mock rig only
  until T1 says otherwise. Navidrome 0.63.2 with OpenSubsonic extensions
  `songLyrics`, `indexBasedQueue`, `transcoding` and `playbackReport` (v3.9
  S6).
- **Browser LAN access:** blocked in this sandbox. Use the A2 `route.fetch()`
  proxy for any live run.
- **Tooling:** `@playwright/test` 1.63.0 is installed in the project (added by
  the user on 2026-09-07, with `package.json`, `playwright.config.ts`, and a
  `.github/workflows/playwright.yml` that is inert because the project is not a
  git repo).
- **Planning measurements:** in `ticket-3.10.md` §2. T4 re-measures them as
  the formal baseline.
- **User decisions:** 150% default, solid-pink focus, all four addition groups
  (ticket §3.1).
- **Mockups:** `tickets/mockup-3.10-*.jpg` (ticket §9). They were rendered
  with CSS `zoom` on the mock rig with patterned SVG covers. Treat them as a
  visual target only.
- **Oblong icon evidence:** ticket §2 (Litefin `normal-oblong` = same
  `config.xml`, 1920×1080 opaque `icon.png`). D59 supersedes D46.
- **Open questions:** ticket §10.

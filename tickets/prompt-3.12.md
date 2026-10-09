# v3.12 — Community contributions: Opus, sorting, Home row size, Popular songs, credits

**Parent ticket:** `tickets/ticket-3.12.md`. **Read it first, all of it.**
Requirement IDs (R1–R11) refer to it. D-numbers continue from **D167**.

**Hand this file to a fresh Claude Code session started at the project root.**
It is self-contained; assume no memory of earlier sessions. Commit as you go;
**never push** (the user pushes).

## Objective

Bring the three open GitHub pull requests into Sonance 3.11 (merge #5 and #1,
rebuild #2's features on today's code), credit their authors, and ship
version 3.12.

## Context

- **The repository:** `main` at `9426b2d` or later (`git log -3`); `origin`
  is github.com/MrSimmo/sonance3. Fetch a PR head with
  `git fetch origin pull/<n>/head` (public; no login needed).
- **PR #2 is the reference for intent, not code to copy:**
  `git fetch origin pull/2/head && git diff 93f7407 FETCH_HEAD` (commits
  44b2771, 0067637, c8ee26e). Its CSS breaks the Tizen rules; rebuild in the
  house style.
- **Files in play** (line numbers checked on 2026-10-07; re-check before
  editing):
  - `js/player.js`: `_loadAndPlay` ~:575; prepare-next ~:200 and ~:455;
    `seekTo` ~:989; `_onLoadFailure` ~:635; AVPlay `onerror` ~:507; the
    HTML5 `_onError` ~:263.
  - `js/api.js`: `getStreamUrl` ~:511; `getArtists` ~:1034.
  - `js/screens/library.js`: `ALBUM_SORTS` ~:66; `_albumList` ~:552;
    `_mountAlbumsHeader` ~:634; `_loadArtists` ~:1018; `_renderArtists`
    ~:1053.
  - `js/screens/home.js`: `EXTRA_ROWS` and `EXTRA_ROW_SIZE` ~:34–39; the first
    fetches ~:192.
  - `js/screens/artist.js`: the stages; the zones ~:560–620.
  - `js/screens/settings.js`: Appearance rows ~:136–160; row handlers ~:432.
  - `js/app.js`: `showToast` ~:71.
  - Tests and rig: `tests/mock-boot.js`, `tests/dev-server.js`,
    `tests/mock-index.html`.
  - Repository files: `README.md`, `build.sh`, `config.xml`, `shell.nix`
    (from PR #1).

## Read first, in this order

1. `CLAUDE.md`: the project rules ("v3 UI Design System" is authoritative).
2. `tickets/ticket-3.12.md`, all of it.
3. `tickets/ticket-3.10.md` §5 (constraints, invariants, credentials) and §8
   (verification approach); §11 only as needed.
4. `PROGRESS.md`, the tail only, from `## 2026-10-07 13:58 — v3.11`. The file
   is about 10,000 lines.
5. `docs/UI-MOCKUP-REFERENCE.md`, the design spec. New surfaces go here
   **before** CSS.

Then print the session-start confirmation line the global CLAUDE.md requires.

## Standing orders

### Autonomy

Run to completion without asking questions; nobody is watching.
- **Ambiguous and reversible:** make the pragmatic choice, log it as a
  D-number (from D167) with its reason in `PROGRESS.md` and in
  `tickets/ticket-3.12.md` §9, and continue.
- **Pre-authorised:**
  - Editing: `js/`, `css/`, `tests/`, `e2e/`, `docs/`, `screenshots/`,
    `index.html`, `build.sh`, `config.xml` (version only), `shell.nix`,
    `README.md`, `playwright.config.ts`.
  - Creating `CHANGELOG-3.12.md` and `docs/v3-12-report.md`.
  - Appending to `tickets/ticket-3.12.md` §9.
  - One `CLAUDE.md` "Audio Playback" bullet for R1, citing its D-number.
  - Git: `git fetch` of the PR heads, merges and commits on `main`.
  - Running things: starting and stopping the dev server, running Playwright
    and `./build.sh`, overwriting both `.wgt` packages.
- **Stop and log (do not do):**
  - `git push`, or any GitHub write (comments, closing PRs, releases);
  - installing packages (no `npm install`);
  - deleting files you did not create;
  - touching credentials;
  - live-server writes.
- If a requirement's pre-check shows it is already in place, or wrong, say so,
  mark it `[~]` with the evidence, and move on.

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
| Mock rig | `/tests/mock-index.html?mockAlbums=&mockArtists=&mockSongs=&mockLibraries=…`; fixtures on `window.__MOCK__`; knobs at the top of `tests/mock-boot.js`. Helpers in `e2e/helpers/sonance.js` (`bootMock`, `bootBundled`, `navTo`, `downWalk`, `focus`, `settle`, `startTrack`, `watchErrors`, `pngDiff`…). CDP key events for hold-OK: `e2e/options-sheet.spec.ts` `keys()` |
| Live server | `http://192.168.0.2:4534`, Navidrome 0.64.1, one library; the test account has one playlist, "Test for Claude" |
| LAN proxy | The sandboxed browser cannot reach `192.168.0.2`. Serve live requests through `ctx.route(/^http:\/\/192\.168\.0\.2:4534\//, async (r) => { const resp = await r.fetch({ timeout: 60000 }); await r.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) }); })` |
| Credentials | Only in `TEST-ACCOUNT.local.md` (a table, values in backticks). Parse it inside Node; never print, log, screenshot or write the values, never put them on a command line. Seed a live session via `addInitScript` with `sonance_server_url`, `sonance_username`, `sonance_password`, `sonance_logged_in`, plus `sonance-resume-queue: off`. Never screenshot Settings on live |
| Live access | Reads only. Allowed for R1: a Node-side GET of up to 64 KB of one stream. Forbidden: playback in the app on live, star/unstar, playlist edits, server config |
| Shell | zsh: redirect a run to a file, then read `$?`. Foreground `sleep` is blocked; wait for background jobs with an `until` loop. Quote heredocs (`<<'EOF'`) |

**Tizen 5.0 / Chromium 63 — non-negotiable:**
- **JS:** ES2017 in the `var`/`function` style. No `?.`, `??`, `Array.flat`,
  `Object.fromEntries` or top-level `await`.
- **CSS:** no `backdrop-filter`. No flex `gap` (use `> * + *` margins); grid
  uses `grid-gap`.
- **Animation:** animate only `transform`/`opacity`. Never `transition: all`;
  never transition layout properties; colour and background snap. Durations
  at most 0.25 s.
- **Units:** every new CSS length in rem (`Npx` → `(N/10)rem`); never CSS
  `zoom` (D49). JS design lengths go through `SonanceUtils.rem()`, layout
  maths through `SonanceUtils.px()`.
- **Focus (v4, D50):** `--focus-fill` with `--focus-ink`. Rows fill, cards
  scale with a ring; no outline rings.
- **Assets:** no external resources.

### Invariants — never undo (ticket-3.10 §5.3)

- D6: `translateZ(0)` on the three card classes, at rest and focused.
- D11: grid geometry is measured.
- D17: LazyLoader's two teardown paths.
- D23–D25: album list cursors (R2's random sample is not a paginated list;
  record that with its D-number).
- D32: `scrollIntoView` is gated on `zone.virtual`.
- D33: `.eq-bar` keeps `scaleY(0)`.
- D40: the Search VirtualGrid branch.
- **D47: `.np-bg-image` gets no transform, translateZ, scale trick or opacity
  animation.**
- V3.7-fix29: the `np-controls` zone keeps a constant selector and a stable
  shape.
- v3.9 NEW-1: the Settings zones are rooted at `#settings-left`.

### Traps

- **Cache-bust:** `build.sh` rewrites the `<script>` block, but **not** the
  stylesheet `<link>` `?v=` in `index.html`; bump that by hand.
  `tests/mock-index.html` has its own `?v=` tags and script list (add any new
  file to it).
- **Never edit an app file or a spec file while a suite is running;** add new
  spec files instead.
- **Focus helpers:** `FocusManager.moveFocus` does not wrap. `setActiveZone`
  needs `force=true` to leave the top nav, and a test that calls it skips the
  top nav's Down handler.
- **Scale-dependent tests:** a test that hard-codes a 150 % pixel size fails
  at `SONANCE_SCALE=1`; compute from the root font size.
- **Bottom-bar walk:** a new zone in Library or Artist can break the D56 walk.
  Run `focus-paths` and `npbar` after each such change.
- **Random sort:** do not route it through `createAlbumListCursor`, and do
  not run the S5 offset-search count for it.
- **Seek reloads (R1):** a reload for a seek must not count toward
  `_consecutiveLoadFailures`, must not end an A8 resume cue wrongly, and must
  not fire the prepare-next logic early.
- **Trailers:** `Co-authored-by:` lines go in the final trailer block (a blank
  line before it, one per line), alongside your own session attribution
  lines.
- **After the PR #1 merge,** `build.sh` has a new shebang: rebuild once to
  prove it.

### Verification protocol

- **Keyboard only** (`ArrowUp/Down/Left/Right`, `Enter`, `Escape` = Back);
  clicking proves nothing about the d-pad. Viewport 1920×1080, DPR 1,
  headless Chromium.
- **Test first.** Every behaviour added or fixed gets an e2e test. Run each
  new test against the unchanged code and paste its failure (RED), then the
  pass. A guard test that must pass before and after is labelled as such.
- **The suite at the end:** the whole suite at 150 % and at 100 %. At 200 %,
  at least `focus-paths`, `npbar`, `focus-style`, `options-sheet`,
  `transitions`, `bundled-walk`, `ui-scale` and the new specs. Exit 0; paste
  the tails.
- **Focus clip:** `tests/tools/focus-clip-sweep.js <out.json in the
  scratchpad> 1,1.25,1.5,1.75,2` stays 0 at every size, with the new states
  added (Artists chip, Popular rows, the Settings row, Home at 12).
- **Visual, 100 %:** `tests/tools/visual-baseline.js <dir> --scale 1
  --geometry`, before (T0) and after. Only the intended surfaces may differ;
  report each diff's bounding box. Home at the default must not differ.
- **Screenshots:** to `screenshots/v3-12/<name>.png`; read them back.
- **TV-only behaviour cannot be proven in a browser:** it goes into the
  `docs/v3-12-report.md` TV checklist, with what a failure looks like.

## Task

Work in this order. Commit after each task; the message cites the requirement
and its D-numbers. Commits for R1–R7 carry
`Co-authored-by: David BELEY <6568955+dbeley@users.noreply.github.com>`.

- **T0 — Pre-flight.**
  - `git status` is clean; record `git log -3`.
  - Capture the 100 % visual baseline from the 3.11 code into the scratchpad.
  - Record Home's `getAlbumList2` request URLs at the default (for R4's
    identity check).
  - Run the whole suite once at 150 % as the "before"; paste the tail. If
    anything fails before you start, record it and do not fix unrelated tests.
- **T1 — R8:** merge PR #5; run the two specs.
- **T2 — R9:** merge PR #1, resolve the README, add `perl` to `shell.nix`;
  `bash -n build.sh` and a build.
- **T3 — R7:** RED first. Fix only if it reproduces; otherwise `[~]` with the
  evidence.
- **T4 — R6:** the per-track error toast.
- **T5 — R1:** Opus.
  1. The mock first: `tests/mock-boot.js` gives some songs `suffix: 'opus'`,
     and `tests/dev-server.js` honours `format`/`timeOffset`, with no byte
     ranges on transcoded responses.
  2. Then the API and the player.
  3. Then the live probe.
- **T6 — R2:** the Random album sort.
- **T7 — R3:** the Artists sort.
- **T8 — R4:** the Settings row, and the Home rows following it.
- **T9 — R5:** Popular songs (the API, the mock, the section and its zones).
- **T10 — R10:** credits: README Contributors, `CHANGELOG-3.12.md`, and the
  drafts in `docs/v3-12-report.md`.
- **T11 — R11:** version 3.12, build, packages.
- **T12 — Close-out** (below).

If the session cannot finish, stop at a task boundary with everything
committed, and write `next_prompt.md` (gitignored) holding these standing
orders verbatim and the remaining tasks, for a fresh session.

## Constraints

Ticket §5 and the standing orders above. In short: the CLAUDE.md platform and
animation rules, the §5.3 invariants, credentials never exposed, no live
writes, design spec before CSS, the default Home unchanged, and no push.

## Acceptance criteria

1. **Every requirement settled:** R1–R11 each meet their acceptance in ticket
   §6, or are `[~]`/`[!]` with the reason (and, for `[~]`, the unblocking
   condition).
2. **Default unchanged:** Home at the default is identical to 3.11, in its
   requests and its 100 % screenshot.
3. **Suite and sweep:** the suite exits 0 at 150 % and 100 %, and the 200 %
   subset exits 0. The focus-clip sweep is 0 at 5 sizes.
4. **`node --check`** passes on every modified `.js`.
5. **The regression greps all hold:**
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
6. **Build:** `./build.sh` exits 0 with its gates. Both packages are rebuilt
   and checked by unzip; About reads `V3.12`; `config.xml` reads
   `version="3.12.0"`.
7. **Authorship:**
   - `ca4e38e` (anupamme) and `e08bdac` (dbeley) are reachable from `main`;
   - every R1–R7 commit carries dbeley's `Co-authored-by`;
   - the output of `git log --format='%h %an | %(trailers:key=Co-authored-by,valueonly)' -20`
     is pasted.
8. **Docs:**
   - `tickets/ticket-3.12.md` §9: each change, its D-number, and how
     acceptance was read;
   - `docs/UI-MOCKUP-REFERENCE.md`: the new surfaces;
   - `docs/v3-12-report.md`: what changed, the TV checklist, and the drafts;
   - `CHANGELOG-3.12.md` and the README Contributors section;
   - the `CLAUDE.md` Audio Playback bullet, if R1 shipped.
9. **`PROGRESS.md`:** a new entry appended in the house format
   (`## YYYY-MM-DD HH:MM — v3.12: …`, then Scope / Model / Tasks / Changes /
   Spec / Decisions / Verified / Next), with the pasted evidence.
10. **Credential hygiene:** no credential value in any file you wrote, and
    `u`, `t`, `s` and `p` are redacted in any URL you record.
11. **Clean finish:** the dev server is stopped, the working tree is clean,
    everything is committed, and nothing is pushed.

## Out of scope

- Merging PR #2's code as it stands, or copying its CSS.
- Transcoding any format other than Opus; a transcoding or quality setting.
- Removing the packages or bundles from git.
- A `flake.nix`, NixOS CI, or running the suite on NixOS.
- The GitHub Actions failure of run 37656368168, and any test unrelated to
  3.12.
- Any GitHub write: pushing, PR comments, closing PRs, releases. These are
  drafted for the user.
- The auth flow, the backdrop blur (D47) and the sleep timer.
- Deleting files you did not create.

## Verification (how the executor confirms it worked)

- **RED then GREEN** pasted for R1–R7 (for R7, the RED run, or the evidence
  that it does not reproduce).
- **Suite:** the whole suite at 150 % and 100 %, and the listed specs at
  200 %, each exit 0; the T0 "before" tail for comparison.
- **Checks:** the focus-clip sweep is 0 at 5 sizes. The 100 % visual diff is
  confined to the intended surfaces, and Home at the default is identical.
- **Live** (the bundled build through the proxy; resume off, no playback, no
  Settings screenshot):
  - Home, Albums with Random, Artists with each sort, and an Artist screen;
  - 0 page errors, 0 responses ≥ 400, and no write endpoints;
  - the R1 suffix counts and stream probe, and the R5 top-song counts.
- **Packages:** both unzipped and compared; the working tree's `config.xml`
  changes only in its version.
- **Git:** the authorship log above, and the two merge commits.
- **The closing reply** gives the user:
  1. the TV checklist, in order;
  2. `git push origin main`;
  3. the drafted PR #2 close comment and release-notes paragraph;
  4. a request to @dbeley to confirm `nix-shell` on NixOS;
  5. which package to install, with "About reads V3.12" as the check.

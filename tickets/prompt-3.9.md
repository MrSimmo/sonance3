# Sonance v3.9 — Performance & Correctness Programme

**Chained session prompt.** Hand this file to a **fresh Claude Code session,
Opus 5 @ xhigh**, from the project root. It is fully self-contained — the
session needs no prior context.

Each session executes **one** part of the programme, verifies it with
Playwright, rebuilds the `.wgt`, and writes `next_prompt.md` at the project
root for the next fresh session. Repeat until Part B is exhausted.

---

# PART A — Standing orders

> **Copy PART A verbatim into every `next_prompt.md`. Do not edit or summarise it.**

## A1. Autonomy

Run to completion without asking questions. Nobody is watching.

- Ambiguous **and** reversible → make the pragmatic choice, log the decision
  and its reasoning in `PROGRESS.md`, keep going.
- Never stop to ask "shall I…?". Never end a turn on a promise or a plan.
- **Pre-authorised** (do not ask): `npx --yes terser` (already used by
  `build.sh`), `npx --yes playwright …` including `playwright install chromium`,
  starting/stopping `python3 -m http.server 8080`, writing screenshots,
  rebuilding `Sonance3.wgt`, editing any file under `js/`, `css/`, `tests/`,
  `docs/`, `tickets/`.
- **Stop and log only for:** installing a permanent package into the project
  (a `package.json` — do not create one), deleting user data, or anything
  touching credentials or the live Navidrome server's own configuration.
- If the live Navidrome at `http://192.168.0.2:4534` is unreachable, **do not
  stop.** Fall back to the mock harness (§A2), complete every check that does
  not need real data, mark the rest `[!]` in `PROGRESS.md` with the reason,
  and carry them into `next_prompt.md`.
- If a task turns out to be wrong, unnecessary, or already done, say so, mark
  it `[~]` with the reason, and move on. Do not invent work to fill the gap.

## A2. Environment

| | |
|---|---|
| Project root | `/Users/agents/Agent Working Directory/sonance 3` |
| Target | Samsung Q90R, Tizen 5.0, Chromium ~63, 1920×1080, DPR 1 |
| Live server | `http://192.168.0.2:4534` (Navidrome, **multiple libraries**, 14,000+ songs) |
| Dev server | `python3 -m http.server 8080` from project root |
| Dev (unbundled) build | `./build.sh --dev` — restores the 19 individual `<script>` tags |
| Production build | `./build.sh` — terser bundle + minify + `Sonance3.wgt` |

**Credentials.** The app persists login in `localStorage`. For live-server
testing, read `SONANCE_USER` / `SONANCE_PASS` from the environment and drive
the login screen with them. If they are unset, use the mock harness instead —
do not guess credentials, do not prompt.

**Mock harness.** `tests/mock-index.html` + `tests/mock-boot.js` install a
`fetch` mock and pre-seed `localStorage` (`sonance_server_url=http://mock.test`,
user/pass `mockuser` / `mockpass`), so the app boots authenticated with no server. It currently
generates 14 albums / 10 artists / 20 songs.

> **Session 1 must extend `tests/mock-boot.js`** to read URL query parameters
> — `?mockAlbums=1200&mockArtists=2000&mockSongs=14000&mockLibraries=3` — and
> generate that many fixtures, with `getAlbumList2` honouring `size`/`offset`/
> `musicFolderId` and `getMusicFolders` returning `mockLibraries` folders.
> This is the **primary scale-test rig** for the whole programme: it makes
> every DOM-count, layer-count and memory assertion deterministic and
> independent of the user's server. Later sessions rely on it.

**Playwright.** Use the **Playwright CLI / Node API driven from Bash**. The
Playwright **MCP server is broken in this environment** (`ENOENT: npx`) — do
not try to use it. Check availability with `npx --yes playwright --version`
and install the Chromium browser if needed.

**Tizen 5.0 / Chromium 63 language and CSS constraints — non-negotiable:**

- ES2017 only. No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`,
  no `BigInt`, no top-level `await`. `var`/`function` style matches the
  codebase — match it.
- No `backdrop-filter`. No `gap` on flex containers (use `> * + *` margins).
  On grid use `grid-gap`, never the `gap` shorthand.
- Animate **only** `transform` and `opacity`. Never `transition: all`. Never
  transition `width`, `height`, `margin`, `padding`, `left`, `top`,
  `font-size`, or `border`.
- No external resources of any kind. Everything ships inside the `.wgt`.

## A3. Playwright verification protocol

Verification is the point of these sessions: the user's manual testing on the
TV should be a five-minute sanity check, not a hunt for regressions.

**Setup for every run**

1. `./build.sh --dev` then start `python3 -m http.server 8080`.
2. Launch headless Chromium at **viewport 1920×1080, deviceScaleFactor 1**.
3. **Keyboard only.** Drive the app with `ArrowUp/Down/Left/Right`, `Enter`,
   `Escape` (Back). Do not click to navigate — clicking bypasses the
   FocusManager and proves nothing about d-pad behaviour. Clicking is allowed
   only to reach a state faster when the focus path for it is already proven
   in the same run.
4. For performance measurements, throttle CPU 6× via CDP:
   `client.send('Emulation.setCPUThrottlingRate', { rate: 6 })`. This
   approximates the 2019 SoC; it is an indicator, not the authority.
5. Screenshots → `screenshots/v3-9/s<N>-<name>.png`. Reference the paths in
   `PROGRESS.md`. **Read your own screenshots back** and compare against what
   the change was supposed to do — do not assert a visual result you have not
   looked at.

**Instrumentation recipes** (evaluate in-page unless noted)

```js
// DOM scale
document.querySelectorAll('.album-grid-card').length
document.getElementById('app').getElementsByTagName('*').length

// Count a hot API call over a user interaction
window.__qsa = 0;
var _qsa = Document.prototype.querySelectorAll;
Document.prototype.querySelectorAll = function() { window.__qsa++; return _qsa.apply(this, arguments); };
// …drive N keypresses…  then read window.__qsa

// Same pattern for forced layout
window.__gbr = 0;
var _gbr = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function() { window.__gbr++; return _gbr.apply(this, arguments); };

// Heap
performance.memory && performance.memory.usedJSHeapSize
```

Compositor layers: CDP `LayerTree.enable` then the `layerPainted` /
`layerTreeDidChange` events, or `Performance.getMetrics()` for
`LayoutCount` / `RecalcStyleCount`. Network cache behaviour: CDP
`Network.enable` and inspect `response.fromDiskCache` on `getCoverArt`
requests.

**Every performance claim must be a measured before/after number pasted into
`PROGRESS.md`.** "Feels faster" is not evidence. Where a number cannot be
measured, say so explicitly rather than asserting improvement.

## A4. Definition of done — every session

A session is not finished until **all** of the following are true and
evidenced in `PROGRESS.md` with pasted command output:

1. Every task in PART C carries `[x]`, `[!]` (with reason), or `[~]`
   (with reason and unblocking condition). Never silently drop one.
2. Each acceptance criterion has a pasted measurement, screenshot path, or
   command output. No paraphrasing.
3. `node --check <file>` passes for every modified `.js` file.
4. **Regression guard** — all of these must hold, since each is deliberate
   prior work:
   ```bash
   grep -rn "innerHTML" js/*.js js/screens/*.js | grep -v "no innerHTML"   # expect: no hits
   grep -nE "transition: *all" css/styles.css                              # expect: only the L58 comment
   grep -nE "transition[^;]*(width|height|margin|padding|left|right|top|bottom|font-size|border)" css/styles.css   # expect: no hits
   grep -n "backdrop-filter" css/styles.css                                # expect: no hits
   grep -nE "(^|[^-a-z])gap:" css/styles.css                               # expect: no hits
   grep -rn "setInterval" js/                                              # expect: no hits
   ```
   `transform: translateZ(0)` on `.album-card`, `.album-grid-card` and
   `.artist-grid-card` (`css/styles.css:1808, 2056, 2133`) is a **deliberate
   fix** for a Chromium 63 glyph-cache ghosting artefact (V3-6-fix3 GFX-1,
   V3.8-fix2). **Do not remove it** unless a task explicitly says to.
5. `./build.sh` completes, its `?.`/`??` gate passes, `Sonance3.wgt` is
   rebuilt, and `index.html` is left in **bundled** mode.
6. Cache-bust bumped to `v3-9` in `index.html` and `CACHE_BUST` in
   `build.sh`; the About row in `js/screens/settings.js` reads `V3.9`.
   (Bump once, in Session 1; later sessions verify it is still correct.)
7. `PROGRESS.md` has a new appended entry in the house format
   (`## YYYY-MM-DD HH:MM — [title]`, Scope / Model / Tasks / Changes / Spec /
   Decisions / Verified / Next). Append only — never overwrite.
8. `next_prompt.md` written at the project root per §A5.
9. Dev server stopped.

## A5. The `next_prompt.md` contract

Write `next_prompt.md` at the project root, overwriting any previous copy. It
must be **fully self-contained** — the next session starts with zero context
and reads nothing but that file.

Required structure:

- **PART A** — this section, copied **verbatim**.
- **PART B** — the full programme, with every completed item marked `[x]`
  and annotated with the session that did it, plus any newly discovered work
  appended to the right phase. Carry `[!]` and `[ ]` items forward.
- **PART C** — the next session's tasks only, expanded to the same level of
  detail as PART C in this file: file paths, line references, the change,
  and checkable acceptance criteria.
- **PART D** — state carried forward: the perf baseline numbers from
  `docs/perf-baseline.md`, deviations and decisions taken so far, anything
  left `[!]`, and any environment facts the next session needs (e.g. whether
  the live server was reachable, whether `SONANCE_USER` was set).

If a session finishes the last phase, `next_prompt.md` must instead contain a
short **"programme complete"** report: what shipped, the before/after
measurements, what was deliberately not done, and the minimal manual TV test
list for the user.

---

# PART B — The programme

Six sessions. One per fresh Claude Code session. Every finding below is
already verified against the source — file and line references are accurate
as of v3.8.

| Session | Content | Risk | Status |
|---|---|---|---|
| **1** | Baseline capture + scale rig, then four quick high-impact wins | Low | **[x] done 2026-09-03** |
| **2** | Virtualise the Library → Albums tab | Medium (touches focus zones) | **[x] done 2026-09-03** |
| **3** | Memory & network hygiene | Low | **[x] done 2026-09-03** |
| **4** | Correctness: multi-library merge, AVPlay guards, logging | Medium | **[x] done 2026-09-03** |
| **5** | Polish | Very low | **[x] done 2026-09-04** |
| **6** | Non-perf report, final TV-readiness pass | Low | **[x] done 2026-09-04 — programme complete** |

**Why these, in this order.** The user reports three specific symptoms on the
TV. All three trace to concrete, measured causes:

| Reported symptom | Cause | Fixed in |
|---|---|---|
| Library → Albums scrolling degrades the further you go | Only un-virtualised grid; ~13 DOM nodes per card, unbounded; every card force-promoted to its own GPU layer; a `querySelectorAll` over the whole grid on every keypress | S1 (T5), S2 |
| Now Playing open / track change hitches | `filter: blur(60px)` rasterised over a 2880×1620 region, re-paid on every track change | S1 (T3) |
| Cover art re-downloads, slow to appear | Every cover URL carries a fresh random salt, so it is unique — the TV's HTTP disk cache can never hit | S1 (T2) |

---

## Session 1 — Baseline + quick wins — [x] COMPLETE (2026-09-03)

- [x] T1 — Scale rig + perf baseline → `tests/mock-boot.js` query-param
      fixtures, `tests/dev-server.js`, `docs/perf-baseline.md`
- [x] T2 — Stable auth salt for media URLs → cover URLs now stable;
      `fromDiskCache` on the next cold launch 0/53 → 53/53
- [x] T3 — Shrink the Now Playing blur raster → blurred region 4.67 Mpx →
      0.13 Mpx; RasterTask over 3 track changes 67.52 ms → 3.95 ms (median of 5)
- [x] T4 — Remove static `will-change` from the page layers → Library at rest
      68 → 66 compositor layers, 18 975 594 → 15 703 754 composited px
- [x] T5 — Remove the per-keypress `querySelectorAll` in the Albums grid →
      nodes matched per 10 keypresses on a 600-card grid 4200 → 0
- [x] T6 — Version bump to v3.9
- [x] T7 — (added by the user, outside the original programme) Oblong 512×423
      Samsung TV app icon `icon-oblong.png` + `Sonance3-Oblong.wgt`

## Session 2 — Virtualise Library → Albums — [x] COMPLETE (2026-09-03)

- [x] **NEW-1 — Settings actions are unreachable by d-pad. Fix this first.**
      Found and measured in Session 1, deliberately not fixed there (out of
      that session's scope). `js/screens/settings.js` (l. ~380) registers the
      `settings-actions` zone with selector
      `#content-area .focusable:not(.accent-swatch):not(.settings-library-row)`,
      but **there is no `#content-area` element on the Settings screen** — the
      focusables live under `#settings-left` → `.settings-section`. Measured:
      `hasContentArea: false`, `actionsZoneMatches: 0`, and the zone is still
      `content` after pressing Down from the accent swatches.
      `FocusManager.moveFocus` computes `total = 0`, so `_tryTransition('down')`
      lands nowhere and focus stays put. **Consequence on the TV: the
      accent-reset link, the Auto Now Playing toggle row and the Logout button
      cannot be reached with the remote at all — a user cannot log out.**
      Pre-existing in v3.8, not a v3.9 regression. One-selector fix: either add
      `id="content-area"` to the element the selector intended (keeping the
      `:not(...)` exclusions working) or retarget it at `#settings-left`.
      Acceptance: Down from the accent swatches reaches zone
      `settings-actions` index 0 on `accent-reset`, then
      `settings-auto-np-row`, then `settings-logout-btn`, then
      `nowplaying-bar`, with Up retracing exactly; Left/Right on
      `settings-auto-np-row` still toggles rather than changing zone; and the
      whole logout → login → re-login round trip works **keyboard only**
      (Session 1 had to bypass the d-pad with `element.click()` for precisely
      this reason).
- [x] Port the Albums tab onto `SonanceUtils.VirtualGrid` (`js/utils.js:346-529`)
      and the `virtual: { getCount, getItemAt }` focus-zone contract
      (`js/focus.js:242-255`). The **Artists tab at `js/screens/library.js:729-799`
      is a working template** — follow it closely.
- [x] Keep `PaginatedLoader` (`js/screens/library.js:503`) as the backing store;
      virtualise the view over its accumulated items array.
- [x] Raise the page-ahead trigger from `<= 5` items to 1–2 full rows.
      *(Already done in Session 1 T5 as `_albumLoader.offset - idx <= cols * 2` —
      verify it survives the port and that `cols` now comes from
      `VirtualGrid.getColumns()`.)*
- [x] Acceptance: with `?mockAlbums=1200`, scrolling to the end of the grid
      keeps `document.querySelectorAll('.album-grid-card').length` bounded
      (expect ~40–80, must not exceed 150); full d-pad traversal in both
      directions never focuses a detached node; Enter opens the correct album;
      Back restores focus to the originating card.
- [x] This is the change most likely to introduce a focus regression. Test it
      hardest: traverse the entire 1200-card grid by keyboard in both
      directions and assert `document.activeElement`/`.focused` is always a
      live, visible card.

**Session 2 measured result** (full detail in `docs/perf-baseline.md`):
`.album-grid-card` at the end of a 1200-album grid **1200 → 56**; elements
under `#app` **15 647 → 777**; `<img>` **1200 → 56**; compositor layers on
Library at rest with 1200 albums loaded **200 → 72**; JS heap median
**5 401 390 → 5 295 323 B**; `querySelectorAll` per 10 keypresses stays at
**0 / 0** at 50, 600 and 1200 logical items; 1140 forward + 1199 backward d-pad
steps with **0** detached-node assertion failures.

- [ ] **NEW-3 (found in Session 2, deferred):** Back from an album detail
      cannot restore grid focus beyond the first loaded page. `goBack`
      (`js/app.js:1292`) calls `_navigateToScreen`, which re-activates
      `LibraryScreen` and rebuilds the Albums tab from `offset 0`, so
      `FocusManager.restore({zone:'library-grid', index:600})` clamps to the
      49 items then loaded. **Measured identically on the pre-change build**
      (index 0 and 7 restore exactly; 600 and 1199 both land on index 49), so
      it is pre-existing and not a virtualisation regression — but the
      Session 2 acceptance list assumed it worked, so it is recorded here
      rather than dropped. A fix means either keeping the loaded page count
      across a drill-down or having the restore path page forward to the saved
      index; both change navigation behaviour, so they belong in Session 5
      (polish) or with the user's agreement.

## Session 3 — Memory & network hygiene — [x] COMPLETE (2026-09-03)

Full before/after measurements, with the method for every row, are in
`docs/perf-baseline.md` §"Session 3 results (v3.9 T1-T8)".

- [x] **T1 — Right-size cover art** → `js/components.js` (both bucket blocks),
      `js/screens/nowplaying.js` (NP art 600 → 320),
      `js/app.js` (`_preloadNpArt` 600 → 320).
      Album grid card 300 → **180** for a 153 px card (2.0× → 1.09×), artist
      avatar 300 → **120** for a 100 px circle (3.0× → 1.11×), the
      `size <= 220 → 500` bucket → **200**, Now Playing 600 → **320**.
      Live Navidrome, one Albums page: **1 901 300 B for 40 images →
      1 746 122 B for 50**, i.e. **−26.5 % per image**; mock rig −55.9 % per
      image. Disk-cache win intact: **50/50 `fromDiskCache`** on relaunch.
      No visible softening — 3× crops of real cover art read back and compared,
      and the pre-change frame is byte-identical to Session 2's reference.
      *Note: the original ticket said 9× for the avatar and 4.3× for the grid;
      measured on the real screens they are 3.0× and 2.0×, because the avatar
      is 100 px not 33 px and the card is 153 px not 145 px.*
- [x] **T2 — `ImageCache` retention** → `js/image-cache.js`, plus
      `ImageCache.clear()` wired into `js/auth.js` `logout()` and
      `js/app.js` `applyLibraryChange()`.
      Entry is now `{ url, loaded }`; live `HTMLImageElement` instances after a
      full 1200-album traversal **610 → 110** (CDP `Runtime.queryObjects`).
      `MAX_SIZE` 500 → 128. `_touchKey` is an insertion-ordered `Map`
      delete+set: over a 200-keypress vertical grid walk, `indexOf` calls on
      the LRU list **8 020 → 0** and array elements scanned
      **3 548 368 → 0**. Heap after a full traversal, median of 3, no
      instrumentation: **5 272 955 → 5 178 582 B**. Logout empties both caches
      (57 → 0, 5 → 0) and art returns after re-login.
- [x] **T3 — `LazyLoader` released targets** → `js/image-cache.js`
      (`unobserve`, `releaseWithin`, `unobserveWithin`, `observedCount`),
      `js/utils.js` (`VirtualGrid._updateVisibleRange` → `releaseWithin`),
      `js/app.js` (`_navigateToScreen` → `unobserveWithin`).
      Live `IntersectionObserver` targets after a full traversal
      **4 146–5 038 → 16**, bounded by the mounted band. Forward traversal
      wall clock **14.1 s → 14.6 s** (2–4 % slower: the recycle path now does
      one `querySelectorAll` plus ~56 `unobserve` calls per range change —
      reported as measured). Focus integrity re-asserted: **0 failures over
      2 797 checks** on both the unbundled and the bundled build, correct Enter
      target at indices 0 / 7 / 600 / 1199.
      Two call sites, deliberately different: the recycle path releases only
      (the incoming band re-requests most of the same cover ids, so cancelling
      would abort loads only to restart them), the screen-teardown path
      releases **and** cancels.
- [x] **T4 — Bound the API memory cache, agree the keys, clear on logout** →
      `js/api.js`, `js/auth.js`.
      `_cache` is an LRU-capped `Map` at 100 with expired entries swept on
      write; after 300 distinct calls `SubsonicAPI.cacheSize()` is **100** and
      re-issuing the first of the 300 costs a network request (before: 300
      resident, nothing ever evicted). `_memKey` now includes
      `username|serverUrl`, so `_lsKey === LS_PREFIX + _memKey` exactly (the
      localStorage key format is unchanged). Cross-user leak closed: after a
      keyboard logout and login as `userB`, `getAlbumList2` returns
      `userB-album-*` where it used to return `mockuser-album-*`. The
      `sonance_authsalt_v1__` entry survives logout (decision D2).
- [x] **T5 — localStorage quota** → `js/api.js` (`_projectForLs`, `_lsPrune`,
      `_lsWrite`).
      The stored `getArtists` payload is projected to
      `id`/`name`/`albumCount`/`coverArt` **on the way into localStorage
      only** — the in-memory cache and the live response keep the full object.
      Live server, 2 493 artists: **1 076 675 → 277 805 chars (−74.2 %)**;
      total localStorage 1 137 713 → 320 771. Quota behaviour on identical
      fill, against a reinstalled pre-v3.9 `_lsWrite`: legacy dies on both
      cold launches (2 network `getArtists` each, nothing stored, forever);
      current prunes, retries, stores, and the **second cold launch makes zero
      `getArtists` requests**. The prune only touches `LS_PREFIX` keys — with
      the quota filled by foreign keys it declines and fails gracefully, and
      all five `sonance_` non-cache keys survive.
      *Not verified: the "synchronous main-thread block" premise. A 206 KB
      `JSON.stringify` + `setItem` costs under 0.1 ms on this machine. It is a
      Tizen claim and is recorded as unverified rather than asserted.*
- [x] **T6 — Align the nav-hover preload** → `js/app.js`
      `_preloadScreenImages`.
      Now issues `('newest', 6, 0, libraryIds)` and
      `('alphabeticalByName', 50, 0, libraryIds)` — exactly the screens' calls
      — and preloads art at **180**, matching T1's grid bucket. One Library
      navigation on a cold cache: **2 → 1** `getAlbumList2` network requests.
      Whole-nav sweep: 5 → 4 API requests.
      *The ticket's "up to 36 wasted JPEG downloads per nav sweep" did not
      materialise before the change, because the old preload's size (300)
      happened to equal the old grid bucket, so its ids were a subset of what
      the grid requested anyway. The waste was the duplicate API round trip and
      the missing library scope. Aligning the image size was still required —
      after T1 a 300 px preload would have become 50 downloads nothing
      displays.*
- [x] **T7 — In-flight de-duplication** → `js/api.js` (`_inflight`).
      Two identical calls in one tick: **2 → 1** network request, and both
      promises now resolve to the same object. Same-tick
      `StarredCache.load` + `getStarred2`: **2 → 1**. A rejection does not
      poison the map (forced failure, then a successful retry).
      *Cold app start issues exactly one `getStarred2` before and after — the
      race the ticket names needs the Search screen's Favourites card opened
      while the boot load is in flight, which is what the same-tick probe
      reproduces.*
- [x] **T8a — Body-covering timeout, `AbortController`, image concurrency
      cap** → `js/api.js` (`_request`, `_openRequests`,
      `SubsonicAPI.abortAll`), `js/image-cache.js` (queue + `cancel`),
      `js/auth.js`, `js/app.js`.
      A 30 s dripped body used to **resolve after 29 601 ms**; it now
      **rejects at 10 006 ms**. Peak concurrent cover-art sockets over a fast
      200-keypress walk **48 → 5** (p90 39 → 4). Navigating away mid-load:
      **2 453 716 bytes saved**, 5 × `net::ERR_ABORTED`, 0 sockets left open,
      against 36 further requests and 2.45 MB spent with cancellation
      disabled. Playback keeps progressing while the grid is hammered
      (2.86 → 13.94 → 16.44 s, `readyState 4`).
- [~] **T8b — abort in-flight API requests from screen `deactivate()`** —
      **deferred, not done.** `abortAll()` is wired to `AuthManager.logout()`
      and `App.applyLibraryChange()`, where discarding is unambiguously
      correct and the caches are being emptied anyway. Wiring it to every
      screen teardown converts results the screens currently discard silently
      into **rejections** across ten `.catch` handlers whose behaviour
      differs — `js/screens/artist.js:515` raises a global
      `App.showToast('Unable to load tracks')`, which would fire for a screen
      the user has already left. That is a behaviour change beyond a
      low-risk hygiene session.
      **Unblocking condition:** per-screen request groups (tag each `_request`
      with the screen that issued it and abort only that tag), plus a decision
      on whether an aborted load should reject or resolve-empty. Carried into
      Session 5 with the options put to the user.

## Session 4 — Correctness — [x] COMPLETE (2026-09-03)

All five tasks done and measured; full detail in `docs/perf-baseline.md`
§"Session 4 results (v3.9 T1–T5)". Headlines:

- [x] **T1 — Multi-library Albums pagination.** `js/api.js` gained
      `SubsonicAPI.prototype.createAlbumListCursor` (`AlbumListCursor`: one
      offset per library plus a k-way merge that advances only the cursor it
      consumed), and `js/screens/library.js` `_loadAlbums` pages through it
      instead of advancing one shared `apiOffset`. `_mergeAlbumLists` is kept
      and unchanged — it is correct for the single non-paginated fan-out call
      that `home.js`, `search.js` and `settings.js` make, and only pagination
      broke it. **Mock rig, 1200 albums: 3 libraries 400 → 1200 distinct,
      7 libraries 200 → 1200 distinct, in exact fixture order. Live Navidrome
      (7 libraries, 7 119 albums): libraries represented in the first 1 250
      albums 4 of 7 → 7 of 7, and `getAlbumList2` requests for those 1 250
      albums 175 → 29.** Single-library and all-libraries request sequences
      byte-identical before and after.
- [x] **T1a (found while verifying T1) — the album comparator disagreed with
      Navidrome's collation.** Measured over the live server's seven
      server-ordered streams (1 896 adjacent pairs): code-point order 161
      inversions (8.49 %), lowercase + leading-article strip 9 (0.47 %).
      Under a k-way merge the comparator *is* the presentation order, and
      code-point order starved the largest library (2 989 albums contributed
      none of the first 1 250). `_albumComparator` now normalises the two
      name-ish sort keys, and each buffered page is re-sorted with it.
      Adjacent inversions in the loaded list on live: 32/1249 → 2/1249.
- [x] **T2 — AVPlay load-generation guard.** `var gen = ++_loadGeneration;`
      before `open()`, checked in all six callbacks registered for that load
      and in the outer `catch`; `stop()` bumps the generation too.
      **Superseded-generation `play()` calls: double-Next 1 → 0, triple-Next
      2 → 0, Next-then-Previous 2 → 0**, with the current generation still
      playing in every case. Verified against `tests/avplay-stub.js`, not on
      the device.
- [x] **T3 — AVPlay error cascade capped.** All four failure paths (AVPlay
      `onerror`, the `prepareAsync` error callback, the load `try/catch`, and
      the HTML5 element's `error` event) funnel through `_onLoadFailure`;
      advancing stops after 3 consecutive failures with a toast, and any
      playable load resets the count. **50-track queue with every load
      failing: `open()` 50 → 3 on AVPlay and stream requests 50 → 3 on the
      HTML5 fallback**; `isPlaying` now ends `false` and the toast reads
      "Playback stopped — tracks could not be played".
- [x] **T4 — Logging gated.** `SonanceUtils.log()` is a no-op unless
      `window.SONANCE_DEBUG === true`, `?debug=1`, or
      `SonanceUtils.setDebug(true)`; `warn`/`error` untouched. The
      `FocusManager` re-register `console.warn` and player.js's platform
      banner now route through the gate. **Boot plus a fixed keyboard walk
      (7-screen nav sweep + 200 grid keypresses): `console.log` 112 → 0,
      `console.warn` 18 → 0**, with a forced API failure still printing
      through `console.error`. `drop_console` was **not** adopted:
      `drop_console=true` strips `console.warn`/`console.error` as well
      (measured), and `drop_console=['log']` would kill the runtime escape
      hatch while saving only 99 bytes.
- [x] **T5 — App-shell Player subscriptions guarded.** The five handlers are
      named functions and `_showAppShell` detaches the previous set before
      attaching. `Player.listenerCount()` added as a diagnostic.
      **Total Player listeners after 1 / 3 / 5 logout → login cycles:
      10 / 20 / 30 → 5 / 5 / 5.** NP bar still updates after five re-logins.

### Found in Session 4, carried forward

- [ ] **NEW-4 — selecting *all* libraries in Settings normalises to `null`,**
      so the fan-out path (and therefore T1's defect) only ever applied to a
      strict subset of two or more. `SubsonicAPI._normaliseLibraryIds`
      collapses a full selection to "all libraries", which takes the single
      unscoped request path. The defect was real and severe for anyone
      scoping to 2–6 of the 7 libraries, and unreachable for anyone with all
      7 ticked. Worth stating in the Session 6 report, because it changes who
      was affected.
- [ ] **NEW-5 — the merged album order is still not globally sorted.** Each
      library's page arrives in Navidrome's collation, which the client
      comparator now matches to within 0.47 % of adjacent pairs but not
      exactly, so a k-way merge over those streams cannot be perfectly
      ordered (measured 2 adjacent inversions in 1 249 loaded albums on the
      live server, down from 32). Completeness is unaffected — the cursor
      never discards — only interleaving. A real fix needs a sort key the
      Subsonic API does not expose. Report it in Session 6.

## Session 5 — Polish — [x] COMPLETE (2026-09-04)

All thirteen tasks closed; full detail in `docs/perf-baseline.md`
§"Session 5 results (v3.9 T1–T13)". Headlines:

- [x] T1 — **`@keyframes barBounce` no longer animates `height`.** Converted to
      `transform: scaleY()` about `transform-origin: bottom center`, with a
      base `transform: scaleY(0)` so a bar stays invisible during its
      `animation-delay` exactly as the height-less rule did. **`LayoutCount`
      over a fixed 3 s window with the bars running: 180 → 0;
      `RecalcStyleCount` 180 → 22.** Bar geometry sampled at nine exact
      animation times via the Web Animations API is pixel-identical on both
      builds. The stylesheet now has no layout-animating rule.
- [x] T2 — **Lyrics active-line repaint bounded.** Only the range between the
      old and the new index is rewritten. **60-line lyric, single-line
      advance: 60 → 2 `className` writes; 8 s of playback: 1500 → 50 over the
      same 25 active-line changes.** `_debugZones()` unchanged and not
      growing; `_registerFocusZones()` in `_updateLyricsUI` fires on track
      change and panel open/close, not per tick, so it was left alone.
- [x] T3 — **The time row is written only when its text changes.** 30 s of
      playback: `_timeCurrent` 114 → 31 writes, `_timeTotal` 114 → 0.
      `_timeTotal` was **not** moved into `_updateTrack` — measured, the total
      legitimately changes from `3:00` (track metadata) to `0:20` (media
      metadata) during the first seconds of a track, so the cached-string
      guard is the correct shape and `_updateTrack` alone would have frozen a
      wrong value. See D31.
- [x] T4 — **Duplicate `scrollIntoView` dropped for flow-layout zones, kept
      for virtual ones.** `scrollIntoView` per 10 keypresses: Library → Songs
      10 → 0, Home 4 → 0, Albums and Artists 16 → 16 (unchanged, deliberately).
      Removing it outright leaves the focused card at `top` 1502 (Albums) and
      1292 (Artists) in a 1080 viewport — measured on a third build variant.
      `getBoundingClientRect` was 0 per keypress on both sides: the screens
      read `offsetTop`/`clientHeight`, not rects, so that metric measures
      nothing here. Focus integrity 1341 checks / 0 failures.
- [x] T5 — **Per-card vinyl SVG replaced by a CSS `radial-gradient`.**
      Full-band recycle: `setAttribute` 17 640 → 3 024, `createElementNS`
      3 024 → 0, elements under `#app` 986 → 554. 200-keypress walk:
      `setAttribute` 522 566 → 89 716, `createElementNS` 89 580 → 0, elements
      under `#app` 778 → 442.
- [x] T6 — **`VirtualGrid._updateVisibleRange` and the chunked artists append
      build into a `DocumentFragment`.** Applied as specified; **no measurable
      gain** — 40 forced band re-renders at CPU 6× median 12.957 → 13.025 ms,
      `LayoutCount` over a 200-key walk 577 → 572, `RecalcStyleCount`
      945 → 1023, all inside run-to-run noise. Chromium does not lay out per
      append when nothing reads layout in between. Kept because the task
      specified it and it is risk-free; the benefit is not evidenced.
- [x] T7 — **Queue row clicks delegated to the container.** 500-track queue,
      499 rendered rows: click listeners on `.queue-row` **499 → 0**, one on
      `.queue-list`. Enter at rows 0 / 12 / 300 gives `queueIndex` 1 / 13 /
      301 on both builds.
- [x] T8 — **Settings library stats.** The discarded
      `getAlbumList2('newest', 1)` is gone and `getArtists` is now scoped.
      **Live server, one library scoped: 4 → 3 API requests and
      303 853 → 151 351 bytes, and the rendered count 2 493 → 1 100 artists,
      which is exactly what the Library screen's Artists tab builds from.**
      All libraries: 4 → 3 requests, 303 302 → 302 402 bytes, count unchanged
      at 2 493.
- [x] T9 — **`removeAttribute('src')`.** After teardown the NP `<img>` went
      from `src=""` resolving to the document URL to no `src` attribute at
      all. The consequent re-fetch is **not reproducible on Playwright's
      Chromium** (0 document-URL requests on both builds) — the defect is a
      Chromium-63-era behaviour; what is verified is that the condition that
      triggers it is gone.
- [~] T10 — **`md5()` inner-function hoist NOT made.** Measured on the shipped
      source: 1 000 calls, median 1.156 ms hoisted-out vs 1.136 ms — **20 ns
      per call, 1.7 %** — and since V3.9 T2's stable salt `md5` is called
      **once per `SubsonicAPI` construction** (`js/api.js:222`, the only call
      site), i.e. once or twice per app launch. Not worth the churn on a
      hand-transcribed hash implementation. Unblocking condition: only if a
      future feature makes `md5` hot again.
- [x] T11 — **CSS minified into the package only.** `css/styles.css`
      87 448 → 52 909 B in the `.wgt` (gz 15 796 → 8 411); the source file is
      untouched. `Sonance3.wgt` 82 767 → 76 279 B. Home, Library and Album
      render **pixel-identical** with the minified sheet; Now Playing differs
      only in a 99 × 27 px region around the moving progress scrubber.
- [x] T12 — **The four product decisions and the Escape question written up,
      not implemented.** T8b, NEW-3, NEW-4, NEW-5 each carry a recommendation
      and an unblocking condition. **The Escape-from-album-detail report does
      not reproduce**: Escape returns to Library with grid focus on both the
      pre-session and the current build (and on artist detail too).
- [x] T13 — **NEW-2 closed.** `icon-oblong.png` re-encoded losslessly with
      Node's own `zlib` plus adaptive PNG scanline filtering — no dependency,
      no `package.json`. **175 772 → 71 505 B (−59.3 %)**, pixel data
      byte-identical, 0 differing pixels through an independent decode.
      `Sonance3-Oblong.wgt` **232 179 → 128 324 B**.

## Session 6 — Non-performance report + TV readiness — [x] COMPLETE (2026-09-04)

**The programme is complete.** The deliverable is `docs/v3-9-report.md`;
measurements and method are in `docs/perf-baseline.md` §"Session 6 results".
Two small fixes were made; everything that changes product behaviour was
reported for the user to decide, not implemented.

- [x] **Library → Songs shows 50 random songs and cannot page** — measured on
      the live server, not fixed. 50 rows, 50 distinct; 70 real ArrowDown
      presses leave it at 50 and transfer focus out of the grid; **no d-pad
      path reaches song 51**. Re-entry in-session gives the identical 50 (the
      5-minute `_cachedRequest` TTL), a fresh launch gives a different 50 with
      **0 of 50 overlap**. Genres the same: Dance has 5 225 songs, the detail
      renders 50. **Recommendation, tested live: `search3.view` with an empty
      query plus `songCount`/`songOffset` paginates stably and completely
      (offsets 0/50/5000 all return 50, 0 overlap, repeat is byte-identical);
      `getSongsByGenre` already honours `offset`, so the genre cap is a
      client-side omission only. `getRandomSongs` has no offset at all.**
      Any implementation must be built on `VirtualGrid` and Session 4's
      `AlbumListCursor` from day one.
- [x] **`getStarred2` is unbounded** — measured live, not changed. 1 request at
      app start, 690 B encoded / 145 characters / 43.4 ms, and the test account
      has **0 starred items**, so the payload risk cannot be shown with real
      data and nothing was starred to manufacture it. Cost per item on the same
      server: 876 B/album, 1 298 B/song. `StarredCache.load` reads only `.id`,
      so the projection would be **`id` alone**. Not implemented — adding an
      endpoint to `LS_ALLOWLIST` is a behaviour change (24 h stale favourites).
- [x] **Dead code sweep — one of the three was not dead.**
      **The Search `VirtualGrid` branch is REACHABLE and was kept**: the
      ticket's premise ("a hard server-side cap of 25 results") is wrong,
      because `search3` fans out one request per scoped library and
      `_mergeSearchResults` does not re-cap. Live, query `LOVE`: 4 of 7
      libraries → 82 results and **1 virtualised section**; 5 of 7 → 100 and 2;
      6 of 7 → 104 and 2. Deleting it would have introduced exactly the
      unbounded render this session measured elsewhere.
      `FocusManager.invalidateZone` and `.placeholder-card` **were** dead and
      are deleted. `LazyLoader.disconnect` kept, per Session 3's decision.
- [x] **Playlist detail and Queue render every row** — measured at 500 / 5 000
      / 14 000 tracks, CPU 6×, not fixed. Playlist detail: 3 068 → 30 068 →
      **84 050** elements, 88.9 → 642.7 → **1 892 ms** to first paint, heap
      2.57 → 4.19 → **7.66 MB**. Queue: 4 097 → 40 053 → **112 053** elements,
      132.2 → 963.3 → **2 868 ms**, heap 2.80 → 5.36 → **10.56 MB**. D-pad cost
      per keypress **3.4 → 49.7 → 223 ms**. Focus never breaks; the screens just
      become unusable. **Recommended threshold: virtualise above ~750 rows,
      Queue first.**
- [x] **`JSON.stringify(params)` cache keys — FIXED.** `js/api.js` gained
      `_stableParams` (sorted keys). Before: the same logical call built two
      ways produced 2 distinct keys. After: 1. `SubsonicAPI.cacheSize()` after
      an identical fixed keyboard walk is 24 on both builds, localStorage API
      entries 9 on both — the cache does not grow.
- [x] **The four parked product decisions** (S3 T8b, S2 NEW-3, S4 NEW-4,
      S4 NEW-5) reproduced in `docs/v3-9-report.md` §6 with evidence,
      recommendation and unblocking condition. **None implemented.**
- [x] **Credential audit re-run, shape-based, including derived tokens.**
      **0** replayable `t=<md5>`/`s=<salt>` pairs across 156 text files and all
      four `.wgt` archives. The naive whole-token grep is useless here — the
      account's username and password are the **same** short common English
      word and it returns 216 lines of prose — so the audit tests value
      position. Two real findings, both fixed: `tickets/prompt-3.9.md:57`
      documented the mock harness with a **stale** user/pass that
      `tests/mock-boot.js` abandoned several sessions ago, and that stale value
      happened to equal the live account's credentials; and
      `prompts/P15c-fix broken login-prompt.md:10` carried a real
      `ping.view?u=<live username>` URL. `prompts/pre-release-security-scan.md`
      extended with §1g (derived tokens) and §1h (shape-based search), as a
      quoted heredoc that runs correctly straight out of the markdown.
- [x] **Repo hygiene proposed, nothing deleted.** 170 MB repo, 252 KB app.
      191 loose root PNGs (62 MB), `.playwright-mcp/` (11 MB, 652 entries),
      `screenshots/` (93 MB), two stale `.wgt`, four `.DS_Store`. Proposed
      `.gitignore` diff is in `docs/v3-9-report.md` §7, **with the correction
      that `/*.png` must carry `!icon.png` and `!icon-oblong.png`** — both are
      `build.sh` inputs, so a bare glob breaks a clean checkout.
- [x] **Manual TV test list** — 10 items, six of them things no browser can
      verify, each saying what a failure would mean.
      `docs/v3-9-report.md` §8.
- [x] **Final verification pass.** Keyboard-only walks of every screen on the
      mock rig at scale (1 200 albums / 2 000 artists / 14 000 songs /
      7 libraries, 3 scoped) and on the live server; the bundled build walked
      with `tests/mock-boot.js` injected, one non-2xx only (the Tizen-only
      `404 $WEBAPIS/webapis/webapis.js`). Paging the Albums grid to its end by
      d-pad: 832 real presses, **final index 515 = "Album 0516", which is the
      complete set** for libraries 1–3 of the rig's 7 (172+172+172 = 516,
      verified against `window.__MOCK__`), 52 mounted cards, 413 elements,
      **0 focus-integrity failures over 832 checks**. Six regression greps
      clean, D6 `translateZ(0)` intact, `node --check` clean, `./build.sh` both
      gates clean, `index.html` bundled at `?v=v3-9`.

**New, reported not actioned:** `LazyLoader.observedCount()` ratchets to 94 over
a whole-app live walk and does not fall (`js/app.js:1576` covers screen
deactivation but not in-screen Library tab switches). Library → Genres is now
the largest unvirtualised screen at 2 453 live elements.

---

# PART C — THIS SESSION: Session 1 — Baseline + quick wins

Read `CLAUDE.md`, `PROGRESS.md` (tail only — it is ~292 KB, use
`tail -200`), and `docs/TESTING.md` first, then print the session-start
confirmation line the project `CLAUDE.md` requires.

Work the tasks in order. T1 must complete first — everything else is measured
against it.

## T1 — Scale rig + performance baseline

**Rig.** Extend `tests/mock-boot.js` to read URL query params and generate
fixtures at scale: `?mockAlbums=N&mockArtists=N&mockSongs=N&mockLibraries=N`
(defaults = today's 14/10/20/1, so existing use is unchanged). The mocked
`getAlbumList2` must honour `size`, `offset` and `musicFolderId`;
`getMusicFolders` must return `mockLibraries` folders; `getArtists` must
return the artists indexed alphabetically. Keep it ES2017 and dependency-free.

**Baseline.** Create `docs/perf-baseline.md` recording, for **v3.8 as it
stands today** (measure before making any other change in this session), at
1920×1080 with CPU throttled 6×:

| Measurement | How |
|---|---|
| Albums grid: DOM cards after scrolling to end | mock rig `?mockAlbums=1200`, hold Right to the end |
| Albums grid: total elements under `#app` | same |
| Albums grid: `querySelectorAll` calls per 10 keypresses | §A3 recipe |
| Albums grid: JS heap after full traversal | `performance.memory.usedJSHeapSize` |
| Now Playing: raster/paint time across 3 track changes | Performance trace, attribute to `.np-bg-image` |
| Cover art: `getCoverArt` requests on 2nd load, and how many `fromDiskCache` | CDP `Network`, live server if reachable |
| Page layers held at rest | CDP `LayerTree` on Library |

Record each number with the exact method used. Later sessions will re-measure
against this file, so it must be reproducible.

**Acceptance:** `docs/perf-baseline.md` exists with every row filled or
explicitly marked "not measurable, reason". The mock rig loads at
`?mockAlbums=1200&mockArtists=2000` and the Albums tab renders.

## T2 — Stable auth salt for media URLs

**Problem.** `js/api.js:102-112` — `_buildUrl()` generates a fresh
`SonanceUtils.generateSalt(12)` and recomputes the md5 token on **every**
call. `getCoverArtUrl()` (`js/api.js:244-248`) and `getStreamUrl()`
(`js/api.js:240-242`) both route through it, so the same cover produces a
different URL every time. Therefore:

- Cold launch always refetches 100% of visible art — yesterday's JPEGs sit in
  Chromium's disk cache under URLs that can never be regenerated.
- Any `ImageCache` eviction guarantees a refetch even though the bytes are on
  disk.
- `ImageCache.getUrl()` (`js/image-cache.js:115-125`) returns a fresh signed
  URL on a miss and stores nothing, so the 100 px art is **downloaded twice on
  every track change** — `js/app.js:867-868` preloads under one URL,
  `js/app.js:943` then builds a different one.

**Change.** Compute the salt and token **once per `SubsonicAPI` instance**, in
the constructor alongside `this.username` / `this.password`, and reuse them.
Apply at minimum to `getCoverArtUrl` and `getStreamUrl`; applying to all
requests is fine and simpler. The Subsonic auth scheme has no nonce or replay
protection, so salt reuse is spec-legal and is what most clients do.

Add a brief `// WHY:` comment explaining that URL stability is load-bearing
for the HTTP disk cache, so a future refactor does not reintroduce per-call
salting.

**Acceptance:**
- Two successive `getCoverArtUrl(id, 300)` calls return **identical** strings.
- Live server (or mock): load the app, note `getCoverArt` request count;
  hard-reload; on the second load a majority of `getCoverArt` responses report
  `fromDiskCache: true`. Paste the counts. Baseline is expected to be zero.
- Playback still authenticates: play a track end-to-end via the keyboard and
  confirm audio progresses (HTML5 fallback in the browser).
- Login, logout and re-login still work.

## T3 — Shrink the Now Playing blur raster

**Problem.** `css/styles.css:3435-3451`:

```css
.np-bg-image {
    top: -25%; left: -25%;
    width: 150%; height: 150%;        /* 2880 × 1620 at 1080p */
    filter: blur(60px) saturate(1.3);
}
```

The source bitmap is only 100 px (`js/screens/nowplaying.js:992`), upscaled
~29×, then blurred with a 60 px radius across a 4.6-megapixel region.
Chromium 63's `blur()` is a three-pass box blur. This is re-paid on **every**
NP open and **every** track change (`js/screens/nowplaying.js:985-999`
rewrites `backgroundImage`).

**Change.** Compute the blur at low resolution and let the GPU upscale.
Render the element at roughly 1/6 scale with a proportionally smaller radius,
then `transform: scale(6) translateZ(0)` with a centred `transform-origin`.
Because the source is a 100 px image being massively upscaled anyway, the
result is visually indistinguishable at a fraction of the raster cost. Keep
the 25% overscan intent so no black bars appear with landscape covers — size
and position the scaled element so it still covers the viewport at every
aspect ratio.

Tune the exact scale factor and radius to whatever reproduces the current
look; the ratio matters more than the specific numbers.

**Acceptance:**
- Screenshots of Now Playing before and after at 1920×1080, both saved and
  **read back and compared by you**. The backdrop must be visually
  indistinguishable — same softness, same colour spread, no banding, no black
  edges. Test with a portrait cover, a landscape cover and a square cover.
- Performance trace across 3 track changes before and after; paste the
  raster/paint delta.
- No black bars at any cover aspect ratio.

## T4 — Remove static `will-change` from the page layers

**Problem.** `js/app.js` carefully sets and clears `willChange` around every
transition (`js/app.js:1415`/`1443`, `1465`/`1501`) — but the clear is a
**no-op**, because CSS re-asserts it permanently:

- `css/styles.css:421-437` — `.page-layer { will-change: transform, opacity; }`,
  a full-viewport ~7 MB layer pinned for the whole session.
- `css/styles.css:442-451` — `.page-ghost`, same.
- `css/styles.css:1987-1998` — `.library-content { will-change: opacity; }`,
  which promotes the **tallest scrolling content in the app**, permanently,
  to smooth a 150 ms tab cross-fade.

**Change.** Remove those three static declarations and let the existing JS own
the hint dynamically. The project already does this correctly in
`js/screens/nowplaying.js:880-900`
(`_enableLyricsCompositingHints` / `_scheduleClearLyricsCompositingHints`) —
follow that pattern. For `.library-content`, add and remove the hint around
the tab cross-fade only.

**Acceptance:**
- CDP `LayerTree` on the Library screen at rest: `.page-layer` and
  `.library-content` no longer hold a permanent compositor layer. Paste the
  before/after layer counts.
- Page slide transitions (top-nav Left/Right), zoom-in (Enter into album) and
  zoom-out (Back) are all still smooth — capture a Performance trace of each
  and confirm no new long frames versus baseline.
- The Library tab cross-fade still looks correct (screenshot mid-fade).

## T5 — Remove the per-keypress `querySelectorAll` in the Albums grid

**Problem.** `js/screens/library.js:586-589`, inside the `library-grid`
`onFocus`:

```js
var elements = document.querySelectorAll('#library-grid .focusable');
if (elements.length - idx <= 5) { ... }
```

`hasMore` stays true for essentially the whole session, so **every arrow
press** runs a document-wide descendant match returning up to 1000+ nodes,
purely to read `.length`. The count is already available as
`_albumLoader.offset`.

**Change.** Use `_albumLoader.offset` (or a counter maintained in
`_appendAlbumsToGrid`) instead of the query. Also raise the page-ahead trigger
from `<= 5` items — on a ~10-column grid that is less than one row, so the
user reaches the bottom before the next page lands. Use 1–2 rows.

Session 2 will replace this code path wholesale with virtualisation; do it
anyway, because it is a two-line change that measurably helps now and keeps
the two sessions independently shippable.

**Acceptance:** with `?mockAlbums=1200`, instrument `querySelectorAll` per
§A3, press Right 10× inside the albums grid, and confirm **0** calls
attributable to this handler. Paste the counter value. Confirm pagination
still loads further pages as you approach the end.

## T6 — Version bump to v3.9

Bump `CACHE_BUST` in `build.sh`, the `?v=` query strings in `index.html`, and
the About row in `js/screens/settings.js` to `V3.9`. Verify with
`grep -rn "v3-8\|V3.8" index.html build.sh js/screens/settings.js` returning
no hits.

## Session 1 close-out

Complete §A4 in full, then write `next_prompt.md` per §A5 with **PART C set to
Session 2 (virtualise the Albums tab)**, expanded to the same level of detail
as this PART C, and PART D carrying the `docs/perf-baseline.md` numbers plus
whether the live server and `SONANCE_USER` were available.

---

# PART D — State carried forward

**Session 0 (this file).** Review only, no code changes. Findings verified
against v3.8 sources by direct reading; every file:line reference above was
checked at the time of writing.

- Live Navidrome `http://192.168.0.2:4534` — **multiple libraries configured**,
  14,000+ songs. The v3.8 fan-out paths are live, so Session 3's localStorage
  quota work and Session 4's merge fix both matter.
- User-reported symptoms: Albums scrolling, Now Playing open / track change,
  cover art reloading. All three have identified causes (see PART B).
- No perf baseline exists yet — Session 1 T1 creates it.
- `index.html` is currently in **bundled** mode; `Sonance3.wgt` is the v3.8
  artefact (79 KB, 7 files).
- Playwright MCP server is **broken** in this environment (`ENOENT: npx`).
  Use the Playwright CLI / Node API from Bash.

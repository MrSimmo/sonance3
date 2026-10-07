# Sonance v3.10 — TV-scale UI, snappier navigation, Now Playing upgrades

**Ticket type:** version spec (persistent). Executed by `tickets/prompt-3.10.md`
(eight chained sessions driven by `next_prompt.md`).
**Written:** 2026-10-01 by a planning session (Opus 5.5). That session was read-only plus
Playwright probes and mockups on the mock rig; no source changed.
**Mockups:** `tickets/mockup-3.10-*.jpg` (22 files, §9). The same set is published
privately at https://claude.ai/artifact/6A6y4MbmkVDnzt6tPUrAKm. Mockups are the
**visual target**, not a pixel spec. They were drawn by injecting CSS into the
real app with CSS `zoom`, which the real implementation must NOT use (D49).

---

## 1. Version & scope

v3.10 makes Sonance readable and responsive from the sofa:
- a user-selectable interface size with a larger default;
- a much clearer, solid-accent focus highlight;
- faster navigation: no dropped key presses, no wasted re-renders, and lists
  that stay fast at 14,000 rows;
- Apple-Music-style zoom transitions;
- fixes to Now Playing focus and to bottom-bar navigation;
- an artist line on every track row;
- Now Playing upgrades: credits, 2× blur, Up Next, sleep timer and a resumable queue;
- a launch splash and a gradient-backdrop option;
- discovery features: a complete Songs list, album sort/filter, playlist cover
  mosaics, extra Home rows, and a hold-OK options sheet;
- an alternative **oblong-icon package** (`Sonance3-Oblong.wgt`), so the app
  shows a wide tile on the TV's home row. The square package stays the
  default.

## 2. Background

- **User report, 2026-10-01.** Eleven requests plus "suggest other
  improvements", with TV photos of Sonance and of Apple Music on the same
  Samsung Q90R. Apple Music's text and tiles are about **2×** Sonance's. Sonance
  grid titles are 12 px and most text is 13–15 px (117 hard-coded `font-size`
  values, 731 `px` tokens in `css/styles.css`). Its focus highlight is hard to
  see from a distance.
- **Oblong home-row icon, added by the user when approving the plan
  (2026-10-01).** Other sideloaded apps, Litefin in particular, ship an
  alternative "oblong" package that shows a wide tile on the Q90R home row.
  This reopens v3.9's **D46**, which concluded an oblong launcher icon "can
  never work". The planning session inspected Litefin's public source
  (`github.com/MoazSalem/litefin`, branch `development`):
  - Its `normal-oblong` build differs from `normal` **only in the icon file**.
    `webpack.config.cjs` runs `getPlugins('modern', { iconSrc:
    'assets/icon_oblong.png' })`, which copies that file to `assets/icon.png`.
  - Both builds use the same `config.xml`, with a bare
    `<icon src="assets/icon.png"></icon>` and no width/height attributes.
  - `assets/icon_oblong.png` is **1920×1080 (16:9)**, opaque and full-bleed
    (logo plus wordmark on solid black), an 8-bit palette PNG of 23,222 B.
    The square `assets/icon.png` is 256×256.

  Sonance's v3.9 attempt (`icon-oblong.png`) was **512×423 (1.21:1), with
  rounded corners and transparency**. That is the Seller Office
  store-listing shape, not the shape Litefin uses. D46 was right that 512×423
  is a store asset, but wrong that no oblong launcher tile is possible. The
  user has seen Litefin's oblong tile on the TV.

  Litefin's `config.xml` also carries `<tizen:profile name="tv-samsung"/>`,
  which Sonance's lacks. Since Litefin's square and oblong packages share
  that file, the profile is not what makes the tile wide. It is listed as a
  fallback in §10.
- **v3.9** (2026-09-03/04): a six-session performance and correctness programme
  — `tickets/prompt-3.9.md`, `docs/v3-9-report.md`, `docs/perf-baseline.md` —
  then `tickets/prompt-3.9-fix1.md`. Its invariants are binding (§5.3).
- **Measured by the planning session** on the mock rig (Chromium/Playwright 1.63
  headless, 1920×1080, DPR 1):

| Finding | Measurement | Code |
|---|---|---|
| The Albums grid rebuilds the whole mounted band whenever the visible range moves | 0 of 50–72 mounted cards survive a row step; **350–953 elements created per Down press**. Every card carries `translateZ(0)` (D6), so on the TV each one is a new compositor layer plus raster | `js/utils.js:448` `_updateVisibleRange` (`this._grid.textContent = ''` at :482) |
| Key presses are dropped during transitions | Enter on an album, then Escape 120 ms later → still on the album | `js/app.js:129` `TRANSITION_LOCK_MS = 300`; `_beginTransition` :145 |
| Sliding along the top nav renders the screens it passes | 4× Right at 90 ms intervals → **2 full screen renders** (Library, Now Playing) | `js/app.js:1075-1096` |
| The Library sub-nav switches tab, tearing the grid down, on every Up/Down | By inspection | `js/screens/library.js:288-336` (`onFocus` → `_switchTabAnimated`) |
| Re-entering the Now Playing controls row lands on shuffle | Up then Down → `np-shuffle`; Down from the top nav → `np-shuffle` | `js/focus.js:433-447` (`_tryTransition`: Down lands on index 0) |
| Focus can land on invisible elements | Right ×6 on Now Playing with no lyrics → `#np-lyrics` (`display:none`). With no track, Down ×12 on Home → `nowplaying-bar` while the bar has opacity 0 | `css/styles.css:3466`; `js/focus.js:429` |
| The bottom bar cannot open Now Playing by d-pad | Down lands on `.np-bar-btn` #0 (Previous), so Enter goes to the previous track. The art/title block is click-only, and its focus style is a pink icon tint only | `js/app.js:747-815`, `:1103-1116`; `css/styles.css:608` |
| The Library sub-nav never reaches the bar | Down on the last tab wraps to Albums | `js/screens/library.js` sub-nav `onKey` |
| The bar's focus zone is registered about 10 times with copy-pasted handlers | home, album, artist, library ×4, playlists ×2, search, settings, app | `grep -n "registerZone('nowplaying-bar'"` |
| Album-detail track rows have no artist | Row text: `1 \| Track 01 \| 3:10` | `js/screens/album.js:321-365` |
| Long lists render every row | (v3.9 S6) 14,000-row queue: 112,053 elements, 2.9 s to paint, 223 ms per d-pad press | `js/screens/queue.js`, `playlists.js` |
| Library → Songs shows 50 random songs and cannot page | (v3.9 S6) | `js/screens/library.js:951-954` (`getRandomSongs(50)`) |
| Script cost on desktop is fine | Keypress → first frame **17–54 ms, 0 long tasks**, even at CPU 6× | So TV lag comes from DOM/layer churn, raster and dropped input, not script speed |
| CSS `zoom` is unsafe for scaling | Under `zoom` the top-nav pill and the lyrics slide land in the wrong place (`getBoundingClientRect` vs `translateX`; `calc(320px - 50vw)`). Chromium standardised `zoom` in v128, so Chromium 63 behaves differently again | Mockups 02 and 10 needed manual correction |

## 3. Decisions

### 3.1 Taken by the user (2026-10-01) — binding

1. **Default interface size 150%.** Offered sizes: 100 / 125 / 150 / 175 / 200%.
   Users with no stored value get 150%.
2. **Focus style: "stronger pink".** Focus stays the accent colour but becomes a
   **solid** fill (today it is a 55%-alpha pink). Text on it is white, or dark
   on light accents (§6.3). Cards get a bigger scale plus a deep shadow. A
   white-focus alternative was shown and rejected.
3. **All four groups of additions approved:**
   - (B+F) a complete Songs list, plus album sort/filter with counts;
   - (A+D) playlist cover mosaics, plus extra Home rows;
   - (C) a hold-OK options sheet;
   - (E+G) an Up Next strip, a sleep timer, and resume-queue.
4. **Parked, not built:** artist radio/top songs on artist pages, internet
   radio, idle screensaver, "Add to playlist…", and an options sheet on
   album/artist cards.
5. **An oblong home-row icon package is required (R12).** It ships as an
   alternative package alongside the square one, as Litefin does.

### 3.2 Planning decisions

Session 1 logs these as **D49–D59** in its PROGRESS entry.

- **D49 — Interface size uses rem units on a scaled root `font-size`**, not
  CSS `zoom` and not the viewport meta. Evidence: the zoom mis-positioning in
  §2. A `zoom`-based setting would be a D47-class trap: correct in the browser,
  wrong on the TV.
- **D50 — Focus is a solid accent fill with a computed "ink" colour.** The
  ink is white if white-on-accent contrast is ≥ 3:1, else `#15151c`.
  Computed 2026-10-01:

  | Ink | Accents (white-on-accent contrast) |
  |---|---|
  | White | Pink 3.67, Red 3.76, Blue 3.68, Purple 4.23 |
  | Dark | Orange 2.80, Amber 2.15, Green 2.28, Teal 2.49 |
- **D51 — The top nav and the Library sub-nav auto-navigate after a dwell of
  about 180 ms**, not on every press. The pill/highlight still moves
  instantly. Down or Enter during the dwell navigates immediately. This amends
  CLAUDE.md "Auto-navigate on slide … immediately transitions".
- **D52 — Transitions are interruptible.** The 300 ms input lock is removed. A
  new navigation finishes the running transition instantly and then starts.
- **D53 — Zoom transitions originate from the focused element's centre.** Back
  zooms out into the stored origin.
- **D54 — Focus zones may declare an entry index.** `np-controls` always
  enters on Play/Pause.
- **D55 — An unavailable lyrics button is dimmed, not `display:none`.** It
  stays focusable (stable zone shape, V3.7-fix29). Focus may never land on an
  invisible element.
- **D56 — The bottom bar's first focus target is "open Now Playing".** The bar
  is not focusable while hidden, and one shared helper registers it.
- **D57 — Every track-list row shows the artist**, album detail included.
- **D58 — Compositor-dependent changes (smooth scrolling) ship behind
  Settings → Advanced, default Off,** until seen on the TV (D47 rule).
- **D59 — Supersedes D46.** An oblong launcher tile is achievable with an
  alternative package whose `icon.png` is a **1920×1080 opaque, full-bleed
  16:9 image**, matching Litefin's shipped `normal-oblong` variant. The
  512×423 rounded, transparent asset (`icon-oblong.png`) was the wrong shape;
  keep it, untouched, for a future Seller Office listing. Both packages share
  one `tizen:application` id, so installing either replaces the other.

## 4. Goals and non-goals

**Goals.** R1–R12 and A1–A8 in §7, each with acceptance criteria.

**Non-goals:**
- The parked items in §3.1.
- Any change to the auth flow, the login screen layout, or the AVPlay lifecycle.
  Exception: A8 adds an explicit "restore paused" path.
- The v3.9 parked product decisions T8b, NEW-3, NEW-4 and NEW-5 (`docs/v3-9-report.md` §6).
  Exception: NEW-3, Back restoring deep grid focus, may be fixed if R1.6's
  recycling makes it trivial. Record it if done.
- A light theme. Any external resource. Repo hygiene, deletions, or `.gitignore`
  changes beyond adding generated test output (`test-results/`,
  `playwright-report/`).
- Redacting historical PROGRESS.md prose. Report credential leaks instead; do
  not rewrite history.

## 5. Constraints

### 5.1 Platform (CLAUDE.md, non-negotiable)

- **JavaScript:** vanilla ES2017 in the codebase's `var`/`function` style. No `?.`, `??`,
  `Array.flat`, `Object.fromEntries`, `BigInt` or top-level `await`. No
  framework, no build step beyond `build.sh`.
- **CSS:** no `backdrop-filter`. No flex `gap`: use `> * + *` margins. On grid
  use `grid-gap`, never the `gap` shorthand. Prefer `position: fixed` over
  `sticky`.
- **Playback:** AVPlay only on Tizen, with HTML5 `<audio>` as the browser
  fallback.
- **Network:** no external resources. Requests go only to the configured server.
- **Input:** every interactive element is reachable by d-pad. Samsung keycodes:
  Back 10009, Play/Pause 10252, Stop 10253, Rewind 10412, FF 10417.
- **Logging:** `[Sonance]` prefix, through `SonanceUtils.log` (gated, D28).

### 5.2 Animation rules

- Animate only `transform` and `opacity`. Never `transition: all`. Never
  transition layout properties (`width`, `height`, `margin`, `padding`, `left`,
  `right`, `top`, `bottom`, `font-size`, `border`).
- `color`, `background` and `font-weight` snap instantly. This includes the
  existing `.settings-toggle-row` `transition: background`, which must go.
- Durations: 0.12–0.15 s for focus changes, ≤ 0.25 s for page transitions.
- `will-change` is set dynamically only (v3.9 T4, `FocusManager` cap of 5).

### 5.3 v3.9 invariants — must not be undone

- **D6** — keep `transform: translateZ(0)` + `backface-visibility: hidden` on
  `.album-card`, `.album-grid-card` and `.artist-grid-card`. The focused state
  keeps `translateZ(0)` too.
- **D11** — Albums grid geometry is **measured** from the rendered grid
  (`_measureAlbumGeometry`). At every interface size, columns and row pitch
  must come from measurement.
- **D17** — `LazyLoader` has two teardown paths: `releaseWithin` on recycle,
  `unobserveWithin` on screen teardown. R1.6 may narrow `releaseWithin` to the
  removed nodes only, but must keep "release only" semantics on recycle.
- **D23–D25** — paginated album lists go through
  `SubsonicAPI.prototype.createAlbumListCursor`. `_mergeAlbumLists` is for
  non-paginated fan-out only. The comparator normalises name/artist
  (lowercase, leading article stripped). Timestamps compare raw.
- **D32** — `FocusManager`'s `scrollIntoView` stays gated on `zone.virtual`.
- **D33** — `.eq-bar` keeps its base `transform: scaleY(0)`.
- **D40** — the Search `VirtualGrid` branch is live; keep it.
- **D47** — `.np-bg-image` gets no transform, no `translateZ` and no scale
  trick. Its correctness is TV-only.
- **V3.7-fix29** — the `np-controls` zone shape stays stable (constant
  selector).
- **v3.9 NEW-1** — the Settings zones are rooted at `#settings-left`.

### 5.4 Credentials and server writes

- Credentials live only in `TEST-ACCOUNT.local.md` and are referenced by
  pointer. Never print or write them.
- Redact `u=`, `t=`, `s=` and `p=` in every logged URL. A `t`/`s` pair is a
  replayable credential (D30).
- Live-server writes allowed: `savePlayQueue` / `savePlayQueueByIndex` on the
  disposable test account (A8), and `scrobble` as the app already does.
- **Not allowed:** star/unstar, playlist edits, or any server configuration
  change. Test those against the mock rig.

### 5.5 Spec amendments this version is allowed to make

- **CLAUDE.md "v3 UI Design System":**
  - Focus Styles → v4: solid accent focus, card ring + shadow, row fill.
  - Navigation → dwell auto-navigate (D51), bottom-bar target (D56).
  - Layout → rem plus interface size (D49).

  Also the "Critical Rules → UI Design" line that bans
  outline/box-shadow focus rings: the card *ring* is a box-shadow and becomes
  allowed for cards only. Each amendment cites its D-number.
- **`docs/UI-MOCKUP-REFERENCE.md`** is stale: it still describes the pre-v3
  sidebar design. Rewrite it to the as-built v3 layout plus the v4 tokens (§6).
  New tokens go into it **before** they go into CSS (global design-spec rule).
- Known discrepancy, not to be fixed silently: CLAUDE.md says content
  `max-width: 1400px`, but CSS uses 1600px (`#page-current > *`). Record it.

## 6. Design tokens (v4)

### 6.1 Interface size (R4)

- Root: `html { font-size: 10px }` at 100%. The applied root size is
  `10px × scale`, for scale ∈ {1, 1.25, 1.5, 1.75, 2}. The default is 1.5.
- Every CSS length that is not a hairline converts `Npx → (N/10)rem`.
  - 1px borders and dividers stay `px`.
  - `.np-bg-image`'s `blur()` radius stays `px` (§6.5).
  - `vw`/`vh`/`%` stay as they are. For example
    `translateX(calc(320px - 50vw))` → `calc(32rem - 50vw)`.
- At scale 1.0 the rendered app must be **pixel-identical** to today (§7 R4).
- JavaScript:
  - Inline style lengths go through `SonanceUtils.rem(px)` → `'(px/10)rem'`,
    or move to CSS classes.
  - Layout maths in px — scroll paddings such as `- 20`, the 60 px slide
    distance, `VirtualGrid` `itemHeight` defaults — goes through
    `SonanceUtils.px(n)` → `n × scale`.
  - Measured geometry (D11, nav rects) stays measured.
- Persisted under `localStorage['sonance-ui-scale']`. It is applied **before
  first paint** by an inline `<script>` in the `<head>` of `index.html`, and of
  `tests/mock-index.html`.

### 6.2 Type at 150% (reference, derived)

| Element | Today (100%) | At 150% |
|---|---|---|
| Grid title | 12 px | 18 px |
| Grid meta | 11 px | 16.5 px |
| Track / song title | 15 px | 22.5 px |
| Row meta | 13 px | 19.5 px |
| Top-nav item | 15 px | 22.5 px |
| NP title | 28 px | 42 px |
| NP bar height | 76 px | 114 px |

No separate type ramp is introduced. The scale is the ramp.

### 6.3 Focus (R6) — "stronger pink"

**Tokens:**
- `--focus-fill: var(--accent)` (solid).
- `--focus-ink`: `#ffffff` or `#15151c`, per D50.
- `--focus-ink-soft`: the ink at 0.86 alpha, as an `rgba()` string. There is
  no `color-mix` on Chromium 63.
- All three are set by `App.applyAccentColor()` next to `--accent`.

**Rules by element:**

| Element | Focused | Unfocused |
|---|---|---|
| Rows (`.track-row`, `.song-row`, `.queue-row`, `.search-result-item`, `.artist-album-row`, and new list rows) | Background `--focus-fill`; title, number, duration and icons in `--focus-ink`; meta in `--focus-ink-soft`; `transform: scale(1.02)`, `transform-origin: left center` (unchanged) | — |
| Pills (top nav, Library sub-nav) | Solid `--focus-fill`, label `--focus-ink` | "Selected" stays `rgba(255,255,255,.15)` with a white label. The pill state and the label colour must always agree: the mockup harness hit white-on-white when they diverged |
| Buttons (hero/album/artist Play and Shuffle, NP bar buttons, Settings rows, Logout, exit dialog, keyboard keys) | Solid `--focus-fill` + `--focus-ink`. NP small transport buttons get a circular fill platter (today it is only an icon tint) | NP Play/Pause keeps its white platter |
| Cards (album, artist, playlist, genre, Home) | `transform: scale(1.12) translateZ(0)` (D6 kept); art `box-shadow: 0 0 0 0.4rem var(--focus-fill), 0 2.2rem 4.4rem rgba(0,0,0,.7)`; label `#fff`, weight 700 | Label `rgba(240,240,245,.72)`, weight 500 |

**Timing:** colour and background snap instantly. Transforms take 0.12–0.15 s.

### 6.4 Transitions (R2)

| Transition | Specification |
|---|---|
| Slide (top nav) | `translateX(±8rem)` + opacity, 0.22 s, `cubic-bezier(.2,.8,.2,1)` |
| Zoom in (Enter → sub-page, or in-screen detail) | Incoming starts at `scale(0.86)`, opacity 0 → `scale(1)`, opacity 1, over 0.25 s. Outgoing goes to `scale(1.08)`, opacity 0, over 0.2 s. Both use `transform-origin` = the focused element's centre in page-layer coordinates. Back reverses into the stored origin |
| Rise (Now Playing opened from the bar or auto-NP) | Incoming `translateY(6rem)`, opacity 0 → 0, over 0.25 s. Back from Now Playing uses the reverse ("sink") |
| Library tab change | Cross-fade 0.15 s (unchanged) |

### 6.5 Now Playing backdrop (R8)

`.np-bg-image { filter: blur(120px) saturate(1.3) }`: the same 150% overscan
box, opacity and overlay as today, with **no transform** (D47).

### 6.6 Gradient backdrop (R10)

- Layered `radial-gradient(… at 12% -12%, rgba(var(--accent-rgb), .42),
  transparent 62%)`, then `radial-gradient(… at 100% 115%, rgba(88,70,230,.40),
  transparent 60%)`, then `linear-gradient(180deg, #1d1d2c, #121219)`.
- Painted once on a fixed layer behind `#page-container`.
- No animation and no `will-change`.
- Not shown on Now Playing or Login.

### 6.7 Splash (R11)

- A logo block (the existing S-wave SVG on the gradient tile, "Sonance", and
  "BY SIMMO").
- Timeline:

  | Phase | Time | Motion |
  |---|---|---|
  | Grow | 0 → 450 ms | `scale(0)`, opacity 0 → `scale(1)`, opacity 1, easing `cubic-bezier(.2,.9,.25,1.15)` |
  | Hold | until 900 ms | — |
  | Exit | 500 ms | → `scale(2.2)`, opacity 0 |
- Total about 1.4 s. CSS `@keyframes` only.

## 7. Requirements and acceptance criteria

Each requirement names the session that implements it (S1–S8, see
`tickets/prompt-3.10.md` PART B). "e2e" means a spec under `e2e/` that runs in
`node node_modules/@playwright/test/cli.js test` on the mock rig and passes.
Every number in an acceptance criterion is checked by a test or a pasted
measurement.

### R1 — End-to-end performance

**R1.1 On-device performance overlay (S1).**
- Settings → Advanced → "Performance overlay" (Off/On), stored in
  `sonance-perf-hud`.
- When on, a fixed corner overlay updates at most twice a second, through a
  `setTimeout` chain (`setInterval` is banned by the regression grep). It shows:
  - FPS over the last second;
  - worst frame time;
  - the last key's keydown → next-painted-frame latency (two `rAF`s);
  - long-task count, via `PerformanceObserver('longtask')`, or "n/a" if
    unsupported;
  - element count under `#app`;
  - the current screen.
- Acceptance:
  - Off by default.
  - When off: 0 rAF loops, 0 observers and 0 listeners attached (asserted).
  - When on: its own scripting is ≤ 0.5 ms per frame (measured).
  - It survives navigation.
  - The text is readable at 100% and at 200%.

**R1.2 Interruptible transitions (S4).** Removes the input lock (D52).
- Acceptance (e2e):
  - Enter on an album, then Back 120 ms later → ends on Library with focus
    restored to the originating card.
  - 10 alternating Enter/Back presses at 80 ms intervals → the final screen
    matches the last input, and 500 ms later there are 0 `.page-ghost` nodes
    and no leftover inline `transform`/`opacity` on `#page-current`.
  - No key press is ignored at any point.

**R1.3 Dwell auto-navigation (S4)** (D51).
- Acceptance (e2e):
  - 4× Right at 90 ms intervals on the top nav → exactly **1** screen render
    (the destination; render counts via wrapped `XScreen.render`).
  - One press → the render starts ≤ 220 ms after keydown.
  - Down within the dwell → navigates immediately and focus lands in content.
  - Library sub-nav: Up/Down across 3 tabs at 90 ms intervals → exactly 1
    tab build.

**R1.4 Render work off the transition's critical path (S4).**
- Measure each screen's synchronous `render` + `activate` time at CPU 6× by
  wrapping both.
- For any screen above 16 ms, defer the below-the-fold build to after the
  transition's first frame.
- Acceptance: a before/after table for all nine screens is pasted into
  `docs/perf-baseline.md`, and no screen is above 16 ms synchronous at CPU 6×.
  If a screen cannot get under 16 ms, record it with the reason.

**R1.5 Prefetch on focus dwell (S4).**
- An album card focused for ≥ 400 ms prefetches `getAlbum` through
  `_cachedRequest`. In-flight requests are de-duplicated (v3.9 T7).
- Acceptance:
  - Dwell, then Enter → 0 `getAlbum` network requests on Enter.
  - Moving across cards in under 400 ms each → 0 prefetches.

**R1.6 Incremental virtual-grid recycling (S5).**
- When the visible range moves, `VirtualGrid._updateVisibleRange` must remove
  only the nodes that left and create only those that entered, adjusting the
  inner grid's `translateY`. `onRangeRender` still receives the full ordered
  mounted list.
- Acceptance, on the mock rig with `mockAlbums=1200`:
  - A one-row Down step keeps ≥ (mounted − 2 × cols) nodes and creates
    ≤ 2 × cols cards' worth of elements. Today it keeps 0 and creates 350–953.
  - `img` elements created per row step ≤ 2 × cols.
  - A full traversal in both directions has **0 focus-integrity failures**
    (v3.9 method).
  - `LazyLoader.observedCount()` stays bounded.
  - Same results for the Artists grid and the Search virtual branch.

**R1.7 Virtualise long song lists (S5).**
- Playlist detail, Queue, Genre songs and Library → Songs use `VirtualGrid`
  with `columns: 1`. Focus zones use the `virtual: { getCount, getItemAt }`
  contract.
- Acceptance at 14,000 rows on the mock rig, CPU 6×, compared with v3.9 S6
  (1,892 ms, 2,868 ms, 223 ms per press):
  - elements under `#app` ≤ 1,500;
  - first paint ≤ 150 ms;
  - d-pad cost ≤ 10 ms per press;
  - 0 focus-integrity failures over a full traversal;
  - Enter plays the correct track, and colour/options actions target the
    correct track.

**R1.8 Smooth-scroll experiment (S5)** (D58).
- Settings → Advanced → "Smooth scrolling (experimental)" (Off/On), stored in
  `sonance-exp-smooth-scroll`, default Off.
- When on, focus-follow scrolling animates. Acceptance: all focus-integrity
  tests also pass with it on.
- It goes on the TV checklist: the user compares the overlay's FPS with it
  off and on.

### R2 — Page transitions (S4)

Implements §6.4.
- Acceptance (e2e):
  - On Enter from a card or row, the incoming layer's computed
    `transform-origin` equals the focused element's centre in page-layer
    coordinates (±2 px). Back uses the stored origin.
  - In-screen detail views (`App.zoomContent`: playlist detail, genre detail)
    use the same origin.
  - Opening Now Playing from the bar uses "rise"; Back from Now Playing uses
    "sink".
  - Only `transform`/`opacity` transitions occur (asserted via
    `transitionstart.propertyName`).
  - Every duration is ≤ 0.25 s.
  - A mid-transition screenshot is read back.

### R3 — Now Playing controls default to Play/Pause (S3)

`FocusManager` gains a zone option, `entryIndex` (a number or a function). It
applies when focus enters the zone by an Up/Down transition, or from
`App._getPageFirstZone`'s drop out of the top nav. `np-controls` uses
Play/Pause.

The unavailable lyrics button becomes visible but dimmed (opacity ≤ 0.4) and
stays focusable; Enter on it is a no-op (D55).

Acceptance (e2e):
- From the progress bar, Down → `#np-play`.
- From the top nav on Now Playing, Down → `#np-play`.
- Right ×3, then Up, then Down → `#np-play`.
- A cold open → `#np-play` (as today).
- Across a full Left/Right sweep with and without lyrics, the focused element
  is never `display:none`, `visibility:hidden` or opacity 0.

### R4 — Interface size (S2)

Implements §6.1. Settings → Appearance → "Interface size ◄ 150% ►": Left/Right
or Enter cycles through 100 / 125 / 150 / 175 / 200%. The change applies live
via `App.applyUiScale(scale)`:
- set the root font size;
- re-measure the nav rects;
- re-render the current screen without a transition;
- refresh the NP bar;
- keep focus on the size row.

Acceptance:
- At **100%**, every screen state in the S1 visual baseline is
  **pixel-identical** (0 differing pixels; if anti-aliasing forces a
  difference, at most 0.05% of pixels with a max channel delta ≤ 8, with the
  diff bounding boxes reported).
- At 125, 150, 175 and 200%, on every screen:
  - no horizontal overflow (`scrollWidth ≤ clientWidth` for the page layer and
    every row/grid container);
  - the top-nav pill rect matches the selected item's rect within ±1 px;
  - the Library sub-nav pill matches its item within ±1 px;
  - the Albums grid's measured columns equal the CSS-resolved
    `grid-template-columns` count;
  - with lyrics open, the left column's left edge sits 6–10 rem from the
    viewport's left edge (60–100 px at 100%);
  - the NP bar and `#page-container` offsets scale.
- The full e2e suite passes at 100% and 150%. Focus-path specs also pass at
  200%.
- An Albums traversal at 150% has 0 focus-integrity failures.
- Changing the size during playback leaves `isPlaying` true and `currentTime`
  advancing.
- The setting persists across a fresh page.
- With no stored value the app boots at 150%.
- There is no visible small-to-large flash on boot: the first screenshot after
  load is already at the stored scale.
- No CSS `zoom` property and no `style.zoom` anywhere (D49 grep).

### R5 — Artist on every track row (S3)

- Album detail rows show the track artist under the title (`.track-row-artist`),
  on every row (D57).
- Playlist-detail rows add a cover thumbnail (lazy, via `ImageCache`/`LazyLoader`)
  plus "artist · album".
- Queue, Songs, Genre songs and Search song results all show the artist.

Acceptance (e2e): every row in those six lists has non-empty artist text (or
"Unknown artist"), visible (`offsetHeight > 0`). Screenshots are read back at
150%.

### R6 — Clear focus highlight (S3)

Implements §6.3.

Acceptance:
- A CSS audit lists every `.focused` rule, and each uses the v4 tokens. No
  `outline` focus rule remains.
- `transition: background` is gone (from `.settings-toggle-row` and anywhere
  else).
- For all 8 accent presets, contrast(`--focus-ink`, `--focus-fill`) ≥ 3:1,
  computed in an e2e test from the applied custom properties.
- D6 `translateZ(0)` is intact on the three card classes, at rest and focused.
- Screenshots of each focus type (card, row, pill, button, NP control, NP bar)
  at 150% are read back and compared against mockups 02, 05, 07, 09 and 11.

### R7 — Show Credits (S6)

- A new ⓘ button follows Lyrics in the NP controls row. Its icon is inline SVG,
  sized in rem.
- Enter opens a credits panel with the same geometry and slide as lyrics
  (`.np-layout.lyrics-active` pattern, transform/opacity only). Opening credits
  closes lyrics, and vice versa.
- Back closes the panel before Back leaves Now Playing (`handleBack`).
- Data comes from `getSong` (a new `SubsonicAPI.getSong(id)` through
  `_cachedRequest`) plus `getAlbum` for `recordLabels`, both OpenSubsonic.
- Sections, each rendered only when it has data:

  | Section | Fields |
  |---|---|
  | Performance | artist(s), featured/performer contributors |
  | Writing & production | contributors: composer, lyricist, producer, mixer, engineer, arranger, remixer, conductor; plus `displayComposer` |
  | Release | album, album artist, label, year / original date, track and disc, genres |
  | File | format, bit rate, sample rate / bit depth, channels |
  | Listening | play count, last played, BPM |
- If the content overflows, Down from the controls enters an `np-credits` zone
  that scrolls the panel; Up from its first row returns to the ⓘ button.
- The panel stays open across track changes and refreshes its content.

Acceptance (e2e, with the mock extended to return OpenSubsonic fields):
- 1 `getSong` request per song per session.
- Sections with no data are absent.
- The entry index still lands on Play.
- A panel screenshot at 150% matches mockup 10's layout.

On the live server: verify which fields Navidrome 0.63.2 actually returns and
record them. If the live server is unreachable, mark it `[!]`.

### R8 — Twice the background blur (S6)

Implements §6.5.

Acceptance:
- `getComputedStyle(.np-bg-image).filter` reports `blur(120px) saturate(1.3)`
  and `transform` is `none` (D47).
- Screenshots with square, portrait and landscape covers show no dark edge
  band: the mean luminance of the outer 50 px border strip is within 10% of
  the strip 200 px in.
- The raster/paint delta across 3 track changes is measured and reported
  (informational).
- Added to the TV checklist.

### R9 — Down to the bottom bar, then OK for Now Playing (S3)

- A new `App.registerNowPlayingBarZone(upNeighbour)` replaces every copy of the
  bar registration (D56).
- Bar targets, in order: `.np-bar-open` (art + title + artist), Previous,
  Play/Pause, Next.
- Entering from above lands on `.np-bar-open`, styled as a solid-fill pill
  (mockup 11).
- Enter on it → Now Playing ("rise", R2).
- Up from the bar returns to the zone *and item* focus came from.
- While the bar is hidden (no track, or on Now Playing), the zone reports a
  count of 0 via a new zone option `isAvailable`, so transitions skip it.
- The Library sub-nav's Down on the last tab goes to the bar (it no longer
  wraps).

Acceptance (e2e):
- With a track loaded, from **every zone on every screen** — every Library
  tab and sub-nav, genre detail, playlist detail, album, artist, search
  keyboard and results, queue, settings sections — repeated Down ends on
  `.np-bar-open` and Enter shows Now Playing.
- With no track, Down never makes the bar zone active.
- Up returns to the originating item index.

### R10 — Gradient backdrop option (S7)

- Settings → Appearance → "Background ◄ Solid / Gradient ►", stored in
  `sonance-backdrop`, default Solid.
- Implements §6.6 via a class on `<html>`. The gradient follows accent changes
  live.

Acceptance:
- A screenshot of each menu screen with it on is read back.
- 0 animations and 0 extra composited layers at rest compared with Solid
  (`LayerTree` count, ±1).
- Not visible on Now Playing or Login.
- The setting persists.

### R11 — Launch splash (S7)

- The splash is static markup plus a `<style>` in `index.html`, outside the
  `BEGIN/END:JS_SCRIPTS` markers so that `build.sh` keeps it. It is therefore
  visible before the bundles parse.
- Implements §6.7. The exit starts when **both** the hold has elapsed **and**
  the first screen (Login, or Home after a valid session) has rendered, with a
  6 s cap. The node is removed on `animationend`, with a timeout fail-safe.
- Key presses are swallowed while the splash is up.
- The existing flow is unchanged otherwise: Login on first run, Home on later
  runs, and the existing login → app zoom.

Acceptance (e2e on the bundled `index.html` with `tests/mock-boot.js`
injected):
- The splash exists in the first screenshot.
- Its keyframe transforms and opacities match §6.7 at sampled times (Web
  Animations API).
- It is removed by ≤ first-screen-ready + 600 ms.
- A key pressed during the splash has no effect.
- With no session → Login. With a session → Home.
- 0 page errors.

### A1 — Complete Songs list (S5)

- Library → Songs pages through `search3` with an empty query and
  `songCount`/`songOffset`. v3.9 proved this pages stably on the live server.
- It is virtualised (R1.7).
- Rows: thumbnail, title, artist, album, duration (mockup 16).
- Header: "Songs" plus a count. The count comes from `getScanStatus` `count`
  if the live server provides it; otherwise it is omitted, and that is
  recorded.
- A "Shuffle all" chip calls `getRandomSongs(200)` → queue.
- **Order and A–Z jump:** determine the server's order on the live server.
  - If it is alphabetical by title, add an A–Z rail. It jumps by
    binary-searching offsets by first letter, cached.
  - If it is not, ship server order without the rail and record why.
- Sorting by artist or album only if the server can deliver it without
  downloading the whole library.
- The genre detail view pages through `getSongsByGenre` `offset` in the same
  way.

Acceptance:
- On the mock rig (extended to emulate `search3` paging with `mockSongs=14000`):
  - the list reports 14,000 items;
  - a d-pad walk across ≥ 3 page boundaries shows 0 duplicates and 0 gaps;
  - focusing index 13,990 (via the A–Z rail, or `FocusManager.setActiveZone`
    if there is no rail) and walking Down to the end shows the correct last
    10 songs.
- On live, the last offset returns the tail with 0 duplicates across pages.
  If live is unreachable, mark it `[!]`.

### A2 — Album sort / filter and counts (S5)

- An Albums header shows "Albums" plus a count, a Sort chip and a Filter chip
  (mockup 20). These form a header zone above the grid.
- Sort cycles Name / Artist / Recently added / Year / Most played (the
  `getAlbumList2` types). All are paginated through `AlbumListCursor`, with a
  comparator per type: name/artist normalised (D24), year numeric, timestamps
  and counts raw.
- Filter: "All genres", or a genre chosen from a picker overlay
  (`getGenres`), using `type=byGenre`.
- Count: only where it is derivable cheaply and exactly. For example, the
  genre `albumCount` when a filter is active. Otherwise omitted, and that is
  recorded.
- Sort and filter persist per session.

Acceptance:
- On the mock rig with 3 libraries, each sort reaches the full set with 0
  duplicates and fixture order (v3.9 S4 method).
- The focus path is header ↔ grid ↔ sub-nav ↔ bar.

### A3 — Playlist cover mosaics (S7)

- Playlist cards (the grid and the Home row) show `playlist.coverArt` through
  `getCoverArtUrl`. Navidrome generates a collage; verify on live. If there is
  no `coverArt`, fall back to today's gradient card.
- Grid of art tiles with title and "N songs · duration" (mockup 15).

Acceptance (e2e on a mock with `coverArt`): tiles render, focus uses card
rules (R6), and there are 0 extra `getPlaylist` calls.

### A4 — More Home rows (S7)

- New rows: "Your favourites" (`getAlbumList2 type=starred`), "Most played"
  (`frequent`) and "Rediscover" (`random`). Each row appears only if non-empty.
- They load after first paint (deferred), so Home's synchronous render does
  not grow (R1.4 table).
- The focus chain runs through all rows to the bar (R9).

Acceptance: e2e for the focus chain, and no regression in Home's first-frame
latency.

### A5 — Hold-OK options sheet (S7)

**Hold detection.** On zones with `onLongPress` (track rows in album,
playlist, songs, genre songs, search songs, queue and Up Next), Enter
activation becomes press-and-release aware:

| Event | Result |
|---|---|
| keydown | Start a 500 ms timer |
| keyup before 500 ms | Normal activation |
| 500 ms reached and ≥ 2 auto-repeat keydowns seen | Open the sheet; swallow the keyup |
| 500 ms reached with no repeats, then keyup before 1,200 ms | Open the sheet on release |
| No keyup and no repeats by 1,200 ms (a platform that does not deliver keyup) | Normal activation |

Zones without `onLongPress` keep immediate keydown activation.

**Sheet.**
- A right-side panel (mockup 17) with its own isolated zone.
- Actions:
  - Play next; Add to queue; Favourite / Unfavourite; Go to album; Go to
    artist; Show credits (a modal that reuses R7's renderer).
  - Start radio, only if `getSimilarSongs2` returns ≥ 5 songs; hidden
    otherwise.
  - On queue rows, also: Play now; Remove from queue.
- Back closes the sheet and returns focus to the originating row.
- Colour buttons keep working.

Acceptance (e2e):
- Short press plays.
- Hold opens the sheet, simulated with keydown/repeat/keyup event sequences
  including the no-keyup case.
- Every action produces its effect on the mock.
- Back restores focus.

The TV checklist must include: confirm Tizen delivers keyup and auto-repeat
for OK, and the user's remote model.

### A6 — Up Next strip (S6)

- On Now Playing, Down from the controls (with no side panel open) enters an
  "Up next" zone: the next 5 tracks in play order, each with thumbnail, title
  and artist.
- Enter → `Player.jumpToQueueIndex(i)`.
- Up returns to the controls at Play (R3).
- The strip updates on `trackchange` and on queue changes.
- It is hidden while lyrics or credits are open.

Acceptance (e2e): the order respects shuffle, Enter jumps correctly, and
focus paths work.

### A7 — Sleep timer (S6)

- A chip in the Up Next header (mockup 19) cycles Off → 15 → 30 → 45 → 60 min
  → End of track → Off.
- On expiry: `Player.pause()` plus a toast.
- The label shows remaining minutes and updates on minute boundaries via a
  `setTimeout` chain.
- Not persisted.

Acceptance: e2e with fake timers (`page.clock`).

### A8 — Resume queue (S6)

- Settings → Playback → "Resume last queue", stored in `sonance-resume-queue`,
  default On.
- **Save** `savePlayQueue` (or `savePlayQueueByIndex` if the server
  advertises `indexBasedQueue`):
  - triggers: `trackchange`, `pause`, at most every 30 s of playback (throttled
    in the `progress` handler), and `visibilitychange` → hidden;
  - cap: the 1,000 ids nearest the current index;
  - POST, form-encoded, if the URL would exceed 6,000 characters (verify on
    live).
- **Restore** on app-shell start: `getPlayQueue`, then a new
  `Player.restoreQueue(tracks, index, positionMs)`:
  - loads state and the NP bar **paused**;
  - no AVPlay open until Play;
  - first Play seeks to the saved position;
  - no auto-open of Now Playing.

Acceptance:
- Mock: after a fresh page, the NP bar shows the saved track paused; Play
  starts within ±2 s of the saved position; the queue order is identical.
- Live, if reachable: save, then restore in a fresh context.
- The AVPlay path is stub-verified and goes on the TV checklist.

### R12 — Oblong home-row icon package (S1)

Implements D59.

**Artwork.** Create `icon-oblong-1920.png` at the project root: **1920×1080,
opaque (no alpha), full-bleed**, with no rounded corners and no transparent
padding.
- Content: the Sonance S-wave mark on its pink→violet gradient tile, plus the
  "Sonance" wordmark, laid out horizontally and centred, with a quiet
  background. Use the existing brand gradient (`#e44d8a` → `#8a4dff`, from
  `docs/UI-MOCKUP-REFERENCE.md`) or a near-black ground.
- Keep artwork inside the central ~80% of the frame: the launcher may crop or
  letterbox.
- Render it from an HTML page with Playwright at 1920×1080. The S-wave paths
  are in `js/app.js` `_createLogoSvg`. Then re-encode losslessly with Node
  `zlib` (v3.9 S5 T13 method) to keep it small. No new dependencies.
- **Do not copy Litefin's image or any of its assets.** Only the format is
  borrowed.

**Packaging.** `build.sh` produces **two** packages from one build:
- `Sonance3.wgt` — square `icon.png` (256×256), unchanged;
- `Sonance3-Oblong.wgt` — identical, except its `icon.png` *inside the package*
  is `icon-oblong-1920.png`.

Rules:
- `config.xml` stays the same in both: a bare `<icon src="icon.png"/>`, no
  width/height attributes, the same `tizen:application` id.
- Do not modify `icon.png`, `icon-oblong.png` or `config.xml` in the working
  tree.
- Stage the oblong variant in a temp directory, never by swapping files in
  place.
- Both packages pass the same gates.
- The `build.sh` deploy note tells the user to install **one** of the two.
- The D46 comment block in `build.sh` is replaced by one citing D59 and the
  Litefin evidence (ticket §2).

**Acceptance:**
- Unzip both packages and confirm: `config.xml` is byte-identical between
  them; `icon.png` is 256×256 in `Sonance3.wgt` and 1920×1080 in
  `Sonance3-Oblong.wgt`; the colour type has no alpha (2 or 3) or is RGBA with
  every alpha byte 255; every other member is byte-identical.
- The new image is read back as a screenshot and described.
- The working-tree `icon.png`, `icon-oblong.png` and `config.xml` are
  unchanged (sha256 before/after).
- Added to the TV checklist, as the first item the user can test after
  Session 1: install `Sonance3-Oblong.wgt` via Jellyfin2Samsung, check the
  home-row tile is wide, then reinstall `Sonance3.wgt` if preferred.
- If the tile is still square on the TV, that is recorded as a `[!]`. The
  fallback to try is the same package plus `<tizen:profile name="tv-samsung"/>`
  in its `config.xml` only (§10). It is **not** built speculatively.

## 8. Verification approach (all sessions)

- **e2e suite.** `e2e/` runs under `@playwright/test` (project-local 1.63.0):
  - Chromium only; 1920×1080; DPR 1.
  - `webServer` = `node tests/dev-server.js 8091`.
  - Keyboard-only, through helpers in `e2e/helpers/`.

  The planning session's probes become regression tests in Session 1. Every
  later requirement adds specs. The suite must pass at the end of every
  session.
- **Visual baselines.** Captured in Session 1 at 100% to
  `screenshots/v3-10/baseline/`. Pixel diffs use Chromium canvas
  `getImageData` (v3.9 method).
- **Performance.** CPU 6× via CDP for indicators. Before/after numbers go into
  `docs/perf-baseline.md` under a "v3.10" heading.
- **TV-only items.** Every TV-only correctness question goes into
  `docs/v3-10-report.md` §TV checklist, with what a failure would mean (D43
  style). This file is created in Session 1.

## 9. Mockups (`tickets/`)

| File | Shows |
|---|---|
| `mockup-3.10-01-current-albums-100.jpg` | Today's Albums grid (8 columns, 12 px titles) |
| `mockup-3.10-02-proposed-albums-150.jpg` | 150% + v4 pink card focus (6 columns) |
| `mockup-3.10-03-proposed-albums-175.jpg` | 175% |
| `mockup-3.10-03b-proposed-albums-200.jpg` | 200% |
| `mockup-3.10-04-current-playlist-detail.jpg` | Today's 55% pink row (number and duration illegible) |
| `mockup-3.10-05-proposed-playlist-detail-150.jpg` | Solid pink row + thumbnails (R5, R6) |
| `mockup-3.10-06-current-album-detail.jpg` | Today's album rows (no artist) |
| `mockup-3.10-07-proposed-album-detail-150.jpg` | Artist under each title (R5) |
| `mockup-3.10-08-current-nowplaying.jpg` | Today: Up → Down lands on shuffle |
| `mockup-3.10-09-proposed-nowplaying-blur2x.jpg` | Play focused + 2× blur (R3, R8) |
| `mockup-3.10-10-proposed-nowplaying-credits.jpg` | Credits panel (R7); example values |
| `mockup-3.10-11-proposed-npbar-focus.jpg` | Bar "open Now Playing" target (R9) |
| `mockup-3.10-12b-current-home.jpg` | Home, solid background |
| `mockup-3.10-12-proposed-home-gradient-150.jpg` | Gradient backdrop (R10) |
| `mockup-3.10-13-proposed-settings-150.jpg` | Interface size + Background rows |
| `mockup-3.10-14-proposed-splash-frames.jpg` | Splash timeline (R11) |
| `mockup-3.10-15-suggest-playlists-mosaic.jpg` | A3 |
| `mockup-3.10-16-suggest-songs-list.jpg` | A1 |
| `mockup-3.10-17-suggest-track-options.jpg` | A5 |
| `mockup-3.10-18-suggest-home-rows.jpg` | A4 |
| `mockup-3.10-19-suggest-np-upnext.jpg` | A6 + A7 |
| `mockup-3.10-20-suggest-albums-sort.jpg` | A2 |

## 10. Open questions — to verify, not to guess

1. **Live server access.** `TEST-ACCOUNT.local.md` was rejected with error 40
   on 2026-10-01. Until the user updates it, every "on live" check is `[!]`.
2. **Navidrome 0.63.2 fields:**
   - `getSong` contributors and `displayComposer`, `getAlbum` `recordLabels`
     (R7);
   - playlist `coverArt` collage (A3);
   - `search3` empty-query order (A1);
   - `getScanStatus.count` (A1);
   - `getSimilarSongs2` results, which need an external agent (A5);
   - `savePlayQueue` POST support and URL limits (A8).
3. **Tizen 5.0 behaviour (TV checklist):**
   - keyup and auto-repeat for OK (A5);
   - rem rendering parity on Chromium 63 (R4);
   - `blur(120px)` render and cost (R8);
   - compositor behaviour of the smooth-scroll flag (R1.8);
   - splash first-paint timing (R11);
   - overlay numbers (R1.1).
4. **Remote.** Does the user's Q90R remote have physical colour buttons? (A5
   rationale.)
5. **Oblong tile (R12).** Does the 1920×1080 icon alone produce a wide
   home-row tile on the Q90R, as Litefin's does? If not, the next thing to try
   is adding `<tizen:profile name="tv-samsung"/>` to the oblong package's
   `config.xml`; Litefin's carries it, Sonance's does not. Only the TV can
   answer this.

## 11. Amendments

Recorded by the session that made each one. Nothing above is edited silently.
Where an amendment changes an acceptance criterion, the original text stands
and this section says how it is read.

### S1 (2026-10-01)

1. **Live server (§2, §10 q1).** The test credentials work again: `ping.view`
   returned ok, and the bundled build booted to Home through the LAN proxy.
   The server is now **Navidrome 0.64.1** (OpenSubsonic), not 0.63.2.
   "On live" checks are available. Re-check at the start of every session.
2. **R12, working-tree icons (D60).**
   - At S1 start, `icon.png` and `icon-oblong.png` were not in the project
     root. A PNG tidy-up on 2026-10-01 at 11:50 had moved them, with 191
     screenshots, into `screenshots/older_than_v3-9/`. Both copies are
     byte-identical to the icons packaged in the last builds.
   - `icon.png` was copied back to the root, so `build.sh` packages it. The
     original stays where the tidy-up put it.
   - `icon-oblong.png` was left in `screenshots/older_than_v3-9/` (sha256
     `6b475768…c6bd5`); no package uses it.
   - R12's "unchanged (sha256 before/after)" criterion is read against
     `config.xml`, the restored `icon.png` (which equals the moved original)
     and the moved `icon-oblong.png`.
3. **T6 acceptance grep (D62).** As written,
   `grep -rn "v3-9\|V3.9" index.html build.sh tests/mock-index.html js/screens/settings.js`
   also matches three pre-existing comments that cite v3.9 decisions:
   `settings.js` "V3.9 T8" and "V3.9 NEW-1", and `build.sh` "V3.9 T11". They
   are history, not version strings, and CLAUDE.md protects existing
   comments. The criterion is read with comment lines excluded:
   `… | grep -vE "^[^:]+:[0-9]+: *(//|#)"` must return no hits.
4. **Visual baseline (§8).** The S1 baseline was first captured before T5/T6,
   then re-captured at the end of S1. Only the two Settings states differed,
   because of the Advanced section and the About row. `baseline/` now holds
   the end-of-S1 capture, so R4's 100 % identity gate compares S2 against the
   app it starts from. Method: `docs/perf-baseline.md` "v3.10 visual baseline".
5. **R1.4 finding (for S4, not a change).** At CPU 6×, every screen's
   synchronous `render` + `activate` is ≤ 10.2 ms (Now Playing is highest),
   because the screens build their content in data callbacks after `activate`.
   The "> 16 ms" trigger does not fire for any screen as measured. S4 should
   judge deferral on the main-thread task time per navigation, which S1 also
   measured: Library 158 ms, the next highest 64.5 ms. It should record the
   reason either way, as R1.4 allows.
6. **R12 artwork (D61).** The oblong tile uses a flat `#0a0a0c` ground. A
   faint brand glow behind the mark cost 2.8× the bytes (256,848 B against
   92,455 B) for no visible gain on a home-row tile. §7 R12 allows a
   near-black ground.

### S2 (2026-10-01)

1. **R4 100 % identity, how it is read (D69).** The px → rem conversion and
   all the scale plumbing were gated first, before any deliberate visual
   change: 19 of 19 states, 0 differing pixels against the S1 baseline. Then
   D69 fixed a pre-existing top-nav pill error (the cached item rects went
   stale when the bold selected item changed; the pill was up to 2 px narrow
   at 100 % and 4 px at 200 %). R4 asks for the pill to match its item to
   ±1 px at 125–200 %, which no fix can do without also correcting 100 %. The
   100 % gate after D69 differs in 16 states, every pixel inside one box at
   y 28–62 over the selected nav item (the pill), max channel delta ≤ 29.
   R4's identity criterion is therefore read as: the conversion is
   pixel-identical, and the only 100 % change is D69's pill box.
2. **R4 Settings states.** The S1 baseline predates the Interface size row.
   The gate used `visual-baseline.js --hide '#settings-ui-scale-row'`, which
   removes the row before the screen's focus zones register, so layout and
   focus history equal the baseline's. (A first attempt with
   `display: none` kept the row in the focus zone; the extra focus stop
   evicted the selected swatch from FocusManager's 5-entry `will-change` list
   and changed how its ring rasterised: 575 px, max delta 53.)
3. **R4 "no horizontal overflow" (D68).** The Home rows are horizontal
   carousels by design (`.home-row`, `overflow-x: auto`, V3-4). They overflow
   at 150 % (playlists row) and at 175–200 % (all three). For them the
   criterion is read as "the focused card is always fully inside the row
   and the screen"; S2 added the scroll-follow that makes this true. Text
   truncated by design (`text-overflow: ellipsis`) is not overflow.
4. **R4 focus-transform clipping (for S3).** The overflow checks measure the
   layout with the focused element's own focus transform neutralised. What
   that transform overhangs is a focus-style matter; it is inventoried in
   `docs/UI-MOCKUP-REFERENCE.md` "Known discrepancies" for S3 (R6). Four of
   the five cases are identical in proportion at 100 %; the Queue row's
   5.8 px at 150 % is the only one the interface size introduced.
5. **R4 hairlines (D63).** §6.1's "1px borders and dividers stay px" is
   applied to `1px` widths in `border*` declarations only (22). S1's note that
   all 27 `1px` tokens are hairlines was wrong: 4 are `letter-spacing` and 1
   is the equaliser bar's `border-radius`, and these convert.
6. **Art request sizes (D70, not done).** §6.1 covers CSS and JS lengths, not
   the `getCoverArt` `size` buckets (v3.9 T1). They stay as they are, so at
   150 % art is upscaled (a 180 px image on a 212 px grid card). Recorded for
   S5 with the sites to change together.

### S3 (2026-10-01)

1. **R9, the registrations (§2 table, prompt "14").** There were 13: the
   shell's and 12 in the screens (album 1, home 1, artist 2, library 4,
   playlists 2, search 1, settings 1). All 13 now call
   `App.registerNowPlayingBarZone(upNeighbour)`. Queue never registered the
   bar and still does not; Up from the bar there is served by the origin
   return (item 2).
2. **R9 "Up returns to the zone and item", R3/R9 entry (D77, D79).**
   - Implemented as zone options on `FocusManager`: `entryIndex` and
     `isAvailable` as the ticket names them, plus a third, `returnToOrigin`.
     A zone with `returnToOrigin` records the zone and index a Down
     transition came from; Up goes back there while that zone still has
     items, else to its `up` neighbour.
   - R3's "or from `App._getPageFirstZone`'s drop" is
     `FocusManager.enterZone(name, fallback, force)`, used at the four App
     drop sites. Plain `setActiveZone(name, undefined)` keeps meaning "the
     remembered index", because the restore paths (the exit dialog's Cancel)
     rely on it.
   - The re-registration branch copies all three options.
3. **R9 "Enter on it → Now Playing ('rise', R2)".** Rise is R2, which is S4.
   S3 opens Now Playing through the existing navigation, as the bar's click
   handler always did.
4. **R9 / mockup 11 hint (D80).** The focused `.np-bar-open` pill shows
   "OK → NOW PLAYING", as mockup 11 does. It is always laid out and
   transparent until focused, so focusing the pill changes no layout.
5. **R6 rows.** `.artist-album-row` was `scale(1.03)`; §6.3 says rows keep
   1.02 "unchanged", so it joins them at 1.02.
6. **R6 cards (D73).** The ring goes on the art (`.album-art`,
   `.album-art-fill`, `.artist-avatar`, `.artist-similar-avatar`), or on the
   tile itself for tiles that are their own art (playlist, genre,
   quick-access), whose in-tile labels stay as they are. `.queue-np-card`
   gets the ring but keeps `scale(1.04)`: at 1.12 its 28rem art would leave
   its 32rem column. `.artist-similar-card` was a 55 % accent fill; it now
   follows the card rules.
7. **R6 swatches (D74).** The accent swatch keeps `scale(1.15)` and a white
   border ring: its fill is the colour it offers. It is the one focus rule
   without a focus token, and CLAUDE.md names it as the exception.
8. **R6 "No `outline` focus rule remains"** is read as "no outline other than
   `outline: none`". The UA-ring resets (`.focusable.focused`, the per-rule
   `outline: none !important`) are not focus rings and stay.
9. **R6 "colour and background snap" (D75).** Beyond the two
   `transition: background` rules the A5 grep finds, colour transitions on
   focus-related rules went too: `.library-subnav-item`, `.album-star-btn`,
   the colour half of `.track-row-star`, `.album-detail-artist.focusable`.
10. **R6 focus clip (D76, D84).** A wider sweep than S2's (every zone's first
    and last item on 12 screen states, 92 focus states per size) was clipped
    in 14 / 16 / 22 states at 100 / 150 / 200 % before S3. After S3 it is 0
    at 100, 125 and 150 %. The residue, 2 entries at 175 % and 9 at 200 %
    (six elements; the Queue card is listed once per index), is one kind of
    problem: fixed-size panels taller than the page at those
    sizes (the album and artist left columns, the search keyboard's last
    row, the Queue's Now Playing card). It is not a focus-transform issue;
    it needs a layout decision (scroll the panel or shrink the art) and is
    handed to S5 with the art-size work (D70). Every one of those elements
    was already cut before S3, except the artist column's Shuffle at 200 %,
    which D82 (item 12) changed from 1.5 px to 20.5 px.
11. **R5 audit (D81).** Queue, Library Songs, Genre songs and Search song
    results all showed the artist already. The missing-artist fallback is
    now "Unknown artist" in the three lists that had "Unknown" (Queue,
    playlist detail) or nothing (a Search song with no artist lost the
    artist from its meta line). Songs and Genre songs keep "Unknown Artist".
12. **Album and artist detail scroll (D82, found in S3).** The tracklist and
    the discography never scrolled: `.album-detail` / `.artist-detail` are
    `#page-current`'s own children, so their `flex: 1` did nothing and they
    took their content height. The `album-active` class that was meant to
    help is added to an `#content-area` that no longer exists, and its
    `.page-content` rule matches nothing. At 100 % this showed only on
    albums with more than about 19 tracks; R5's two-line rows made a
    10-track album overflow at 150 %. Both roots now have `height: 100%`.
    The dead class and rule are left as they are (reported, not removed).
13. **Test criteria changed with R9/D76 (no requirement change).**
    - `grid-recycle` `[today]` counted a step as a rebuild at ≥ 350 created
      elements, S1's 100 % band size. At 150 % after D76 a rebuild creates
      252–337 (36–48 cards, nothing kept), so a rebuild is now "nothing kept
      and more created than R1.6's bound of two rows of cards".
    - `ui-scale` D68 ended its Home-row loop when focus entered the hidden
      NP bar. With no track the bar is no longer a target (R9), so a
      repeated zone ends the loop too.
14. **The bar appearing under the focus (D86, found on live in S3).** With
    Auto Now Playing off, Enter on a track near the bottom of a scrolling
    list plays it in place; the bar appears and the page loses its height, so
    the focused row ended under the bar. The content focus is now re-applied
    when the bar first appears, which re-runs the screen's scroll-follow.
    (Before D82 the album list did not scroll at all.)

### S4 (2026-10-01)

1. **R1.2 (D52, D87).** The 300 ms lock and the pending-target catch-up are
   gone. The running transition is one tracked record; anything that starts
   a transition, and every screen change, finishes it first (ghost removed,
   the in-screen ghost's lazy images released through the D17 teardown,
   inline `transform`, `opacity`, `transition`, `transform-origin` and
   `will-change` cleared). The login zoom keeps its own once-per-sign-in
   guard; that guard is not an input lock.
2. **R1.2, stale responses (D88, found in S4).** With no lock, Back can
   arrive before a sub-screen's data. Album, Home, Playlists (grid and
   detail) and Settings now drop a response for an activation (or view) that
   has ended. Negative control (the S4 app with the S4-start `album.js`,
   `getAlbum` delayed 400 ms, Back at 120 ms): the late album registered a
   `content` zone on Library and took focus (`content[0]`); with the guard,
   focus stays on `library-grid[1]`. Library's tab loaders already checked
   their container and tab.
3. **R1.3 (D51, D89, D90).** The dwell is 180 ms (`NAV_DWELL_MS`,
   `SUBNAV_DWELL_MS`), a `setTimeout` restarted per press. Top nav: the pill,
   its label and `_navIndex` move on the press; the slide direction is the
   net direction of the presses; Down, Enter and Back flush a pending dwell
   first. A drop that follows a navigation waits for the new screen's first
   content zone, preferring Library's grid over its sub-nav for up to 2 s
   (as a drop onto a loaded Library always did). Sub-nav: the fade-out
   starts on the first press, the tab is built 180 ms after the last, Right
   and Enter build a pending tab at once and enter its grid when it
   registers. "Exactly 1 tab build" is read as one `_loadTabContent`.
4. **R1.4 (D96): no deferral.** No screen's synchronous `render` +
   `activate` median is above 16 ms at CPU 6× (Now Playing is highest at
   14.6 → 14.8 ms, single runs to 16.0 before and 16.8 after on a loaded
   host; S4 does not change it). Judged on task time (§11 S1.5): Library
   161.5 → 135.5 ms. Library's first frame did get heavier (render → 2nd rAF
   16.3 → 40.2 ms), because the dwell lets the nav's data preload finish and
   the grid is built from cache inside that frame; the grid is painted 17 ms
   sooner (57.2 → 40.2 ms). Deferring it would bring back an empty first
   frame. Numbers: `docs/perf-baseline.md` "v3.10 S4".
5. **R1.5 (D97).** Wired to the Library Albums grid, as the session prompt
   scoped it. Home's album rows, the artist discography and Search's album
   results do not prefetch; recorded, not built.
6. **R2 (D91–D93).** One easing, `cubic-bezier(.2,.8,.2,1)`, for every page
   transition (§6.4 gives it for the slide only). The zoom origin is the
   centre of the focused element's drawn box (`getBoundingClientRect`),
   stored on the history entry (page zoom) or with the container
   (`zoomContent`). §6.4's rise row says "opacity 0 → 0"; it is read as
   0 → 1 (the design doc's text). Rise is used from the bar, by Auto Now
   Playing and from the Queue's Now Playing card (it snapped before); sink
   only on Back from a Now Playing that rose; Back from one reached by the
   nav reverses the slide, as before. The page under a rise stays still and
   is removed at the end.
7. **R2, the ghost's layout (D98, found in S4).** Every ghost re-laid out at
   the first frame: the demoted layer lost `#page-current`'s padding and
   centring (its content jumped −72, −42 px at 150 %; −160, −28 px at
   100 %), an in-screen ghost lost the page padding (−24, −42 px on playlist
   detail), and around Now Playing the ghost followed `#page-container`'s new
   top (±8rem). A zoom origin cannot hold if the content under it moves. The
   ghost now keeps its classes (CSS twins of the `#page-current` rules), an
   in-screen ghost copies its container's classes and scroll offset, and a
   page ghost is pinned to its old box when Now Playing comes or goes. 0 px
   at 100 % and 150 % for all six kinds (e2e).
8. **CLAUDE.md "Transitions" (not amended).** It still says the zoom starts
   at `scale(0.92)` and names no rise or sink. §5.5 lists no Transitions
   amendment, so it was left as it is and reported for the user to settle.
   The Navigation amendment (D51) was made.
9. **S3's D85 → D94.** Back with the bar focused returns to the top nav,
   like Back from content.
10. **Back from a Now Playing opened by the bar (D95).** It returns to the
    bar's D79 origin (the item focus went down to the bar from). To make that
    work on Home, focus restores now run a microtask after the zone
    registers, after the screen's own initial focus. That also fixes a
    pre-existing fault: Back from Now Playing to an album landed on track 1,
    not on the row that was played (V3-6-fix NAV-1's intent).

### S5 (2026-10-02)

1. **Live server.** The test account now sees **one library** (it saw seven
   in S1–S4), 30,458 songs and 2,996 albums (Navidrome 0.64.1). The
   multi-library acceptance criteria are therefore met on the mock rig only.
2. **R1.6 (D99, D100).** The band is updated incrementally: the nodes that
   left are removed (their lazy images released, D17 narrowed to them) and
   only those that entered are created; a geometry change or a new `items`
   array still rebuilds. Two findings made the criterion hold:
   - the Albums page loader fired two rows ahead of the *focus*, but the band
     (viewport plus two buffer rows) reaches the end of the loaded albums
     first, so it sat short and then grew by two or three rows at once
     (113 elements on one step). The band's last index now triggers the page
     too (D99);
   - the Search `VirtualGrid` branch (D40) had a selector zone over the
     cached nodes, so focus could not reach rows outside the first band and
     the colour buttons read the wrong song. It is a virtual zone over one
     slot per result now, with a measured row pitch (D100).
   `FocusManager.registerZone`'s re-registration copies `virtual` too.
3. **R1.7 (D101).** "A full traversal" at 14,000 rows is run in-page: a
   keydown dispatched to FocusManager's own `document` listener per step,
   checked synchronously every step and for being in view (after the
   scroll) every 100 steps, Down to the end and back (28,000 steps per
   list). Real key presses need at least one frame each (about 8 minutes a
   list), so the real-key walks cross page boundaries instead. The timing
   criteria are measured by `perf-baseline.js --only lists`.
4. **A1 (D102–D104).**
   - Order: the server's empty-query order is **creation order** (995 of
     995 sampled pairs ascending by `created`; titles 516 up, 479 down), so
     there is **no A–Z rail and no Sort chip** (the server cannot sort songs
     another way without the whole library).
   - Count: `getScanStatus.count` is server-wide (82,524 against the 30,458
     songs this account sees), so it is not used. "The count comes from
     `getScanStatus`… otherwise omitted" is read as "shown only when exact":
     the list needs its exact length anyway (it is shown whole, and index
     13,990 must be reachable), and a binary search over offsets with
     one-item probes gives it (24 requests, 221 ms on the LAN; D102).
   - Enter on a song plays it and queues it with the next 199 in list order
     (it queued the 50 random songs from the chosen one; D103). A genre's song
     still opens its album.
   - The screen holds at most 40 pages (4,000 songs); the page farthest from
     the band is dropped (D104).
   - Live: 61 pages of 500, 30,458 songs, 0 duplicates; the app's last page
     (offset 30,400) returns the 58-song tail the walk ended with.
5. **A2 (D105–D107).**
   - "Every sort pages through `AlbumListCursor`" is read as: every sort
     pages the way Name always has, a cursor with that type's comparator for
     two or more libraries, plain pages for one library or all (D23).
   - The comparators: name and artist normalised (D24); `frequent` by play
     count (it was keyed on the `played` timestamp, `recent`'s key); `byYear`
     by year; ties broken by name (reversed with the year for byYear, as the
     server does), so the merge is one total order.
   - Year is `byYear` from 3000 to 0: newest first, year-less albums last;
     live 2,996 of 2,996 (to year 1 left out 47; D105).
   - A genre filter is `byGenre`, which the server orders by name; the Sort
     chip then reads "Sort: Name", dimmed, and does nothing (D106).
   - The count is shown because it is exact: the length of the list being
     shown, by the same offset search, per library (D107). With a filter it
     reads "377 albums · Rock".
   - Live: Name, Artist, Recently added and Year each reach 2,996 distinct
     albums; Most played returns none (the account has no plays).
6. **D70 (done).** `SonanceUtils.artSize(bucket)` scales each v3.9 request
   bucket with the interface size at every display and preload site.
7. **D84 → D108.** The album and artist left columns and the search
   keyboard's panel scroll with the focus at 175–200 %; the Queue's Now
   Playing card (one focus target) caps its art at `calc(100vh - 40rem)`.
   The focus-clip sweep is 0 at 100–200 %.
8. **R1.8 (D109).** A jump to an index outside the band
   (`ensureIndexVisible`) is instant even with smooth scrolling on; only the
   in-band focus-follow animates. Animated, the band followed the scroll's
   position back past the focused item. The focus-integrity specs pass with
   the flag on (`SONANCE_SMOOTH=1`).
9. **v3.9 NEW-3 (not fixed).** Back to a deep Albums card still lands on the
   first page's last card: the restore clamps to what is loaded. R1.6 does
   not make it trivial (§4); it needs App to tell Library the pending
   restore index so Library can page up to it.

### S6 (2026-10-02)

1. **R8 (D128).** `blur(120px) saturate(1.3)` on the same `.np-bg-image`,
   box, opacity and overlay, no transform. Edge luminance with square,
   landscape and portrait covers (one dev server per shape,
   `SONANCE_COVER_ASPECT`): the outer 50 px strip is within 0.3 % of the
   strip 200 px in at 100 % and 150 % (bound 10 %), before and after. Raster
   time per track change about doubles (~128 → ~247 ms of raster-worker time,
   headless software raster); main-thread paint is unchanged.
2. **R7, the panel (D115, D116).** The credits panel shares the lyrics
   geometry through a second class, `credits-active`, on `.np-layout` (the
   column, art and type rules take both). Unlike the lyrics panel it is
   top-aligned below the nav (padding-top 9rem): centred, a long list put its
   title under the nav. ⓘ is available whenever there is a track (the queue's
   track alone fills Release and File) and dimmed (D55) only with none. The
   content is drawn from the track at once, then from `getSong` and the
   album's `getAlbum` as they answer; both are cached for the session, so
   "1 `getSong` request per song per session" holds even after the 5-minute
   response cache is cleared (e2e).
3. **R7, the sections (D117).** The labels use mockup 10's wording (Written
   by, Produced by, Mixed by, Engineered by, Arranged by, Remixed by,
   DJ-mixed by, Conducted by, Lyrics by); each performer sub-role is its own
   row ("Vocals", "Guest Vocals", "Guitar"…). `displayComposer` stands in
   for "Written by" when no composer contributor came. "Track" is the
   position over the disc's count (from `getAlbum`'s songs), with
   "Disc n of N" on a multi-disc album; "Released" is the year, with
   "originally YYYY" when the original release differs. Roles outside that
   list are left out. MusicBrainz's `[no label]` placeholder is not a label.
4. **R7, "On the live server: verify which fields Navidrome returns".**
   Navidrome **0.64.1** (not 0.63.2) sends, on `getSong` and on every song
   in `search3`/`getAlbum`: `contributors` (role, optional `subRole`,
   artist), `displayComposer`, `artists`, `displayArtist`, `albumArtists`,
   `displayAlbumArtist`, `genres`, `bitRate`, `samplingRate`, `bitDepth`,
   `channelCount`, `bpm` (0 on this library), `comment`, `isrc`, `moods`,
   `replayGain`, `explicitStatus`; `playCount`/`played` only once played
   (never on this account). Roles seen in 500 songs: composer, mixer,
   producer, lyricist, engineer, remixer, djmixer, arranger, conductor, and
   performer with instrument sub-roles. `getAlbum` sends `recordLabels`,
   `releaseDate`, `originalReleaseDate`, `discTitles`, `releaseTypes`.
5. **R7, focus (D118, D119).** The rows are focus stops only when the body
   overflows; Up from the first row lands on ⓘ (np-controls' `entryIndex` is
   a function of the zone focus comes from). "Back closes the panel first"
   is read for the credits panel only: the lyrics panel keeps its behaviour
   (Back leaves Now Playing). Reported for the user, a one-line change.
6. **R7, the row (D120, D121).** The controls row's gap is 2rem (was 2.8rem)
   so eight buttons fit the 48rem column (seven at 2.8rem were already 46rem
   at 100 %, measured). Found in S6: with lyrics open, the focused lyrics
   button's icon was the accent on the accent platter (measured `stroke
   rgb(228,77,138)` on `rgb(228,77,138)`, since S3); `.is-active.focused`
   now takes the ink, for lyrics and credits.
7. **A6, layout (D122).** The strip sits at the bottom of Now Playing. The
   column is moved by transform, never by layout: centred, then
   `translate(0, -4rem)` (the band between the nav's 8rem and the strip's
   16rem), the controls' bottom margin dropped, and the art capped at
   `calc(100vh - 51.2rem)` (28rem up to 125 %, 20.8rem at 150 %; mockup 19
   draws ~23rem). Below 69.2rem of screen height (175 % and 200 %)
   `.upnext-tight` gives up the nav's room: `-8rem`, cap
   `calc(100vh - 43.2rem)`; the nav overlaps the art until it auto-hides, as
   the column already overlapped it there before S6. e2e at all five sizes.
8. **A6, focus and content (D123, D124).** One zone, `np-upnext`: the tiles
   then the sleep chip in one row (Right past the last tile reaches the
   chip; mockup 19 puts it at the header's right end). Up from any of them is
   Play. Play order is the queue after the current index, the shuffled order
   with shuffle on, wrapping with repeat all; the label counts the tracks
   left before the queue ends. The tiles are a fixed pool updated in place,
   so a track change never drops the focus. The strip's content is built two
   rAFs after `activate` (R1.4: built synchronously, Now Playing's
   render + activate was 16.0–19.2 ms).
9. **A7 (D125).** The sleep timer lives at module level and outlives the
   screen; Enter starts the chosen time afresh; labels "Sleep timer", "Sleep
   in N min", "Sleep: end of track". "End of track" is
   `Player.setStopAtTrackEnd`: when the track ends, playback pauses and the
   next track is cued, paused (Play continues the queue), and
   `trackendstop` is emitted for the toast.
10. **A8 (D126, D127).** The index-based calls are used when the server
    advertises `indexBasedQueue` (Navidrome 0.64.1 does, with `formPost`);
    otherwise the classic ones, naming the current entry by id. A URL over
    6,000 characters goes as a form POST: verified on live with 1,000 ids
    (`savePlayQueueByIndex (POST)`, the server then held 1,000 entries,
    index 500, 37,000 ms). Saves: trackchange and pause debounced 1 s, at
    most every 30 s while playing, at once on `visibilitychange` → hidden;
    an identical save (ids, index, position to the second) is skipped, so
    the restore's own echo is not written back. `Player.restoreQueue` cues
    the track: state and the bar paused, nothing loaded; the first Play
    loads it and seeks at `loadedmetadata` (HTML5) or in READY before
    `play()` (AVPlay, stub-verified); a seek while cued moves the start; any
    other load drops the cue. The saved play order doubles as the original
    order (the pre-shuffle order is not saved). After the live check the
    test account's saved queue was cleared again (an allowed write).

### S7 (2026-10-02)

1. **R11, the exit criterion (D135).** "Removed by ≤ first-screen-ready +
   600 ms" cannot hold literally when the first screen is ready before the
   hold ends (on the mock it is in the DOM at ~20 ms; the hold alone is
   900 ms). It is read as: removed by ≤ max(hold elapsed, first screen
   ready) + 600 ms. Measured on the bundled build at 100 / 150 / 200 %: the
   node goes 515–519 ms after the hold with a fast first screen, 517–544 ms
   after a first screen held back 2 s (`?mockPingDelay=2000`), and with no
   screen at all the cap starts the exit at 6,006–6,008 ms; live, 513–517 ms
   after the hold. e2e: `e2e/splash.spec.ts`.
2. **R11, how the exit is triggered (D129).** The inline script watches
   `#app` with a `MutationObserver` for `.login-screen` or `#page-current >
   *` instead of being told by `App`, so the splash does not depend on the
   bundles (if they fail to load, the 6 s cap still clears it). "The hold
   has elapsed" is the `animationend` of `splash-in`, whose second half is
   the hold (900 ms on the animation's own timeline), with a 2 s timer
   standing in if the event never comes; removal is `splash-fade`'s
   `animationend` with an 800 ms fail-safe. The stored accent is applied by
   the same script before the first paint (D137).
3. **R11, motion not in §6.7 (D138).** The exit's easing is R2's
   `cubic-bezier(.2,.8,.2,1)` (D91's one easing); §6.7 gives none. The
   splash's backdrop fades with the logo over the same 500 ms
   (`splash-fade`), so the first screen shows through; §6.7 specifies only
   the logo's motion.
4. **R11, the test harness (D136).** The splash is in `tests/mock-index.html`
   too, so every mock-rig boot would wait ~1.4 s with keys swallowed. The
   e2e helper's seed finishes each splash animation the moment it starts
   (Web Animations `finish()`): the app's own exit logic, removal and key
   listener run, only the animations are compressed. `splash: 'real'`
   leaves them alone (`e2e/splash.spec.ts`). No test hook ships in the app.
5. **R10, the layer (D130).** "A fixed layer behind `#page-container`" is
   built absolute inside the full-viewport `.app-layout`: fixed, Chromium
   composited it as its own 1920×1080 layer and the colour-hint bar with it
   (+2 layers at rest against Solid, CDP LayerTree, 31 → 33); absolute, it
   paints into the root layer (31 = 31). Pixel-identical within 1 pixel of
   1/255.
6. **R10, Now Playing (D132).** "Not shown on Now Playing" is met by an
   opaque `--bg-main` base on `.np-screen` while the gradient is on (scoped
   to Gradient: painted there rather than on `#app`, the blurred backdrop
   blends up to 2/255 differently, so Solid stays exactly as before). It
   also keeps the gradient from flashing through Now Playing's backdrop
   during a rise or sink. Login has no layer (it is drawn before the shell).
7. **A4, the rows' place (D131).** "Your favourites" and "Most played" go
   after Recently Played, "Rediscover" last, after Your Playlists (mockup 18
   puts the favourites near the top; random albums are the least personal).
   Six albums each, like the existing rows. A row that lands above the
   focused card moves the scroll by its height, so the card stays put. Live:
   `starred` and `frequent` are empty for the test account (nothing starred
   or played), so only Rediscover shows there.
8. **A3, the card and its art (D139).** The playlist cards become art +
   label cards (mockup 15): four columns in the grid (was three tiles),
   16.2rem in the Home row; the ring moves to the art, the labels take the
   card rule. With no `coverArt` the art is today's gradient with the
   playlist glyph. The grid's cover is requested at a fixed 400, not a
   D70-scaled bucket: its cell is set by the four columns over the grid's
   capped width (318 / 396 / 368 px at 100 / 150 / 200 %), not by the
   interface size (`e2e/art-sizes.spec.ts` allows it). Live: the test
   account has no playlists, so Navidrome's collage could not be seen
   (`[!]`, needs the user to add a playlist).
9. **A5, hold detection (D133).** Ticket A5's table, plus: any Enter keydown
   while a press is pending counts as a repeat whether or not the platform
   marks it `repeat`; with no keyup by 1,200 ms, at least one repeat opens
   the sheet (the key is evidently held) and none activates; another key
   during a pending press resolves it as if OK were released then; after a
   hold opens the sheet, the held key's repeats (marked `repeat`, or less
   than 150 ms apart) are swallowed until its keyup or a fresh press, so
   they cannot run the sheet's first action. A zone may filter items with
   `hasLongPress(idx)` (D144): Search's artist and album results and the Up
   Next sleep chip keep OK on keydown.
10. **A5, the sheet (D140–D143).** "Show credits (a modal reusing R7's
    renderer)" is a view inside the sheet (Back returns to the actions, on
    "Show credits"), with every credit row a focus stop. Every action but
    Show credits closes the sheet and puts the focus back on the row before
    it runs, so Back from "Go to album" returns to the row and auto Now
    Playing starts from it. The row stays marked under the scrim (mockup
    17). Up Next tiles get the base actions (the ticket's "On queue rows,
    also: Play now; Remove from queue" names queue rows only). "Start radio"
    plays the song, then `getSimilarSongs2` (by the song's artist, count 50,
    cached per artist for the session; live answers 11–50 songs for every
    artist tried), shown once at least 5 arrive. Favourite / Unfavourite is
    a server write the live account must not get (§5.4), so it is verified
    on the mock only (D134).
11. **A5, live fields.** Navidrome 0.64.1's `getSimilarSongs2` songs carry
    no `musicFolderId`, so the library-scope filter (the playlists' rule:
    keep songs with none) keeps them all; with several libraries selected a
    radio may include songs from a deselected one.
12. **Found, reported, not changed.** `FocusManager.registerZone`'s
    re-registration copy does not copy `onColourButton` (a re-registered
    selector zone keeps its first handler; latent since v3). A playlist
    opened from the Playlists grid is an in-screen mode, not a history
    entry, so Back from any screen reached from its rows (an album, Now
    Playing) returns to the grid, with the row's focus index applied to the
    grid's cards (since v3).

### S8 (2026-10-04)

S8 verified and reported; it changed no app code and no requirement.

1. **Live server.** `ping.view` ok at the start and end (Navidrome 0.64.1).
   The test account still has **no playlists** and one library, so A3's
   live check stays `[!]` (§10 q2: the collage needs a playlist the user
   adds).
2. **T3, the bundled-build walk.** `e2e/bundled-walk.spec.ts` (new, one
   test) walks the bundles the `.wgt` ships through the surfaces
   `e2e/smoke.spec.ts` does not reach: the splash on its real timeline,
   Home's extra rows, playlist detail, the options sheet held through CDP
   and its credits view, a genre's songs, and Login; 0 page errors and no
   response ≥ 400 but the Tizen webapis 404. The live walk (bundled build,
   LAN proxy, resume off, no writes) matched it.
3. **Found, reported, not fixed** (`docs/v3-10-report.md` §6, items 13 and
   14):
   - Back from an artist opened by the album's artist link lands on the
     top nav: the album's left-column zone navigates without
     `App.saveCurrentFocus()`. Identical in v3.9-fix1 (that package's files
     served by `page.route`), so it predates v3.10 and no v3.10
     requirement covers it.
   - Live `getSimilarSongs2` took 26.8 s once (S7 saw at most 7.6 s),
     beyond the API's 10 s timeout, so Start radio stayed hidden for that
     opening of the sheet (A5 "hidden otherwise" holds; D143 retries on
     the next opening).
4. **T4, the credential audit (D145).** STEP 1–4 of
   `prompts/pre-release-security-scan.md`, widened to the whole project
   folder, both v3.10 packages and the two stray ones, and every session's
   scratch files; reported in `docs/v3-10-report.md` §7 instead of a new
   `review.md` in the root. What ships and everything v3.10 wrote are
   clean. The April `.playwright-mcp/` folder holds 72 replayable `t`/`s`
   pairs and a login-form snapshot with the password; historical
   `PROGRESS.md` lines 281 and 2366 hold the username (a cache-key prefix)
   and the pair (prose). Reported, not edited (§4: no history redaction;
   deleting files not named needs the user).
5. **The TV checklist** went from 28 items to 12 (`docs/v3-10-report.md`
   §4): 1–3 as they were; 4 ← 4–7; 5 ← 8–10; 6 ← 11–13; 7 ← 14–16;
   8 ← 17–18; 9 ← 19–20; 10 ← 21–23; 11 ← 24–27; 12 ← 28. Item 2 now
   gives each overlay reading with what is fine and what is a problem.

### S8 follow-up (2026-10-04) — the two S8 findings fixed, at the user's request

The user asked for both §11 S8.3 findings to be fixed. Acceptance criteria
were written here before the tests and the code.

1. **Back to the album's left column (D149).** Activating the album page's
   artist link, Play or Shuffle records the focus first (as the track rows
   do, V3-6-fix NAV-1), so Back from the screen it leads to (the artist
   page, or a Now Playing opened by Auto Now Playing) returns to that
   button, not to the top nav. The star does not navigate and records
   nothing. Found wider than reported: Play and Shuffle had the same fault
   with Auto Now Playing on (the default). Acceptance (e2e, mock rig, at
   150 % and 100 %):
   - album → Left → Down to the artist link → Enter → artist → Back: the
     focus is `content[1]`, the `.album-detail-artist` button;
   - Auto Now Playing on, Play → Now Playing → Back: the focus is
     `.album-play-btn`; Shuffle likewise `.album-shuffle-btn`.
2. **Start radio after a slow similar-songs answer (D150).**
   `getSimilarSongs2` waits up to **45 s** for its answer; every other
   request keeps the 10 s timeout. Navidrome asks an external agent the
   first time it sees an artist, and live S8 took 26.8 s once, so the A5
   row stayed hidden. A5's "hidden otherwise" still holds for an answer
   with fewer than 5 songs, a failure, or one slower than 45 s. Acceptance
   (e2e, mock rig):
   - with the answer held 12 s (`mockSimilarDelay=12000`), Start radio
     appears in the open sheet, without moving the focus;
   - a request of another kind held 11 s still fails at 10 s.
3. **A3 live (was `[!]`, §11 S7.8).** The user added "Test for Claude"
   (68 songs, one album). Navidrome 0.64.1 sends its `coverArt` (`pl-…`);
   the cover loads in the grid (requested at 400, served 300×300, the
   album art's own size) and in Home's row (270×270 at 150 %). Its songs
   show the artist and a thumbnail, and the options sheet opens on them
   with Start radio. A collage of several albums is not seen (one album);
   that stays on TV item 11.
4. **Version marker (D151).** Following v3.9-fix1, the cache-bust is
   `v3-10-fix1` (`build.sh` `CACHE_BUST`, the `index.html` stylesheet link,
   `tests/mock-index.html`) and Settings → About reads `V3.10-fix1`, so the
   build is identifiable on the TV.

### v3.10-fix2 (2026-10-05) — TV-test findings after V3.10-fix1

The user tested V3.10-fix1 on the Q90R and reported seven items
(`tickets/prompt-3.10-fix2.md`, which holds the acceptance criteria, written
by a planning session before any code). Each change below has a D-number and
says how its acceptance was read. The user added on 2026-10-05 that
**Litefin's oblong build shows a wide tile on this TV**, so the oblong tile
is not a TV limitation (F5).

1. **F1 — the page under Now Playing's rise fades (D152).** Rise: the ghost
   stays still under Now Playing and fades 1 → 0 over the rise (250 ms, R2's
   easing, D91); it is at opacity ≤ 0.01 before cleanup removes it. Sink
   (the mirror): the incoming page fades 0 → 1 over 250 ms where it is,
   instead of appearing at once. `TRANSITIONS` gains `outFadeMs` on rise
   and `inFadeMs` on sink; the D98 pin, the zoom origin and every other
   transition are unchanged; `.np-bg-image` is untouched (D47). §6.4's rise
   row ("stays still … removed at the end") is read with the fade.
2. **F2 — Settings: hide Up Next (D156, D157).** Settings → Appearance,
   after Background: "Up next on Now Playing ◄ Show / Hide ►",
   `sonance-np-upnext` (`show`/`hide`, default Show), Left/Right/Enter
   switch it. **D156:** it applies the next time Now Playing renders; there
   is no live path, because Settings and Now Playing are never on screen
   together. Hidden: no strip is built (no tiles, no label, no
   post-first-frame build), `.upnext-on` / `.upnext-tight` are never set,
   and the column has the pre-S6 28rem cover. **D157:** the sleep chip
   stays reachable alone under the controls in `.np-sleep-row`, absolute
   at the bottom of `.np-left`, in the 5.2rem the column already keeps
   below the controls (4rem chip, 1.2rem gap), so the column's size and
   place are exactly the pre-S6 ones; it shows (`.sleep-on`) on the
   strip's rule (a track, no side panel), and `np-upnext` holds it alone.
   At 200 % the pre-S6 column (58.3rem) is taller than the 54rem screen
   with or without a chip, so the chip would fall under the bottom edge:
   below 60rem of screen `.sleep-tight` moves the column up 3rem while the
   chip shows (the chip ends 0.9rem above the edge; the cover's top 3.1rem,
   62 px of 560, goes above the top edge, where the top nav would cover
   it; pre-S6 it already went 5 px past). "0 visible `.np-upnext-tile`" is
   read as `.np-upnext-item`, the tile's class.
3. **F3 — credits scroll, no row highlight (D154, D155), both views.**
   **D154:** no credit row is a focus stop; the view's zone holds one
   element, the scroller, and Up/Down move it by **a third of its visible
   height** (chosen over "three rows": rows wrap to different heights, a
   third always keeps two thirds of the view in sight). Now Playing: Down
   at the bottom does nothing; Up at the top falls through to
   `np-controls`, whose `entryIndex` lands on ⓘ (D118 unchanged). The sheet
   is isolated, so Up at the top stays; a redraw there (getSong answering)
   keeps the scroll position, while Now Playing's re-render (a track change)
   starts at the top, as R7 did. Plain `scrollTop` writes: instant, animated
   only with Smooth scrolling on. **D155:** the scroll indicator
   (`docs/UI-MOCKUP-REFERENCE.md` "Scroll indicator", token
   `--scroll-indicator-track`, thumb `--focus-fill`), 0.4rem on the
   scroller's right edge in a `.scroll-view` wrapper, shown (opacity, 0.15 s)
   only while the scroller has the focus and the content overflows.
   FocusManager's `will-change: transform` on the focused element is
   cancelled on the scroller (it does not scale; as a layer it would raster
   all its text). The orphaned `.credit-row.focused` rules and the row's
   transform transition were removed.
4. **F4 — the icons are centred (D153).** The lyrics lines are drawn
   x 4–20, y 5–19 (`M5 6h14M5 10h10M5 14h12M5 18h8`; they were 3 px left
   and 1.5 px up at 150 %). Audit of all nine controls: every other icon is
   within 1 px. Two readings: the play triangle is placed by its centroid
   (Material's optical centring; its box is 1.5 units right of centre by
   design, and moving it would look off-centre); the star is 0.49 unit high,
   under the ticket's 0.5-unit threshold, and its path is shared with other
   screens, so it stays. Trade-off: at 125–175 % the centred lines' edges
   fall on half pixels, a slightly softer line than the old (crisp,
   off-centre) one.
5. **F5 — the oblong tile (D161).** No code change to the two existing
   packages. `build.sh` adds `Sonance3-Oblong-Diag.wgt`: the oblong
   package with its packaged `config.xml` changed in three ways only (app
   id and package `S0nanceOb1.Sonance` / `S0nanceOb1`, name "Sonance
   Diag", `<tizen:profile name="tv-samsung"/>`); `required_version` stays
   5.0; staged in a temp directory, each edit checked to apply once. Found
   in research (session subagent, 2026-10-05): Litefin 1.9.0's oblong and
   square packages differ only in `assets/icon.png` (1920×1080, 8-bit
   palette, opaque); its `config.xml` has `tizen:profile tv-samsung` and
   `required_version="2.3"`; Apps2Samsung (formerly Jellyfin2Samsung)
   overwrites an app's icon only when a saved per-app icon key matches the
   package file name, and its own bundled Litefin wide tile is 1920×1080
   24-bit RGB, the format of Sonance's. So the icon format is not the cause;
   the likely causes are a tile cached for the reused app id, the missing
   profile, or `required_version`. Decision tree (report §4 item 1): Diag
   wide → a later round bisects id vs profile (the uninstall-and-reinstall
   step already tests the cache alone); Diag square (Litefin is wide) →
   `required_version` next; everything square including a fresh install →
   compare the remaining `config.xml` differences with Litefin's.
6. **F6 — the splash exit (D160, amends §6.7).** Measured first (CPU 6×,
   CDP tracing, bundled build, variants served through `page.route`): the
   cost a variant changes is the exit's re-raster at 2.2× (106 raster tasks,
   ~71 ms of 428 / ~145 ms in the splash), ~63 ms of it the 8rem glow; no
   long main-thread task, no composite failure; the logo has its own layer
   (757×829 at 150 %) in the grow, hold and exit. `will-change` alone
   changed nothing (not applied); the glow as an unscaled layer cut the exit
   to 9 ms but visibly weakened the tile's halo (not applied); **the exit
   grows to `scale(1.4)` instead of 2.2**, which removes the exit's raster
   entirely (0 tasks) and leaves the grow and the hold as they were.
   `e2e/splash.spec.ts` samples 1 + 0.4 × the curve. R11's acceptance is
   unchanged.
7. **F7 — Focus mode (D158, D159).** `#np-focus`, the ninth control, after
   ⓘ; `CONTROLS_COUNT` 9, the constant selector kept (V3.7-fix29),
   `PLAY_INDEX` 2 and `CREDITS_INDEX` 7 unchanged. **D158:** the row's gap
   is 1.2rem: nine buttons are 46.8rem in the 48rem column at every size.
   **D159:** `.np-focus-dim` is a black overlay, the last child of
   `.np-screen`, z-index 4 (over the layout and Up Next, under the fixed top
   nav), `pointer-events: none`, opacity 0 ↔ `var(--np-focus-dim)` over
   0.25 s; the token is the opacity (0.5), not an rgba fill, because the
   acceptance reads the overlay's computed opacity as 0.5. Remembered in
   `sonance-np-focus` (`on`/`off`, default off) and applied at render with
   no fade, so a remembered dim does not fade in on every visit. Off, the
   overlay is `display: none` (shown just before the fade in, hidden when
   the fade out ends): kept at opacity 0 it moved the translucent nav's
   blend by up to 6/255 at 100 % (the visual gate found 128 px) and took
   its own layer over promoted buttons, so off is the old Now Playing.
   "Layers": 16 = 16 on a fresh Now Playing, off or on; after a walk along
   the row 18 = 18 off, 19 on (the dim, one solid-colour layer); nothing
   animates at rest. Available with or without a track (never D55-dimmed);
   its on state is an open panel's (accent at rest, ink when focused).
8. **Version marker (D162).** Cache-bust `v3-10-fix2` (`build.sh`
   `CACHE_BUST`, the `index.html` stylesheet link, `tests/mock-index.html`'s
   22 tags); Settings → About reads `V3.10-fix2`.

### v3.11 release (2026-10-07) — the TV results, the version bump

1. **TV results for v3.10-fix2 (D163).** The user tested V3.10-fix2 on the
   Q90R and confirmed every item: the rise and sink fade (F1), hiding Up
   Next (F2), credits scrolling with no row highlight (F3), the centred
   lyrics icon (F4), Focus mode (F7) and the smoother splash (F6). **R12 is
   confirmed on the TV:** `Sonance3-Oblong.wgt` shows a wide home-row tile
   (the first V3.10-fix1 install had shown a square one; the result points
   to the tile cached for the reused app id, D161's first hypothesis). The
   diagnostic package was not needed, so `build.sh` no longer builds it;
   D161 is closed. The square `Sonance3.wgt` stays the default; both share
   one app id.
2. **Version 3.11 (D164).** Settings → About reads `V3.11`; the cache-bust
   is `v3-11` (`build.sh` `CACHE_BUST`, the `index.html` stylesheet link,
   `tests/mock-index.html`'s 22 tags); and `config.xml`'s widget `version`
   goes from `1.0.0` (never bumped through v3.x) to `3.11.0`, the version
   the TV reports for the installed app. That is the only `config.xml`
   change; both packages still share it byte for byte, and the app id is
   unchanged, so 3.11 installs over the existing app as an update (whether
   the app's stored settings survive depends on the installer, e.g.
   Apps2Samsung's "Remove old version" option). No behaviour change.
3. **The git repository (D165).** The project becomes a git repository at
   v3.11 (branch `main`, one initial commit; the user pushes it to GitHub).
   Tracked: the sources, tests, docs, tickets, prompts, the two release
   packages (`Sonance3.wgt`, `Sonance3-Oblong.wgt`), the bundles the shipped
   `index.html` loads, and the images directly in `screenshots/` (the
   user's pictures for the GitHub page). Ignored (`.gitignore`): every
   subfolder of `screenshots/`, now and later (`screenshots/*/`: 248 MB of
   session captures, and a v3.9 live Settings capture shows the test
   account), `PROGRESS.md` (the user keeps the session log private),
   `.playwright-mcp/` (April tooling output with replayable Subsonic `t`/`s`
   pairs and a login-form snapshot), and as before `*.local.md`,
   `next_prompt.md`, `node_modules/` and test output. The user chose the
   screenshot and `PROGRESS.md` rules; `.playwright-mcp/` follows the S8
   audit (report §7).
4. **Two credential values redacted in `PROGRESS.md` (D166).** At the
   user's request, before the first commit: line 281's cache-key prefix and
   line 2366's "login with …" now point to `TEST-ACCOUNT.local.md` instead
   of naming the test account. Only those two values changed; this
   supersedes, for them, the v3.10 non-goal "Redacting historical
   PROGRESS.md prose" (§4), which was about honest records, not about
   publishing credentials. The user then chose to keep `PROGRESS.md` out of
   the repository (D165), so the redaction matters only if the file is ever
   shared. The test account's password itself is unchanged (it is still in
   older local Claude transcripts, outside the repository).

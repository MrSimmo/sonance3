# UI Reference — Sonance (design spec)

**This is the design spec.** It has two parts:

1. **As built (v3, through v3.11).** What `css/styles.css` and the
   screens render today, with the values and line numbers they come from.
   Rewritten 2026-10-01 (v3.10 S1 T7): the previous version described the
   pre-v3 sidebar layout with outline focus rings, which no longer exists.
2. **v4 targets (v3.10).** The tokens `tickets/ticket-3.10.md` §6 adds. Each
   is marked with the session that lands it. **A token goes into this file
   before it goes into CSS.** When a session lands one, it moves it from part 2
   into part 1.

`CLAUDE.md` "v3 UI Design System" is the behavioural summary. Where they
disagree on a value, this file records which is true (see "Known
discrepancies").

Line numbers are `css/styles.css` unless another file is named, as of v3.10 S2;
S3 inserted rules throughout the stylesheet, so its sections (Focus, Rows,
Now Playing bar) name selectors instead, and older `:NNN` references are
approximate (search for the selector).

**Units (v3.10 S2, R4).** The stylesheet is in rem on a scaled root (see
"Interface size" below). Where Part 1 quotes a length in px, it is the 100 %
rendering of the rule: `Npx` here means `(N/10)rem` in the CSS, except
hairline borders and the NP backdrop blur, which really are px.

---

# Part 1 — As built (v3)

## Colour tokens (`:root`, :7-21)

| Token | Value | Use |
|---|---|---|
| `--bg-main` | `#1a1a24` | App background (`html, body, #app`, :35) |
| `--bg-primary` | `#0a0a0c` | Login, Home hero, deepest surfaces |
| `--bg-secondary` | `#121217` | |
| `--bg-card` | `#1a1a22` | Cards, inputs |
| `--bg-elevated` | `#222230` | |
| `--accent` | `#e44d8a` (default; user-selectable) | Focus fills, active states, progress |
| `--accent-rgb` | `228, 77, 138` | For `rgba(var(--accent-rgb), a)` |
| `--accent-soft` | `rgba(accent, 0.15)` | Soft tints |
| `--accent-glow` | `rgba(accent, 0.35)` | Glows |
| `--text-primary` | `#f0f0f5` | Titles |
| `--text-secondary` | `#8e8ea0` | Meta |
| `--text-muted` | `#55556a` | Numbers, durations, section labels |
| `--border` | `#2a2a38` | Dividers |
| `--focus-fill` | `var(--accent)` | Focus background (S3, R6; see "Focus") |
| `--focus-ink` | `#ffffff` (Pink default) or `#15151c` | Text and icons on the focus fill |
| `--focus-ink-soft` | `rgba(255,255,255,0.86)` (Pink default) | Meta text on the focus fill |
| `--backdrop-top` | `#1d1d2c` | Gradient backdrop's base, top (S7, R10, ticket §6.6) |
| `--backdrop-bottom` | `#121219` | Gradient backdrop's base, bottom (S7, R10) |
| `--backdrop-violet-rgb` | `88, 70, 230` | Gradient backdrop's bottom-right glow (S7, R10) |
| `--scrim` | `rgba(10,10,12,0.6)` | Behind the options sheet (S7, A5): `--bg-primary` at 0.6 |
| `--scroll-indicator-track` | `rgba(255,255,255,0.12)` | The scroll indicator's track (v3.10-fix2 F3, D155; see "Scroll indicator"); its thumb is `--focus-fill` |
| `--np-focus-dim` | `0.5` | Now Playing's Focus-mode overlay: the opacity of its black (`#000`) fill, so the screen is 50 % darker (v3.10-fix2 F7, D159; see "Focus mode") |

`App.applyAccentColor(hex, rgb)` (`js/app.js`) sets `--accent`,
`--accent-rgb`, `--accent-glow`, `--accent-soft` and, since S3, the three
focus tokens on `<html>`. Presets
(`js/screens/settings.js:21-29`): Pink `#e44d8a`, Red `#ef4444`, Orange
`#f97316`, Amber `#f59e0b`, Green `#22c55e`, Teal `#14b8a6`, Blue `#3b82f6`,
Purple `#8b5cf6`. Brand gradient: `linear-gradient(135deg, var(--accent),
#8a4dff)` (login tile, :177).

Recurring surface values (not tokens yet, reused rather than invented):
nav bar `rgba(50,50,60,0.85)`; panels/dialogs `rgba(30,30,38,0.95)`; NP bar
`rgba(34,34,48,0.95)`; resting button `rgba(255,255,255,0.08)`; "selected"
pill `rgba(255,255,255,0.15)`; drop shadow `0 8px 24px rgba(0,0,0,0.4)`.

## Interface size (v3.10 R4, D49) — as built in S2

The whole UI scales with one setting, Settings → Appearance → "Interface
size", 100 / 125 / 150 / 175 / 200 %. **Default 150 %.** It is built on rem
units over a scaled root font size — **never CSS `zoom`** and never the
viewport meta (D49: under `zoom` the measured nav pill and the lyrics slide
land in the wrong place, and Chromium 63's `zoom` differs from today's).

**Root.**
- `html { font-size: 10px }` in the stylesheet: 1 rem = 10 px at 100 %.
- The applied root size is `10px × scale`. An inline `<script>` in the
  `<head>` of `index.html` and `tests/mock-index.html` reads
  `localStorage['sonance-ui-scale']` inside try/catch, accepts only
  {1, 1.25, 1.5, 1.75, 2}, defaults to 1.5, and sets
  `document.documentElement.style.fontSize` before first paint. It sits
  outside `BEGIN/END:JS_SCRIPTS`, so `build.sh` keeps it.
- `body { font-size: 1.6rem }`. The UA default is 16 px, and every element
  without its own `font-size` inherits from `body`; without this rule they
  would all drop to the 10 px root at 100 %.

**CSS conversion rules** (`tests/tools/px-to-rem.js`, run once in S2):
- Every `Npx` length becomes `(N/10)rem`, decimals exact: 13px → 1.3rem,
  6.5px → 0.65rem, -6.5px → -0.65rem.
- **Hairlines stay px (D63):** a `1px` width in a `border`, `border-top`,
  `border-bottom`, `border-left` or `border-right` declaration — 22
  declarations. They stay one device pixel at every size. Nothing else
  counts as a hairline: `letter-spacing: 1px` (type tracking) and the
  equaliser bar's `border-radius: 1px` (a shape) convert to 0.1rem.
- **`.np-bg-image`'s `filter: blur()` radius stays px** (§ Now Playing;
  120px since S6, R8). The rule keeps its `%` box and gains no transform
  (D47).
- `%`, `vw`, `vh` and unitless values stay. The lyrics slide becomes
  `translateX(calc(32rem - 50vw))`.
- Comments are not rewritten; a px value in a comment describes 100 %.

**JS lengths** (`js/utils.js`):
- `SonanceUtils.uiScale()` → the applied scale (1–2), read once from the root's
  computed font size and kept in step by `App.applyUiScale` (D67).
- `SonanceUtils.rem(px)` → the string `'(px/10)rem'`. Every inline design
  length set from JS uses it: icon, art, avatar and skeleton sizes, radii,
  margins. Being rem, they follow a live size change without a rebuild.
- `SonanceUtils.px(n)` → `n × uiScale()` in px, for layout maths: scroll
  paddings (±20), the slide distance (±60), `VirtualGrid` row-height and
  min-width estimates and its gap allowance, the lazy-load root margin.
- **Measured geometry stays measured (D11).** Nav-pill and sub-nav-pill
  rects, the `zoomContent` ghost box, `VirtualGrid` spacer and translate,
  the lyrics `translateY`, the scrubber offset: these are read from layout
  and written back in px, so they are right at any size. The top-nav pill's
  base width is measured too (D65), not assumed to be 100.

**Live apply — `App.applyUiScale(scale)` (D66).** Sets and persists the root
size, re-measures the top-nav rects and pill, re-renders the current screen
through the router's no-transition path, and puts focus back on the zone and
index it was on (the size row). Playback is not touched. The NP bar's icons
are sized in rem, so the bar reflows and needs no rebuild.

**Settings row.** `#settings-ui-scale-row`, a `.settings-toggle-row` in
Appearance below "Reset to default", reading "Interface size ◄ 150% ►"
(mockup 13). Left/Right step one size and **stop at 100 % and 200 %**; Enter
steps up and **wraps 200 % → 100 %** (D64).

**What stays px at every size:** hairline borders, the NP backdrop blur,
the `<object id="av-player">` 1×1 rect (`index.html`, AVPlay needs a rect,
not a design length), and measured geometry.

**S2 decisions** (full text in `PROGRESS.md`, v3.10 Session 2):
- **D63** — a hairline is a `1px` width in a `border*` declaration, nothing
  else; letter-spacing and radii of 1px convert.
- **D64** — Left/Right on the size row clamp at 100 % / 200 %; Enter wraps.
- **D65** — the top-nav pill's base width is measured, not the literal 100.
- **D66** — live apply re-renders the current screen through the router's
  no-transition path and restores focus with the Back path's snapshot
  machinery; rem icon sizes make a separate NP-bar rebuild unnecessary.
- **D67** — `SonanceUtils.uiScale()` reads the root's computed size once and
  is kept in step by `App.applyUiScale`; the head script is the only boot-time
  reader of the stored value.
- **D68** — Home rows are carousels: at sizes where they overflow, the
  focused card is scrolled into the row, instantly.
- **D69** — the nav rects are re-measured when the selected (bold) item
  changes, which fixes a pre-existing 1–4 px pill error. It is the one
  deliberate change to the 100 % rendering (pill box only).
- **D70** — art request sizes follow the interface size (S5). Each surface
  keeps its v3.9 100 % bucket (grid and Home cards 180, small thumbnails
  100, Now Playing 320, artist avatars 100/120/200) and
  `SonanceUtils.artSize(bucket)` scales it, rounded: at 150 % the cards
  request 270 (drawn at 212 / 243 px; S2 measured the 180 px image upscaled),
  thumbnails 150, Now Playing 480. Every preload asks with the same call, so
  its URL is the one the screen then requests (v3.9 T6). 100 % is unchanged.

## Typography

- Font: `'SamsungOne', 'SamsungOneUIFW', -apple-system, BlinkMacSystemFont,
  sans-serif` (:37). Root `html { font-size: 10px }` × interface size (above);
  `body` 1.6rem.
- Sizes are rem per rule. There is no separate type ramp: the interface size
  is the ramp (ticket-3.10 §6.2). Representative, with the rendered size at
  100 % and at the 150 % default:

| Element | Size / weight | 100 % | 150 % | Line |
|---|---|---|---|---|
| Body default (inherited) | 1.6rem | 16 px | 24 px | :53 |
| Top-nav item | 1.5rem / 500 (600 focused/selected) | 15 px | 22.5 px | :362 |
| Library sub-nav item | 1.4rem / 500 | 14 px | 21 px | :1972 |
| Albums grid title / meta | 1.2rem / 500, `rgba(240,240,245,.72)` (focused 700 white, S3), 1.1rem | 12 px, 11 px | 18 px, 16.5 px | :2141, :2150 |
| Home card title / meta | 1.4rem / 500, `.72` (focused 700 white, S3), 1.3rem | 14 px, 13 px | 21 px, 19.5 px | :1869, :1879 |
| Album-detail track artist (S3, R5) | 1.3rem secondary | 13 px | 19.5 px | `.track-row-artist` |
| Track/song/queue row title / meta | 1.5rem / 600, 1.3rem | 15 px, 13 px | 22.5 px, 19.5 px | :2557, :2270, :1181 |
| Row number / duration | 1.4rem muted, tabular-nums | 14 px | 21 px | :2535, :2572 |
| Home hero title / subtitle | 3.4rem / 700, 1.8rem | 34 px, 18 px | 51 px, 27 px | :1718, :1728 |
| NP title / artist line | 2.8rem / 700, 1.7rem | 28 px, 17 px | 42 px, 25.5 px | :770, :782 |
| Lyrics line | 3.6rem / 400 (active 700, scale 1.15) | 36 px | 54 px | :3416 |
| Settings section title | 1.3rem / 600, uppercase, 0.1rem tracking | 13 px | 19.5 px | :1255 |
| NP bar height | 7.6rem | 76 px | 114 px | :520 |

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│            ╭── top nav bar (fixed, top 24px) ──╮              │
│            │ Home Library Playlists Queue NP 🔍 ⚙│              │
│            ╰────────────────────────────────────╯              │
│  #page-container (fixed, top 80px, bottom 76px)               │
│    .page-layer  padding 28px 48px 20px                        │
│      #page-current > *  max-width 1600px, centred             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Now Playing bar (fixed bottom, 76px)                          │
└──────────────────────────────────────────────────────────────┘
```

- `#page-container` (:432): fixed, `top: 80px; bottom: 76px`. `.no-nav` →
  top 0; `.no-np-bar` → bottom 0 (no track, or on Now Playing).
- Full-bleed screens (`#page-current.fullbleed`, `.np-active`, :3286-3307)
  drop the padding and the max-width.
- Other content widths: `.library-song-list` 1200px (:2214), `.queue-list`
  1000px (:1117), `.playlists-grid` 1400px (:2911), `.settings-left` 720px.
- **No sidebar.** Navigation is the top nav plus the Library sub-nav.

## Top nav (:334-426, `js/app.js:568-720`)

- `#top-nav` fixed, top 24px, centred, z-index 100. `#top-nav-bar`:
  inline-flex, `rgba(50,50,60,0.85)`, radius 25px, padding 4px 6px.
- Items: Home, Library, Playlists, Queue, Now Playing, Search (18px icon),
  Settings (18px icon). `.top-nav-item` padding 8px 20px, min-height 34px,
  radius 20px, `rgba(255,255,255,0.55)`; focused/selected white 600.
- **Sliding pill** `#top-nav-pill`: positioned by JS from measured item rects
  (`translateX(left) scaleX(itemWidth / baseWidth)`), base width 10rem,
  `transition: transform 0.25s ease`. v3.10 S2: the base width is measured
  with the rects, not assumed to be 100 (D65), and the rects are re-measured
  whenever the selected (bold, 600) item changes, because the bold label is
  wider and the bar is centred (D69). The pill now equals its item's rect to
  0 px at every interface size; before D69 it was up to 2 px narrow at 100 %
  and 4 px at 200 %.
  - Focused (focus on the nav): solid `--focus-fill` +
    `0 2px 12px rgba(0,0,0,0.3)`, label `--focus-ink` (S3, R6; it was a
    55 % accent tint with a white label).
  - Selected (focus in content): `rgba(255,255,255,0.15)`, white label.
  - The label colour follows the pill's class through a sibling selector
    (D71), never the item's own `.focused`.
- **Dwell auto-navigation (v3.10 R1.3, D51, S4).** Left/Right moves the pill
  and its label at once; the screen changes **180 ms after the last press**
  (`NAV_DWELL_MS`, a `setTimeout` restarted by each press). A flick across
  several items therefore renders only the destination. The slide's direction
  is the net direction of the presses (D89). Down or Enter during the dwell
  navigates at once and drops focus into the new screen's content; Back
  during the dwell navigates first, then acts. A mouse click navigates at
  once. Down enters page content; Up from content returns.

## Library sub-nav (:1958-2032, `js/screens/library.js:290`)

- Vertical pill menu, 140px wide, `rgba(30,30,38,0.60)`, radius 20px; items
  14px; content starts at `margin-left: 180px`.
- Pill `transition: transform 0.2s ease`; focused solid `--focus-fill` with
  the label in `--focus-ink` (D71), selected `rgba(255,255,255,0.15)` with a
  white label. The item label no longer fades its colour (D75).
- **Dwell (v3.10 R1.3, D51, S4).** Up/Down moves the pill and the selected
  label at once. The content fades out (0.15 s) from the first press, and the
  tab is built **180 ms after the last press**, then fades in: a run of
  presses builds one tab (D90). Right or Enter during the dwell builds it at
  once and enters the grid when it is ready. **Down on the last tab goes to the NP bar** when it is showing,
  and otherwise stays put (S3, R9; it used to wrap to Albums). Right/Enter
  enters content; Left from the grid's first column returns.

## Focus (v4, R6, D50) — as built in S3

The user chose "stronger pink" (ticket-3.10 §3.1.2): focus is a **solid**
accent fill with a computed ink colour, cards get a bigger scale plus a ring
and a deep shadow. Every `.focused` rule in the stylesheet uses the tokens
below; the audit is the "Focus audit" table at the end of this section.

**Tokens** (`:root` holds the Pink defaults, so they hold before any script
runs; `App.applyAccentColor(hex, rgb)` sets all three next to `--accent`):

| Token | Value | Notes |
|---|---|---|
| `--focus-fill` | the accent (`var(--accent)` in `:root`) | solid, never an alpha tint |
| `--focus-ink` | `#ffffff` if white-on-accent contrast ≥ 3:1, else `#15151c` | WCAG 2 relative luminance, computed from the accent's `rgb` (D50, D72) |
| `--focus-ink-soft` | the ink at 0.86 alpha, as `rgba()` | no `color-mix` on Chromium 63 |

The ink per preset (white-on-accent contrast): white on Pink 3.67, Red 3.76,
Blue 3.68, Purple 4.23; dark `#15151c` on Orange 2.80, Amber 2.15, Green 2.28,
Teal 2.49. The ink-on-fill contrast is ≥ 3:1 for all eight (e2e).

**Rows** — `.track-row`, `.song-row`, `.queue-row`, `.search-result-item`,
`.artist-album-row`, `.settings-library-row`:
- background `var(--focus-fill)`;
- title, number, duration and icons (`.track-row-star`, the equaliser bars of
  the playing row, the library checkbox) in `var(--focus-ink)`;
- meta lines (`.track-row-artist`, `.song-row-meta`, `.queue-row-artist`,
  `.search-result-meta`, `.artist-album-meta`) in `var(--focus-ink-soft)`;
- `transform: scale(1.02)`, `transform-origin: left center`,
  `transition: transform 0.12s ease`. `.artist-album-row` was 1.03; it
  joins the others at 1.02.

**Pills** — top nav `#top-nav-pill`, Library sub-nav `.library-subnav-pill`:
- focused: solid `var(--focus-fill)`, the label in `var(--focus-ink)`;
- selected (focus in content): `rgba(255,255,255,0.15)`, white label.
- **The label colour is derived from the pill (D71):**
  `#top-nav-pill.focused ~ .top-nav-items .top-nav-item.selected` and
  `.library-subnav-pill.focused ~ .library-subnav-item.selected`. The pill and
  the label therefore cannot disagree, whatever order the JS sets the classes
  in (the planning harness hit white-on-white when they diverged).

**Buttons** — solid `var(--focus-fill)` + `var(--focus-ink)`, keeping each
button's existing scale (1.04–1.08) and lift shadow:
- `.hero-play-btn`, `.hero-shuffle-btn`, `.album-play-btn`,
  `.album-shuffle-btn`, `.artist-play-btn`, `.artist-shuffle-btn`;
- `.kb-key`, `.kb-space`, `.kb-del`; `.exit-btn-cancel`, `.exit-btn-exit`;
  `.settings-confirm-cancel`, `.settings-confirm-logout`,
  `.settings-logout-btn` (the two red buttons keep red at rest only);
- `.settings-toggle-row` (label, value and ◄ ► in ink; **no outline**, no
  background transition), `.accent-reset`, `.album-detail-artist.focusable`,
  `.album-star-btn` (a circular platter);
- NP bar: `.np-bar-btn` (Previous/Next) get a circular platter;
  `.play-btn-main` (bar Play/Pause) keeps its white circle at rest;
- Now Playing: `.np-ctrl-btn` (shuffle, previous, next, repeat, star,
  lyrics) get a **circular fill platter** with the icon in ink (it was an
  icon tint only); `.np-ctrl-play` keeps its white rounded square at rest and
  fills when focused (mockup 09); the focused scrubber is `--focus-fill`.

**Cards** — `transform: scale(1.12)`, transition `transform 0.15s ease`; the
art gets `box-shadow: 0 0 0 0.4rem var(--focus-fill), 0 2.2rem 4.4rem
rgba(0,0,0,.7)` — the ring, then the deep shadow. Where the ring goes (D73):

| Card | Ring + shadow on | Label (rest → focused) |
|---|---|---|
| `.album-card` (Home) | `.album-art` | `.album-card-title` `rgba(240,240,245,.72)` 500 → `#fff` 700 |
| `.album-grid-card` (Albums grid) | `.album-art-fill` | `.album-grid-title`, same |
| `.artist-grid-card` | `.artist-avatar` (circular) | `.artist-grid-name`, same |
| `.artist-similar-card` | `.artist-similar-avatar` (circular) | `.artist-similar-name`, same (it was a 55 % fill) |
| `.playlist-card` (S7, A3: an art + label card now) | `.playlist-card-art` | `.playlist-card-name` `rgba(240,240,245,.72)` 500 → `#fff` 700 |
| `.genre-card`, `.search-qa-tile` | the tile itself (it is its own art) | labels are inside the tile, unchanged |
| `.queue-np-card` | the card, at `scale(1.04)` | — (a 28rem card at 1.12 would leave its 32rem column) |

- **D6 (Chromium 63 glyph-cache ghosting fix) — do not remove:**
  `transform: translateZ(0)` + `backface-visibility: hidden` on
  `.album-card` (:1845-1847), `.album-grid-card` (:2098-2100) and
  `.artist-grid-card` (:2175-2177); the focused rules keep `translateZ(0)`.
- Grids: Albums `repeat(auto-fill, minmax(140px,1fr))`, `grid-gap: 28px 20px`
  (8 columns at 1600px); Artists `minmax(130px,1fr)`, `24px 16px`; Genres
  `repeat(4,1fr)`; Playlists `repeat(3,1fr)`, `24px 18px`. Albums/Artists are
  `VirtualGrid`s whose geometry is measured from the rendered grid (D11).
  Albums columns by interface size, measured in S2: 8 / 7 / 6 / 4 / 4 at
  100 / 125 / 150 / 175 / 200 % (row pitch 223 / 280 / 315 / 429 / 422 px).
- **Home rows are horizontal carousels** (`.home-row`, :1814,
  `overflow-x: auto`). They fit up to 125 %; from 150 % the playlists row,
  and from 175 % all three, are wider than the screen. Since S2 the focused
  card is scrolled inside the row's padding box (`js/screens/home.js`
  `_scrollRowToFocused`, instant, D68).

**Timing.** Colour, background and font-weight snap; only transforms
animate (0.12 s rows, 0.15 s cards and buttons). S3 removed every colour or
background transition on a focus rule (D75): `.settings-toggle-row`,
`.album-detail-artist.focusable`, `.library-subnav-item`, `.album-star-btn`,
and the colour half of `.track-row-star` (its opacity fade stays).

**Room for the focus transform (D76).** A scaled element and its ring must
not be cut by a clipping ancestor (`e2e/helpers/geometry.js` `focusClip`,
checked at 100/150/200 %):
- `.settings-left` has `margin-left: -1.2rem; padding-left: 1.2rem`, so the
  clip edge moves into the page padding while the content stays put (swatch 0,
  Logout);
- `.artist-detail-right` has `padding-right: 4rem`, as `.album-detail-right`
  always had (discography rows);
- `.queue-list` `padding-right` is 2.4rem (was 1.2rem): the row's 2 % growth
  is wider than 1.2rem when the list fills `.queue-right` (150–175 %);
- `.home-row` padding is `2rem 2rem 2.8rem` (was 1.6rem at the sides and top):
  a 1.12 card plus its 0.4rem ring overhangs 1.4–1.9rem;
- the keyboard's first column (`.kb-key:nth-child(9n+1)`, `.kb-space`) scales
  from its left edge: `.search-screen` is the page's own child and clips at
  its border, so there is no room to its left without moving the layout.
- **Accent swatches keep a white ring (D74).** A swatch's fill *is* the
  colour it offers, so it cannot take the focus fill: focus is `scale(1.15)`
  plus a white 0.2rem border, as before. It is the only focus rule without a
  focus token.

**Focus audit** (every `.focused` selector, S3):

| Selector(s) | Type | Focused |
|---|---|---|
| `.focusable.focused` | base | `outline: none` (removes the UA ring) |
| `.top-nav-item.focused` / `#top-nav-pill.focused` | pill | weight 600 / `--focus-fill`; label ink via D71 |
| `.library-subnav-item.focused` / `.library-subnav-pill.focused` | pill | weight 600 / `--focus-fill`; label ink via D71 |
| `.np-bar-open.focused` | pill | `--focus-fill`, title ink, artist ink-soft, hint shown (D80) |
| `.np-bar-btn.focused`, `.play-btn-main.focused` | button | fill + ink |
| `.np-screen-progress.focused` (scrubber) | button | scrubber `--focus-fill`, `scale(2)` |
| `.np-ctrl-btn.focused`, `.np-ctrl-lyrics.focused`, `.np-ctrl-star.focused` | button | circular platter, icon ink |
| `.np-ctrl-play.focused` | button | fill + ink |
| `.queue-np-card.focused` | card | ring + shadow, `scale(1.04)` |
| `.queue-row.focused`, `.song-row.focused`, `.track-row.focused`, `.search-result-item.focused`, `.artist-album-row.focused`, `.settings-library-row.focused` | row | fill, ink, ink-soft meta, `scale(1.02)` |
| `.options-sheet-item.focused` (S7, A5) | row | fill, label and icon ink, `scale(1.02)` from the left |
| `.settings-logout-btn.focused`, `.settings-confirm-cancel.focused`, `.settings-confirm-logout.focused`, `.accent-reset.focused`, `.settings-toggle-row.focused` | button | fill + ink |
| `.accent-swatch.focused` | swatch | `scale(1.15)` + white border (D74) |
| `.hero-*-btn.focused`, `.album-*-btn.focused`, `.artist-*-btn.focused`, `.exit-btn-*.focused`, `.kb-*.focused`, `.album-star-btn.focused`, `.album-detail-artist.focusable.focused` | button | fill + ink |
| `.album-card.focused`, `.album-grid-card.focused`, `.artist-grid-card.focused` | card | `scale(1.12) translateZ(0)` (D6), ring + shadow on the art, label `#fff` 700 |
| `.playlist-card.focused` (S7) | card | `scale(1.12)`, ring + shadow on `.playlist-card-art`, name `#fff` 700 |
| `.genre-card.focused`, `.search-qa-tile.focused`, `.artist-similar-card.focused` | card | `scale(1.12)`, ring + shadow |

No focus rule uses `outline` (other than `outline: none`), and none
transitions a colour or a background.

## Rows

`.track-row`, `.song-row`, `.queue-row`, `.search-result-item`,
`.artist-album-row`.

- Rest: padding 10-14px, radius 8-10px, title 15px/600, meta 13px
  secondary, number/duration 14px muted tabular. Focus: see "Focus" above.
- **Every track list shows the artist (R5, D57, S3).**
  - Album detail: `.track-row-info` holds `.track-row-title` and, under it,
    `.track-row-artist` (13px secondary, mockup 07).
  - Playlist detail: a 52px lazy cover thumbnail (`.song-row-thumb`, a
    `--bg-card` box with radius 6px and a lazy `<img>`, like the Queue's; the
    100 px request bucket Search and Queue share) after the number, then
    title and "artist · album" (mockup 05). Not `renderAlbumArt`: its
    gradient placeholder doubled a long playlist's first paint (D83).
  - Queue, Library Songs, Genre songs and Search song results already
    showed it; the missing-artist fallback is "Unknown artist" in the lists
    that had none or a bare "Unknown" (D81).
- **Equaliser (currently playing row).** Title in `--accent`, four animated
  bars. **V3.9 T1: the bounce is `transform: scaleY()` about
  `transform-origin: bottom center`, not `height`.** Each bar is a fixed 20px
  (the height of its `.track-row-eq` parent) with a base `transform: scaleY(0)`
  so a bar is invisible during its `animation-delay`, exactly as the old
  height-less rule was (D33). Keyframe scales are the old pixel heights over
  20: 0.2 / 0.8 / 0.4 / 1 (`@keyframes barBounce` :116, `.eq-bar` :123).
  Animating `height` was the stylesheet's only layout-dirtying rule.

## Library headers, chips and the Songs list (v3.10 A1, A2) — S5

Written before the CSS (S5 T2). Mockups 20 (Albums) and 16 (Songs) are the
visual target; where this section and a mockup differ, this section is what
ships, and the reason is given.

**Header** (`.library-header`, the first child of `#library-content`, so it
scrolls with the list):
- a flex row, `align-items: flex-end`, `justify-content: space-between`,
  padding `2.4rem 2.8rem 0` (the grid's own inset, so the title lines up
  with the first column);
- left: `.library-header-title` 3rem / 700 `--text-primary` ("Albums",
  "Songs"), and under it `.library-header-count` 1.5rem / 500
  `--text-secondary`, margin-top 0.4rem ("2,996 albums", "377 albums ·
  Rock", "30,458 songs"). The count is shown only when it is exact (D-number
  in the S5 entry); otherwise the line is empty and keeps its height;
- right: the chips.

**Chips** (`.library-chip`, buttons):
- rest: `rgba(255,255,255,0.08)` (the resting button value),
  `--text-primary`, 1.5rem / 600, height 4rem, padding `0 1.8rem`, radius
  2rem, an optional 1.6rem inline-SVG icon before the label (⇅ on Sort);
  `> * + *` margin-left 1.2rem between chips (no flex `gap`);
- focused: `--focus-fill` + `--focus-ink`, `scale(1.04)`, transform 0.15 s
  (the button rule);
- unavailable (Sort while a genre filter is set): opacity 0.4, still
  focusable, Enter does nothing (the D55 pattern).
- Albums: "⇅ Sort: Name" (Enter cycles Name → Artist → Recently added →
  Year → Most played → Name; Left/Right move between the chips) and
  "Filter: All genres" (Enter opens the genre picker; with a genre chosen it
  reads "Filter: Rock", the count line "377 albums · Rock", and Sort reads
  "Sort: Name", dimmed: the server orders a genre by name). The choice holds
  for the session. Songs: "Shuffle all" (200 random songs → queue).
- No A–Z rail and no Sort chip on Songs: the server's empty-query order is
  creation order, not title order (measured on live, S5), and the server
  cannot sort songs any other way without the whole library being
  downloaded (ticket A1).

**Focus path.** The header is its own zone (`library-header`): Down → the
grid or list, Up → the top nav, Left from the first chip → the sub-nav.
Up from the first row of the grid or list → the header's first chip
(`entryIndex: 0`, D54).

**Genre picker** (`.library-genre-picker`): a panel over the right of the
Library screen, 48rem wide, top and bottom inset 0, the panel surface
colour opaque, `rgb(30,30,38)` (at the dialogs' 0.95 the album titles
behind showed through its rows, S5 read-back), radius 2rem, padding `2.4rem 1.6rem`, title
"Filter by genre" 2rem / 700. Its rows (`.genre-pick-row`) are rows: rest
transparent, name 1.6rem / 600 `--text-primary`, "N albums" 1.3rem
`--text-secondary`, the chosen one marked "✓" in `--accent`; focused, the
row fill, name and ✓ in `--focus-ink`, count in `--focus-ink-soft`,
`scale(1.02)` from the left. "All genres" is the first row. It is a
virtual list (live has 693 genres). Back closes it and returns to the
Filter chip.

**Songs rows** (`.song-row.song-row-wide`, mockup 16): thumbnail 4.8rem
(radius 0.6rem, the lazy box of the playlist rows,
`SonanceComponents.renderRowThumb`), then title (flex 2.2,
1.6rem / 600 `--text-primary`), artist (flex 1.4, 1.4rem
`--text-secondary`), album (flex 1.4, 1.4rem `--text-muted`), duration
(1.4rem `--text-muted`, tabular); padding `0.8rem 1.4rem`. Over a song
list the header takes the list's width (`.library-header-list`, max 120rem,
centred), so the title lines up with the rows. Mockup 16's row
number column is not drawn. Focused: the row fill, title and duration in
`--focus-ink`, artist and album in `--focus-ink-soft`, `scale(1.02)` from
the left. A row whose page has not arrived yet (`.song-row-pending`) has
the same box with its text as two `rgba(255,255,255,0.06)` bars; it is
focusable, so indices never shift.

**Virtual lists (R1.6, R1.7).** Playlist detail, Queue, Genre songs, Songs
and the genre picker are `VirtualGrid`s with one column. They look exactly
like the lists they replace: the mount keeps the list's class (its
max-width, centring and padding) and the moving band inherits the mount's
padding (`padding: inherit`), so a row is where it was. Focus-follow uses
`SonanceUtils.revealInScroller` with `px(20)` clear (D76: room for the
1.02 row).

## Buttons

- Hero / album / artist Play and Shuffle pills: rest `rgba(255,255,255,0.08)`,
  radius 22-24px, 15px/600; focused `scale(1.04-1.06)` with
  `0 4px 16px rgba(0,0,0,0.3)` and the focus fill.
- Exit dialog `.exit-btn` and logout confirm buttons: same pattern.
- Search keyboard `.kb-key`: 9 columns, `rgba(255,255,255,0.06)`, 18px/600;
  focused `scale(1.08)` with the focus fill.
- `.settings-toggle-row`: the value shows ◄ ► when focused. Since S3 its
  focus is the row fill (it was the last outline focus, on `--accent-soft`,
  with a background transition).
- Now Playing transport `.np-ctrl-btn`: rest is a grey icon on nothing;
  focused, a circular `--focus-fill` platter. Play/Pause `.np-ctrl-play` is a
  52px white rounded square at rest.

## Now Playing (`js/screens/nowplaying.js`)

- Backdrop `.np-bg-image`: 150% overscan box at -25%,
  `filter: blur(120px) saturate(1.3)` (v3.10 R8, S6: twice the old 60px, on
  the same element, box, opacity and overlay), opacity 0.6, **no transform**
  (D47: v3.9's scaled-blur trick made the backdrop vanish on the Q90R), under
  `.np-bg-overlay` `rgba(10,10,12,0.55)`. The radius is px at every
  interface size. With square, portrait and landscape covers the outer 50 px
  strip is within 0.3 % of the strip 200 px in (S6); raster time per track
  change about doubles (perf-baseline "v3.10 S6").
- Left column `.np-left` 480px: art 280px radius 16px, title 28px, artist —
  album 17px, progress (6px track, 13px white scrubber, scale 2 focused),
  controls row: shuffle, prev, play/pause, next, repeat, star, lyrics,
  since S6 ⓘ credits, and since v3.10-fix2 Focus mode (`columns: 9`, still
  a fixed zone shape — V3.7-fix29; gap 1.2rem, D158). See "Now Playing
  credits, Up Next and the sleep timer" below.
- Lyrics: `.np-lyrics-panel` slides in from the right (`translateX(100%)` →
  0, 0.25 s) while `.np-left` moves to `translateX(calc(320px - 50vw))`.
  Synced lines highlight and scroll; unsynced lyrics scroll proportionally to
  elapsed time (D48).
- **The controls row is entered on Play/Pause (R3, D54, S3).** The
  `np-controls` zone declares `entryIndex: 2`, so Down from the progress bar,
  Down from the top nav, the nav auto-hide drop and a cold open all land on
  `#np-play`; Left/Right inside the row keep their position.
- **With no lyrics the lyrics button is dimmed, not hidden (D55, S3):**
  `.np-ctrl-lyrics.is-unavailable` has opacity 0.35 (0.7 while focused, so
  its platter is still seen) and stays in the zone; Enter on it does nothing.
  It used to be `display:none` while still in the zone, so focus could land on
  an invisible button.

## Now Playing credits, Up Next and the sleep timer (v3.10 R7, A6, A7) — S6

Written before the CSS (S6 T2), then corrected to what was built after the
150 % read-backs (the credits panel's top inset, the Up Next layout maths).
Mockups 10 (credits) and 19 (Up Next, sleep timer) are the visual target;
where this section and a mockup differ, this section is what ships, and the
reason is given. D-numbers are in the S6 `PROGRESS.md` entry.

**Controls row, 9 wide since v3.10-fix2 (F7, D158).** A ninth button,
**Focus** (`#np-focus`, below), follows ⓘ. The row's gap is **1.2rem** (was
2rem): nine buttons are 37.2rem, plus eight gaps 46.8rem, inside the 48rem
column at every size (e2e at 100–200 %). The entry rules are unchanged
(Play, index 2; Up from the credits body lands on ⓘ, index 7). Every icon
is centred in its button (F4, D153): the lyrics lines are drawn x 4–20,
y 5–19 (they were x 2–18, y 4–18); the play triangle is placed by its
centroid (Material's optical centring).

**Controls row, 8 wide (S6).** Shuffle, Previous, Play/Pause, Next, Repeat, Star,
Lyrics, **ⓘ Credits** (`#np-credits`, `.np-ctrl-btn.np-ctrl-credits`). The
zone keeps its constant selector (V3.7-fix29) with `columns: 8` and still
enters on Play (`entryIndex` 2), except that Up from the credits list lands
on ⓘ. The ⓘ icon is inline SVG, 2.4rem (a ring with an "i"), and takes the
NP control focus: a circular `--focus-fill` platter, icon in `--focus-ink`.
With no track it is dimmed exactly like the lyrics button (D55: opacity 0.35,
0.7 focused, focusable, Enter does nothing). While the panel is open the icon
is `--accent` at rest, as the lyrics button is (`.is-active`); focused, the
ink wins (`.is-active.focused`), or the icon would be accent on the accent
platter (the lyrics button had exactly that since S3; fixed with it). The
row's gap is **2rem** (was 2.8rem): seven buttons at 2.8rem were already
46rem in the 48rem column at 100 % (measured), eight at 2rem are 47.2rem.

**Credits panel** (`.np-credits-panel`, mockup 10). The lyrics geometry and
slide: Enter on ⓘ adds `credits-active` to `.np-layout`, which moves
`.np-left` to the left column and shrinks the art exactly as `lyrics-active`
does, while the panel slides in from the right (`translateX(100%)`, opacity
0 → `translateX(0)`, 1; transform 0.25 s, opacity 0.2 s). Opening credits
closes lyrics and vice versa; Enter on ⓘ again, or **Back**, closes it.
- Box: absolute, top 0, right 0, bottom 0, width 55 % (the lyrics panel's),
  a flex column **top-aligned** below the nav: padding `9rem 4rem 3.2rem
  4.8rem` (mockup 10's title sits below the nav; centred, a long list put
  the title under it, S6 read-back).
- Header: "Credits" 3.6rem / 700 `--text-primary`; under it the track as
  "Title — Artist", 1.7rem `--text-secondary`, margin-top 0.4rem, one line.
  Neither shrinks.
- Body (`.np-credits-scroll`): margin-top 2rem, `flex: 0 1 auto` with
  `min-height: 0` (it takes what is left and scrolls), `overflow-y: auto`,
  padding-right 2.4rem and padding-bottom 1.2rem (D76: room for the focused
  row's 1.02 at both clipped edges; the last row can only scroll to the
  content's bottom). Scrollbars are hidden globally.
- Section title (`.credits-section`): 1.4rem / 700, uppercase, 0.3rem
  tracking, `--accent`, margin `2.4rem 0 0.4rem` (the first 0 on top).
- Row (`.credit-row`): a flex row, padding `1.1rem 1.2rem`, a 1px
  `rgba(255,255,255,0.1)` hairline below; label (`.credit-label`) 22rem
  wide, 1.4rem / 500 uppercase, 0.15rem tracking, `--text-secondary`;
  value (`.credit-value`) the rest, 1.8rem / 500 `--text-primary`,
  wrapping. The class names carry no `np-` prefix: S7's options sheet
  ("Show credits", A5) draws the same rows with
  `SonanceComponents.renderCreditSections`.
- Sections, each drawn only when it has a row: **Performance** (Artist;
  one row per performer sub-role, "Vocals", "Guitar"…, or "Performer"),
  **Writing & production** (Written by, Lyrics by, Produced by, Mixed by,
  Engineered by, Arranged by, Remixed by, DJ-mixed by, Conducted by;
  `displayComposer` as "Written by" when there is no composer
  contributor), **Release** (Album, Album artist, Label, Released "2006",
  or "2006 · originally 1994" when the original date differs, Track "7 of
  17", the count of the song's disc, plus " · Disc 1 of 3" on a multi-disc
  album, Genres), **File** (Format "FLAC", Bit rate "933 kbps",
  Sample rate "44.1 kHz · 16-bit", Channels "Stereo"), **Listening** (Plays,
  Last played, BPM). Several names in one value are joined with " · ".
- Content first comes from the queue's track object (instant), then from
  `getSong` and the album's `getAlbum` (label, original date, track count)
  when they answer; each is asked once per song / album per session. While
  the panel is open a track change re-renders it for the new track.
- **Focus (v3.10-fix2 F3, D154, D155; was one stop per row, S6).** No row
  is a focus stop and no row is ever highlighted: a highlighted row read as
  a menu option (TV report, 2026-10-05). When the body overflows, Down from
  the controls enters the `np-credits` zone, whose one element is the
  scroller itself; Up/Down then scroll it by **a third of its visible
  height** (D154), instant unless Smooth scrolling is on, and the scroll
  indicator (below) shows on its right edge while the zone is active. Down
  at the bottom does nothing; Up at the top returns to ⓘ (np-controls'
  entry rule, D118). When the body fits, Down from the controls does
  nothing. The body's right padding (2.4rem) keeps the text clear of the
  indicator.

**Scroll indicator** (`.scroll-indicator`, v3.10-fix2 F3, D155). The
position of a credits body that Up/Down scroll, shown only while that body
is the active focus stop, in both credits views (Now Playing's panel and
the options sheet's "Show credits"). Not a focus ring: it is not drawn
around anything (CLAUDE.md bans outline and border focus rings).
- The scroller and the indicator share a positioned wrapper
  (`.scroll-view`); the indicator is absolute on the scroller's right edge,
  top 0 to bottom 0, **0.4rem wide**, radius 0.2rem, the track
  `--scroll-indicator-track`.
- Thumb (`.scroll-indicator-thumb`): `--focus-fill`, radius 0.2rem, full
  width; its height is the visible fraction of the content
  (`clientHeight² / scrollHeight`, at least 3.2rem), its position a
  `translateY` of the same fraction of the scroll. It snaps with the
  content (no transition of its own).
- Shown with `opacity` 0 → 1 over 0.15 s when the scroller takes the focus
  and the content overflows; hidden again (0) when the focus leaves. A body
  that fits never shows it.
- FocusManager's will-change hint on the focused element is cancelled on
  the scroller (it does not scale, and as a layer it would raster all its
  text).

**Up Next strip** (`.np-upnext`, mockup 19). Shown at the bottom of Now
Playing whenever there is a track and no side panel is open.
- Box: absolute, left 0, right 0, bottom 0, padding `0 5.6rem 2.4rem`. Its
  height is 14.4rem: header 4rem + 1.2rem + tiles 6.8rem + 2.4rem.
- Header (`.np-upnext-header`): a flex row, height 4rem, the label left and
  the sleep chip right. Label "Up next · 37 songs" (the tracks left to play
  before the queue ends; with repeat all, the queue less this one), 1.4rem /
  700 uppercase, 0.2rem tracking, `--text-secondary`.
- Tiles (`.np-upnext-item`): the next five tracks in play order (the
  shuffled order when shuffle is on; with repeat all it wraps to the start),
  each a fifth of the row less the gaps (`> * + *` margin-left 1.6rem, no
  flex `gap`), padding 0.8rem, radius 1.2rem, the resting button surface
  `rgba(255,255,255,0.08)`; a 5.2rem thumbnail (radius 0.6rem, the lazy
  row-thumb box), then title 1.5rem / 600 `--text-primary` and artist
  1.3rem `--text-secondary`, both one line with ellipsis. With nothing left
  to play the row reads "End of the queue", 1.5rem `--text-muted`, at the
  tiles' height.
- Focused tile: a row (R6) — `--focus-fill`, title in `--focus-ink`, artist
  in `--focus-ink-soft`, `scale(1.02)` from the left, transform 0.12 s.
- **Layout.** The strip does not move the column by layout. With the strip
  showing (`.np-layout.upnext-on`), the column is placed in the band between
  the top nav (8rem, `#page-container`'s usual top) and the strip (14.4rem
  plus a 1.6rem gap, 16rem): centred on the screen, then translated
  (8 − 16) / 2 = **−4rem**; the controls lose their 3.2rem bottom margin
  (the column without its art is then 27.2rem, measured 27.07rem at 150 %);
  and the art is capped at `calc(100vh - 51.2rem)` square. That keeps 28rem
  up to 125 % and gives 20.8rem (312 px) at 150 % (mockup 19 draws about
  23rem). Below 69.2rem of screen height (175 % and 200 % on the TV's
  1080 px) that cap would be under 18rem, so `.upnext-tight` (set at render,
  `window.innerHeight < SonanceUtils.px(692)`) gives up the nav's room: band
  from 0, translate **−8rem**, cap `calc(100vh - 43.2rem)` (324 px at 175 %,
  216 px at 200 %). There the nav overlaps the art's top until it auto-hides
  (5 s), as it already overlapped the column at those sizes before S6.
  Opening a panel removes `upnext-on`: the strip fades and drops 2rem
  (transform/opacity, 0.2 s), and the column's translate animates to the
  panel position. `.np-left`'s transforms are all written `translate(x, y)`
  so they interpolate as one function. The strip's box is built with the
  screen; its header and tiles one frame later (two rAFs), which keeps Now
  Playing's synchronous render + activate under 16 ms (R1.4).
- **Focus.** One zone, `np-upnext`, in a single row: the tiles left to
  right, then the sleep chip. Down from the controls enters on the first
  tile; Right from the last tile reaches the chip; Up from any of them
  returns to Play (the controls' entry index). Enter on a tile plays that
  track (`Player.jumpToQueueIndex`). Hidden (a panel open, or no track), the
  zone counts as empty, so Down does nothing.

**Up Next hidden (v3.10-fix2 F2, D156, D157).** Settings → Appearance → "Up
next on Now Playing ◄ Show / Hide ►" (below Background; `sonance-np-upnext`,
`show` / `hide`, default Show) applies the next time Now Playing renders.
Hidden:
- no strip (`.np-upnext` is not built), no tiles, no label, no build work;
  `.upnext-on` and `.upnext-tight` are never set, so the column is centred
  with the pre-S6 28rem cover (no D122 cap) — the S6 layout before Up Next;
- the sleep chip stays (A7), alone, centred under the controls, in a
  `.np-sleep-row` absolute at the bottom of `.np-left`: the 5.2rem the
  column already keeps below the controls (their 3.2rem margin plus its
  2rem padding) holds the 4rem chip with 1.2rem above it, so the column's
  size and place are exactly the pre-S6 ones. It shows (`.sleep-on`, opacity
  0 → 1 over 0.2 s) with a track and no side panel open, as the strip does;
- the `np-upnext` zone holds the chip alone: Down from the controls → the
  chip, Up → Play, Enter cycles it;
- at 200 % on the TV's 1080 px (any screen under 60rem: the column is
  58.3rem) the column would put the chip under the screen's bottom edge, so
  `.sleep-tight` moves the column up **3rem** while the chip shows
  (transform only): the chip ends 0.8rem above the edge and the cover's top
  ~3.1rem (63 px) goes under the top edge, where the top nav would cover it
  anyway (the pre-S6 column already went 5 px past it at 200 %).

**Focus mode (v3.10-fix2 F7, D158, D159).** The ninth control, `#np-focus`
(`.np-ctrl-btn.np-ctrl-focus`), dims Now Playing so the music has the
screen.
- Icon: a 2.4rem inline SVG, a ring with its left half filled (a
  half-filled circle), drawn 2–22 in the 24-unit box (centred, D153).
- Enter toggles `.np-focus-dim.is-on`: a black (`#000`) overlay, the last
  child of `.np-screen`, absolute over the whole screen, z-index 4 (over the
  backdrop, cover, text, controls and Up Next, z-index 3), `pointer-events:
  none`, opacity 0 → `var(--np-focus-dim)` (0.5) and back, transition
  `opacity 0.25s ease`. Nothing animates at rest. The top nav (fixed,
  z-index 100) is not dimmed. Keys work as usual through it.
- Off, the overlay is `display: none` (`.is-shown` shows it just before
  the fade in; it goes when the fade out ends): present at opacity 0 it
  moved the translucent nav's blend over the backdrop by up to 6/255 and,
  over promoted buttons, took a composited layer of its own. Off, Now
  Playing renders as it did before Focus mode existed.
- The button's on state is an open panel's: `--accent` icon at rest, ink
  on the platter when focused (`.is-active.focused`, D121). It is never
  D55-dimmed: it works with or without a track.
- Remembered in `localStorage['sonance-np-focus']` (`on` / `off`, default
  off), applied when Now Playing renders; it stays on until toggled off.
- D47: the overlay is a sibling of `.np-bg-image`, which gains nothing.

**Sleep timer chip** (`.library-chip.np-sleep-chip`, in the Up Next header).
A chip (the S5 chip rules: rest `rgba(255,255,255,0.08)`, 4rem tall, 1.5rem
/ 600; focused `--focus-fill` + `--focus-ink`, `scale(1.04)`), with a 1.6rem
crescent icon. Enter cycles Off → 15 → 30 → 45 → 60 min → End of track →
Off, starting the chosen time afresh. Labels: "Sleep timer" (Off), "Sleep
in 30 min" (minutes left, rounded up, updated on each minute boundary by a
`setTimeout` chain), "Sleep: end of track". On expiry playback pauses and
a toast says so; "End of track" pauses when the current track ends and
cues the next one, paused. The timer outlives the screen (it keeps
counting on Home) and is not persisted.

## Now Playing bar (`js/app.js` `_buildNowPlayingBar`)

- Fixed bottom, 76px, `rgba(34,34,48,0.95)`, 1px top border, 2px accent mini
  progress (`scaleX`).
- Left: **`.np-bar-open`** (the `now-playing-bar-left` block): 48px art
  (radius 6px) + title 14px/600 + "artist — album" 12px, then a hint
  "OK → NOW PLAYING" (12px/700, 2px tracking, uppercase) that is transparent
  until focused. The block sizes to its content (the centre controls keep the
  right end with `margin-left: auto`); 0.8rem padding with a matching negative
  margin keeps the art where it was. **Focused it is a solid-fill pill**
  (`--focus-fill`, radius 1.4rem; title ink, artist ink-soft, hint ink;
  mockup 11), and Enter opens Now Playing (D56, D80).
- Centre: Previous, Play/Pause (42px white circle), Next. Focused Previous/Next
  get a circular `--focus-fill` platter; Play/Pause fills.
- **Focus zone (R9, D56, S3).** One helper,
  `App.registerNowPlayingBarZone(upNeighbour)`, registers it for every screen:
  4 columns, `.np-bar-open` then Previous, Play/Pause, Next.
  - Down from any content zone enters on `.np-bar-open` (`entryIndex: 0`).
  - Up returns to the zone **and item** focus came from
    (`returnToOrigin`, D79), falling back to `upNeighbour`.
  - While the bar is hidden (no track, or on Now Playing) the zone reports no
    elements (`isAvailable`, D78), so Down never enters it. If it hides while
    focused (the queue is cleared), focus goes back up.
  - When the bar first appears under the focus (the first play with Auto Now
    Playing off), the page loses the bar's height; the content focus is
    re-applied so the screen's scroll-follow runs again and the focused row is
    not left under the bar (D86).
  - **Back** on the bar goes to the top nav, as from content (D94, S4).
    Now Playing opened from the bar **rises** (R2), and Back from it sinks
    and returns focus to the item the user went down to the bar from (the
    D79 origin, D95, S4).
- Hidden (opacity 0, no pointer events) with no track or on Now Playing.
- **Resume (v3.10 A8, S6).** With Settings → Playback → "Resume last queue"
  On (the default), the queue saved on the server comes back at start: the
  bar shows its track **paused**, with the mini progress at the saved
  position; nothing is loaded and Now Playing is not opened until Play,
  which starts there.

## Settings (`js/screens/settings.js`)

- Two columns: `.settings-left` (scrolls, content max 720px) and a 280px
  About card. Since S3 `.settings-left` sits 1.2rem further left with 1.2rem
  of padding (max-width 73.2rem), so focused swatches and buttons have room
  and the content has not moved; it is `position: relative`, the
  offsetParent its focus-follow scroll measures against; and
  `.settings-layout` no longer clips (D76).
- Sections, in order: Server (info rows), Libraries (only with ≥ 2 libraries),
  Appearance (8 accent swatches, 36px circles, + "Reset to default"),
  Playback ("Auto Now Playing" toggle row; v3.10 S6, A8: "Resume last
  queue ◄ On ►" below it, `#settings-resume-queue-row`, a toggle row, with
  the hint "Brings back the queue you were playing, paused, the next time
  Sonance starts."), **Advanced** (v3.10 S1:
  "Performance overlay" toggle row; S5: "Smooth scrolling (experimental)",
  below), Account (Logout).
- Toggle rows change value with Left/Right as well as Enter: a row-id →
  handler map in the `settings-actions` zone (v3.10 S1; S2/S6 add rows).
- Appearance also holds **Interface size** (`#settings-ui-scale-row`, v3.10
  S2), below "Reset to default": "Interface size ◄ 150% ►". Left/Right step
  100–200 % in 25 % steps and stop at the ends; Enter steps up and wraps
  (D64). See "Interface size" above.
- Below it, **Background** (`#settings-backdrop-row`, v3.10 S7, R10,
  mockup 13): "Background ◄ Solid ►" / "Gradient", a two-value toggle row
  (Left, Right and Enter all switch it). See "Gradient backdrop" below.
- Below Background, **Up next on Now Playing** (`#settings-np-upnext-row`,
  v3.10-fix2 F2): "Up next on Now Playing ◄ Show ►" / "Hide", the same
  two-value toggle row, stored in `sonance-np-upnext`. See "Up Next hidden".
- About card reads `V3.11` and the platform (v3.11, D164).
- Focus: rows and buttons take the focus fill (toggle rows no longer use an
  outline); swatches keep their white ring (D74).

## Smooth scrolling (v3.10 R1.8, D58) — as built in S5

Settings → Advanced → "Smooth scrolling (experimental)", stored in
`sonance-exp-smooth-scroll` (`on`/`off`), **default Off**, applied at load
and live (`SonanceUtils.setSmoothScroll`). On, `<html>` carries
`smooth-scroll` and every scroller gets `scroll-behavior: smooth`, so the
focus-follow's `scrollTop` writes animate (a one-row step at 150 % passes
through about 16 positions in 0.3 s, measured). Page and in-screen ghosts
keep `auto`: the scroll offset a ghost copies must hold at the first frame
(D98). Off because it is a compositor question: the user compares the
overlay's FPS with it off and on, on the TV (checklist).

## Performance overlay (v3.10 R1.1, `js/perf-hud.js`, :end of stylesheet)

A diagnostic readout, not part of the visual design. Off by default
(Settings → Advanced). When on: fixed top-left (8px, 8px), z-index 10000,
`pointer-events: none`, `rgba(30,30,38,0.95)` panel (the dialog surface),
`--text-primary` 14px/600 tabular figures, radius 8px, three lines:
`FPS n  worst n ms` / `key n ms  long n` / `els n  <screen>`. Text-only,
refreshed at 2 Hz; nothing animates.

## Transitions (v4, R2, D52/D53) — as built in S4

Page transitions animate `transform` and `opacity` only, each at most
0.25 s, with one easing, `cubic-bezier(.2,.8,.2,1)` (a fast start that
settles: ticket §6.4 gives it for the slide; S4 uses it for zoom, rise and
sink too, D91). The incoming layer is the new `#page-current`; the outgoing
one is a `.page-ghost` (the old layer, kept for the length of the
transition).

| Transition | When | Incoming | Outgoing (ghost) |
|---|---|---|---|
| Slide | top-nav dwell (below); Back from a Now Playing reached by the nav | `translateX(±8rem)`, opacity 0 → `translateX(0)`, 1 over 0.22 s | → `translateX(∓8rem)`, opacity 0, 0.22 s |
| Zoom in | Enter on a card or row → album / artist; `zoomContent` → playlist or genre detail | `scale(0.86)`, opacity 0 → `scale(1)`, 1 over 0.25 s | → `scale(1.08)`, opacity 0 over 0.2 s |
| Zoom out | Back from those | `scale(1.08)`, opacity 0 → `scale(1)`, 1 over 0.25 s | → `scale(0.86)`, opacity 0 over 0.2 s |
| Rise | Now Playing opened from the bar, by Auto Now Playing, or from the Queue's Now Playing card | `translateY(6rem)`, opacity 0 → `translateY(0)`, 1 over 0.25 s, above the old page | stays still under it and fades 1 → 0 over 0.25 s (v3.10-fix2 F1, D152; it used to stay at full opacity and vanish at the end); removed at the end |
| Sink | Back from a Now Playing that rose | in place, under the ghost, fading 0 → 1 over 0.25 s (F1, D152; it used to appear at once) | → `translateY(6rem)` over 0.25 s, opacity 0 over 0.2 s |
| Library tab change | sub-nav dwell (below) | opacity cross-fade 0.15 s (unchanged) | |
| Login → app | sign-in | unchanged: login `scale(1.15)` 0.4 s; app `scale(0.95)` → 1, 0.3 s | |

**Zoom origin (D53, D92).** Both layers of a zoom take `transform-origin` =
the centre of the focused element's drawn box (`getBoundingClientRect`, so a
card's 1.12 and a row's left-anchored 1.02 are included), in the incoming
layer's coordinates. For a page zoom that is `#page-current`; for
`zoomContent` it is the container being swapped. The origin is stored with
the history entry (page zoom) or the container (in-screen detail), and Back
zooms out into it. With no focused element inside the layer (a mouse
click), the origin is the layer's centre.

**Interruptible (R1.2, D52, D87).** There is no input lock. A new
navigation finishes the running transition instantly — ghost removed (an
in-screen ghost first releases its lazy images, the D17 teardown), inline
`transform`, `opacity`, `transition`, `transform-origin` and `will-change`
cleared — and then starts its own. At most one ghost exists, and no key
press is dropped.

**The ghost keeps its layout (D98).** A page ghost is the old layer with its
id removed and `page-ghost` added; it keeps its other classes, and the
stylesheet has a ghost twin of every `#page-current` layout rule (padding,
the 160rem centring, the Now Playing full-bleed rules), so its content does
not move at the first frame. When Now Playing comes or goes,
`#page-container` changes its top and bottom; the ghost is pinned to the
box it had. An in-screen (`zoomContent`) ghost copies its container's
classes and scroll offset. Before S4 every ghost jumped by the page padding
(−72, −42 px at 150 %) or by the nav height.

## Launch splash (v3.10 R11, ticket §6.7) — S7

Written before the CSS (S7 T2). Mockup 14.

- **Where.** Static markup at the top of `<body>` in `index.html` (and
  `tests/mock-index.html`), its `<style>` in `<head>` after the Interface
  size script, and a small inline script after `#app`; all outside
  `BEGIN/END:JS_SCRIPTS`, so `build.sh` keeps them and the splash paints
  before the bundles parse. Lengths are rem, so it is drawn at the stored
  interface size (the size script runs first). The inline script applies the
  stored accent (`--accent`, `--accent-rgb`) before the first paint, so the
  tile does not change colour when the bundle's `App.applyAccentColor` runs.
- **Look.** `#splash`: fixed, inset 0, above everything (z-index 10001),
  `radial-gradient(ellipse at 50% 45%, var(--bg-main), var(--bg-primary) 75%)`.
  `.splash-logo`, centred column:
  - `.splash-tile` 26.4rem square, radius 6.6rem, the brand gradient
    `linear-gradient(135deg, var(--accent), #8a4dff)` (the login tile's),
    glow `0 2rem 8rem rgba(var(--accent-rgb), 0.45)`; the S-wave SVG
    (`js/app.js` `_createLogoSvg`'s seven paths) at 16rem;
  - "Sonance" 10rem / 700, `--text-primary`, 0.2rem tracking, 3.6rem above;
  - "BY SIMMO" 2.6rem / 600, uppercase, 1rem tracking, `--text-secondary`,
    1.2rem above.
  At the 150 % default the tile is 396 px (mockup 14 draws about 400).
- **Timeline** (CSS `@keyframes` only; transform and opacity only):

  | Animation | On | Duration | Keyframes | Easing |
  |---|---|---|---|---|
  | `splash-in` (grow + hold) | `.splash-logo` | 900 ms | 0 % `scale(0)`, 0 → 50 % (450 ms) `scale(1)`, 1 → 100 % the same | grow `cubic-bezier(.2,.9,.25,1.15)`; the hold is still |
  | `splash-out` (exit) | `.splash-logo` | 500 ms | `scale(1)`, 1 → `scale(1.4)`, 0 (v3.10-fix2 F6, D160; was 2.2: the logo and its glow re-rastered at 2.2× as the exit began) | `cubic-bezier(.2,.8,.2,1)` (R2's) |
  | `splash-fade` (exit) | `#splash` | 500 ms | opacity 1 → 0 | `cubic-bezier(.2,.8,.2,1)` |

  The hold is the second half of `splash-in`, so "the hold has elapsed" is
  that animation's `animationend` on the splash's own timeline (a 2 s timer
  stands in if the event never comes).
- **Exit** starts (`#splash.splash-exit`) when the hold has elapsed **and** the
  first screen is in the DOM (`#app .login-screen` or `#page-current > *`,
  watched by a `MutationObserver` on `#app`), or at 6 s whatever happens.
  The node is removed on `splash-fade`'s `animationend`, or 800 ms after the
  exit started. Total about 1.4 s when the first screen is ready in time.
- **Keys.** A capture-phase `keydown`/`keyup` listener on `window` swallows
  every key while the splash is in the DOM; removing the splash removes it.

## Gradient backdrop (v3.10 R10, ticket §6.6) — S7

Written before the CSS (S7 T2). Mockups 12 (Home) and 13 (Settings).

- Settings → Appearance → "Background ◄ Solid / Gradient ►" (see
  "Settings"), stored in `localStorage['sonance-backdrop']` (`solid` /
  `gradient`), **default Solid**. On = the `backdrop-gradient` class on
  `<html>`, set when `js/app.js` loads (before the shell renders) and live by
  the row.
- One layer, `#app-backdrop`, the first child of `.app-layout` (built in
  `_showAppShell`): absolute, inset 0 in the full-viewport `.app-layout`,
  `pointer-events: none`, painted under `#page-container` by document order
  (no z-index), `display: none` unless `html.backdrop-gradient`. With Solid
  there is no layer at all. Not `position: fixed` (D130): fixed, Chromium
  composited it as its own 1920×1080 layer and the colour-hint bar with it
  (+2 layers at rest, CDP LayerTree); absolute, it paints into the root
  layer and the count equals Solid's.
- Background, in this order:
  `radial-gradient(ellipse at 12% -12%, rgba(var(--accent-rgb), 0.42), rgba(var(--accent-rgb), 0) 62%)`,
  `radial-gradient(ellipse at 100% 115%, rgba(var(--backdrop-violet-rgb), 0.40), rgba(var(--backdrop-violet-rgb), 0) 60%)`,
  `linear-gradient(180deg, var(--backdrop-top), var(--backdrop-bottom))`.
  Each radial ends in its own colour at alpha 0 rather than `transparent`,
  so a non-premultiplied gradient (Chromium 63 is not confirmed either way)
  cannot fade through grey. `--accent-rgb` makes it follow the accent live.
- No animation, no `will-change`. The page layers are transparent, so it
  shows behind every menu screen and behind a page and its transition ghost
  alike; slides and zooms move over it.
- **Not on Now Playing or Login.** Login is drawn before the shell exists,
  so there is no layer. With the gradient on, Now Playing gets an opaque
  base, `html.backdrop-gradient .np-screen { background: var(--bg-main) }`
  (the colour that shows through it with Solid), so the layer is covered
  and a rise or sink does not flash it. Scoped to Gradient (D132): painted
  there rather than on `#app`, the blurred backdrop blends up to 2/255
  differently (measured at 100 %), and Solid stays exactly as before.

## Playlist cards (v3.10 A3) — S7

Written before the CSS (S7 T2). Mockup 15.

- **Art + label cards** in the Playlists grid and the Home "Your Playlists"
  row (they were 23rem gradient tiles with the name inside). The art is
  `playlist.coverArt` (Navidrome's collage) through `getCoverArt`, lazy;
  under it, and alone when there is no `coverArt`, today's gradient
  (`linear-gradient(135deg, hashColor(name).base, var(--bg-card))`) with the
  playlist glyph at 30 % white. `SonanceComponents.renderPlaylistArt`.
- **Grid:** `.playlists-grid` 4 columns (`repeat(4, 1fr)`, was 3), `grid-gap
  3.2rem 2.4rem`, padding `3.2rem 2.8rem 2.4rem` (the top was 2.4rem: the
  first row's focused ring rose 2.6–3.1 px past it at 100–125 %, D76); the
  art is square (`.playlist-card-art`, radius 1.4rem), 318 / 396 / 368 px
  wide at 100 / 150 / 200 % (the grid's 140rem max width over 4 columns);
  request size 400, not scaled (the cell is set by the columns, not the
  interface size).
- **Home row:** the card is 16.2rem wide like `.album-card`, art 16.2rem,
  request bucket 180 scaled (`artSize(180)`, the Home cards' bucket).
- **Labels** under the art: name 1.5rem / 500 `rgba(240,240,245,.72)`, "N
  songs · 1 h 7 min" 1.3rem `--text-secondary`; centred in the grid, left in
  the Home row (as the album cards beside it).
- **Focus (R6, D73):** the card `scale(1.12)`; the ring and the deep shadow
  move from the tile to `.playlist-card-art`; the name `#fff` 700.

## Home rows (v3.10 A4) — S7

Written before the CSS (S7 T2). Mockup 18.

- Order: hero, Recently Added, Recently Played, **Your favourites**
  (`getAlbumList2 type=starred`), **Most played** (`frequent`), Your
  Playlists, **Rediscover** (`random`). Six album cards each, the same
  `.album-card` as Recently Added.
- A new row's section is in the DOM from the first render but `display:
  none`, and shows only when its list arrives non-empty. Its request goes
  out two frames after `activate`, after the first paint (R1.4; D123's
  reason for two). Responses are checked against Home's activation
  generation (D88).
- Zones `home-favourites`, `home-frequent`, `home-rediscover`, chained in
  screen order; the last row present is the NP bar's up neighbour. A row
  that lands above the focused one moves the scroll by its height, so the
  focused card stays where it was.

## Options sheet (v3.10 A5) — S7

Written before the CSS (S7 T2). Mockup 17.

- **Opened by holding OK** on a track row (album, playlist, Songs, genre
  songs, Search songs, Queue) or an Up Next tile; see "Hold-OK" below.
- **Scrim** `.options-sheet`: fixed, inset 0, `var(--scrim)`, z-index 9000
  (under the exit dialog's 9999), fades in over 0.2 s.
- **Panel** `.options-sheet-panel`: 42rem wide, 4.8rem from the right edge,
  vertically centred, at most `calc(100vh - 8rem)` tall; the dialog surface
  `rgba(30,30,38,0.95)`, radius 2.4rem, padding 2.4rem 2rem, the drop shadow
  `0 0.8rem 2.4rem rgba(0,0,0,0.4)`; enters from `translateX(4rem)`, opacity
  0, over 0.2 s with R2's easing.
- **Header:** 8rem cover (radius 0.8rem), title 2.2rem / 700, artist 1.6rem
  `--text-secondary`, both ellipsised; a hairline under it.
- **Actions** `.options-sheet-item`: a 2.2rem icon in `--text-secondary` and
  a 1.8rem / 500 label, padding 1.2rem 1.6rem, radius 1.2rem. In order:
  (Queue rows: Play now), Play next, Add to queue, Add to / Remove from
  favourites, Go to album, Go to artist, Start radio from this song (only
  when `getSimilarSongs2` gives at least 5; it appears when the answer
  comes), Show credits, (Queue rows: Remove from queue). Focused: the row
  focus (R6), fill, ink on label and icon, `scale(1.02)` from the left. The
  list scrolls when it is taller than the panel, with room for the scale
  (D76: 0.4rem above and below, 1.2rem on the right).
- **The row it opened on** keeps the focus fill under the scrim
  (`.is-options-origin`, mockup 17), so it is clear which song the sheet is
  for.
- **Credits view:** "Show credits" swaps the list for R7's sections
  (`.credits-section`, `.credit-row`; the label column 15rem here, 22rem on
  Now Playing). Since v3.10-fix2 F3 (D154, D155) no row is a focus stop:
  the sheet's zone holds the body alone, Up/Down scroll it by a third of
  its visible height with the scroll indicator on its right edge (Now
  Playing's rules), and a body that fits does not scroll. Back returns to
  the actions, on "Show credits".
- **Back** closes the sheet and puts focus back on the row it came from.

## Hold-OK (v3.10 A5) — S7

`FocusManager` (`js/focus.js`): on a zone with `onLongPress` (and, where
some items have no sheet, a `hasLongPress(idx)` filter), OK becomes
press-and-release aware (ticket A5's table): a short press activates on
keyup; holding opens the sheet after 500 ms once two auto-repeats have come,
or on release after 500 ms without repeats; with no keyup and no repeats by
1,200 ms it is a normal activation. Every other zone keeps activation on
keydown. No visual of its own.

## Album art placeholder (no artwork)

- Gradient background from the album/artist colour, with subtle radial
  gradient overlays for depth.
- Vinyl record mark (concentric rings) centred, white at 25% opacity, sized to
  45% of the tile. **V3.9 T5: drawn by CSS, not SVG.** `.art-placeholder-vinyl`
  carries a `::after` `radial-gradient(circle closest-side, …)` (:1603-1620)
  whose hard colour stops reproduce the previous SVG's ring radii exactly —
  SVG `r` 42 / 34 / 26 / 8 at `stroke-width` 1.5 become 3%-wide bands centred
  on 84 / 68 / 52 / 16 % of the gradient's closest-side extent, and the filled
  `r`-4 centre dot becomes a 0–8 % disc. There is no DOM inside the
  placeholder. The previous per-card `<svg>` + five `<circle>` build cost 28
  `setAttribute` calls per album card and was rebuilt on every virtual-grid
  recycle.
- Border-radius: 10px for large (>100px), 6px for small.
- Artist avatar placeholder: circular, gradient from the artist colour, person
  silhouette SVG at 30% opacity.

## Launcher icons (v3.10 R12, D59)

- `icon.png` — 256×256 square, gradient tile with the S-wave mark. Packaged in
  `Sonance3.wgt`.
- `icon-oblong-1920.png` — 1920×1080, opaque RGB, full-bleed: the S-wave tile
  (440px, radius 104px, brand gradient) and the "Sonance" wordmark (216px/700,
  `#f0f0f5`) over "BY SIMMO" (52px/600, 14px tracking, `#8e8ea0`), centred on a
  flat `#0a0a0c` ground inside the central 80%. Source
  `tests/tools/icon-oblong-1920.html`, built by
  `tests/tools/make-oblong-icon.js`. Packaged as `icon.png` in
  `Sonance3-Oblong.wgt`.
- `icon-oblong.png` (512×423, rounded, transparent) is a Seller Office store
  asset and is not used by either package.
- The wide tile is confirmed on the Q90R (v3.11, D163). The v3.10-fix2
  diagnostic package (`Sonance3-Oblong-Diag.wgt`, D161) was not needed and
  is no longer built.

## Known discrepancies

- **Dead `album-active` (found in S3, D82).** `album.js` and `artist.js` add
  `album-active` to `#content-area`, an id that no longer exists (the page
  layer is `#page-current`), and `#page-current.album-active > .page-content`
  matches nothing. Neither does anything. The album and artist roots get
  `height: 100%` directly instead. Reported, not removed.
- **175–200 %: panels taller than the page (D84 → D108, fixed in S5).** The
  album and artist left columns and the search keyboard's panel scroll with
  the focus at those sizes (each is `overflow-y: auto`, positioned, with
  bottom padding for the last button's focus scale; `.search-left` also has
  1.2rem of content-box padding on the right, cancelled by a negative margin,
  because a scroller clips both axes). The Queue's Now Playing card is one
  focus target, so it cannot be scrolled into view whole: its art is capped
  at `calc(100vh - 40rem)`, which is larger than the art below 175 %. The
  focus-clip sweep is 0 at 100–200 % (96 states per size).
- **Now Playing at 175–200 % with Up Next (S6, D122).** The column cannot
  clear both the top nav and the strip there with a usable cover, so it gives
  up the nav's room (`.upnext-tight`): for the 5 s the nav shows on arrival,
  it covers the top of the cover (324 px at 175 %, 216 px at 200 %). Before
  S6 the column already reached under the nav at those sizes. Mockup 19 is
  drawn at 150 %, where everything fits.
- **Back and the lyrics panel (S6, D119).** Back closes the credits panel
  before it leaves Now Playing (R7); with lyrics open it still leaves Now
  Playing, as before. Left for the user to decide.
- **Zoom scale and the new transitions (S4, R2).** `CLAUDE.md` "Transitions"
  still says the incoming page of a zoom starts at `scale(0.92)` and names no
  rise or sink. Ticket §6.4 (R2) sets 0.86, the 8rem slide, the easing, rise
  and sink, and that is what ships ("Transitions" above). Ticket §5.5 lists
  the CLAUDE.md amendments this version may make, and "Transitions" is not
  one of them, so `CLAUDE.md` was left as it is and the difference is
  reported for the user to settle.
- **Content width.** `CLAUDE.md` says content is `max-width: 1400px`; the CSS
  uses **1600px** on `#page-current > *` (:468-472). 1400px is only
  `.playlists-grid`. The CSS is what ships. Recorded, not changed
  (ticket-3.10 §5.5).
- **Focus rings (S3, R6, D50).** `CLAUDE.md` banned border/outline/box-shadow
  focus rings. Since S3 (ticket-3.10 §5.5) the card ring is a box-shadow and
  is allowed **for cards only**; no focus rule uses an outline. The one
  remaining border focus is the accent swatch's white ring (D74).
- **Focus transforms clipped by their container.** S2 measured five with
  `e2e/helpers/geometry.js` `focusClip` (artist discography row 40 px at
  100 %, swatch 0 2.7 px, Logout 2.1 px, key A 1.9 px, Queue row 5.8 px at
  150 %). S3 gave each container room (D76, "Focus" above); the S3 entry in
  `PROGRESS.md` has the before/after table at 100/150/200 %.

---

# Part 2 — v4 targets (v3.10) — all landed (S7)

Copied from `tickets/ticket-3.10.md` §6. Each moved to Part 1 when its
session landed it; since S7 nothing here is pending.

## Interface size (R4) — landed in S2

Moved to Part 1, "Interface size (v3.10 R4, D49) — as built in S2".

## Focus — "stronger pink" (R6) — landed in S3

Moved to Part 1, "Focus (v4, R6, D50) — as built in S3".

## Transitions (R2) — landed in S4

Moved to Part 1, "Transitions (v4, R2, D52/D53) — as built in S4", with the
dwell (D51) in "Top nav" and "Library sub-nav".

## Now Playing backdrop (R8) — landed in S6

Moved to Part 1, "Now Playing" (the backdrop line).

## Gradient backdrop (R10) — landed in S7

Moved to Part 1, "Gradient backdrop (v3.10 R10, ticket §6.6)", with the
Settings row in "Settings".

## Splash (R11) — landed in S7

Moved to Part 1, "Launch splash (v3.10 R11, ticket §6.7)".

## New surfaces — landed in S5 / S6 / S7

Landed in S3 (Part 1, "Rows"): the artist line on every track row (R5) and
playlist rows with thumbnails. Landed in S5 (Part 1, "Library headers, chips
and the Songs list"): the Albums header with Sort/Filter chips (A2, mockup
20) and the full Songs list (A1, mockup 16). Landed in S6 (Part 1, "Now
Playing credits, Up Next and the sleep timer"): the credits panel (R7,
mockup 10) and the Up Next strip with its sleep-timer chip (A6/A7, mockup
19); the "Resume last queue" row is in Part 1 "Settings". Landed in S7
(Part 1): playlist cards with cover mosaics (A3, mockup 15, "Playlist
cards"), the extra Home rows (A4, mockup 18, "Home rows") and the hold-OK
options sheet (A5, mockup 17, "Options sheet", "Hold-OK"). Nothing in Part 2
is pending. Mockups are `tickets/mockup-3.10-*.jpg`, a visual target only.

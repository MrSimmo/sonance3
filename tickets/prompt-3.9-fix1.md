# v3.9-fix1 — three reported regressions: oblong icon, NP blurred background, lyrics

Reported by the user 2026-09-04 after installing the v3.9 build on the Q90R:

1. "The oblong icon isn't oblong, it's square."
2. "The blurred background on the now playing screen doesn't show — it's just
   the background app colour."
3. "Lyrics in now playing do not highlight or scroll. Tested with the Fatboy
   Slim songs in Best of Album."

Only **one** of the three is a v3.9 regression. The investigation below is the
spec for what gets changed; the acceptance criteria were written before any
code was touched.

---

## R1 — the launcher icon cannot be oblong on Tizen

### Investigation

`icon-oblong.png` is not at fault. It decodes as a genuine 512 x 423, full-bleed
8-bit RGBA PNG (alpha bounding box 0..511 x 0..422, no transparent padding, no
interlace, standard filter types, standard zlib stream), and
`Sonance3-Oblong.wgt` stages it as `icon.png` with
`<icon src="icon.png" width="512" height="423"/>`. The packaging works exactly
as Session 1 intended.

The premise behind it does not. Two independent errors:

- **512 x 423 is a Samsung Apps Seller Office store-listing asset, not the
  launcher icon.** Samsung's own "App Icons and Screenshots" page describes the
  512 x 423 logo (and a 1920 x 1080 pair) as assets "registered in the official
  Samsung Apps Seller Office" and **never mentions `config.xml`**. `build.sh`
  and PROGRESS D4 both claimed the size was "referenced from the `config.xml`
  `<icon>` tag". It is not.
- **Tizen normalises the `config.xml` launcher icon to a square.** The
  documented launcher-icon size is 117 x 117, and the platform rescales whatever
  `<icon src>` points at into that square tile. A 512 x 423 source therefore
  arrives on the app row squashed by 512/423 = 1.21x horizontally — which is
  what "it's square" looks like.

Two further details confirm the direction: the `width`/`height` attributes on
`<icon>` are W3C-widget *icon-selection hints* for choosing between several
`<icon>` elements, not scaling directives, so declaring them changes nothing;
and Samsung specifies the 512 x 423 asset as 24-bit RGB, while ours is 32-bit
RGBA, so the file is not even valid for the Seller Office use it was cut for.

**This is not a regression.** Every build before v3.9 shipped the 256 x 256
square `icon.png` with a bare `<icon src="icon.png"/>`. The oblong variant is
new in v3.9 Session 1, was never installed on the TV, and is listed as unverified
in `docs/v3-9-report.md` §8 item 7.

### Requirement

The build produces one package whose launcher icon is square and undistorted.
No package ships an icon whose aspect ratio the platform will stretch.

### Acceptance criteria

- AC1.1 `./build.sh` produces `Sonance3.wgt` and **no** oblong variant.
- AC1.2 The `icon.png` inside `Sonance3.wgt` is 256 x 256 (square, ratio 1.000).
- AC1.3 `config.xml` in the package carries a bare `<icon src="icon.png"/>` with
  no `width`/`height` attributes.
- AC1.4 `build.sh` contains no `OUTPUT_OBLONG` / `OBLONG_ICON` code path and no
  comment claiming 512 x 423 is the `config.xml` icon size.
- AC1.5 `icon-oblong.png` is left on disk, unmodified. It is the correct size for
  a future Seller Office submission (which would additionally need 24-bit RGB).

---

## R2 — the NP blurred background: v3.9 T3 is the cause

### Investigation

The element renders, is positioned correctly and its image loads. Probed live on
the Now Playing screen at 1920 x 1080:

```
.np-bg-image  rect  x -480  y -270  w 2880  h 1620
              filter blur(10px) saturate(1.3)   transform matrix(6,0,0,6,0,0)
              backgroundImage getCoverArt.view?...&size=100   loads, 100x100
```

The v3.9 T3 geometry is arithmetically equivalent to v3.8's: a 25% box centred
at 50%/50% scaled 6x spans -25%..125%, the same overscan as the old
`top/left: -25%; width/height: 150%`. Rendered A/B on the same track with the
old rule injected as an override, mean pixel values over six 200 x 200 sample
regions are identical to within 1/255:

```
                  TL            TR            BL            BR            Lmid          Rmid
v3.9 (current)  [58,58,47]   [46,54,49]   [40,42,27]   [47,55,44]   [58,35,26]   [50,55,50]
v3.8 (reverted) [58,58,47]   [46,54,48]   [40,42,26]   [47,55,44]   [58,35,25]   [50,55,49]
```

So the browser **cannot reproduce the fault**, and the two rules are visually
interchangeable there. That is the finding, not an absence of one: the only thing
v3.9 changed about this element is a compositor trick — `filter: blur(10px)` on a
25% box promoted with `translateZ(0)` and scaled 6x — whose correctness depends
entirely on how the engine picks a raster scale for a filtered, transformed,
composited layer. Chromium 63 predates Composite-After-Paint. The trick is
unverifiable anywhere except the Q90R, and on the Q90R it renders nothing.

T3's own measurement was a one-off cost on a screen that opens once per session
(a 0.13 Mpx raster instead of 4.67 Mpx, per `docs/perf-baseline.md`). It bought a
saving the user cannot perceive and cost the feature outright.

### Requirement

The Now Playing screen shows the blurred album art behind the transport controls
on Tizen 5.0. The blur is expressed with properties whose behaviour on Chromium
63 is already proven by a shipped build.

### Acceptance criteria

- AC2.1 `.np-bg-image` carries no `transform` and no `translateZ`.
- AC2.2 The blur radius is expressed at full scale (`blur(60px)`), the box is the
  150% overscan box, and the element's rect is 2880 x 1620 at (-480, -270) —
  unchanged coverage.
- AC2.3 Rendered pixels are unchanged from the current build in a modern browser
  (this revert must not alter what already works there).
- AC2.4 The packaged stylesheet still passes the build's Tizen gate (no
  `backdrop-filter`, no `transition: all`, no bare `gap:`).

---

## R3 — the Fatboy Slim lyrics are unsynced; the scroller is not broken

### Investigation

`LyricsScroller` works. Probed live against the test server with a track that
has synchronised lyrics (Oasis, "Wonderwall", 51 lines, first timestamp
24 390 ms):

```
open, t=6s    active -1   past 0    upcoming 51   translateY(0px)
seek 40s      active  5   past 5    upcoming 45   translateY(-174.26px)
seek 90s      active 19   past 19   upcoming 31   translateY(-1120.26px)
```

Highlighting and scrolling both work, including the V3.9 T2 partial-class-rewrite
path.

Every track on Fatboy Slim, "The Best Of" (`2EOTdJv6iExLtmqVbhaFS6`, 30 songs)
returns unsynchronised lyrics. Navidrome has the words but no timestamps —
`structuredLyrics[0].synced` is `false` and the lines carry `value` with no
`start`:

```
Right Here, Right Now       synced false   92 lines    first {"value":"Right here, right now"}
The Rockafeller Skank       synced false  145 lines    first {"value":"Right about now"}
Praise You                  synced false   28 lines    first {"value":"We've come a long, long way together"}
Weapon of Choice            synced false   84 lines
Gangster Trippin            synced false  150 lines
```

The same probe found synced lyrics elsewhere in the library (Oasis
"Wonderwall", Eagles "Hotel California"), so this is per-track metadata, not a
server or client capability problem.

With no timestamps there is nothing to highlight — `update()` correctly
early-returns on `!this._synced` — and nothing scrolls either:

```
The Rockafeller Skank, panel open:  145 lines, all bare .lyrics-line,
                                    active -1, translateY(0px), unchanged at
                                    every playback position
```

145 lines at 36px in a 777px viewport is about 7 lines visible. **The remaining
95% of the lyric is unreachable by any input.** `LyricsScroller.scrollBy()`
exists but nothing calls it — confirmed dead in the pre-v3.9 April bundle too
(one occurrence, its own definition), so v3.9 did not remove a caller.

**This is not a regression either**, but it is a real defect: an unsynced lyric
is a static, unreadable wall rendered at 50% opacity with no indication that
anything more exists.

### Requirement

Per-line highlighting of unsynchronised lyrics is **out of scope and not
possible** — there is no timing information to highlight against. What the
screen must do instead:

- An unsynchronised lyric scrolls through its full length as the track plays, so
  every line becomes readable without input.
- Its lines are rendered at full legibility, since none of them can be marked
  active.
- Synchronised lyrics behave exactly as they do today.

### Acceptance criteria

- AC3.1 On an unsynced track, the lyric container's `translateY` advances from 0
  toward its maximum scroll as playback progresses, and reaches the bottom of the
  lyric by the end of the track.
- AC3.2 The offset is clamped: never above 0, never past
  `scrollHeight - clientHeight`.
- AC3.3 A lyric shorter than the viewport does not scroll at all.
- AC3.4 Unsynced lines render at full opacity and full white; synced
  `upcoming`/`past`/`active` styling is untouched.
- AC3.5 On a synced track the measured active-index and translateY progression
  above is reproduced unchanged.
- AC3.6 The progress handler performs no style write on a tick where the rounded
  scroll target has not moved (v3.9 is a performance release; `_onProgress` runs
  at 2-10 Hz).
- AC3.7 No `?.` / `??` in the sources or the minified bundles; `node --check`
  clean.

---

## Decisions to record in PROGRESS.md

- **D46** supersedes **D4** — the oblong icon is abandoned, with the two
  documentation errors named.
- **D47** supersedes the `.np-bg-image` half of **v3.9 T3** — reverted; a
  compositor trick that can only be validated on the target device is not worth a
  one-off raster saving on a screen that opens once.
- **D48** — unsynced lyrics scroll proportionally to elapsed time. Rejected
  alternatives: leaving them static (95% of a 145-line lyric unreachable), and
  wiring `scrollBy` to the d-pad (needs a new focus zone on a screen whose zone
  shape is deliberately fixed at `columns: 7`, per V3.7-fix29 Bug 1).

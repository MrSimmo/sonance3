# Sonance — Performance Baseline (v3.8)

Captured 2026-09-03, **before** any v3.9 code change, by Session 1 of the v3.9
programme (`tickets/prompt-3.9.md`). Later sessions re-measure against this
file, so every row records the exact method.

## Measurement environment

| | |
|---|---|
| Harness | Playwright 1.62.1, Chromium headless, Node API driven from Bash |
| Viewport | 1920 × 1080, `deviceScaleFactor: 1` |
| CPU | throttled **6×** via CDP `Emulation.setCPUThrottlingRate` |
| Browser flags | `--enable-precise-memory-info`, `--js-flags=--expose-gc` |
| App build | `./build.sh --dev` (unbundled sources), v3.8 code |
| Fixture rig | `tests/mock-index.html?mockAlbums=…&mockArtists=…&mockSongs=…` |
| Static + media server | `node tests/dev-server.js 8081` |
| Input | **keyboard only** — `ArrowUp/Down/Left/Right`, `Enter`, `Escape` |

**Two environment notes that later sessions must carry forward.**

1. **Port 8081, not 8080.** Port 8080 is occupied on this machine by OrbStack.
2. **`node tests/dev-server.js`, not `python3 -m http.server`.** `<img>.src` and
   `<audio>.src` never pass through `window.fetch`, so the fetch mock in
   `tests/mock-boot.js` cannot serve cover art or audio at all. The dev server
   serves the static files *and* synthesises `/rest/getCoverArt.view` (a real
   PNG with `Cache-Control: public, max-age=3600` + `ETag`) and
   `/rest/stream.view` (a real 20 s WAV with Range support). Without it the
   `fromDiskCache` row below and any playback check are unmeasurable.

**Caveat on raster numbers.** Headless Chromium rasterises on the CPU in a
software compositor. Paint/raster millisecond figures are a *relative*
indicator for before/after comparison on the same harness, not a prediction of
the Q90R's GPU cost. Where a number is only comparative, it says so.

---

## 1. Library → Albums grid at scale

Rig: `?mockAlbums=1200&mockArtists=2000&mockSongs=14000`. Reached by keyboard:
`ArrowRight` on the top nav (Home → Library, auto-navigate on slide), then
`ArrowDown` into `library-grid`.

Traversal is a **serpentine d-pad walk** — Right along a row, Down, Left back,
Down — because `FocusManager.moveFocus` (`js/focus.js`) does not wrap: Right at
the end of a row hits the zone's `right` neighbour and stops, and Down past the
last loaded row hands focus to `nowplaying-bar`. Grid is 8 columns.

| Measurement | v3.8 baseline | Method |
|---|---|---|
| DOM `.album-grid-card` after reaching the end | **1200** (unbounded — every card stays mounted) | `document.querySelectorAll('.album-grid-card').length` |
| Elements under `#app` at the end | **15 647** (≈ 13 per card) | `document.getElementById('app').getElementsByTagName('*').length` |
| `<img>` elements at the end | **1200** | `document.querySelectorAll('img').length` |
| JS heap after full traversal | **5 415 366 B (5.16 MB)** | `performance.memory.usedJSHeapSize` after two `window.gc()` calls |
| Keypresses to traverse | 1104 over 138 rows, **35 s** of wall clock at 6× throttle | serpentine walk |

### `querySelectorAll` per 10 keypresses (T5's target)

Ten `ArrowRight` presses from column 0, with `Document.prototype.querySelectorAll`
and `Element.prototype.querySelectorAll` wrapped to record call count, the
selector, and the number of nodes each call returned.

| Grid size when probed | qsa calls | **nodes returned** | Attributed selector | Wall clock for 10 presses |
|---|---|---|---|---|
| 50 cards | 9 | 404 | `#library-grid .focusable` ×8, `.library-subnav-item` ×1 | 1546 ms |
| 600 cards | 7 | **4200** | `#library-grid .focusable` ×7 | 1545 ms |
| 1200 cards (`hasMore` now false) | 0 | 0 | — | 1678 ms |

This is the "degrades the further you go" mechanism, quantified: the call count
per 10 keypresses is flat (~7–8, one per rAF-coalesced `onFocus`), but the
**nodes matched grows linearly with the grid** — 404 → 4200 as the grid goes
50 → 600 cards. It is the node count, not the call count, that costs.

Calls drop to **0** at 1200 cards only because `_albumLoader.hasMore` has gone
false and the pagination branch at `js/screens/library.js:586-589` is skipped
entirely. **The 600-card row is therefore the comparison point for T5**, not the
1200-card row.

`getBoundingClientRect` calls per 10 keypresses: **0** at every grid size.
`LayoutCount` delta: 0–1. `RecalcStyleCount` delta: 38–48.

---

## 2. Now Playing backdrop

Rig: `?mockAlbums=40&mockArtists=20&mockSongs=200`, CPU 6×. Reached by keyboard:
Library → `Enter` on an album card → `Enter` on track 1 (starts playback) →
top nav → Now Playing.

`.np-bg-image` as computed on screen, v3.8:

| Property | Value |
|---|---|
| Box | **2880 × 1620 px** (4.67 megapixels) |
| `filter` | `blur(60px) saturate(1.3)` |
| `transform` | `none` |
| Source bitmap | 100 px cover (`js/screens/nowplaying.js:992`) — upscaled ~29× |

Chromium timeline trace (CDP `Tracing`, categories `devtools.timeline`,
`disabled-by-default-devtools.timeline`, `blink`, `cc`, `benchmark`), totals in
milliseconds:

| Traced action | Paint | RasterTask | Layout | UpdateLayoutTree |
|---|---|---|---|---|
| Open Now Playing | 11.33 ms / 33 ev | 20.85 ms / 47 ev | 7.10 ms / 13 ev | 11.46 ms / 33 ev |
| **3 track changes** | 16.74 ms / 76 ev | **133.57 ms / 153 ev** | 23.46 ms / 34 ev | 33.03 ms / 70 ev |

Track changes were driven with `Player.next()` (a transport action, not a
navigation), 2.8 s apart. The progress bar ticks throughout both traces, so it
contributes to both equally and cancels in the before/after delta.

**These two rows are single runs.** Repeat measurement showed run-to-run
variance of up to 2× on this trace, so the authoritative v3.8 figure for the
3-track-change case is the **median of 5** recorded in the T3 section below
(RasterTask 67.52 ms, range 46.12–73.42). Compare against that, not against the
133.57 ms single run here.

Screenshot (before): `screenshots/v3-9/s1-v38-baseline-np-open.png`

---

## 3. Cover art and the HTTP disk cache

Rig: `?mockAlbums=200&mockArtists=100&mockSongs=500`, no CPU throttle.
CDP `Network` domain; `getCoverArt` responses inspected for
`response.fromDiskCache`.

**Load 2 must be a fresh page in the same browser context, not
`page.reload()`.** A Chromium reload revalidates: it marks the document *and
its subresources* `LOAD_VALIDATE_CACHE`, so cover art is refetched even when
cached and fresh. Verified directly against this dev server — a reload reports
0 `fromDiskCache` for a URL that a fresh page in the same context serves from
disk. Relaunching the app on the TV is a fresh document load, so a new page in
the same context (sharing the HTTP cache) is the faithful analogue of a cold
launch. The first attempt at this row used a reload and wrongly showed no
improvement.

### URL stability

Session 4 redacted the token and salt hex that originally stood in this block.
A Subsonic `t`/`s` pair is a **replayable credential** — the server accepts any
pair where `t == md5(password + s)` — so recording one in a tracked file hands
over account access regardless of how short the password is. The two pairs are
represented as placeholders below; only the fact that they *differ* was ever the
point. Credentials live in `TEST-ACCOUNT.local.md` and nowhere else (decision
D7), and that now includes derived tokens.

```
api.getCoverArtUrl('album-3', 300) called twice:
  A: …/rest/getCoverArt.view?u=<user>&t=<TOKEN-A>&s=<SALT-A>&…&id=album-3&size=300
  B: …/rest/getCoverArt.view?u=<user>&t=<TOKEN-B>&s=<SALT-B>&…&id=album-3&size=300
  TOKEN-A != TOKEN-B and SALT-A != SALT-B — a fresh 12-hex salt per call, so the
  URL was unique every time and the HTTP disk cache could never hit.
  identical: false
api.getStreamUrl('song-1') called twice — identical: false
```

| Measurement | Load 1 | Load 2 (fresh page, same HTTP cache) |
|---|---|---|
| `getCoverArt` responses | 53 | 53 |
| Distinct URLs among them | 53 | 53 |
| `fromDiskCache: true` | **0** | **0** |
| HTTP 304 | 0 | 0 |
| HTTP 200 | 53 | 53 |
| Cover URLs reused from load 1 | — | **0** |

Every cover URL carries a fresh `s=` salt and a recomputed `t=` token, so no
URL is ever requested twice and the disk cache can never hit — even though the
dev server sends `Cache-Control: public, max-age=3600` and an `ETag`.

---

## 4. Compositor layers held at rest

CDP `LayerTree`. `LayerTree.enable` on an idle page emits nothing, so the census
perturbs the tree (appends a `will-change: transform` probe element, then
removes it) and reads the snapshot that arrives *after* removal — that one is
the steady state.

### Library screen (50 album cards mounted)

| Measurement | v3.8 baseline |
|---|---|
| Layer count | **68** |
| Total composited pixels | **18 975 594** |
| Approx. layer memory at 4 B/px | **~72 MB** |

Ten largest layers:

| Size | Pixels | Attribution |
|---|---|---|
| 1420 × 1649 | 2 341 580 | `.library-content` — full scroll height. **Not** caused by `will-change`: it is `overflow-y: auto`, so Chromium composites it as a scroller regardless. Verified — the layer survives removal of the static hint (see the T4 A/B below). |
| 1920 × 1080 | 2 073 600 | `.page-layer` / `.page-ghost` static `will-change: transform, opacity` (`css/styles.css:421-437, 442-451`) |
| 1920 × 1080 | 2 073 600 | " |
| 1920 × 1080 | 2 073 600 | " |
| 1920 × 1080 | 2 073 600 | " |
| 1920 × 1000 | 1 920 000 | page container |
| 1920 × 1000 | 1 920 000 | " |
| 1420 × 952 | 1 351 840 | library content viewport band |
| 1420 × 952 | 1 351 840 | " |
| 1920 × 76 | 145 920 | now-playing bar |

The remaining ~58 layers are the album cards, each promoted by
`transform: translateZ(0)` (`css/styles.css:2056`). **That promotion is
deliberate** — it fixes a Chromium 63 glyph-cache ghosting artefact
(V3-6-fix3 GFX-1, V3.8-fix2) and must not be removed. Bounding the *number* of
cards is Session 2's job.

### Now Playing screen

| Measurement | v3.8 baseline |
|---|---|
| Layer count | **17** |
| Total composited pixels | **12 631 934** |
| Approx. layer memory at 4 B/px | **~48 MB** |

Six full-viewport 1920 × 1080 layers dominate.

---

## 5. Playback (browser HTML5 fallback)

Confirms the rig can verify playback, which T2's acceptance depends on.

```
Player.getState()  -> { isPlaying: true, queueLen: 10 }
<audio> currentTime 2.86 s -> 5.86 s over a 3 s wait
<audio> duration 20 s, readyState 4, paused false
```

AVPlay itself is untestable off-device; this is the HTML5 fallback path only.

---

## Reproducing

```bash
cd "/Users/agents/Agent Working Directory/sonance 3"
./build.sh --dev
node tests/dev-server.js 8081 &
# then the Session 1 measurement scripts (Playwright, Node API)
```

The measurement scripts for this baseline are session-scratch, not committed.
Each row above states the in-page expression or CDP domain it came from, which
is what makes it reproducible.

---

# Session 1 results (v3.9 T2–T5)

Same harness, same rigs. Where a "before" number needed to be re-measured with
a corrected method, the change under test was **temporarily reverted** so the
two sides are like for like; those rows say so.

## T2 — stable auth salt (`js/api.js`)

| Measurement | v3.8 | v3.9 |
|---|---|---|
| `getCoverArtUrl(id, 300)` twice → identical | **false** | **true** |
| `getStreamUrl(id)` twice → identical | **false** | **true** |
| Cover URLs reused on the next cold launch | **0 / 53** | **53 / 53** |
| `fromDiskCache: true` on the next cold launch | **0 / 53** | **53 / 53** |
| HTTP 200 (bytes over the wire) on cold launch 2 | 53 | 53 requests, all served from disk |

Both sides measured with the corrected cold-launch method (fresh page, shared
HTTP cache); the v3.8 side was captured with `_buildUrl` temporarily restored
to per-call salting.

Auth still correct — the salt is reused but the token is not:

```
sameUserSameSalt              : true
differentUserDifferentSalt    : true
tokenRecomputedForNewPassword : true
tokenAMatchesMd5('passA'+salt): true
tokenBMatchesMd5('passB'+salt): true
saltFormatOk (/^[0-9a-f]{12}$/): true
urlStableAcrossInstances      : true
```

Round trip: playback authenticates (`isPlaying: true`, `currentTime 5.84 s`,
`readyState 4`, stream URL carries a 32-hex token); logout clears
`sonance_logged_in` and returns to the login screen; re-login reaches the app
shell with `sonance_logged_in: "true"`. The salt is **deliberately retained
across logout** so previously cached art stays addressable.

### T2 verified against the LIVE Navidrome

Session 1 originally had to fall back to the mock for this row because
`SONANCE_USER` / `SONANCE_PASS` were unset. The user then supplied the test
account (stored only in `TEST-ACCOUNT.local.md`, gitignored), so the row was
re-run against the real server: bundled production build served from the dev
server, real login screen driven by keyboard, Library → Albums, then a relaunch
as a fresh page in the same browser context.

| Measurement | Launch 1 | Launch 2 (relaunch) |
|---|---|---|
| `getCoverArt` responses | 53 | 53 |
| Distinct URLs | 53 | 53 |
| **`fromDiskCache: true`** | **0** | **53 / 53** |
| Bytes over the wire | all 53 fetched | **0** |
| Cover URLs reused from launch 1 | — | **53 / 53** |

The auth scheme itself was confirmed directly against the server with a fixed
salt reused across two requests — exactly what v3.9 now does:

```
GET /rest/ping.view?u=…&t=<md5(pass+salt)>&s=a1b2c3d4e5f6&v=1.16.1&c=Sonance&f=json
  -> {"status":"ok","version":"1.16.1","type":"navidrome","serverVersion":"0.63.2 (be10f89c)","openSubsonic":true}
same salt + token, second request
  -> {"status":"ok", …}
```

Real Navidrome's cover-art response headers make the win larger than the dev
server showed — it sends a **ten-year** max-age and no `ETag`, so once the URL
is stable the art is never even revalidated:

```
HTTP/1.1 200 OK
Cache-Control: public, max-age=315360000
Last-Modified: Tue, 21 Apr 2026 12:19:00 GMT
Content-Type: image/jpeg
```

Two facts recorded for later sessions: CORS is wide open
(`Access-Control-Allow-Origin: *`), so a browser on `localhost` can drive the
real server; and the live Albums grid requests `size=300` for cards displayed
at ~145 px, confirming Session 3's 4.3× over-fetch finding.

Screenshots: `screenshots/v3-9/s1-live-albums-launch1.png`,
`…-launch2.png` — real library, real cover art, 50 cards, 8 columns.

**Caveat:** `encodedDataLength` on `Network.responseReceived` reflects headers
only at that point, so it is not a usable byte total; the "bytes over the wire"
row above is the count of non-cached responses, not a measured payload size.

## T3 — Now Playing blur raster (`css/styles.css`)

| Measurement | v3.8 | v3.9 |
|---|---|---|
| `.np-bg-image` box | 2880 × 1620 | **480 × 270** |
| Blurred region | 4 665 600 px | **129 600 px** (36× smaller) |
| `filter` | `blur(60px) saturate(1.3)` | `blur(10px) saturate(1.3)` |
| `transform` | `none` | `matrix(6, 0, 0, 6, 0, 0)` |

Paint/raster across **3 track changes**, CPU 6×, **median of 5 runs each**
(single runs vary by up to 2×, so medians and ranges are both given):

| Metric | v3.8 median | v3.8 range | v3.9 median | v3.9 range |
|---|---|---|---|---|
| **RasterTask total** | **67.52 ms** | 46.12 – 73.42 | **3.95 ms** | 2.22 – 4.43 |
| RasterTask longest single | 1.63 ms | 0.59 – 1.93 | **0.17 ms** | 0.04 – 0.17 |
| Compositor draws | 505 | 504 – 506 | **257** | 257 – 258 |
| Paint total | 11.85 ms | 5.14 – 16.65 | 11.16 ms | 8.13 – 13.83 |
| Layout total | 24.63 ms | 18.94 – 26.45 | 20.36 ms | 20.11 – 22.14 |
| UpdateLayoutTree total | 27.99 ms | 25.90 – 31.72 | 35.79 ms | 30.18 – 43.70 |

Raster falls **94%** with fully disjoint ranges, and compositor draws halve.
Paint and Layout are flat within noise. `UpdateLayoutTree` reads slightly
*higher* after the change; the ranges partly overlap and it is style-recalc
work, not raster, so it is reported as measured rather than claimed as an
improvement.

Visual equivalence, three cover aspect ratios (square, 3:2 landscape, 2:3
portrait — the dev server's `/__cover-aspect` switch), screenshots decoded and
differenced pixel by pixel:

| Aspect | Mean abs diff (0–255) | Pixels differing > 8 | Backdrop-only band mean | Viewport covered L/T/R/B |
|---|---|---|---|---|
| square | 0.670 | **0.00 %** | 0.751 | true / true / true / true |
| landscape | 0.703 | **0.00 %** | 0.688 | true / true / true / true |
| portrait | 0.665 | **0.00 %** | 0.863 | true / true / true / true |

The isolated max-channel differences (133–202) are the progress-bar knob and
the elapsed-time text, which advanced between the two captures — not the
backdrop. Screenshots read back and compared by eye as well: same softness,
same colour spread, no banding, no black edges at any aspect ratio.

Screenshots: `screenshots/v3-9/s1-v38-npblur-np-{square,landscape,portrait}.png`
vs `screenshots/v3-9/s1-v39-npblur-np-{square,landscape,portrait}.png`.

## T4 — static `will-change` removed (A/B, hint restored for the "before" side)

Library screen at rest, 50 album cards, CPU 6×:

| Measurement | static hint (v3.8) | dynamic hint (v3.9) |
|---|---|---|
| Compositor layers | **68** | **66** |
| Total composited pixels | **18 975 594** | **15 703 754** (−17.2 %) |
| Approx. layer memory @ 4 B/px | **72.4 MB** | **59.9 MB** (−12.5 MB) |
| `.page-layer` computed `will-change` | `transform, opacity` | `auto` |
| `.library-content` computed `will-change` | `opacity` | `auto` |
| Layers > 0.1 Mpx | 1420×1649, 1920×1080 ×4, 1920×1000 ×2, 1420×952 ×2, 1920×76 | 1420×1649, 1920×1080 ×4, 1920×1000, 1420×952, 1920×76 |

One 1920×1000 and one 1420×952 layer are gone. The 1420×1649
`.library-content` scroll-contents layer remains, as expected for an
`overflow-y: auto` element — see the corrected attribution above.

Transitions still smooth (single traces, CPU 6×; totals in ms):

| Transition | Paint before → after | Longest single event before → after |
|---|---|---|
| Page slide (top nav Left/Right) | 56.55 → 43.04 | 6.67 → 6.44 |
| Zoom-in (Enter into album) | 29.60 → 22.03 | 7.87 → 7.93 |
| Zoom-out (Back) | 37.52 → 28.59 | 6.09 → 4.66 |

No new long frames. The tab cross-fade still works and the hint is now scoped
to it: mid-fade `.library-content` computed `will-change` is `opacity` with
computed opacity 0.85 (fade in flight); once settled it is `auto` with opacity
1 and 72 artist cards mounted. Before the change it stayed `opacity` forever.
Screenshots: `screenshots/v3-9/s1-v39-dynamic-willchange-tab-crossfade-70ms.png`
and `…-settled.png`.

## T5 — per-keypress `querySelectorAll` in the Albums grid

`?mockAlbums=1200`, CPU 6×, 10 `ArrowRight` presses from column 0, with both
`Document.prototype.querySelectorAll` and `Element.prototype.querySelectorAll`
wrapped to record the selector and the node count.

| Grid size | v3.8 calls / nodes | v3.9 calls / nodes |
|---|---|---|
| 50 cards | 8 / 404 (`#library-grid .focusable`) | **0 / 0** |
| 600 cards | 7 / **4200** (`#library-grid .focusable`) | **0 / 0** |
| 1200 cards (`hasMore` false) | 0 / 0 | **0 / 0** |

Zero calls attributable to the handler at every grid size. The only remaining
query in the v3.9 50-card probe is one `.library-subnav-item` match (4 nodes)
from unrelated sub-nav code.

Pagination still reaches the end with the trigger raised from 5 items to two
rows (`cols * 2` = 16): serpentine d-pad walk over 150 rows / 1186 keypresses,
card count 250 → 450 → 650 → 850 → 1050 → 1200, ending focused on
`Album 1200` at index 1199 with the zone still `library-grid`.

DOM and heap at the end are unchanged, as expected — T5 removes a query, it
does not virtualise:

| Measurement | v3.8 | v3.9 |
|---|---|---|
| `.album-grid-card` after reaching the end | 1200 | 1200 |
| Elements under `#app` | 15 647 | 15 647 |
| JS heap after full traversal | 5.16 MB | 5.24 MB |

Bounding those is Session 2's job.

## Bundled production build

`./build.sh` output loaded directly (`/index.html`, minified bundles), with
`tests/mock-boot.js` injected via Playwright `addInitScript` so it still runs
before the app scripts:

```
scripts: js/sonance-core.min.js?v=v3-9, js/sonance-screens.min.js?v=v3-9
all 7 top-nav screens render; Library grid reachable by d-pad (zone library-grid)
playback: { isPlaying: true, queueLen: 10, t: 5.86, readyState: 4 }
Settings About rows: ["V3.9", "Platform: Browser"]
non-2xx responses: ["404 http://localhost:8081/$WEBAPIS/webapis/webapis.js"]
```

That single 404 is expected off-device — Tizen resolves `$WEBAPIS` on the TV,
and `index.html` already documents that it 404s silently in a browser.

---

# Session 2 results (v3.9 T0–T1)

Same harness as above: Playwright 1.62.1, headless Chromium, 1920 × 1080,
`deviceScaleFactor: 1`, CPU throttled 6× via CDP, `--enable-precise-memory-info`
and `--js-flags=--expose-gc`, `node tests/dev-server.js 8081`, keyboard only.
Rig `tests/mock-index.html?mockAlbums=1200&mockArtists=2000&mockSongs=14000`.

Every "before" row in this section was re-measured **in this session** against
the pre-change `js/screens/library.js` (the T1 patch reversed, everything else
left in place — the `VirtualGrid.refresh` addition in `js/utils.js` and the
`.library-albums-virtual-mount` CSS rule are inert without it), so the two
sides are strictly like for like on this machine and this run.

## Albums grid geometry, measured rather than assumed

Read back from the rendered grid, both builds identical:

```
grid-template-columns : 153px 153px 153px 153px 153px 153px 153px 153px  (8 columns)
column gap / row gap  : 20px / 28px
card                  : 153 x 195 px      row pitch: 223 px
grid client width     : 1420 px (content 1364 px after 28px padding either side)
scroll container      : 1420 x 952 px
```

`VirtualGrid._calcColumns` assumes a fixed 16px gap allowance, so on
`.library-albums-grid`'s 20px column gap it computes **9** columns where the CSS
resolves **8**. A wrong column count puts the focus zone's row arithmetic out of
step with what the user sees, so `_measureAlbumGeometry` now reads the real
column count and row pitch out of the rendered grid and corrects the instance
through the new `VirtualGrid.refresh({columns, itemHeight})`. `ALBUM_ITEM_HEIGHT`
= 223 and `ALBUM_ITEM_MIN_WIDTH` = 140 are only the first-band estimate.

## T1 — DOM, images and heap at 1200 albums

Reached by keyboard: `ArrowRight` on the top nav (Home → Library), `ArrowDown`
into `library-grid`, then a serpentine walk — Right along the row, Down, Left
back, Down — because `FocusManager.moveFocus` does not wrap.

| Measurement | v3.9 before T1 | v3.9 after T1 |
|---|---|---|
| `.album-grid-card` at the start of the walk | 50 | 50 |
| `.album-grid-card` mid-walk | **700** | **64** |
| `.album-grid-card` at the end (1200 logical) | **1200** | **56** |
| Elements under `#app` at the end | **15 647** | **777** (−95.0 %) |
| `<img>` elements at the end | **1200** | **56** |
| Elements per mounted card | ≈13 | ≈13 (unchanged — the card markup is byte-identical) |
| Focused index / title at the end | 1199 / `Album 1200` | 1199 / `Album 1200` |

Mounted card count over the whole traversal stayed in the 50–80 band and never
exceeded **80** (10 rows × 8 at the worst scroll phase: `bufferRows: 2` above
and below a viewport that spans 5–6 rows). The acceptance ceiling was 150.

JS heap after loading all 1200 albums, `performance.memory.usedJSHeapSize`
after two `window.gc()` calls, **median of 3 runs**:

| | before | after |
|---|---|---|
| Heap median | **5 401 390 B (5.15 MB)** | **5 295 323 B (5.05 MB)** |
| Range over 3 runs | 5 397 926 – 5 470 862 | 5 292 433 – 5 296 491 |
| `.album-grid-card` | 1200, 1200, 1200 | 56, 56, 56 |
| Elements under `#app` | 15 647 ×3 | 777 ×3 |

The heap saving is only **106 KB (−2.0 %)**, with disjoint ranges. That is the
honest figure and it is small by design: DOM nodes live outside the JS heap, and
`_albumsAll` deliberately still retains all 1200 album objects — it is the
backing store the view is virtualised over. The win here is DOM nodes and
compositor layers, not JS heap. The before median also reproduces Session 1's
5.16 MB baseline row exactly.

## T1 — compositor layers

CDP `LayerTree`, same perturb-then-read-the-steady-state method as Session 1.

| Library screen at rest | before | after |
|---|---|---|
| **50 album cards mounted** — layer count | 66 | 66 |
| — total composited pixels | 15 689 084 | 15 728 844 |
| **1200 albums loaded** — layer count | **200** | **72** (−64 %) |
| — total composited pixels | 64 901 194 | 61 122 074 (−5.8 %) |
| — approx. layer memory @ 4 B/px | ~247.6 MB | ~233.2 MB |

The 50-card row reproduces Session 1's post-T4 census (66 layers /
15 703 754 px) on both sides, which is the control.

At 1200 albums the layer **count** falls by 128 — that is 128 fewer render
surfaces for the TV's compositor to allocate, track and draw, and it is the
number that matters for the reported symptom. Total composited **pixels** barely
moves, and it is worth being explicit about why: the largest layer in both
builds is the `.library-content` scroll-contents layer at 1420 × ~33 500 px
(47.6 Mpx, 78 % of the total). Virtualising does not shrink it, because the
scroll height still has to represent the whole collection — before, through 150
rows of real cards; after, through the spacer. Chromium also does not create one
layer per card at this scale; the pre-change build peaked at 200 layers, not
1216, so the compositor was already squashing. The measured claim is therefore
"−128 layers", not "−1144 layers".

## T1 — focus integrity over a full traversal

An in-page `keydown` listener registered after `FocusManager`'s own asserts, on
every keypress, that `FocusManager.getCurrentFocused()` is non-null,
`isConnected === true`, and contained by the current `#library-grid`.

| | before | after |
|---|---|---|
| Forward serpentine walk (Right/Down/Left/Down to index 1199) | 1149 steps | **1140 steps** |
| — assertion failures | **0** | **0** |
| Backward serpentine walk (index 1199 → 0, Up between rows) | 1199 steps | **1199 steps** |
| — assertion failures | **0** | **0** |
| Final zone / index after the backward walk | `library-grid` / 7 | `library-grid` / 7 |
| Wall clock, forward walk at 6× CPU throttle | 19.6 s | **14.1 s** |

`zoneEscapes` (5 before, 6 after) are the walk deliberately pressing Down at the
bottom of the loaded set while the next page is still in flight, which hands
focus to `nowplaying-bar`; the walk recovers with Up and continues. That is the
existing no-wrap behaviour, identical on both sides, not a virtualisation
artefact.

## T1 — `querySelectorAll` per 10 keypresses

Ten `ArrowRight` presses from column 0 with both `Document.prototype` and
`Element.prototype.querySelectorAll` wrapped. Session 1's T5 fix is preserved:

| Grid size when probed | before | after |
|---|---|---|
| 50 logical items | 0 calls / 0 nodes | **0 / 0** |
| 600 logical items | 0 / 0 | **0 / 0** |
| 1200 logical items | 0 / 0 | **0 / 0** |

The virtual zone's `onFocus` does no DOM query and no layout read at all — the
pagination trigger reads `_albumLoader.offset`, and `VirtualGrid` owns the
scroll through `ensureIndexVisible`.

## T1 — Enter target and Back restore

Keyboard only. For each index: walk to it, read the card's `data-album-title`,
Enter, compare against the album detail screen's `.album-detail-title`, then
Escape and read the restored focus.

| Index | card title | detail title | match | focus after Back | restored to the originating card |
|---|---|---|---|---|---|
| 0 | Album 0001 | Album 0001 | yes | index 0, `album-0` | **yes** |
| 7 | Album 0008 | Album 0008 | yes | index 7, `album-7` | **yes** |
| 600 | Album 0601 | Album 0601 | yes | index 49, `album-49` | no |
| 1199 | Album 1200 | Album 1200 | yes | index 49, `album-49` | no |

Enter opens the correct album at every index, including 1199, whose card was
mounted only as part of a 56-card band. The Back rows for 600 and 1199 are
**identical on the pre-change build** (same test, same two indices, both land
on index 49) — see NEW-3 in `tickets/prompt-3.9.md`. Cause: `goBack`
re-activates `LibraryScreen`, which rebuilds the Albums tab from offset 0, so
the saved index is clamped to the items loaded at that moment. Pre-existing, not
a T1 regression, and left unfixed because a fix changes navigation behaviour.

## T1 — teardown hygiene

`EventTarget.prototype.addEventListener` / `removeEventListener` wrapped before
app boot to count `scroll` registrations on `#library-content`:

```
booted (home)              screen=home      add=0   remove=0   net=0
cycle 1: library           screen=library   add=1   remove=0   net=1
cycle 1: home              screen=home      add=1   remove=1   net=0
cycle 2: library           screen=library   add=2   remove=1   net=1
cycle 2: home              screen=home      add=2   remove=2   net=0
cycle 3: library           screen=library   add=3   remove=2   net=1
cycle 3: home              screen=home      add=3   remove=3   net=0
in subnav (albums)         screen=library   add=4   remove=3   net=1
tab swap 1: artists        screen=library   add=5   remove=4   net=1
tab swap 1: albums         screen=library   add=6   remove=5   net=1
tab swap 2: artists        screen=library   add=7   remove=6   net=1
tab swap 2: albums         screen=library   add=8   remove=7   net=1
tab swap 3: artists        screen=library   add=9   remove=8   net=1
tab swap 3: albums         screen=library   add=10  remove=9   net=1
finalZones = ['library-grid', 'library-subnav', 'nowplaying-bar', 'topnav']
finalMount = library-albums-virtual-mount
```

Exactly one live scroll listener while Library is open, exactly zero when it is
not, across three screen navigations and three Albums ↔ Artists tab swaps, and
exactly one `library-grid` zone throughout (`FocusManager._debugZones()`).

## T1 — visual equivalence

Same focused index, same `scrollTop`, both builds, screenshots differenced
channel by channel:

| Frame | index | scrollTop | mean abs diff (0–255) | pixels differing > 8 | pixels > 32 |
|---|---|---|---|---|---|
| start | 0 | 0 | **0.0000** | **0** | **0** |
| middle | 600 | 15 992 | 0.1879 | 11 890 (0.57 %) | 1 106 (0.05 %) |
| end | 1199 | 32 494 | **0.0000** | **0** | **0** |

Start and end are **byte-identical**. The middle frame's residual survives
waiting for every `<img>` in the band to report `complete`, and read back at 4×
magnification the two crops show the same albums (0577–0579, 0603–0605), the
same colours, the same text at the same pixel positions and the same corner
radii — the difference is sub-perceptual resampling of the high-frequency
deterministic dither the dev server bakes into its synthetic cover PNGs, on
cards whose compositing path differs between a 1200-layer and a 56-layer tree.
Real covers are photographs, and every layout number above is identical, so this
is a fixture artefact.

Screenshots: `screenshots/v3-9/s2vis-{before,after}-{start,middle,end}.png`,
`s2vis2-{before,after}-middle.png` (fully settled re-capture),
`s2-{before,after}-albums-{start,middle,end,back-top}.png`,
`s2-after-library-at-rest-1200.png`,
`s2-after-albums-after-tabroundtrip.png`.

## T0 — Settings actions reachable by d-pad

```
hasContentArea       : false
hasSettingsLeft      : true
oldSelectorMatches   : 0        (#content-area .focusable:not(...))
newSelectorMatches   : 3        (#settings-left .focusable:not(...))
newSelectorOrder     : ["accent-reset", "settings-auto-np-row", "settings-logout-btn"]
```

Down walk from the top nav, and the Up walk back, keyboard only:

```
(start)      topnav          idx 6   top-nav-item selected focused
ArrowDown    content         idx 0   accent-swatch-0
ArrowDown    settings-actions idx 0  accent-reset
ArrowDown    settings-actions idx 1  settings-auto-np-row
ArrowDown    settings-actions idx 2  settings-logout-btn
ArrowDown    nowplaying-bar  idx 0   np-bar-btn
ArrowDown    nowplaying-bar  idx 0   np-bar-btn        (no further neighbour)

ArrowUp      settings-actions idx 2  settings-logout-btn
ArrowUp      settings-actions idx 1  settings-auto-np-row
ArrowUp      settings-actions idx 0  accent-reset
ArrowUp      content         idx 7   accent-swatch-7
ArrowUp      topnav          idx 6   top-nav-item selected focused
```

Left/Right on the toggle row toggles instead of changing zone:

```
before      : value "On"   zone settings-actions idx 1  focused settings-auto-np-row
ArrowRight  : value "Off"  zone settings-actions idx 1  focused settings-auto-np-row
ArrowLeft   : value "On"   zone settings-actions idx 1  focused settings-auto-np-row
```

Full logout round trip, keyboard only — no `element.click()` anywhere:

```
Enter on settings-logout-btn -> { present: true, zone: "confirm-dialog", focused: "confirm-cancel" }
ArrowRight                   -> focused "confirm-logout"
Enter                        -> { loginVisible: true, sonance_logged_in: null }
type + ArrowDown x4, Enter   -> { screen: "home", sonance_logged_in: "true", zone: "topnav", loginStillVisible: false }
```

Re-run with `?mockLibraries=3`, which populates the Libraries section between
Server and Appearance: `libraryRows: 3`, `librariesSectionShown: true`, and
`newSelectorMatches` is still exactly **3** in the same order — the
`:not(.settings-library-row)` exclusion keeps the library rows in their own
zone. The Down walk is unchanged; the Up walk correctly runs accent swatches →
`settings-libraries` → library rows.

Screenshots: `screenshots/v3-9/s2-after-settings-logout-focused-libs{1,3}.png`,
`s2-after-settings-logout-dialog.png`, `s2-after-settings-after-logout.png`,
`s2-after-login-connect-focused.png`, `s2-after-settings-after-relogin.png`.

## Bundled production build

`./build.sh`, then `/index.html` loaded directly with `tests/mock-boot.js`
injected via Playwright `addInitScript`:

```
scripts: $WEBAPIS/webapis/webapis.js, js/sonance-core.min.js?v=v3-9, js/sonance-screens.min.js?v=v3-9
non-2xx responses: ["404 http://localhost:8081/$WEBAPIS/webapis/webapis.js"]   (Tizen-only path, expected)

home       -> home        zones: content, home-newest, home-playlists, home-recent, nowplaying-bar, topnav
library    -> library     zones: library-grid, library-subnav, nowplaying-bar, topnav
playlists  -> playlists   zones: content, nowplaying-bar, topnav
queue      -> queue       zones: nowplaying-bar, queue-card, topnav
nowplaying -> nowplaying  zones: nowplaying-bar, np-controls, np-progress, topnav
search     -> search      zones: content, nowplaying-bar, search-results, search-special, topnav
settings   -> settings    zones: content, nowplaying-bar, settings-actions, topnav

albums grid, minified: 999 presses to index 1199 (Album 1200), 1009 probe steps,
  0 detached-node failures, 56 cards / 777 elements under #app at the end
playback (HTML5 fallback): { isPlaying: true, currentTime: 3.84 s, readyState: 4 }
```

`settings-actions` appears in the Settings zone list, which is the T0 fix
surviving minification.

---

# Session 3 results (v3.9 T1–T8) — memory & network hygiene

Captured 2026-09-03. Same harness as Sessions 1–2 (Playwright 1.62.1, headless
Chromium, 1920×1080 / DPR 1, `--enable-precise-memory-info`,
`--js-flags=--expose-gc`, `node tests/dev-server.js 8081`, keyboard only).
CPU throttling 6× where a row says so. Every "before" row in this section was
measured in this session against the pre-change code, on this machine, except
where it says otherwise.

Two harness additions, both test-only:

- `tests/dev-server.js` answers `/rest/__slow.view?ms=&chunks=` with a
  well-formed `subsonic-response` whose **body is dripped** over `ms` in
  `chunks` writes, headers sent immediately. T8's body-timeout row needs it.
- `tests/mock-boot.js` gained `?mockUserScope=1`, which stamps the requesting
  `u=` username into the album ids `getAlbumList2` returns, and a passthrough
  for `__slow.view`. T4's cross-user row needs the former.

## T1 — cover-art request size per surface

Read off the real screens, reached by keyboard, as the `data-size` attribute
(or the `size=` query parameter of `img.src` for the Now Playing art, which is
set straight from `ImageCache.getUrl`). Displayed size from
`getBoundingClientRect()`. Device pixel ratio is 1, so displayed CSS px equals
device px.

| Surface | displayed (focused) | before | after | over-fetch before → after |
|---|---|---|---|---|
| Album grid card (`fillMode`) | 153 (165) | **300** | **180** | 2.0× → 1.09× |
| Home album card | 162 (175) | 300 | 180 | 1.9× → 1.03× |
| Album detail art | 180 | 300 | 180 | 1.7× → 1.00× |
| Home hero art | 200 | **500** | **200** | 2.5× → 1.00× |
| Artist grid avatar | 100 (108) | **300** | **120** | 3.0× → 1.11× |
| Artist detail art | 200 | **500** | **200** | 2.5× → 1.00× |
| Now Playing art | 280 | **600** | **320** | 2.1× → 1.14× |
| Now Playing bar art (unchanged) | 48 | 100 | 100 | shared with the blur source |
| Artist-screen album thumb (unchanged) | 82 | 100 | 100 | — |

Raw probe output, `?mockAlbums=1200&mockArtists=2000&mockSongs=14000`, as
`requested@displayed`:

```
                before                                  after
home        {"500@200x200":1,"300@162x162":12}      {"200@200x200":1,"180@162x162":12}
albumGrid   {"300@165x165":1,"300@153x153":49}      {"180@165x165":1,"180@153x153":49}
albumDetail {"300@180x180":1}                       {"180@180x180":1}
nowPlaying  {"600@280x280":1,"100@48x48":1}         {"320@280x280":1,"100@48x48":1}
artistGrid  {"300@108x108":1,"300@100x100":62,…}    {"120@108x108":1,"120@100x100":62,…}
artistDetl  {"500@200x200":1,"100@82x82":1,…}       {"200@200x200":1,"100@82x82":1,…}
```

The bucket set is deliberately small and shared: 180 serves the album grid
card, the home cards and the album detail panel, so drilling into an album from
the grid still hits a warm URL. Fragmenting into per-surface sizes would undo
the Session 1 T2 disk-cache win, which is keyed on URL stability.

## T1 — cover-art bytes for one Library → Albums page

Bytes from CDP `Network.loadingFinished.encodedDataLength` **on the body**
(PART D note 7 — `responseReceived` reflects headers only), counted only for
requests started after the keypress that leaves Home.

### Mock rig (dev server's synthetic PNG, byte size scales with requested size)

| | before | after |
|---|---|---|
| `getCoverArt` requests | 40 | **50** |
| distinct URLs | 40 | 50 |
| requested size | 300 (40/40) | **180 (50/50)** |
| total bytes | **6 137 234** | **3 381 369** |
| bytes per image | 153 431 | **67 627** |
| cards / `<img>` mounted | 50 / 50 | 50 / 50 |

**−44.9 % on the page as measured, −55.9 % per image.** The request count rises
from 40 to 50 because T6's aligned preload now warms all 50 first-page cover
ids at the same size the grid asks for; before, it warmed 24 ids at 300, which
were a subset of the 40 the grid was already requesting. The 10 extra are the
first band's below-the-fold cards, which the user reaches by scrolling one row.

### Live Navidrome (real photographic JPEGs)

| | before | after |
|---|---|---|
| `getCoverArt` requests | 40 | 50 |
| requested size | 300 | 180 |
| total bytes | **1 901 300** | **1 746 122** |
| bytes per image | 47 533 | **34 922** |

**−26.5 % per image on real cover art**, and fewer bytes in total for 25 % more
images. Real JPEGs do not scale quadratically with the requested dimension the
way the dev server's synthetic PNG does, so the mock overstates the win; the
live figure is the one to believe.

### The Session 1 T2 disk-cache win still holds

Fresh page in the same browser context (never `page.reload()` — PART D note 6):

| | before | after |
|---|---|---|
| mock rig, launch 2 | 40 / 40 `fromDiskCache`, 0 bytes | **50 / 50 `fromDiskCache`, 0 bytes** |
| live server, launch 2 | 40 / 40 `fromDiskCache`, 0 bytes | **50 / 50 `fromDiskCache`, 0 bytes** |

### Visual check

The pre-change Albums frame is **byte-identical to Session 2's reference**:

```
1e96b8ba4919114cab0cb2be990dcd78ad00f85dfba6f69e03eacb094aec252c  s3-t1-before-albums.png
1e96b8ba4919114cab0cb2be990dcd78ad00f85dfba6f69e03eacb094aec252c  s2vis-after-start.png
```

Read back at 3× magnification, before against after:

- `s3-live-crop-before.png` / `s3-live-crop-after.png` — real cover art, the
  card at the `scale(1.08)` focus size and its neighbours. Indistinguishable:
  same photographic detail, the word "navidrome" equally legible on the vinyl
  label, same colours, same corner radii. **No softening at 180 px for a
  153/165 px card.**
- `s3-t1-crop-before.png` / `s3-t1-crop-after.png` — the same crop on the mock
  rig. Identical layout, text, colour and radii; the only difference is the
  grain of the dev server's deterministic per-pixel dither, which is coarser
  because a 180 px source is resampled less than a 300 px one. That is an
  artefact of the synthetic fixture, not of cover art.
- `s3-np-crop-before.png` / `s3-np-crop-after.png` — Now Playing art at 320 vs
  600 for a 280 px frame. Same gradient, same radius, same shadow; again only
  the fixture's dither grain differs.

## T2 — `ImageCache` retention

### Entry shape

```js
// before                                        // after
_cache[key] = { img: img, url: url,              _cache.set(key, { url: url,
                loaded: true };                                    loaded: true });
```

`img` was a live `Image` object that nothing ever read. Live
`HTMLImageElement` census after a full 1200-album traversal and two `gc()`
calls, via CDP `Runtime.queryObjects` on `HTMLImageElement.prototype`:

| | before | after |
|---|---|---|
| live `HTMLImageElement` instances | **610** | **110** |
| `ImageCache.size()` at the end | 500 (`MAX_SIZE`) | **128** (`MAX_SIZE`) |

110 is the 56 mounted `<img>` plus the placeholder and bar images; the ~500
cached `Image` loaders are gone.

### JS heap after a full traversal, median of 3

`performance.memory.usedJSHeapSize` after two `window.gc()` calls, 6× CPU
throttle, `?mockAlbums=1200&mockArtists=2000&mockSongs=14000`, **no in-page
instrumentation** so the figure is comparable with Session 2's.

| | before | after |
|---|---|---|
| median | **5 272 955 B** | **5 178 582 B** |
| range over 3 runs | 5 272 359 – 5 273 163 | 5 177 782 – 5 179 202 |

−94 373 B (−1.8 %), ranges disjoint. Session 2 recorded 5 295 323 B for the
same measurement; this session's own before-run on the same code measured
5 272 955 B, so ~23 KB of that gap is machine/run variance, not a code change.

### `_touchKey` cost

A **200-keypress vertical** grid walk (100 Down, 100 Up) — a horizontal walk
inside one row never recycles the band, so it never calls `ImageCache`.
`Array.prototype.indexOf` and `.splice` wrapped before app boot; `long` counts
calls on arrays of ≥ 50 elements, which in this app is only the LRU key list.

| | before | after |
|---|---|---|
| `indexOf` calls (total) | 8 036 | **32** |
| `indexOf` calls on arrays ≥ 50 | **8 020** | **0** |
| array elements scanned by those | **3 548 368** | **0** |
| `splice` calls (total) | 8 020 | **16** |
| `splice` calls on arrays ≥ 50 | 8 020 | **0** |
| longest array seen | **500** | **4** |

The residual 32/16 are `_queue.indexOf(rec)` in `ImageCache.cancel` and
`_openRequests` in `api.js`, both bounded by the concurrency cap.

### `clear()` wired into logout and library change

`ImageCache.clear()` existed and was called from nowhere. Keyboard-driven
logout (Settings → Logout → confirm) then a keyboard re-login:

```
before logout : { imgCache: 57, apiCache: 5 }
after logout  : { screen: "login", imgCache: 0, apiCache: 0, observedTargets: 0 }
after re-login: { screen: "library", imgs: 50, realImages: 40, imgCache: 57, apiCache: 5 }
```

Art loads correctly after re-login (40 of the 50 mounted covers are real images;
the other 10 are below the fold awaiting intersection) —
`s3-t2-after-relogin-albums.png`.

## T3 — `LazyLoader` released targets

`IntersectionObserver.prototype.observe` / `unobserve` / `disconnect` wrapped
before app boot, with a `WeakSet` maintaining the live registration count.
Full 1200-album serpentine traversal at 6× CPU throttle.

| | before (3 runs + 1) | after (3 runs) |
|---|---|---|
| **live observer targets at the end** | **4620 / 4146 / 4382 / 5038** | **16 / 16 / 16** |
| `observe` calls | 22 785 – 24 009 | 21 573 – 22 065 |
| `unobserve` calls | 6 973 – 7 253 | **17 430 – 17 740** |
| `.album-grid-card` at the end | 56 | 56 |
| elements under `#app` | 777 | 777 |
| forward traversal | 1192 steps / 14 161 – 14 330 ms | 1192 steps / 14 732 – 15 134 ms |
| — uninstrumented | 1192 steps / 14 061 – 14 268 ms | 1192 steps / 14 535 – 14 594 ms |

**The live target count falls by 99.7 %** and is now bounded by the mounted
band's not-yet-intersected images (16), not by the number of cards ever
rendered. The forward traversal is **2–4 % slower** in wall clock: the recycle
path now does one `querySelectorAll('img.lazy-art')` plus ~56 `unobserve` calls
per range change. That is a real cost and it is reported as measured rather
than glossed; it buys the removal of ~4 500 registered targets whose geometry
Chromium was re-testing on every observer pass, which is the cost the TV
actually pays and which this harness cannot measure.

Two call sites, not one, and deliberately different:

- `VirtualGrid._updateVisibleRange` (`js/utils.js`) calls
  `LazyLoader.releaseWithin(grid)` — release only. Most of the outgoing band's
  cover ids are re-requested by the incoming band a few lines later, so
  cancelling their in-flight loads there would abort them only to restart them.
- `_navigateToScreen` (`js/app.js`, right after `deactivate()`) calls
  `LazyLoader.unobserveWithin(_pageCurrent)` — release **and** cancel, because
  nothing on the outgoing screen will consume the bytes. This is the only place
  in the app where a screen is deactivated, so one line covers all 14 screens.

### Lazy loading still works deep in the grid

Walk to index 600, `?mockAlbums=1200`, 6× throttle:

```
{"index":607,"imgs":72,"realImages":40,"loadedClass":40,
 "visible":40,"visibleReal":40,"observed":32,"imgCache":128}
```

`s3-t3-after-idx600.png`, read back: every visible card shows a real cover
image, not the vinyl placeholder, and Album 0608 is focused at `scale(1.08)`.

## T4 — API memory cache bound, keys agreed, cross-user leak closed

### Cache bound

300 distinct `getAlbum` calls (not localStorage-allowlisted, so `clearCache()`
means cold), then the first and the last of the 300 re-issued. API requests
counted by wrapping `window.fetch` after boot.

| | before | after |
|---|---|---|
| distinct keys driven | 300 | 300 |
| network requests | 300 | 300 |
| `SubsonicAPI.cacheSize()` | *no accessor existed* | **100** (`CACHE_MAX`) |
| re-issue key #1 → network requests | **0** (still resident) | **1** (evicted) |
| re-issue key #300 → network requests | 0 | 0 (resident) |

### `memKey` and `_lsKey` now agree

```
before  memKey : getArtists.view|{"musicFolderId":"2"}
        lsKey  : sonance_apicache_v1__mockuser|http://localhost:8081|getArtists.view|{"musicFolderId":"2"}
        agree  : false

after   memKey : mockuser|http://localhost:8081|getArtists.view|{"musicFolderId":"2"}
        lsKey  : sonance_apicache_v1__mockuser|http://localhost:8081|getArtists.view|{"musicFolderId":"2"}
        agree  : true   (lsKey === LS_PREFIX + memKey)
```

The localStorage key format is unchanged, so existing entries and
`clearLocalCache`'s prefix scan still match.

### Cross-user leak

`?mockUserScope=1`, keyboard logout, keyboard login as `userB`, then
`getAlbumList2('newest', 6, 0)`:

```
before  userA: mockuser  ids ["mockuser-album-1199","mockuser-album-1198","mockuser-album-1197"]
        userB: userB     ids ["mockuser-album-1199","mockuser-album-1198","mockuser-album-1197"]  ← A's data
after   userA: mockuser  ids ["mockuser-album-1199","mockuser-album-1198","mockuser-album-1197"]
        userB: userB     ids ["userB-album-1199","userB-album-1198","userB-album-1197"]           ← correct
```

### localStorage after logout

```
before: ["sonance_authsalt_v1__mockuser|http://localhost:8081"]
after : ["sonance_authsalt_v1__mockuser|http://localhost:8081"]
```

The auth salt survives in both, which is decision D2 and load-bearing for the
Session 1 T2 disk-cache win. Everything else goes.

## T5 — localStorage quota

### `getArtists` payload

| | before | after | change |
|---|---|---|---|
| mock, 2000 artists | 206 520 chars | **166 487** | −19.4 % |
| **live, 2493 real artists** | **1 076 675 chars** | **277 805** | **−74.2 %** |
| live, total localStorage | 1 137 713 chars | **320 771** | −71.8 % |
| synchronous `setItem` duration | 0.0 – 0.1 ms | 0.0 – 0.2 ms | not measurable on this machine |

Stored artist object, live server:

```
before: ["id","name","coverArt","albumCount","artistImageUrl","musicBrainzId","sortName","roles"]
after : ["id","name","albumCount","coverArt"]
```

Those four are what `_renderArtistCard` (`js/screens/library.js`) actually
reads. The projection applies **only on the way into localStorage** — the
in-memory cache and the live response still carry the full object. The mock's
saving is small because its fixture artists only ever had five fields; the live
figure is the real one.

The "synchronous main-thread block" this task was written against is **not
measurable on this machine** — a 206 KB `JSON.stringify` + `setItem` costs
under 0.1 ms here. It is a Tizen claim, and it is recorded as unverified rather
than asserted.

### Seven-library fan-out footprint (mock, 2000 artists, `?mockLibraries=7`)

One unscoped call plus a 7-way scoped fan-out:

| | before | after |
|---|---|---|
| localStorage keys | 14 | 14 |
| total chars | 415 232 | **334 968** |
| `getArtists` keys / chars | 8 / 413 880 | 8 / **333 616** |

### Quota exhausted: prune vs die

Both halves run on **identical** padding — the quota filled with the app's own
`sonance_apicache_v1__…getArtists.view|{"stale":N}` keys, which is what the
multi-library fan-out actually produces — in decreasing chunk sizes so the
remaining headroom is under 512 chars. The `legacy` half reinstalls the
pre-v3.9 `_lsWrite` in-page, so cancellation of the other variables is exact.

```
fill (both):  34 keys, QuotaExceededError, 5 242 631 chars resident

legacy  cold launch 1: {networkGetArtists: 2, liveEntryStored: 0, liveChars: 0,
                        writes: ["206520ch/QuotaExceededError","206520ch/QuotaExceededError"]}
        cold launch 2: {networkGetArtists: 2, liveEntryStored: 0, liveChars: 0,
                        writes: ["206520ch/QuotaExceededError","206520ch/QuotaExceededError"]}

current cold launch 1: {networkGetArtists: 1, liveEntryStored: 1, liveChars: 166487,
                        stalePadRemaining: 33,
                        writes: ["166487ch/QuotaExceededError","166487ch/ok"]}
        cold launch 2: {networkGetArtists: 0, liveEntryStored: 1, liveChars: 166487,
                        writes: []}
```

Legacy: the tier is dead permanently and every cold launch refetches. Current:
the first write hits the quota, the prune frees one stale entry, the retry
succeeds, and the **second cold launch makes zero `getArtists` network
requests**.

The prune only touches keys under `LS_PREFIX`. With the quota filled by
**foreign** keys instead, it correctly declines to delete data it does not own
and fails gracefully:

```
{foreignKeysRemaining: 38, sonanceNonCacheKeys: 5,
 writes: ["166487ch/QuotaExceededError","166487ch/QuotaExceededError"]}
```

All 38 foreign keys and all 5 `sonance_` non-cache keys (credentials, auth
salt, library selection, accent, auto-NP) survive.

## T6 — nav-hover preload aligned

`window.fetch` wrapped after boot for API requests; cover art over CDP
`Network`. One left-to-right sweep of the whole top nav (6 `ArrowRight`
presses, auto-navigate on slide):

| | before | after |
|---|---|---|
| API requests over the sweep | 5 | **4** |
| `getAlbumList2` calls | `size=50`, `size=24`, `size=1` | **`size=50`, `size=1`** |
| cover-art requests | 50 | 50 |

One Library navigation on a **cold** cache (fresh page, `localStorage.clear()`,
`SubsonicAPI.clearCache()`, then a single `ArrowRight`):

| | before | after |
|---|---|---|
| `getAlbumList2` network requests | **2** — `{type:alphabeticalByName, size:50}` and `{size:24}` | **1** — `{type:alphabeticalByName, size:50}` |
| cover-art requests | 40, all `size=300` | 50, all `size=180` |

Before, the preload asked for `('newest', 12, 0)` / `('alphabeticalByName', 24,
0)` with no `libraryIds` while the screens ask for 6 and 50 **with** library
scope. Since the cache key is `username|serverUrl|endpoint|JSON.stringify(params)`,
no preload could ever serve a screen: it was a second round trip on every
Library navigation and it warmed art from deselected libraries. The preload
now issues exactly the screens' calls, and its `ImageCache.preload` size moved
from 300 to 180 to match T1's grid bucket — otherwise it would have become 50
downloads nothing displays.

## T7 — in-flight de-duplication

| | before | after |
|---|---|---|
| two identical `getAlbum` calls in one tick → network requests | **2** | **1** |
| both promises resolve with equal data | yes | yes |
| both promises resolve to the **same object** | no | **yes** |
| same-tick `StarredCache.load(api)` + `api.getStarred2(null)` → requests | **2** | **1** |
| cold app start → `getStarred2` requests | 1 | 1 |
| rejected call, then retried: first rejects / retry succeeds | yes / yes | **yes / yes** |

The `getStarred2` race PART C names is between `js/starred.js:46` and
`js/screens/search.js:369`. **It does not occur at cold start** — the boot path
issues exactly one call, before and after — so it is reproduced directly by
firing both callers in the same tick, which is the shape the two code paths
take when the user opens Search → Favourites while the boot load is still in
flight. The cold-start row is reported as measured (1 → 1) rather than claimed
as an improvement.

A rejection does not poison the map: with `getGenres` forced to fail once, the
first call rejects and the immediately following call succeeds and returns all
12 genres.

## T8 — request cancellation and image concurrency

### (a) Concurrent cover-art sockets over a fast 200-keypress vertical walk

In-flight count from CDP `Network.requestWillBeSent` minus
`loadingFinished` / `loadingFailed`, 6× CPU throttle.

| | before | after |
|---|---|---|
| **peak concurrent** | **48** | **5** |
| p90 concurrent | 39 | **4** |
| requests started | 168 / 160 | 142 |
| bytes over the walk | 24 607 873 | **9 616 708** |

The peak now equals `MAX_CONCURRENT` exactly. An earlier run of the same
measurement showed a peak of 13 because a DOM `<img>` issues its own
(cache-served) request when `ImageCache` hands it the URL, and those overlap
the next loader batch; the p90 of 4 is the steadier figure either way. The
byte reduction is partly T1's smaller images.

### (b) A slow response body

`api._request('__slow.view', { ms: 30000, chunks: 60 })` against the dev
server's drip endpoint. Headers arrive immediately; the body takes 30 s.

| | before | after |
|---|---|---|
| outcome | **resolved** | **rejected** |
| elapsed | **29 601 ms** | **10 006 ms** |
| message | — | `Request timed out. Check your server connection.` |

The 10 s timeout used to be cleared on the response headers, so a slow body had
no timeout at all.

### (c) Navigating away mid-load

Network throttled to 200 KB/s so the loads are genuinely in flight. Both halves
are the same run of the same build, with `LazyLoader.unobserveWithin` replaced
by a no-op for the `legacy` half — so this isolates cancellation from the
concurrency cap. Window: from the keypress that leaves Library, for 12 s.

| after leaving Library | legacy teardown | with cancellation |
|---|---|---|
| further cover requests **started** | **36** | **0** |
| further cover requests finished | 36 | 0 |
| `Network.loadingFailed` | 0 | **5 × `net::ERR_ABORTED`** |
| **bytes transferred after leaving** | **2 453 716** | **0** |
| still open at the end of the window | 5 | **0** |

**2 453 716 bytes saved on a single navigate-away.** For reference, the genuine
pre-change build measured on the same scenario with a 6 s window: 50 requests
started on Library, 6 finished, **0** aborted, and **57 sockets still open**
6 s after the user had moved to Playlists.

### (d) Playback must not regress

Start a track from an album detail, return to the Albums grid through the top
nav, then hammer the grid (10 blocks of 7 Right + 7 Left + 1 Down).

| | before | after |
|---|---|---|
| at start | `isPlaying: true, currentTime: 2.860 s, readyState: 4` | `isPlaying: true, currentTime: 2.860 s, readyState: 4` |
| after the walk | `13.948 s`, still `Track 01`, screen `library` | `13.943 s`, still `Track 01`, screen `library` |
| +2.5 s later | `16.451 s` | `16.444 s` |

## Focus integrity after the T3 change to `VirtualGrid`

The recycle path is Session 2's verified work, so it was re-asserted. A
`document` `keydown` listener registered **after** app boot (so it runs after
`FocusManager`'s) checks on every keypress that the focused element is
non-null, `isConnected`, and contained by `#library-grid`.

```
unbundled  forward : idx 1199, 1192 steps / 15 110 ms, 1192 checks, 0 failures, 56 cards / 777 els
           backward: idx  343, 1605 steps / 12 900 ms, 2797 checks cumulative, 0 failures
bundled    forward : idx 1199, 1192 steps / 14 827 ms, 1192 checks, 0 failures, 56 cards / 777 els
           backward: idx  343, 1605 steps / 12 382 ms, 2797 checks cumulative, 0 failures

enter idx 0    -> card "Album 0001" -> detail "Album 0001"   match
enter idx 7    -> card "Album 0016" -> detail "Album 0016"   match
enter idx 600  -> card "Album 0608" -> detail "Album 0608"   match
enter idx 1199 -> card "Album 1200" -> detail "Album 1200"   match
```

**0 failures over 2 797 checks** on both builds. The backward walk exhausted its
1605-step budget at index 343 rather than reaching 0 (each row costs 8 presses
with this recovery pattern); the assertion count is what the row is for.
The Enter probes land at the first index ≥ the target, which is why 7 → 0016
and 600 → 0608; the card the user sees and the detail that opens agree in every
case.

## Bundled production build

`./build.sh`, then `/index.html` with `tests/mock-boot.js` injected via
`addInitScript`:

```
bundle sizes: js/sonance-core.min.js 54 208 B (gz 17 173)
              js/sonance-screens.min.js 121 872 B (gz 29 180)
?. / ?? gate: 0 hits in both bundles
Sonance3.wgt 80 K / 7 files      Sonance3-Oblong.wgt 228 K / 8 entries
index.html: bundled, ?v=v3-9     CACHE_BUST="v3-9"     Settings About: V3.9

home       -> home        zones: content, home-newest, home-playlists, home-recent, nowplaying-bar, topnav
library    -> library     zones: library-grid, library-subnav, nowplaying-bar, topnav
playlists  -> playlists   zones: content, nowplaying-bar, topnav
queue      -> queue       zones: nowplaying-bar, queue-card, topnav
nowplaying -> nowplaying  zones: nowplaying-bar, np-controls, np-progress, topnav
search     -> search      zones: content, nowplaying-bar, search-results, search-special, topnav
settings   -> settings    zones: content, nowplaying-bar, settings-actions, topnav

page errors: 0
non-2xx responses: ["404 http://localhost:8081/$WEBAPIS/webapis/webapis.js"]  (Tizen-only, expected)
observed IntersectionObserver targets, per screen: 0 / 10 / 0 / 0 / 0 / 0 / 0
```

`settings-actions` still appears in the Settings zone list, so Session 2's T0
fix survives minification.

## Reproducing Session 3

```bash
unset -f node npx npm nvm _load_nvm 2>/dev/null
export PATH="/Users/agents/.nvm/versions/node/v24.16.0/bin:$PATH"
export NODE_PATH="/Users/agents/Agent Working Directory/node_modules"
./build.sh --dev
node tests/dev-server.js 8081 &
# live rows only:
export SONANCE_USER="$(grep -m1 '| Username |' TEST-ACCOUNT.local.md | cut -d'`' -f2)"
export SONANCE_PASS="$(grep -m1 '| Password |' TEST-ACCOUNT.local.md | cut -d'`' -f2)"
```

Session measurement scripts live in the session scratchpad, not the repo
(decision D15). Every row above names the in-page expression, CDP domain or
command it came from.

---

# Session 4 results (v3.9 T1–T5) — correctness

**This session's rig is correctness, not bytes.** Most rows below are "which
items came back" and "how many times was this called", not milliseconds.

All measurements at 1920×1080 / DPR 1, keyboard only, Chromium headless via the
Playwright Node API. Every "before" row was re-measured in this session against
the pre-change code, served by Playwright route interception from reconstructed
copies of the six touched files — each reconstructed copy matches the original's
line count exactly (`api.js` 969, `utils.js` 635, `focus.js` 676, `app.js`
1942, `player.js` 1051, `screens/library.js` 1368), and the reconstructed
`api.js` + `library.js` reproduce the T1 defect figure exactly (400 of 1200),
which is what validates the mechanism.

## T1 — multi-library Albums pagination

### The defect

`getAlbumList2` asks every library in scope for `size` items at the **same**
offset, `_mergeAlbumLists` keeps the `size` best of the up-to-N×size fetched,
and the old `fetchPage` then advanced one shared `apiOffset` past what every
library had already returned. The truncated items were never re-requested.

### Mock rig, `?mockAlbums=1200`, paged to the end by keyboard

Libraries are contiguous, disjoint alphabetical blocks (decision D3), so the
loss is total rather than partial.

| | distinct albums reached | of fixture | albums per library | `getAlbumList2` calls |
|---|---|---|---|---|
| 3 libraries, before | **400** | 1200 | `{1:400}` — libs 2 and 3 contributed **nothing** | 27 |
| 3 libraries, after | **1200** | 1200 | `{1:400, 2:400, 3:400}` | 27 |
| 7 libraries, before | **200** | 1200 | `{1:172, 2:22, 3:6}` — libs 4–7 **nothing** | 35 |
| 7 libraries, after | **1200** | 1200 | `{1:172 … 6:172, 7:168}` (all seven, exact) | 28 |

After: 0 duplicate ids, and the loaded list is in exact fixture order
(`Album 0001 … Album 0012` first, `Album 1189 … Album 1200` last). Mounted
`.album-grid-card` 56 and elements under `#app` 777 at the end — Session 2's
bounds unchanged. 0 page errors.

Before, 3 libraries: first 12 `Album 0001…0012`, last 12 `Album 0389…0400` —
the grid simply ends at 400.

### The request sequence, 3 libraries (this is the mechanism)

```
before                                after
folder=1 offset=0                     folder=1 offset=0
folder=2 offset=0                     folder=2 offset=0
folder=3 offset=0                     folder=3 offset=0
folder=1 offset=50                    folder=1 offset=50     <- only library 1 advances:
folder=2 offset=50   <- lib 2's       folder=1 offset=100       libs 2 and 3 KEEP their
folder=3 offset=50      offset-0      folder=1 offset=150       buffered page, because
folder=1 offset=100     items were    folder=1 offset=200       their heads lose every
folder=2 offset=100     discarded     folder=1 offset=250       comparison
folder=3 offset=100     and are now   folder=1 offset=300
folder=1 offset=150     skipped       folder=1 offset=350
…                       forever       folder=1 offset=400
                                      folder=2 offset=50     <- asked only once its
                                                                offset-0 page is spent
```

The cursor's property is stronger than the acceptance criterion asked for: a
library whose items lose the merge is not re-asked at a *later* offset (the
defect), and it is not re-asked at the *same* offset either — it retains its
buffer and is asked for `offset+50` only after all 50 buffered items have been
emitted. Nothing is fetched twice and nothing is skipped.

### Single-library and all-libraries paths unchanged

`?mockLibraries=1`, selection `null`:

```
before: folder=- offset=0,50,100,150,200,250,300,350 …   25 calls, 1200/1200 distinct
after : folder=- offset=0,50,100,150,200,250,300,350 …   25 calls, 1200/1200 distinct
identical request sequence: True
```

### The k-way merge, unit-exercised

The mock rig's libraries are disjoint, so its streams never interleave and the
comparator is never really tested. Driven directly against a stub whose
per-library streams interleave (`SubsonicAPI.prototype.createAlbumListCursor`
called on a fake `api` object):

```
ascending  alphabeticalByName, 3 interleaved libraries (1,4,7… / 2,5,8… / 3,6,9…)
  pages of 4: [001,002,003,004] [005,006,007,008] … [021,022] []   perfect global order
  per-library calls: 1@0 2@0 3@0 1@4 2@4 3@4 1@8
descending 'newest' (sort key `created`), same shape
  pages of 4: [022,021,020,019] [018,017,016,015] … [002,001] []  direction respected
duplicate id in two libraries -> emitted once   [a1,a2,a3,a4]
one empty library alongside a populated one     [a1,a2,a3] then 0, no hang
a library whose request rejects                 rejects with 'boom', does not hang
```

### Live Navidrome — 7 libraries, 7 119 albums

Ground truth taken straight from the server (`size=500` pages per
`musicFolderId`, isolated from the app):

```
id=1   2989 albums  Lossless Music Library
id=2    494 albums  HiRes Music
id=3   3227 albums  MP3 Music (Lossy)
id=4     12 albums  Surround Sound Music
id=5     70 albums  Drumless Music
id=6    326 albums  Audiobooks
id=7      1 albums  Drumless (Not AI)
sum 7119, distinct album ids 7119
```

Real keyboard login, then a fresh page in the same context booted with all seven
libraries in scope, 170 `ArrowDown` presses (25 pages, 1 250 albums — the live
library is far too large to page to the end by remote, so this is a fixed-budget
prefix comparison, identical on both sides):

| | before | after |
|---|---|---|
| albums loaded / distinct | 1250 / 1250 | 1250 / 1250 |
| **libraries represented** | **4 of 7** | **7 of 7** |
| albums per library reached | `{1:553, 2:4, 3:683, 6:10}` | `{1:47, 2:64, 3:1054, 4:5, 5:31, 6:21, 7:1}` |
| **`getAlbumList2` requests** | **175** (25 per folder, every folder driven to offset 1200) | **29** |
| adjacent-pair order inversions | 32 / 1249 (2.56 %) | **2 / 1249 (0.16 %)** |
| mounted cards / elements under `#app` | 72 / 986 | 72 / 986 |
| page errors | 0 | 0 |

Libraries 4 (12 albums), 5 (70) and 7 (1) were **completely invisible** before.

## T1a — the comparator disagreed with the server's collation

Found while verifying T1 on live data: `_mergeAlbumLists` sorted merged pages by
JavaScript code-point order, but Navidrome's `alphabeticalByName` uses a
normalised sort name. For a single library that never mattered (the app shows
the server's order untouched); a k-way merge makes the comparator the whole
presentation order.

Adjacent-pair inversions against the seven libraries' real server-ordered names
(1 896 pairs) — i.e. how often each candidate would order two neighbours the
other way round from the server:

| comparator | inversions | % |
|---|---|---|
| code-point order (pre-v3.9) | 161 | 8.49 |
| lowercase | 128 | 6.75 |
| **lowercase + leading article stripped** | **9** | **0.47** |
| `localeCompare` | 138 | 7.28 |
| `localeCompare` + leading article | 18 | 0.95 |

Per library: `1: 48→6  2: 27→0  3: 28→1  4: 1→0  5: 5→0  6: 52→2  7: 0→0`.

Two consequences, both measured on live:

1. Library 1's server-ordered first page opens with `“The Spaghetti Incident?”`
   (curly quote, U+201C), which under any client comparator sorts after every
   ASCII title in the other six libraries. The merge therefore parked library 1
   — **2 989 albums contributed 0 of the first 1 250**. Re-sorting each buffered
   page with the app's own comparator fixes it: library 1 appears from the first
   page onward, and all seven libraries are represented.
2. Only the two name-ish sort keys (`name`, `artist`) are normalised.
   `created` / `played` / `starred` are timestamps and compare raw, so
   `newest` / `recent` / `frequent` / `starred` are untouched.

Progression across the three live runs, same 170-press budget:

| | libraries represented | inversions / 1249 | `getAlbumList2` calls |
|---|---|---|---|
| before | 4 of 7 | 32 | 175 |
| cursor only, code-point comparator | 6 of 7 (library 1 starved) | — | 29 |
| cursor + normalised comparator | 6 of 7 | — | 30 |
| cursor + comparator + per-page re-sort | **7 of 7** | **2** | **29** |

## T2 — AVPlay load-generation guard

`webapis.avplay` is Tizen-only, so this is verified against
`tests/avplay-stub.js` — a scriptable `window.webapis.avplay` installed with
`addInitScript` before app boot, so the real `js/player.js` AVPlay branch runs
against it and `Player.IS_TIZEN` is `true`. **Not verified on the device**; both
T2 and T3 are on the Session 6 manual TV list.

The call sequence up to the point of divergence is identical on both sides:

```
open@1 setDisplayRect@1 setListener@1 prepareAsync@1 close@1 open@2 setDisplayRect@2 setListener@2 prepareAsync@2
```

Then the superseded generation's `prepareAsync` success callback is fired:

| | `play()` from the SUPERSEDED prepare | `play()` from the current prepare |
|---|---|---|
| rapid double-Next, before | **1** | 1 |
| rapid double-Next, after | **0** | 1 |
| triple-Next, before | **2** (one per superseded generation) | 1 |
| triple-Next, after | **0** | 1 |
| Next-then-Previous, before | **2** | 1 |
| Next-then-Previous, after | **0** | 1 |

Before, the full trace shows the defect plainly — `play@2` twice, the first
driven by generation 1's callback:

```
before: … prepareAsync@2 prepare:ok@2 play@2 setScreenSaver@2 prepare:ok@2 play@2 setScreenSaver@2
after : … prepareAsync@2 prepare:ok@2 prepare:ok@2 play@2 setScreenSaver@2
```

and the gated logger records why:

```
[Sonance][Player] Discarding stale prepare success (gen 1 != 2)
[Sonance][Player] Discarding stale prepare success (gen 3 != 5)
[Sonance][Player] Discarding stale prepare success (gen 4 != 5)
```

Track identity is correct on both sides (double-Next lands on `Track 02`,
triple-Next on `Track 03`), so the guard drops only the stale work.

**HTML5 fallback not regressed** — rapid double-Next in the browser:

```
before  queueIndex 2, track 'Track 03', <audio>.src id=song-2, currentTime 2.36 -> 3.87 s, paused=false
after   queueIndex 2, track 'Track 03', <audio>.src id=song-2, currentTime 2.37 -> 3.87 s, paused=false
```

## T3 — AVPlay error cascade capped

Cap is **3 consecutive load failures**. All four failure paths funnel through
`_onLoadFailure`; any load that reaches a playable state resets the count.

50-track queue, every load failing:

| | AVPlay stub `open()` | stub `prepareAsync` | HTML5 `stream.view` requests | `isPlaying` at rest | queueIndex | toast |
|---|---|---|---|---|---|---|
| before | **50** | 50 | **50** | `true` | 49 | none |
| after | **3** | 3 | **3** | `false` | 2 | "Playback stopped — tracks could not be played" |

```
[Sonance][Player] Load failed (avplay prepareAsync) 1/3 — advancing
[Sonance][Player] Load failed (avplay prepareAsync) 2/3 — advancing
[Sonance][Player] Stopped advancing after 3 consecutive load failures (avplay prepareAsync)
```

Recovery — the cap is 3, so the meaningful case is two failures then a success,
run twice. If the counter had not reset, the second run's first failure would be
the third overall and would stop playback instead of advancing:

```
after  run 1: open()=3 play()=1 isPlaying=true queueIndex=2 track 'Track 03'
       run 2: open()=6 play()=2 isPlaying=true queueIndex=5 track 'Track 06'
       trace: open prepare:err  open prepare:err  open prepare:ok play
              open prepare:err  open prepare:err  open prepare:ok play
```

Identical to the before build on this path, which is the point — the cap does
not interfere with recovery.

## T4 — logging gated

`SonanceUtils.log()` is a no-op unless `window.SONANCE_DEBUG === true` is set
before the scripts load, the URL carries `?debug=1`, or
`SonanceUtils.setDebug(true)` is called at runtime. `warn()` and `error()` are
untouched. 118 `log()` call sites, 14 `warn()`, 15 `error()`.

Fixed keyboard-only walk: app boot, a 7-screen top-nav sweep out and back
(14 moves), then 200 Albums-grid keypresses. `console.log` / `console.warn` /
`console.error` wrapped in `addInitScript`, so the count starts before the first
app script.

| | `console.log` before | after | `console.warn` before | after |
|---|---|---|---|---|
| app boot | 26 | **0** | 1 | **0** |
| nav sweep (14 moves) | 81 | **0** | 16 | **0** |
| 200 grid keypresses | 0 | 0 | 0 | 0 |
| **boot + whole walk** | **112** | **0** | **18** | **0** |

The grid was already silent — Session 1's T5 removed the per-keypress work — so
the whole win is on boot and navigation. The 16 warns per sweep were
`FocusManager`'s per-re-registration notice, exactly as the ticket predicted:
every screen re-registers the `nowplaying-bar` zone on activate.

`warn` / `error` still work. Forcing `window.fetch` to reject and calling
`api.ping()`:

```
before  ping rejected with 'simulated network failure'
        console.error 1: [Sonance][API] ping.view failed: simulated network failure
        console.warn  7: 6 of them FocusManager re-register notices
        console.log  33
after   ping rejected with 'simulated network failure'
        console.error 1: [Sonance][API] ping.view failed: simulated network failure
        console.warn  0
        console.log   0
```

Turning it back on, in the after build:

```
SonanceUtils.isDebug()      -> false
SonanceUtils.setDebug(true) -> log() emits 1 line
SonanceUtils.setDebug(false)-> log() emits 0 lines
```

`drop_console` was **not** adopted, for two measured reasons:

```
$ terser dc-test.js --compress                        -> console.log, console.warn, console.error all kept
$ terser dc-test.js --compress drop_console=true      -> function a(){}    ALL THREE removed
$ terser dc-test.js --compress "drop_console=['log']" -> console.warn and console.error kept
   (terser 5.51.2)
```

`drop_console=true` would delete `console.warn`/`console.error`, which T4
forbids. `drop_console=['log']` keeps them but would strip the `console.log`
inside `log()`, killing `setDebug(true)` in the shipped `.wgt` — the one place
adding logging is genuinely hard. And it saves almost nothing, because the 118
call sites still build their strings and call the gated function:

```
                        as shipped              with drop_console=['log']
sonance-core.min.js     56 713 B (gz 18 172)    56 614 B (gz 18 131)    -99 B
sonance-screens.min.js 121 757 B (gz 29 182)   121 755 B (gz 29 177)     -2 B
```

## T5 — app-shell Player subscriptions

`Player`'s `_listeners` registry is module-global and survives `_showLogin()`,
which tears down the shell's DOM and focus zones but never unsubscribed. The
five handlers were anonymous closures, so nothing could detach them. They are
now named functions, and `_showAppShell` detaches the previous set before
attaching. `Player.listenerCount([event])` added as a diagnostic, in the spirit
of Session 3's `SubsonicAPI.cacheSize()`.

Total `Player` listeners after N logout → login cycles:

| cycles | before | after | per event, before → after |
|---|---|---|---|
| 0 | 5 | 5 | `userplay 1→1, trackchange 1→1, progress 1→1, play 1→1, pause 1→1` |
| 1 | **10** | **5** | `2→1` on all five |
| 3 | **20** | **5** | `4→1` on all five |
| 5 | **30** | **5** | `6→1` on all five |

Each leaked listener closed over the *previous* shell's detached elements and
fired on every progress tick — 4–10 times a second, times six after five
cycles.

NP bar still updates after five re-logins (play a track, read the bar):

```
before  title 'Track 01'  artist 'A Artist 01 — Album 01'
after   title 'Track 01'  artist 'A Artist 01 — Album 01'
```

## Bundled production build

`./build.sh`, `index.html` left bundled at `?v=v3-9`, `tests/mock-boot.js`
injected via `addInitScript`, 3 libraries / 1200 albums:

```
SonanceUtils.isDebug()  false
Player.listenerCount()  5
console.log lines       1   (index.html's own "Not on Tizen" shim)
console.warn lines      0
page errors             0
non-2xx responses       404 /$WEBAPIS/webapis/webapis.js   (Tizen-only path, expected)

home       els=230  zones topnav,nowplaying-bar,content,home-newest,home-recent,home-playlists
library    els=700  zones topnav,nowplaying-bar,library-subnav,library-grid
playlists  els=55   zones topnav,nowplaying-bar,content
queue      els=55   zones topnav,nowplaying-bar,queue-card
nowplaying els=81   zones topnav,nowplaying-bar,np-controls,np-progress
search     els=102  zones topnav,nowplaying-bar,content,search-special,search-results
settings   els=101  zones topnav,nowplaying-bar,content,settings-actions,settings-libraries

T1 on the minified bundles: 1200 / 1200 distinct, {1:400, 2:400, 3:400},
Album 0001 first and Album 1200 last, 56 mounted cards, 777 elements under #app.
```

`settings-actions` still present, so Session 2's T0 fix survives minification.

Bundle sizes: `js/sonance-core.min.js` 56 713 B (gz 18 172) against Session 3's
54 208 (gz 17 173) — the `AlbumListCursor`, the T2/T3 guards and the T4/T5 code
all land in the core bundle. `js/sonance-screens.min.js` 121 757 B (gz 29 182)
against 121 872 (gz 29 180), essentially flat. `Sonance3.wgt` 82 767 B (7
files), `Sonance3-Oblong.wgt` 232 179 B.

## Screenshots

- `screenshots/v3-9/s4-t1-albums-past-400.png` — unbundled build, 3 libraries,
  focus at index 464 showing `Album 0433`–`Album 0472`. Everything past
  `Album 0400` was unreachable before T1.
- `screenshots/v3-9/s4-bundled-albums-end.png` — bundled build, 3 libraries,
  paged to the end, focus on `Album 1200`, the last fixture album.

## Reproducing Session 4

```bash
unset -f node npx npm nvm _load_nvm 2>/dev/null
export PATH="/Users/agents/.nvm/versions/node/v24.16.0/bin:$PATH"
export NODE_PATH="/Users/agents/Agent Working Directory/node_modules"
./build.sh --dev
node tests/dev-server.js 8081 &
# T1 needs a MULTI-library scope that is not the full set, or the persisted
# key seeded directly — Settings normalises a full selection to null:
#   localStorage.setItem('sonance_selected_libraries', JSON.stringify(['1','2','3']))
# T2/T3 need tests/avplay-stub.js injected with addInitScript before app boot.
```

Session measurement scripts live in the session scratchpad, not the repo
(decision D15). `tests/avplay-stub.js` is the exception — it is a reusable test
double that Sessions 5 and 6 will want, so it lives in the repo.

---

# Session 5 results (v3.9 T1–T13) — polish

Measured 2026-09-04, Opus 5 @ xhigh. Rig: `node tests/dev-server.js 8081`,
Playwright 1.62.1 headless Chromium, viewport 1920×1080, deviceScaleFactor 1,
keyboard only. Mock rig for everything except T8, which needs the live
Navidrome. "Before" is served by Playwright route interception against
pre-change copies of the touched files held in the session scratchpad (D29),
so both sides are measured in the same process on the same machine.

Files changed this session: `css/styles.css`, `js/focus.js`,
`js/components.js`, `js/utils.js`, `js/screens/nowplaying.js`,
`js/screens/library.js`, `js/screens/queue.js`, `js/screens/settings.js`,
`build.sh`, `icon-oblong.png`, `docs/UI-MOCKUP-REFERENCE.md`.

## T1 — `barBounce` no longer animates `height`

`css/styles.css` `@keyframes barBounce` + `.eq-bar`. Album screen open with
track 1 playing, four `.eq-bar` elements animating, CPU throttled 6×, CDP
`Performance.getMetrics()` differenced over a fixed 3-second window, three
runs each:

```
                 LayoutCount   RecalcStyleCount   LayoutDuration
before  run 1        181              181            0.0124 s
        run 2        180              180            0.0175 s
        run 3        180              180            0.0177 s
after   run 1          0               22            0.0000 s
        run 2          0               22            0.0000 s
        run 3          0               25            0.0000 s
```

180 layouts per 3 s is 60 fps × 3 s: one forced layout per animation frame,
for as long as the Album screen is open. After the change the animation is
entirely on the compositor.

Visual equivalence, driven through the Web Animations API so both builds are
sampled at identical animation times (`anim.currentTime = t`, then two rAFs,
then `getBoundingClientRect()`). Bar 0 has no delay, bar 3 has 0.3 s:

```
 t(ms)   bar0 h/bottom before   bar0 after    bar3 before    bar3 after
     0    4.08 / 193.2          4.08 / 193.2   0 / 193.2      0 / 193.2
   100   10.20 / 193.2         10.20 / 193.2   0 / 193.2      0 / 193.2
   200   16.32 / 193.2         16.32 / 193.2   0 / 193.2      0 / 193.2
   300   12.24 / 193.2         12.24 / 193.2   4.08 / 193.2   4.08 / 193.2
   400    8.16 / 193.2          8.16 / 193.2  10.20 / 193.2  10.20 / 193.2
   500   14.28 / 193.2         14.28 / 193.2  16.32 / 193.2  16.32 / 193.2
   600   20.40 / 193.2         20.40 / 193.2  12.24 / 193.2  12.24 / 193.2
   700   12.24 / 193.2         12.24 / 193.2   8.16 / 193.2   8.16 / 193.2
   800    4.08 / 193.2          4.08 / 193.2  14.28 / 193.2  14.28 / 193.2
```

(Heights are ×1.02 — the focused `.track-row` is `scale(1.02)`.) The bar-3
column is why `.eq-bar` carries a base `transform: scaleY(0)`: the old rule
gave the element no height at all, so a delayed bar was invisible until its
animation started. Without the base transform the first version of this change
showed a full-height 20px bar for the whole delay. With it, both builds agree
at every sampled time.

Screenshots, animation frozen at two phases, `deviceScaleFactor: 4` so the
3px-wide bars are legible: `screenshots/v3-9/s5-t1-eq-before-phase25.png` /
`-after-phase25.png` and the matching `-phase75` pair. Pixel diff of each
pair: 1106 / 828 differing pixels of 266 240, max channel delta 68 / 41, and
the differing pixels are confined to a bbox of 99 × 83 device px — the bar
glyphs themselves. That is edge antialiasing: a composited scaled layer
resamples its 1px `border-radius` slightly differently from a laid-out box.
Bar rects are identical to 0.01 px.

## T2 — lyrics active-line repaint bounded

`js/screens/nowplaying.js` `LyricsScroller.update`. Rig: a 60-line synced
lyric injected by wrapping `window.fetch` after boot, played against the dev
server's 20 s WAV (one line every 333 ms); `Element.prototype.className`'s
setter wrapped to count writes beginning `lyrics-line`.

```
                                        before   after
single active-line change                  60       2
8 s of playback, className writes        1500      50
8 s of playback, active-line changes        25      25
  => writes per active-line change        60.0    2.00
```

Rendered state identical at three playback positions:

```
                    before                          after
t=4.9 s   active "Lyric line 15"  past 14 up 45   same
t=8.9 s   active "Lyric line 27"  past 26 up 33   same
t=12.9 s  active "Lyric line 39"  past 38 up 21   same
```

Screenshots `screenshots/v3-9/s5-t2-lyrics-{before,after}-p{1,2,3}.png`.

`FocusManager._debugZones()` is `["topnav","nowplaying-bar","np-controls",
"np-progress"]` before the lyrics update, after it, and after 8 s of updates,
on both builds — unchanged and not growing. `_registerFocusZones()` at
`js/screens/nowplaying.js:860` is reached on every `_updateLyricsUI()`, but
`_updateLyricsUI` is called from track change, lyrics fetch and panel
open/close only — never from `_onProgress` — so it is not per-tick and was
left alone.

A backward seek is still O(n): `jumpTo` resets `_activeIndex` to −1 before
calling `update`, so every line up to the target is legitimately repainted as
past. That is unchanged from before and is what correctness requires.

## T3 — the time row is written only when its text changes

`js/screens/nowplaying.js` `_updateProgress`. `Node.prototype.textContent`
setter wrapped; 30 s of playback spanning one track change:

```
                       before   after
_timeCurrent writes      114      31
_timeTotal writes        114       0
track changes              1       1
```

Displayed values identical at every checkpoint (`"0:02" / "0:20"` at start,
`"0:12" / "0:20"` mid-track, `"0:01" / "0:20"` near the end, `"0:12" / "0:20"`
after the next track starts).

**Why `_timeTotal` was not moved into `_updateTrack` (D31).** Wrapping the
setter *before* app boot and watching the first 3 s of a Now Playing open
shows the total is not invariant from the first tick:

```
before  current writes 13, total writes 13
        total write sequence: 3:00, 0:20, 0:20, 0:20, 0:20, 0:20, 0:20, 0:20
after   current writes  2, total writes  2
        total write sequence: 3:00, 0:20
```

`Player` seeds `state.duration` from `track.duration` (3:00 in the fixture)
and refines it from the media element's own metadata (0:20, the dev server's
WAV) a moment later. A `_updateTrack`-only write would have pinned the
display at 3:00. The cached-last-string guard writes each distinct value once
and no more.

## T4 — duplicate `scrollIntoView`

`js/focus.js` `_scheduleFocusCallbacks`. Three builds compared in the same
run shape: **before** (route-intercepted pre-session `focus.js`), **after**
(shipped: gated on `zone.virtual`), and **nogate** (a scratchpad variant with
`scrollIntoView` removed for every zone, built only to evidence the gate).
`Element.prototype.scrollIntoView` and `getBoundingClientRect` wrapped;
`Performance.getMetrics()` differenced. 10 ArrowDown presses per zone,
`?mockAlbums=1200&mockArtists=2000&mockSongs=300`:

```
                       scrollIntoView   getBoundingClientRect   LayoutCount
ALBUMS  (virtual)  before      16                0                  19
                   after       16                0                  17
                   nogate       0                0                   8
ARTISTS (virtual)  before      16                0                  19
                   after       16                0                  19
                   nogate       0                0                   3
SONGS   (flow)     before      10                0                  10
                   after        0                0                  10
                   nogate       0                0                  10
HOME    (flow)     before       4                0                   2
                   after        0                0                   2
                   nogate       0                0                   2
```

**The `getBoundingClientRect` column is 0 everywhere, on every build.** The
per-screen `_scrollToFocused` helpers read `offsetTop` / `offsetHeight` /
`clientHeight`, and `scrollIntoView` is internal — neither goes through
`Element.prototype.getBoundingClientRect`. The metric the ticket named cannot
see this change; `scrollIntoView` call counts and `LayoutCount` can.

Focused-element position after each of 10 ArrowDown presses (`rect.top`,
viewport 1080):

```
ALBUMS  before [347,570,793,857,851,857,858,857,857,858]
        after  [347,570,793,857,851,857,857,858,857,858]
ARTISTS before [312,498,684,870,892,892,892,880,892,880]
        after  [312,498,684,870,892,892,892,880,892,880]
SONGS   before [179,239,299,359,419,479,539,599,659,719]
        after  [179,239,299,359,419,479,539,599,659,719]
HOME    before [447,773,935,1027,1027,1027,1027,1027,1027,1027]
        after  [447,773,915,1027,1027,1027,1027,1027,1027,1027]
```

Every element stays inside the viewport on both builds, and no position
settles in two steps (`rect.top` sampled immediately after the focus rAF and
again 260 ms later agrees on both). The one changed value is Home step 3,
935 → 915: `scrollIntoView({block:'nearest'})` used to run first and park the
element flush against the viewport edge, which then made the screen's own
`_scrollToFocused` a no-op. With it gone, `home.js`'s intended 20 px margin
finally applies. That is the intended behaviour of the code that was always
there, not a new rule.

**Why virtual zones keep it.** `VirtualGrid.ensureIndexVisible` returns early
without scrolling when the index is already inside the mounted band
(`js/utils.js:513`) — the common case for a one-row move within a 56-card
band. The `nogate` build shows the consequence: after 10 ArrowDown presses the
focused card sits at `top` 1502 (Albums) and 1292 (Artists), i.e. off the
bottom of a 1080 viewport, `inView: false`.

Focus integrity, current build, `?mockAlbums=1200`: 142 ArrowDown presses to
page all 1200 in, then a full serpentine traversal (7 across, one down, 7
back) of 1199 steps in 20.7 s. A `document` `keydown` listener registered
after boot asserts the focused node is non-null, `isConnected` and inside
`#library-grid`:

```
checks 1341   failures 0
end state: zone=library-grid idx=1192 card "Album 1193" mountedCards=56 elementsUnderApp=441
```

## T5 — per-card vinyl SVG replaced by a CSS gradient

`js/components.js` `_albumPlaceholder` + `.art-placeholder-vinyl::after` in
`css/styles.css`. `Element.prototype.setAttribute`,
`Document.prototype.createElement` and `createElementNS` wrapped before boot.

One full mounted-band recycle, driven by 7 ArrowDown presses with all 1200
albums already loaded (range 552–632 → 608–680, 72 cards mounted):

```
                      before    after
setAttribute          17 640    3 024
createElementNS        3 024        0
createElement          3 528    3 528
elements under #app      986      554
```

A 200-keypress walk (100 Down + 100 Up — a straight 200 Down overruns the 150
rows and transfers focus to `nowplaying-bar`), 850 albums paged in:

```
                      before     after
setAttribute         522 566    89 716
createElementNS       89 580         0
createElement        104 526   104 666
LayoutCount              576       576
elements under #app      778       442
```

Elements under `#app` with the full band mounted: **778 → 442**, against the
Session 2 reference of 777. No regression; 56 cards × 6 SVG nodes each is the
336-element difference.

Visual: covers aborted at the network so the placeholder is what renders,
three adjacent cards clipped —
`screenshots/v3-9/s5-t5-vinyl-{before,after}.png`, plus the full grids
`s5-t5-grid-{before,after}.png`. Read back and compared: same ring radii, same
centre dot, same 25 % opacity, same position. Pixel diff of the three-card
clip: 2 987 differing pixels of 107 433 (2.8 %), max channel delta 46, all
inside the ring glyphs — the gradient's hard stops antialias slightly more
crisply than a 1.5-unit SVG stroke. The DOM difference is visible in the
probe: `.art-placeholder` had 1 child (an `<svg>`) and now has 0.

## T6 — grids built into a `DocumentFragment`

`js/utils.js` `VirtualGrid._updateVisibleRange` and `js/screens/library.js`
`_renderArtistsChunked`. `LazyLoader.observe` was moved after the fragment is
attached, so it still runs on nodes that are in the document, and
`onRangeRender` still fires with the band mounted (which
`_reapplyGridFocusAfterRecycle` depends on).

**No measurable gain.** 40 forced full-band re-renders
(`vg._updateVisibleRange(true)`), 68-card band, CPU throttled 6×, seven runs,
median reported:

```
before  median 518.3 ms / 40  [514.0, 514.2, 514.3, 518.3, 518.5, 530.2, 534.1]  => 12.957 ms each
after   median 521.0 ms / 40  [505.5, 513.8, 517.4, 521.0, 521.9, 538.0, 547.8]  => 13.025 ms each
```

The 200-keypress walk agrees: `LayoutCount` 577 → 572, `RecalcStyleCount`
945 → 1023. All of that is inside run-to-run noise — Chromium does not run
layout per `appendChild` when nothing reads layout in between, which is the
cost a fragment is supposed to avoid. The change is kept because the ticket
specified it and it is risk-free, but **the improvement is not evidenced on
this rig** and should not be claimed.

No regression: the focus-integrity run above (1341 checks, 0 failures) and
the Enter targets below are both on the fragment build.

```
Enter@   0 (1200 loaded, focus landed on    0): card "Album 0001" -> album "Album 0001"
Enter@   7 (1200 loaded, focus landed on    7): card "Album 0008" -> album "Album 0008"
Enter@ 600 (1200 loaded, focus landed on  600): card "Album 0601" -> album "Album 0601"
Enter@1199 (1200 loaded, focus landed on 1199): card "Album 1200" -> album "Album 1200"
```

The grid must be re-paged before each deep index because Back rebuilds the
Albums tab from offset 0 — that is NEW-3, unchanged and unrelated.

## T7 — queue row clicks delegated

`js/screens/queue.js`. 500-track queue (a playlist of `?mockSongs=500` played
by keyboard), 499 rendered "up next" rows.
`EventTarget.prototype.addEventListener` wrapped before boot:

```
                                     before   after
click listeners on .queue-row          499       0
click listeners on .queue-list           0       1
rendered rows                          499     499
```

Keyboard activation unchanged:

```
Enter on queue row   0 (data-queue-idx=1,   "Track 002") -> queueIndex   1, "Track 002"
Enter on queue row  12 (data-queue-idx=13,  "Track 014") -> queueIndex  13, "Track 014"
Enter on queue row 300 (data-queue-idx=301, "Track 302") -> queueIndex 301, "Track 302"
```

Identical on both builds. The zone's `onActivate` still calls
`element.click()`; the event now bubbles to the container handler.

## T8 — Settings library stats (LIVE server)

`js/screens/settings.js` `_fetchLibraryStats`. Real keyboard login against
`http://192.168.0.2:4534` with the disposable test account, credentials read
from `TEST-ACCOUNT.local.md` inside the test script (D7). A **fresh browser
context per leg**, so no disk cache is shared and byte figures are real.
CDP `Network.loadingFinished` `encodedDataLength`, `/rest/` requests only,
cover art separated out because it is Home-screen art still arriving and its
count varies run to run.

All libraries selected (normalises to `null`, D-NEW-4):

```
before   4 API requests, 303 302 B          after   3 API requests, 302 402 B
    8 629 B  getAlbumList2.view?type=alphabeticalByName&size=50
      803 B  getMusicFolders.view
    1 045 B  getAlbumList2.view?type=newest&size=1        <- gone
  292 825 B  getArtists.view
  rendered: "2493 artists"                        rendered: "2493 artists"
```

One library scoped (`["1"]`, Lossless Music Library, 2 989 albums):

```
before   4 API requests, 303 853 B          after   3 API requests, 151 351 B
    9 146 B  getAlbumList2.view?…&musicFolderId=1
      803 B  getMusicFolders.view
    1 045 B  getAlbumList2.view?type=newest&size=1        <- gone
  292 859 B  getArtists.view                     141 402 B  getArtists.view?musicFolderId=1
  rendered: "2493 artists"                        rendered: "1100 artists"
```

**API bytes −50.2 %, and the count is now right.** Cross-checked on the same
page: with `["1"]` scoped, `getArtists(AuthManager.getSelectedLibraries())`
returns **1100** and `getArtists(null)` returns **2493**. The Library screen's
Artists tab builds from the former, so Settings and Library now agree; before
they did not.

## T9 — `removeAttribute('src')`

`js/screens/nowplaying.js` `deactivate`. CDP `Network.enable`, every request
recorded from the moment Now Playing tears down.

```
                                                   before                    after
requests after NP deactivate                          1                        1
  (the same Home cover-art request on both, id=album-19)
requests for the document URL itself                  0                        0
NP <img> after teardown  hasSrcAttribute            true                    false
                         getAttribute('src')          ""                     null
                         .src property     <document URL>                      ""
                         .src === document URL      true                    false
```

The **condition** is reproduced and removed: after `src = ''` the element's
`src` property resolves to the document URL, which is exactly what older
Chromium then fetched. The **consequence** is not reproducible on Playwright's
Chromium — a direct probe (`img.src = 'about:blank#x'; img.src = ''`) also
resolves to the document URL and issues no request. Chromium 63 is on the
boundary; this is verified as a state change, not as a saved request. Session
3's `ImageCache.cancel` uses `removeAttribute` for the same reason.

## T10 — `md5()` inner-function hoist: NOT made

Both variants built from the shipped `js/utils.js` source in one Node process
(the current form, and the same code with `md5cycle` / `cmn` / `ff` / `gg` /
`hh` / `ii` / `md5blk` / `rhex` / `hex` / `add32` / `md5str` / `hex_chr`
hoisted to module scope), warmed with 5 000 calls, then seven timed rounds of
1 000 calls:

```
A  as shipped   1000 calls — median 1.156 ms, best 1.150  [1.15,1.15,1.16,1.16,1.16,1.16,1.19]
B  hoisted      1000 calls — median 1.136 ms, best 1.119  [1.12,1.13,1.14,1.14,1.14,1.15,1.15]
delta 0.020 ms per 1000 calls (1.7 %) = 20 ns per call
```

Output identical on five probes including the empty string, a 128-character
string and a 12-character one (`d41d8cd98f00b204e9800998ecf8427e`,
`0cc175b9c0f1b6a831c399e269772661`, `61bb9c1a2f0bb703e2d585e426e7dff4`,
`55a3cefe521c653af1ea46dc4e16818d`, `30f38485f4da329f44a84ac28b61b7f4`).

`md5` has exactly one call site — `js/api.js:222`, inside the `SubsonicAPI`
constructor — and since V3.9 T2's stable salt it is no longer called per
request. `new SubsonicAPI` happens twice in the codebase
(`js/auth.js:71`, `:165`), i.e. once or twice per app launch. 20 ns once per
launch does not justify rewriting a hand-transcribed hash. Marked `[~]`.

## T11 — CSS minified into the package

`build.sh`. `npx --yes clean-css-cli` at its default optimisation level, the
same shape as the existing `npx --yes terser` call: nothing installed into the
project, no `package.json`. The minified sheet is written to a staging
directory and zipped from there; `css/styles.css` in the working tree is
untouched, so browser dev keeps readable CSS.

```
css/styles.css   87 448 -> 52 909 bytes  (gz 15 796 -> 8 411)
Sonance3.wgt          82 767 -> 76 279 bytes   (7 files, unchanged)
Sonance3-Oblong.wgt  232 179 -> 128 324 bytes  (also gains T13's icon)
```

`build.sh` now fails the build if the minified sheet contains
`backdrop-filter`, `transition: all` or a bare `gap:` — the same shape as the
existing `?.` / `??` gate on the JS bundles. All three greps return nothing.
`translateZ(0)` survives minification (7 occurrences, including the three D6
card rules).

Visual check: the **bundled** production build loaded with the packaged
minified sheet route-substituted for the working-tree one, screenshots read
back and pixel-diffed against the same build with the raw sheet:

```
Home         0 differing pixels of 2 073 600
Library      0
Album        0
Now Playing  330 differing pixels, bbox 99 x 27 at (751, 662) — the progress
             scrubber, which had advanced between the two runs
```

`sheetRules` 484 → 481: clean-css merged three rules. Compared against the
Session 2 reference `screenshots/v3-9/s2vis-after-start.png` by reading both
back: identical 8-column grid geometry, card positions, top-nav pill, library
sub-nav and palette; only the fixture labels and cover gradients differ
(40 albums here vs 1200 there). New screenshots
`screenshots/v3-9/s5-t11-{raw,min}-{home,library,album,nowplaying}.png`.

## T13 — the oblong icon re-encoded

`icon-oblong.png` was 512 × 423 RGBA8, no ancillary chunks, 175 772 B —
0.81 bytes per pixel, with every IDAT chunk exactly 4096 B, the signature of
an encoder doing little or no scanline filtering. 3 900 unique RGBA values and
628 semi-transparent pixels, so neither a 256-entry palette nor 24-bit RGB is
lossless; the win is filtering and deflate, not colour reduction.

Re-encoded with a dependency-free Node script: inflate the IDATs with the
built-in `zlib`, undo the per-scanline filters, re-filter adaptively (all five
filter types tried per scanline, minimum sum of absolute differences wins),
deflate at level 9. Three deflate strategies tried:

```
Z_DEFAULT_STRATEGY   71 505 bytes   <- kept
Z_FILTERED           71 740
Z_RLE               111 138
```

```
icon-oblong.png      175 772 -> 71 505 bytes  (-59.3 %)
Sonance3-Oblong.wgt  232 179 -> 128 324 bytes (-44.7 %)
```

Lossless, verified two ways: the decoded pixel buffer of the new file is
`Buffer.equals` to the original's, and an independent decode through
Chromium's own PNG decoder reports **0 differing pixels of 216 576, max
channel delta 0**. Read back visually — the Sonance mark on its purple
rounded-rect, unchanged. Geometry untouched at 512 × 423 (D4).

## Regression guard at the end of Session 5

```
$ grep -rn "innerHTML" js/*.js js/screens/*.js | grep -v "no innerHTML"
js/screens/nowplaying.js:113:    // Remove all children of a node (safer than innerHTML = '')
   (the standing note: a comment, not an assignment)
$ grep -nE "transition: *all" css/styles.css
58:    /* transitions defined per-class; keep no global `transition: all` */
$ grep -nE "transition[^;]*(width|height|margin|padding|left|right|top|bottom|font-size|border)" css/styles.css
   (no hits)
$ grep -n "backdrop-filter" css/styles.css
   (no hits)
$ grep -nE "(^|[^-a-z])gap:" css/styles.css
   (no hits)
$ grep -rn "setInterval" js/
   (no hits)
```

D6 preserved — `transform: translateZ(0)` still on `.album-card`
(`css/styles.css:1855`), `.album-grid-card` (`:2108`) and `.artist-grid-card`
(`:2185`); the line numbers moved because T1 and T5 added rules above them.

`node --check` clean on all seven modified sources and both minified bundles.
No `?.` or `??` in sources or bundles; `./build.sh`'s own gate reports none.

## Reproducing Session 5

```bash
node tests/dev-server.js 8081
# T1   album screen, track playing, CDP Performance.getMetrics over 3 s,
#      CPU throttle 6x; and anim.currentTime sweep via getAnimations()
# T2   wrap window.fetch after boot to inject a 60-line synced lyric;
#      wrap the Element.prototype.className setter
# T3   wrap the Node.prototype.textContent setter in addInitScript (before
#      boot — the 3:00 -> 0:20 total write happens during NP activate)
# T4   wrap Element.prototype.scrollIntoView; compare three focus.js builds
# T5   wrap setAttribute / createElement / createElementNS in addInitScript;
#      page.route('**/rest/getCoverArt.view*', r => r.abort()) to force
#      placeholders
# T6   vg._updateVisibleRange(true) x40, timed in-page at CPU throttle 6x
# T7   wrap EventTarget.prototype.addEventListener in addInitScript;
#      ?mockSongs=500 then play a playlist
# T8   LIVE server, one fresh browser context per leg (a shared context's
#      disk cache reports encodedDataLength 0)
# T9   CDP Network.enable, then leave Now Playing
# T13  node scratchpad/png.js icon-oblong.png out.png
```

---

# Session 6 results (v3.9 T1–T10) — non-performance report + TV readiness

Measured 2026-09-04, Opus 5 @ xhigh. Rig: `node tests/dev-server.js 8081`,
Playwright 1.62.1 headless Chromium, viewport 1920×1080, deviceScaleFactor 1,
keyboard only, `--enable-precise-memory-info --js-flags=--expose-gc
--autoplay-policy=no-user-gesture-required`. Live server Navidrome 0.63.2
(`openSubsonic: true`), seven libraries. "Before" for T5 is served by Playwright
route interception against a pre-change copy of `js/api.js` held in the session
scratchpad (D29), so both sides run in one process.

Files changed this session: `js/api.js` (T5), `js/focus.js` (T4b),
`css/styles.css` (T4c), `tickets/prompt-3.9.md` (T9),
`prompts/P15c-fix broken login-prompt.md` (T9),
`prompts/pre-release-security-scan.md` (T9), plus `docs/v3-9-report.md` (new).

The reader-facing write-up of all of this is **`docs/v3-9-report.md`**. This
section records the numbers and the method behind them.

## T1 — Library → Songs cannot reach the library (LIVE, measured, not fixed)

`js/screens/library.js` `_loadSongs` → `getRandomSongs(50, libraryIds)`; no
offset exists on that endpoint. `_loadGenreSongs` → `getSongsByGenre(genre, 50,
0, libraryIds)`; offset hard-coded to 0.

```
Songs tab rows rendered (live, all libraries)                50  (50 distinct)
Rows after 70 real ArrowDown presses from row 1              50
Focus zone after those presses                               nowplaying-bar (transferred out)
D-pad paths that reach song 51                               none
Re-entry in the same session (Albums -> Songs): overlap      50 of 50   (identical set)
Re-entry after a fresh app launch: overlap                    0 of 50   (a different 50)
Largest live genre                                Dance, 5 225 songs
Rows the genre detail renders                                50
```

The within-session stability is `_cachedRequest`'s 5-minute in-memory TTL, not a
design choice: the set is stable for five minutes and then silently changes.

Endpoint probe against the live server (`api._request` from the app page, so the
real auth is used; every URL redacted before printing):

```
search3.view?query=&songCount=50&songOffset=0        -> 50 songs
search3.view?query=&songCount=50&songOffset=50       -> 50 songs
search3.view?query=&songCount=50&songOffset=5000     -> 50 songs
  overlap(offset 0, offset 50)                       ->  0
  repeat of offset 0 is byte-identical               -> true
getSongsByGenre.view?genre=Dance&count=50&offset=0   -> 50 songs
getSongsByGenre.view?genre=Dance&count=50&offset=50  -> 50 songs
  overlap                                            ->  0
getRandomSongs.view?size=500                         -> 500 songs (no offset parameter exists)
getOpenSubsonicExtensions.view                       -> songLyrics, indexBasedQueue,
                                                        transcoding, playbackReport
```

So `search3` with an empty query paginates stably and completely, and
`getSongsByGenre` already honours `offset` — the genre cap is a client-side
omission only. No OpenSubsonic extension on this server helps.

Screenshots `s6-t1-live-songs.png` (list ends at row 50, "Carry My Love"),
`s6-t1-live-genre.png`.

## T2 — Playlist detail and Queue render every row (mock rig, measured, not fixed)

`?mockSongs=N`, `getPlaylist.view` returns the whole entry list. CPU throttle 6×,
one browser context per run, median of three runs for timings and heap. `t0` is
the keydown that opens the view; "first paint" is the second `requestAnimationFrame`
after the list lands in the DOM.

Playlist detail — `#playlist-songs .song-row`:

```
                              500        5 000       14 000
rows rendered                 500        5 000       14 000
elements under #app         3 068       30 068       84 050
Enter -> first paint       88.9 ms     642.7 ms     1 892 ms
  (three runs)          88.1/90.4/88.9  642.7/642.1/644.7  1918/1805/1892
LayoutCount                     2            2            3
RecalcStyleCount                2            3            3
JS heap (median of 3)   2 566 874 B  4 191 784 B  7 655 345 B
```

Queue — `#queue-list .queue-row`:

```
                              500        5 000       14 000
rows rendered                 499        4 999       13 999
elements under #app         4 097       40 053      112 053
nav key -> first paint    132.2 ms     963.3 ms     2 868 ms
  (three runs)         132.1/135.4/132.2  1039/963/957  2953/2845/2868
LayoutCount                     1            2            2
RecalcStyleCount                4            5            5
JS heap (median of 3)   2 796 208 B  5 358 856 B 10 558 972 B
```

D-pad near the bottom — 20 real ArrowDown presses with focus 30 rows from the
end (the *position* was set with `FocusManager.setActiveZone`; the 20 measured
presses are genuine keyboard input):

```
                              500        5 000       14 000
20 ArrowDown presses         67 ms       994 ms     4 467 ms
per keypress                3.4 ms      49.7 ms      223 ms
focus connected + in list     yes          yes          yes
```

`LayoutCount` stays flat because nothing reads layout during the build; the cost
is element construction, style recalc at paint, and retained memory.
**Recommended virtualisation threshold: ~750 rows**, from the shape of the
wall-clock and per-keypress rows. Screenshots `s6-t2-{playlist,queue}-{500,5000,14000}.png`.

## T3 — `getStarred2` is unbounded (LIVE, measured, not changed)

CDP `Network.enable` from before login; bytes from `Network.loadingFinished`'s
`encodedDataLength`, body from `Network.getResponseBody`.

```
getStarred2.view requests at app start                    1
encoded response size                                   690 B
response body                                           145 characters
requestWillBeSent -> loadingFinished                   43.4 ms
starred songs / albums / artists on the test account    0 / 0 / 0
getStarred2.view entries in localStorage                  0  (not in LS_ALLOWLIST)
```

**The account has nothing starred, so the unbounded payload cannot be shown with
real data, and nothing was starred to manufacture one** (that writes to the
user's server). Cost per item, from real responses on the same server:

```
JSON bytes per album (getAlbumList2, 50 sampled)        876
JSON bytes per song  (getRandomSongs, 50 sampled)     1 298
```

`StarredCache.load` is the only consumer and reads only `.id`, so the projection
is `id` alone for all three collections — roughly 32 characters against
876–1 298 bytes. Not implemented: adding an endpoint to `LS_ALLOWLIST` changes
behaviour (starred state would survive a cold launch for up to the 24 h
`LS_TTL`). See `docs/v3-9-report.md` §3.

## T4 — Dead code

**T4a — the Search `VirtualGrid` branch is NOT dead.** The brief's premise ("a
hard server-side cap of 25 results") is wrong: `search3` fans out one request
per scoped library and `_mergeSearchResults` concatenates and de-duplicates
without re-capping, so the per-section totals scale with the number of scoped
libraries. Live, query `LOVE`, typed on the on-screen keyboard by d-pad:

```
libraries scoped   app "Results (n)"   DOM artist/album/song   DOM total   virtual mounts
all 7 (-> null)          25                 5 / 10 / 10            25            0
1 of 7                   25                 5 / 10 / 10            25            0
3 of 7                   70                13 / 27 / 30            70            0
4 of 7                   82                13 / 29 / 18            60            1
5 of 7                  100                18 / 18 / 18            54            2
6 of 7                  104                18 / 18 / 18            54            2
```

DOM total falls below the header from four libraries on because a section is
virtualised and only its mounted band exists. Screenshot
`s6-t4-live-search-4libs.png` reads "RESULTS (82)". **Kept.**

**T4b — `FocusManager.invalidateZone`: dead, deleted.** Defined at
`js/focus.js:133`, exported at `:672`, zero references anywhere in `js/`,
`css/`, `tests/` or `docs/`.

**T4c — `.placeholder-card`: dead, deleted.** `css/styles.css:1226` and `:1240`.
No JS constructs the class, no HTML contains it, no dynamic name building. Also
removes a static `will-change: transform`.

**T4d — `LazyLoader.disconnect`: dead, deliberately kept** (`js/image-cache.js`
`:480` / `:497`). Session 3 kept it on purpose; the brief said not to touch it.

## T5 — `_memKey` cache keys were insertion-order sensitive (FIXED)

`js/api.js` gained `_stableParams` — sorted keys, `undefined` values skipped
exactly as `JSON.stringify` would. Before/after in one process, the "before"
served by route interception:

```
BEFORE  _memKey('getAlbumList2.view', {type:'alphabeticalByName', size:50, offset:0})
        …|getAlbumList2.view|{"type":"alphabeticalByName","size":50,"offset":0}
        _memKey('getAlbumList2.view', {offset:0, size:50, type:'alphabeticalByName'})
        …|getAlbumList2.view|{"offset":0,"size":50,"type":"alphabeticalByName"}
        distinct keys: 2

AFTER   both calls
        …|getAlbumList2.view|{"offset":0,"size":50,"type":"alphabeticalByName"}
        distinct keys: 1
```

Cache does not grow. Identical fixed keyboard walk on both builds (Library →
all four tabs → Playlists → Queue → Search → Settings → Home):

```
                            before   after
SubsonicAPI.cacheSize()        24      24
localStorage API entries        9       9
```

## T8 — Final verification pass

**Mock rig at scale**, `?mockAlbums=1200&mockArtists=2000&mockSongs=14000&mockLibraries=7`
with `sonance_selected_libraries` seeded to `['1','2','3']`, keyboard only:

```
screen              app screen   focus zone       elements  .album-grid-card
home                home         topnav               152        0
library-albums      library      library-grid         554       72
album-detail        album        album-tracks         141        0
library-artists     library      library-grid         634        0
artist-detail       artist       artist-albums         79        0
library-songs       library      nowplaying-bar       353        0
library-genres      library      library-subnav        89        0
playlists           playlists    topnav                61        0
queue               queue        topnav                61        0
nowplaying          nowplaying   topnav                87        0
search              search       topnav               108        0
settings            settings     topnav               119        0
```

Escape from album detail returns to `library` with focus in `library-grid`
(D39 still holds). Songs tab: 50 rows, focus transfers out after the end.

**Paging the Albums grid to its end by keyboard, with recovery** (Up after an
accidental transfer to `nowplaying-bar`, then continue):

```
real ArrowDown presses                     832
recoveries from an end-of-list transfer    768
wall clock                             758.3 s
final index                                515   "Album 0516"
mounted .album-grid-card                    52
elements under #app                        413
focus-integrity failures                     0  over 832 checks
LazyLoader.observedCount()                  16
ImageCache.size()                          128  (at its cap)
SubsonicAPI.cacheSize()                     22
JS heap                            5 237 993 B
```

**515 is the correct end, not a stall.** The rig partitions 1 200 albums into
seven contiguous blocks; libraries 1–3 hold 172 + 172 + 172 = **516** albums,
verified directly against `window.__MOCK__.albums` (first `Album 0001`, last
`Album 0516`). So Session 4's `AlbumListCursor` delivered every scoped album,
end to end, driven by nothing but the d-pad, with the DOM bounded at 52 cards
and zero detached-focus failures.

**Live server, full keyboard walk of every screen**, real login:

```
screen              app screen   focus zone       elements  ImageCache  apiCache  lazy
home                home         topnav               103        7         4       0
library-albums      library      library-grid         554       63         6      24
album-detail        album        album-tracks         771       63         7       0
library-artists     library      library-grid         634      108         8      67
artist-detail       artist       artist-albums         75      110        10      40
library-songs       library      nowplaying-bar       353      110        11      67
library-genres      library      library-subnav      2453      110        12      67
playlists           playlists    topnav                48      110        12      94
queue               queue        topnav                61      110        12      94
nowplaying          nowplaying   topnav                87      110        12      94
search              search       topnav               108      110        12      94
settings            settings     topnav               119      110        13      94
```

`SonanceUtils.isDebug()` false and `Player.listenerCount()` 5 on every screen
except the Now Playing screen (12) and Queue (8), which subscribe their own.
Only non-2xx across the whole walk: `404 $WEBAPIS/webapis/webapis.js`, the
Tizen-only path. Screenshots `s6-live-*.png`, `s6-mock-*.png`.

**Bundled production build**, `tests/mock-boot.js` injected with `addInitScript`
onto `/index.html?mockAlbums=1200&…`: identical screen/zone/element table to the
unbundled walk, no page errors, and exactly one non-2xx — the same
`404 $WEBAPIS/webapis/webapis.js`. Screenshots `s6-bundled-*.png`; the Settings
shot reads "V3.9", "858 artists" (libraries 1–3 of 7 scoped) and renders
correctly from the minified stylesheet.

### Regression guard at the end of Session 6

```
$ grep -rn "innerHTML" js/*.js js/screens/*.js | grep -v "no innerHTML"
js/screens/nowplaying.js:113:    // Remove all children of a node (safer than innerHTML = '')
   (standing note: a comment, not an assignment)
$ grep -nE "transition: *all" css/styles.css
58:    /* transitions defined per-class; keep no global `transition: all` */
$ grep -nE "transition[^;]*(width|height|margin|padding|left|right|top|bottom|font-size|border)" css/styles.css
   (no hits)
$ grep -n "backdrop-filter" css/styles.css
   (no hits)
$ grep -nE "(^|[^-a-z])gap:" css/styles.css
   (no hits)
$ grep -rn "setInterval" js/
   (no hits)
```

D6 preserved — `transform: translateZ(0)` still on `.album-card`
(`css/styles.css:1816` / `:1830`), `.album-grid-card` (`:2071` / `:2083`) and
`.artist-grid-card` (`:2145` / `:2160`). The line numbers moved down 25 because
T4c deleted the `.placeholder-card` rules above them.

`node --check` clean on both modified sources (`js/api.js`, `js/focus.js`).
`./build.sh` completes; both gates (JS `?.`/`??` on the bundles, CSS
`backdrop-filter` / `transition: all` / bare `gap:` on the packaged sheet) pass
— independently re-run against the shipped artefacts, no hits. `index.html` left
bundled at `?v=v3-9`, `CACHE_BUST="v3-9"`, Settings About row `V3.9`.

Artefact sizes at the end of Session 6:

```
js/sonance-core.min.js       56 210 -> 56 229 B  (gz 18 105 -> 18 123)
js/sonance-screens.min.js   122 102 -> 122 102 B (gz 29 287, unchanged)
css/styles.css (source)      87 448 -> 86 779 B
css/styles.css (packaged)    52 909 -> 52 403 B  (gz 8 411 -> 8 359)
Sonance3.wgt                 76 279 -> 76 261 B  (7 files)
Sonance3-Oblong.wgt         128 324 -> 128 306 B
```

The core bundle grew 19 bytes: `_stableParams` costs more than
`invalidateZone` saved.

## T9 — Credential audit (shape-based, including derived tokens)

A naive whole-token grep is useless on this repo — the account's username and
password are the **same** short common English word, and a whole-token search
returns **216 lines of narrative prose**. The audit therefore tests **value
position** (string literal, HTML `value=`, shell/env assignment, JSON field,
`localStorage.setItem` argument, Subsonic `u=`/`p=` parameter) and separately
verifies every `t=<32 hex>` in the repo against `md5(password + s)`.

Scope: 156 text files plus the members of all four `.wgt` archives (they ship to
the TV). Result **before** this session's fixes:

```
value-position hits   3 x username + 3 x password
  next_prompt.md:69                              [string literal]
  tickets/prompt-3.9.md:57                       [string literal]
  prompts/P15c-fix broken login-prompt.md:10     [subsonic query param u=]
replayable t=<md5>/s=<salt> pairs                0
plaintext p=<password> params                    0
```

Two real findings, both fixed:

1. **`tickets/prompt-3.9.md:57` (and its verbatim copy in `next_prompt.md:69`)
   documented the mock harness as using a user/pass that `tests/mock-boot.js`
   has not used for several sessions** — it seeds `mockuser` / `mockpass`. The
   stale value happened to equal the live account's username *and* password, so
   a stale doc leaked a live credential that nobody ever wrote down as one.
   Corrected to `mockuser` / `mockpass`.
2. **`prompts/P15c-fix broken login-prompt.md:10`** carried a pasted error
   message containing a real `ping.view?u=<live username>&…` URL. `u=` redacted,
   following the D30 precedent.

Result **after**:

```
value-position hits    1 (next_prompt.md:69, replaced by this session's rewrite)
replayable t/s pairs   0
```

`prompts/pre-release-security-scan.md` extended with §1g (derived `t`/`s`
credentials) and §1h (shape-based value-position search), both as a single
quoted-heredoc script — a `node -e '…'` one-liner cannot survive the quoting,
and the version tested here runs correctly straight out of the markdown.

## Observations, not tasks

**`LazyLoader.observedCount()` does not return to zero across a whole-app
walk.** Live: 0 → 24 (Albums) → 0 (album detail) → 67 (Artists) → 40 (artist
detail) → 67 (Songs) → 67 (Genres) → **94 (Playlists), and it stays 94** through
Queue, Now Playing, Search and Settings. `js/app.js:1576` calls
`LazyLoader.unobserveWithin(_pageCurrent)` on every screen deactivation and it
demonstrably works for some transitions (the drop to 0 on album detail) but not
the last one; the in-screen Library tab switches are not covered by that call
site at all. Small and bounded, so not urgent, and **not changed** — Session 3's
`LazyLoader` internals were out of bounds for this session.

**Library → Genres is now the largest unvirtualised screen on the live server**
— 2 453 elements against 554 for the virtualised Albums grid. It is one tile per
genre, so it does not scale with library size the way T2's lists do.

## Reproducing Session 6

```bash
node tests/dev-server.js 8081
# T1   live login, Library -> Songs by keyboard; re-enter in-session and from a
#      fresh page in the SAME browser context (the cold-launch analogue, D-note 6)
# T1   endpoint probe via api._request from the app page (real auth, URLs redacted)
# T2   ?mockSongs=500|5000|14000, Playlists -> Enter -> Enter; MutationObserver on
#      #app for the list, then two rAFs for "first paint"; CPU throttle 6x
# T3   CDP Network.enable BEFORE login; Network.getResponseBody on getStarred2
# T4a  live, seed sonance_selected_libraries to 4/5/6 of 7, search "LOVE" on the
#      on-screen keyboard, then count .search-section-virtual-mount
# T5   page.route('**/js/api.js*') serving the pre-change copy for the before leg
# T8   keyboard walks: mock at scale and live; the albums page-to-end loop must
#      recover with ArrowUp when focus transfers to nowplaying-bar
# T9   the quoted-heredoc script in prompts/pre-release-security-scan.md
```

---

# v3.10

Programme: `tickets/ticket-3.10.md` (spec), `tickets/prompt-3.10.md`
(sessions). Every v3.10 performance claim is a before/after pair in this part.
"Before" is the S1 baseline below. A later session measures "after" with the
same script and, where the code under test has changed, serves the pre-change
files through `page.route` (v3.9 D29 method).

## Measurement environment (v3.10)

| | |
|---|---|
| Harness | Playwright 1.63.0 (project-local `node_modules`), Chromium headless, Node API |
| Viewport | 1920 × 1080, `deviceScaleFactor: 1` |
| CPU | 6× via CDP `Emulation.setCPUThrottlingRate`, applied before boot; 1× where stated |
| Server | `node tests/dev-server.js 8091` (8080 is OrbStack) |
| App | unbundled sources via `/tests/mock-index.html` unless stated |
| Input | keyboard only |
| Scripts | `tests/tools/perf-baseline.js` (numbers), `tests/tools/visual-baseline.js` + `tests/tools/png-diff.js` (pixels) |

Run with `NODE_PATH="$PWD/node_modules" node tests/tools/<script>.js …`.
Absolute Node path on this machine: `/Users/agents/.nvm/versions/node/v24.16.0/bin/node`.

## v3.10 visual baseline (S1 T3)

`screenshots/v3-10/baseline/NN-name.png`: 19 states, at interface size 100%,
captured by `tests/tools/visual-baseline.js <outDir>`:

```
01-home  02-library-albums  03-library-artists  04-library-songs  05-library-genres
06-genre-detail  07-album-detail  08-artist-detail  09-playlists-grid  10-playlist-detail
11-queue  12-search-empty  13-search-query ("TR")  14-settings-top  15-settings-bottom
16-nowplaying  17-nowplaying-lyrics  18-exit-dialog  19-login
```

**Method.** It is fixed, because Session 2's R4 gate needs 0 differing pixels
at 100%:

1. **Fresh context per state.** Fixtures
   `mockAlbums=120&mockArtists=80&mockSongs=400`. `mock-boot.js` is
   deterministic (no `Math.random`).
2. **Playback.** 20 mock songs are queued with `Player.setQueue`, then
   `Player.pause()` and `Player.seekTo(0)` straight away. That leaves no
   progress ticks and no equaliser motion. Auto Now Playing is seeded Off.
3. **Keyboard-only path to each state.** The focus target is the first content
   item after Down from the top nav, unless the state says otherwise.
   - Lyrics: `?mockLyrics=1`, a synced 12-line lyric.
   - Login: `?mockNoSession=1`, no stored session.
   - Settings bottom: Down until `#settings-logout-btn` has focus, then
     `#settings-left.scrollTop = scrollHeight`.
4. **Settle.** 1 s after the last input, then every `<img>` must be
   `complete`. A 400 ms settle was not enough: after a zoom transition the
   NP-bar cover art re-rasters once more, and early captures differed by
   36 px with a max channel delta of 4.
5. **Capture.** `page.screenshot({ animations: 'disabled', caret: 'hide' })`.
   Playwright fast-forwards finite CSS animations and transitions, cancels
   infinite ones (the equaliser bars) to their initial state, and hides the
   caret.

**Determinism check.** Two full independent runs compared with `png-diff.js`
(Chromium canvas `getImageData`):

```
01-home.png  diff 0 / 2073600  maxDelta 0
…            (all 19 states)
19-login.png  diff 0 / 2073600  maxDelta 0
19 pair(s), 0 differing
```

**Refreshed at the end of S1.** T5 added the Advanced section and T6 changed
the About row, both after the first capture. An end-of-session re-capture
against the first one:

```
01–13, 16–19                diff 0 / 2073600
14-settings-top.png         diff 14490 / 2073600  maxDelta 214  bbox 160,117,957,983
15-settings-bottom.png      diff 61397 / 2073600  maxDelta 229  bbox 160,38,1240,926
```

Only the two Settings states moved, and they moved only where S1 intended.
`baseline/` now holds the end-of-S1 capture, so S2 compares against the app
it starts from. The pre-T5 Settings pair is kept in
`screenshots/v3-10/s1-baseline-pre-t5/`.

**S2 usage.**

```
NODE_PATH="$PWD/node_modules" node tests/tools/visual-baseline.js <dir> --scale 1
NODE_PATH="$PWD/node_modules" node tests/tools/png-diff.js screenshots/v3-10/baseline <dir>
```

R4's gate is 0 differing pixels. If anti-aliasing forces a difference, the
limit is ≤ 0.05 % of pixels with a max delta ≤ 8, reported with the diff
bounding boxes. `--scale` seeds `sonance-ui-scale`.

## v3.10 baseline (S1 T4)

`tests/tools/perf-baseline.js`, 2026-10-01, CPU 6×, 3 runs where timing is
involved. All values are from the unchanged v3.9-fix1 code, measured before
any v3.10 behaviour change.

### Grid recycle (R1.6) — `mockAlbums=1200`, one-row Down steps

Method:
- Library → Down into the Albums grid. Each step is one real ArrowDown,
  followed by two rAFs and 200 ms.
- **kept**: the previously mounted `.album-grid-card` nodes still connected
  after the step.
- **created**: elements added under `#app` (MutationObserver, subtree counted).
- **img**: the `<img>` elements among them.

```
cols 8, elements per card 7
step  before  kept  mounted  created  imgs  focus
   1      50    50       50        0     0      8
   2      50    50       50        0     0     16
   3      50    50       50        0     0     24
   4      50    50       50        0     0     32
   5      50     0       72      953   136     40
   6      72    72       72        0     0     48
   7      72     0       72      504    72     56
   8      72     0       72      504    72     64
   9      72     0       72      504    72     72
  10      72     0       68      476    68     80
  11      68     0       80     1065   152     88
  12      80     0       72      504    72     96
  13–15   72     0       72      504    72    104–120
  16      72     0       70      490    70    128
steps that moved the band: 11/16; on those: kept 0 of 50–80, created 476–1065 elements, 68–152 img
```

Every step that moves the band rebuilds all of it. Steps 5 and 11 built it
twice: 953 elements and 136 img against 72 mounted, because the page loader's
`refresh` and the scroll handler each rebuilt it.

R1.6 targets, for S5:
- kept ≥ mounted − 16;
- created ≤ 2 × 8 × 7 = 112 elements;
- img ≤ 16.

`e2e/grid-recycle.spec.ts` encodes these targets as an expected failure.

### Top-nav flick (R1.3) — Home, 4× Right @90 ms

```
run 1–3: library 1, nowplaying 1 → ends on nowplaying     (2 renders; target 1)
```

The first press navigates to Library. Then the 300 ms lock swallows the next
three presses, and the pending-target catch-up renders Now Playing.

### Library sub-nav (R1.3) — Albums tab, Down ×3 @90 ms

Method: count of `.library-loading` nodes added. One is added per
`_loadTabContent`.

```
run 1–3: 3 builds (artists, songs, genres)                (target 1)
```

### Transition drop (R1.2) — Library card #1, Enter then Escape @120 ms

```
run 1–3: ends on album, focus album-tracks[0]             (target: library, library-grid[1])
```

### Keypress → first frame

Method:
- A capture-phase `keydown` listener (installed by `addInitScript`) records
  `performance.now()`. The latency is the time to the second rAF after that.
- Long tasks come from `PerformanceObserver('longtask')`, counted inside the
  window.

```
case                                              median ms   runs               long tasks
top-nav Right (Home → Library)                         44.3   18.1 / 44.3 / 46.3  0 / 0 / 0
Enter album (Library grid → Album)                     19.8   19.6 / 19.8 / 20.2  0 / 0 / 0
Back (Album → Library)                                 32.5   31.9 / 32.5 / 32.6  0 / 0 / 0
Down in Albums grid                                    14.1   14.1 / 16 / 9.6     0 / 0 / 0
Open Now Playing (Enter on album track, auto-NP)       27.6   27.7 / 21.1 / 27.6  0 / 0 / 0
```

This reproduces the planning session's 17–54 ms with 0 long tasks. Script
speed is not the bottleneck on this harness.

### Per-screen render cost (R1.4)

Method:
- **sync**: `XScreen.render` and `XScreen.activate`, each wrapped with
  `performance.now()`. The value is the first visit in a run; the table shows
  the median of 3 runs.
- **nav script / nav task**: CDP `Performance.getMetrics` deltas over a
  700 ms window from the navigating keydown.
  - `ScriptDuration` counts JavaScript only; forced layout inside a script is
    counted separately.
  - `TaskDuration` counts all main-thread work, including the transition's
    own frames.
- The navigation order is fixed: the nav left to right, then album, Library,
  artist and Home.

```
screen      render ms  activate ms  sync total   runs (sync total)    nav script ms  nav task ms
home                0          0.1         0.1   0.4 / 0.1 / 0.1             4.5         66.3   (57 / 66 / 93)
library           0.1          1.2         1.3   1.3 / 0.3 / 1.6            10.1        157.9   (172 / 158 / 156)
search            1.3          0.1         1.7   1.7 / 1.4 / 2               3.8         45.4   (42 / 45 / 46)
playlists         0.1          0.1         1.3   1.3 / 1.5 / 0.1             3.2         30.4   (30 / 30 / 34)
nowplaying        0.3           10        10.2   10.3 / 10.2 / 9.8           7.3         46.8   (50 / 45 / 47)
queue             0.9          2.3         3.3   3.3 / 3.2 / 3.6               6         48.8   (51 / 49 / 49)
settings          4.7          0.9         5.4   5.4 / 5.2 / 6.2               5         29.1   (29 / 31 / 26)
album               0          1.2         1.2   0.9 / 1.2 / 2               4.6         57.4   (57 / 52 / 60)
artist            0.1          1.5         1.6   1.6 / 1.6 / 0.8             6.7         64.5   (64 / 63 / 65)
```

**Finding for S4.** On the mock rig, no screen exceeds 16 ms synchronously at
CPU 6×; Now Playing is the highest at 10.2 ms. The screens build their content
in data callbacks after `activate` returns, so R1.4's "> 16 ms synchronous"
trigger does not fire for any of them.

Where the cost actually is: Library's 158 ms of main-thread task time in the
window. It is the costliest navigation by 2.4× (artist is next at 64.5 ms),
and this rig's grid is only 120 albums. S4 should judge deferral on the
`TaskDuration` column and record the reason (R1.4 allows "cannot get under
16 ms: reason").

### Long lists (R1.7) — v3.9 S6 T2 method re-run

Method (`?mockSongs=N`, 3 runs, median):
- **Playlist detail**: Playlists → Down → Enter.
- **Queue**: N songs queued, Playlists → Right.
- **First paint**: from the opening keydown to the second rAF after N
  (Queue: N − 1) rows are in the DOM.
- **Per keypress**: focus placed 30 rows from the end, then 20 real ArrowDown
  presses. The table gives both the Node-side wall time / 20 and the in-page
  keydown → 2nd rAF median.

```
Playlist detail                      500        5 000       14 000
elements under #app                3 068       30 068       84 050
key → first paint ms                72.1        603.7      1 660.9    (runs 72/74/72, 644/590/604, 1648/1661/1673)
ms per keypress (wall, /20)          2.9         40.7        196.5
keydown → 2nd rAF ms                22.0         41.6        178.4
focus ok after 20 presses            yes          yes          yes

Queue                                500        5 000       14 000
elements under #app                4 071       40 053      112 053
key → first paint ms                98.8        942.9      2 613.6    (runs 98/99/113, 938/943/961, 2607/2614/2662)
ms per keypress (wall, /20)          4.0        128.5        493.9
keydown → 2nd rAF ms                19.9        103.6        337.4
focus ok after 20 presses            yes          yes          yes
```

The element counts match v3.9 S6 exactly (84 050 / 112 053), apart from the
500-row queue (4 071 against 4 097). First paint is 12 % and 9 % below
v3.9's 1 892 ms and 2 868 ms. The 14 000-row Queue press costs 493.9 ms, about 2.5×
the Playlist detail press.

R1.7 targets, for S5:
- ≤ 1 500 elements;
- first paint ≤ 150 ms;
- ≤ 10 ms per press.

### Performance overlay cost (R1.1, S1 — the one "after" in this session)

`e2e/perf-hud.spec.ts`, CPU 1×. Home idle for 5 s, overlay off then on, each
in a fresh context. The measure is the CDP `ScriptDuration` delta, divided by
frames counted by a passive rAF counter that both legs carry.

```
run A: off 9.2 ms / 300 frames; on 11.1 ms / 301 frames; overlay 0.0064 ms per frame
run B: off 8.7 ms / 300 frames; on 11.3 ms / 300 frames; overlay 0.0089 ms per frame
```

Budget: 0.5 ms per frame. When off, the overlay makes 0 `requestAnimationFrame`
calls and 0 `addEventListener` calls (attributed by stack frame), and there are
0 `PerformanceObserver` instances. The positive control finds the overlay's
rAF calls, 1 listener and 1 observer.

## v3.10 S2 — interface size (R4)

S2 makes no speed claim. It changes what is on screen (the default is now
150 %), so this section records (a) that the conversion costs nothing
measurable at 100 %, against the S1 baseline above, and (b) the 150 %
reference that later sessions compare against when they run at the default.
Same script, machine and day as S1.

### R4 identity gate (pixels, 100 %)

`visual-baseline.js <dir> --scale 1 --hide '#settings-ui-scale-row'` then
`png-diff.js screenshots/v3-10/baseline <dir>`. `--hide` removes the new row
before the Settings zones register (ticket §11 S2.2).

```
after the CSS batch (px -> rem, html/body root rules, head script):   19 pair(s), 0 differing
after the JS batch (rem()/px() helpers, applyUiScale, Settings row):   19 pair(s), 0 differing
after D69 (pill re-measure) and D68 (carousel follow):                16 differing, every one inside the pill box:
  02-08 library/album/artist  diff 215  maxDelta 21  bbox 734,28,825,61     pill now [735, w 91] = item
  09-10 playlists             diff 248  maxDelta 21  bbox 827,28,927,61     pill now [828, w 100] = item
  11    queue                 diff 141  maxDelta 23  bbox 929,28,1016,61    pill now [930, w 87]  = item
  12-13 search                diff 164  maxDelta 29  bbox 1150,28,1209,61   pill now [1150, w 58] = item
  14-15 settings              diff 164  maxDelta 29  bbox 1212,28,1271,61   pill now [1212, w 58] = item
  16-17 nowplaying            diff 456  maxDelta 25  bbox 1019,28,1147,62   pill now [1019, w 128] = item
  01 home, 18 exit dialog, 19 login: 0
```

The end-of-S2 capture at 100 %, with the Interface size row visible, is
`screenshots/v3-10/baseline-s2/` (19 states plus `geometry.json`). Later
sessions diff against it, not against `baseline/`.

### Indicators at 100 % (S1 "before" vs S2 "after", CPU 6×)

`SONANCE_SCALE=1 perf-baseline.js --only flick,firstframe,render`.

| Indicator | S1 | S2 |
|---|---|---|
| Keypress → first frame, medians | 9.6–46.3 ms, 0 long tasks | 9.6–32.4 ms, 0 long tasks |
| Sync render + activate, worst screen | ≤ 10.2 ms (Now Playing) | 10.4 ms (Now Playing) |
| Navigation task time, Library / others | 158 ms / 29–66 ms | 152.5 ms / 29.3–64.2 ms |
| Top-nav flick renders | 2 in 3/3 runs | 2 in 2/3 runs, 3 in 1/3 |

The flick was then A/B'd with the D29 method (`page.route` serves every
`css/` and `js/` file from the copy taken at S2 start): **before 1 of 30 runs
rendered 3 screens (library, nowplaying, queue), after 3 of 30**. Both builds
show the same race: whether the fourth press lands inside the 300 ms lock
decides whether the catch-up renders Queue on the way. 1 vs 3 in 30 is not a
measurable difference. R1.3 (S4) removes the lock.

### 150 % reference (S2, CPU 6×) — for S4/S5 "after" numbers at the default

`SONANCE_SCALE=1.5 perf-baseline.js` (all sections, 3 runs).

```
grid recycle (mockAlbums=1200): cols 6, 7 elements per card
  steps that moved the band 14/16; kept 0 of 30-48; created 252-631 elements, 36-90 img
  (steps 1-2 do not move the band: a 150 % row is 315 px)
top-nav flick, 4x Right @90 ms:      library 1, nowplaying 1 in 3/3 runs
Library sub-nav, Down x3 @90 ms:     3 builds (artists, songs, genres) in 3/3
Enter then Escape @120 ms:           ends on album, focus album-tracks[0] in 3/3
keypress -> first frame (median):    nav Right 41.1, Enter album 17.1, Back 27.1, Down in grid 12.4, open NP 24.1 ms; 0 long tasks
sync render + activate (median):     home 1, library 1.7, search 2, playlists 0, nowplaying 11.8, queue 2.9, settings 6.1, album 1.4, artist 1.4 ms
nav task time, 700 ms window:        home 63, library 118.8, search 48, playlists 26, nowplaying 59.1, queue 44.7, settings 28.3, album 50.7, artist 67.4 ms
Playlist detail 500 / 5,000 / 14,000 rows: 3,068 / 30,068 / 84,050 elements; first paint 73 / 586.5 / 1,650 ms; per press 2.8 / 35.8 / 170.2 ms
Queue           500 / 5,000 / 14,000 rows: 4,071 / 40,053 / 112,053 elements; first paint 97.9 / 886.3 / 2,477 ms; per press 3.1 / 124 / 412.9 ms
```

At 150 % R1.6's "≤ 2 × cols cards' worth" is ≤ 84 elements per row step
(6 columns × 7 elements × 2).

## v3.10 S3 — focus and navigation (R6, R3, R9, R5)

S3 claims no speed-up. It changed two things on per-keypress or per-row
paths, and both were measured before/after at the 150 % default, CPU 6×,
with the D29 method: `perf-baseline.js --serve-from <dir>` (new in S3) serves
every `js/` and `css/` file from the copies taken at S3 start through
`page.route`, against the same mock rig and the same harness page.

### Virtual-grid scroll-follow (D76) — `--only grid,firstframe --runs 5`

The Albums and Artists zones now scroll through `virtual.reveal` →
`SonanceUtils.revealInScroller` (a `scrollIntoView` that keeps 24 px × scale
clear for the 1.12 card and its ring) instead of `scrollIntoView`.

| Indicator | Before (S3 start) | After |
|---|---|---|
| Grid row step (`mockAlbums=1200`): steps that moved the band | 14 of 16 | 15 of 16 (the margin scrolls one step sooner) |
| … kept / created per moving step | 0 kept; 252–631 elements, 36–90 img | 0 kept; 252–337 elements, 36–48 img |
| Keypress → first frame, Down in Albums grid (median of 5) | 11.9 ms | 12.2 ms |
| … top-nav Right / Enter album / Back / open NP (medians) | 35.9 / 16.1 / 25 / 24.1 ms | 21.3 / 16.8 / 26.1 / 23.5 ms |
| Long tasks, all cases | 0 | 0 |

The two 631-element steps before S3 (steps 7 and 15) were the double
rebuild S1 noted at the loader boundary (the `refresh` plus the scroll
handler). With the reveal they are single rebuilds (337). R1.6 (S5) still
owns "kept ≥ mounted − 2 × cols": both legs keep 0. The first-frame
differences are inside run-to-run noise (the top-nav case is bimodal in both
legs: 17–18 or 36–44 ms).

### Playlist detail thumbnails (R5, D83) — `--only lists --runs 2`

Playlist rows gained a lazy cover thumbnail. The first version used
`SonanceComponents.renderAlbumArt` and was measured too slow; the shipped
version is a class-styled box with a lazy `<img>`, as the Queue's rows.

| Playlist detail | 500 rows | 5,000 rows | 14,000 rows |
|---|---|---|---|
| Elements under `#app`: before / first try / shipped | 3,068 / 4,569 / 4,069 | 30,068 / 45,051 / 40,051 | 84,050 / 126,051 / 112,051 |
| Enter → first paint, ms | 84.1 / 187.8 / 100.5 | 628.1 / 1,531.4 / 855.9 | 1,661.7 / 4,319.4 / 2,536.9 |
| ms per keypress (wall / 20) | 3.0 / 5.2 / 3.9 | 50.7 / 159 / 124.4 | 191.7 / 519.8 / 438.4 |
| keydown → 2nd rAF, median ms | 22.6 / 20.9 / 20.9 | 47.8 / 134.3 / 100.9 | 188.9 / 440.5 / 356.9 |
| Focus integrity after 20 presses | yes | yes | yes |

The Queue, which has had the same kind of thumbnail since v3, measured
2,493.7 ms / 112,054 elements at 14,000 rows in the same run. At a typical
playlist size (the mockups use 400 tracks) the shipped thumbnail costs
+16 ms of first paint and +0.9 ms per press at CPU 6×. At 5,000–14,000 rows
the list is 1.4–1.5× slower to first paint and 2.3–2.5× per press than before S3, which is what R1.7 (S5)
removes by virtualising the list (targets: ≤ 1,500 elements, ≤ 150 ms first
paint, ≤ 10 ms per press at 14,000 rows). Recorded in `next_prompt.md`
PART B, Session 5.

## v3.10 S4 — navigation speed and transitions (R1.2–R1.5, R2)

Method: as S3. 150 % (the default), CPU 6×, mock rig, unbundled sources.
"Before" is the app at S4 start (= end of S3), served from scratchpad copies
through `perf-baseline.js --serve-from` (D29). Two additions to the script:
- every `XScreen.render` is timed from its start to the second rAF after it
  (`window.__nav`): the navigation's own first frame. With the top-nav dwell
  (R1.3) a Right press renders 180 ms after the keydown, so keydown → frame
  no longer contains the navigation;
- `--dwell-ms 180` adds the dwell to the per-screen table's 700 ms window for
  Left/Right navigations, so the window still covers 700 ms from the render.

### Input and renders (R1.2, R1.3) — `--only flick` (10 runs), `subnav,drop` (5 runs)

| Indicator | Before | After |
|---|---|---|
| Top nav, 4× Right @90 ms | library 1 + nowplaying 1, in 10 of 10 runs | nowplaying 1, in 10 of 10 |
| Library sub-nav, Down ×3 @90 ms | 3 builds (artists, songs, genres), 5 of 5 | 1 build (genres), 5 of 5 |
| Enter on card 1, Escape 120 ms later | ends on the album, `album-tracks[0]`, 5 of 5 (Back dropped) | ends on Library, `library-grid[1]`, 5 of 5 |

### Keypress → first frame — `--only firstframe --runs 5`

```
case                                    keydown → 2nd rAF (median)   render start    render → 2nd rAF (median)
                                        before    after              after keydown   before    after
top-nav Right (Home → Library)          38.7      28.9 (pill only)   184.3 ms        37.3      33.0
Enter album (Library grid → Album)      16.0      26.2               1.9             14.5      25.0
Back (Album → Library)                  25.7      24.4               0.6             25.1      23.7
Down in Albums grid                     9.0       8.8                —               —         —
Open Now Playing (auto-NP; rises in S4) 24.1      29.6               5.6             21.7      24.0
long tasks, every case: 0 / 0
```

Two cases got a heavier first frame, and both carry content they used to
show later:

- **Enter album.** The firstframe sequence leaves the card focused for
  about 400 ms, so R1.5 has already prefetched the album and its tracklist is
  built inside the first frame. A separate probe (5 runs, CPU 6×): with the
  card focused 500 ms, first frame 17.2 → 26.5 ms, but the rows are painted
  at **42.8 → 26.6 ms** after Enter. Focused only 150 ms (no prefetch):
  first frame 24.5 → 22.1 ms, rows painted 60.0 → 56.3 ms.
- **Open Now Playing** (rise): the page under the rising Now Playing stays
  composited until the end, and the ghost is pinned (D98).

### Library's first frame (R1.4 judgement) — probe, 6 runs, CPU 6×

One Right press, Home → Library, measured from the render's start:

```
                      render → 2nd rAF   grid in the DOM   grid painted
before (S4 start)     16.3 ms            38.0 ms           57.2 ms   (runs 63/59/54/56/54/61)
after                 40.2 ms            25.2 ms           40.2 ms   (runs 36/39/47/45/40/41)
same, cover art aborted: before 19.7 ms, after 52.4 ms render → 2nd rAF (images are not the cause)
```

The 180 ms dwell gives the nav's data preload (`_preloadScreenImages`,
V3-6: the same `getAlbumList2` call the tab makes) time to finish, so the
grid is built from the API cache inside the first frame. Before S4 the
preload and the render started together, the tab joined the request in
flight, and the first frame was the empty skeleton. The grid is now painted
17 ms sooner; the slide starts later by the same work.

### Per screen (R1.4) — `--only render`, interleaved before/after, 3 × 2 runs each

Run as three alternating pairs (before, after, before, …) because this
table moved between invocations: the same code measured Now Playing's sync
cost at 10.6–12.1 ms earlier in the session and 13–17 ms here.

```
screen       sync render+activate      nav task (700 ms from the render)   render → 2nd rAF
             before / after (max)      before / after                      before / after
home          0.6 /  0.2  (1.3 / 1.7)   85.0 /  81.5                        34.5 / 31.9
library       2.0 /  1.9  (2.6 / 3.0)  161.5 / 135.5                        21.1 / 42.3
search        2.3 /  2.8  (2.7 / 3.4)   58.0 /  47.5                        21.5 / 20.5
playlists     0.5 /  0.8  (1.0 / 1.3)   32.0 /  33.0                        18.6 / 21.6
nowplaying   14.6 / 14.8 (16.0 / 16.8)  61.5 /  59.0                        27.0 / 25.8
queue         4.0 /  3.9  (4.8 / 5.4)   66.5 /  62.5                        28.1 / 27.0
settings      7.2 /  6.5 (11.7 / 7.2)   39.5 /  41.0                        26.2 / 23.9
album         1.4 /  1.7  (2.5 / 2.3)   70.0 /  58.5                        16.1 / 12.8
artist        1.1 /  1.2  (1.9 / 2.5)   95.5 /  88.0                        25.6 / 23.1
(medians of 6; the before leg's window is 700 ms from the keydown, which is the render)
```

**R1.4 decision (D96): no deferral.**
- The trigger is a synchronous `render` + `activate` above 16 ms at CPU 6×.
  No screen's median is above it. Now Playing is the highest (14.6 → 14.8 ms,
  single runs to 16.0 before and 16.8 after under this host's load); S4 does
  not touch its `activate`. S6 reworks Now Playing and must keep it under
  16 ms.
- Library, judged on task time as ticket §11 S1.5 asks: 161.5 → 135.5 ms with
  the window aligned. Its heavier first frame is the grid arriving sooner
  (above); deferring the grid build would bring back an empty first frame
  and paint the grid later, part-way through the slide.
- What only the TV can say is whether a 40 ms (CPU 6×) first frame delays
  the slide's start visibly there. The overlay's `key` reading after a
  Library navigation is on the TV checklist (`docs/v3-10-report.md` §4).

### Live (bundled build, 150 %, LAN proxy)

```
flick 4x Right @90 ms: 1 render (nowplaying)
Enter card 1, Back @120 ms: Library, library-grid[1] (live getAlbum answered in 9-15 ms)
card focused 700 ms: 1 prefetch, then 0 getAlbum on Enter, 40 rows
Home: Down to the bar from home-newest[2], Enter: rises (translateY, page under at z-index 0);
  Back: sinks (ghost translateY(6rem)), focus home-newest[2] (D95)
sub-nav Down x3 @90 ms: 1 build (genres)
0 page errors, 0 failed responses, 0 proxy failures
```

## v3.10 S5 — lists at scale (R1.6, R1.7, A1)

150 % (the default), CPU 6×, mock rig, D29 method: the "before" leg serves
every `js/` and `css/` file from copies taken at S5 start
(`perf-baseline.js --serve-from <copies>`), against the same harness page and
mock. Three before/after pairs, run alternately (`--only grid,lists --runs 1`
each), because the host's speed drifts. Values are the median of the three.

`perf-baseline.js` (S5): a list that is virtual (`.virtual-list-band` in the
DOM) counts as painted when its first rows are; a list that renders every row
is still timed to its last row. The near-end presses use the list's length,
not the DOM row count. New row: render start → first paint, because the
Queue is opened by Right on the top nav and its key → paint includes the
180 ms dwell (R1.3).

### Grid recycle (R1.6) — `mockAlbums=1200`, one-row Down steps

| Per moving step (15 of 16 steps move the band) | Before (S5 start) | After |
|---|---|---|
| Cards kept of those mounted | 0 of 30–48 | 30–42 of 30–48 (all but the row that left) |
| Elements created | 252–337 | 42–43 (one row of 6 cards × 7; the odd one is the "Loading…" line) |
| `img` created | 36–48 | 6 |
| Steps where the band was built twice (S1's steps 5 and 11) | none at 150 % since S3 | none |

The same in all three runs of each leg. R1.6's bound at 150 % is ≤ 84
elements and ≤ 12 `img` per step. Albums, Artists (300) and the Search
virtual branch are also checked by `e2e/grid-recycle.spec.ts`, with full
traversals both ways (0 failures; `LazyLoader.observedCount()` never above
the lazy images mounted).

### Long lists (R1.7) — `?mockSongs=N`

```
                                  500            5,000           14,000
Playlist detail (Enter → first paint)
elements under #app           4,069 → 199     40,069 → 199    112,051 → 199
key → first paint ms           88.5 → 27.9    798.8 → 50.7    2,404.4 → 84.3
ms per keypress (wall /20)      3.8 → 2.5     120.7 → 2.5       409.6 → 2.3
keydown → 2nd rAF ms           20.7 → 21.8     95.7 → 21.4      344.6 → 21.9

Queue (top-nav Right → first paint)
elements under #app           4,072 → 210     40,054 → 210    112,054 → 210
key → first paint ms          275.6 → 209.5  1,031.3 → 209.9  2,679.4 → 208.8
render start → first paint    100.4 → 28.1     849.1 → 31.8   2,497   → 22.6   (pair 3; the column is new in S5)
ms per keypress (wall /20)      3.7 → 2.5     134.9 → 2.9       402.9 → 2.6
keydown → 2nd rAF ms           22.1 → 22.0    104.0 → 21.6      337.9 → 22.3

focus ok after 20 presses: yes in every run of both legs
```

R1.7's targets at 14,000 rows: ≤ 1,500 elements (199 / 210), first paint
≤ 150 ms (84.3 ms for the playlist; the Queue's 208.8 ms is 180 ms of
top-nav dwell plus 22.6 ms from its render), ≤ 10 ms per press (2.3 / 2.6).
Before, the rows grew the page linearly; after, the cost does not depend on
the list's length.

### Library → Songs at 14,000 (A1) — probe, 3 runs, CPU 6×

The tab had 50 random songs before S5, so there is no "before". From the
sub-nav press (Artists → Songs): rows painted 213.5 / 215.9 / 223.7 ms, of
which 180 ms is the sub-nav dwell (R1.3, D90); from the tab build to rows
painted 23.9 / 26.6 / 33.9 ms, including the count's 20 one-item probes
(instant on the mock; 221 ms on the live LAN for 30,458 songs). 175
elements under `#app`. 20 presses near the end: 2.45 / 2.9 / 2.95 ms each,
ending on index 13,980 of 14,000. The full traversals in `e2e/lists.spec.ts`
(14,000 rows each way for Songs, Playlist detail and Queue) never had more
than 264 elements under `#app`.

### Live (Node-side, LAN)

```
search3 '' total by offset search: 30,458 (24 one-item probes, 221 ms); getScanStatus.count 82,524 (server-wide)
search3 '' paged 500 at a time:    61 pages, 30,458 songs, 30,458 distinct; offset 30,400 -> 58 (the tail)
empty-query order:                 created ascending in 995 of 995 sampled pairs; title 516 up / 479 down
getAlbumList2 paged 500:           alphabeticalByName / alphabeticalByArtist / newest / byYear 3000->0: 2,996 distinct each;
                                   frequent: 0 (no plays on the account); byYear 3000->1: 2,949 (no-year albums left out)
```

## v3.10 S6 — Now Playing (R8, R7, A6, A7, A8)

150 % (the default), mock rig, D29 method: the "before" leg serves `js/`
and `css/` from copies taken at S6 start (`perf-baseline.js --serve-from`).

### Backdrop (R8) — edge luminance, square / landscape / portrait covers

Measured with a probe (session scratchpad `r8-edges.js`): one dev server per
cover shape (`SONANCE_COVER_ASPECT`, ports 8091/8093/8094), a paused track on
Now Playing, everything over the backdrop hidden except its overlay, then the
mean Rec. 709 luminance of the pixels within 50 px of an edge against those
200–250 px in. R8's bound is 10 %.

```
                      blur(60px) before               blur(120px) after
150 % square    150x150   48.0 / 48.0 (-0.0 %)          47.8 / 47.8 (+0.1 %)
150 % landscape 150x100   47.9 / 47.9 (-0.1 %)          47.8 / 47.9 (-0.2 %)
150 % portrait  100x150   48.0 / 48.0 (+0.1 %)          48.0 / 47.9 (+0.2 %)
100 % square    100x100   47.9 / 48.0 (-0.2 %)          47.7 / 47.9 (-0.2 %)
100 % landscape 100x67    47.9 / 47.9 (-0.0 %)          47.8 / 47.8 (-0.1 %)
100 % portrait   67x100   48.0 / 47.8 (+0.3 %)          47.9 / 47.7 (+0.3 %)
worst single side (after): top, 150 % landscape, 41.7 / 44.3 (-5.8 %); before 41.8 / 44.3 (-5.6 %)
computed: filter "blur(120px) saturate(1.3)", transform none, at every size
```

The single-side spread (top darker, bottom lighter, by the same amount
before and after) is the synthetic covers' own vertical gradient
(`tests/dev-server.js` `makePng` shades 0.55 → 1.0 down the image), not edge
darkening: the 25 % overscan is wide enough for a 120 px blur.

### Backdrop (R8) — raster and paint over 3 track changes (informational)

Chromium trace (`devtools.timeline`, `cc`), 3 × `Player.next()` 1 s apart on
Now Playing, 3 runs per leg, CPU 1×, headless (software raster):

```
                                   blur(60px) before         blur(120px) after
RasterTask (raster workers)        358.2 / 383.6 / 405.4     706.1 / 747.5 / 741.4 ms
Paint (main thread)                  3.4 /   3.3 /   4.6       3.7 /   4.2 /   3.5 ms
Display::DrawAndSwap                 8.3 /   8.9 /   9.0       8.4 /   8.4 /   8.5 ms
ImageDecodeTask                      3.9 /   4.1 /   4.1       3.6 /   3.7 /   3.8 ms
```

Raster time about doubles: ~128 → ~247 ms per track change, off the main
thread here. On the Q90R the GPU rasters it; whether it draws at all
(D47 class) and what it costs there are TV checklist items.

### Now Playing render + activate (R1.4) — `--only render --runs 2`, three interleaved pairs

```
            sync render+activate (runs)          nav task ms, 700 ms window     render → 2nd rAF
pair 1      12.6 (12 / 13.1)   -> 14.7 (15 / 14.4)     50.6 -> 91.6                 22.1 -> 25.1
pair 2      13.6 (13.8 / 13.4) -> 14.5 (14.4 / 14.7)   50.1 -> 89.7                 23.4 -> 25.2
pair 3      14.1 (14.9 / 13.3) -> 14.1 (14.7 / 13.4)   50.7 -> 92.6                 22.9 -> 24.7
median      13.6 -> 14.5 ms (max run 15.0)              50.6 -> 91.6 ms              22.9 -> 25.1 ms
```

R1.4's limit holds: no run above 16 ms. The first attempt built the Up Next
strip synchronously: 16.0 / 18.5 / 19.2 ms (it enlarges the forced layout
`activate` already does for the progress bar). The strip's header and tiles
are now built two rAFs later; only its box and the column's position class
are in the first frame.

The 700 ms task time grew by ~40 ms at CPU 6×. Attribution, by serving
variants of the S6 files (two runs each, medians):

```
S5 code (the before leg above)                 50.1-50.7
S6 code, strip display:none, blur(60px)        62.5 / 66.6
S6 code, strip display:none, blur(120px)       79.4 / 80.9     -> the blur: ~15 ms
S6 code as shipped (the after leg above)       89.7-92.6       -> the strip's rendering: ~11 ms
```

The remaining ~14 ms is the rest of the S6 screen (the ⓘ button, the
credits panel's empty box, three more zones, the art cap's re-layout). It
is spread over the frames after the first one; Now Playing's first frame
is 2.2 ms later (render → 2nd rAF 22.9 → 25.1 ms).

## v3.10 S7 — shell and discovery (R11, R10, A3, A4, A5)

150 % (the default), mock rig, CPU 6×, D29 method: the "before" leg serves
`js/` and `css/` from copies taken at S7 start (`perf-baseline.js
--serve-from`), or, for the splash, S7-start's `index.html`.

### Splash (R11) — cost to first paint, bundled build, 6 interleaved runs

A probe (session scratchpad `splash-cost.js`): `/index.html` with
`tests/mock-boot.js` injected and CPU 6×, both legs on the same bundles
(S6's, before S7 rebuilt them), "before" serving S7-start's `index.html` (no
splash) through `page.route`. Medians of 6 per leg:

```
                              before (no splash)   after (splash)
first paint                         58.0 ms            94.0 ms   (the splash is the first frame now)
first contentful paint             124.0 ms           132.0 ms   runs 124/120/128/124/88/140 -> 132/136/132/132/136/128
DOMContentLoaded                    59.7 ms            59.4 ms
load event                          84.3 ms           167.1 ms
first screen (Home) in the DOM     102.4 ms           111.2 ms
usable (splash gone)               102.4 ms         1,509.8 ms   (by design: 900 ms grow + hold, 500 ms exit)
```

The splash costs ~36 ms of first paint (its style, the radial backdrop and
the logo's large text and glow, at CPU 6×) and delays Home's DOM by ~9 ms.
Live (bundled build through the LAN proxy, two boots): first screen in the
DOM at 41 / 152 ms, hold ended at 926 / 927 ms, splash removed at 1,443 /
1,439 ms, i.e. 517 / 513 ms after the hold (R11: ≤ 600 ms, read per
ticket §11 S7.1). Whether the Q90R paints the splash before the bundles
parse is TV checklist item 24.

### Gradient backdrop (R10) — composited layers at rest, Home, CDP LayerTree

```
                          layers   drawing   animations
Solid                       31        25          0
Gradient, position: fixed   33        27          0     +#app-backdrop (1920x1080, "overlaps composited content") +#colour-hint-bar
Gradient, absolute (built)  31        25          0     (D130)
fixed vs absolute screenshot: 1 pixel differs, by 1/255
```

Now Playing with Gradient against Solid (the opaque base, D132): every pixel
within 2/255 (`e2e/backdrop.spec.ts`).

### Home (A4) — `--only render --runs 2 --dwell-ms 180`, three interleaved pairs

```
home           sync render+activate (runs)   700 ms task (runs)      render -> 2nd rAF (runs)
pair 1 before   0.1 ms  (0.1 / 0)              82.6 ms (71 / 95)        28.0 ms (30.9 / 25.1)
pair 1 after    0.3 ms  (0 / 0.7)              91.2 ms (75 / 108)       32.3 ms (32.3 / 32.3)
pair 2 before   0.7 ms  (1.3 / 0.1)            86.9 ms (90 / 84)        28.6 ms (25.7 / 31.4)
pair 2 after    0.8 ms  (0.1 / 1.4)            78.8 ms (67 / 91)        30.2 ms (31.9 / 28.4)
pair 3 before   1.3 ms  (1.5 / 1)              78.1 ms (70 / 86)        31.8 ms (31.9 / 31.7)
pair 3 after    0.6 ms  (0.1 / 1.1)            93.9 ms (88 / 100)       30.7 ms (32.2 / 29.3)
all 6 runs      median 0.6 -> 0.4 ms            85.0 -> 89.5 ms          31.2 -> 32.1 ms
```

Home's synchronous render does not grow (it builds skeletons; the three
hidden sections are display: none). The first frame is within the run
spread (25–32 ms). The three rows' 18 cards are built after it, inside the
700 ms window (+4.5 ms of task time, median). `e2e/home-rows.spec.ts`
asserts that their requests go out after Home's first frame and Home's own
before it.

### Hold-OK (A5) — `--only firstframe --runs 3`, two interleaved pairs

```
                                           keydown -> 2nd rAF          render starts after keydown
                                           before -> after (medians)   before -> after
Open Now Playing (Enter on an album track)  22.2 / 35.5 -> 22.8 / 23.4   6.3 / 6.0 -> 6.8 / 7.0 ms
Enter album (grid card, no onLongPress)     26.8 / 26.8 -> 26.1 / 26.4   2.1 / 1.7 -> 2.1 / 1.7 ms
Back, Down in grid, top-nav Right           unchanged within the run spread
```

A track row now activates on keyup: in Playwright the keyup follows the
keydown within a millisecond, so the render starts ~0.7 ms later. On the TV
the delay is the length of the press (TV checklist item 28).

### Focus clip (D76) — `tests/tools/focus-clip-sweep.js`, 120 states per size

S7 adds the options sheet and its credits view to the sweep (the new Home
rows and the playlist cards come in through the zones it already walks).

```
first run after the S7 surfaces: scale 1: 1 clipped (first playlist card's ring, 2.6 px at the grid's top)
                                 1.25: 2 (the card 3.1 px; the sheet's first row 0.6 px)   1.5 / 1.75 / 2: 1 (the sheet's row, 0.7-0.9 px)
after the room (grid padding-top 3.2rem, sheet body padding 0.4rem):
                                 scale 1: 0   scale 1.25: 0   scale 1.5: 0   scale 1.75: 0   scale 2: 0
```

## v3.10-fix2 — TV-test fixes (F1, F6, F7)

150 % (the default), CPU 6× via CDP, Chromium headless 1920×1080. "Before"
is the app at fix2 start (= V3.10-fix1), served from copies taken at
session start through `page.route` (D29) or, for the splash, the variants
patched in memory into the served `index.html`. Probes are in the session
scratchpad (`splash-trace.js`, `splash-layers.js`, `np-firstframe.js`,
`np-layers.js`).

### Splash (F6, D160) — raster per phase, bundled build, 3 runs per variant

`/index.html` with `tests/mock-boot.js` injected, `splash: 'real'`; CDP
tracing (`RasterTask` on the raster workers, `Paint` on the main thread,
`DrawFrame`), phases marked by the splash's own animation events (grow =
`splash-in` start + 450 ms, hold, exit = `splash-out` start, gone = removal).

```
variant                         raster tasks (ms)   grow / hold / exit tasks     grow / hold / exit ms     main-thread paints
A  V3.10-fix1 (exit 2.2)        428 (144.7)         242 / 80 / 106               ~60 / 13 / ~71            88 (31.5 ms)
B  + will-change on the logo    436-452 (~151)      250-266 / 80 / 106           64-73 / 13-16 / 72-74     82
E  glow removed                 382 (77.3)          236 / 80 / 66                ~55 / 12 / 8              87
G  glow as an unscaled layer    400 (78.7)          254 / 80 / 66                53-62 / 12-15 / 9         88
F  exit 1.4 (shipped, D160)     322 (72.4-77.7)     242 / 80 / 0                 54-64 / 12-14 / 0         85-87
all variants: 0 main-thread tasks > 50 ms during the splash, 0 composite failures, largest frame gap 17-36 ms (grow) / 18-25 ms (exit)
```

Layers (CDP LayerTree, snapshots in the grow, hold and exit; before = after):
`#splash` 1920×1080 and `.splash-logo` 757×829 (150 %) in the grow, the
hold and the exit; the earliest snapshot in the grow can show `#splash`
alone (the animation's layer is created as it starts compositing).
`will-change` changed neither the layers nor the raster. What a variant
changes is the exit: at 2.2× the logo, its 10rem wordmark and the 8rem
blurred glow re-rasterise at 2.2× as the exit begins (~71 ms of raster-worker
time here, ~63 ms of it the glow); at 1.4 nothing re-rasterises. Shipped:
the exit scale only (stills: the hold is unchanged, the glow-layer variant
visibly weakened the halo). The TV decides whether the grow (rasterised once
at the start) is smooth: checklist item 11.

### Now Playing from the bar (F1, D152) — keydown → first frame, 5 interleaved runs

Library → Down to the bar's "open Now Playing" → Enter (the rise), mock rig,
CPU 6× set after boot, keydown (capture) → second rAF; "before" = fix1's
`js/` and `css/` through `page.route`.

```
            keydown -> 2nd rAF (median, runs)                        render -> 2nd rAF   ghost fade first seen (ms after keydown)
before      41.6 ms (38.6 / 42.6 / 45.1 / 29.8 / 41.6)                37.7 ms            - (the ghost stays at 1, then is removed)
after       36.9 ms (41.3 / 32.3 / 31.0 / 43.6 / 36.9)                34.2 ms            114 / 100 / 103 / 109 / 100
```

Informational: the fade adds no first-frame cost (the difference is inside
the run spread). The fade starts with Now Playing's first frame, ~100 ms
after the keydown at CPU 6×; on the TV that frame is slower (the 120 px
backdrop, R8), and the old page holds until it, then fades with the rise.
At 1× (the e2e sampler): the ghost reads 0.73 at 83 ms, 0.21 at 128 ms,
0.002 at 286 ms, removed at 298 ms; the sink's page 0.51 at 82 ms, 1 at
303 ms.

### Focus mode (F7, D159) — composited layers on Now Playing at rest, CDP LayerTree

The R10 method (a no-op style change on `<body>` so the tree is reported),
Now Playing with a paused queue, 150 %. FocusManager gives each focused
element `will-change: transform` (up to 5), so the focus path matters:

```
state                                            layers   drawing   the dim's own layer   running animations
fresh, focus on Play: before (fix1)                16        13        -                    0
fresh, focus on Play: Focus off                    16        13        none (not rendered)  0
fresh, focus on Play: Focus on (stored)            16        13        none                 0
walked Right x6 along the row: before (fix1)       18        15        -                    0
walked Right x6: Focus off                         18        15        none (not rendered)  0
walked Right x6, Enter: Focus on (faded in)        19        16        div.np-focus-dim     0
walked Right x6, Enter x2: off again               18        15        none (not rendered)  0
```

Nothing animates at rest. Focus off is the old Now Playing: the overlay is
`display: none` (D159). A first build kept it at opacity 0, and then it took a
layer of its own once buttons below it had been promoted (19 against 18)
and moved the translucent top nav's blend over the backdrop by up to 6/255
(128 px at 100 %, found by the visual gate, gone with the overlay removed).
On, it adds one layer when it lies over promoted buttons: a single solid
colour (black), which Chromium draws without raster tiles. `.np-bg-image`
is unchanged (D47); whether the dim is even and the backdrop steady on the TV
is checklist item 9.

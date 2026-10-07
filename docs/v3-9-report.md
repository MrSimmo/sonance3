# Sonance v3.9 — the non-performance report

**Written 2026-09-04, v3.9 Session 6 (the last of the programme). Opus 5 @ xhigh.**

The five preceding sessions fixed the three problems you reported on the TV and
the one defect that was hiding your music. This document covers what is *left*:
things that are not performance bugs, that I found while measuring, and that
need a decision from you rather than a unilateral change from me.

Everything below is measured. Where a number could not be measured I say so
rather than estimating quietly. Method for every figure is in
`docs/perf-baseline.md` §"Session 6 results".

**Rig.** `node tests/dev-server.js 8081`, Playwright 1.62.1 headless Chromium,
viewport 1920×1080, deviceScaleFactor 1, keyboard only. The live server is
Navidrome 0.63.2 (`openSubsonic: true`) at `http://192.168.0.2:4534`, seven
libraries, 7 119 albums. Performance figures are at CPU throttle 6×, which
approximates the 2019 SoC.

**Two fixes were made this session**; everything else is a recommendation.
They are §5 (cache-key ordering) and §4 (two pieces of dead code deleted).

---

## 1. Library → Songs shows 50 random songs and cannot reach the rest

**This is the most user-visible gap left in the app, and it is a functionality
gap, not a rendering one.**

`js/screens/library.js` `_loadSongs` calls `getRandomSongs(50, libraryIds)`.
There is no pagination, no `hasMore` path, and no offset — `getRandomSongs.view`
does not have one.

### Measured on the live server

| | |
|---|---|
| Rows the Songs tab renders | **50** (50 distinct) |
| Rows after 70 `ArrowDown` presses from row 1 | **still 50**; focus transferred out of the grid to `nowplaying-bar` |
| Any d-pad path to song 51 | **none** |
| Re-entering the tab in the same session (Albums → Songs) | the **same 50** — overlap 50 of 50 |
| Re-entering after a fresh app launch | a **different 50** — overlap **0 of 50** |
| Songs in the library | 14 000+ |

Screenshot: `screenshots/v3-9/s6-t1-live-songs.png` — the list ends at row 50
("Carry My Love") with nothing beneath it.

The within-session stability is not a design choice; it falls out of
`_cachedRequest`'s 5-minute in-memory TTL. So the set is stable for five
minutes, then silently becomes a different 50 while you are looking at it.

### Genres are the same, and worse

`_loadGenreSongs` calls `getSongsByGenre(genreName, 50, 0, libraryIds)` —
count 50, **offset hard-coded to 0**, no pagination.

| | |
|---|---|
| Largest live genre | **Dance, 5 225 songs** |
| Rows the genre detail renders | **50** |

Screenshot: `screenshots/v3-9/s6-t1-live-genre.png`.

### Recommendation

**Use `search3.view` with an empty query and `songCount` / `songOffset`.** I
tested this against your server rather than assuming it:

```
search3.view?query=&songCount=50&songOffset=0      -> 50 songs
search3.view?query=&songCount=50&songOffset=50     -> 50 songs
search3.view?query=&songCount=50&songOffset=5000   -> 50 songs
overlap between offset 0 and offset 50             -> 0 songs
repeating offset 0 returns a byte-identical set    -> yes (stable ordering)
```

That is a stable, complete, gap-free enumeration of every song, paginated. It
is the only endpoint on this server that does the job:

- `getRandomSongs.view` has **no offset at all**; `size` is the only lever
  (I confirmed `size=500` returns 500), and the order is random per call, so
  it can never back a browsable list.
- `getAlbumList2` + `getAlbum` fan-out would work but costs one request per
  album — **7 119 requests** to enumerate this library. Not viable.
- Navidrome 0.63.2 reports these OpenSubsonic extensions: `songLyrics`,
  `indexBasedQueue`, `transcoding`, `playbackReport`. **None of them help with
  song pagination.**

**The Genres case is much smaller and nearly free.** `getSongsByGenre.view`
*already* accepts and honours `offset` — the client simply never asks:

```
getSongsByGenre.view?genre=Dance&count=50&offset=0    -> 50 songs
getSongsByGenre.view?genre=Dance&count=50&offset=50   -> 50 songs
overlap                                               -> 0 songs
```

So genre songs need a `PaginatedLoader` and nothing else server-side.

### Whatever is built, build it on `VirtualGrid` from day one

A "show all songs" list is 14 000 rows. §2 below measures exactly what an
unvirtualised list of that size costs, and the answer is that it is not
usable. There are two worked examples already in the codebase:

- **Virtualising against `PaginatedLoader`** — the Albums tab, Session 2
  (`js/screens/library.js`, the `virtual: { getCount, getItemAt }` focus-zone
  contract, and `SonanceUtils.VirtualGrid` in `js/utils.js`).
- **Paginating across several libraries without losing rows** — Session 4's
  `SubsonicAPI.prototype.createAlbumListCursor` in `js/api.js`. The Songs tab
  has exactly the same multi-library problem the Albums tab had: with 2–6 of
  your 7 libraries scoped, a naïve shared offset silently drops whole
  libraries. Use the cursor, do not re-derive it.

**Do not ship a flat 14 000-row song list.** Note also that `_mergeSongLists`
caps the merged result at `size`, so today's 50 is 50 *in total* across every
scoped library, not 50 per library.

---

## 2. Playlist detail and Queue render every row — measured

`js/screens/playlists.js` `_renderDetail` and `js/screens/queue.js` both build
every row in one synchronous `forEach`. Since Session 2 virtualised Albums,
**these two are the worst grids in the app.** A Navidrome smart playlist over a
14 000-song library is a realistic worst case, and `getPlaylist.view` returns
the whole entry list.

Mock rig, CPU throttle 6×, one browser context per run, median of three runs
for the timings and the heap. Screenshots
`screenshots/v3-9/s6-t2-{playlist,queue}-{500,5000,14000}.png`.

### Playlist detail (`#playlist-songs .song-row`)

| | 500 tracks | 5 000 tracks | 14 000 tracks |
|---|---|---|---|
| Rows rendered | 500 | 5 000 | 14 000 |
| Elements under `#app` | 3 068 | 30 068 | **84 050** |
| Enter → first paint | **88.9 ms** | **642.7 ms** | **1 892 ms** |
| `LayoutCount` for the render | 2 | 2 | 3 |
| `RecalcStyleCount` for the render | 2 | 3 | 3 |
| JS heap, median of 3 | 2 566 874 B | 4 191 784 B | **7 655 345 B** |

### Queue (`#queue-list .queue-row`)

| | 500 tracks | 5 000 tracks | 14 000 tracks |
|---|---|---|---|
| Rows rendered | 499 | 4 999 | 13 999 |
| Elements under `#app` | 4 097 | 40 053 | **112 053** |
| Nav keypress → first paint | **132.2 ms** | **963.3 ms** | **2 868 ms** |
| `LayoutCount` for the render | 1 | 2 | 2 |
| `RecalcStyleCount` for the render | 4 | 5 | 5 |
| JS heap, median of 3 | 2 796 208 B | 5 358 856 B | **10 558 972 B** |

### D-pad at the bottom of the list

20 real `ArrowDown` presses with focus 30 rows from the end (the *position* was
set programmatically because pressing Down 13 970 times is not a test; the 20
measured presses are genuine keyboard input):

| | 500 | 5 000 | 14 000 |
|---|---|---|---|
| 20 `ArrowDown` presses | **67 ms** | **994 ms** | **4 467 ms** |
| per keypress | 3.4 ms | 49.7 ms | **223 ms** |
| focus still connected and in the list | yes | yes | yes |

Focus never breaks. It just becomes unusable: at 14 000 tracks each d-pad press
costs about a fifth of a second, so holding Down does nothing recognisable for
several seconds.

`LayoutCount` stays flat because nothing reads layout during the build — the
cost is entirely element construction, style recalculation at paint, and
retained memory, which is why the wall-clock and heap rows are the ones that
matter.

### Recommendation

**Virtualise both above roughly 750 rows.** The threshold comes from the
measurements: at 500 rows the screen paints in 89–132 ms and a keypress costs
3.4 ms, which is fine on a TV; by 5 000 the screen takes about a second to
appear and a keypress costs 50 ms, which is visibly laggy; 14 000 is unusable.
750 rows lands comfortably inside the good regime with headroom for the slower
real SoC.

Both screens are simple single-column lists, which is the easiest possible
`VirtualGrid` case (`columns: 1`), and Session 5's T7 already delegated the
queue's row clicks to the container, so recycled rows need no per-row listener
bookkeeping. **Queue first** — it is the one a user reaches by accident, by
playing a large playlist.

---

## 3. `getStarred2` is unbounded — but your account has nothing starred

`js/starred.js:36-64`. There is no size parameter in the Subsonic API, so the
call returns **every** starred item. It runs on every app start and on every
library change, and `getStarred2.view` is not in `js/api.js`'s `LS_ALLOWLIST`,
so there is no cold-launch reuse. (The duplicate concurrent call was already
removed in Session 3 T7.)

### Measured on the live server, at app start

| | |
|---|---|
| `getStarred2.view` requests at app start | 1 |
| Encoded response size | **690 B** |
| Response body | **145 characters** |
| Wall clock, request to `loadingFinished` | **43.4 ms** |
| Starred songs / albums / artists on the test account | **0 / 0 / 0** |

**So today this costs nothing, and I cannot show you the problem with your own
data.** I did not star anything to manufacture a payload — that writes to your
server. What I can measure is the cost per item, from real responses on the
same server:

| | bytes of JSON per item |
|---|---|
| album | **876** |
| song | **1 298** |

A user with 500 starred songs and 200 starred albums would therefore pull
roughly **825 KB on every app start**, and again on every library change. With
2–6 of 7 libraries scoped the call **fans out to one request per library**, each
one unbounded, so that figure multiplies.

### Recommendation — worth doing, and cheaper than the `getArtists` case

`StarredCache.load` is the **only** consumer of `getStarred2`, and it reads
exactly one field off each item:

```js
data.song.forEach(function(s) { if (s && s.id) _songs[s.id] = true; });
```

So the projection is not "four fields" as it was for `getArtists` (S3 T5's
`LS_ARTIST_FIELDS`) — it is **`id` alone**, for all three collections. An id is
about 32 characters against 876–1 298 bytes for the whole object, so the same
500-songs-plus-200-albums user would persist roughly **22 KB instead of
825 KB**.

Concretely: add `'getStarred2.view'` to `LS_ALLOWLIST` and extend
`_projectForLs` with a `getStarred2.view` branch returning
`{ starred2: { song: [{id}], album: [{id}], artist: [{id}] } }`.

**I have not made this change, because adding an endpoint to the localStorage
allowlist is a behaviour change**: starred state would then survive a cold
launch for up to `LS_TTL` (24 h), so a star added on your phone would take up
to a day to show on the TV unless the TTL is shortened for this endpoint. That
trade-off is yours. If you would rather not carry stale favourites, the
alternative is to leave it alone — at 0 starred items it costs you nothing
today.

---

## 4. Dead code — two of the four were real, and one was not dead at all

### 4a. The Search `VirtualGrid` branch — **NOT dead. Do not delete it.**

The brief for this session said the branch was unreachable, on the grounds of
"`SEARCH_VIRTUAL_THRESHOLD = 30` against a hard server-side cap of 25 results".
**That premise is wrong**, and I checked before deleting.

`js/screens/search.js:274` asks for `artistCount: 5, albumCount: 10,
songCount: 10` — 25 maximum. But `SubsonicAPI.prototype.search3` **fans out one
request per scoped library** and `_mergeSearchResults` concatenates and
de-duplicates without re-capping. So the per-section totals scale with the
number of libraries you have ticked.

Measured live, query `LOVE`, typed on the on-screen keyboard by d-pad:

| libraries scoped | app's own "Results (n)" | rows in the DOM (artist / album / song) | DOM total | virtual sections mounted |
|---|---|---|---|---|
| all 7 (normalises to `null`) | 25 | 5 / 10 / 10 | 25 | 0 |
| 1 of 7 | 25 | 5 / 10 / 10 | 25 | 0 |
| 3 of 7 | 70 | 13 / 27 / 30 | 70 | 0 |
| **4 of 7** | **82** | 13 / 29 / 18 | 60 | **1** |
| **5 of 7** | **100** | 18 / 18 / 18 | 54 | **2** |
| **6 of 7** | **104** | 18 / 18 / 18 | 54 | **2** |

Screenshot `screenshots/v3-9/s6-t4-live-search-4libs.png` reads
**"RESULTS (82)"**. The DOM total is lower than the header from four libraries
onward precisely because a section has been virtualised and only its mounted
band exists — which is the branch doing its job.

So the branch fires in ordinary use as soon as you scope to four or more
libraries and search a common word. **Deleting it would have introduced the
exact unbounded render that §2 is about.** It stays, and this is now written
down so the next reader does not repeat the assumption.

### 4b. `FocusManager.invalidateZone` — dead. **Deleted.**

Defined at `js/focus.js:133`, exported at `:672`, and referenced **nowhere
else** — not in `js/`, `css/`, `tests/`, `docs/`, or either minified bundle
source. Removed, definition and export.

### 4c. `.placeholder-card` in `css/styles.css` — dead. **Deleted.**

Two rules at `css/styles.css:1226` and `:1240`. No JavaScript constructs the
class, no HTML file contains it, and nothing builds the name dynamically.
Removed. As a side effect this also removes a static `will-change: transform`,
which is the kind of always-on layer promotion Session 1 T4 spent time
stripping out.

### 4d. `LazyLoader.disconnect` — dead, and **deliberately kept**.

Defined at `js/image-cache.js:480`, exported at `:497`, called from nowhere.
Session 3 added the per-element (`unobserve`) and per-subtree
(`releaseWithin` / `unobserveWithin`) paths that are actually used and left
`disconnect` alone on purpose. The brief said not to touch it without your say,
so it stays. It is four lines; the cost of keeping it is nil.

---

## 5. Cache keys were insertion-order sensitive — **fixed**

`js/api.js` `_memKey` built its key with `JSON.stringify(params)`, which walks
an object's own keys in insertion order. Two callers constructing the same
logical parameters in a different order therefore produced two different cache
entries for one request — a silent miss, never a wrong answer, and invisible
when it happens. `_lsKey` is derived from `_memKey`, so there was exactly one
place to fix.

Replaced with a sorted-key serialiser (`_stableParams`). Before and after,
measured by route interception against the pre-change file so both run in one
process:

```
BEFORE   _memKey('getAlbumList2.view', {type:'alphabeticalByName', size:50, offset:0})
         ...|getAlbumList2.view|{"type":"alphabeticalByName","size":50,"offset":0}
         _memKey('getAlbumList2.view', {offset:0, size:50, type:'alphabeticalByName'})
         ...|getAlbumList2.view|{"offset":0,"size":50,"type":"alphabeticalByName"}
         distinct keys: 2

AFTER    both calls
         ...|getAlbumList2.view|{"offset":0,"size":50,"type":"alphabeticalByName"}
         distinct keys: 1
```

The cache does not grow as a result. After an identical fixed keyboard walk
(Library → all four tabs → Playlists → Queue → Search → Settings → Home) on
both builds:

```
                       before   after
SubsonicAPI.cacheSize()    24      24
localStorage API entries    9       9
```

One consequence, noted in the code: a stored localStorage entry whose params
were not already alphabetical is renamed by the sort and becomes an orphan. No
cache is lost — the orphan expires on the 24-hour TTL or is reclaimed by
`_lsPrune`, and the data is simply re-fetched once.

---

## 6. Four decisions that are yours, not mine

None of these are implemented. Each carries the evidence and what would unblock
it.

### 6a. Abort in-flight API requests when a screen deactivates (S3 T8b)

**Recommendation: do it, but only with per-screen request tags.**

`SubsonicAPI.abortAll()` is wired to logout and `applyLibraryChange` only.
Wiring it to every screen teardown converts results that screens currently
discard silently into rejections across ten `.catch` handlers that behave
differently — `js/screens/artist.js:515` raises a global
`App.showToast('Unable to load tracks')`, which would then fire for a screen
the user had already left.

*Unblocking condition:* a decision on whether an aborted load should reject or
resolve empty, plus agreement to tag each `_request` with its issuing screen.

### 6b. Back from a deep album cannot restore grid focus beyond the first page (S2 NEW-3)

**Recommendation: retain the loaded page count across a drill-down.**

`goBack` re-activates `LibraryScreen`, which rebuilds the Albums tab from
offset 0, so a saved index of 600 clamps to the roughly 49 items then loaded.
Measured identically on the pre-Session-2 build, so it is **pre-existing, not a
virtualisation regression**, and it reproduced again in Sessions 5 and 6.

*Unblocking condition:* both options change navigation behaviour, so you pick —
retain the page count, or have the restore path page forward to the saved index.

### 6c. Selecting *all* libraries normalises to `null` (S4 NEW-4)

**Recommendation: no change; just know it.**

`SubsonicAPI._normaliseLibraryIds` collapses a full selection to "all
libraries", which takes the single unscoped request path. That is why Session
4's pagination defect was severe for anyone scoping to 2–6 of 7 libraries and
literally unreachable for anyone with all 7 ticked. §4a above is the same split
seen from the other side: the Search fan-out only happens when you scope.

*Unblocking condition:* none — informational.

### 6d. The merged album order is not globally sorted (S4 NEW-5)

**Recommendation: accept it.**

Each library's page arrives in Navidrome's own collation. The client comparator
matches it to within 0.47 % of adjacent pairs but not exactly, so a k-way merge
over those streams cannot be perfectly ordered — **2 adjacent inversions in
1 249 loaded albums** on your server, down from 32. Completeness is unaffected;
the cursor never discards a row.

*Unblocking condition:* a real fix needs a sort key the Subsonic API does not
expose, so this only reopens if Navidrome starts exposing one.

---

## 7. Repo hygiene — a proposal. Nothing was deleted.

The repository is **170 MB**. The app is **252 KB**.

| what | count | size |
|---|---|---|
| Loose `.png` at the project root, excluding the two build inputs | **191 files** | **62 MB** |
| `.playwright-mcp/` — stale tooling output | 652 entries | **11 MB** |
| `screenshots/` — session verification shots (`screenshots/v3-9` alone is 91 MB) | 185 entries | **93 MB** |
| Stale build artefacts `Sonance3udEx.wgt`, `Sonance3uDYB.wgt` | 2 files | 204 KB |
| `.DS_Store` (root, `js/`, `tests/`, `tickets/`) | 4 files | — |

**None of it ships.** `build.sh` names its inputs explicitly, and the
`Sonance3.wgt` listing proves it — 7 files, 252 318 bytes:

```
config.xml, icon.png, index.html,
js/sonance-core.min.js, js/sonance-screens.min.js, css/, css/styles.css
```

### Proposed `.gitignore` change

D8 keeps `.gitignore` narrow on purpose and lists the broader sweep commented
out. I have **not** uncommented it. This is what I would uncomment, with one
correction:

```diff
 # --- Proposed by Session 1, for Session 6 / the user to confirm -------------
-# Uncomment once the corresponding files have been swept or accepted as
-# untracked. Listed here so the analysis is not lost.
-#
-# *.wgt                        # build output of build.sh
-# js/sonance-core.min.js       # generated bundle
-# js/sonance-screens.min.js    # generated bundle
-# screenshots/                 # session verification screenshots
-# .playwright-mcp/             # 11 MB of stale tooling output
-# /*.png                       # ~190 loose PNGs at the project root (62 MB)
-# node_modules/
+*.wgt                        # build output of build.sh
+js/sonance-core.min.js       # generated bundle
+js/sonance-screens.min.js    # generated bundle
+screenshots/                 # session verification screenshots (93 MB)
+.playwright-mcp/             # 11 MB of stale tooling output
+node_modules/
+
+# 191 loose PNGs at the project root (62 MB). icon.png and icon-oblong.png
+# are BUILD INPUTS — build.sh reads both — so they must be re-included or a
+# fresh clone cannot produce a .wgt.
+/*.png
+!icon.png
+!icon-oblong.png
```

**The `!icon.png` / `!icon-oblong.png` negations are not optional.** A bare
`/*.png` would untrack both build inputs, and `build.sh` would fail on a clean
checkout.

### Suggested sweep, if you want the disk back

Nothing here is destructive to the app, but it is your call and I have not run
any of it:

1. Move the 191 root PNGs into `screenshots/archive/` rather than deleting them
   — they are the visual record of phases P1–V3.8. That reclaims nothing but
   makes the root readable.
2. Delete `.playwright-mcp/` (11 MB). It is output from the MCP Playwright
   server, which is broken in this environment anyway and unused since April.
3. Delete `Sonance3udEx.wgt` and `Sonance3uDYB.wgt` — superseded builds from
   26–27 April. `Sonance3.wgt` and `Sonance3-Oblong.wgt` are the current ones.
4. Leave `screenshots/v3-9/` alone until you have finished the TV test list
   below; it is the before/after evidence for the whole programme.

---

## 8. The manual TV test list

Ten minutes on the Q90R. **Six of these are things no browser can verify at
all** — they are marked ⚠ and each says what a failure would mean.

Install `Sonance3-Oblong.wgt` (128 324 B) — it shares the `tizen:application`
id with `Sonance3.wgt`, so it replaces rather than adds an install.

| # | Test | A failure means |
|---|---|---|
| 1 ⚠ | **Play a track.** AVPlay opens, prepares, plays, seeks, stops, closes. | The AVPlay lifecycle in `js/player.js` is wrong on real hardware. Nothing plays. |
| 2 ⚠ | **Play a FLAC, then an MP3, then change track between two of different codecs.** | The TV's hardware decoder is not being re-initialised between formats — audible as silence or a stall on the second track. |
| 3 ⚠ | **Hold Next down for several seconds.** Then Next, then immediately Previous. | Session 4's **load-generation guard (T2)** is not holding. Symptom: the track that finally plays is not the one on screen. Verified against `tests/avplay-stub.js` only — `webapis.avplay` does not exist in a browser, so this has **never run on real hardware**. |
| 4 ⚠ | **Pull the network (or stop Navidrome) mid-playback, then restore it.** | Session 4's **error-cascade cap (T3)** is not holding. Symptom: instead of one "playback failed" toast after three attempts, the app tears through the whole queue. Also stub-verified only. |
| 5 ⚠ | **Open an album that is playing and watch the equaliser bars.** | Session 5 T1 rewrote them from animating `height` to `transform: scaleY()`. Compositor-animated in Chromium; if the TV's GPU path differs they will stutter or sit at zero height. |
| 6 ⚠ | **Visit all seven screens** — Home, Library (all four tabs), Playlists, Queue, Now Playing, Search, Settings. | Session 5 T11 ships a **minified stylesheet in the `.wgt` for the first time** (87 448 → 52 909 B). A minifier bug shows up as a broken layout on one screen only. |
| 7 ⚠ | **Check the app icon on the TV's app row.** | Session 5 T13 re-encoded `icon-oblong.png` (175 772 → 71 505 B). Verified as pixel-identical through two independent decoders, but not through Tizen's. |
| 8 | Log out from Settings, log back in, then play something. | Session 2's `settings-actions` d-pad fix, or Session 4's listener guard, is not surviving on-device. |
| 9 | Scroll Library → Albums a long way with the remote, then Back out of an album. | Session 2's virtualisation. Bounded DOM should keep this smooth all the way down; §6b explains why Back will not restore a deep position — that is known, not a new fault. |
| 10 | Leave a long queue playing for 30+ minutes, then use the remote. | A memory or handle leak that only shows on the device. |

One more, informational: **Session 5 T9's `removeAttribute('src')`**. The
*condition* older Chromium turns into a spurious document re-fetch is
reproduced and removed; the re-fetch itself does not happen on modern Chromium,
and Chromium 63 is right on the boundary. If the TV's network light flickers
when you leave Now Playing, that is what it was.

---

## 9. Two things I noticed while measuring

Neither is a task from this session's brief and neither has been changed.

**`LazyLoader.observedCount()` does not return to zero across a whole-app
walk.** On the live server, over a keyboard walk of every screen, the count
ratchets: 0 → 24 (Albums) → 0 (album detail) → 67 (Artists) → 40 (artist
detail) → 67 (Songs) → 67 (Genres) → **94 (Playlists), and it stays at 94** for
Queue, Now Playing, Search and Settings. `app.js:1576` calls
`LazyLoader.unobserveWithin(_pageCurrent)` on every screen deactivation and it
plainly works for some transitions (the drop to 0 on album detail), but not for
the last one. It is small and bounded, so it is not urgent — but 94 stale
`IntersectionObserver` targets is 94 more than the design intends, and the
in-screen Library tab switches are not covered by that call site at all.

**Library → Genres is now the largest unvirtualised screen.** On the live
server it renders **2 453 elements** against 554 for the virtualised Albums
grid. It is a fixed-size list — one tile per genre — so it does not grow with
the library the way §2's lists do, and at 2 453 elements it is nowhere near the
figures in §2. Worth knowing, not worth acting on.

---

## 10. Summary of what changed in this session

| | |
|---|---|
| Fixed | `js/api.js` — sorted-key cache serialiser (§5) |
| Deleted | `FocusManager.invalidateZone` (`js/focus.js`), `.placeholder-card` (`css/styles.css`) (§4) |
| Corrected | `tickets/prompt-3.9.md` — a stale mock-harness credential line; `prompts/P15c-fix broken login-prompt.md` — a live username redacted out of a pasted URL |
| Extended | `prompts/pre-release-security-scan.md` — derived-token and shape-based credential checks |
| Reported, not changed | §1, §2, §3, §6, §7, §9 |
| Deleted from the repo | **nothing** |

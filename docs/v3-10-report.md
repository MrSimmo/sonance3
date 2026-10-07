# Sonance v3.10 — report

The reader-facing record of the v3.10 programme (`tickets/ticket-3.10.md`,
`tickets/prompt-3.10.md`). Each session fills in its part. Measurements, with
their method, are in `docs/perf-baseline.md` under "v3.10".

## 1. What shipped

### Session 1 (2026-10-01) — harness, baselines, overlay, version, oblong package

- **A regression net.** `e2e/` now holds a 45-test Playwright suite (Chromium,
  1920×1080, keyboard only) that runs with
  `node node_modules/@playwright/test/cli.js test`. Twelve of the tests are
  the known bugs this version fixes, written as expected failures and tagged
  with their requirement (R1.2, R1.3, R1.6, R3, R5, R9). Each one flips to a
  normal test when its fix lands.
- **Visual baseline.** 19 screen states at interface size 100%, in
  `screenshots/v3-10/baseline/`. Two independent captures had 0 differing
  pixels. Session 2 has to reproduce them exactly at 100%.
- **Performance baseline.** In `docs/perf-baseline.md`, "v3.10 baseline (S1)".
- **Performance overlay (R1.1).** Settings → Advanced → Performance overlay.
  It shows frame rate, worst frame, key-to-frame latency, long tasks, element
  count and the screen name. It is off by default, and attaches nothing when
  off.
- **Version** reads V3.10 in Settings → About.
- **Oblong home-row package (R12).** `Sonance3-Oblong.wgt` is built next to
  `Sonance3.wgt`. Only the packaged `icon.png` differs: in the oblong package
  it is a 1920×1080 opaque tile.

### Session 2 (2026-10-01) — interface size (R4)

- **Interface size.** Settings → Appearance → Interface size, 100 / 125 /
  150 / 175 / 200 %. **New installs and existing users start at 150 %.** The
  whole UI is built in rem on a scaled root font size (never CSS `zoom`), so
  text, artwork, spacing, the top nav, the bottom bar and every grid grow
  together. The size is applied before the first frame and remembered.
- **Changes apply live.** Left/Right on the row step one size and stop at the
  ends; Enter steps up and wraps from 200 % to 100 %. The screen re-lays out
  at once, focus stays on the row, and playback continues.
- **At 100 % the app is unchanged** apart from one fix: the top-nav pill now
  exactly covers the selected item. Before, it was up to 2 px narrow, and 4 px
  at 200 %.
- **Home rows scroll sideways at large sizes.** From 150 % (playlists) and
  175 % (all rows) a row no longer fits the screen, so the focused card is now
  scrolled into view.
- **Tests.** 21 new e2e tests in `e2e/ui-scale.spec.ts`. The suite (66 tests)
  passes at 100 % and at 150 %, and the focus paths pass at 200 %. A geometry
  sweep of all 19 screen states at 125–200 % found no overflow, no
  misaligned pill and no grid miscount.

### Session 3 (2026-10-01) — focus and navigation (R6, R3, R9, R5)

- **A focus you can see from the sofa (R6).** Focus is now a **solid**
  accent fill. Text on it is white, or near-black on light accents (Orange,
  Amber, Green, Teal), chosen so it is always at least 3:1 against the
  fill. Rows fill solid; buttons fill solid; the Now Playing transport
  buttons get a round platter; album, artist, playlist and genre cards grow
  to 112 % with a coloured ring and a deep shadow, and their titles turn
  bold white (unfocused titles are slightly dimmer). The top-nav and
  Library pills fill solid while you are on them. Colours change instantly;
  only the size change animates.
- **Now Playing starts on Play (R3).** Coming down from the progress bar or
  the top nav, or after moving along the row and back, always lands on
  Play/Pause, not on Shuffle. With no lyrics, the lyrics button is shown
  dimmed instead of hidden, so focus never sits on something invisible.
- **Down always reaches the bottom bar, and OK opens Now Playing (R9).**
  From any screen, holding Down ends on the bar's left part (cover, title,
  artist), which turns into a pink pill reading "OK → NOW PLAYING". OK opens
  Now Playing; Right reaches Previous, Play/Pause and Next. Up goes back to
  exactly the row or card you came from. With nothing playing, the hidden bar
  can no longer take focus. The Library side menu's last tab (Genres) now
  leads down to the bar instead of jumping back to Albums.
- **Every track list shows the artist (R5).** Album tracks show the artist
  under the title. Playlist tracks gain a small cover thumbnail next to
  "artist · album". Queue, Songs, genre songs and search results already
  showed it.
- **Album and artist pages scroll again.** Their track lists and discography
  never actually scrolled: tracks past the bottom of the screen were cut off
  and focus went off screen. This was an old bug that the new two-line rows
  made show up on a 10-track album at 150 %. It is fixed.
- **Room for the bigger focus.** S2 listed five places where the focus
  enlargement was cut off by its container. A wider sweep (the first and last
  item of every focus group on 12 screens) found more: the Albums grid's
  scroll edge, the quick-access tiles, the Settings library rows, the
  keyboard's space bar, the last search result. All are fixed at 100, 125 and
  150 %. The remaining cases at 175–200 % are panels taller than the screen
  (see §3).
- **Long playlists are slower until Session 5.** The new playlist
  thumbnails add work per row: a 500-track playlist opens about 16 ms slower
  at CPU 6× (84 → 101 ms); a 14,000-track one goes from 1.7 to 2.5 s, like
  the Queue. Session 5 virtualises these lists (R1.7).
- **Tests.** The R3, R5 and R9 expected failures from S1 now pass as normal
  tests, plus new ones (all-zones walk to the bar, Up returning to its
  origin, ink contrast for all 8 accents, a stylesheet audit of every focus
  rule). The suite has 79 tests.

### Session 4 (2026-10-01) — navigation speed and transitions (R1.2–R1.5, R2)

- **No more ignored presses (R1.2).** Pressing Back straight after opening
  an album used to do nothing (any press in the first 0.3 s of a transition
  was dropped). Now every press counts: a new navigation finishes the one
  still animating and starts at once. Enter then Back 0.12 s later lands
  back on the album card you came from.
- **Sliding along the top nav no longer loads every screen you pass
  (R1.3).** The pill moves instantly with each press; the screen changes
  once you stop, about 0.18 s after the last press. Four quick presses from
  Home load only Now Playing (they used to load Library and Now Playing).
  Down or OK during that short wait goes straight into the new screen's
  content. The Library side menu works the same way: running down from
  Albums to Genres builds only Genres.
- **Albums open faster when you pause on them (R1.5).** Resting on an album
  card for 0.4 s fetches the album in the background, so OK opens it with
  its tracks already there.
- **New transitions (R2).** Opening an album, artist, playlist or genre
  zooms out of the card you selected, and Back zooms back into it. Now
  Playing rises from the bottom when you open it from the bar (or when
  playback opens it automatically, or from the Queue's Now Playing card),
  and sinks away on Back. Page slides are a little longer and settle more
  softly. Every transition is at most 0.25 s.
- **The outgoing page no longer jumps.** At the start of every transition
  the page being left used to shift by its margins (72 px left and 42 px
  up at 150 %); around Now Playing it also moved up or down by the height of
  the top bar. It now stays exactly where it was.
- **Back on the bottom bar** goes up to the top nav instead of asking
  whether to exit. **Back from a Now Playing opened from the bar** returns
  to the row or card you went down to the bar from. Back from Now Playing
  to an album also lands on the track that was playing again (it had been
  landing on track 1).
- **A slow server can no longer move your focus.** With no input lock, Back
  can now beat a slow album, playlist or Home response; a response that
  arrives after you left is ignored instead of taking focus on the screen you
  went back to.
- **Tests.** The R1.2 and R1.3 expected failures from S1 now pass (their
  "today" twins are gone), plus 24 new tests (transitions, the dwell, the
  zoom origin, rise and sink, the outgoing page not moving, late responses,
  prefetch, Back from the bar). The suite has 101 tests.

### Session 5 (2026-10-02) — lists at scale (R1.6–R1.8, A1, A2)

- **Scrolling the album and artist grids no longer rebuilds them (R1.6).**
  A step down used to throw away every card on screen and draw them all
  again (each card is its own layer on the TV). Now only the row that
  scrolls in is drawn and the row that leaves is removed: 42 elements per
  step at 150 %, where it was 252–337 at S5's start. Search's long result
  lists work the same way, and focus can now reach every row in them.
- **Long lists are fast at any length (R1.7).** Playlists, the Queue, a
  genre's songs and Library → Songs only draw the rows near the screen. A
  14,000-song playlist or queue has a few hundred elements instead of
  112,000, opens at once and scrolls without slowing down (numbers in §2).
- **Library → Songs is your whole library (A1).** It used to show 50
  random songs. It now lists every song (30,458 on the test server, in the
  order the server keeps them, which is the order they were added), with
  cover, title, artist, album and length (mockup 16), and the exact count.
  OK on a song plays it and the 199 after it. "Shuffle all" plays 200
  random songs. There is no A–Z bar: the server's order is not
  alphabetical, and it cannot sort songs another way.
- **A genre shows all its songs (A1).** It stopped at 50.
- **Albums can be sorted and filtered (A2, mockup 20).** Above the grid:
  "Albums" with the exact count, a Sort chip (Name, Artist, Recently added,
  Year, Most played; OK cycles) and a Filter chip that opens a genre list.
  The choice holds until the app is closed. Up from the first row of albums
  goes to the chips. On the test account Most played is empty (nothing has
  been played).
- **Covers are sharp at larger sizes (D70).** Artwork is now requested at
  the size it is drawn at the chosen interface size (at 150 % a grid cover
  was a 180 px image stretched to 212 px).
- **Nothing is cut off at 175 % and 200 % (D84).** The album and artist
  pages' left column and the search keyboard now scroll to the focused
  button; the Queue's Now Playing card shrinks its cover so the whole card
  fits.
- **Smaller fixes.** Back from a playlist returns to that playlist, not the
  first one (D113). The Artists grid now measures its row height, so rows
  deep in a long artist list sit where the scrolling expects them (it was
  3 % out per row, D112).
- **Smooth scrolling, as an experiment (R1.8).** Settings → Advanced →
  "Smooth scrolling (experimental)", off by default: when on, lists and
  grids glide to the focused item instead of jumping. It is off until you
  have compared the overlay's frame rate with it on and off (§4).
- **Tests.** The R1.6 expected failure from S1 now passes (its "today" twin
  is gone), plus 22 new tests (recycling and traversals for Albums, Artists
  and Search; the Artists grid's geometry; the long lists at 14,000 rows;
  the complete Songs list and genre detail; the Albums header, sorts and
  filter; Back from a playlist; artwork sizes; smooth scrolling; the focus
  clip at 175 %). The suite has 122 tests and no expected failures.

### Session 6 (2026-10-02) — Now Playing (R8, R7, A6, A7, A8)

- **A softer Now Playing backdrop (R8, mockup 09).** The blurred cover
  behind Now Playing is blurred twice as much (120 px), on the same layer as
  before and with no transform (the trick that made it vanish on the TV in
  v3.9 is not used). No dark band appears at the screen edges with square,
  tall or wide covers. It costs about twice the drawing time per track change
  (§2); the TV has to confirm it still draws (§4, item 9).
- **Credits (R7, mockup 10).** A new ⓘ button after Lyrics opens a credits
  panel where the lyrics appear: who performs (with instruments and vocals),
  who wrote, produced, mixed, engineered or remixed it, the release (album,
  album artist, label, year and original year, track and disc, genres), the
  file (format, bit rate, sample rate and bit depth, channels) and, once a
  song has been played, plays, last played and BPM. Sections without data are
  left out. The panel follows the track when it changes, scrolls when it is
  long (Down from the controls walks its rows), and Back closes it before
  Back leaves Now Playing. Opening credits closes lyrics and the other way
  round. On the test server most songs carry composer, producer and mixer
  credits.
- **Up next (A6, mockup 19).** Under the controls, the next five songs in
  play order (shuffled order with shuffle on; with repeat all it wraps), with
  cover, title and artist, and how many are left. Down from the controls
  goes there, OK plays that song, Up goes back to Play. It hides while lyrics
  or credits are open. To make room the column moves up and, from 150 %, the
  cover is a little smaller (§3).
- **Sleep timer (A7).** A chip at the right of "Up next": OK cycles Off,
  15, 30, 45, 60 minutes and "End of track". It counts down in whole minutes
  ("Sleep in 14 min"), keeps running if you leave Now Playing, and pauses
  with a message when it runs out. "End of track" pauses at the end of the
  song and lines up the next one, so Play carries on. It is not remembered
  when the app closes.
- **Resume where you left off (A8).** Settings → Playback → "Resume last
  queue" (On by default). Sonance saves the queue to your Navidrome server
  (at each song change, on pause, every 30 s while playing, and when the app
  goes to the background) and brings it back the next time it starts: the
  bar shows the song paused at the place you stopped; nothing plays and Now
  Playing does not open until you press Play, which starts at that place.
  It works across devices that share the account, because the server holds
  it. Long queues are saved as the 1,000 songs around the current one.
- **Fixed on the way.** With lyrics open, the focused lyrics button showed a
  pink icon on a pink circle (invisible) since S3; it is white now (D121).
- **Tests.** 35 new tests (credits: the row, the panel, sections, one
  request per song, Back, lyrics swap, scrolling, the dimmed button, the
  section builder; Up
  next: order and shuffle, focus, OK, updates, hiding, layout at five sizes;
  the sleep timer with a fake clock and "End of track"; resume: the setting,
  saves and their triggers, the restore, the classic API, AVPlay, the Queue
  screen, Off; the backdrop at three sizes; Now Playing's Down walk). The
  suite has 157 tests and no expected failures.

### Session 7 (2026-10-02) — shell and discovery (R11, R10, A3, A4, A5)

- **A launch splash (R11, mockup 14).** Every start shows the Sonance logo
  growing in, holding, then zooming past and fading, about 1.4 s, drawn at
  your interface size and in your accent colour. It is part of the page
  itself, so it appears before the app's code has loaded. It leaves as soon
  as the hold is over and the first screen (Login, or Home) is ready, so a
  slow server keeps it up a little longer, never more than 6 s. Keys pressed
  while it is up are ignored.
- **Gradient background (R10, mockups 12 and 13).** Settings → Appearance →
  "Background": Solid (the default, as before) or Gradient, a soft glow of
  your accent colour at the top left and violet at the bottom right behind
  every menu screen. It follows the accent colour at once, is remembered,
  and does not appear on Now Playing (which keeps its cover backdrop) or on
  Login.
- **Playlist covers (A3, mockup 15).** Playlists are cover cards now, four
  to a row, with the name and "N songs · length" underneath; Home's "Your
  Playlists" row uses the same cards. The cover is the one Navidrome makes
  for each playlist (a collage of its albums); a playlist without one keeps
  a coloured tile with a playlist mark. The test account has no playlists,
  so the live covers are still to be seen (§4, item 11).
- **More Home rows (A4, mockup 18).** "Your favourites" (albums you have
  starred), "Most played" and "Rediscover" (random albums). Each appears only
  when it has something in it, and they load just after Home is on screen,
  so Home is not slower to appear. On the test account only Rediscover shows
  (nothing starred or played yet).
- **Hold OK for options (A5, mockup 17).** Hold OK on a song in an album, a
  playlist, Library → Songs, a genre, Search results or the Queue, or on an
  "Up next" song on Now Playing, and a panel opens on the right: Play next,
  Add to queue, Add to / Remove from favourites, Go to album, Go to artist,
  Start radio from this song (when the server knows similar songs: on the
  test server it does, after 0.2–7.6 s the first time for an artist; S8
  once saw 27 s, §3), Show
  credits, and in the Queue also Play now and Remove from queue. Back closes
  it and returns to the song. A short press plays as before, but on those
  rows it now acts when OK is released rather than when it goes down.
- **Tests.** 37 new tests (the splash's timeline, first paint, size, exit
  conditions, cap and swallowed keys; the background setting, every menu
  screen, layers, Now Playing and Login, the accent, a slide over it; the
  playlist cards, their focus and the grid; the Home rows, their place, the
  empty case, the timing, the chain, a late row and Home left early; hold
  OK's press, hold, release, no-keyup and repeat cases, every action, every
  zone, a late and a failed similar-songs answer). The suite has 194 tests
  and no expected failures.

### Session 8 (2026-10-04) — final verification and report

S8 changed no app code. It checked the finished version and wrote this
report's last parts.

- **The whole suite at three sizes.** 195 tests (S7's 194 plus S8's
  bundled-build walk) pass at 150 % (the default), 100 % and 200 %:
  195 passed at 150 % (13.5 min, the last run, after the
  build), 195 at 100 % (13.2 min) and 195 at 200 % (14.0 min), each exit 0. S7 had run only the focus and new-surface specs at 200 %;
  every spec passed there unchanged. The four integrity specs (grid
  recycling, long lists, smooth scrolling, focus paths) pass with smooth
  scrolling on: 27 passed, and the 2 tests of the default-off
  state skip themselves, as in S5.
- **The build the TV gets, walked end to end.** A new test,
  `e2e/bundled-walk.spec.ts`, drives the bundles the packages ship through
  what the older smoke test does not reach: the splash on its real timing,
  Home's new rows, a playlist's songs, the options panel held open with
  key-repeats as a TV sends them, its credits view, a genre's songs, and
  Login, with no page error and no failed request. On the live server the
  same walk (Home, every top-nav screen, an album, an artist, the options
  panel, credits, a genre with 3,070 songs) had no page error, no failed
  request and made no write: the splash left 518 ms after its hold, the
  album's 12 rows all showed the artist, credits showed 4 sections and 23
  rows, and Start radio appeared after 7.2 s.
- **Two findings, reported for you (§6, items 13 and 14):** Back from an
  artist opened by an album's artist link lands on the top nav (as in
  v3.9-fix1), and one live similar-songs answer took 27 s, longer than the
  app waits.
- **Security and credentials (§7).** Everything that ships, and everything
  v3.10 wrote, is clean. Old April tooling output in the project folder
  (`.playwright-mcp/`) holds replayable sign-ins and the test password;
  delete it and change the password before any public push.
- **This report.** Every measured number in §1 and §2 was checked against
  `docs/perf-baseline.md` and the session entries (one correction, in §1;
  see §3). The TV checklist is down from 28 items to 12, with the overlay
  readings to take (§4, item 2). The decisions waiting for you are in §6,
  the tidy-up notes in §8.
- **Nothing moved.** At 100 % the 19 baseline screens are pixel-identical
  to S7's (0 differing pixels in each, layout checks all ok), and the
  rebuilt packages hold the same files, byte for byte, as S7's.

### After Session 8 (2026-10-04) — the two findings fixed

At your request, the two S8 findings were fixed (ticket §11, "S8
follow-up"), each with an e2e test that failed first. Settings → About now
reads **V3.10-fix1**, so you can tell this build on the TV.

- **Back returns to where you were on an album page (D149).** Back from an
  artist opened by the album's artist link, and from a Now Playing opened
  by the album's Play or Shuffle (Auto Now Playing on), now lands on that
  button, not on the top nav. Checked live too.
- **Start radio waits for a slow server (D150).** The similar-songs request
  now waits up to 45 s instead of 10 s; every other request keeps 10 s.
- **Your playlist on the live server (A3).** "Test for Claude" shows its
  cover in the Playlists grid and on Home, its 68 songs list with artist
  and thumbnail, and holding OK on one opens the options panel with Start
  radio (after 1.4 s). No page error, no failed request, no write.
- **Tests:** 200 (5 new: three for D149, two for D150), each new one
  seen failing first. All 200 pass at 150 % (14.1 min) and 100 % (13.7
  min); the focus, options-sheet and walk specs pass at 200 % (74 tests).
  At 100 % only the About row's text differs from S7's screens.

### v3.10-fix2 (2026-10-05) — your TV test of V3.10-fix1

Seven items from your test on the Q90R ("looking really good so far"),
each with an e2e test seen failing first (ticket §11 "v3.10-fix2").
Settings → About reads **V3.10-fix2**.

- **Into Now Playing (D152).** The page under Now Playing now fades out as
  Now Playing rises (it used to stay at full strength and vanish at the
  end), and fades back in as Now Playing sinks on Back.
- **Hide Up Next (D156, D157).** Settings → Appearance → "Up next on Now
  Playing ◄ Show / Hide ►". Hidden, Now Playing has no strip and the full
  cover, and the sleep timer sits alone under the controls (Down reaches
  it).
- **Credits scroll (D154, D155).** In both credits views (Now Playing's ⓘ
  panel and the options panel's "Show credits") no row lights up: Up/Down
  scroll by a third of the panel, and a slim bar on the right shows where
  you are.
- **The lyrics icon is centred (D153)** in its focus circle (it sat 3 px
  left and 1.5 px up at 150 %). Every other button was already centred.
- **Focus mode (D158, D159).** A ninth Now Playing button (a half-filled
  circle, after ⓘ) dims the whole screen by half; OK again brightens it.
  It is remembered across launches.
- **A smoother splash exit (D160).** Measured first: the stutter-prone part
  was the exit's zoom to 2.2×, which made the browser redraw the logo and
  its glow at more than twice the size (~70 ms) just as the exit began. The
  exit now zooms to 1.4×, which redraws nothing; the grow and the hold are
  unchanged.
- **The oblong tile (D161).** With your note that Litefin's oblong tile is
  wide on this TV, the cause is on Sonance's side, and the icon format is
  ruled out (Litefin's wide tile uses the same kind of 1920×1080 image). §4
  item 1 now lists three things to try, in order, and what each result
  means; `Sonance3-Oblong-Diag.wgt` is the third: the oblong package as a
  separate app with a new id and the `tv-samsung` profile Litefin has.
- **Tests:** 231 (31 new, in five spec files). All 231 pass at 150 %
  (15.7 min) and at 100 % (15.4 min); the focus, Now Playing, sheet,
  transitions, splash and walk specs and the five new ones pass at 200 %
  (146 tests). The focus-clip sweep is 0 at all five sizes (144 focus
  states each). At 100 % only the intended screens differ from S7's:
  Settings (the new row, the About text) and the Now Playing controls row.
  Live (your server, nothing played, nothing written): the rise fade, Up
  Next hidden, Focus mode and both credits views on "Test for Claude".

### v3.11 (2026-10-07) — your TV results, and the release

You tested V3.10-fix2 on the Q90R and confirmed all of it: the fade into
and out of Now Playing, hiding Up Next, credits that scroll without
highlighting rows, the centred lyrics icon, Focus mode and the smoother
splash. The oblong tile now shows wide on the home row with
`Sonance3-Oblong.wgt` itself; the diagnostic package was not needed and is
no longer built (D163). The build is released as **3.11** (D164): Settings
→ About reads **V3.11**, and both packages carry version 3.11.0 in
`config.xml`. Nothing else in the app changed. The project is now a git
repository (branch `main`, D165): the tracked files, and what stays out
for safety, are in §7.

## 2. Before / after

| Measurement (mock rig, CPU 6×) | Before (see the note below) | After | Session |
|---|---|---|---|
| Albums grid, nodes kept on a one-row Down step | 0 of 50–80 | all but the row that left (30–42 of 30–48 at 150 %; S5-start code at 150 %: 0) | S5 |
| Albums grid, elements created on that step | 476–1,065 | 42–43 at 150 % (one row; S5-start code at 150 %: 252–337) | S5 |
| Top nav, screen renders for 4× Right @90 ms | 2 | 1, the destination (10 of 10 runs at 150 %; live too) | S4 |
| Library sub-nav, tab builds for Down ×3 @90 ms | 3 | 1 (5 of 5 at 150 %; live too) | S4 |
| Enter then Back @120 ms | Back dropped (still on the album) | back on Library, on the originating card (5 of 5; live too) | S4 |
| Keypress → first frame | 9.6–46.3 ms, 0 long tasks | at 150 % (S4 start → S4): Enter album 16 → 26.2 ms, Back 25.7 → 24.4, Down in grid 9 → 8.8, open NP 24.1 → 29.6; a top-nav Right now draws the pill in 28.9 ms and starts the screen 184 ms later. 0 long tasks | S4 |
| Album opened after a 0.5 s rest on its card: tracklist painted after OK (CPU 6×) | 42.8 ms | 26.6 ms (prefetched) | S4 |
| Library from the top nav: grid painted after the navigation starts (CPU 6×) | 57.2 ms | 40.2 ms (its first frame is heavier: 16.3 → 40.2 ms, §3) | S4 |
| Synchronous render + activate, highest screen (Now Playing, 150 %, CPU 6×) | 14.6 ms (median of 6) | 14.8 ms (S4 does not change it) | S4 |
| Synchronous render + activate, Now Playing with credits and Up Next (150 %, CPU 6×) | 13.6 ms (S6-start code, median of 3 pairs) | 14.5 ms (max run 15.0; built synchronously it was 16.0–19.2 ms) | S6 |
| Now Playing, main-thread task time in the 700 ms after opening (150 %, CPU 6×) | 50.6 ms | 91.6 ms (blur ~15, the strip ~11, the rest of the screen ~14; §3) | S6 |
| Backdrop edge band: outer 50 px vs the band 200–250 px in, square / wide / tall covers (100 %, 150 %) | within 0.3 % at blur 60 px | within 0.3 % at blur 120 px (bound 10 %) | S6 |
| Backdrop raster time per track change (headless software raster, CPU 1×) | ~128 ms | ~247 ms | S6 |
| Focus states whose focus enlargement is clipped (110 per size with S6's zones, 100 / 125 / 150 / 175 / 200 %) | — | 0 / 0 / 0 / 0 / 0 | S6 |
| Focus states whose focus enlargement is clipped (120 per size, with the options sheet and its credits view) | 1 / 2 / 1 / 1 / 1 (S7's new surfaces before their room, D76) | 0 / 0 / 0 / 0 / 0 | S7 |
| Playlist detail at 14,000 rows: elements, first paint, per press | 84,050; 1,661 ms; 196.5 ms | 199; 84.3 ms; 2.3 ms (150 %; S5-start code: 112,051; 2,404 ms; 409.6 ms) | S5 |
| Queue at 14,000 rows: elements, first paint, per press | 112,053; 2,614 ms; 493.9 ms | 210; 22.6 ms from its render (208.8 ms from the key, with the 180 ms nav dwell); 2.6 ms (150 %; S5-start code: 112,054; 2,497 / 2,679 ms; 402.9 ms) | S5 |
| Library → Songs at 14,000 rows (A1, new): elements, rows painted after the tab build, per press | — (50 random songs) | 175; 26.6 ms; 2.9 ms (150 %) | S5 |
| Focus states whose focus enlargement is clipped (96 per size, 100 / 125 / 150 / 175 / 200 %) | 0 / 0 / 0 / 2 / 9 (S5 start) | 0 / 0 / 0 / 0 / 0 (D108) | S5 |
| Splash (R11): first paint / first contentful paint / Home in the DOM (bundled, CPU 6×, median of 6) | 58 / 124 / 102 ms (no splash) | 94 / 132 / 111 ms; usable at 1,510 ms by design (the splash leaves 513–519 ms after its hold, live and mock) | S7 |
| Gradient backdrop (R10): composited layers at rest on Home (CDP LayerTree) | 31 (Solid) | 31 (Gradient; 33 if the layer were `position: fixed`, D130) | S7 |
| Home (A4): sync render + activate / first frame / 700 ms task time (150 %, CPU 6×, 6 runs, medians) | 0.6 / 31.2 / 85.0 ms | 0.4 / 32.1 / 89.5 ms (three rows built after the first frame) | S7 |
| Enter on a track row → Now Playing render starts (A5, keyup activation) | 6.0–6.3 ms after keydown | 6.8–7.0 ms (Playwright's keyup follows within 1 ms; on the TV, the press length) | S7 |
| Performance overlay's own script cost per frame (CPU 1×) | — | 0.006–0.009 ms | S1 |
| Focus states whose focus enlargement is clipped (92 per size, 100 / 150 / 200 %) | 14 / 16 / 22 | 0 / 0 / 9 (the 9 at 200 % are panels taller than the screen, §3) | S3 |
| Keypress → first frame at 150 %, Down in Albums grid (median of 5) | 11.9 ms | 12.2 ms (no change; S3 claims none) | S3 |
| Playlist detail at 150 %, first paint for 500 / 14,000 rows (S3 thumbnails, R5) | 84.1 / 1,661.7 ms | 100.5 / 2,536.9 ms (S5's R1.7 virtualises) | S3 |

**"Before".** The first six rows and the 14,000-row Playlist and Queue rows
take their "before" from the S1 baseline (the v3.9-fix1 code, at 100 %
unless a size is given). Every other row's "before" is the code at the start
of the session that made the change, served from saved copies of that code
(the v3.9 D29 method); for the Now Playing render row,
S1's own figure was 10.2 ms at 100 %. The three focus-clip rows from S3, S5
and S6 are recorded in those sessions' `PROGRESS.md` entries, not in
`docs/perf-baseline.md`. S8 checked every number in this table against its
source (§1, Session 8).

From S2 the app's default size is 150 %, which changes what is on screen
(6 album columns instead of 8, fewer cards per band). "After" numbers are
compared at the same size: either at `SONANCE_SCALE=1` against the S1 column
above, or against the S2 150 % reference in `docs/perf-baseline.md`
("v3.10 S2"). S2 itself claims no speed change: at 100 % its numbers match S1
within run-to-run noise (same file).

## 3. Deviations

- **S1, D60.** `icon.png` and `icon-oblong.png` were missing from the
  project root. A PNG tidy-up on 2026-10-01 had moved them, along with 191
  screenshots, into `screenshots/older_than_v3-9/`. Both copies there are
  byte-identical to the icons packaged in the last builds. `icon.png` was
  copied back to the root so the square package keeps its icon. The original
  was not moved. `build.sh` now stops with an error if an icon is missing;
  before, `zip` only warned and shipped a package without one.
  `icon-oblong.png` was left where the tidy-up put it, because no package uses
  it.
- **S1, D61.** The oblong tile uses a flat `#0a0a0c` ground. A faint brand glow
  behind the mark made the file 256,848 B instead of 92,455 B, and the glow was
  barely visible.
- **S1.** Navidrome on the test server is now **0.64.1** (the ticket says
  0.63.2), and the test credentials work again.
- **S2, D69.** The 100 % rendering changed in one place, on purpose: the
  top-nav pill box (it was too narrow, a pre-existing bug the interface size
  made bigger). Everything else at 100 % is pixel-identical (19 of 19 states,
  checked before the fix).
- **S2, D70.** Artwork is still requested at the v3.9 sizes, so at 150 % it is
  upscaled slightly (a 180 px cover drawn at 212 px). Left for S5.
- **S2.** Five focused elements have their focus enlargement clipped by their
  container, most of them by a few pixels and at every size; the Artist
  discography row loses 40 px on its right. They are listed in
  `docs/UI-MOCKUP-REFERENCE.md` "Known discrepancies" for S3, which redoes
  the focus styles.

- **S3, D84.** At 175 % and 200 %, a few fixed-size panels are taller than
  the screen: the album and artist pages' left column (cover, title,
  buttons), the search keyboard's bottom row, and the Queue's Now Playing
  card. Their lowest buttons sit partly or wholly below the screen edge, and
  focus can go there. This is a layout problem at those sizes, not a focus
  style one, and it needs a decision (scroll the panel, or shrink the
  artwork). It is handed to Session 5 with the artwork-size work. 100–150 %
  are not affected.
- **S3, D82.** The album and artist pages' scrolling fix (§1) came out of the
  R5 work; it was not in the plan.
- **S3, D80.** The bar's "OK → NOW PLAYING" hint is from mockup 11; the
  ticket text did not mention it.
- **S3.** The ticket asked for "14" bar registrations to be replaced; there
  were 13, and all go through the one helper now.
- **S3, found, not fixed.** Pressing Back while the bottom bar is focused
  opens the "Exit Sonance?" dialog (it did before S3 too, but the bar was
  rarely focused). Handed to Session 4, which reworks Back.

- **S4, D96 (R1.4).** No screen was deferred: none passes R1.4's trigger
  (more than 16 ms of synchronous work at CPU 6×). Library's first frame is
  heavier than before (16.3 → 40.2 ms at CPU 6×) because the short wait
  before the screen changes lets its data arrive first, so the slide starts
  with the albums already drawn, 17 ms sooner than they used to appear.
  Whether that delays the slide visibly on the TV is checklist item 6 (the
  readings in item 2).
- **S4, D97 (R1.5).** Only the Library Albums grid prefetches. Home's album
  rows, the artist page's discography and Search's albums do not.
- **S4, D93.** Rise is also used from the Queue's Now Playing card (it
  switched with no animation before). Now Playing reached from the top nav
  still slides back on Back, as before.
- **S4, D98 and D88 (found in S4).** The jumping outgoing page and the late
  responses (§1) were not in the plan; both had to be fixed for R2 and R1.2
  to hold.
- **S4, not changed.** `CLAUDE.md`'s "Transitions" section still describes
  the v3 zoom (incoming from 92 %, no rise or sink). The ticket only allows
  the Navigation section to be amended in v3.10, so the difference is left
  for you to settle.

- **S5, D102 (A1).** The Songs count comes from the list itself (an exact
  search over its length), not from the server's scan status, which counts
  every library on the server (82,524 songs against the 30,458 this account
  sees). No A–Z bar and no Sort: the server keeps songs in the order they
  were added.
- **S5, D103 (A1).** OK on a song queues it and the next 199, not the whole
  list (on the test server the whole list is 30,458 songs).
- **S5, D106/D107 (A2).** With a genre chosen the sort is fixed to Name (the
  server sorts a genre only that way) and the Sort chip is dimmed. The
  album count is shown for every list, not only with a filter, because it
  is exact.
- **S5, D108 (D84).** The decision handed over from S3: the panels with
  several buttons scroll; the Queue card, which is one button, shrinks its
  cover. At 100–150 % nothing moves or changes size.
- **S5, found and fixed.** Search's long result lists (shown with four or
  more libraries chosen) let focus reach only the first rows, and the
  yellow and blue buttons acted on the wrong song (D100). The Albums grid
  sometimes grew by two or three rows at once at the end of a page (D99).
- **S5, not done.** Back to an album card deep in the grid (past the first
  50) still lands on card 50 (v3.9 NEW-3, a parked decision; S5 does not
  make it simple, see the ticket §11 S5.9). The Library warms only the Name
  sort's first page before you arrive; another sort loads when you get there.
- **S5, raster only.** At 100 % the artist page's left column, now a
  scroller, draws its button text with slightly different anti-aliasing in
  the browser (808 pixels of "Play All", no position change); the search
  screen has 118 pixels differing by 1 of 255.

- **S6, D122 (A6).** To fit "Up next" under the controls, the cover on
  Now Playing is smaller where the screen is short for it: 28rem up to
  125 %, 20.8rem (312 px) at 150 % (mockup 19 draws about 23rem), 324 px at
  175 % and 216 px at 200 %. At 175 % and 200 % the top nav covers the top of
  the cover until it hides itself (5 s); the column already reached under
  the nav at those sizes before S6.
- **S6, D119 (R7).** Back closes the credits panel first, as the ticket
  asks. The lyrics panel keeps its old behaviour (Back leaves Now Playing
  with lyrics open). Making lyrics close first too is a one-line change, if
  you want it.
- **S6, D123 (A6/A7).** The sleep chip is reached by Right from the last
  "Up next" song (it sits at the right end of the row's header).
- **S6, D115.** The credits panel is top-aligned under the nav, not centred
  like lyrics: centred, a long credit list put its title under the nav.
- **S6 (R1.4).** Now Playing's synchronous work is under 16 ms, but the
  work in the 700 ms after it opens grew by ~40 ms at CPU 6× (the 120 px
  blur ~15 ms, the Up next strip ~11 ms, the rest ~14 ms), spread over the
  frames after the first.
- **S6, D127 (A8).** A queue saved while shuffle was on comes back in its
  shuffled order, and turning shuffle off keeps that order (the order before
  shuffling is not saved).
- **S7, R11 (D135, D138).** "Removed by first-screen-ready + 600 ms" is
  read as 600 ms after both the hold and the first screen, because the hold
  alone is 900 ms. The exit's easing and the backdrop's fade are not in the
  spec; they use the transitions' one easing (D91).
- **S7, R10 (D130, D132).** The layer is absolute in the app's full-screen
  layout rather than `position: fixed`: fixed, it cost two extra
  compositor layers at rest. Now Playing gets an opaque base only while the
  gradient is on (with Solid nothing changes; with Gradient its backdrop
  blends at most 2/255 differently).
- **S7, A4 (D131).** Favourites and Most played sit after Recently Played;
  Rediscover is last, after Your Playlists.
- **S7, A3 (D139).** The Playlists grid has four columns (it had three
  tiles), and its covers are asked for at 400 px at every interface size:
  the cards' size comes from the four columns, not from the interface size
  (an exception to D70's scaled sizes).
- **S7, A5 (D133, D140–D143).** OK on track rows acts on release, so a
  short press there takes as long as the press (§4, item 12). "Show
  credits" opens inside the panel (Back goes back to the actions), not in
  a separate window. "Up next" songs get the standard actions, not Play now
  and Remove (the ticket names queue rows for those). Favourite was tested
  on the mock only: on the live account it is a forbidden write. Similar
  songs from Navidrome carry no library id, so with several libraries
  selected a radio can include songs from a deselected one.
- **S7, found and left as they were (report).** Re-registering a focus
  zone does not update its colour-button handler (latent since v3; nothing
  re-registers one with a different handler today). A playlist opened from
  the Playlists grid is not a screen of its own, so Back from an album or
  Now Playing reached from its songs returns to the grid, with the song's
  position applied to the grid's cards (since v3).
- **S7, test artefact.** The 100 % Login baseline differs from S6's by 85
  pixels of rounded-corner anti-aliasing (at most 13/255) only when the
  screenshot is taken with Playwright's `animations: 'disabled'` and
  `caret: 'hide'` together; with either alone, or neither, it is
  identical. Not a rendering change.
- **S6, live.** The server is Navidrome 0.64.1; it sends credits on every
  song and advertises the index-based queue calls and form POSTs, which
  Sonance uses. The test account's saved queue was emptied again after the
  live check.
- **S8, found, reported (§6, item 13).** Back from an artist page opened by
  an album's artist link lands on the top nav instead of on the link. It is
  the same in v3.9-fix1 (checked by serving that package's files), so it is
  not a v3.10 regression, and no v3.10 requirement covers it. **Fixed after
  S8 at your request (D149),** with Play and Shuffle, which had the same
  fault with Auto Now Playing on.
- **S8, live (§6, item 14).** For one artist the server took 26.8 s to
  answer `getSimilarSongs2` (7.2 s on a repeat; S7 saw at most 7.6 s). The
  app gives a request 10 s, so Start radio stayed hidden for that opening
  of the options panel. On another album it appeared after 7.2 s. **Fixed
  after S8 (D150):** that one call now waits up to 45 s.
- **S8, this report.** Checking every number against `docs/perf-baseline.md`
  and the session entries found one error, now corrected: §1 said the
  Albums grid created "252–631" elements per step before S5; at S5's start
  it was 252–337 (252–631 was before S3). §2's "Before" column is now
  explained (it is not always S1), S7's focus-clip row was added, and two
  loose figures were made exact (the backdrop's inner band, the similar
  songs timing).
- **S8, D145.** The security scan prompt writes its report to `review.md`
  in the project root; S8 put it in §7 here instead, because the brief
  allows S8 to write under `docs/` and creates nothing else in the root.

## 4. TV checklist

Things a browser cannot prove (D47). S8 consolidated the 28 items the
sessions added into 12; each heading names the items it replaces, so earlier
references ("TV item 13", "item 28") still resolve. Each item says what a
failure looks like. Items 1 and 12 matter most: the oblong tile is the one
thing no browser can show at all, and holding OK depends on what this remote
sends.

1. **R12 — oblong home-row tile. PASSED on the Q90R (v3.11, D163):** wide
   with `Sonance3-Oblong.wgt`; the diagnostic package was not needed. The
   history, kept for reference: after V3.10-fix1 you
   reported the tile still square with `Sonance3-Oblong.wgt`, while
   Litefin's oblong build is wide on the same TV. So the TV can show a wide
   sideloaded tile, and the cause is on Sonance's side. The icon is not it:
   Litefin's wide tile is a 1920×1080 opaque icon.png, and the wide tile
   Apps2Samsung ships for Litefin is the same format as Sonance's (24-bit
   RGB). What remains: the home row keeping the square tile it cached for
   Sonance's app id (the oblong package was installed over the same id),
   the `<tizen:profile name="tv-samsung"/>` line Litefin's config has and
   Sonance's lacks, or `required_version` (Litefin 2.3, Sonance 5.0).
   v3.10-fix2 (D161) builds one diagnostic package for this. Try, in
   order, stopping at the first wide tile:
   1. **Re-add the tile.** Remove Sonance's tile from the home row and add
      it again from Apps.
   2. **Fresh install.** Uninstall Sonance, unplug the TV for 30 s, then
      install `Sonance3-Oblong.wgt`. (In Apps2Samsung, "Manage app icons"
      should have nothing set for Sonance; a saved icon there replaces the
      package's icon at install.)
   3. **The diagnostic package.** Install `Sonance3-Oblong-Diag.wgt`. It is
      a separate app, "Sonance Diag", with its own app id
      (`S0nanceOb1.Sonance`, never seen by the TV), the tv-samsung profile
      and the same wide icon. It has its own storage (sign in again).
      Uninstall it after the test.
   4. (Done by you: Litefin's own oblong build is wide on this TV.)
   - **What each result means:** wide after step 1 or 2 → a cached tile;
     install the oblong package fresh from now on. Diag wide (steps 1–2
     square) → a later round finds which of the new id or the profile did
     it, and moves the oblong package to it. Diag square → the next
     package to try changes `required_version` to 2.3, as Litefin has.
   - **Pass:** a wide 16:9 tile with the S-wave mark and the "Sonance"
     wordmark. **Fail:** square, or the wide image squashed into a square.
   - `Sonance3.wgt` and `Sonance3-Oblong.wgt` share one app id, so
     installing either replaces the other. Reinstall `Sonance3.wgt` if you
     prefer the square icon.
2. **R1.1 — read the performance overlay.** Settings → Advanced → Performance
   overlay → On. It sits in the top-left corner and survives navigation. It
   shows `FPS` (frames drawn in the last second), `worst` (the longest gap
   between two frames in that second), `key` (the last key press to the frame
   that shows its result), `long` (long tasks since the overlay was turned on,
   or `n/a`), `els` (elements on screen) and the screen name. Take these
   readings at 150 % and send them back:

   | Where | Do | Read | Fine | A problem |
   |---|---|---|---|---|
   | Home | Nothing, for 5 s | `FPS`, `worst` | 55–60; `worst` under ~35 ms | `FPS` under 50, or `worst` over 50 ms, with nothing moving: something redraws all the time |
   | Library → Albums | Hold Down for 3 s, then read | `FPS`, `worst`, `key`, `els` | `FPS` 30 or more; `key` under 100 ms; `els` stays about the same after more scrolling | `FPS` under 20, `worst` over 100 ms (a visible hitch), `key` over 200 ms, or `els` growing each time you scroll (something is not being released) |
   | Top nav | From Home press Right four times quickly | `key`, `long` | `key` is the pill's frame (well under 100 ms); `long` goes up by 0 or 1 | `long` going up on every press; the screen trailing the pill by more than about half a second |
   | An album | Open it, then Back | `key` | under ~150 ms each way | over 250 ms: the zoom starts late |
   | Library | From Home press Right once; then from Playlists press Left | `key`, `long` | the slide starts at once | the slide starts late or stutters, or `long` counts one per Library visit (was item 13; see D96 in §6) |
   | Now Playing | Open and close lyrics; then change track three times | `FPS`, `worst` | `FPS` 30 or more during the slide; `worst` under 100 ms after a track change | `worst` over ~100 ms on each track change (the 120 px blur, item 9) |
   | A long playlist, Library → Songs | Scroll for a while | `els` | under about 1,500 | over 1,500, or growing as you scroll |

   In the browser at 150 % with the test library (S8, live), `els` read
   about 150 on Home, 256 on Library → Albums, 433 on an album, 315 on an
   artist, 126 on Now Playing, 104 on Search and 111 on Settings. At the same
   size and with the same library the TV should read the same: the count does
   not depend on the device. `long n/a` means Chromium 63 does not
   report long tasks: informational, not a bug. Also a failure: the overlay
   missing after navigation, `FPS` reading 0 or never updating, or stutter
   that goes away when the overlay is off (compare `FPS` on Home with it on
   and off).
3. **v3.9-fix1 R1/R2/R3, carried forward.** Confirm the Now Playing backdrop
   is the blurred cover (D47), and that lyrics behave as v3.9-fix1 describes.
4. **R4 — interface size (was items 4–7).**
   - **The 150 % default renders as in the browser.** Compare a few screens
     with `screenshots/v3-10/s2-150/`: Albums shows 6 columns, the top nav
     spans about half the screen width, the bottom bar is about 114 px tall,
     the nav pill sits exactly behind the selected item and the Library
     sub-nav pill behind its tab.
   - **Change it live.** Play a song, open Settings → Appearance → Interface
     size, press Right, Right, Enter, Left. Each press re-lays out the screen
     within about a second, focus stays on the row, the music keeps playing,
     and the value reads 175 %, 200 %, 100 %, 100 %. Relaunch: the size you
     left is kept.
   - **100 % looks exactly like v3.9.** The root font is 10 px at 100 %.
   - **Home rows at 200 % (D68).** Go down to Recently Added and press Right
     along the row: it jumps so the focused card is always fully visible. Do
     the same at 150 % on the playlists row.
   - **Fail:** some elements stay small while others grow (a rem value
     Chromium 63 did not apply); text overlaps or is clipped; the pill is
     offset or the wrong width; lyrics open with the left column off screen;
     a partial re-layout, focus jumping, audio stopping, or the size resetting
     on relaunch; 100 % looking larger than v3.9 (Tizen enforcing a minimum
     font size above 10 px; 125 % and up are not affected); a focused Home
     card off screen or cut off, or the row gliding (it is meant to jump,
     D58).
5. **R6, R3, R9 — focus, the dimmed lyrics button and the bottom bar (was
   items 8–10).**
   - **Focus from the sofa at 150 %.** Walk Library → Albums, an album's
     tracks, Settings and the top nav: focus is obvious at a glance, a solid
     pink row or button, or a bigger card with a pink ring. Pick Amber in
     Settings → Appearance and repeat: text on the focus is near-black.
   - **The dimmed lyrics button.** Play a track with no lyrics, open Now
     Playing, press Right to the lyrics button: it is visible but dim,
     focusing it shows a faint pink circle, OK does nothing. Up then Down
     returns to Play.
   - **The bottom bar.** With a track playing, hold Down on Home, on an
     album, on Library → Genres (side menu) and on Settings: focus ends on
     the bar's left part, a pink pill reading "OK → NOW PLAYING". OK opens
     Now Playing; Back, hold Down again, then Up returns to the exact row or
     card focus came from. Back on the bar goes to the top nav.
   - **Fail:** a focused card with no ring or a cut-off ring; a card
     flickering or its title ghosting when focus moves (the D6 layer rule);
     hard-to-read text on the focus; the top-nav pill pink while focus is
     down in the page; focus disappearing into an invisible lyrics button,
     or OK opening an empty lyrics panel; Down stopping above the bar or
     landing on Previous; OK skipping a track instead of opening Now
     Playing; Up landing somewhere else.
6. **R1.2, R1.3, R2 — the dwell and the transitions (was items 11–13).**
   - **The dwell.** On Home press Right once: the pill moves at once and
     Library follows a moment later. Right four times quickly: only Now
     Playing appears. Right then Down quickly: Library opens with focus on
     its first album. In Library's side menu run Down from Albums to Genres:
     only Genres loads.
   - **Transitions.** Open an album and press Back straight away: you are
     back on the card you left. Enter, Back, Enter, Back quickly: every press
     counts and you end on Library. An album grows out of the card you chose
     and Back shrinks it back into it. From the bar, OK makes Now Playing
     rise; Back sinks it (Auto Now Playing does the same). **Since
     v3.10-fix2 (D152):** the old page fades out under Now Playing as it
     rises, and nothing pops; on Back the page fades back in as Now
     Playing sinks. Fail: the old page staying at full strength under Now
     Playing and then vanishing at once (what you saw on V3.10-fix1), or
     the page appearing at once on Back.
   - **Library's first frame:** the overlay readings in item 2.
   - **Fail:** the screen lagging well behind the pill (the 0.18 s wait
     feeling like a delay), intermediate screens flashing up, a lost press,
     focus ending on the side menu instead of the albums; a half-faded page
     left on screen; the page behind jumping at the start of a transition;
     the zoom growing from the screen's centre rather than the card; the Now
     Playing backdrop missing during or after a rise or sink (the D47
     compositor case); the slide into Library starting late or stuttering.
7. **R1.6–R1.8, A1, A2 — long lists, the new Library lists and smooth
   scrolling (was items 14–16).**
   - **Holding Down in long lists,** with the overlay on: the Albums grid,
     Library → Songs, a large Queue (play the Songs list from the top: it
     queues 200) and a genre with many songs. Watch `els` and `FPS`.
   - **The new Library lists.** Songs: time from the menu landing on Songs to
     rows appearing (the app counts the songs first, about 24 small
     requests), and the count against Navidrome's. Albums: each Sort shows
     albums (Most played is empty until something has been played); Year
     lists albums with no year last; Filter → a genre shows only that genre's
     albums with "N albums · Genre".
   - **Smooth scrolling (experimental), off then on** (Settings → Advanced):
     hold Down for five seconds in Albums and in Songs with it off and on,
     and send the four pairs of `FPS` / `worst`, and which feels better.
   - **Fail:** blank cards or grey placeholder rows that stay for more than
     a moment; focus jumping back or landing on the wrong item; `els` over
     about 1,500; a lower FPS than v3.9 on the Albums grid; Songs taking more
     than about a second to show rows, or a wrong count; a sort repeating or
     missing albums; Back from the genre list leaving Library. With smooth
     scrolling on (keep it off if so): a clear FPS drop, stutter, overshoot,
     empty rows while it glides, or the focused item off screen once it
     stops (a compositor question, D58).
8. **D84/D108, D70 — 175–200 % panels and artwork (was items 17–18).**
   - At 200 %, open an album and press Down to Shuffle (the left column
     scrolls so Shuffle shows), do the same on an artist, go to Search and
     down to SPACE / DEL, and look at the Queue's Now Playing card.
   - At 150 %: covers in the Albums grid, on Home and on Now Playing look
     sharp, and the grid scrolls no slower than before.
   - **Fail:** a focused button below the bottom edge; the Queue card cut off
     at the bottom; at 150 % or less any of these panels scrolling or the
     Queue cover smaller than before; soft covers (the request size did not
     follow the interface size), or a visibly slower grid (larger images
     cost more to decode on the TV).
9. **R8, R7 — the 120 px backdrop and credits (was items 19–20).**
   - **Backdrop (D47 class).** Open Now Playing on a song with a colourful
     cover: a soft wash of its colours behind everything, edge to edge.
     Change track three times.
   - **Credits** (scrolling changed in v3.10-fix2, D154). Press Right to
     ⓘ and OK: the panel slides in from the right like lyrics. If the list
     is longer than the panel, Down moves into it: no row lights up, a slim
     pink bar appears on its right edge, and each Down scrolls a third of
     the panel; Up scrolls back, and Up at the top goes back to ⓘ (the bar
     disappears). Back closes it, a second Back leaves Now Playing. Change
     track with it open. Do the same in the options panel's "Show credits"
     (hold OK on a song): Up/Down scroll, Back returns to "Show credits".
   - **Fail:** no backdrop at all (a dark screen behind the art: the TV
     dropped the filtered layer, as v3.9's version did), hard edges or a dark
     band at the screen edges, or a stall on each track change (`worst`
     over ~100 ms just after it); the credits panel overlapping the left
     column or cut at the top, a credit row lighting up as if it were a
     menu option, Down not scrolling or skipping past the end, the pink bar
     missing, staying after focus leaves, or showing on a list that fits,
     a pink icon on a pink circle on ⓘ or lyrics when focused with its
     panel open, or Back leaving Now Playing with the credits open.
   - **Focus mode** (v3.10-fix2, D159). On Now Playing press Right to the
     last button (a half-filled circle) and OK: the whole screen, cover,
     backdrop, text, buttons and "Up next", dims by half over a quarter of
     a second; the top nav, when it shows, is not dimmed; the remote still
     works. OK again brightens it. Leave it on, restart Sonance: Now
     Playing opens dimmed. Fail: an uneven or banded dim, a flicker or a
     moment with no backdrop as it fades (the D47 compositor case), the
     dim covering the top nav, keys not reaching the buttons, or the dim
     forgotten after a restart.
   - **Lyrics icon** (D153): focus the lyrics button: its lines sit in the
     middle of the pink circle (they were up and to the left).
10. **A6, A7, A8 — Up next, the sleep timer and resume (was items 21–23).**
    - **Up next** at 150 %, 175 % and 200 %: with a queue playing, five songs
      under the controls; Down, Left/Right across them, OK on the third plays
      it.
    - **Up next hidden** (v3.10-fix2, D157): Settings → Appearance → "Up
      next on Now Playing" → Hide. Open Now Playing: no strip, the larger
      cover, and the sleep timer alone under the controls; Down reaches it,
      OK sets it, Up returns to Play. At 200 % the column sits a little
      higher (the top of the cover goes under the screen's top edge) so the
      sleep timer stays on screen. Fail: the strip still showing, the cover
      still the smaller Up Next size, the sleep timer missing, cut off or
      overlapping the buttons.
    - **Sleep timer:** set 15 min, leave Now Playing, come back after a
      minute: "Sleep in 14 min". Let it run out: the music pauses and a
      message says so. Then "End of track" on a song near its end, and Play.
    - **Resume:** play an album, skip to its fourth song, play a minute, press
      Home on the remote (or switch the TV off), start Sonance: the bar shows
      the fourth song paused at about that minute and nothing plays; Play
      starts there within a couple of seconds.
    - **Fail:** the strip overlapping the controls or running off the bottom,
      the cover jumping when lyrics open and close, missing covers; the sleep
      label not counting, playback not pausing, or Play not continuing with
      the next song after "End of track" (AVPlay is only stub-tested); an
      empty bar after the restart (Home may suspend the app before the save
      is sent), the right song starting from 0:00 (AVPlay ignored the seek
      before play), music starting by itself, or Now Playing opening on its
      own.
11. **R11, R10, A3, A4 — the splash, the gradient, playlist covers and Home
    rows (was items 24–27).**
    - **Splash, cold start:** close Sonance completely, start it from the
      home row: the logo grows in within about a third of a second, holds,
      zooms past and fades into Login or Home, about 1.4 s in all. Press OK
      and Back while it is up: nothing happens. Try 100 % and 200 % too.
      **Since v3.10-fix2 (D160)** the exit zooms to 1.4× instead of 2.2×:
      at 2.2× the logo and its glow had to be redrawn at more than twice the
      size just as the exit began (the browser measured ~70 ms of raster
      there; none now). Compare with V3.10-fix1: the grow and the exit
      should be smooth, with no stutter as the zoom starts.
    - **Gradient:** Settings → Appearance → Background → Gradient; visit
      every menu screen, change the accent, open Now Playing; with the
      overlay on, scroll Albums and compare `FPS` with Solid.
    - **Playlist covers:** open Playlists and Home. "Test for Claude" shows
      its cover in the browser (checked live after S8). It holds one album,
      so Navidrome's collage of several albums is still to be seen: add
      songs from other albums to see it.
    - **Home rows:** star an album and play a few songs; after a minute and a
      restart, "Your favourites" and "Most played" appear between Recently
      Played and Your Playlists, and "Rediscover" is at the bottom.
    - **Fail:** a white or black screen before the logo, the logo appearing
      only at the end, a jerky or missing zoom, Home appearing before the
      logo has gone, a key pressed during the splash doing something;
      banding or blotches in the glow (Chromium 63's gradient raster), the
      glow not following the accent, the gradient on Now Playing, a lower
      FPS than Solid; a coloured tile instead of a cover for a playlist that
      has songs (Navidrome sent no `coverArt`), a stretched, blurry or wrong
      cover; a row that stays empty after starring or playing, Home jumping
      while the rows arrive, or Down skipping a row.
12. **A5 — holding OK, and the remote (was item 28).** On an album's song,
    hold OK for a second: the options panel opens and nothing plays. Release,
    press Back: focus is on the same song. A short press plays it. Try a
    queue song and an "Up next" song too. Note your remote's model, and
    whether it has the four colour buttons.
    - **Fail:** holding plays the song (the TV sends no keyup or no
      auto-repeat for OK: the panel would then never open, or open only after
      1.2 s), the panel opening and then running "Play next" by itself
      (repeats leaking), a short press feeling slow (OK on track rows acts on
      release, so it takes as long as the press; a problem if presses on
      this remote are longer than ~0.3 s), or the panel never opening.

## 5. Open questions (from `tickets/ticket-3.10.md` §10)

**Answered in the browser or on the live server:**

1. **Live server access.** The credentials were rejected (error 40) during
   planning on 2026-10-01, then worked in every session from S1 to S8
   (`ping.view` ok at each session's start, Navidrome 0.64.1 with
   OpenSubsonic).
2. **Navidrome 0.64.1 fields:**
   - `getSong` contributors and `displayComposer`, `getAlbum` `recordLabels`
     (R7): **all present** (S6; ticket §11 S6.4).
   - `search3` empty-query order (A1): **creation order**, not by title, so
     there is no A–Z rail (S5, D102).
   - `getScanStatus.count` (A1): **server-wide** (82,524 against the 30,458
     songs this account sees), so it is not used; the count comes from an
     exact search over the list (S5).
   - `getSimilarSongs2` (A5): **answers** with 11–50 songs for every artist
     tried, after 0.2–7.6 s the first time for an artist (S7), and once 27 s
     (S8, §3); its songs carry no `musicFolderId`.
   - `savePlayQueue` POST and URL limits (A8): **supported** (`formPost` and
     `indexBasedQueue` advertised; a 1,000-id POST was accepted and read
     back, S6).

**Still open:**

3. **Playlist `coverArt` (A3), partly answered after S8.** Navidrome sends
   a `coverArt` for "Test for Claude", the playlist you added, and the
   cover loads in the grid and on Home. It holds songs from one album, so
   a collage of several albums has not been seen yet (§4, item 11).
4. **Tizen 5.0 behaviour — only the TV can answer:** keyup and auto-repeat
   for OK (item 12); rem rendering parity on Chromium 63 (item 4);
   `blur(120px)` drawing and cost (item 9); the compositor with smooth
   scrolling (item 7); the splash's first paint (item 11); the overlay
   readings (item 2).
5. **Remote — only you can answer:** the model, and whether it has the four
   colour buttons (item 12).
6. **Oblong tile (R12) — only the TV can answer:** does the 1920×1080 icon
   alone give a wide home-row tile on the Q90R, as Litefin's does (item 1)?
   If not, the next try is `<tizen:profile name="tv-samsung"/>` in the
   oblong package's `config.xml`.

## 6. For your decision

None of these blocks a release. Each is a choice the sessions could not make
for you, with what ships today.

1. **`CLAUDE.md` "Transitions" is out of date.** It says the zoom's incoming
   page starts at `scale(0.92)` and names no rise or sink. R2 ships 0.86, an
   8rem slide, one easing, and rise/sink for Now Playing
   (`docs/UI-MOCKUP-REFERENCE.md` "Transitions"). The ticket allowed no
   amendment to that section (§5.5), so it was left. Recommended: amend it
   to match what ships.
2. **Content width.** `CLAUDE.md` says `max-width: 1400px`; the CSS has used
   1600px on `#page-current > *` since before v3.10 (1400px is only the
   Playlists grid). Recorded, not changed (ticket §5.5).
3. **Back with lyrics open (D119).** Back closes the credits panel first,
   but with lyrics open it leaves Now Playing, as it always has. Making
   lyrics close first is a one-line change in `handleBack`.
4. **The Now Playing cover from 150 % (D122).** To fit "Up next", the cover
   is 312 px at 150 % (mockup 19 draws about 345 px), and at 175–200 % the
   top nav covers its top for the 5 s it shows. Since v3.10-fix2 (D157)
   Settings → Appearance → "Up next on Now Playing" → Hide brings back the
   full 28rem cover (420 px at 150 %), with the sleep timer alone under the
   controls.
5. **Shuffled resume order (D127).** A queue saved with shuffle on comes back
   in its shuffled order, and turning shuffle off keeps that order (the order
   before shuffling is not saved).
6. **OK acts on release on track rows (A5, D133).** Hold detection needs the
   key's release, so a short press on a track row plays when OK comes up,
   not when it goes down; on the TV that is the length of the press. The
   alternative is keydown activation with no hold-OK on those rows.
7. **Home rows' place (D131).** Your favourites and Most played come after
   Recently Played; Rediscover is last.
8. **Playlist cards (D139).** Four to a row, and the cover is always asked
   for at 400 px (the card's size comes from the columns, not the interface
   size).
9. **Credits inside the options panel (D140)** rather than in a separate
   window; Back returns to the actions. Since v3.10-fix2 (D154) neither
   credits view highlights rows: Up/Down scroll.
10. **"Up next" songs in the options panel (D142)** get the standard actions,
    not Play now and Remove (the ticket names queue rows for those).
11. **Re-registering a focus zone keeps its old colour-button handler**
    (`FocusManager.registerZone`, latent since v3; nothing re-registers one
    with a different handler today, S7).
12. **Back after opening something from a playlist's songs** (an album, Now
    Playing) returns to the Playlists grid, not the playlist, with the
    song's position applied to the grid's cards: a playlist opened from the
    grid is a mode of the Playlists screen, not a screen of its own (since
    v3, S7).
13. **Fixed after S8 (D149): Back from an artist opened by the album's
    artist link** landed on the top nav, not on the link (the same in
    v3.9-fix1), and so did Back from a Now Playing opened by the album's
    Play or Shuffle with Auto Now Playing on. The album's left column now
    records the focus before it navigates, as its track rows do.
14. **Fixed after S8 (D150): a slow similar-songs answer hid Start radio.**
    Every request gave up at 10 s; once, the server took 27 s to answer
    `getSimilarSongs2` for a new artist. That one call now waits up to 45 s
    (every other request keeps 10 s), and Start radio appears when the
    answer comes, without moving the focus.
15. **Parked from earlier versions, still parked:** v3.9 NEW-3 (Back to a
    deep Albums card lands on card 50; needs App to tell Library the restore
    index, ticket §11 S5.9), NEW-4 and NEW-5 (`docs/v3-9-report.md` §6),
    and D96 (defer Library's grid build past the slide's first frame, only
    if item 6 shows a late slide). Library warms only the Name sort's first
    page before you arrive, so another sort loads when you get there.

## 7. Security and credential audit (S8)

**v3.11 update (D165, D166).** The repository created at v3.11 leaves out
`.playwright-mcp/`, every subfolder of `screenshots/` (one v3.9 live
Settings capture shows the test account) and `PROGRESS.md` (kept private,
your choice; its two values below were redacted anyway). A scan of the text
files in that commit found no credential in a credential position and no `t`/`s`
pair; the packages hold no server address. Still open: change the test
account's password (older local Claude transcripts hold it, outside the
repository), and delete `.playwright-mcp/` if it is not needed.

`prompts/pre-release-security-scan.md` STEP 1 to 4, run on 2026-10-04 and
widened as S8 was asked: the whole project folder (including
`.playwright-mcp/`, `test-results/` and the text files under
`screenshots/`, which the prompt's own script skips), the bundles, all four
`.wgt` files in the root (unzipped), and every earlier session's scratch
files and logs (S1–S7 and the planning session). That is 1,754 files, 31 MB.
Its report goes here rather than to a new `review.md` in the root (D145).
Values are never shown; the test account's username and password are the
same common four-letter word, so a search for the word alone finds 2,562
lines of ordinary prose.

**Clean: everything that ships, and everything v3.10 wrote.**
- The bundles, `index.html`, `config.xml` and both v3.10 packages
  (`Sonance3.wgt`, `Sonance3-Oblong.wgt`): no credential in value position,
  no `t`/`s` pair, no server address. The bundles keep only the Login
  screen's placeholder hints (`e.g. 192.168.0.1`, `e.g. 4533`).
- Every file v3.10 created, every S1–S8 scratch script and log, the S6/S7
  live scripts and `screenshots/v3-10/`: no credential in value position
  and no pair. The only hits there are the common word itself, as a string
  in Playwright's JSON reports, a key in `package.json` and ordinary prose,
  read one by one with the value masked. The live scripts
  read `TEST-ACCOUNT.local.md` in Node and passed the values only as a
  browser init-script argument. No screenshot shows Settings on the live
  server.
- Every Subsonic `t=` token in these files was checked against
  `md5(password + salt)`: the matches are all in the April folder below.

**Warnings (local files, not shipped, but they hold the live credential):**
1. **`.playwright-mcp/` (652 entries from April 2026, 11 MB).** Old browser
   tooling output in the project folder.
   - `console-2026-04-24T15-30-15-582Z.log`, `console-2026-04-24T15-34-02-663Z.log`
     and `console-2026-04-25T09-31-16-330Z.log` hold **72 `t`/`s` pairs that
     verify against the current password**: replayable against the live
     server. They are request URLs to the old mock host, signed with the
     same word the live account uses (§1h's "stale documentation" trap).
     The same lines carry the username as `u=`.
   - `page-2026-04-11T13-25-07-485Z.yml` and `page-2026-04-11T13-25-22-676Z.yml`
     (line 13) record the Login form's password field with the password in
     it; the second also has two cover-art URLs to the live server with
     `u=` (lines 76, 81; their `t` is cut short, so not replayable).
   - Recommended: delete the folder (or keep it out of any repository; the
     `.gitignore` already proposes this) and, before any public push, change
     the test account's password, since the values have been on disk in
     plain text. S8 does not delete it (deleting files not named in the
     brief needs your go-ahead).
2. **Historical `PROGRESS.md` prose (known; not edited, ticket §4).**
   - Line 281: a cache-key prefix of the form
     `sonance_apicache_v1__<username>|<server URL>|`, which contains the
     username (and so, here, the password).
   - Line 2366: "successful login with <username>/<password>", the pair in
     prose.
3. **Claude Code's own transcripts** (`~/.claude/projects/` for this
   folder, outside the project). 9 of 24 contain the value in value
   position, and 4 contain 56 replayable pairs. All are from the v3.9
   sessions (2026-09-03 to 09-07) and the v3.10 planning session
   (2026-10-01), which read `TEST-ACCOUNT.local.md` (its audit-grep line
   holds the value; the harness redacted the table but not that line). None
   of the S1–S8 transcripts do.

**Informational (by design, or test-only):**
- `config.xml`: id `http://simmo.dev/sonance`, application
  `S0nance003.Sonance`; `<access origin="*" subdomains="true"/>` (needed
  because the server address is entered at run time; the code only talks to
  the stored server); privileges `internet`, `tv.audio` (AVPlay),
  `volume.set` and `tv.inputdevice` (the remote's keys). No code calls the
  Tizen volume API (`tizen.tvaudiocontrol`), so `volume.set` looks unused;
  harmless, and older than v3.10. "BY SIMMO" / "By Simmo" in the splash,
  Login, Settings and the oblong icon's source is the brand.
- `index.html`: no server address, no credential, no debug element; the two
  `<audio>` elements have no `src` (the browser fallback; AVPlay on the TV);
  `$WEBAPIS/webapis/webapis.js` is Tizen's own.
- `tests/browser/index.html:59` (the old browser test page) has the test
  server's address as an input default. Test-only, never packaged.
- Console: 6 `console.*` calls in the app sources (the scan prompt's grep
  counts 8 lines; two are comments): `SonanceUtils.log`, its debug toggle,
  `warn` and `error`, and two warnings, all `[Sonance]`-prefixed; `log` is
  off unless `?debug=1` (D28). No request URL is ever logged, so no token
  is; two debug-only lines name the server and the username
  (`js/api.js:224`, `js/auth.js:66`). No TODO, FIXME, HACK, XXX or TEMP in
  the app sources; no test song names.

**Files that should not go into a public repository** (STEP 4): the four
`.wgt` packages (build output; two of them, `Sonance3udEx.wgt` and
`Sonance3uDYB.wgt` from 26–27 April, are stray older builds), the two
bundles (generated), `.playwright-mcp/`, `screenshots/` (640 files, 242 MB),
7 `.DS_Store` files, `test-results/`, and `node_modules/`. The
`.gitignore` already covers the credential file, `.env`, `next_prompt.md`,
`.DS_Store`, `node_modules/` and Playwright output; the rest is proposed
there, commented out.

## 8. Hygiene notes (reported, not changed)

- `icon-oblong.png` (512×423, the Seller Office store asset D59 says to keep)
  exists only at `screenshots/older_than_v3-9/icon-oblong.png`, where a PNG
  tidy-up moved it on 2026-10-01 (D60). No package uses it; move it back
  before tidying `screenshots/`.
- The dead `album-active` mechanism (D82): `album.js` and `artist.js` add the
  class to `#content-area`, which no longer exists, and the
  `#page-current.album-active > .page-content` rule matches nothing.
- Stray packages `Sonance3udEx.wgt` and `Sonance3uDYB.wgt` in the root (from
  April, before S3). Only `Sonance3.wgt` and `Sonance3-Oblong.wgt` are this
  version.
- The 100 % Login baseline differs from S6's by 85 pixels only when
  Playwright's `animations: 'disabled'` and `caret: 'hide'` are used
  together: a capture artefact (S7).
- At 100 % the artist page's left column, a scroller since S5 (D108), draws
  "Play All" with slightly different anti-aliasing in the browser (808 px,
  no position change).
- Two stale comments in the test harness still describe the 300 ms input
  lock S4 removed (D52): `e2e/smoke.spec.ts:22-25` and `navTo` in
  `e2e/helpers/sonance.js`. Their waits are harmless.
- The test account sees one library (it saw seven in S1–S4), so the
  multi-library criteria were met on the mock rig only.

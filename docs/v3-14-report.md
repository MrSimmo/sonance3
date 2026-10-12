# Sonance v3.14 — report

**Version 3.14** (`config.xml` 3.14.0, Settings → About **V3.14**) fixes the two things reported from
the Samsung Q90R on 2026-10-12, from `tickets/prompt-3.14.md` / `tickets/ticket-3.14.md`
(requirements L1–L4, H1–H4, V; decisions D205–D215 in the ticket's §9). Built 2026-10-12 in one
session, on top of 3.13 (`4760205`, tagged `v3.13`, left as it is).

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row
tile); they are the same app and replace each other.

## 1. What changed

- **Long lyric lines (L1–L3, `css/styles.css`, `js/screens/nowplaying.js`).** Lines already
  wrapped; they were cut for three reasons, each fixed:
  - the active line's `scale(1.15)` ran past the clipping, masked wrapper: synced lines are now laid
    out at `calc(100% / 1.15)` with `overflow-wrap: break-word`, so the scaled line ends inside it,
    lines break between words, and only a word wider than a row breaks inside it (no hyphens).
    Unsynced lines never scale and keep the full width (D206);
  - at 175 % and 200 % the left column's controls covered the start of the lines (measured: the text
    started 1.23rem and 7.40rem under the controls row): the lyrics and credits panels now take
    `left: 52.6rem; width: auto; max-width: 55%; margin-left: auto`, which is 3.13's box up to about
    164 % and, above it, puts the text 2rem clear of the controls (D205);
  - the scroller centred the active line with the height it had at weight 400 and could leave it in
    the top fade: it now reads the line's real height when it becomes active, keeps its scaled text
    below the fade (a line taller than the unfaded band starts at the band's top), and no longer
    pins the first lines inside the fade (D208).

  A wrapped line is one element with one start time, so all its rows light up together.
- **Hold OK on the silver remote (H1–H3, `js/focus.js`).** On a long-press zone a keyup is now
  provisional: an OK keydown within 100 ms (`RELEASE_GRACE_MS`) continues the hold (D207). Once an OK
  keyup has been seen since launch, a key still down at 500 ms opens the sheet with or without
  auto-repeats; with none ever seen, 3.13's 1,200 ms rule stays. After a hold opens the sheet, OK is
  swallowed until the key is really released (D211). A short press on a track row now activates
  100 ms after its keyup. Every other zone keeps OK on keydown.
- **Key trace (H4, `js/perf-hud.js`).** With Settings → Advanced → Performance overlay on, a panel
  under the readout lists the last 12 key events, newest last (`down  13  Enter  rep  +40 ms`):
  down or up, `keyCode`, `key`, the repeat flag, and the milliseconds since the previous event from
  `event.timeStamp`. Capture-phase listeners; nothing is attached while the overlay is off (D213).
- **Test rig.** `?mockLyricsLong=1` on both mock backends (13 long and short synced lines inside the
  20 s WAV, or unsynced with `mockLyricsUnsynced=1`; original text, with two lines at the live
  song's longest lengths, D210). New specs: `e2e/lyrics-wrap.spec.ts` (20 tests),
  `e2e/hold-ok-sequences.spec.ts` (12), `e2e/perf-hud-keys.spec.ts` (5): 386 tests in all. Five
  existing tests changed, each for a stated reason (D212, D213). The focus-clip sweep gained a
  lyrics-open state (D214).
- **Version.** `config.xml` 3.14.0 (the version attribute only), About V3.14, `JellyfinAPI` VERSION
  3.14.0, cache-bust `v3-14`; both packages rebuilt.

## 2. Verification (summary)

See §6 for the commands and the pasted output.

- **RED then GREEN** for L, H1–H3 and H4: each new test that describes changed behaviour failed on the
  unchanged code; the guards passed on both.
- **L:** at 100, 125, 150, 175 and 200 %, on the Subsonic and the Jellyfin mocks, every lyric line,
  active or not, lies inside the wrapper (the scale included), breaks only between words except the
  30-character word, and is never hyphenated; each active line is in the unfaded band (or, too tall
  for it, starts at its top), clear of its neighbours, and white on every row; lyric and credit
  text start at least 2rem right of the column; the panels at 100–150 % are 3.13's to the pixel.
- **H:** IR-style holds, release/press pairs from 100 ms and from 300 ms, a late keyup, no keyup ever,
  a short press, an immediate release, a new press after the grace, a fresh press on the sheet, and
  all eight long-press zones (album, playlist, Songs, genre songs, Search songs, Queue, Up Next,
  artist Popular).
- **Whole suite** at 150 % and 100 %, and the 200 % subset; the focus-clip sweep at five sizes; the
  100 % visual diff against 3.13; both packages unzipped and checked.

**Seen in the browser, worth knowing on the TV:**

- At 200 % the lyrics panel is 868 px wide, so a row holds about 15–20 characters and a line of more
  than about 85 characters is taller than the unfaded band: it starts at the band's top and its
  last rows run into the bottom fade (`screenshots/v3-14/lyrics-long-200.png`, D209). The example
  song's longest line is 33 characters: 2 rows at 200 %.
- At 175 % and 200 % the credits panel is narrower too, so beside the 22rem labels the values wrap
  onto more rows (`screenshots/v3-14/credits-200.png`, D215). Unchanged by design otherwise.

## 3. TV checklist

In order. Each says what a failure looks like. The browser cannot show the TV's fonts, its remote or
its key events. Recommended before tagging `v3.14`.

1. **Version.** Settings → About reads **V3.14**. *Failure:* V3.13: the old package is still
   installed.
2. **Lyrics.** Play "Since I Don't Have You" and view it at 100 %, 150 % and 200 % (Settings →
   Appearance → Interface size):
   - long lines wrap at whole words;
   - the highlighted line is complete and white on every row;
   - nothing is cut at the right or hidden under the controls.

   *Failure:* letters are cut at either side, or a row of the highlighted line is dim.
3. **Colour-button remote.** Hold OK on a song: the sheet opens after about half a second and
   nothing plays. *Failure:* the song plays, or nothing happens until you let go.
4. **Silver remote.** The same as item 3.

   *If it fails:*
   1. Turn on Settings → Advanced → Performance overlay.
   2. Open an album, hold OK on a song for two seconds, and photograph the overlay's key lines.
   3. Do the same with the other remote.
   4. Send both photos (§8 Q1).

   (The key lines are the panel under the FPS readout, top left, headed "keys, newest last". §8 Q1
   is in `tickets/ticket-3.14.md`; §4 below says what the photos decide.)
5. **Short press.** A short OK on a song plays it at once, with no noticeable delay, on each remote.
   *Failure:* a visible pause before it starts (the grace is 0.1 s), or the sheet opens instead.
6. **Other rows.** Hold OK on an Up Next tile, a Queue row and a Search song: the same as item 3.
   *Failure:* as item 3.

## 4. Open questions (ticket §8)

- **Q1. What does the silver remote send while OK is held?** Still unknown: only the TV can show it,
  and item 4's photos will. Read them like this:
  - `down 13 Enter`, then `up`/`down` pairs a few ms apart, then a final `up`: release/press pairs,
    which 3.14 handles (H1). If item 4 still fails, a gap from `up` to the next `down` is larger than
    100 ms: G is retuned from the photo (Q2).
  - `down 13 Enter` and then nothing until a single `up` when you let go: no repeats, which 3.14
    handles (H2) once an OK keyup has been seen since launch.
  - `down 13 Enter` and an `up` straight after it (a few ms), then nothing while OK is held: the
    remote reports no hold at all. No key rule can see it; a later version picks another way to
    open the sheet on that remote (ticket §4).
  - A different `keyCode` or `key` for OK on that remote would also show here.
- **Q2. The value of G** is 100 ms, chosen in the browser (D207); the trace's gaps confirm or retune
  it.

## 5. Decisions

D205–D215, each with its reason, and how each requirement's acceptance was read:
`tickets/ticket-3.14.md` §9.

## 6. Verification (T7, 2026-10-12)

Filled in by the final verification below.

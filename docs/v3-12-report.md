# Sonance v3.12 — report

v3.12 brings in the three open pull requests: #5 and #1 merged as they are,
and #2's features rebuilt on 3.11's code, each crediting its author. Spec:
`tickets/ticket-3.12.md` (R1–R11; decisions D167–D181 in its §9).
Settings → About reads **V3.12**.

## 1. What changed

- **Opus playback (R1).** An Opus track (suffix `opus`, or a contentType
  naming opus) streams from `stream.view?…&format=mp3&maxBitRate=320`; every
  other track's URL is 3.11's, byte for byte. One function decides every
  stream URL (the load, both prepare-next paths and the seek reload). A
  transcode has no byte ranges, so a seek reloads it with `timeOffset`
  (whole seconds) about 0.4 s after the last press, and the player adds the
  offset to the engine's position; the duration is the track's own. A
  resume into an Opus track opens it at the saved position. AVPlay is never
  asked to `seekTo` a transcode.
- **Random albums (R2).** The Albums Sort chip ends Most played → Random →
  Name. Random is one random sample (500, the server's maximum, per library
  in scope), "Random sample of N albums"; it stays until Random is chosen
  again, so Back and leaving Library keep the order and the focus.
- **Artists sort (R3).** The Artists tab gets the Albums header: "Artists",
  the count, and a Sort chip: Name, Most albums, Random.
- **Albums per Home row (R4).** Settings → Appearance, after Background:
  Standard (6) / 9 / 12. With nothing chosen Home is exactly 3.11's.
- **Popular songs (R5).** On an Artist page, between the discography and
  the biography, up to ten of the artist's top songs when the server has
  them (Navidrome asks Last.fm). OK plays the ten from that song; hold OK
  opens the options panel.
- **Why a track did not play (R6).** Each failed track shows "<title> —
  format not supported" or "<title> — couldn't be loaded"; three in a row
  still end on "Playback stopped — tracks could not be played".
- **Artist → similar Artist (R7).** It reproduced on the mock: the new page
  showed no albums, biography or similar artists (they were drawn into the
  page being left, which stays in the DOM for the zoom), and a slow answer
  for a page already left overwrote the next one. Fixed.
- **An Artist page's first album, after Up (D181).** Found by the close-out
  focus-clip sweep: once the right column scrolls (Popular makes it do so
  on the mock; an artist with many albums did in 3.11), Up back to the top
  left the first album row cut off by 13–24 px at 125–200 %. Fixed (the
  column is the scroll's reference, as on the album page).
- **PR #5** (test-helper input validation) and **PR #1** (`shell.nix`, the
  `#!/usr/bin/env bash` shebang) merged with real merge commits;
  `shell.nix` gains `perl` and `gzip`.
- **Credits:** README "Contributors", `CHANGELOG-3.12.md`, and David BELEY's
  `Co-authored-by` on every commit that carries a #2 feature.

## 2. Verification (summary)

- **Suite:** 258 tests (231 + 27 new), keyboard-only. Final runs after the
  last change: 150 % 258 passed (exit 0); 100 % 258 passed (exit 0) on the
  second run — the first final 100 % run failed once in `backdrop.spec.ts`
  "R10 not visible on Now Playing" (max 25/255 against 2), which then passed
  10 of 10 alone and with the specs before it; the 200 % subset 124 passed.
  Before (3.11): 231 passed at 150 %.
- **Every new behaviour seen failing first** (R1–R7, D181), or labelled a
  guard where it must pass before and after (R4's default identity, R5's
  empty case).
- **Default unchanged:** Home's five `getAlbumList2` requests equal 3.11's
  (`size=6`), and the 100 % Home screenshot is pixel-identical.
- **Focus-clip sweep:** 0 clipped at 100/125/150/175/200 % (165 states each,
  with the Artists chip, Popular rows, the new Settings row and Home with
  12). Its first run found D181.
- **Visual, 100 %:** 15 of 19 states identical to 3.11; Artists (the
  header), Artist detail (Popular), Settings top and bottom (the new row,
  About) differ, as intended. Details in section 7.
- **Live (read-only):** Home, Albums → Random, Artists in each order and
  Deadmau5's page with Popular; 0 page errors, no write request, no error
  from the server.

## 3. Decisions (ticket §9)

| D | What |
|---|---|
| D167 | The ticket and prompt committed at the start (they were untracked) |
| D168 | PR #5's head moved to 7333063 after planning; it rebuilds the two packages with byte-identical contents, so the whole head was merged |
| D169 | `shell.nix` lists `perl` (missing) and `gzip` (implicit in mkShell) |
| D170 | R7 reproduced: Artist lookups and zone selectors scoped to the page; stale answers dropped |
| D171 | The per-track toast's wording; AVPlay causes from Samsung's reference |
| D172 | In the browser, MediaError 4 is also a 404 or a refused request; the message tells them apart |
| D173 | One stream-URL decision; `timeOffset` left out at 0 |
| D174 | A transcode's duration is its metadata, not the engine's (refines R1.4) |
| D175 | Seek reloads wait 400 ms for the presses to stop; paused, until Play |
| D176 | A seek's reload is not a new track (no trackchange; its failure does not count toward the cap) |
| D177 | Random albums: one uncached sample, kept until Random is chosen again; "Random sample of N albums" |
| D178 | Albums per Home row: three values cycled; App's Home prefetch follows it |
| D179 | The Artists header and its three orders |
| D180 | Popular songs: `getTopSongs` by name, rows reuse `.track-row` |
| D181 | The Artist right column is `position: relative`: Up from the rows below no longer cuts the first album row (found by the close-out sweep; latent in 3.11) |

## 4. TV checklist

In order. Each says what a failure looks like. The browser cannot show
AVPlay, the remote, or the TV's compositor, so these are the TV's to prove.

1. **Install and check the version.** Install `Sonance3.wgt` (square icon)
   or `Sonance3-Oblong.wgt` (wide tile; same app). Settings → About reads
   **V3.12**. *Failure:* it reads V3.11 — the old package is still
   installed.
2. **Opus plays (R1).** The test server has no Opus files (30,458 songs:
   FLAC, M4A, MP3), so this needs one added to a library. Play it.
   *Expect:* it plays; the first play may take several seconds to start (the
   server's first transcode of a FLAC took 9.7 s to its first byte, a second
   one 0.4 s). *Failure:* silence and then "<title> — couldn't be loaded" or
   "— format not supported", and a skip to the next track.
3. **Opus seeks both ways (R1).** On Now Playing, Up to the progress bar,
   Right and Left a few times. *Expect:* the time label jumps at each press;
   about half a second after the last press the music continues from there.
   *Failure:* it restarts from 0:00, the time label snaps back, or it stops.
4. **Opus moves on gaplessly (R1).** Let an Opus track end with another
   track after it. *Expect:* the next starts as with any other format.
   *Failure:* a stop at the end, or a long gap.
5. **Opus resumes after a restart (R1).** Play an Opus track a minute in,
   leave Sonance, start it again, press Play. *Expect:* it continues at the
   saved position. *Failure:* it starts at 0:00, or at a different point.
6. **Random albums (R2).** Albums → Sort → Random. *Expect:* "Random sample
   of 500 albums" and a shuffled grid; open an album and Back: the same
   album has the focus; choose Random again (round the cycle): a new order.
7. **Artists sort (R3).** Artists tab: Up from the first row reaches "Sort:
   Name"; OK cycles Most albums and Random; Back from an artist returns to
   it. *Failure:* the order changes after Back, or Up does not reach the chip.
8. **Home rows of 9 and 12 (R4), at 150 % and 200 %.** Settings → Albums per
   Home row → 12, then Home: Right along a row to the 12th. *Expect:* the row
   scrolls and the focused card and its ring are whole. Repeat at 200 %
   (Interface size) and with 9. *Failure:* a card or its ring cut at the
   row's edge.
9. **Popular songs (R5).** Open Deadmau5 (the live server has top songs for
   it). *Expect:* POPULAR between Discography and Biography, ten rows; Down
   through them; OK plays from that song; hold OK opens the options panel. An
   artist without top songs (Ludwig Van Beethoven) shows none.
10. **The error toast (R6).** With a file the TV cannot play, if the library
    has one: its name and the cause in a toast, then the next track; three in
    a row end on "Playback stopped — tracks could not be played". The cause
    comes from AVPlay's error names, which only the TV produces. *Failure:*
    "couldn't be loaded" for a file whose format the TV does not support
    (the error name was not recognised).
11. **Artist → similar Artist (R7).** On an artist with similar artists, OK
    on one. *Expect:* the new page has its albums, popular songs, biography
    and similar artists, and the focus on its first album.

## 5. Open questions (ticket §8)

1. **Does the Q90R play Ogg Opus natively?** Not tested: the server
   transcodes every Opus track in this build. Answering it needs an Opus
   file and a build that does not transcode; until then the transcode stays.
2. **320 kbit/s or the server's default?** 320 kept. No Opus on the live
   server to time; a FLAC → MP3 320 transcode took 9.7 s to its first byte
   on a first request and 0.4 s on the next.
3. **Opus on the test account, and top songs:** no Opus (0 of 30,458);
   top songs yes for some artists (Deadmau5 10; Various Artists, Beethoven
   and "00.db" 0).
4. **The packages and bundles in git (PR #2's remark):** your decision; D165
   stands.
5. **CI run 37656368168:** separate from 3.12 (the known R10 Linux pixel
   failure, `PROGRESS.md` 2026-10-09).

## 6. Drafts for you to post

Nothing has been posted: GitHub writes are yours.

**PR #2 — thank-you and close:**

> Thank you, @dbeley — every feature in this PR is in Sonance 3.12. The PR
> was written against the code from before 3.9, and the interface has moved
> on a lot since (rem sizing for the interface-size setting, a new focus
> style, and Tizen 5.0's CSS limits — no flex `gap`, no colour
> transitions), so I couldn't merge it as it stands. Instead each feature was
> rebuilt on 3.11, using your commits as the guide:
> [44b2771](https://github.com/MrSimmo/sonance3/pull/2/commits/44b27715133f451822342411182dc1ec45dd6b88)
> (Opus, random albums, Home rows),
> [0067637](https://github.com/MrSimmo/sonance3/pull/2/commits/00676373eb4464bde47cdc07dc61f68276acb66b)
> (the Albums sort) and
> [c8ee26e](https://github.com/MrSimmo/sonance3/pull/2/commits/c8ee26e7f989a1c584bcafa6a80a7b02d29b89e7)
> (popular songs). Every 3.12 commit that carries one of them credits you as
> co-author, and you're in the README's Contributors and the 3.12 changelog.
>
> What changed on the way: Opus is transcoded to MP3 at 320 kbit/s, and
> because a transcode can't be range-seeked, seeking reloads the stream with
> `timeOffset`; the random albums row was already on Home as "Rediscover",
> so it isn't there twice; the Home row size became a setting (Standard / 9
> / 12) so the default layout stays the same; the playback error toast names
> the track and the cause; the Artists sort is Name / Most albums / Random;
> and your artist-page fix reproduced (the page being left stays in the DOM
> during the zoom) and is in. Closing this in favour of 3.12 — thank you!

**PR #1 (optional; GitHub marks it merged when you push):**

> Thanks @dbeley — merged in 3.12. I added `perl` and `gzip` to `shell.nix`
> (`build.sh` uses both). I don't have Nix here: could you confirm that
> `nix-shell` and then `./build.sh` work on NixOS?

**PR #5 (optional; GitHub marks it merged when you push):**

> Thanks @anupamme — merged in 3.12. For the record, the input to that
> function is the base64 of screenshots our own tests take, so this hardens
> test code rather than fixing a vulnerability. The packages your second
> commit rebuilt are byte-identical inside.

**Release notes paragraph (3.12):**

> Sonance 3.12 is the community release. Thanks to @dbeley, Opus files now
> play (streamed through your server as MP3), Albums can be shown at random,
> Artists can be sorted by name, album count or at random, Home rows can
> hold 9 or 12 albums, artist pages list popular songs, and a track that
> won't play now says why — plus a NixOS dev shell. Thanks to @anupamme for
> hardening the test helpers. Install `Sonance3.wgt` or
> `Sonance3-Oblong.wgt`; Settings → About reads V3.12.

## 7. Verification (T12, 2026-10-09)

**e2e suite** (Playwright 1.63, Chromium, 1920×1080, DPR 1, keyboard only):

```
before (3.11), 150 %                 231 passed (15.7m)  exit=0
after, 150 % (before D181)           256 passed (16.9m)  exit=0
after, 100 % (before D181)           256 passed (16.6m)  exit=0
after, 200 % subset (before D181)    122 passed (7.5m)   exit=0
final, 150 %                         258 passed (16.9m)  exit=0
final, 100 %, first run              257 passed, 1 failed (16.5m)  exit=1
  ✘ backdrop.spec.ts:135 R10 not visible on Now Playing … Expected <= 2, Received 25
  backdrop R10 alone, --repeat-each=10 at 100 %   10 passed
  the 9 specs up to and including backdrop at 100 %  30 passed
final, 100 %, second run             258 passed (16.7m)  exit=0
final, 200 % subset                  124 passed (7.6m)   exit=0
```

The one failure is the test that already fails on GitHub's Linux runners
(README "Known CI failure"); it plays only WAV tracks on Now Playing, whose
code 3.12 does not touch. It is reported, not loosened (your rule).

The 200 % subset: `focus-paths`, `npbar`, `focus-style`, `options-sheet`,
`transitions`, `bundled-walk`, `ui-scale`, and the seven new specs
(`opus`, `albums-random`, `artists-sort`, `home-row-size`,
`artist-popular`, `track-error-toast`, `artist-scope`).

**Focus-clip sweep** (`tests/tools/focus-clip-sweep.js`, 5 sizes): first
run 0 at 100 %, 2 at 125–200 % (the Artist first album row, 11–18 px: D181);
after D181 0 clipped at every size, 165 states each.

**Visual, 100 %** (`visual-baseline.js --scale 1 --geometry`, T0 vs final;
19 states, geometry ok in all, 0 page errors):

| State | Differing px | Max Δ | Box (x0,y0–x1,y1) | Why |
|---|---|---|---|---|
| home | 0 | 0 | — | default unchanged |
| library-artists | 623,520 | 215 | 368,138–1731,983 | the header; the grid moves down under it |
| artist-detail | 9,720 | 214 | 429,364–1705,979 | Popular under the discography |
| settings-top | 17,910 | 214 | 160,197–937,979 | the new row; About V3.12 |
| settings-bottom | 15,947 | 229 | 158,108–937,301 | the rows below it move by one |
| the other 14 | 0 | 0 | — | |

Login differed by 85 px (max 13) in one capture of three: the known
capture artefact (v3.10 S7); 0 in the other two.

**Live** (bundled 3.12 build through the Node-side proxy; resume off; no
playback; Settings not shown):

```
home album lists: frequent:6 newest:6 random:6 recent:6 starred:6
albums random: "Sort: Random", "Random sample of 500 albums"; one request random:500
artists: 1,100 artists; Most albums: Various Artists (688), Deadmau5 (114), Ludwig Van Beethoven (99), Gorgon City (42) …
artist Deadmau5: DISCOGRAPHY, POPULAR (10), BIOGRAPHY, SIMILAR ARTISTS
page errors: 0; write endpoints: none; server responses >= 400: none
(one 404 from the dev server: $WEBAPIS/webapis/webapis.js, Tizen's own include, expected in a browser)
```

R1 live: 30,458 songs (flac 29,760, m4a 431, mp3 267), no Opus. One FLAC
asked for as MP3 320 (64 KB): `audio/mpeg`, no Content-Length,
`Accept-Ranges: none`, Range ignored, `timeOffset=30` accepted; first byte
9.7 s, then 0.37 s. R5 live: top songs Deadmau5 10, Various Artists 0,
Ludwig Van Beethoven 0, "00.db" 0.

**Packages:** `Sonance3.wgt` and `Sonance3-Oblong.wgt` each hold config.xml,
icon.png, index.html, the two bundles and css/styles.css; config, index and
bundles are byte-identical to the working tree's; icons 256×256 and
1920×1080; `version="3.12.0"`; About `V3.12`; `?v=v3-12` ×3; no `?.`/`??`;
the live server's address in neither.

**Authorship:** `ca4e38e` (anupamme) and `e08bdac` (dbeley) are reachable
through the merges 7c05958 and f3429ee; every R1–R7 commit (and D181)
carries `Co-authored-by: David BELEY`.

**Credential hygiene:** every file changed this session audited inside
Node: 0 `t`/`s` pairs (so 0 replayable), the 3 key-adjacent matches are
prose about the account file (two from the initial commit, one the line
D166 redacted); the whole-token matches are the ordinary English word the
account uses.

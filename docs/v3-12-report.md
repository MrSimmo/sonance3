# Sonance v3.12 — report

v3.12 brings in the three open pull requests: #5 and #1 merged as they are,
and #2's features rebuilt on 3.11's code, each crediting its author. Spec:
`tickets/ticket-3.12.md` (R1–R11; decisions D167–D182 in its §9).
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
- **PR #5** (test-helper input validation) and **PR #1** (`shell.nix`, the
  `#!/usr/bin/env bash` shebang) merged with real merge commits;
  `shell.nix` gains `perl` and `gzip`.
- **Credits:** README "Contributors", `CHANGELOG-3.12.md`, and David BELEY's
  `Co-authored-by` on every commit that carries a #2 feature.

## 2. Verification

Filled at close-out (T12): see below, section 7.

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

## 7. Verification (T12)

To be written at close-out.

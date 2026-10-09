# Sonance v3.12 — Community contributions: Opus playback, more sorting, Home row size, Popular songs

**Status:** planned 2026-10-07 in a read-only planning session; no code
written. Executable prompt: `tickets/prompt-3.12.md`. Requirements are R1–R11.
**D-numbers continue from D167** (D166 was the last, in
`tickets/ticket-3.10.md` §11 "v3.11 release").

## 1. Version & scope

v3.12 takes in the three open GitHub pull requests at
github.com/MrSimmo/sonance3 and credits their authors. PR #5 (test-helper
input validation) and PR #1 (a NixOS dev shell) are merged as they are, with
real merge commits, so their authors keep their commits. PR #2 was written
against the pre-3.9 code and cannot be merged; its features are rebuilt on 3.11
under the v3 design system, each commit crediting its author:
- Opus playback through a server transcode;
- a Random album sort;
- an Artists sort;
- a Home row size setting (default unchanged);
- a "Popular" section on the Artist screen;
- a per-track playback-error toast;
- a fix for Artist-screen lookups that can hit the outgoing page (only if it
  reproduces).

The version becomes 3.12 and both packages are rebuilt.

## 2. Background

### 2.1 The pull requests (reviewed 2026-10-07)

| PR | Author | Opened | Base | Content | Merge onto `main` (9426b2d), dry run | Decision |
|---|---|---|---|---|---|---|
| #5 | Anupam Mediratta (@anupamme); "Automated security fix by OrbisAI Security" | 2026-10-07 | 292bbe9 | `e2e/helpers/sonance.js` +3 lines | clean | merge as-is (R8) |
| #1 | David BELEY (@dbeley) | 2026-05-01 | 93f7407 | new `shell.nix`; `build.sh` shebang `#!/usr/bin/env bash`; README whitespace and one Nix sentence | `README.md` conflicts; `build.sh` clean | merge, resolve README, follow-up commit (R9) |
| #2 | David BELEY (@dbeley); "done with the help of AI" | 2026-05-01 | 93f7407 | 3 commits (44b2771, 0067637, c8ee26e), +391 −40 in 7 files | conflicts in `js/player.js`, `js/screens/artist.js`, `js/screens/home.js`, `js/screens/library.js`, `tests/mock-boot.js` | rebuild on 3.11 and credit (R1–R7, R10) |

Commit identities, from the PRs:
- `David BELEY <6568955+dbeley@users.noreply.github.com>`;
- `anupamme <mediratta@gmail.com>` (profile name Anupam Mediratta).

Base 93f7407 is the GitHub-uploaded history from before the local repository
joined it (b8d9c8d), so PR #1 and #2 predate v3.9–v3.11.

### 2.2 PR #5 — not a vulnerability, safe to merge

**The claim.** The PR says the base64 passed to
`fetch('data:image/png;base64,' + b64)` in `_pngInPage` is "user-controlled"
and could lead to XSS (CWE-20).

**Why it is wrong.**
- The only input is the base64 of screenshots our own specs take
  (`page.screenshot()` → Buffer → base64), in `e2e/backdrop.spec.ts` and
  `e2e/np-focus-mode.spec.ts`.
- The MIME type is fixed to `image/png`, and the result only feeds
  `createImageBitmap`.
- `e2e/` is in neither package (`Sonance3.wgt` holds 7 files).

**Checked at planning.**
- PR #5's helper is `main`'s plus exactly the 3 added lines.
- The regex `^[A-Za-z0-9+/]+=*$` is linear (an 8 MB string in 25 ms in Node)
  and accepts Node's base64.
- Both specs pass with it (16/16).

It is harmless hardening of test code, recorded as such, not as a security fix.

### 2.3 PR #2 — what it contained, and what 3.11 already has

Pre-checked against `main` on 2026-10-07 (the executor re-checks; see each
requirement):

| PR #2 item | On `main` today |
|---|---|
| Home rows 6 → 9 (Recently Added, Recently Played) | Rows still fetch 6 (`js/screens/home.js` ~:192–193; `EXTRA_ROW_SIZE = 6` ~:39) → R4 |
| A "Random Albums" Home row | **Already present** as "Rediscover" (`EXTRA_ROWS`, type `random`, v3.10 A4/D131). Not added again |
| Opus: `format=mp3` for Opus tracks (load path only) | Nothing. `getStreamUrl(songId)` takes an id only (`js/api.js` ~:511); three callers (`js/player.js` ~:210, ~:463, ~:585) → R1 |
| Toast "Playback error: format not supported" on each error | Only after 3 failures in a row (`_onLoadFailure`, `js/player.js` ~:635; cap at ~:108) → R6 |
| Albums sort bar: A-Z, Recent, Random | The A2 sort chip has Name, Artist, Recently added, Year, Most played (`ALBUM_SORTS`, `js/screens/library.js` ~:66–75); **no Random** → R2 |
| Artists sort bar: A-Z, Albums, Random | No Artists sort (A2's header, `_mountAlbumsHeader` ~:634, is Albums-only) → R3 |
| Artist "POPULAR" (getTopSongs, 10) | No `getTopSongs` anywhere in `js/` → R5 |
| `artist.js` lookups scoped to the screen's container | 13 document-wide lookups remain (`js/screens/artist.js` ~:94, 139, 245, 254, 261, 270, 435, 436, 563, 564, 594, 611, 654) → R7 |

PR #2's code cannot be reused as it stands.
- **Its CSS breaks the rules:** flex `gap`, px units, colour and border
  transitions, and a box-shadow focus ring on buttons are all banned on
  Tizen 5.0 or by the v4 focus rules.
- **It predates current code:** rem scaling (D49), v4 focus (D50), the A2
  Albums header, the A4 Home rows, and the prepare-next stream URLs.

Its ideas and much of its logic carry over; the code is rebuilt.

### 2.4 Opus on the Q90R

- **Samsung's spec:** the 2019 TV media specification lists Opus among the
  audio codecs, but only inside video containers (AVI, MKV, ASF, MP4, 3GP,
  MOV, FLV, VRO, VOB, PS, TS, SVAF); Ogg is not listed. `.opus` files are Ogg
  Opus. PR #2's author needed a transcode on a 2021 QN90A.
- **Navidrome:** `stream.view` takes `format` (e.g. `mp3`) and `maxBitRate`.
  A transcoded stream is produced on the fly by ffmpeg and has no byte ranges,
  so it can't be seeked by range. Navidrome accepts `timeOffset` (seconds) and
  applies it with ffmpeg `-ss` when it transcodes.
- **So R1** transcodes Opus to MP3 by default, and seeks a transcoded track by
  reloading it with `timeOffset`. Whether the Q90R plays Ogg Opus natively is
  a TV question (§8).

Sources:
- Samsung, "2019 TV Video Specifications":
  https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2019-tv-video-specifications.html
- Navidrome streaming API notes:
  https://glama.ai/mcp/servers/@Blakeem/Navidrome-MCP/blob/c0ee251c8dff9236b2fb401b6cf412b504721b83/docs/api/10-streaming-downloads.md
- Symfonium, "Support timeOffset for audio too":
  https://support.symfonium.app/t/support-timeoffset-for-audio-too/1184

### 2.5 Home row widths (measured on the mock, 2026-10-07)

Album cards visible across a Home row: 8.8 at 100 %, 7.9 at 125 %, 6.5 at
150 % (default), 5.4 at 175 %, 4.7 at 200 %. Six leave a ~520 px gap at
100 %; at 150 % six nearly fill the row.

## 3. Decisions

### 3.1 Taken by the user (2026-10-07) — binding

- Include every PR #2 item: Opus, Albums Random, Home row size, Artists sort,
  Popular songs, the error toast and the Artist lookup fix. **Build each one
  only after confirming it is not already in place.**
- PR #5: merge as-is, after confirming it adds no bug or vulnerability
  (confirmed, §2.2).
- Home row size is a **Settings option**: Standard (today's 6, the default),
  9 or 12. The default design does not change.
- Credit the contributors.

### 3.2 Planning decisions (the executor may refine one with a D-number and its reason)

- **Authorship (R8–R10):**
  - PR #1 and #5 enter by real merge commits of their own head commits, so
    their authors stay the commit authors, and GitHub marks both PRs merged
    when the user pushes.
  - PR #2 is rebuilt. Each commit that carries one of its features ends with
    `Co-authored-by: David BELEY <6568955+dbeley@users.noreply.github.com>`,
    which GitHub credits to his account.
- **Opus (R1):** transcode to MP3 at `maxBitRate=320`, decided from the track's
  metadata, in one function that every stream URL goes through.
- **Random albums (R2):** one random sample (the server's maximum, 500) instead
  of paging, fixed until Random is chosen again.
- **Artists sort (R3):** client-side, since `getArtists` returns every artist.
- **Credit (R10):** a README "Contributors" section, credit in
  `CHANGELOG-3.12.md`, and drafted thank-you texts for the user to post.

## 4. Goals and non-goals

**Goals**
- Opus tracks play, seek and prepare gaplessly on the Q90R.
- Albums can be shown in a random order; Artists can be sorted by name, album
  count or at random.
- Users who want fuller Home rows can choose 9 or 12; nothing changes for
  anyone else.
- The Artist screen shows an artist's popular songs when the server has them.
- A track that cannot be played says why.
- The contributors' work is in, and they are visibly credited.

**Non-goals**
- Merging PR #2's code as it stands.
- Transcoding other formats (Ogg Vorbis, ALAC, APE, WavPack, DSD). The decision
  is one list, `opus` only in 3.12; widening it waits for TV tests.
- A user-facing transcoding or quality setting.
- Removing `Sonance3.wgt` or the bundles from git. PR #2's author suggests it,
  but D165 keeps them; it is the user's call (§8).
- A `flake.nix`, NixOS CI, or running the Playwright suite on NixOS.
- The GitHub Actions failure of run 37656368168 (cause unknown at planning;
  handled separately).
- Any change to the auth flow, the backdrop blur (D47) or the sleep timer.

## 5. Constraints

- **CLAUDE.md is binding:**
  - **JS:** Tizen 5.0 / Chromium 63, ES2017 in the `var`/`function` style. No
    `?.`, `??`, `Array.flat`, `Object.fromEntries` or top-level `await`.
  - **CSS:** no `backdrop-filter`; no flex `gap` (use `> * + *` margins); grid
    uses `grid-gap`.
  - **Animation:** only `transform` and `opacity`, never `transition: all`;
    colour and background snap; at most 0.25 s.
  - **Units:** every new length in rem; never CSS `zoom` (D49).
  - **Focus (v4):** solid `--focus-fill` with `--focus-ink`; cards scale with
    a ring; rows fill; no outline rings.
  - **Playback and network:** AVPlay is the only TV playback path; every API
    call goes through `SubsonicAPI`; the app talks only to the configured
    server.
- **Invariants** in `tickets/ticket-3.10.md` §5.3 hold (D6, D11, D17, D23–D25,
  D32, D33, D40, D47, V3.7-fix29, v3.9 NEW-1). R2's random sample is not a
  paginated list, so it does not go through the D23 cursor; record that with
  its D-number.
- **Credentials and server writes** follow `tickets/ticket-3.10.md` §5.4.
  Live probes are reads only. No playback in the app on the live server, and
  no star, playlist or server-config writes.
- **Design spec first:** new surfaces (the Artists header chip, the Popular
  section, the Settings row) go into `docs/UI-MOCKUP-REFERENCE.md` before CSS.
  They reuse existing tokens and components (the A2 `.library-chip`,
  `.track-row`, the R10 Settings row pattern).
- **Default unchanged:** with no new setting stored, Home's requests and its
  100 % screenshot are identical to 3.11's.

## 6. Requirements and acceptance criteria

Each requirement starts with a **pre-check**: confirm the planning finding
still holds on the code you have. If the feature is already in place, mark it
`[~]` with the evidence and do not build it.

### R1 — Opus playback through a server transcode

**Pre-check:** `grep -rni opus js/ --include='*.js' | grep -v min.js` finds
nothing; `getStreamUrl` takes an id only.

**Behaviour**
1. **Which tracks:** a track whose `suffix` is `opus` (any case), or whose
   `contentType` contains `opus`, streams from
   `stream.view?id=…&format=mp3&maxBitRate=320` (plus auth). Every other
   track's URL is byte-identical to 3.11's.
2. **One decision point:** one function decides a track's stream URL, for
   example `SubsonicAPI.prototype.getStreamUrl(songId, opts)` plus a
   player-side `_streamUrlFor(track)`. The load path and both prepare-next
   paths (`js/player.js` ~:210, ~:463) use it.
3. **Seeking:** seeking in a transcoded track reloads the stream with
   `timeOffset=<whole seconds>` and adds that offset to the engine's position.
   The progress bar, time labels, the prepare-next window (`duration − 5 s`),
   scrobbling and the resume-queue position all use the absolute position.
4. **Duration:** a transcoded track's duration comes from its metadata when
   the engine reports none.
5. **Resume:** a resume (A8) into a transcoded track at position p loads it
   with `timeOffset=p`.
6. **Browser fallback:** HTML5 `<audio>` uses the same URL decision.

**Acceptance**
- **e2e (mock):**
  - An Opus track's request carries `format=mp3&maxBitRate=320`.
  - A FLAC, MP3 or WAV track's URL equals 3.11's.
  - The prepared next URL for an Opus track carries the transcode.
  - Seeking to 90 s issues a request with `timeOffset=90`; afterwards the
    displayed position reads 1:30 ± 1 s and keeps advancing.
  - A resume at 42 s loads with `timeOffset=42`.
- **The mock models a transcoding server:** the dev server honours `format`
  and `timeOffset`, and gives transcoded responses no byte ranges.
- **Live (read-only):** report the library's suffix counts. If any `.opus`
  track exists, a Node-side GET of the first 64 KB with `format=mp3` returns
  `Content-Type: audio/mpeg`, and so does one with `timeOffset=30`. Otherwise,
  say so and leave it to the TV.
- **TV checklist (§7):** an Opus track plays, seeks both ways, moves to the
  next track gaplessly, and resumes after a restart.

### R2 — Random album sort

**Pre-check:** `ALBUM_SORTS` has no `random` entry.

**Behaviour**
1. **The chip:** the A2 sort chip gains **Random** at the end of its cycle.
2. **One sample, no paging:** Random requests
   `getAlbumList2(type=random, size=500)` (the server's maximum). With 2+
   libraries, it takes one sample per library, then merges, shuffles and caps
   them at 500. There is no offset paging and no offset-search total.
3. **Stable order:** the sample stays the list until Random is chosen again (a
   re-roll). Leaving Library and coming back, or Back from an album, keeps the
   same order and restores focus on the same album.
4. **Genre filter:** with a genre filter on, the list stays `byGenre`, as
   today.
5. **Count:** the header's count shows the sample size, worded as a sample
   (the wording gets a D-number).

**Acceptance (e2e, mock)**
- Cycling to Random issues exactly one `type=random&size=500` request per
  library in scope, and no request with `offset>0`.
- The grid shows the sample.
- Back from an album restores focus to the same album and index.
- Choosing Random again issues a new request.
- With two libraries, both are sampled.

### R3 — Artists sort

**Pre-check:** the Artists tab has no header or sort control.

**Behaviour**
1. **The orders:** the Artists tab gets a header with a sort chip built from
   the A2 chip component.
   - **Name:** the default; the server's order.
   - **Most albums:** album count descending, then name.
   - **Random:** shuffled once; choosing it again re-rolls.
2. **Kept for the session:** as for Albums. Both the virtual and the chunked
   render paths honour it.
3. **Focus:** Up from the grid's first row reaches the chip, Down from the chip
   enters the grid, and Left reaches the sub-nav. Back from an artist restores
   focus on the same artist.

**Acceptance (e2e, mock)**
- Each order is correct on the mock's artists (with album counts).
- The focus paths work as stated, and Back restores.
- The focus-clip sweep includes the chip at 5 sizes.

### R4 — Albums per Home row (Settings)

**Pre-check:** Home's album rows fetch 6 (`home.js` ~:192–193 and
`EXTRA_ROW_SIZE`). PR #2's "Random Albums" row already exists as "Rediscover".

**Behaviour**
1. **The setting:** Settings → Appearance gains **"Albums per Home row":
   Standard / 9 / 12**, after Background. Left, Right and Enter cycle it, as
   on the Background row (R10). It is stored in
   `localStorage['sonance-home-row-size']` (`9` or `12`; absent means
   Standard, 6).
2. **Where it applies:** every album row on Home (Recently Added, Recently
   Played, Your favourites, Most played, Rediscover) and their skeleton counts.
   The playlists row is unchanged.
3. **When:** it takes effect the next time Home is built.

**Acceptance**
- **Default unchanged:** with no key set, every Home `getAlbumList2` request
  is byte-identical to 3.11's (`size=6`). The 100 % Home screenshot matches
  the 3.11 capture taken at session start.
- **With 12:** each album row has 12 cards, Right walks to the 12th, the row
  scrolls, and no focus is clipped at 5 sizes.
- **With 9:** each album row has 9 cards.
- The setting survives a reload.

### R5 — Popular songs on the Artist screen

**Pre-check:** no `getTopSongs` in `js/`.

**Behaviour**
1. **API:** `SubsonicAPI.prototype.getTopSongs(artistName, count)` (default
   10), a cached read with the API's usual timeout.
2. **Section:** the Artist screen shows a **Popular** section after the
   albums and before the biography, only when the call returns at least one
   song. It has up to 10 v4 track rows (number, title, album, duration, star).
3. **Keys:** Enter plays the list from that row. Hold-OK opens the options
   sheet (A5, D133).
4. **Focus:** albums ↔ Popular ↔ similar artists ↔ the NP bar (D56). Left goes
   to the left panel.
5. **Empty is normal:** Navidrome fills top songs only when its Last.fm agent
   is configured. An empty answer or an error shows no section and no error.

**Acceptance (e2e, mock)**
- The mock answers `getTopSongs` with 10 songs for some artists and none for
  others; the section is present or absent accordingly.
- The down-walk passes through the section in order.
- Enter starts that song with the queue set to the 10; hold-OK opens the
  sheet.
- Live: the count for three artists is reported.

### R6 — Say why a track did not play

**Pre-check:** `_onLoadFailure` (`js/player.js` ~:635) only logs a single
failure; the toast comes after 3 in a row.

**Behaviour**
1. **Per-track toast:** every failed track load shows a toast naming the track
   and the cause: "format not supported" when the engine reports an
   unsupported format, otherwise "couldn't be loaded".
   - **AVPlay:** the cause comes from its error value, for example
     `PLAYER_ERROR_NOT_SUPPORTED_FILE`; check the names against Samsung's
     AVPlay API reference.
   - **HTML5:** the cause comes from the `MediaError` code (4 =
     `MEDIA_ERR_SRC_NOT_SUPPORTED`).
2. **One funnel:** `_onLoadFailure` receives the cause from all four failure
   paths.
3. **Stop toast unchanged:** "Playback stopped — tracks could not be played"
   still appears after 3 in a row, and is the last toast shown.

**Acceptance (e2e, mock)**
- A track with an unsupported format shows the format toast with its title.
- A failed fetch shows the load toast.
- Three failures in a row end on the stop toast.

### R7 — Artist screen lookups scoped to their page (only if it reproduces)

**Pre-check:** the 13 document-wide lookups listed in §2.3.

**Hypothesis:** during a zoom transition (up to 250 ms + 30 ms), the outgoing
Artist page is a ghost still in the DOM, before the new page.
`document.getElementById('artist-bio-stub')` then returns the ghost's stub.
So Artist → similar Artist, with `getArtistInfo2` answering inside the
transition, fills the ghost and leaves the new page's biography and similar
artists empty.

**Do first:** a RED e2e on the mock that drives that path with a fast
`getArtistInfo2`.
- **If it does not reproduce:** mark `[~]` with the evidence and change
  nothing.
- **If it does:** scope every lookup to the screen's container, then GREEN.

### R8 — Merge PR #5 (test-helper validation)

**Steps**
1. `git fetch origin pull/5/head`.
2. `git merge --no-ff FETCH_HEAD`, with the message
   `Merge pull request #5 from anupamme/fix-repo-sonance3-cwe-20-sonance-png-decode-validation`
   and a body line: "Hardening of test code; the input is our own
   screenshots, so not a vulnerability (ticket-3.12 §2.2)."

**Acceptance**
- Commit `ca4e38e` (author anupamme) is reachable from `main`.
- `e2e/backdrop.spec.ts` and `e2e/np-focus-mode.spec.ts` pass.

### R9 — Merge PR #1 (NixOS shell)

**Steps**
1. `git fetch origin pull/1/head`, then `git merge --no-ff FETCH_HEAD`.
2. **Resolve `README.md`:** keep `main`'s text, and add PR #1's one sentence
   about `shell.nix` where building is described.
3. **`build.sh`:** its new shebang, `#!/usr/bin/env bash`, merges cleanly. It
   matters because NixOS has no `/bin/bash`.
4. **Follow-up commit:** add `perl` to `shell.nix`; `build.sh` calls it
   (~:85, ~:130).

**Acceptance**
- Commit `e08bdac` (author dbeley) is reachable from `main`.
- `bash -n build.sh` passes, and `./build.sh` exits 0.
- Every external command `build.sh` runs is provided by `shell.nix` (the audit
  is pasted).
- Nix is not installed on the build Mac, so the closing reply asks @dbeley to
  confirm `nix-shell` on NixOS.

### R10 — Credit the contributors

1. **Co-author trailer:** every commit that builds a PR #2 feature (R1–R7)
   ends with the trailer
   `Co-authored-by: David BELEY <6568955+dbeley@users.noreply.github.com>`,
   in the trailer block after a blank line.
2. **README:** `README.md` gains a **Contributors** section before
   Acknowledgements, with each PR linked.
   - David BELEY (@dbeley): the NixOS dev shell (#1). Opus playback, random
     album sort, Artists sort, Home row size, Popular songs, playback error
     messages and the Artist page fix, first built in #2.
   - Anupam Mediratta (@anupamme): input validation in the test helpers (#5).
3. **Changelog:** a new `CHANGELOG-3.12.md`, following `CHANGELOG-3.9 to
   3.11.md`, credits both.
4. **Drafts for the user to post,** in `docs/v3-12-report.md` and the closing
   reply:
   - a thank-you and close for PR #2, linking its commits;
   - an optional note on #1 and #5 (GitHub marks them merged on push);
   - a release-notes paragraph that @mentions both.

**Acceptance**
- `git log --format='%h %an | %(trailers:key=Co-authored-by,valueonly)'` shows
  dbeley on each R1–R7 commit.
- dbeley is the author of `e08bdac`, and anupamme of `ca4e38e`.
- The README and the changelog are read back.

### R11 — Version 3.12 and packages

- About reads `V3.12`.
- Cache-bust `v3-12`: `build.sh` `CACHE_BUST`, the `index.html` stylesheet
  link (by hand), and `tests/mock-index.html`.
- `config.xml`: `version="3.12.0"` (as D164).
- `Sonance3.wgt` and `Sonance3-Oblong.wgt` are rebuilt, unzipped and checked,
  and `index.html` is left bundled.

## 7. Verification approach

- RED then GREEN for every new behaviour (R1–R7). Keyboard only, 1920×1080,
  DPR 1.
- The whole suite at 150 % and 100 %; at 200 %, the focus-path specs and the
  new ones. Each exits 0.
- The focus-clip sweep (`tests/tools/focus-clip-sweep.js`) is 0 at 5 sizes,
  with the new states added.
- **100 % visual:** capture a baseline from the 3.11 build at session start.
  Afterwards only the intended surfaces may differ, and Home at the default
  must not.
- **Live** (the bundled build through the LAN proxy, read-only): it boots with
  0 page errors and 0 responses ≥ 400, plus the R1 and R5 probes.
- **TV checklist** in `docs/v3-12-report.md`:
  - Opus: play, seek, gapless, resume;
  - Random albums and the Artists sort;
  - Home rows of 9 and 12 at 150 % and 200 %;
  - Popular songs;
  - the error toast, with a file the TV can't play if the library has one;
  - the Artist → similar Artist path.

## 8. Open questions — to verify, not to guess

1. Does the Q90R play Ogg Opus natively through AVPlay? If it does, the
   transcode could be dropped for this TV (§2.4). This is a TV test, not a
   browser one.
2. MP3 at 320 kbit/s or the server's default (192): quality against server
   CPU. 320 is planned; measure the time to first audio on live if an Opus
   track exists.
3. Does the live test account have any `.opus` files, and does the live
   Navidrome return top songs (Last.fm configured)? Unknown at planning.
4. Should the packages and bundles leave git (PR #2's remark)? This is the
   user's decision; D165 stands until then.
5. Why did CI run 37656368168 fail? The user supplies the log; this is
   separate from 3.12.

## 9. Amendments

Sessions append here, newest last: each change, its D-number, and how
acceptance was read. Never edit the text above silently.

### v3.12 session (2026-10-09)

- **D167 — The ticket and prompt committed at T0.** They were untracked;
  committed (53f5ca0) so this section's amendments are tracked. T0
  "before": the whole suite at 150 %, 231 passed (15.7 m), exit 0; the
  100 % visual baseline (19 states) and Home's five `getAlbumList2` URLs
  (all `size=6`) were captured from the 3.11 code.
- **D168 — PR #5's head moved after planning (R8).** Its head is now
  7333063 ("Address review feedback"), which rebuilds `Sonance3.wgt` and
  `Sonance3-Oblong.wgt`. Unzipped, both hold byte-identical files to
  ca4e38e's (only zip timestamps differ), so the whole head is merged (merge
  7c05958) and GitHub marks the PR merged on push; T11 rebuilds both
  packages anyway. Acceptance: ca4e38e is reachable; `backdrop` and
  `np-focus-mode` 16 passed.
- **D169 — shell.nix lists perl and gzip (R9).** PR #1 merged (f3429ee;
  README: main's text in the two whitespace-only conflicts, PR #1's
  sentence in the build section). The audit of what `build.sh` runs:
  coreutils (basename cp cut dirname du head mkdir mktemp rm wc), gnugrep,
  gawk, gzip, perl, zip, unzip, nodejs (npx: terser, clean-css-cli), bash
  (mkShell). `perl` was missing; `gzip` comes with mkShell's stdenv and is
  listed so `shell.nix` alone shows the set. `bash -n build.sh` exit 0, and
  a build exit 0 (bundles byte-identical, packages identical when
  unzipped). Nix is not installed here: @dbeley is asked to confirm.
- **D170 — R7 reproduced; Artist lookups scoped to their page.** RED
  (`e2e/artist-scope.spec.ts`, mock opt-in `mockArtistInfo=1`): after
  Artist → similar Artist the live page had no discography, biography or
  similar artists (all written into the outgoing ghost); and an answer for
  a left Artist page (held 1.5 s) overwrote the next Artist page's
  biography and similar artists. Fix: every lookup goes through the page
  the activation rendered into, answers for a replaced page are dropped
  (D88's rule), and the zone selectors are prefixed `#page-current ` because
  FocusManager caches a zone's `querySelectorAll` when it registers (a zone
  registered mid-zoom held the ghost's rows first). Two of the 13 listed
  lookups (`#content-area`, :94 and :654) resolve nothing: that element no
  longer exists (css :2895); left as they are. GREEN: 2 passed; the
  artist-related and focus-path specs 101 passed.
- **D171 — The per-track toast (R6).** Wording: `<title> — format not
  supported` or `<title> — couldn't be loaded` (the em dash of the existing
  stop toast). `_onLoadFailure(label, cause)` shows it on every failure,
  before the stop toast, so after three in a row the stop toast is the one
  left on screen. AVPlay causes, checked against Samsung's AVPlay API
  reference (2026-10-09): `onerror` passes an AVPlayError
  (`PLAYER_ERROR_NOT_SUPPORTED_FILE`, `PLAYER_ERROR_NOT_SUPPORTED_FORMAT`
  are "format"); `prepareAsync`'s error callback passes a WebAPIException
  type (`NotSupportedError` is "format"); anything else is "load". The
  AVPlay stub gains `prepareErrors` (the values a failing prepare passes).
- **D172 — HTML5 cause: code 4 is not enough (R6 refined).** Probed in
  Playwright's Chromium: an undecodable body, an HTTP 404, an HTTP 500, an
  aborted and a refused request all give MediaError code 4; the message is
  `PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN…` for the first and
  `MEDIA_ELEMENT_ERROR: Format error` for the rest. So "format" is code 4
  whose message is not `MEDIA_ELEMENT_ERROR`; this is the browser fallback
  only (the TV uses AVPlay). Acceptance: `e2e/track-error-toast.spec.ts`
  RED (no per-track toast on 3.11) then 4 passed; the toast and AVPlay specs
  27 passed.
- **D173 — One stream-URL decision (R1).** `SubsonicAPI.getStreamUrl(id,
  opts)` appends `format`, `maxBitRate`, `timeOffset` after `id` when given
  and is 3.11's byte for byte without them; `Player._streamUrlFor(api,
  track, offset)` decides (the list `TRANSCODE_TYPES = ['opus']`, matched on
  the suffix in any case or the contentType) and serves the load path, both
  prepare-next paths and the seek reload. `timeOffset` is left out at 0.
- **D174 — A transcode's duration is its metadata (R1.4 refined).** The
  ticket said "from its metadata when the engine reports none". For a
  transcode the engine's figure is only what is left after the offset (or
  Infinity while it is made), so metadata comes first and the engine
  (+ offset) only when the track has no duration. Other tracks keep 3.11's
  rule exactly.
- **D175 — Seek reloads wait for the presses to stop (R1.3).** Playing,
  a seek in a transcode shows the target at once and reloads 400 ms after
  the last press (each reload is a new ffmpeg on the server; Right ×9 on the
  progress bar is one reload, at 90 s). Paused, the reload waits for Play.
  The old stream's position is ignored meanwhile, so neither the display nor
  prepare-next sees it. The A8 cue is not used for this and is never ended
  by a reload.
- **D176 — A seek's reload is not a new track.** No `trackchange`, the
  scrobble state kept, and its failure (toasted like any other) does not
  count toward `_consecutiveLoadFailures`.
- **R1 acceptance read.** The mock first: songs 4, 9, 14, 19 are `.opus`
  (`audio/ogg`); `tests/dev-server.js` answers `format=mp3` with silent MP3
  frames, chunked, `Accept-Ranges: none`, a Range header ignored, and
  `timeOffset` echoed. `e2e/opus.spec.ts`: 7 RED on 3.11, 7 GREEN (HTML5:
  the URLs, the preload, Right ×9 → one request at `timeOffset=90`, 1:30
  then advancing, resume at 42; AVPlay stub: open, reopen at the offset,
  position, metadata duration, gapless next, resume, paused seek).
  Playback-adjacent specs 112 passed. **Live (read-only):** 30,458 songs —
  flac 29,760, m4a 431, mp3 267, **no opus**, so the Opus transcode itself is
  for the TV. One FLAC asked for as MP3 320 (64 KB each): `audio/mpeg`, no
  Content-Length, `Accept-Ranges: none`, a Range request answered 200 with
  no Content-Range, and `timeOffset=30` accepted — the mock's model. First
  byte after 9.7 s on the first request (0.37 s with the offset), which
  bears on §8 question 2.
- **D177 — Random albums: one sample, kept until chosen again (R2).** The
  Sort chip's cycle ends Most played → Random → Name. Random calls
  `SubsonicAPI.getRandomAlbumSample(500, libraries)`: one `getAlbumList2
  type=random&size=500` per library in scope (one unscoped request for all),
  through `_request`, not the response cache (otherwise "choosing it again"
  would replay the cached roll); 2+ libraries are merged, deduped,
  shuffled and cut to 500, a single source is the server's order as sent.
  The sample is not a paged list, so it does not go through the D23
  `AlbumListCursor`, and no offset-search count runs for it. The library
  screen keeps `{ scope, albums }` and shows it whenever the sort is
  Random: leaving Library, Back from an album and clearing a genre filter
  reuse it; cycling onto Random again (from Name, round the cycle) drops it
  and rolls a new one. Count line wording: **"Random sample of N albums"**. A genre
  filter still means `byGenre`. The A2 spec's wrap assertion now expects
  Random before Name. Acceptance: `e2e/albums-random.spec.ts` RED (the
  cycle never reached Random), then 2 passed: exactly one
  `type=random&size=500` and no offset, the grid equal to the mock's
  sample, Back to the same album and index, the same sample after leaving,
  a new request when Random is chosen again, and with two of three
  libraries one request each (folders 1, 2), 500 ids, no duplicates, both
  libraries present. Grid, focus-path and Home specs 49 passed.
- **D179 — The Artists header and sort (R3).** The A2 header on the
  Artists tab: "Artists", "N artists", one chip "⇅ Sort: Name" cycling Name
  (the server's order) → Most albums (album count descending, ties in the
  server's order) → Random (a rank per artist id, drawn once; cycling onto
  Random again draws new ranks; an artist not yet ranked gets one, so a
  refreshed list keeps the others' order). Sorted client-side from
  `getArtists` (it returns every artist; the localStorage projection keeps
  `albumCount`). Both render paths sort the same list; a sort rebuilds the
  grid under the header, which keeps the focus on the chip. The grid's Up
  goes to the header (both paths; `_registerGridZone` takes the zone above,
  the top nav when none, so Genres is unchanged). Mock opt-in
  `mockArtistAlbumCounts=1` gives counts 1–9 (the default is 3 for every
  artist, as every capture shows). Acceptance: `e2e/artists-sort.spec.ts`
  RED (no header), then 3 passed: chunked (40) and virtual (120), each order
  against the fixtures, Up/Down/Left/Up paths, Random re-rolled, Back to the
  same artist and index under Random, the order kept after leaving Library.
  Focus-path, NP-bar, grid, focus-style, scale, smooth-scroll and
  transition specs 88 passed.
- **D178 — Albums per Home row (R4).** `SonanceSettings.homeRowSize` (6, 9
  or 12) is read from `localStorage['sonance-home-row-size']` at load, like
  the other settings; Standard removes the key. The Settings row sits
  directly after Background (before "Up next on Now Playing"); with three
  values, Right and Enter step forward and wrap, Left steps back and wraps
  (the ticket's "cycle it, as on the Background row"). Home reads the size
  when it renders: the five album rows' requests, the two skeleton rows,
  and the extra rows (`EXTRA_ROW_SIZE` removed). App's Home prefetch
  (`getAlbumList2 newest`) follows it too: V3.9 made it Home's exact request
  so the response cache serves Home, and at 9 it was a stray `size=6`
  request (found by the R4 test). Your Playlists is unchanged. Acceptance:
  `e2e/home-row-size.spec.ts` — the default guard passes on 3.11 and after
  (the five URLs equal T0's, 6 skeletons); RED for the row, 9 and 12, then
  4 passed: the row's cycle, storage and reload; rows of 9 and their
  skeletons; rows of 12, Right to the 12th with the row scrolled and the
  focus unclipped at 150 %. Home, focus-path, NP-bar, prefetch, focus-style,
  scale, backdrop, Up Next, overlay, smooth-scroll and smoke specs 94 passed.
- **D180 — Popular songs (R5).** `SubsonicAPI.getTopSongs(name, count)`:
  `getTopSongs.view?artist=<name>&count=10`, a cached read with the usual
  10 s timeout (a failure is not cached). Asked once `getArtist` has given
  the name; rendered into a stub between the discography and the
  biography (so the order holds whichever answer lands first), only when
  it returns a song, and only on the page that asked (D170). Rows are
  `.track-row`s: number, title, the album under it (`.track-row-album`,
  which joins the artist line's two CSS rules; no new values), star,
  duration. Zone `artist-popular`: albums → Popular → similar artists → the
  NP bar (the bar's Up goes to the last present), Left to the left panel,
  Enter plays the ten from the row (`saveCurrentFocus` first), hold OK opens
  the options sheet (its Favourite repaints the row's star). The R7 spec's
  walk to the similar artists now passes Popular (its press cap raised to
  20) and checks Popular lands on the live page. Acceptance:
  `e2e/artist-popular.spec.ts` RED (no section), then 3 passed (the
  empty/error case is a guard, passing on 3.11 too): the request, the
  section order, ten rows, the down-walk through rows 0–9 in order, Up from
  the similar artists to row 9, Left to the panel, Enter queues the ten from
  row 4, hold OK opens the sheet on "Track 05" without playing, Back returns
  to row 5. Artist-adjacent and focus-path specs 103 passed plus the R7
  fix-up. **Live (read-only, count 10):** Deadmau5 10 (764 ms), Various
  Artists 0, Ludwig Van Beethoven 0, "00.db" 0 — the server's Last.fm agent
  answers for some artists.
- **R10 — Credits.** README: a "Contributors" section before
  Acknowledgements (both people, each PR linked), the 3.12 line in the
  introduction, and the 3.12 features in Features and Settings.
  `CHANGELOG-3.12.md` (the 3.9–3.11 changelog's New / Improved / Fixed
  shape, plus "For developers") credits both. `docs/v3-12-report.md` §6
  holds the drafts: PR #2's thank-you and close (its three commits linked),
  optional notes for #1 (asking @dbeley to confirm `nix-shell` on NixOS)
  and #5, and a release-notes paragraph @mentioning both. Nothing posted.
- **R11 — Version 3.12.** About `V3.12`; cache-bust `v3-12` in `build.sh`,
  the `index.html` stylesheet link (by hand) and `tests/mock-index.html`
  (22 tags; no new script this session); `config.xml` `version="3.12.0"`
  (its only change). `./build.sh` exit 0 (core 85,316 B, screens 157,343 B,
  CSS 126,170 → 70,135 B); both packages hold the same 7 files, config,
  index and bundles equal to the working tree's, icons 256×256 and
  1920×1080; no `?.`/`??`; the live server's address is in neither (the
  login placeholder's "e.g. 192.168.0.1" is, as in 3.11). `index.html` is
  left bundled.

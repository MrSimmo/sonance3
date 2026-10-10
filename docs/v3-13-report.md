# Sonance v3.13 — report

**Version 3.13** (`config.xml` 3.13.0, Settings → About **V3.13**) adds Jellyfin 12.2 as a second
backend, from `tickets/prompt-3.xx-jellyfin.md` / `tickets/ticket-3.xx-jellyfin.md` (requirements
R1–R13; decisions D184–D203 in the ticket's §9). Built 2026-10-10 in one session. Navidrome sessions
send exactly the requests 3.12 sends (the identity guard), and the UI is unchanged apart from the
two changes you approved.

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row
tile); they are the same app and replace each other.

## 1. What changed

- **`js/jellyfin-api.js` (new).** `JellyfinAPI` inherits `SubsonicAPI` and replaces its transport:
  every Subsonic call the app makes is translated to Jellyfin 12.x requests and answered in the
  Subsonic shape, so the screens, both caches, the album cursor and the song pager serve both
  servers. Auth is Jellyfin's `Authorization: MediaBrowser …` header; stream URLs carry `ApiKey`,
  image URLs nothing.
- **`js/auth.js`.** Builds a `JellyfinAPI` for a Jellyfin session (`sonance_backend` = `jellyfin`)
  and a `SubsonicAPI` exactly as before otherwise. Login detects the server (Subsonic first; on a
  not-Subsonic failure a `/System/Info/Public` probe; an empty password probes first). A revoked
  token signs in again silently at boot. Logout revokes the token.
- **`js/screens/login.js`.** An empty password is no longer refused before any request: the probe
  decides, and a non-Jellyfin server still shows "Please enter a password".
- **`js/screens/settings.js`, `js/screens/playlists.js`.** The two sanctioned changes (R11): "API
  Version: Jellyfin 12.2.0" and "No playlists found. Create playlists in your Jellyfin server." on a
  Jellyfin session. Navidrome's strings are byte-identical.
- **`js/api.js`.** One additive hook (8 lines, 0 removed against v3.12): `SubsonicAPI._trackRequest`,
  so `abortAll()` cancels the adapter's requests.
- **Test rig.** The mock answers as Jellyfin (`?mockBackend=jellyfin`) from the same fixtures; the
  dev server serves Jellyfin's image and stream routes; 91 new tests in 7 spec files (349 in all).
- **Build.** `js/jellyfin-api.js` in `CORE_FILES` after `js/api.js` and in the `--dev` block (22
  scripts); both packages rebuilt; cache-bust `v3-13`.

## 2. Capability matrix (as built)

| Capability | Navidrome (unchanged) | Jellyfin 12.2 in 3.13 | Status |
|---|---|---|---|
| Login screen | Subsonic token | `AuthenticateByName` → token, detected automatically | Same UI; an empty password is accepted (Jellyfin only) |
| Stay logged in | credentials stored | token and credentials stored; a revoked token signs in again silently (seen live) | Same |
| Libraries in Settings | `getMusicFolders` | music views, hidden ones included | Same |
| Library counts (Albums, Artists, Songs) | offset search | `TotalRecordCount`, one request (D197) | Same numbers (live: 2,757 / 973 / 29,303 equal Node-side) |
| Home: Latest addition, Recently added, Rediscover | album lists | `DateCreated`, `Random` | Same |
| Recently played, Most played | album play data | from track play data (P7) | Same result; empty on the test profile (no history) |
| Your favourites, Albums "starred" order | newest starred first | no favourited date: A–Z (P9) | **Differs: order** (and which ones a capped Home row shows) |
| Albums: sorts, genre filter, count, paging | album lists | `/Items` sorts and filters | Same |
| Artists, Songs, Genres tabs | `getArtists`, `search3`, `getGenres` | `/Artists/AlbumArtists`, `/Items`, `/Genres` per library | Same (server data differs, see §7) |
| Album and artist pages, discography | `getAlbum`, `getArtist` (by year) | `/Items` (by year, D191) | Same |
| A track-only artist's page | 0 albums | the albums they appear on (D190) | **Differs** (changed since planning: decided) |
| Artist photo | Navidrome's artist image | Jellyfin's Primary image where it has one; none requested otherwise (D201) | Same look |
| Biography | Last.fm via Navidrome | Jellyfin `Overview` (empty on the test server) | **Data gap**: the section hides when empty |
| Similar artists | Last.fm via Navidrome | Jellyfin's own similarity | **Differs: source** |
| Popular (artist page) | Last.fm top tracks | this user's most-played tracks by the artist | **Differs: meaning**; hidden with no plays |
| Start radio | `getSimilarSongs2` | Instant Mix (local, fast) | **Differs: source** |
| Search | `search3` (every artist; albums also by other fields) | names only; artists are album artists | **Differs: what matches** (found live; "love": Navidrome 58/112/500 artists/albums/songs, Jellyfin 3/31/1,136) |
| Favourites (star, unstar, tile) | `star`, `getStarred2` | `UserFavoriteItems`, `IsFavorite` | Same |
| Playback and seek | `stream.view`, byte ranges | `/Audio/{id}/stream?static=true`, byte ranges (206 live) | Same |
| Opus transcode, seek by reload | `format=mp3`, `timeOffset` | `stream.mp3`, `startTimeTicks` (200 `audio/mpeg`, no ranges, live) | Same (no Opus on the test server: mock only) |
| Play counts (scrobble) | `scrobble.view` | `POST /UserPlayedItems/{id}?datePlayed` (increments, D185) | Same in Sonance |
| Lyrics, synced and unsynced | OpenSubsonic | `/Audio/{id}/Lyrics` (live: synced, 60 lines) | Same |
| Credits panel | contributors and details | composer etc. from `People`, file details from `MediaStreams` | **Partial**: no performer instruments, BPM or original year |
| Playlist covers | Navidrome's collage | Jellyfin's image where it has one (7 of 41 live), else the gradient | Same mechanism; fewer covers |
| Playlist card duration | shown | not in Jellyfin's playlist list (D198) | **Data gap** (found after planning); the playlist page has it |
| Resume last queue | saved on the server, shared | saved on the TV | **Differs: not shared across devices** |
| Settings → API Version | `Subsonic 1.16.1` | `Jellyfin 12.2.0` | Sanctioned change |
| Empty Playlists message | names Navidrome | names Jellyfin | Sanctioned change |
| Login timeout message | names Navidrome | unchanged: the server type is not known yet | **Known wording gap** |
| Logout | clears the session | also revokes the token (401 afterwards, live) | Same UI |
| Quick Connect, SSO, LDAP, user picker, Jellyfin < 12 | — | not supported / later / untested | Out of scope |

## 3. Verification (summary)

See §8 for the commands and the pasted output.

- **Navidrome is 3.12:** the identity guard (54 requests, 47 media URLs, 0 other; three identical
  recordings on 3.12) passes on 3.12's code and on 3.13; 3.12's 258 tests pass with no spec edited;
  `git diff v3.12 -- js/api.js` is 8 additions, 0 deletions.
- **Jellyfin parity:** the parity spec compares the two mocks on 18 screen states plus the credits:
  equal text, equal Down-walk focus paths, 0 differing pixels except the API Version row and the
  playlist cards' count line (D198).
- **RED then GREEN** for every requirement (§8), on a copy of the v3.12 tree.
- **Live, read-only** (§7): the bundled build signs in to the Jellyfin test server with the
  password empty and walks every screen with 0 page errors.

## 4. TV checklist

In order. Each says what a failure looks like. The browser cannot show AVPlay, the remote, the
TV's network stack or its compositor.

1. **Install and check the version.** Settings → About reads **V3.13**. *Failure:* V3.12 — the old
   package is still installed.
2. **Navidrome first (regression).** Your Navidrome login still works as before: Home, play and
   seek a track, a favourite, resume after a relaunch, logout and log in. *Failure:* anything that
   differs from 3.12. A Navidrome session never contacts `/System/Info/Public`.
3. **Sign in to Jellyfin with no password, on the TV keyboard.** Log out; type the Jellyfin
   server's address and port and the profile's name; leave the password empty; Connect.
   *Expect:* "Connecting..." and then Home. *Failure:* "Please enter a password" means the probe
   found no Jellyfin at that address (wrong address or port, or the TV could not reach it);
   "Wrong username or password." means the server refused the name.
4. **CORS from the packaged app.** If item 3 shows "Cannot reach server" although the address
   works in a browser, Jellyfin refused the app's preflight (the sign-in carries an
   `Authorization` header). *Failure meaning:* the TV's origin is not allowed by Jellyfin's CORS
   hosts; a fix round can move reads to `ApiKey` URLs, which need no preflight (§8 Q4).
5. **Covers.** Home and Albums show album art (Jellyfin serves JPEG, `format=Jpg`). *Failure:*
   placeholders everywhere — the TV cannot fetch or decode Jellyfin's images.
6. **AVPlay plays Jellyfin streams, and seeks.** Play a FLAC track, then an ALAC (`.m4a`) one and an
   MP3; on Now Playing, Up to the progress bar, Right a few times. *Expect:* each plays and jumps
   to the new position. *Failure:* "<title> — couldn't be loaded" (AVPlay refused the stream URL
   with its `ApiKey`) or "— format not supported".
7. **Lyrics.** Play a track with lyrics in Jellyfin; open the lyrics panel. *Expect:* the lines,
   highlighted in time. *Failure:* "No lyrics" for a track Jellyfin shows lyrics for.
8. **A favourite and a play count, on a profile of your choice.** Hold OK on a track → Favourite;
   play a track past its half. *Expect:* Jellyfin's web page shows the favourite and the track as
   played (its play count up by one). *Failure:* no change there.
9. **Resume after relaunch.** Play, pause a minute in, leave Sonance and start it again. *Expect:*
   the queue in the NP bar, paused at that point. *Failure:* an empty NP bar. (It is kept on this
   TV only.)
10. **Start radio.** Hold OK on a track → Start radio. *Expect:* a queue from Jellyfin's Instant
    Mix, at once. *Failure:* no "Start radio" item (fewer than 5 songs came back).
11. **Settings.** Server → API Version reads "Jellyfin 12.2.0"; Libraries lists the music
    libraries (shown only with two or more).
12. **Logout revokes the device's token.** Log out; in Jellyfin's Dashboard → Devices / Activity,
    the Sonance device's session ends. *Failure:* the device still shows an active session.
13. **Large-library counts.** Library → Songs: the count appears within about a second
    (one request, D197). *Failure:* a blank count line for several seconds.
14. **Opus (needs an Opus file in a Jellyfin library).** It plays through Jellyfin's transcoder and
    seeks by reloading. *Failure:* as 3.12's Opus items.

## 5. Open questions (ticket §8), answered

1. **Q1** — yes: `MarkPlayedItem` with `datePlayed` increments `PlayCount` on 12.2 (D185).
2. **Q2** — an Opus file in Ogg reports `Container: "ogg"`; the codec is only in `MediaStreams`,
   which song requests now ask for (127.6 → 259.8 KB per 100 songs) (D187).
3. **Q3** — JPEG on the TV: TV item 5.
4. **Q4** — AVPlay with `ApiKey` and CORS from the app's origin: TV items 4 and 6.
5. **Q5** — no: an unscoped `/Genres` lists 4 genres against 692 per library; one request per music
   library (D188).
6. **Q6** — Navidrome's empty-query `search3` is in creation order; Jellyfin `DateCreated,SortName`,
   stable across pages (D189).
7. **Q7** — Navidrome shows 0 albums for a track-only artist; Sonance on Jellyfin lists the albums
   they appear on (D190).
8. **Q8** — a name → id memo from the artist page's `getArtist`, else an exact-name search, never
   `/Artists/{name}` (D194).

## 6. Decisions

D184–D203, each with its reason and how its acceptance was read: `tickets/ticket-3.xx-jellyfin.md`
§9.

## 7. Live checks (read-only)

Jellyfin test server, through the bundled build and a LAN proxy (the test server's address and
profile are not recorded here):

- **Sign-in through the login form, password empty:** `GET /System/Info/Public` 200,
  `POST /Users/AuthenticateByName` 200, Home. Backend `jellyfin`, version 12.2.0.
- **Counts, UI against Node-side `TotalRecordCount`:** albums 2,757 = 2,757; album artists
  973 = 973; songs 29,303 = 29,303; genres 692 = 692 cards; a genre filter 1 = 1.
- **Albums sorts:** Artist, Recently added, Year, Name 2,757 each; Most played 0 (no history);
  Random "Random sample of 500 albums".
- **Pages:** album → hold OK → credits (28 lines); artist page (Discography, Similar artists);
  genre detail; search "TR"; Playlists (41 cards; a 14-song playlist opens with 14 rows); Settings
  "Jellyfin 12.2.0"; lyrics for a track with lyrics: synced, 60 lines.
- **Errors:** 0 page errors; 182 requests, one ≥ 400: the expected 401 when a Node-side sign-in from
  the same device id had revoked the page's token, followed by the silent re-sign-in (R3, live).
- **Writes:** `POST /Users/AuthenticateByName` (twice: the sign-in and the silent re-sign-in) and
  `POST /Sessions/Logout`; nothing else. After the app's logout the token answers 401.
- **R6, Node-side:** a FLAC stream with `Range: bytes=0-1023` → 206 `audio/flac`, 1,024 bytes; a
  transcode → 200 `audio/mpeg`, `Accept-Ranges: none`, aborted after its first chunk; a cover with
  its tag and no token → 200 `image/jpeg`, `Cache-Control: public, max-age=31536000, immutable`.
- **Navidrome regression** (bundled build, seeded session, no playback): Home, Library (2,996
  albums, 1,100 artists, 30,458 songs), an album, an artist, Search, Playlists: 0 page errors, no
  response ≥ 400, only GETs, no non-Subsonic request.
- **The same music on both servers.** The libraries are close, not identical (albums 2,996 vs 2,757;
  artists 1,100 vs 973; songs 30,458 vs 29,303). "love": Navidrome 58 artists / 112 albums / 500
  songs (its cap) against Jellyfin 3 / 31 / 1,136. Checked on Navidrome's answer: all 58 artists
  have "love" in their name (it searches every artist; Sonance on Jellyfin searches album
  artists); 74 of its 112 albums have it in neither the album's nor the artist's name (it matches
  other fields too); 498 of its 500 songs by title. Jellyfin matches the item's name. Album counts:
  Various Artists 688 vs 381, Deadmau5 114 vs 122, Gorgon City 42 vs 32, Ludwig Van Beethoven 99 vs
  1: the two servers attribute albums to album artists differently, beyond the libraries' size
  difference (not investigated further; not an adapter matter).

## 8. Verification (T11, 2026-10-10)

RED runs used a `git archive v3.12` copy of the tree with the current test rig overlaid, on its own
dev server, so "RED" is the unchanged release. Guards pass on both.

```
T0 before (3.12), 150 %          258 passed (17.0m)  exit=0
identity recordings on 3.12      3 runs byte-identical: 54 API calls, 47 media URLs, 0 other
RED -> GREEN                     R4 7 failed -> 7 passed
                                 R5/R8/R10 32 failed -> 32 passed (incl. D197's count test)
                                 R6/R7 API 7 failed -> 7 passed; in the app 5 failed -> 5 passed
                                 R1-R3 8 failed + 4 Navidrome guards -> 12 passed
                                 R9 6 failed -> 6 passed
                                 R11 2 failed + 2 guards -> 4 passed
                                 R12.4 parity 21 failed + 2 guards -> 23 passed
                                 R12.5 smoke 3 failed -> 3 passed; R12.6 1 failed -> 1 passed
                                 D201 2 failed (previous adapter) -> 2 passed
final, 150 %                     349 passed (21.9m)  exit=0
final, 100 %                     349 passed (21.4m)  exit=0
final, 200 % subset              196 passed (11.6m)  exit=0  (focus-paths, npbar, focus-style,
                                 options-sheet, transitions, bundled-walk, ui-scale, splash and
                                 the 7 new specs)
js/api.js vs v3.12               1 file changed, 8 insertions(+)   (SubsonicAPI._trackRequest)
unchanged vs v3.12               player, app, image-cache, components, options-sheet, starred, CSS
existing specs edited            none (e2e/helpers/sonance.js gained options, additively)
node --check                     9 modified .js files ok
regression greps                 innerHTML: the nowplaying.js comment only; transition: all: the
                                 :90 comment only; backdrop-filter, gap:, setInterval: none;
                                 ?. / ?? in the adapter: none; legacy auth in js/: none
build                            exit 0; 7 files a package; config/index/bundles = tree;
                                 config.xml differs from 3.12's in the version only; CSS
                                 byte-identical; the adapter in sonance-core.min.js; V3.13
```

Visual, 100 % (`tests/tools/visual-baseline.js <dir> --scale 1 --geometry`, 19 states, 0 page
errors and 0 bad responses in each run, geometry ok):

- **Subsonic mock, T0 (3.12) against 3.13:** 17 states 0 px. `settings-top` and `settings-bottom`
  58 px each, box 931,197–938,207: the About line's last digit, "V3.12" → "V3.13" (R13; checked on
  crops of both captures). Nothing else.
- **Jellyfin mock against the Subsonic mock (3.13):** 16 states 0 px. `settings-top` 810 px, box
  740,295–839,308: the API Version row (R11). `playlists-grid` 4,730 px, box 366,491–1544,903: the
  cards' count lines (D198). `login` 85 px (max channel delta 13) in the first capture: the login
  screen's raster variant; two fresh Jellyfin captures and a fresh Subsonic one were 0 px.

Screenshots (mock only, read back): `screenshots/v3-13/jf-home.png`, `jf-album.png`,
`jf-artist.png`, `jf-nowplaying-lyrics.png`, `jf-credits.png`, `jf-settings.png` ("Jellyfin
12.2.0", About V3.13), `jf-login-wrong-password.png` ("Wrong username or password.").

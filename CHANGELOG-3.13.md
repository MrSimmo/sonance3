# Sonance 3.13

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row tile). Settings → About reads **V3.13**.

3.13 adds **Jellyfin** as a second kind of server. Navidrome works exactly as in 3.12.

## New

- **Jellyfin 12.2 servers.** On the login screen, type your Jellyfin server's address and port, your username and password, as for Navidrome. Sonance works out which kind of server it is and signs in. Every screen and feature then works as it does on Navidrome, fed by Jellyfin.
- **Accounts without a password.** On a Jellyfin server, leave the password empty. (A Navidrome account always has one; an empty password there still shows "Please enter a password".)
- **Your Jellyfin music libraries** appear in Settings → Libraries, including any you have hidden from your Jellyfin home screen, and choosing them works as it does with Navidrome's.
- On a Jellyfin server, Settings → Server → API Version reads "Jellyfin" and the server's version, and an empty Playlists screen tells you to create playlists in Jellyfin.

## What is different on Jellyfin

The screens are the same; some of what fills them comes from Jellyfin, which keeps different information from Navidrome:

- **Your favourites** are listed A–Z (Jellyfin does not record when you favourited something). With more favourites than a Home row holds, the row shows the first ones A–Z rather than the most recent.
- **Popular** on an artist's page lists the songs *you* have played most by that artist, and hides until you have played some. On Navidrome it comes from Last.fm.
- **Start radio** and **Similar artists** come from Jellyfin's own Instant Mix and similarity, from your library, instantly.
- **Biography** shows Jellyfin's artist overview, which is often empty; the section hides when it is, as before.
- **Song credits** are fuller on Navidrome: Jellyfin has the writing and production roles (composer, producer, mixer …) and the file details, but no performers' instruments, no BPM and no original release year.
- **Playlist cards** show the number of songs but not the total time (Jellyfin's playlist list does not include it); the playlist itself has it.
- **Search** matches names: an artist search finds album artists, an album search album titles, a song search song titles. Navidrome searches every artist and matches albums by other fields too, so the same words can find different results.
- **Resume last queue** is saved on the TV, for that server and user, rather than on the server, so it does not follow you to another device.
- **An artist reached from a song or a similar-artist link** who has no albums of their own shows the albums they appear on (Navidrome shows none).
- **Logout** also signs this TV out on the Jellyfin server.

Not supported: Quick Connect, single sign-on or LDAP plugins, a user picker, Jellyfin before 12.x, and Jellyfin's video, audiobook or other non-music libraries.

## For developers

- `js/jellyfin-api.js` is a translation adapter: it inherits `SubsonicAPI` and turns each Subsonic call the app makes into Jellyfin requests, answering in the Subsonic shape, so the screens, both caches, the album cursor and the song pager are shared by both servers. `js/api.js` gained one additive hook.
- The mock server answers as a Jellyfin server too (`?mockBackend=jellyfin`), from the same fixtures, and the suite compares the two screen by screen (`e2e/jellyfin-parity.spec.ts`), checks every Navidrome request against 3.12's (`e2e/navidrome-identity.spec.ts`), and covers login, playback, the queue and every translated call.

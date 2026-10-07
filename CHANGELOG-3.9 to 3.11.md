# Sonance 3.9 → 3.11

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row tile). Settings → About reads **V3.11**.

## New

- **Interface size** 100–200 % (default 150 %), readable from the sofa
- **Solid focus highlight** in your accent colour; cards grow with a ring
- **Now Playing:** Up Next strip, song credits, sleep timer, Focus mode (dims the screen)
- **Hold OK on a song** for options: play next, add to queue, favourite, go to album/artist, start radio, credits
- **Resume last queue** after a restart, paused
- **Complete Songs list** with Shuffle all
- **Albums sort and filter** (name, artist, recently added, year, most played; by genre)
- **Playlist cover art** and new Home rows: Your Favourites, Most Played, Rediscover
- **Wide home-row icon** package (`Sonance3-Oblong.wgt`)
- **Launch splash** and an optional **gradient background**
- **Settings:** Interface size, Background, Up next on Now Playing, Resume last queue, Performance overlay, Smooth scrolling (experimental)

## Improved

- Zoom transitions into and out of albums; Now Playing rises from the bottom bar with a fade
- Sliding along the top menu loads only the screen you stop on
- Big libraries stay fast: grids and long lists draw only what is on screen
- Artist shown on every track row
- Stronger Now Playing backdrop blur
- Faster cover art on start-up, lower memory use on the TV
- Credits scroll with Up/Down instead of highlighting rows
- Smoother splash exit

## Fixed

- Key presses no longer dropped during transitions
- Now Playing controls always land on Play/Pause, never on a hidden button
- The bottom bar is reachable from every screen, and OK opens Now Playing
- Back returns to the item you came from (albums, artist link, Play, Shuffle, Now Playing)
- Album and artist lists scroll to every track
- Albums no longer missing with multiple libraries selected
- Logout and other Settings rows reachable by remote
- Start radio waits for a slow server
- Lyrics icon centred; Now Playing backdrop drawn on the TV

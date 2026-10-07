# S5 — Audio Playback Engine, Now Playing & Queue Screens

## Overview
Build the complete audio playback system using **Tizen AVPlay API** (with HTML5 `<audio>` fallback for browser testing), wire up the Now Playing bar, build the full-screen Now Playing screen and Queue screen. This is where the app becomes a functional music player.

## Prerequisites
- Phase S4 complete (Album Detail and Search working, Play/Shuffle buttons populating queue)
- Read `docs/UI-MOCKUP-REFERENCE.md` — Now Playing screen, Queue screen, Now Playing bar specs
- Read `docs/ARCHITECTURE.md` section 3.5 (Player Engine) — this details the AVPlay lifecycle and browser fallback pattern

## Tasks

### S5.1 — Player Engine (player.js)
Complete implementation of the audio playback engine with **dual backend** (AVPlay for Tizen, HTML5 Audio for browser):

**Platform Detection (top of file):**
```javascript
var IS_TIZEN = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';
```

**PlayerEngine class:**
```
State:
  currentTrack   — current track object (id, title, artist, album, duration, coverArt, albumId)
  queue          — ordered array of track objects
  originalQueue  — preserved order for un-shuffling
  queueIndex     — current position in queue
  isPlaying      — boolean
  currentTime    — seconds elapsed
  duration       — total track duration in seconds
  volume         — 0.0 to 1.0 (default 0.7, persist in localStorage)
  shuffle        — boolean (persist in localStorage)
  repeat         — 'none' | 'all' | 'one' (persist in localStorage)
```

**Public Methods (same API regardless of backend):**
- `playAlbum(tracks, startIndex = 0)` — replaces queue with tracks, starts playing at startIndex
- `playTrack(track)` — inserts track at current position + 1, plays it
- `addToQueue(track)` — appends track to end of queue
- `addToQueueNext(track)` — inserts track after current
- `play()` — resume playback
- `pause()` — pause
- `togglePlayPause()` — toggle
- `next()` — skip to next track (respects repeat mode)
- `previous()` — if currentTime > 3s, restart track; otherwise go to previous
- `seekTo(seconds)` — seek to position
- `seekPercent(percent)` — seek to percentage of duration
- `setVolume(vol)` — set volume 0-1, persist to localStorage
- `toggleShuffle()` — toggle shuffle on/off, re-order queue accordingly
- `toggleRepeat()` — cycle: none → all → one → none
- `getState()` — returns current state snapshot
- `removeFromQueue(index)` — remove track at index from queue

**AVPlay Backend (when IS_TIZEN === true):**
- Internal method `_loadAndPlay(streamUrl)`:
  1. If currently playing: `webapis.avplay.stop()` then `webapis.avplay.close()`
  2. `webapis.avplay.open(streamUrl)`
  3. `webapis.avplay.setDisplayRect(0, 0, 1, 1)` — 1×1px off-screen (audio only, no video surface needed)
  4. `webapis.avplay.setListener(listeners)` — register callbacks
  5. `webapis.avplay.prepareAsync(successCb, errorCb)` — async prepare
  6. In successCb: `webapis.avplay.play()`
- Listener callbacks:
  - `oncurrentplaytime(ms)` → update `currentTime = ms / 1000`, emit `progress` event
  - `onstreamcompleted()` → call `next()` (or repeat logic)
  - `onbufferingstart()` → set buffering state, show indicator
  - `onbufferingcomplete()` → clear buffering state
  - `onerror(error)` → log error with `[Sonance][Player]` prefix, skip to next track
- Seek: `webapis.avplay.seekTo(seconds * 1000)` (AVPlay uses milliseconds)
- Pause: `webapis.avplay.pause()`
- Resume: `webapis.avplay.play()`
- Duration: `webapis.avplay.getDuration()` returns ms — convert to seconds

**HTML5 Audio Backend (when IS_TIZEN === false):**
- Get reference to `#sonance-audio` element
- On `_loadAndPlay`: set `src` to stream URL, call `.play()`
- Listen to audio events:
  - `timeupdate` → update `currentTime`, emit `progress` event
  - `ended` → call `next()` (or repeat logic)
  - `loadedmetadata` → update `duration`
  - `error` → log error, skip to next track
  - `play` / `pause` → update `isPlaying`, emit events

**Scrobble:**
- Track scrobble state per track
- When `currentTime > duration * 0.5` OR `currentTime > 240` (4 minutes): call `SubsonicAPI.scrobble(trackId)`
- Only scrobble once per track play

**Shuffle Implementation:**
- When enabling shuffle: save current queue order to `originalQueue`, shuffle queue (Fisher-Yates), move current track to index 0
- When disabling shuffle: restore `originalQueue`, find current track's position in it

**Event System:**
- Simple event emitter (addEventListener/removeEventListener pattern or custom EventTarget)
- Events: `play`, `pause`, `trackchange`, `progress`, `queuechange`, `volumechange`, `shufflechange`, `repeatchange`
- Now Playing bar and screens subscribe to these events

### S5.2 — Wire Up Now Playing Bar
Replace the placeholder now playing bar from S2 with live data:

- Subscribe to Player events
- On `trackchange`: update album art (48px), track title, artist + album name
- On `progress`: update mini progress line (2px bar at top of bar)
- On `play`/`pause`: update play/pause button icon
- Transport controls:
  - Previous button (click → `player.previous()`)
  - Play/Pause button (42px white circle, click → `player.togglePlayPause()`)
  - Next button (click → `player.next()`)
- Volume indicator: small progress bar (80px)
- Show "No track playing" with disabled controls when queue is empty
- Clicking the bar navigates to full Now Playing screen
- Focus zone: `nowplaying-bar` (horizontal: prev, play, next)

### S5.3 — Now Playing Screen (screens/nowplaying.js)
Build exactly per mockup:

**Full-screen layout (no sidebar in content, sidebar still visible):**
- Background: radial gradient from album colour (use hash-based colour from album ID or title)
- Dark overlays: top and bottom gradients for readability
- Centred content (max-width 600px):
  - Album art (280px, border-radius 16px, box-shadow with album colour glow)
  - Track title (28px, weight 700)
  - Artist — Album title (17px, `--text-secondary`)
  - Progress bar with scrubber:
    - Full-width bar, gradient fill (`--accent` → `#f06a9e`)
    - White circle scrubber (13px) at current position, glow effect
    - Time labels: current time (left) / total duration (right) — 13px, `--text-muted`
    - Focusable: when focused, Left/Right arrows seek ±10 seconds
  - Transport controls (centred, gap 28px):
    - Shuffle icon (toggles, highlighted when active)
    - Previous track
    - Play/Pause (68px white circle, dark icon)
    - Next track
    - Repeat icon (toggles between none/all/one, highlighted when active, shows "1" badge for repeat-one)
  - Volume bar: at bottom, 60% opacity, speaker icon + bar + speaker-with-waves icon

**Focus Map:**
- Zone `np-controls`: shuffle (0), prev (1), play/pause (2), next (3), repeat (4)
- Zone `np-progress`: progress bar (seekable with left/right)
- Transitions: Up from controls → progress; Down from progress → controls

### S5.4 — Queue Screen (screens/queue.js)
Build exactly per mockup:

**Split Layout:**
- Left panel (320px):
  - "Now Playing" heading
  - Card (`--bg-card`, `--border`, border-radius 14px, padding 20px):
    - Album art (280px)
    - Track title (20px bold)
    - Artist name (15px secondary)
    - Progress bar with time labels
  - Clicking the card navigates to full Now Playing screen

- Right panel (flex: 1):
  - "Up Next" heading
  - Numbered track list:
    - Index number (starting from 1)
    - Album art thumbnail (44px)
    - Track title (15px) + artist (13px secondary)
    - Duration (14px, muted)
    - Focused row: show drag handle icon (list icon)
    - Clicking a track jumps to that position in the queue
  - If queue is empty: "Queue is empty" placeholder

**Focus Map:**
- Zone `queue-list` (1 column, all queue items)
- Enter on item: jump to that track and play

### S5.5 — Wire Up Album Detail Play/Shuffle
- Ensure the Play and Shuffle buttons in Album Detail screen actually trigger playback:
  - Play: `player.playAlbum(albumTracks, 0)`
  - Shuffle: `player.playAlbum(albumTracks, 0)` then `player.toggleShuffle()` (or shuffle first)
- Clicking a track in the tracklist: `player.playAlbum(albumTracks, trackIndex)`
- Currently playing track indicator: check if `player.currentTrack.id` matches, show accent colour + equaliser bars

### S5.6 — Media Key Support
- In the key handler (focus.js or app.js), intercept media keys:
  - Play/Pause (10252): `player.togglePlayPause()`
  - Stop (10253): `player.pause()`
  - Rewind (10412): `player.previous()`
  - Fast Forward (10417): `player.next()`
- These work regardless of which screen is active

### S5.7 — Browser Testing
**Note:** Browser testing uses the HTML5 Audio fallback. AVPlay backend is tested on the TV after deployment in S6.
- Play an album from Album Detail: audio plays in browser
- Play/Pause button works (Now Playing bar and full screen)
- Next/Previous track transitions work
- Progress bar updates in real-time
- Seek by clicking progress bar (or arrow keys when focused)
- Volume control works
- Shuffle toggles correctly (visual indicator + queue order changes)
- Repeat modes cycle correctly
- Scrobble fires at 50% (check Navidrome play counts)
- Queue screen shows upcoming tracks
- Clicking queue item jumps to that track
- Now Playing bar updates across all screens
- Track auto-advances when current track ends
- Error handling: skip to next track if stream URL fails

## Acceptance Criteria
- [ ] Audio plays through browser from Navidrome stream URLs (HTML5 Audio fallback)
- [ ] Player engine has dual backend: IS_TIZEN detection, AVPlay code path, HTML5 Audio code path
- [ ] AVPlay lifecycle implemented: open → setDisplayRect → prepareAsync → play → stop → close
- [ ] Play/Pause/Next/Previous all function correctly
- [ ] Now Playing bar shows current track info and updates in real-time
- [ ] Now Playing screen matches mockup with progress, controls, background gradient (NOT blur — no backdrop-filter)
- [ ] Queue screen shows upcoming tracks, clicking jumps to track
- [ ] Shuffle mode works (toggles, re-orders queue, visual indicator)
- [ ] Repeat modes work (none/all/one, visual indicators)
- [ ] Seek works via progress bar interaction
- [ ] Volume control works and persists
- [ ] Scrobble fires at 50% playback
- [ ] Track auto-advances at end
- [ ] Media keys (Play/Pause) work from any screen
- [ ] Album Detail Play/Shuffle buttons trigger actual playback
- [ ] Currently playing track highlighted in Album Detail tracklist

## Update PROGRESS.md

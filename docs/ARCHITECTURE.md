# Sonance — Architecture Document

## 1. Overview

Sonance is a music player application for Samsung Tizen Smart TVs that connects to a self-hosted Navidrome music server via the Subsonic REST API. It is designed specifically for TV remote (d-pad) navigation and optimised for the Samsung Q90R (Tizen 5.0, 1920×1080).

### Key Constraints
- **No build tooling.** The app is vanilla HTML/CSS/JS — no React, no Webpack, no npm runtime dependencies. This keeps packaging trivial (zip → rename to .wgt) and ensures compatibility with Tizen 5.0's Chromium ~v63 WebView.
- **D-pad only input.** All interaction is via Samsung TV remote: directional arrows, Enter, Back, media keys.
- **LAN-only networking.** The TV connects to Navidrome on the local network. No internet dependency at runtime (except optional cover art from external sources if Navidrome proxies them).

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Samsung Q90R TV                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Tizen WebView (Chromium ~v63)              │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │               Sonance Web App                     │  │  │
│  │  │                                                   │  │  │
│  │  │  index.html ──┬── css/styles.css                  │  │  │
│  │  │               ├── js/app.js (Router + Init)       │  │  │
│  │  │               ├── js/api.js (Subsonic Client)     │  │  │
│  │  │               ├── js/auth.js (Session Mgmt)       │  │  │
│  │  │               ├── js/focus.js (D-Pad Nav)         │  │  │
│  │  │               ├── js/player.js (Audio Engine)     │  │  │
│  │  │               ├── js/screens/*.js (UI Screens)    │  │  │
│  │  │               └── js/utils.js (Helpers)           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│                     HTTP (LAN)                                │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │   Navidrome Server │
                   │   (192.168.0.2)    │
                   │                    │
                   │  /rest/* Subsonic  │
                   │  /api/*  Native    │
                   │                    │
                   │  Music Library     │
                   │  (FLAC/MP3/etc)    │
                   └────────────────────┘
```

## 3. Application Layer Architecture

### 3.1 Router (app.js)
Simple hash-based or state-based SPA router. Manages which screen is active.

```
Screens:
  login      → LoginScreen      (shown when no session)
  home       → HomeScreen       (default after login)
  library    → LibraryScreen    (albums/artists/songs/genres tabs)
  album      → AlbumScreen      (album detail + tracklist)
  search     → SearchScreen     (on-screen keyboard + results)
  nowplaying → NowPlayingScreen (full-screen player)
  queue      → QueueScreen      (up next list)
  playlists  → PlaylistsScreen  (playlist grid)
  settings   → SettingsScreen   (server info, logout)
```

### 3.2 SubsonicAPI (api.js)
Single class handling all Navidrome communication.

**Authentication:**
- Token auth: `token = MD5(password + salt)`
- Every request includes: `u`, `t`, `s`, `v=1.16.1`, `c=Sonance`, `f=json`
- Salt is a random 12-char hex string, regenerated per request

**Key Endpoints Used:**
| Method | Subsonic Endpoint | Purpose |
|--------|-------------------|---------|
| ping | `ping.view` | Connection/auth validation |
| getArtists | `getArtists.view` | All artists (ID3) |
| getArtist | `getArtist.view` | Artist detail + albums |
| getAlbum | `getAlbum.view` | Album detail + tracks |
| getAlbumList2 | `getAlbumList2.view` | Album lists (recent, frequent, newest, random) |
| search3 | `search3.view` | Full-text search |
| getPlaylists | `getPlaylists.view` | User playlists |
| getPlaylist | `getPlaylist.view` | Playlist detail + tracks |
| getGenres | `getGenres.view` | Genre list |
| getSongsByGenre | `getSongsByGenre.view` | Songs filtered by genre |
| stream | `stream.view` | Audio stream URL |
| getCoverArt | `getCoverArt.view` | Album/artist artwork |
| scrobble | `scrobble.view` | Mark song as played |
| star/unstar | `star.view` / `unstar.view` | Favourites |
| getStarred2 | `getStarred2.view` | Starred items |

**Response Handling:**
- All responses parsed as JSON (`f=json`)
- Check `subsonic-response.status === 'ok'`
- On error, surface `subsonic-response.error.message` to UI
- Network errors caught and shown as connection failure toast

### 3.3 Auth Manager (auth.js)
Manages login/logout and session persistence.

**localStorage Keys:**
```
sonance_server_url    → "http://192.168.0.2:4534"
sonance_username      → "andy"
sonance_password      → "..." (stored for token generation)
sonance_salt          → last used salt
sonance_logged_in     → "true"
```

**Flow:**
1. App starts → check `sonance_logged_in`
2. If true → validate with `ping.view` → if OK, show Home; if fail, show Login with error
3. If false → show Login screen
4. Login: user enters server URL, port, username, password → call `ping.view` → if OK, store to localStorage, navigate to Home
5. Logout: clear all `sonance_*` keys → show Login screen

### 3.4 Focus Manager (focus.js)
Central d-pad navigation system.

**Concepts:**
- **Focus zones:** Named regions of the screen (e.g. `sidebar`, `content`, `nowplaying-bar`)
- **Focus items:** Individual focusable elements within a zone, arranged in a 2D grid
- **Focus ring:** Visual highlight (2px solid #e44d8a, 4px offset) applied to focused element

**Key Handling:**
- Arrow keys: move focus within current zone; if at edge, transition to adjacent zone
- Enter: activate focused element
- Back (keyCode 10009): navigate back (previous screen or close overlay)
- Escape (browser): mapped to Back for dev testing
- Media keys: forwarded directly to Player regardless of focus

**Zone Transitions:**
```
┌──────────┐    →    ┌──────────────┐
│ Sidebar  │  Right  │   Content    │
│          │  ←──────│              │
│          │  Left   │              │
└──────────┘         └──────┬───────┘
                            │ Down (at bottom)
                     ┌──────▼───────┐
                     │ NowPlaying   │
                     │    Bar       │
                     └──────────────┘
```

### 3.5 Player Engine (player.js)
Audio playback via **Tizen AVPlay API** (`webapis.avplay`) on TV, with HTML5 `<audio>` fallback for browser development.

**Platform Detection:**
```javascript
const IS_TIZEN = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';
```

**State:**
```javascript
{
  currentTrack: null,     // Track object
  queue: [],              // Array of track objects
  queueIndex: 0,          // Current position in queue
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,            // 0-1
  shuffle: false,
  repeat: 'none',         // 'none' | 'all' | 'one'
}
```

**Features:**
- Play album (replace queue), play track (insert + play), add to queue
- Shuffle mode (Fisher-Yates on queue copy, preserving original order)
- Repeat: none, all (loop queue), one (loop current track)
- Scrobble to Navidrome when track reaches 50% or 4 minutes
- Emit events: `play`, `pause`, `trackchange`, `progress`, `queuechange`
- Now playing bar subscribes to events and updates reactively

**AVPlay Backend (Tizen):**
```javascript
// Lifecycle: open → setDisplayRect → prepareAsync → play → stop → close
webapis.avplay.open(streamUrl);
webapis.avplay.setDisplayRect(0, 0, 1, 1);  // 1×1 px off-screen for audio-only
webapis.avplay.prepareAsync(onPrepared, onError);

// In onPrepared callback:
webapis.avplay.play();

// Callbacks via setListener:
webapis.avplay.setListener({
  oncurrentplaytime: function(ms) { /* update progress */ },
  onstreamcompleted: function() { /* track ended, play next */ },
  onbufferingstart: function() { /* show buffering indicator */ },
  onbufferingcomplete: function() { /* hide buffering indicator */ },
  onerror: function(error) { /* log, skip to next track */ }
});

// Seek:
webapis.avplay.seekTo(ms);

// Stop current before loading new track:
webapis.avplay.stop();
webapis.avplay.close();
```

**HTML5 Audio Fallback (Browser Dev):**
```html
<audio id="sonance-audio" preload="auto"></audio>
```
- Used ONLY when `IS_TIZEN === false` (browser development/testing)
- Same public API, different internal implementation
- Source set to Subsonic `stream.view` URL with auth params

**Volume:**
- On Tizen: use `tizen.tvaudiocontrol.setVolume(level)` or let the TV's native volume control handle it
- On browser: use `audioElement.volume`
- Volume preference persists in localStorage

### 3.6 Screen Rendering
Each screen is a JS module exporting:
- `render(container)` — builds DOM and inserts into container
- `activate(params)` — called when navigating to this screen (fetch data, set focus)
- `deactivate()` — cleanup when navigating away
- `getFocusMap()` — returns focus zone configuration for FocusManager

Screens build DOM using helper functions (not template strings for complex layouts):
```javascript
// Example helper pattern
function el(tag, attrs, ...children) { ... }
```

## 4. Data Flow

```
User Input (Remote)
       │
       ▼
  FocusManager ──→ Active Screen Handler
       │                    │
       │              SubsonicAPI.fetch()
       │                    │
       │              Navidrome Server
       │                    │
       │              JSON Response
       │                    │
       │              Screen re-renders affected section
       │
       ├──→ Player (media key events)
       │         │
       │    AVPlay (Tizen) / <audio> (browser)
       │         │
       │    NowPlaying bar updates
       │
       └──→ Router (Back key)
                  │
             Screen transition
```

## 5. Packaging & Deployment

### Tizen Widget Structure
```
Sonance.wgt (ZIP archive)
├── config.xml          # Tizen manifest
├── icon.png            # 256×256 app icon
├── index.html
├── css/styles.css
└── js/
    ├── app.js
    ├── api.js
    ├── auth.js
    ├── focus.js
    ├── player.js
    ├── utils.js
    └── screens/*.js
```

### config.xml Key Settings
```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://simmo.dev/sonance"
        version="1.0.0"
        viewmodes="maximized">
    <name>Sonance</name>
    <icon src="icon.png"/>
    <content src="index.html"/>
    <access origin="*" subdomains="true"/>
    <tizen:application id="xxxxxxxx.Sonance" package="xxxxxxxx" required_version="5.0"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.audio"/>
    <tizen:privilege name="http://tizen.org/privilege/volume.set"/>
</widget>
```

### Deployment Steps
1. Enable Developer Mode on Q90R (Apps → type "12345" → toggle Developer Mode → set PC IP)
2. Build: `bash build.sh` → produces `Sonance.wgt`
3. Deploy via Jellyfin2Samsung: select custom `.wgt`, point to TV IP
4. App appears in Apps → Downloaded on TV

## 6. Testing Strategy

### Browser Testing (Primary)
- All screens tested in Chrome at 1920×1080 viewport
- Keyboard navigation (arrows + Enter + Escape) simulates d-pad
- Dev server on port 8080 pointing at real Navidrome instance
- Network error simulation via browser DevTools throttling

### TV Testing (Post-deployment)
- D-pad navigation flow through all screens
- Audio playback of various formats (FLAC, MP3, AAC)
- Long playback session (queue of 20+ tracks)
- Network interruption recovery
- App resume after TV standby
- Remote media key responsiveness

### Test Harness
A simple browser test page (`tests/browser/index.html`) that:
- Validates SubsonicAPI against live Navidrome instance
- Checks all endpoint responses parse correctly
- Tests Focus Manager key handling
- Tests Player state transitions

## 7. Future Considerations
- Lyrics display (Navidrome supports synced lyrics via OpenSubsonic)
- Artist detail screen with biography
- Gapless playback (AVPlay supports this with `prepareAsync` on next track while current plays)
- Chromecast/DLNA output
- Multiple server profiles
- Transcoding preference configuration (bitrate/format selection via Subsonic params)

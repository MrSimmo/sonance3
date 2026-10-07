You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S5: Audio Playback Engine, Now Playing & Queue Screens.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules — especially the "Audio Playback (AVPlay)" and "Tizen 5.0 Constraints" sections
2. Read docs/UI-MOCKUP-REFERENCE.md — Now Playing screen, Queue screen, Now Playing bar specs
3. Read docs/ARCHITECTURE.md section 3.5 (Player Engine) — this details the AVPlay lifecycle and browser fallback
4. Read tickets/S5-playback-engine.md for the detailed task list
5. Read PROGRESS.md to see current state

IMPORTANT RULES:
- Vanilla JS only. No frameworks.
- Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- CSS: Do NOT use `backdrop-filter`. Use solid semi-transparent backgrounds (e.g. `rgba(34, 34, 48, 0.95)`).
- No external network requests — only the configured Navidrome server.
- The UI MUST match the mockup exactly.
- **DUAL PLAYBACK BACKEND:** The Player engine MUST support two backends:
  1. **Tizen AVPlay** (`webapis.avplay`) — primary, used on the TV. Lifecycle: open → setDisplayRect(0,0,1,1) → prepareAsync → play. Callbacks: oncurrentplaytime, onstreamcompleted, onerror.
  2. **HTML5 Audio** (`<audio>` element) — fallback for browser dev/testing only.
  Detect at startup: `var IS_TIZEN = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';`
  The public API (play, pause, next, seek, etc.) must be identical regardless of backend.
- Stream URL format: SubsonicAPI.getStreamUrl(songId) — returns a URL string. Set this as the source for AVPlay.open() or audio.src.
- Scrobble when track reaches 50% OR 4 minutes — whichever comes first. Only scrobble once per play.
- Volume and shuffle/repeat preferences persist in localStorage.
- Now Playing screen background: use a radial gradient based on a colour hash of the album title/ID. Do NOT try to extract colours from images.
- The Now Playing bar must update in real-time across ALL screens — it's persistent.
- Media keys (Play/Pause=10252, Stop=10253, Rewind=10412, FastForward=10417) must work from any screen.
- Run autonomously — do not stop to ask questions. Make pragmatic choices and document in PROGRESS.md.

START BY reading all documents, reviewing existing code, then implementing S5 tasks.

When complete, test IN BROWSER (HTML5 Audio fallback):
- Click Play on an album → audio actually plays in browser
- Play/Pause toggles correctly
- Next/Previous work
- Progress bar updates in real-time
- Now Playing bar updates across all screens
- Now Playing full screen shows correct info with background effect
- Queue screen shows upcoming tracks
- Shuffle mode works
- Repeat modes work
- Track auto-advances at end
- Scrobble fires (check Navidrome play counts)

Note: AVPlay backend cannot be tested in browser — it will be tested on the TV after deployment.

Update PROGRESS.md when done.

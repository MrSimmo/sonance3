# S1 — Project Setup, Dev Server & Authentication

## Overview
Set up the project structure, config.xml for Tizen, development server for browser testing, and the complete authentication flow (login screen, Subsonic API auth, session persistence, logout).

## Prerequisites
- Read `CLAUDE.md` for project rules
- Read `docs/ARCHITECTURE.md` for system design
- Read `docs/UI-MOCKUP-REFERENCE.md` for exact UI specifications

## Tasks

### S1.1 — Project Structure
- Create the full directory structure as specified in CLAUDE.md
- Create `config.xml` with Tizen widget manifest (id: `http://simmo.dev/sonance`, required_version 5.0, privileges for internet, tv.audio, and volume.set, `<access origin="*" subdomains="true"/>`)
- Create `index.html` entry point with:
  - Meta viewport for 1920×1080
  - CSS link to `css/styles.css`
  - `<div id="app"></div>` root container
  - `<audio id="sonance-audio" preload="auto"></audio>` element (hidden)
  - Script tags loading all JS files in correct order (utils → api → auth → focus → player → screens → app)
- Create placeholder `icon.png` (or SVG fallback)

### S1.2 — Base CSS
- Create `css/styles.css` with:
  - CSS custom properties for the full colour palette (see UI-MOCKUP-REFERENCE.md)
  - Global reset (`box-sizing: border-box`, margin/padding reset)
  - Font stack: `-apple-system, 'Helvetica Neue', sans-serif`
  - `html, body, #app` at 100% width/height, background `--bg-primary`, colour `--text-primary`
  - Scrollbar styling (4px width, `--border` thumb, transparent track)
  - Focus ring utility class: `.focusable:focus`, `.focused` styles matching spec
  - `.screen` base class for screen containers
  - Keyframe animation for equaliser bars (`@keyframes barBounce`)

### S1.3 — Utility Module (utils.js)
- MD5 hash function (pure JS implementation, no external dependency — use a lightweight MD5 like SparkMD5 pattern or the classic Paj's MD5)
- `generateSalt(length)` — random hex string
- `formatDuration(seconds)` — returns "m:ss"
- `el(tag, attrs, ...children)` — DOM element creation helper
- `$(selector)` / `$$(selector)` — querySelector shortcuts
- Console logger: `log(module, message)` with `[Sonance][module]` prefix

### S1.4 — Subsonic API Client (api.js)
- `SubsonicAPI` class with constructor taking `{ serverUrl, username, password }`
- Private method `_buildUrl(endpoint, params)` — constructs full URL with auth params (`u`, `t`, `s`, `v=1.16.1`, `c=Sonance`, `f=json`)
- Private method `_request(endpoint, params)` — fetch wrapper with error handling, timeout (10s), JSON parsing, status check
- Public method `ping()` — calls `ping.view`, returns `{ ok: true }` or throws
- Public method `getStreamUrl(songId)` — returns stream URL string (no fetch, just URL construction)
- Public method `getCoverArtUrl(id, size)` — returns cover art URL string
- Stub methods for endpoints used later (getArtists, getAlbum, getAlbumList2, search3, getPlaylists, getGenres, scrobble, star, unstar, getStarred2) — just log "not yet implemented"
- All errors caught and re-thrown with user-friendly messages

### S1.5 — Auth Manager (auth.js)
- `AuthManager` class
- `isLoggedIn()` — checks localStorage for `sonance_logged_in === 'true'`
- `getCredentials()` — returns `{ serverUrl, username, password }` from localStorage
- `login(serverUrl, username, password)` — stores to localStorage, calls `SubsonicAPI.ping()` to validate, throws on failure
- `logout()` — clears all `sonance_*` keys from localStorage
- `getApi()` — returns configured `SubsonicAPI` instance using stored credentials

### S1.6 — Login Screen (screens/login.js)
- Build the login UI exactly per UI-MOCKUP-REFERENCE.md:
  - Centred card (max-width 440px), `--bg-secondary` background, border-radius 16px, `--border` border
  - Logo (gradient icon + "Sonance" + "BY SIMMO") at top of card
  - Four input fields: Server URL, Port, Username, Password
  - Input styling: `--bg-card` background, `--border` border, 14px padding, border-radius 10px, `--text-primary` text
  - Labels: 13px, `--text-secondary`, margin-bottom 6px
  - "Connect" button: full width, `--accent` background, white text 15px weight 600, border-radius 12px, padding 14px
  - Error message area (hidden by default, red text, appears below button on failure)
  - Loading state on button during connection attempt ("Connecting...")
- Focus management: Tab through fields with d-pad down/up, Enter on Connect button triggers login
- On successful login, emit event or call callback to navigate to Home
- Default values: Server URL "http://192.168.0.2", Port "4534"

### S1.7 — Minimal App Shell (app.js)
- `App` class that:
  - On init, checks `AuthManager.isLoggedIn()`
  - If not logged in → render LoginScreen
  - If logged in → validate with ping → show placeholder "Home" text (full home screen comes in S3)
  - Listens for login success → transition from Login to placeholder Home
- Wire up basic keyboard listener (for later Focus Manager integration in S2)

### S1.8 — Dev Server & Browser Testing
- Create `serve.sh` script that starts `python3 -m http.server 8080` from the project root
- Create `build.sh` script that zips the app files into `Sonance.wgt` (excluding docs, tests, tickets, PROGRESS.md, etc.)
- Start the dev server and test the login flow in browser at http://localhost:8080:
  - Verify login screen renders correctly
  - Verify connection to Navidrome at http://192.168.0.2:4534 (enter credentials in the login screen UI)
  - Verify credentials persist after page reload
  - Verify logout clears session and returns to login
  - Verify error handling for wrong password, unreachable server, invalid URL

## Acceptance Criteria
- [ ] Project structure matches CLAUDE.md spec
- [ ] `config.xml` is valid Tizen manifest
- [ ] Login screen matches UI mockup exactly (colours, spacing, typography)
- [ ] Can connect to Navidrome instance via Subsonic API ping
- [ ] Credentials persist in localStorage across page reloads
- [ ] Logout clears session and returns to login
- [ ] Error states shown for: wrong credentials, unreachable server, missing fields
- [ ] Dev server runs and app loads in browser at localhost:8080
- [ ] `build.sh` produces valid `Sonance.wgt` file
- [ ] All console output uses `[Sonance]` prefix

## Update PROGRESS.md
After completing this phase, update PROGRESS.md with completed tasks, issues found, and any notes.

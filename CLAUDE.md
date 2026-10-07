# CLAUDE.md — Sonance (Navidrome TV Client for Samsung Tizen)

## Project Overview
Sonance is a music player app for Samsung Tizen TVs (specifically Q90R / Tizen 5.0) that connects to a Navidrome server via the Subsonic REST API. It is a vanilla web app (HTML/CSS/JS) packaged as a `.wgt` widget for sideloading via Jellyfin2Samsung.

**Brand:** Sonance — "By Simmo"
**Target:** Samsung Q90R (2019), Tizen 5.0, 1920×1080 display
**Server:** Navidrome via Subsonic REST API (v1.16.1)

## v3 UI Design System (current)

### Navigation
- **Top nav bar** replaces the sidebar. Floating, centred, pill-shaped container with 80% opacity dark background.
- Nav items: Home, Library, Playlists, Queue, Now Playing, Search (🔍 icon), Settings (⚙ icon)
- **Sliding pill highlight** behind focused item — moves with `transform: translateX()`. Light fill when focused, accent-tinted when selected.
- **Auto-navigate on slide, after a dwell (v3.10, D51).** Left/Right moves the pill and its label at once; the page follows ~180 ms after the last press, so a flick across several items renders only the destination. No Enter needed. Down or Enter during the dwell navigates at once and drops into the page's content.
- **Down enters page content**, Up returns to nav bar.
- **Entry index (v3.10, D54).** A focus zone may declare `entryIndex`: Down/Up into it, and the drop from the top nav, land there. The Now Playing controls row always enters on Play/Pause, except that Up from the credits list returns to ⓘ (v3.10 S6, D118). An unavailable NP control is dimmed, never `display:none`, so focus can never land on an invisible element (D55).
- **Bottom bar (v3.10, D56).** Repeated Down from any zone on any screen ends on the NP bar's first target, `.np-bar-open` (art + title + artist), a solid-fill pill; OK on it opens Now Playing. Then Previous, Play/Pause, Next. Up returns to the zone and item focus came from. The bar is not focusable while hidden (no track, or on Now Playing). Every screen registers it through `App.registerNowPlayingBarZone(upNeighbour)`. On Now Playing, where the bar is hidden, repeated Down ends on the Up Next strip (v3.10 S6, A6, D123), or on the sleep-timer chip when Up Next is hidden in Settings (v3.10-fix2, D157).
- **Hold OK (v3.10 S7, A5, D133).** On track rows (album, playlist, Songs, genre songs, Search songs, Queue) and Up Next tiles, OK is press-and-release aware: a short press activates on keyup; holding opens the options sheet (`js/options-sheet.js`, its own isolated zone; Back closes it onto the row). A zone opts in with `onLongPress` (and `hasLongPress(idx)` to exclude items); every other zone keeps activation on keydown.
- There is NO sidebar. Do not create or reference a sidebar.

### Library Sub-Navigation
- Vertical pill menu on the left side of the Library screen (Albums, Artists, Songs, Genres).
- Same sliding pill pattern as the top nav but vertical (`translateY`).
- Auto-navigate on Up/Down after the same ~180 ms dwell (v3.10, D51): the pill moves at once, the tab is built once the presses stop. Right enters content (building a pending tab first), Left returns to sub-nav. Down on the last tab goes to the NP bar (v3.10, D56).

### Transitions (ALL must be GPU-accelerated)
- **Page slide** (top nav Left/Right): outgoing page slides + fades out, incoming slides + fades in. `transform: translateX()` + `opacity`.
- **Zoom in** (Enter on item → sub-page): outgoing `scale(1.08) + opacity:0`, incoming starts at `scale(0.92)` and animates to `scale(1)`.
- **Zoom out** (Back from sub-page): reverse of zoom in.
- **Cross-fade** (library tab switch): simple `opacity` fade, 0.15s.

### Focus Styles (v4, v3.10 R6, D50)
- **Focus is a solid accent fill** (`--focus-fill`) with a computed ink (`--focus-ink`: white if white-on-accent contrast ≥ 3:1, else `#15151c`; `--focus-ink-soft` = ink at 0.86 alpha). `App.applyAccentColor()` sets all three; `:root` holds the Pink defaults. Never an alpha-tinted fill.
- **Cards** (album, artist, genre, playlist, quick-access, Home): `transform: scale(1.12)` (with `translateZ(0)` kept on the D6 cards) plus a ring and deep shadow on the art: `box-shadow: 0 0 0 0.4rem var(--focus-fill), 0 2.2rem 4.4rem rgba(0,0,0,.7)`. Labels under art: `#fff` 700 focused, `rgba(240,240,245,.72)` 500 at rest.
- **Track/song rows**: background `--focus-fill`, title/number/duration/icons in `--focus-ink`, meta in `--focus-ink-soft`, `transform: scale(1.02)`, `transform-origin: left center`.
- **Buttons** (Play, Shuffle, Settings rows, Logout, dialogs, keyboard keys): `--focus-fill` + `--focus-ink`. NP transport buttons get a circular fill platter; NP Play/Pause keeps its white platter at rest.
- **Nav pills**: sliding pill highlight (top nav and library sub-nav), solid `--focus-fill` when focused, `rgba(255,255,255,.15)` when selected. The label colour is derived from the pill's state (D71), so they always agree.
- Colour and background snap; only transforms animate. Transition duration: 0.12-0.15s for focus changes, 0.2-0.25s for page transitions.
- A focused element's scale and ring must not be cut by a clipping container: give the container room (D76). Spec: `docs/UI-MOCKUP-REFERENCE.md` "Focus".

### Layout
- Full-width (1920px). Content centred with `max-width: 1400px; margin: 0 auto;`.
- Background: `--bg-main: #1a1a24` (warm dark grey).
- Font: `'SamsungOne', 'SamsungOneUIFW', sans-serif` (system font on Tizen).
- No sidebar offset — content starts at left edge.
- **Interface size (v3.10, D49).** Every length in `css/styles.css` is `rem` on a root `font-size` of `10px × scale`: scale 1 / 1.25 / 1.5 / 1.75 / 2, **default 1.5**, set in Settings → Appearance → Interface size, stored in `localStorage['sonance-ui-scale']`, and applied before first paint by the inline `<head>` script in `index.html`. Write new CSS in rem (`Npx` → `(N/10)rem`); only 1px hairline borders and the Now Playing backdrop blur stay px. In JS, design lengths use `SonanceUtils.rem(px)`, layout maths uses `SonanceUtils.px(n)`, and measured geometry stays measured. **Never use CSS `zoom`** to scale the UI: it mis-positions measured elements, and Chromium 63's `zoom` differs from today's. Spec: `docs/UI-MOCKUP-REFERENCE.md` "Interface size".

### Animation Rules (CRITICAL)
- ONLY animate `transform` and `opacity` — these are GPU-composited.
- NEVER use `transition: all` — it catches layout properties.
- NEVER transition `width`, `height`, `margin`, `padding`, `left`, `right`, `font-size`, `border`.
- Properties like `color`, `background`, `font-weight` should snap instantly (no transition).
- Use `will-change: transform, opacity` on elements that animate.
- Keep durations short: 0.12-0.25s maximum.

## Critical Rules

### Architecture
- **Vanilla JS only.** No React, no build step, no bundler, no npm at runtime. The `.wgt` must be self-contained static files.
- The app is a single-page application (SPA) with screen-based routing managed by a simple JS router.
- All files must work when served from `app://` origin inside a Tizen WebView AND from `http://localhost` during browser dev/testing.
- Target ES2017 syntax (Tizen 5.0 Chromium ~v63).

### Tizen 5.0 Constraints (CRITICAL)
- **Chromium ~v63.** No optional chaining (`?.`), no nullish coalescing (`??`), no `BigInt`, no top-level `await`, no `Array.flat()`, no `Object.fromEntries()`. Use polyfills or manual alternatives.
- **CSS `backdrop-filter` is NOT supported.** Do not use it anywhere. Use solid semi-transparent backgrounds (e.g. `rgba(34, 34, 48, 0.95)`) instead of blur effects.
- **CSS `position: sticky` may have quirks.** Prefer `position: fixed` for persistent elements.
- **`<audio>` element has limited codec support.** Do NOT use HTML5 `<audio>` for playback. Use the **Tizen AVPlay API** (`webapis.avplay`) as the primary and only playback method. See the Audio Playback section below.
- **`overflow: auto` scrolling** may need explicit container heights. Always set height on scrollable containers.
- **CSS `gap` on flex containers is NOT supported (Chrome 84+).** NEVER use `gap` on `display: flex` elements. Use `margin-left` / `margin-top` on child elements instead (the `> * + *` pattern or explicit margins on each child).

  **CSS `gap` shorthand on grid containers is NOT supported (Chrome 66+).** Use the legacy `grid-gap` property instead. `grid-gap` works from Chrome 57.

### Audio Playback (AVPlay)
- **Use `webapis.avplay` for ALL audio playback.** This is Samsung's native media framework and handles FLAC, MP3, AAC, OGG, and other codecs through the TV's hardware decoder.
- AVPlay lifecycle: `open(url)` → `setDisplayRect(...)` → `prepareAsync(callback)` → `play()` → `stop()` → `close()`.
- For audio-only playback, set display rect to a 1×1 pixel off-screen area (AVPlay requires a display rect even for audio).
- AVPlay callbacks: `onbufferingstart`, `onbufferingcomplete`, `onstreamcompleted`, `oncurrentplaytime`, `onerror`.
- Use `oncurrentplaytime` for progress tracking (fires with ms value).
- Use `onstreamcompleted` for track-ended detection (triggers next track).
- Seek: `seekTo(ms)`.
- **Browser fallback:** AVPlay is only available on Tizen. For browser dev/testing, fall back to HTML5 `<audio>` element. The Player engine must abstract this: detect `window.webapis` at startup and use AVPlay if available, `<audio>` otherwise.
- `config.xml` must include privilege: `http://tizen.org/privilege/tv.audio`.

### Network & Security
- **The app MUST only connect to the user-configured Navidrome server.** No CDNs, no external fonts, no analytics, no third-party APIs, no external image sources.
- All assets (CSS, JS, SVGs, icons) are bundled in the `.wgt`. Zero external dependencies at runtime.
- `config.xml` uses `<access origin="*" subdomains="true"/>` because the Navidrome server IP/port is user-configured at runtime. This is necessary but the app code itself must NEVER make requests to any URL other than the stored `sonance_server_url`.
- Stream and cover art URLs are constructed from the Subsonic API using the configured server URL — they are NOT external resources.

### Test Configuration
- **Test Navidrome server:** `http://192.168.0.2:4534`
- Use this for all browser testing during development. The user will provide credentials at runtime.
- The app itself does NOT hardcode any server address — it is always user-configured via the login screen.

### UI Design
- **The v3 UI Design System above is authoritative.** See `docs/UI-MOCKUP-REFERENCE.md` for the full design specification.
- Colour palette (legacy reference, superseded by v3 where they conflict): `BG_PRIMARY: #0a0a0c`, `BG_SECONDARY: #121217`, `BG_CARD: #1a1a22`, `BG_ELEVATED: #222230`, `ACCENT: #e44d8a`, `TEXT_PRIMARY: #f0f0f5`, `TEXT_SECONDARY: #8e8ea0`, `TEXT_MUTED: #55556a`, `BORDER: #2a2a38`.
- Dark theme only. No light mode.
- Persistent now-playing bar at the bottom (76px tall).
- All interactive elements must be focusable for d-pad navigation. Focus styling follows the Focus Styles rules above (solid accent fill for rows and buttons, scale + ring for cards, sliding pill for nav). Do NOT use outline or border focus rings; a box-shadow ring is allowed **for cards only** (v3.10, D50). The one exception is the accent swatch's white border: its fill is the colour it offers (D74).

### D-Pad / Remote Navigation
- The Samsung TV remote has: Arrow keys (Up/Down/Left/Right), Enter/OK, Back, Play/Pause, and colour buttons.
- All navigation is keyboard/d-pad driven. No mouse, no touch.
- Every interactive element must be focusable and reachable via d-pad.
- Focus management is handled by a central `FocusManager` class.
- Samsung remote keycodes: Back=10009, Play/Pause=10252, Stop=10253, Rewind=10412, FastForward=10417.
- Standard arrow keys and Enter use normal browser keycodes (37/38/39/40/13).

### Subsonic API Integration
- Base path: `/rest/`
- Auth: Token-based. `token = md5(password + salt)`, send as query params: `u`, `t`, `s`, `v=1.16.1`, `c=Sonance`, `f=json`.
- All API calls go through a single `SubsonicAPI` class.
- Stream URLs: `/rest/stream.view?id={songId}&...auth_params`
- Cover art: `/rest/getCoverArt.view?id={coverId}&size={size}&...auth_params`
- Error handling: check `subsonic-response.status === 'ok'`, surface errors to user.

### Authentication & Session
- Login screen collects: server URL (with protocol), port, username, password.
- Session persists in `localStorage` — user stays logged in indefinitely.
- Logout button in Settings clears `localStorage` and returns to login screen.
- On app start, check `localStorage` for existing session; if valid, skip login.
- Validate connection with `ping.view` before storing credentials.

### File Structure
```
sonance/
├── config.xml              # Tizen widget manifest
├── icon.png                # App icon (256×256)
├── index.html              # Single HTML entry point
├── css/
│   └── styles.css          # All styles
├── js/
│   ├── app.js              # App init, router, screen manager
│   ├── api.js              # SubsonicAPI class
│   ├── auth.js             # Auth/session management
│   ├── focus.js            # FocusManager for d-pad navigation
│   ├── player.js           # Audio playback engine + queue
│   ├── screens/
│   │   ├── login.js        # Login screen
│   │   ├── home.js         # Home screen
│   │   ├── library.js      # Library screen (tabs)
│   │   ├── album.js        # Album detail screen
│   │   ├── search.js       # Search screen with on-screen keyboard
│   │   ├── nowplaying.js   # Full-screen now playing
│   │   ├── queue.js        # Queue/up next screen
│   │   ├── playlists.js    # Playlists screen
│   │   └── settings.js     # Settings screen (logout, server info)
│   └── utils.js            # Helpers (MD5, formatting, etc.)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── UI-MOCKUP-REFERENCE.md
│   └── TESTING.md
├── tests/
│   └── browser/            # Browser-based test harness
├── PROGRESS.md
└── tickets/
```

### Development & Testing
- **Dev server:** Use Python `http.server` or Node `http-server` on port 8080 for browser testing.
- **Browser testing first.** All screens and API integration must work in Chrome/Firefox before deploying to TV.
- All API calls must handle network errors gracefully (timeout, unreachable server, auth failure).
- Console logging with `[Sonance]` prefix for all debug output.
- Test with keyboard navigation in browser (arrow keys + Enter + Escape for Back).

### Build & Packaging
- `.wgt` is a renamed `.zip` containing all app files + `config.xml`.
- Build script: `build.sh` that zips the app into `Sonance.wgt`.
- Deploy via Jellyfin2Samsung (sideload the `.wgt` to TV in developer mode).

### Workflow Rules
- **One ticket per Claude Code session.** Do not combine phases.
- **Update PROGRESS.md** at the end of every session with: what was completed, what was tested, any issues found.
- **Do not install packages** without first listing them and waiting for user confirmation. If the user is not available, log the requirement to PROGRESS.md and stop.
- **Rebuild/restart dev server** after every code change to verify.
- **Test in browser** before marking any task complete.
- Always commit working state before moving to next phase.
- **Run autonomously.** Do not stop to ask questions mid-phase. Use the test config values above for browser testing. If something is ambiguous, make the pragmatic choice, document it in PROGRESS.md, and keep going.`

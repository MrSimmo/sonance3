# Sonance — Testing Strategy

## Overview
Sonance cannot be fully tested on the target device (Samsung Q90R) during development. The strategy is to maximise browser-based testing coverage, then do a focused TV deployment test at the end.

## 1. Browser Testing (Primary — Every Phase)

### Environment
- Chrome or Firefox at **1920×1080** viewport (use DevTools responsive mode)
- Dev server running on `http://localhost:8080`
- Real Navidrome instance at `http://192.168.0.2:4534`
- **Keyboard-only navigation** — do not use the mouse to test UI interaction
- **Note:** AVPlay backend cannot be tested in browser. Browser testing uses the HTML5 `<audio>` fallback. AVPlay is tested on the TV after deployment.

### Per-Screen Checklist

#### Login Screen
- [ ] Renders centred card with all fields
- [ ] Tab/arrow between fields
- [ ] Enter on Connect triggers login
- [ ] Successful login → navigates to Home
- [ ] Wrong password → shows error message
- [ ] Unreachable server → shows error message
- [ ] Empty fields → shows validation error
- [ ] After login, refresh page → still logged in
- [ ] Logout → returns to login, refresh → still on login

#### Home Screen
- [ ] Hero banner shows album art + metadata
- [ ] Play/Shuffle buttons focusable
- [ ] Recently Played shows 6 albums from API
- [ ] Playlists section shows user playlists
- [ ] Album art loads (or placeholder on error)
- [ ] Click album → navigates to Album Detail
- [ ] D-pad moves through all sections

#### Library Screen
- [ ] All 4 tabs render and switch correctly
- [ ] Albums: grid populates, cards focusable, click → Album Detail
- [ ] Artists: grid populates, avatars render
- [ ] Songs: list populates, rows focusable
- [ ] Genres: cards render, focusable
- [ ] Tab switching preserves focus sanity

#### Album Detail
- [ ] Artwork and metadata display correctly
- [ ] Tracklist shows all tracks with numbers and durations
- [ ] Back button works (Enter or Escape)
- [ ] Play button starts playback (S5+)
- [ ] Shuffle button starts shuffled playback (S5+)
- [ ] Click track → plays from that track (S5+)
- [ ] Currently playing track highlighted (S5+)

#### Search
- [ ] On-screen keyboard renders (9 columns + SPACE + DEL)
- [ ] Typing characters updates input display
- [ ] DEL removes last character
- [ ] SPACE adds space
- [ ] Clear button clears input
- [ ] Results appear after 300ms debounce
- [ ] Click result → navigates to Album Detail
- [ ] Empty state shows Quick Access cards

#### Now Playing (Full Screen)
- [ ] Background blur effect from album colour
- [ ] Album art with shadow
- [ ] Progress bar updates in real-time
- [ ] Seek via arrow keys when progress focused
- [ ] Transport controls all functional
- [ ] Shuffle/repeat toggle and display state correctly
- [ ] Volume bar works

#### Queue
- [ ] Shows current track in left panel
- [ ] Up Next list shows remaining queue
- [ ] Click queue item → jumps to that track
- [ ] Queue updates when tracks change

#### Now Playing Bar
- [ ] Shows current track info
- [ ] Mini progress bar updates
- [ ] Transport controls work
- [ ] Click bar → full Now Playing screen
- [ ] Updates across all screens

#### Settings
- [ ] Shows server info
- [ ] Shows playback state indicators
- [ ] Logout button works with confirmation

### Focus Navigation Matrix

Test each of these zone transitions:
| From | Direction | Expected To |
|------|-----------|-------------|
| Sidebar | Right | Content area (first focusable) |
| Content | Left | Sidebar (last active item) |
| Content (bottom) | Down | Now Playing bar |
| Now Playing bar | Up | Content area (last focused item) |
| Any screen | Back/Escape | Previous screen |
| Login | Back | Nothing (stay on login) |
| Home | Back | Nothing (stay on home) |

## 2. Browser Test Harness (Phase S6)

Standalone page at `tests/browser/index.html` with automated checks:

### API Module Tests
```
✓ Ping — connection successful
✓ GetArtists — returns array with name field
✓ GetAlbumList2 (recent) — returns array with title, artist fields
✓ GetAlbum — returns album with song array
✓ Search3 — returns results for known query
✓ GetPlaylists — returns array
✓ GetGenres — returns array with value field
✓ GetCoverArtUrl — generates valid URL format
✓ GetStreamUrl — generates valid URL format
✓ Auth failure — returns error for wrong password
```

### Focus Manager Tests
```
✓ Register zone — zone exists in manager
✓ Set active zone — zone receives focus
✓ Move focus down — index increments
✓ Move focus up — index decrements
✓ Move focus at edge — transitions to neighbor zone
✓ Activate focused — callback fires
```

### Player Tests
```
✓ PlayAlbum — queue populated, index 0
✓ Next — index increments
✓ Previous (< 3s) — index decrements
✓ Previous (> 3s) — restarts current track
✓ Shuffle toggle — queue reordered
✓ Repeat all — loops at end
✓ Repeat one — stays on same track
✓ Volume set — persists in localStorage
```

## 3. TV Testing (Post-Deployment)

After deploying `.wgt` via Jellyfin2Samsung, run through this checklist on the actual Samsung Q90R:

### First Boot
- [ ] App loads without errors
- [ ] Login screen renders correctly on TV
- [ ] Can enter server URL and credentials using TV remote
- [ ] Connection to Navidrome succeeds from TV

### Navigation
- [ ] Remote arrows navigate sidebar correctly
- [ ] Enter/OK button selects items
- [ ] Back button returns to previous screen
- [ ] Focus ring clearly visible on TV at viewing distance
- [ ] No focus traps on any screen

### Playback
- [ ] AVPlay initialises without errors (check TV debug console if available)
- [ ] Audio plays through TV speakers
- [ ] Play/Pause button on remote works
- [ ] FLAC files play correctly (AVPlay hardware decoder)
- [ ] MP3 files play correctly
- [ ] Track transitions are smooth (no gaps or glitches)
- [ ] Buffering indicator shows/hides appropriately on slow network
- [ ] Volume control works (TV volume or app volume)
- [ ] Long playback session (30+ minutes) — no crashes or memory issues
- [ ] AVPlay `stop()` + `close()` called correctly between tracks (no resource leaks)

### Visual
- [ ] All text readable at 2-3m viewing distance
- [ ] Colours render correctly on TV panel
- [ ] Album art loads and displays properly
- [ ] Animations smooth (no jank)
- [ ] No layout overflow or clipping issues

### Edge Cases
- [ ] TV standby → resume: app still works
- [ ] TV app switch → return: playback resumes
- [ ] Server goes offline during use → graceful error
- [ ] Very long queue (50+ tracks) → no performance issues

## 4. Known Tizen 5.0 Limitations to Watch For
- Chromium ~v63: no optional chaining, no nullish coalescing, no BigInt, no Array.flat(), no Object.fromEntries()
- **AVPlay is the primary playback method** — HTML5 `<audio>` is browser fallback only
- AVPlay requires `setDisplayRect()` even for audio-only — use 1×1px off-screen
- AVPlay `oncurrentplaytime` returns milliseconds, not seconds
- AVPlay must call `stop()` then `close()` before loading a new source
- `fetch()` is available but check CORS behaviour from `app://` origin
- `localStorage` works but has size limits
- AVPlay handles FLAC, MP3, AAC, OGG natively through the TV's hardware decoder
- CSS `backdrop-filter` is **NOT supported** — use solid semi-transparent backgrounds
- CSS `position: sticky` may have quirks — prefer `position: fixed` for persistent elements
- Test `overflow: auto` scrolling behaviour (may need explicit height)

You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S3: Home & Library Screens with API Integration.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read docs/UI-MOCKUP-REFERENCE.md — Home and Library screen specs
3. Read tickets/S3-home-library.md for the detailed task list
4. Read PROGRESS.md to see current state

IMPORTANT RULES:
- Vanilla JS only. No frameworks.
- Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- CSS: Do NOT use `backdrop-filter`. Use solid semi-transparent backgrounds.
- No external network requests — only the configured Navidrome server.
- The UI MUST match the mockup exactly.
- API responses from Navidrome's Subsonic API are nested — e.g. `response['subsonic-response'].albumList2.album`. Handle this carefully and defensively (check for undefined/null at each level).
- Album art: use getCoverArtUrl() for images, fall back to gradient placeholder with vinyl SVG on error.
- Implement loading skeletons while data fetches (pulsing card placeholders).
- Add a simple in-memory cache (5 min TTL) to avoid redundant API calls.
- Register focus zones for every interactive section on both screens.
- Home screen sections scroll horizontally — ensure overflow is hidden and focus scrolls items into view.
- Run autonomously — do not stop to ask questions. Make pragmatic choices and document in PROGRESS.md.

START BY reading all documents, reviewing existing code, then implementing S3 tasks.

When complete, test with a live Navidrome instance:
- Home: hero banner with recent album, recently played row (6 albums), playlists row
- Library: tab switching works, albums grid populates, artists grid populates, songs list, genres grid
- Album art loads from Navidrome (or placeholder on failure)
- D-pad navigation through all sections
- Clicking album card navigates (even if Album Detail is still a placeholder)
- Loading states visible during fetch

Update PROGRESS.md when done.

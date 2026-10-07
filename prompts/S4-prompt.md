You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S4: Album Detail, Search Screen & Browsing.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read docs/UI-MOCKUP-REFERENCE.md — Album Detail and Search screen specs
3. Read tickets/S4-album-search.md for the detailed task list
4. Read PROGRESS.md to see current state

IMPORTANT RULES:
- Vanilla JS only. No frameworks.
- Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- CSS: Do NOT use `backdrop-filter`. Use solid semi-transparent backgrounds.
- No external network requests — only the configured Navidrome server.
- The UI MUST match the mockup exactly.
- Album Detail is a split layout: left panel (300px) for artwork/metadata, right panel for tracklist.
- Search on-screen keyboard is a 9-column grid. SPACE spans 4 columns, DEL spans 3.
- Search must debounce 300ms before making API calls.
- The search3 Subsonic endpoint returns artists, albums, and songs in one response — display all types.
- When the Play button is pressed on Album Detail, populate the player queue with the album tracks. The actual audio playback comes in S5, but the queue data structure must be ready.
- Equaliser bars animation: 4 thin bars (3px wide, varying heights), animating with CSS keyframes, shown on the currently playing track.
- Run autonomously — do not stop to ask questions. Make pragmatic choices and document in PROGRESS.md.

START BY reading all documents, reviewing existing code, then implementing S4 tasks.

When complete, test:
- Navigate to Album Detail from Home and Library
- Album detail shows artwork, metadata, and full tracklist
- Back button returns to previous screen
- Play/Shuffle buttons log queue population to console
- Search keyboard types characters into input
- Search queries return results from Navidrome
- Clear button resets search
- Clicking search result navigates to Album Detail
- D-pad navigation works across all new screens

Update PROGRESS.md when done.

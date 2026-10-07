You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S2: Core Layout, Sidebar Navigation, Routing & D-Pad Focus.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read docs/UI-MOCKUP-REFERENCE.md for the exact UI spec
3. Read docs/ARCHITECTURE.md sections 3.1 (Router), 3.4 (Focus Manager)
4. Read tickets/S2-layout-navigation.md for the detailed task list
5. Read PROGRESS.md to see current state from S1

IMPORTANT RULES:
- Vanilla JS only. No frameworks, no npm packages.
- Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- CSS: Do NOT use `backdrop-filter`. Use solid semi-transparent backgrounds.
- No external network requests — all assets bundled locally.
- The UI MUST match the mockup spec exactly — sidebar dimensions, colours, spacing, icons, focus rings.
- Do NOT modify the login screen or API client from S1 unless fixing a bug.
- The FocusManager is the most critical component in this phase — it must handle d-pad navigation correctly.
- Focus ring: 2px solid #e44d8a, 4px outline-offset, scale(1.04) transform, 0.2s transition.
- Samsung remote keycodes: Back=10009, Play/Pause=10252, Stop=10253, Rewind=10412, FastForward=10417. Also support Escape (27) as Back for browser testing.
- Run autonomously — do not stop to ask questions. Make pragmatic choices and document in PROGRESS.md.

START BY reading all documents above, reviewing the S1 code, then implementing S2 tasks in order.

When complete, test:
- All 9 screens reachable via sidebar nav
- Arrow keys navigate sidebar, Enter selects
- Right arrow from sidebar moves focus to content
- Escape/Back returns to previous screen
- Focus ring visible on all focusable elements
- Logout from Settings works
- Layout matches mockup (sidebar 220px, top bar 60px, now playing bar 76px)

Update PROGRESS.md when done.

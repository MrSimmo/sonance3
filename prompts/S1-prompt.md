You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S1: Project Setup, Dev Server & Authentication.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: use Python 3 (`python3 -m http.server 8080`)
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules and conventions
2. Read docs/ARCHITECTURE.md for system design
3. Read docs/UI-MOCKUP-REFERENCE.md for the exact UI specification you MUST follow
4. Read tickets/S1-setup-auth.md for the detailed task list

IMPORTANT RULES:
- This is a vanilla JS web app. No React, no npm, no build tools, no bundler. Just HTML, CSS, and plain JavaScript files.
- Target ES2017 (Tizen 5.0 Chromium ~v63). No optional chaining (?.), no nullish coalescing (??), no top-level await, no Array.flat(), no Object.fromEntries().
- CSS: Do NOT use `backdrop-filter` (not supported on Tizen 5.0). Use solid semi-transparent backgrounds instead.
- You MUST match the UI design specification exactly — colours, spacing, typography, layout.
- The app must NEVER make network requests to any URL other than the user-configured Navidrome server. No CDNs, no external fonts, no external resources of any kind.
- Before installing any system tools or packages, list what you need and STOP to ask for confirmation. If all you need is Python 3 for the dev server, proceed — that is pre-approved.
- All console output must use [Sonance] prefix.
- Run autonomously — do not stop to ask questions. Use the test config above. If something is ambiguous, make the pragmatic choice and document it in PROGRESS.md.

START BY:
1. Reading all four documents listed above
2. Then proceeding with the tasks in S1-setup-auth.md in order

When complete, test the following in browser:
- Login screen renders correctly matching the mockup
- Can connect to Navidrome at http://192.168.0.2:4534 (you will need to prompt me for username/password at the login screen — this is the only user interaction needed)
- Credentials persist after page reload
- Logout clears session
- Error handling works for wrong password and unreachable server

Update PROGRESS.md when done.

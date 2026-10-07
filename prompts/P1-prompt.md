You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P1: Fix Login Screen Input Navigation for Tizen IME.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P1-tizen-ime-fix.md for the full problem description and fix
3. Read PROGRESS.md to see current state
4. Read js/screens/login.js and js/focus.js to understand current implementation

IMPORTANT RULES:
- This is a TARGETED BUGFIX. Only modify `js/screens/login.js` and `js/focus.js`. Do not touch any other files except PROGRESS.md.
- Vanilla JS only. Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- Do not restructure or refactor existing code. Add the minimum code needed to fix the issue.
- Run autonomously — do not stop to ask questions.

THE PROBLEM:
On Samsung Tizen TVs, the native on-screen keyboard (IME) takes over d-pad events when an <input> is focused. After pressing "Done", focus stays on the same field and up/down moves the cursor within the field instead of navigating between fields. The login screen is unusable on the actual TV.

THE FIX:
1. Intercept Enter (keyCode 13) on each input to auto-advance to the next field (or submit on the last field)
2. Add down/up arrow handlers on inputs as fallback when IME is dismissed but input still has focus
3. Add an "input mode" flag to FocusManager that suppresses d-pad handling while a native input has focus
4. Sync input focus/blur events with FocusManager state

When complete, test in browser:
- Enter on each field advances to the next
- Enter on Password submits the form
- Arrow keys navigate between fields
- Escape blurs the input
- No regressions on other screens

Update PROGRESS.md with a Patches section.

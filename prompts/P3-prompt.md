You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P3: Fix Connect button navigation AND update in-app icons to match the new app icon.

BEFORE WRITING ANY CODE:
1. Read tickets/P3-connect-button-nav.md for both problems and fixes
2. Read js/screens/login.js to understand the current login screen code
3. Read js/app.js (or wherever the sidebar is rendered) to find the sidebar logo SVG

THIS PATCH HAS TWO FIXES:

FIX 1 — CONNECT BUTTON NAV:
Only modify `js/screens/login.js`:
- Down arrow from Password field → blur input, exit input mode, focus Connect button
- Up arrow from Connect button → focus Password field
- Connect button must show pink focus ring when focused

FIX 2 — UPDATE IN-APP ICONS:
The sidebar logo and login screen logo both currently show a music note SVG. Replace the inner SVG paths in both locations with the new S-wave design (stylised S from arcs + sound emanation lines). Keep the gradient background box. The exact SVG paths are in the ticket.

Files to modify: `js/screens/login.js`, `js/app.js` (or sidebar renderer), and `PROGRESS.md`. Nothing else.

Run autonomously. Update PROGRESS.md when done.

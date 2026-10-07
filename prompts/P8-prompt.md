You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P8: Viewport Scaling & TV Spacing Fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P8-v1.2.3-viewport.md for all issues
3. Read PROGRESS.md for current state

## THE CORE PROBLEM
The app looks correct at 1920×1080 in a desktop browser but elements are oversized, crammed, and overlapping on the Samsung Q90R TV. This is a viewport/scaling mismatch. The Tizen WebView may not render at exactly the same effective resolution as the desktop browser.

## APPROACH
1. FIRST: Add a debug overlay showing `window.innerWidth + 'x' + window.innerHeight + ' dpr:' + window.devicePixelRatio` — this is temporary but must be included in this build so the user can read it off the TV and report back.
2. Make layouts MORE ROBUST by using relative/percentage sizing instead of fixed pixel values where possible.
3. Fix each specific issue with extra padding/spacing that works at both 1920×1080 AND potentially slightly different effective resolutions.

## SPECIFIC FIXES (do all of these):

### P8.1 — Use relative grid sizing
Album grid in Library: use `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))` instead of a fixed column count. This auto-adjusts to any viewport width.

### P8.2 — Search screen keyboard/results gap
Use `gap: 40px` between keyboard panel and results. Keyboard: `width: 35%; min-width: 350px; max-width: 500px`. Results: `flex: 1`.

### P8.3 — Artist cards: fix huge highlight, truncation
- Reduce avatar to 100px
- Cap card width with the grid column
- Artist name: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` (or `max-height` for 2 lines)
- Grid: `padding: 8px` for outline room
- Focus: use `box-shadow: 0 0 0 1.5px var(--accent)` not `outline`

### P8.4 — Album grid spacing
Increase gap to `20px 16px`. Ensure all art containers use the `padding-bottom: 100%` aspect ratio trick. Title font: 12px. `margin-top: 8px` on text below art.

### P8.5 — Login double highlight
```css
.login-card input:focus,
.login-card input:active,
.login-card input:focus-visible {
    outline: none !important;
    -webkit-appearance: none;
}
* { -webkit-tap-highlight-color: transparent; }
```
Keep only the app's pink box-shadow as the focus indicator.

### P8.6 — Home hero padding
Hero flex: `gap: 36px`, content padding: `36px 44px`, album title `margin-bottom: 8px`, buttons `margin-top: 20px`. `overflow: hidden` on hero container.

### P8.7 — Recently Added / home album cards
- Focus: `box-shadow: 0 0 0 1.5px var(--accent)` (not outline)
- Scale: reduce from `1.04` to `1.0` (no scale) on horizontal row cards — scale causes overlap
- Add `padding: 4px` on the horizontal scroll container for box-shadow room
- Fixed card width (e.g. 162px)

### P8.8 — Keep debug overlay in this build
Do NOT remove it. The user needs to read the viewport info from the TV. Just make it small and unobtrusive (bottom-right, semi-transparent, monospace).

RULES:
- Vanilla JS, ES2017. No ?., ??, Array.flat(), Object.fromEntries().
- No `aspect-ratio` CSS property (Chromium 63).
- No `backdrop-filter`.
- Run autonomously.
- Rebuild Sonance.wgt when done.

Test in browser at 1920×1080 — verify nothing is broken. The real test is on the TV.

Update PROGRESS.md.

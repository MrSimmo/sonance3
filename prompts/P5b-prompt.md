You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P5b: v1.2 Functional Refinements.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P5-v1.2-refinements.md — do tasks P5.2, P5.3, P5.7, P5.8 in this session
3. Read PROGRESS.md for current state (P5a should be complete)
4. Review the current Now Playing screen code in js/screens/nowplaying.js

This session handles FUNCTIONAL tasks:

### P5.2 — Exit Dialogue on Back from Main Screen
When Back is pressed and nav history is empty (top-level screen), show exit dialogue:
- Centred modal: dark overlay (rgba(0,0,0,0.7)), card with --bg-card background, border-radius 16px
- "Exit Sonance?" heading, "Are you sure?" subtitle
- Cancel button (safe default, focused first) and Exit button
- Cancel or Back key: dismiss dialogue
- Exit: call `tizen.application.getCurrentApplication().exit()` on Tizen, `window.close()` in browser
- Use `position: absolute` NOT `position: fixed` (Tizen WebView issue with fixed positioning)
- FocusManager: isolated modal zone, Left/Right between Cancel and Exit

### P5.3 — Album Art Background Blur (Apple Music Style)
Replace the current Now Playing screen background with a blurred album art image:

```
Structure:
  .np-screen (position: relative, overflow: hidden, fills content area)
    .np-bg-image (position: absolute, top:-10%, left:-10%, width:120%, height:120%)
      - background-image: url(getCoverArtUrl(coverArt, 600))
      - background-size: cover
      - background-position: center
      - filter: blur(50px) saturate(1.3)
    .np-bg-overlay (position: absolute, inset:0, background: rgba(10,10,12,0.55))
    .np-content (position: relative, z-index: 2, all the existing NP content)
```

CRITICAL: `filter: blur()` on a regular element IS supported on Chromium 63 / Tizen 5.0. This is NOT backdrop-filter. This is applying blur to the image element itself.

- When track changes, update the background image URL
- The 120% width/height + negative offset prevents white/transparent edges from the blur
- The overlay ensures text is always readable regardless of artwork brightness
- If the cover art has no image (placeholder), fall back to the existing hash-based radial gradient

### P5.7 — Now Playing Bar Slide Animation
When navigating TO the Now Playing screen:
- Add class `.np-bar-hidden` to the Now Playing bar
- CSS: `.np-bar-hidden { transform: translateY(100%); transition: transform 0.3s ease; }`
- Base state: `#now-playing-bar { transition: transform 0.3s ease; transform: translateY(0); }`
- Content area bottom padding should adjust when bar is hidden

When navigating AWAY from the Now Playing screen:
- Remove class `.np-bar-hidden` — bar slides back up
- ONLY trigger the slide-up animation when the PREVIOUS screen was Now Playing
- For all other screen transitions (e.g. Home → Library), do NOT touch the bar at all

Implementation in the router:
```javascript
function navigateTo(screen, params) {
    var previousScreen = currentScreen;
    // ... existing navigation logic ...
    
    var npBar = document.getElementById('now-playing-bar');
    if (screen === 'nowplaying') {
        npBar.classList.add('np-bar-hidden');
    } else if (previousScreen === 'nowplaying') {
        npBar.classList.remove('np-bar-hidden');
    }
    // If neither entering nor leaving NP screen, don't touch the bar
}
```

### P5.8 — Fix Now Playing Screen Edge Issues
On the TV, there's a blue/grey bar on the right and black bars around the edges.
**Root cause:** The Now Playing screen content doesn't fill the entire content area. The background stops short of the edges.

**Fix:**
- The Now Playing screen root container must be:
  ```css
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
  ```
- Remove any padding from the content area when Now Playing is the active screen
  - Add a class to `#content-area` like `.fullbleed` that sets `padding: 0`
  - Apply when entering Now Playing, remove when leaving
- The blur background div must extend BEYOND the container edges (handled by the -10% / 120% sizing in P5.3)
- Ensure no scrollbar gutter appears: `scrollbar-gutter: auto` or `overflow: hidden` on the NP screen
- The `#content-area` may have `overflow-y: auto` by default — override to `overflow: hidden` when NP is active
- Test: background should fill edge to edge with absolutely no gaps, borders, or bars

RULES:
- Vanilla JS, ES2017 only. No ?., ??, Array.flat(), Object.fromEntries().
- No backdrop-filter. CSS filter: blur() IS allowed.
- No position: fixed in modals (use position: absolute).
- No external URLs.
- Run autonomously.
- Rebuild Sonance.wgt when done.

When complete, test:
- Back on Home screen shows exit dialogue
- Cancel dismisses, Exit closes window (browser)
- Now Playing has beautiful blurred album art background
- Background changes when track changes
- NP bar slides down when entering Now Playing screen
- NP bar slides up only when leaving Now Playing screen
- No blue bar, no black edges, no gaps on Now Playing screen
- All other screens unaffected

Update PROGRESS.md with v1.2b changes.

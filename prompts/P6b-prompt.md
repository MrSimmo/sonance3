You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P6b: Now Playing Screen Fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P6-v1.2.1-bugfixes.md — do tasks P6.1, P6.2, P6.10 in this session
3. Read PROGRESS.md for current state (P6a should be complete)
4. Read js/screens/nowplaying.js and js/app.js carefully

This session fixes THREE Now Playing screen issues:

### P6.1 — Double the Blur
Change `filter: blur(50px)` to `filter: blur(100px)` on `.np-bg-image`. Keep `saturate(1.3)`. Simple one-liner.

### P6.2 — Black Bar at Bottom When Player Bar Slides Away
The NP bar slides down but leaves a black gap. Root cause: the content area has bottom padding for the NP bar, and when the bar hides, the padding remains but nothing fills it.

Fix ALL of these:
1. When the Now Playing screen is active, add a class to `#content-area` (e.g. `.np-active`) that sets `padding-bottom: 0`
2. The Now Playing screen container must be `position: absolute; top: 0; left: 0; right: 0; bottom: 0;` — filling the ENTIRE content area with zero gaps
3. The blur background must extend beyond edges: `top: -10%; left: -10%; width: 120%; height: 120%`
4. The NP bar slide: use `transform: translateY(calc(100% + 2px))` instead of `translateY(100%)` to account for any top border
5. After transition completes, set `visibility: hidden` on the NP bar to prevent any ghost pixels. On slide-up, set `visibility: visible` before starting the transition.
6. When leaving NP screen, remove the `.np-active` class from `#content-area` to restore padding

### P6.10 — Prevent Scrolling to Hidden Player Bar
Pressing Down on the NP screen scrolls content and reveals the hidden bar.

Fix:
1. When NP screen is active, set `#content-area` overflow to `hidden` (not `auto`)
2. The NP screen root element itself: `overflow: hidden`
3. When leaving NP screen, restore `#content-area` overflow to `overflow-y: auto`
4. The Down key on the NP screen should ONLY navigate between focus zones (progress bar ↔ transport controls). It should NOT scroll. Verify the FocusManager doesn't trigger native scroll when focus is at the bottom of the NP screen's zones.
5. If needed, call `e.preventDefault()` on arrow key events when on the NP screen to suppress native scroll behaviour

Implementation tip — in the router or NP screen activate/deactivate:
```javascript
// On activate (entering NP screen):
var contentArea = document.getElementById('content-area');
contentArea.classList.add('np-active');
contentArea.style.overflow = 'hidden';
var npBar = document.getElementById('now-playing-bar');
npBar.style.visibility = 'visible';
npBar.classList.add('np-bar-hidden');
// After transition:
npBar.addEventListener('transitionend', function handler() {
    npBar.style.visibility = 'hidden';
    npBar.removeEventListener('transitionend', handler);
});

// On deactivate (leaving NP screen):
contentArea.classList.remove('np-active');
contentArea.style.overflow = '';
npBar.style.visibility = 'visible';
npBar.classList.remove('np-bar-hidden');
```

CSS:
```css
#content-area.np-active {
    padding-bottom: 0 !important;
    overflow: hidden !important;
}
.np-bar-hidden {
    transform: translateY(calc(100% + 2px));
}
#now-playing-bar {
    transition: transform 0.3s ease;
}
```

RULES:
- Vanilla JS, ES2017. No ?., ??
- Run autonomously.
- Rebuild Sonance.wgt when done.

Test:
- NP screen blur is stronger (100px)
- No black bar at bottom when on NP screen
- Cannot scroll down to reveal hidden NP bar
- Down key only moves between progress and controls
- Leaving NP screen restores the bar smoothly
- No regressions on other screens

Update PROGRESS.md with P6b changes.

You are fixing ONE bug in Sonance v3-1 — a music player app for Samsung Tizen TVs.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read js/app.js — find the Back key handler and the navigation stack (_navStack or similar)
2. Understand how top-level navigation (via top nav) manages the stack

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## THE PROBLEM
Pressing Back from the Now Playing screen shows the exit dialog instead of returning to the previous screen. This happens because Now Playing is a top-level nav item — sliding to it replaces the stack with `[nowplaying]`, so Back sees one item and shows exit.

## THE FIX
Now Playing is unique — users always expect Back to return them to wherever they were before. Unlike Home/Library/Settings where Back means "exit", NP is a temporary view.

**When navigating TO Now Playing (via top nav OR via auto-now-playing):**
Preserve the previous screen in the stack instead of replacing it:

```javascript
function navigateTopLevel(screenId) {
    if (screenId === 'nowplaying') {
        // NP is special — PUSH instead of replace, so Back works
        // Only push if the current top isn't already NP
        if (_navStack.length === 0 || _navStack[_navStack.length - 1].screen !== 'nowplaying') {
            _navStack.push({ screen: 'nowplaying', params: null, type: 'top' });
        }
    } else {
        // All other top-level screens replace the stack
        _navStack = [{ screen: screenId, params: null, type: 'top' }];
    }
    // ... do the slide transition
}
```

**When Back is pressed from Now Playing:**
Pop NP from the stack and return to the previous screen:

```javascript
function handleBackButton() {
    // ... exit dialog check ...
    
    // If on Now Playing, always go back to previous screen
    if (getCurrentScreen() === 'nowplaying') {
        if (_navStack.length > 1) {
            _navStack.pop();  // remove NP
            var prev = _navStack[_navStack.length - 1];
            
            // Show nav bar (NP may have hidden it)
            setNavBarVisible(true);
            
            // Navigate back with slide transition
            var npIndex = getNavIndexForScreen('nowplaying');
            var prevIndex = getNavIndexForScreen(prev.screen);
            var direction = prevIndex < npIndex ? 'right' : 'left';
            navigateToScreen(prev.screen, direction);
            
            // Update pill position
            updatePillPosition(prevIndex, false);
            FocusManager.setActiveZone('topnav');
            setPillState('focused');
        } else {
            // NP was the first screen (e.g. auto-now-playing on app start)
            // Go to Home
            _navStack = [{ screen: 'home', params: null, type: 'top' }];
            setNavBarVisible(true);
            navigateToScreen('home', 'right');
            updatePillPosition(0, false);
            FocusManager.setActiveZone('topnav');
        }
        return;
    }
    
    // ... rest of existing Back handler (sub-pages, exit dialog) ...
}
```

**Also handle auto-now-playing (P15b):**
When `SonanceSettings.autoNowPlaying` triggers navigation to NP after starting a song, it should also push (not replace):

Find where the `userplay` event triggers NP navigation:
```javascript
Player.on('userplay', function() {
    if (SonanceSettings.autoNowPlaying && getCurrentScreen() !== 'nowplaying') {
        // Push NP onto stack (preserves current screen for Back)
        _navStack.push({ screen: 'nowplaying', params: null, type: 'top' });
        navigateToScreen('nowplaying', 'left');
        // Update pill
        var npIndex = getNavIndexForScreen('nowplaying');
        updatePillPosition(npIndex, false);
        setPillState('selected');
    }
});
```

## TESTING

1. [ ] Home → slide to NP → press Back → returns to Home (NOT exit dialog)
2. [ ] Library → slide to NP → press Back → returns to Library
3. [ ] Library → album detail → auto-NP (play a song) → press Back → returns to album detail
4. [ ] Settings → slide to NP → press Back → returns to Settings
5. [ ] NP as first screen after login (auto-NP) → press Back → goes to Home
6. [ ] Home → press Back → exit dialog (unchanged)
7. [ ] Exit dialog → focus is on dialog buttons, not page behind

RULES:
- Vanilla JS, ES2017. No ?., ??
- Run autonomously. Rebuild Sonance.wgt when done.

Update PROGRESS.md.

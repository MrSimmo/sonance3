You are fixing TWO critical bugs in Sonance v3-1 — a music player app for Samsung Tizen TVs.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read js/app.js — find the Back key handler (keyCode 10009 and 27), the navigation function, and any existing nav history/stack code
3. Read js/focus.js — find how key events are dispatched, especially Back
4. Read js/screens/nowplaying.js — find how the NP screen handles showing/hiding

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## BUG 1: Back Button — Navigation Stack Not Working

### The Problem
Pressing Back ALWAYS shows the exit dialog, regardless of what screen the user is on. The exit dialog should ONLY appear when the user is on a top-level screen (Home) with nowhere to go back to.

Additionally, when the exit dialog appears, the remote control focus is stuck on the page behind it — the dialog buttons are not focusable.

### Root Cause
The navigation stack (history) is either not implemented, not being pushed to, or the Back handler isn't reading from it.

### The Fix — Full Navigation Stack Implementation

**Step 1: Find or create the navigation stack**

Search for any existing history/stack variable:
```bash
grep -n 'navHistory\|_navHistory\|navigationStack\|_navigationStack\|history' js/app.js
```

If it exists but isn't working, fix it. If it doesn't exist, create it:

```javascript
var _navStack = [];  // Array of { screen: 'screenId', params: {}, type: 'top'|'sub' }
```

**Step 2: Push to stack on EVERY navigation**

There are TWO types of navigation:

**A) Top-level navigation (via top nav Left/Right slide):**
These are peer screens — they REPLACE the stack base:
```javascript
function navigateTopLevel(screenId) {
    // Replace the stack with just this screen
    _navStack = [{ screen: screenId, params: null, type: 'top' }];
    // ... do the slide transition
}
```

**B) Sub-page navigation (zoom into album, artist, genre, playlist detail):**
These PUSH onto the stack:
```javascript
function navigateToSubPage(screenId, params) {
    _navStack.push({ screen: screenId, params: params, type: 'sub' });
    // ... do the zoom-in transition
}
```

**Step 3: Find ALL places where navigation happens and categorise them**

Search for every navigation call:
```bash
grep -rn 'navigateTo\|zoomInto\|renderScreen\|switchScreen\|showScreen' --include='*.js' js/
```

For each one, determine if it's:
- Top-level (from the top nav bar) → use `navigateTopLevel()`
- Sub-page (Enter on an item) → use `navigateToSubPage()`

Common sub-page navigations:
- Album detail (from Library, Search, Home, Artist discography)
- Artist detail (from Library, Search, Album Detail)
- Genre songs list (from Library genres tab)
- Playlist detail (from Playlists)

**Step 4: Implement the Back handler**

Find where keyCode 10009 (Tizen Back) and 27 (Escape) are handled. Replace the logic:

```javascript
function handleBackButton() {
    // If exit dialog is showing, close it
    if (isExitDialogVisible()) {
        hideExitDialog();
        return;
    }
    
    // If on the Now Playing screen and nav bar is hidden, show it first
    if (getCurrentScreen() === 'nowplaying' && !isNavBarVisible()) {
        setNavBarVisible(true);
        FocusManager.setActiveZone('topnav');
        return;
    }
    
    // If focus is in page content, return to top nav first
    if (FocusManager.getActiveZone() !== 'topnav' && getCurrentScreen() !== 'nowplaying') {
        FocusManager.setActiveZone('topnav');
        setPillState('focused');
        return;
    }
    
    // If there's history to go back to (sub-pages)
    if (_navStack.length > 1) {
        _navStack.pop();  // remove current
        var prev = _navStack[_navStack.length - 1];
        
        // Zoom out to previous screen
        zoomOutToScreen(prev.screen, prev.params);
        
        // Update top nav pill to match the parent screen
        var navIndex = getNavIndexForScreen(prev.screen);
        if (navIndex >= 0) {
            updatePillPosition(navIndex, false);
            // Set correct pill state
            setPillState('selected');
        }
        return;
    }
    
    // Stack is empty or has only one item — show exit dialog
    showExitDialog();
}
```

**Step 5: Fix the exit dialog focus**

The exit dialog must CAPTURE focus when it appears. All page focus should be suspended.

```javascript
function showExitDialog() {
    // Create/show the dialog overlay
    var overlay = document.getElementById('exit-dialog-overlay');
    // ... show it
    
    // CRITICAL: Set a flag that tells the FocusManager to route keys to the dialog
    _exitDialogVisible = true;
    
    // Focus the first dialog button
    var buttons = overlay.querySelectorAll('.exit-dialog-btn');
    if (buttons.length > 0) {
        _exitDialogFocusIndex = 0;
        buttons[0].classList.add('focused');
    }
}

function hideExitDialog() {
    _exitDialogVisible = false;
    var overlay = document.getElementById('exit-dialog-overlay');
    // ... hide it
    // Remove focused class from buttons
}
```

In the KEY EVENT HANDLER (wherever keydown events are processed), add a check at the TOP:
```javascript
document.addEventListener('keydown', function(e) {
    // Exit dialog captures ALL input when visible
    if (_exitDialogVisible) {
        handleExitDialogKey(e);
        e.preventDefault();
        return;
    }
    
    // ... normal key handling
});

function handleExitDialogKey(e) {
    var key = e.keyCode;
    var buttons = document.querySelectorAll('.exit-dialog-btn');
    
    if (key === 37 || key === 39) {  // Left/Right — move between buttons
        buttons[_exitDialogFocusIndex].classList.remove('focused');
        if (key === 39) _exitDialogFocusIndex = Math.min(_exitDialogFocusIndex + 1, buttons.length - 1);
        else _exitDialogFocusIndex = Math.max(_exitDialogFocusIndex - 1, 0);
        buttons[_exitDialogFocusIndex].classList.add('focused');
    }
    
    if (key === 13) {  // Enter — activate focused button
        var btn = buttons[_exitDialogFocusIndex];
        if (btn.dataset.action === 'exit') {
            // Close the app
            if (typeof tizen !== 'undefined') {
                tizen.application.getCurrentApplication().exit();
            }
        } else {
            // Cancel — close dialog
            hideExitDialog();
        }
    }
    
    if (key === 10009 || key === 27) {  // Back — close dialog
        hideExitDialog();
    }
}
```

**Step 6: Helper function to get screen from nav index**

```javascript
function getNavIndexForScreen(screenId) {
    var NAV_ITEMS = ['home', 'library', 'playlists', 'queue', 'nowplaying', 'search', 'settings'];
    return NAV_ITEMS.indexOf(screenId);
}
```

## BUG 2: Now Playing Nav Bar Auto-Hide Is Inconsistent

### The Problem
The nav bar sometimes disappears when sliding to Now Playing, sometimes doesn't after 5 seconds. The timer logic is unreliable.

### The Fix

The auto-hide timer must be:
- Started when the NP screen finishes its transition (not when it starts)
- Cleared on ANY key press
- Restarted on any key press that isn't Down or Back

```javascript
var _npNavTimer = null;

function startNpNavAutoHide() {
    clearNpNavAutoHide();
    _npNavTimer = setTimeout(function() {
        if (getCurrentScreen() === 'nowplaying' && isNavBarVisible()) {
            setNavBarVisible(false);
            setPillState('selected');
            FocusManager.setActiveZone(getNpFirstFocusZone());
        }
    }, 5000);
}

function clearNpNavAutoHide() {
    if (_npNavTimer) {
        clearTimeout(_npNavTimer);
        _npNavTimer = null;
    }
}
```

**When to call `startNpNavAutoHide()`:**
- After the page transition to NP completes (in the setTimeout callback after the transition, ~300ms)
- After the user presses Up from NP content (nav bar reappears)

**When to call `clearNpNavAutoHide()`:**
- When the user presses Down (nav hides immediately)
- When navigating away from NP
- When the user presses Left/Right in the nav (sliding to different screen)

**Key event integration:**
```javascript
// In the keydown handler, when on NP screen and nav is visible:
if (getCurrentScreen() === 'nowplaying' && isNavBarVisible()) {
    clearNpNavAutoHide();
    
    if (e.keyCode === 40) {  // Down
        // Hide nav immediately, enter NP content
        setNavBarVisible(false);
        setPillState('selected');
        FocusManager.setActiveZone(getNpFirstFocusZone());
        e.preventDefault();
        return;
    }
    
    // Any other key while nav is showing on NP: restart the timer
    startNpNavAutoHide();
}
```

## HARDWARE ACCELERATION REMINDER
- ONLY animate `transform` and `opacity`
- NEVER use `transition: all`

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- DO NOT modify player.js, api.js, auth.js, starred.js, utils.js, config.xml
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Back button flow (CRITICAL — test every path):
1. [ ] Home → press Back → exit dialog appears
2. [ ] Exit dialog → Left/Right moves between buttons, focus is ON the dialog
3. [ ] Exit dialog → Enter on "Cancel" → dialog closes, app stays
4. [ ] Exit dialog → press Back → dialog closes
5. [ ] Library → click album → Album Detail → press Back → zooms back to Library (NOT exit dialog)
6. [ ] Library → album → artist → press Back → zooms to album → press Back → zooms to Library → press Back → exit dialog
7. [ ] Slide to Settings via nav → press Back → exit dialog (top-level, nowhere to go)
8. [ ] Slide to Queue → press Down into queue → press Back → returns focus to nav bar → press Back → exit dialog

### NP nav bar:
9. [ ] Slide to Now Playing → nav bar stays visible
10. [ ] Wait 5 seconds → nav bar fades away
11. [ ] Slide to NP → press Down before 5s → nav hides immediately
12. [ ] On NP with nav hidden → press Up → nav reappears
13. [ ] NP nav reappears → wait 5s → hides again
14. [ ] NP nav visible → press Left → slides to Queue (nav stays, timer resets)

Update PROGRESS.md.

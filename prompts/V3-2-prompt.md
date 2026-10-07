You are performing a major UI redesign on Sonance — a music player app for Samsung Tizen TVs. This is V3-2: Zoom Transitions.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — V3-1 (top nav bar) must be complete
3. Read js/app.js — understand the page transition system from V3-1
4. Read js/focus.js — understand how Enter/Back are handled
5. Read js/screens/login.js — understand the login flow

## FEATURE: Zoom Transitions

Three types of zoom animation:

### 1. Zoom-In: Select an Item → Enter Sub-Page

When the user presses Enter/Select on an item (album card, artist card, genre card, search result, playlist), the screen zooms into the new page. This replaces the current instant page swap.

**Animation (outgoing):**
- The current page scales up slightly and fades out: `transform: scale(1.08); opacity: 0;`
- Duration: 0.25s ease

**Animation (incoming sub-page):**
- Starts scaled down and transparent: `transform: scale(0.92); opacity: 0;`
- Transitions to: `transform: scale(1); opacity: 1;`
- Duration: 0.25s ease

Both use ONLY `transform` and `opacity` — fully GPU-accelerated.

**Implementation:**

Add a new transition function alongside the existing `navigateToScreen` (which handles left/right slide for top nav):

```javascript
function zoomIntoScreen(screenId) {
    var current = document.getElementById('page-current');
    var incoming = document.getElementById('page-incoming');
    
    // Set incoming initial state
    incoming.style.transition = 'none';
    incoming.style.transform = 'scale(0.92)';
    incoming.style.opacity = '0';
    incoming.style.pointerEvents = 'none';
    
    // Render new screen
    renderScreen(screenId, incoming);
    
    // Force reflow
    incoming.offsetHeight;
    
    // Animate
    current.style.transition = 'transform 0.25s ease, opacity 0.2s ease';
    incoming.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    
    current.style.transform = 'scale(1.08)';
    current.style.opacity = '0';
    incoming.style.transform = 'scale(1)';
    incoming.style.opacity = '1';
    incoming.style.pointerEvents = 'auto';
    
    // After transition, swap layers
    setTimeout(function() {
        current.innerHTML = incoming.innerHTML;
        current.style.transition = 'none';
        current.style.transform = 'scale(1)';
        current.style.opacity = '1';
        current.style.pointerEvents = 'auto';
        
        incoming.innerHTML = '';
        incoming.style.transition = 'none';
        incoming.style.transform = 'scale(1)';
        incoming.style.opacity = '0';
        incoming.style.pointerEvents = 'none';
        
        _currentScreen = screenId;
        _navigationStack.push(screenId);
    }, 300);
}
```

### 2. Zoom-Out: Press Back → Return to Previous Page

When the user presses Back on a sub-page (album detail, artist detail, genre songs), the screen zooms back out to the parent page.

**Animation (outgoing sub-page):**
- Scales down and fades: `transform: scale(0.92); opacity: 0;`
- Duration: 0.2s ease

**Animation (incoming parent page):**
- Starts scaled up: `transform: scale(1.08); opacity: 0;`
- Transitions to: `transform: scale(1); opacity: 1;`
- Duration: 0.25s ease

```javascript
function zoomOutToScreen(screenId) {
    var current = document.getElementById('page-current');
    var incoming = document.getElementById('page-incoming');
    
    // Set incoming initial state (zoomed in, like we're "behind" the current page)
    incoming.style.transition = 'none';
    incoming.style.transform = 'scale(1.08)';
    incoming.style.opacity = '0';
    incoming.style.pointerEvents = 'none';
    
    // Render parent screen
    renderScreen(screenId, incoming);
    
    incoming.offsetHeight;
    
    // Animate
    current.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    incoming.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    
    current.style.transform = 'scale(0.92)';
    current.style.opacity = '0';
    incoming.style.transform = 'scale(1)';
    incoming.style.opacity = '1';
    incoming.style.pointerEvents = 'auto';
    
    setTimeout(function() {
        current.innerHTML = incoming.innerHTML;
        current.style.transition = 'none';
        current.style.transform = 'scale(1)';
        current.style.opacity = '1';
        current.style.pointerEvents = 'auto';
        
        incoming.innerHTML = '';
        incoming.style.transition = 'none';
        incoming.style.transform = 'scale(1)';
        incoming.style.opacity = '0';
        incoming.style.pointerEvents = 'none';
        
        _currentScreen = screenId;
    }, 300);
}
```

### 3. Navigation Stack

Maintain a stack to know where to zoom back to:

```javascript
var _navigationStack = [];

// When zooming into a sub-page:
_navigationStack.push({ screen: currentScreenId, scrollPos: getCurrentScrollPos() });

// When pressing Back:
function goBack() {
    if (_navigationStack.length > 0) {
        var prev = _navigationStack.pop();
        zoomOutToScreen(prev.screen);
        // Optionally restore scroll position after transition
    }
}
```

**Which screens are "sub-pages" (zoom in/out):**
- Album Detail (entered from Library, Search, Artist, Home)
- Artist Detail (entered from Library, Search, Album)
- Genre songs list (entered from Library genres tab)
- Playlist detail (entered from Playlists)

**Which screens use slide transitions (top nav):**
- Home, Library, Playlists, Queue, Now Playing, Search, Settings
- These are TOP-LEVEL screens — they use the left/right slide from V3-1

**Rule:** Top nav Left/Right = slide transition. Enter on an item = zoom in. Back from a sub-page = zoom out.

### 4. Login → Home Zoom

After successful login, the login screen zooms into the home page:

```javascript
// In login success handler:
function onLoginSuccess() {
    var loginScreen = document.getElementById('login-container'); // or wherever login is rendered
    
    // Animate login screen zooming in (as if the user is diving through it)
    loginScreen.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
    loginScreen.style.transform = 'scale(1.15)';
    loginScreen.style.opacity = '0';
    
    setTimeout(function() {
        // Remove login, show app shell with home screen
        showAppShell();
        
        // The home screen fades in from scale(0.95)
        var pageContainer = document.getElementById('page-current');
        pageContainer.style.transition = 'none';
        pageContainer.style.transform = 'scale(0.95)';
        pageContainer.style.opacity = '0';
        
        pageContainer.offsetHeight;
        
        pageContainer.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        pageContainer.style.transform = 'scale(1)';
        pageContainer.style.opacity = '1';
    }, 350);
}
```

### 5. Where to Trigger Zoom vs Slide

Update all navigation calls in the codebase:

**Zoom IN (Enter on items):**
- `js/screens/library.js` — clicking an album card, artist card, genre → `zoomIntoScreen('album', { id: ... })`
- `js/screens/search.js` — clicking a search result → `zoomIntoScreen('album/artist', { id: ... })`
- `js/screens/home.js` — clicking hero album, recently played item → `zoomIntoScreen('album', { id: ... })`
- `js/screens/artist.js` — clicking an album in discography → `zoomIntoScreen('album', { id: ... })`
- `js/screens/artist.js` — clicking a similar artist → `zoomIntoScreen('artist', { id: ... })`
- `js/screens/playlists.js` — clicking a playlist → `zoomIntoScreen('playlist-detail', { id: ... })`

**Zoom OUT (Back button):**
- `js/screens/album.js` — Back button → `goBack()` (zoom out to parent)
- `js/screens/artist.js` — Back button → `goBack()`
- Genre songs — Back → `goBack()`

**Slide (top nav):**
- All top-level nav transitions — handled by V3-1's `navigateToScreen()`

### 6. Prevent Double Transitions

Add a lock to prevent rapid presses from triggering overlapping transitions:

```javascript
var _transitioning = false;

function zoomIntoScreen(screenId, params) {
    if (_transitioning) return;
    _transitioning = true;
    // ... animation code ...
    setTimeout(function() {
        _transitioning = false;
    }, 300);
}
```

Apply the same lock to `zoomOutToScreen` and `navigateToScreen`.

## DO NOT MODIFY — PROTECTED FILES
These files contain working audio, API, and authentication logic. DO NOT change them in this patch:
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client
- `js/auth.js` — authentication manager
- `js/starred.js` — favourites cache
- `js/utils.js` — pagination, helpers
- `config.xml` — Tizen widget configuration and privileges

If you need to call functions FROM these files, that's fine. But do not edit the files themselves.

## HARDWARE ACCELERATION — MANDATORY
ALL animations MUST be GPU-composited. The TV GPU handles `transform` and `opacity` only:
- ✅ `transform` (translateX, translateY, scale) and `opacity` — GPU-composited
- ❌ `width`, `height`, `margin`, `padding`, `left`, `right`, `font-size` — CPU layout reflow, NEVER transition these
- ❌ `transition: all` — NEVER use this

Every `transition` must EXPLICITLY list only `transform` and/or `opacity`.
Properties like `color` or `background` should snap instantly with no transition.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- ONLY animate `transform` and `opacity` — NEVER layout properties
- `will-change: transform, opacity` on page layers
- Duration: 0.2-0.3s (keep it snappy on the TV)
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
1. Home → click an album → ZOOM IN to Album Detail (scale up + fade)
2. Album Detail → press Back → ZOOM OUT to Home (scale down + fade)
3. Library → Artists → click artist → ZOOM IN to Artist Detail
4. Artist Detail → Back → ZOOM OUT to Library
5. Artist Detail → click album → ZOOM IN to Album Detail (stacks!)
6. Album Detail → Back → ZOOM OUT to Artist Detail
7. Artist Detail → Back → ZOOM OUT to Library
8. Top nav Left/Right → SLIDE transition (not zoom)
9. Login → enter credentials → success → ZOOM into Home
10. No overlapping transitions on rapid pressing
11. All transitions are smooth (GPU-only)

Update PROGRESS.md.

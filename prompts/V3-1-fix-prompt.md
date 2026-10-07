You are fixing issues with Sonance v3-1 — a music player app for Samsung Tizen TVs. There are 8 bugs to fix from the top nav bar implementation.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read js/app.js — the nav bar, page transition, and routing code
4. Read js/focus.js — the topnav zone and page zone handling
5. Read js/screens/nowplaying.js — the Now Playing screen
6. Read css/styles.css — top nav bar styles

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## BUG 1: Now Playing — nav bar disappears immediately when sliding onto it

**Problem:** When the user slides Left/Right in the top nav to "Now Playing", the nav bar hides immediately. It should stay visible until the user presses Down or 5 seconds elapse.

**Fix:**
- Do NOT hide the nav bar when the Now Playing screen loads via top nav slide
- Only hide the nav bar when:
  a) The user presses Down from the top nav while on Now Playing (entering the NP content), OR
  b) 5 seconds elapse after sliding to Now Playing with no input
- When the nav bar auto-hides after 5s, change the pill to "selected" state (as if the user pressed Down)
- If the user presses Up from the NP screen, show the nav bar and return focus to it

```javascript
var _navAutoHideTimer = null;

function onNavigateToScreen(screenId) {
    if (screenId === 'nowplaying') {
        // Keep nav bar visible, start auto-hide timer
        setNavBarVisible(true);
        clearTimeout(_navAutoHideTimer);
        _navAutoHideTimer = setTimeout(function() {
            setNavBarVisible(false);
            setPillState('selected');
        }, 5000);
    } else {
        clearTimeout(_navAutoHideTimer);
        setNavBarVisible(true);
    }
}

// When user presses Down from nav while on NP:
if (currentScreen === 'nowplaying' && direction === 'down') {
    clearTimeout(_navAutoHideTimer);
    setNavBarVisible(false);
    setPillState('selected');
    // Move focus to NP controls
}

// When user presses Up from NP screen:
// Show nav bar, clear auto-hide, return focus to topnav
```

## BUG 2: Pill highlight vs selected states are inverted

**Problem:** The pill shows accent colour when selected (in page content) and grey/light when highlighted (nav focused). Should be the opposite.

**Fix:** Swap the styles:

```css
/* FOCUSED state (nav bar is active, user is browsing nav items) = ACCENT */
#top-nav-pill.focused {
    background: rgba(var(--accent-rgb), 0.4);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

/* SELECTED state (user has pressed Down into page content) = GREY/SUBTLE */
#top-nav-pill.selected {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: none;
}
```

This means: when you're actively choosing in the nav bar, the pill is accent-coloured (attention here). When you've made your choice and entered the page, the pill becomes a subtle grey indicator (attention is on the page now).

## BUG 3: Library sub-nav is top-left instead of left-side with content to the right

**Problem:** The Albums/Artists/Songs/Genres menu appears at the top-left below the nav bar instead of as a vertical menu on the left with content to its right.

**Note:** The full library sub-nav redesign is V3-3, but V3-1 should at least have the tabs working in their CURRENT horizontal position without breaking. If V3-1 moved them incorrectly, fix the layout:

**Quick fix for V3-1:** Keep the library tabs as a horizontal row at the top of the library content area (same as v2 but without the sidebar offset). The V3-3 phase will convert them to a vertical pill menu later.

```css
.library-tabs {
    display: flex;
    padding: 0 48px 16px;
    max-width: 1400px;
    margin: 0 auto;
}

.library-tabs .tab-item {
    padding: 8px 20px;
    margin-right: 8px;  /* NOT flex gap */
    font-size: 15px;
    color: rgba(255, 255, 255, 0.6);
    border-radius: 20px;
    cursor: pointer;
}

.library-tabs .tab-item.active {
    color: white;
    background: rgba(var(--accent-rgb), 0.3);
}
```

Also ensure the library content (album grid etc.) has a sliding/cross-fade effect when switching tabs — see Bug 6.

## BUG 4: Top nav pill is offset — text not centred in pill

**Problem:** The nav item text isn't centred within the sliding pill. The pill appears slightly too far left.

**Fix:** The pill position calculation is likely not accounting for the item's padding or the bar's padding. Fix the `updatePillPosition` function:

```javascript
function updatePillPosition(itemIndex, animate) {
    var item = navItemElements[itemIndex];
    if (!item) return;
    var pill = document.getElementById('top-nav-pill');
    var bar = document.getElementById('top-nav-bar');
    
    // Get item position relative to the bar
    var itemRect = item.getBoundingClientRect();
    var barRect = bar.getBoundingClientRect();
    var itemLeft = itemRect.left - barRect.left;
    var itemWidth = itemRect.width;
    
    pill.style.width = itemWidth + 'px';
    
    if (animate) {
        pill.style.transition = 'transform 0.25s ease, width 0.25s ease';
    } else {
        pill.style.transition = 'none';
    }
    
    pill.style.transform = 'translateX(' + itemLeft + 'px)';
}
```

Using `getBoundingClientRect()` gives the actual rendered position including padding, which `offsetLeft` sometimes misses. This should centre the pill perfectly under the text.

## BUG 5: Top nav bar background too dark

**Problem:** The nav bar background is too dark, blends into the page background.

**Fix:** Brighten the bar background:

```css
#top-nav-bar {
    background: rgba(50, 50, 60, 0.85);  /* was rgba(30, 30, 38, 0.80) */
}
```

This gives it slightly more contrast against the `#1a1a24` page background without being too bright.

## BUG 6: Library page has no slide transition

**Problem:** When navigating to the Library screen via the top nav, the page just appears instead of sliding in.

**Fix:** Ensure the Library screen goes through the same `navigateToScreen()` transition as every other screen. Check:

1. Is the Library case handled in the navigation function?
2. Is the Library screen rendering into `#page-incoming` (for transition) or directly into `#page-current` (bypassing transition)?
3. Does the Library screen's render function complete synchronously? If it makes async API calls and renders later, it might miss the transition.

If the Library makes async calls, render a loading placeholder first (synchronously, so the transition works), then populate with data when it arrives:

```javascript
function renderLibrary(container) {
    // Render structure immediately (sync) — transition happens on this
    container.innerHTML = '<div class="page-content">' +
        '<div class="library-tabs">...</div>' +
        '<div class="library-content loading-placeholder">Loading...</div>' +
        '</div>';
    
    // Then fetch data and populate
    loadLibraryData().then(function(data) {
        var content = container.querySelector('.library-content');
        content.innerHTML = ''; // replace placeholder
        renderAlbumGrid(data.albums, content);
        content.classList.remove('loading-placeholder');
    });
}
```

## BUG 7: Now Playing screen is completely blank (CRITICAL)

**Problem:** The Now Playing screen renders as a blank screen. This is the most critical bug.

**Diagnosis steps:**
1. Open browser console, navigate to Now Playing
2. Check for JavaScript errors
3. Check if the NP screen's `render()` function is being called
4. Check if it's rendering into the correct container

**Likely causes:**

**Cause A: Rendering into wrong container**
V3-1 changed from `#content-area` to `#page-current`/`#page-incoming`. The NP screen may still be trying to render into `#content-area` which no longer exists.

Fix: ensure the NP screen renders into the container passed to it by the page transition system, not a hardcoded element ID.

**Cause B: NP screen hides nav bar + adjusts layout, breaking the container**
The NP screen likely has code like:
```javascript
document.getElementById('content-area').style.top = '0';
```
These references are now stale. The NP screen needs to work within `#page-current` or `#page-incoming`.

Fix: update the NP screen to work with the new container system. When NP activates:
- The page container should expand to fill the full height (top: 0 instead of 80px)
- The nav bar hides (handled by Bug 1 fix above)
- The NP content renders into the page layer

**Cause C: NP screen expects specific DOM structure**
The NP screen may query for elements by ID (e.g. `document.getElementById('np-album-art')`) that aren't in the DOM yet because the transition system renders into a different container.

Fix: ensure the NP screen uses `container.querySelector()` (relative to its container) instead of `document.getElementById()` (global).

**Investigation approach:**
1. Add `console.log('[NP] render called, container:', container)` at the start of the NP render function
2. Add `console.log('[NP] container innerHTML length:', container.innerHTML.length)` after rendering
3. Check if `container` is null or the wrong element
4. Check if any JS error stops execution partway through render

**Fix what you find.** The NP screen is complex (lyrics, star, progress bar, transport controls) — take care not to break any functionality. Only fix the rendering/container issue.

## BUG 8: Back button always shows exit dialog (CRITICAL)

**Problem:** Pressing Back always shows the exit dialog instead of navigating back through the screen history. The exit dialog should only appear when the user is on the Home screen with no history to go back to.

**Fix:** Implement a proper navigation stack:

```javascript
var _navHistory = [];  // stack of { screen, params, scrollPos }

// When navigating forward (from top nav or zoom-in):
function pushToHistory(screenId, params) {
    _navHistory.push({
        screen: screenId,
        params: params || null
    });
}

// When Back is pressed:
function handleBack() {
    // If on a sub-page (album detail, artist detail, etc.), zoom out
    if (_navHistory.length > 1) {
        _navHistory.pop();  // remove current
        var prev = _navHistory[_navHistory.length - 1];
        zoomOutToScreen(prev.screen, prev.params);
        
        // Update the top nav pill to match the parent screen
        var navIndex = getNavIndexForScreen(prev.screen);
        if (navIndex >= 0) {
            updatePillPosition(navIndex, false);
        }
        return;
    }
    
    // If on a top-level screen (Home), show exit dialog
    if (_navHistory.length <= 1) {
        showExitDialog();
        return;
    }
}
```

**Navigation stack management:**
- When navigating via top nav (Left/Right slide): REPLACE the stack (don't push). Top-level screens are peers, not nested:
  ```javascript
  function navigateViaTopNav(screenId) {
      _navHistory = [{ screen: screenId }];  // reset stack to just this screen
      navigateToScreen(screenId, direction);
  }
  ```
- When zooming into a sub-page (Enter on item): PUSH onto stack:
  ```javascript
  function zoomIntoSubPage(screenId, params) {
      pushToHistory(screenId, params);
      zoomIntoScreen(screenId, params);
  }
  ```
- When pressing Back: POP from stack and navigate to the previous entry

**Example flow:**
```
User action                     Stack state
─────────────────────────────────────────────
App loads → Home                [Home]
Slide to Library                [Library]          ← replaced, not pushed
Press Down, click album         [Library, Album]   ← pushed
Click artist name               [Library, Album, Artist]  ← pushed
Press Back                      [Library, Album]   ← popped, zoom out to Album
Press Back                      [Library]          ← popped, zoom out to Library
Press Back                      → EXIT DIALOG      ← stack has 1 item (top-level), show exit
```

**Wire into the Back key handler:**
Find where keyCode 10009 (Tizen Back) and 27 (Escape) are handled. Replace the current logic with `handleBack()`.

## HARDWARE ACCELERATION REMINDER
- ONLY animate `transform` and `opacity`
- NEVER use `transition: all`
- Keep durations 0.12-0.25s

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- DO NOT modify player.js, api.js, auth.js, starred.js, utils.js, config.xml
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

All 8 bugs must be verified fixed:
1. [ ] Slide to Now Playing → nav bar stays visible for 5 seconds, then fades
2. [ ] Press Down on NP → nav bar hides immediately
3. [ ] Press Up from NP → nav bar reappears
4. [ ] Pill is ACCENT when focused (browsing nav), GREY when selected (in page)
5. [ ] Library tabs are horizontal at top of content area (vertical comes in V3-3)
6. [ ] Pill text is centred within the pill on all items
7. [ ] Nav bar background is slightly brighter than page background
8. [ ] Library page slides in with transition when navigated to
9. [ ] Now Playing screen renders correctly (album art, controls, lyrics, progress)
10. [ ] Play/Pause works on NP screen
11. [ ] Lyrics toggle works on NP screen
12. [ ] Back from Album Detail → returns to Library (zoom out)
13. [ ] Back from Artist Detail → returns to previous screen (zoom out)
14. [ ] Back from Home → shows exit dialog
15. [ ] Full flow: Home → Library → Album → Artist → Back → Album → Back → Library → Back → Exit dialog

### Functional regression:
- [ ] Audio playback works
- [ ] Gapless works
- [ ] Star/unstar works
- [ ] Queue colour buttons work
- [ ] Settings persist
- [ ] No `transition: all` — run: `grep -rn 'transition.*all' css/styles.css js/`

Update PROGRESS.md.

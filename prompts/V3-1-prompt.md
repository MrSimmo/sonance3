You are performing a major UI redesign on Sonance — a music player app for Samsung Tizen TVs. This is V3-1: Replace the left sidebar with a floating top navigation bar.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints (NO flex gap, NO backdrop-filter, NO ?., etc.)
2. Read PROGRESS.md
3. Read tickets/V3-1-top-nav.md — the full design spec
4. Read js/app.js — understand the current sidebar rendering and routing
5. Read js/focus.js — understand the sidebar focus zone
6. Read index.html — understand the current DOM structure
7. Read css/styles.css — understand the sidebar styles

## THIS IS A MAJOR ARCHITECTURAL CHANGE
This replaces the sidebar navigation with a top nav bar. Take your time, plan carefully, and test thoroughly.

## Part 1: Global Changes

### Background and Font
Update the root styles:
```css
:root {
    --bg-main: #1a1a24;
}

body {
    font-family: 'SamsungOne', 'SamsungOneUIFW', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-main);
}
```

### Remove Sidebar
- Delete the `#sidebar` element from `index.html`
- Delete ALL sidebar CSS from `styles.css` (search for `sidebar`, `.sidebar`, `#sidebar`)
- Delete sidebar rendering code from `js/app.js`
- Delete the `sidebar` focus zone from `js/focus.js`
- Remove any `content-area` left offset/margin that was making room for the sidebar

## Part 2: Top Navigation Bar

### DOM Structure
Add to `index.html` (or render in `js/app.js` after login):

```html
<div id="top-nav" style="display:none;">
    <div id="top-nav-bar">
        <div id="top-nav-pill"></div>
        <div class="top-nav-items">
            <!-- Items rendered by JS -->
        </div>
    </div>
</div>
```

### Render Nav Items in JS
```javascript
var NAV_ITEMS = [
    { id: 'home', label: 'Home', type: 'text' },
    { id: 'library', label: 'Library', type: 'text' },
    { id: 'playlists', label: 'Playlists', type: 'text' },
    { id: 'queue', label: 'Queue', type: 'text' },
    { id: 'nowplaying', label: 'Now Playing', type: 'text' },
    { id: 'search', label: null, type: 'icon', icon: 'search' },
    { id: 'settings', label: null, type: 'icon', icon: 'settings' }
];
```

Each item is a `<div class="top-nav-item" data-screen="{id}">` containing either text or an SVG icon.

### CSS
```css
#top-nav {
    position: fixed;
    top: 24px;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    pointer-events: none;
}

#top-nav-bar {
    position: relative;
    display: inline-flex;
    align-items: center;
    background: rgba(30, 30, 38, 0.80);
    border-radius: 25px;
    padding: 4px 6px;
    pointer-events: auto;
}

.top-nav-item {
    position: relative;
    z-index: 2;
    padding: 8px 20px;
    font-size: 15px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    transition: color 0.15s ease;
    margin: 0 2px;  /* NOT flex gap */
}

.top-nav-item.focused {
    color: white;
    font-weight: 600;
}

.top-nav-item.selected {
    color: white;
    font-weight: 600;
}

/* Sliding pill highlight */
#top-nav-pill {
    position: absolute;
    top: 4px;
    left: 0;
    height: calc(100% - 8px);
    border-radius: 20px;
    z-index: 1;
    transition: transform 0.25s ease, width 0.25s ease;
    will-change: transform, width;
    pointer-events: none;
}

/* Focused state (nav bar active) — light pill with shadow */
#top-nav-pill.focused {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

/* Selected state (user is in page content) — accent tint, no shadow */
#top-nav-pill.selected {
    background: rgba(var(--accent-rgb), 0.4);
    box-shadow: none;
}
```

### Pill Positioning
The pill slides to match the focused nav item. Calculate its position based on the item's `offsetLeft` and `offsetWidth`:

```javascript
function updatePillPosition(itemIndex, animate) {
    var item = navItemElements[itemIndex];
    if (!item) return;
    var pill = document.getElementById('top-nav-pill');
    var barRect = document.getElementById('top-nav-bar');
    
    // Position relative to the bar
    var itemLeft = item.offsetLeft;
    var itemWidth = item.offsetWidth;
    
    pill.style.width = itemWidth + 'px';
    
    if (animate) {
        pill.style.transition = 'transform 0.25s ease, width 0.25s ease';
    } else {
        pill.style.transition = 'none';
    }
    
    pill.style.transform = 'translateX(' + itemLeft + 'px)';
}
```

## Part 3: Page Container with Transitions

### DOM Structure
Replace the current `#content-area` with a transition-capable container:

```html
<div id="page-container">
    <div id="page-current" class="page-layer"></div>
    <div id="page-incoming" class="page-layer" style="opacity:0;pointer-events:none;"></div>
</div>
```

```css
#page-container {
    position: fixed;
    top: 80px;       /* clear the nav bar */
    left: 0;
    right: 0;
    bottom: 76px;    /* clear the NP bar */
    overflow: hidden;
}

.page-layer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow-y: auto;
    overflow-x: hidden;
    will-change: transform, opacity;
}
```

### Page Transition Logic

```javascript
function navigateToScreen(screenId, direction) {
    // direction: 'left' (going to a screen to the right) or 'right' (going to a screen to the left)
    
    var current = document.getElementById('page-current');
    var incoming = document.getElementById('page-incoming');
    
    // Determine slide direction
    var slideOut = direction === 'left' ? -60 : 60;   // current page slides out
    var slideIn = direction === 'left' ? 60 : -60;     // incoming page starts offset
    
    // Set incoming initial state (no transition yet)
    incoming.style.transition = 'none';
    incoming.style.transform = 'translateX(' + slideIn + 'px)';
    incoming.style.opacity = '0';
    incoming.style.pointerEvents = 'none';
    
    // Render new screen into incoming
    renderScreen(screenId, incoming);
    
    // Force reflow to apply initial state before animating
    incoming.offsetHeight;
    
    // Animate both layers
    current.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    incoming.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    
    // Trigger transitions
    current.style.transform = 'translateX(' + slideOut + 'px)';
    current.style.opacity = '0';
    incoming.style.transform = 'translateX(0)';
    incoming.style.opacity = '1';
    incoming.style.pointerEvents = 'auto';
    
    // After transition, swap layers
    setTimeout(function() {
        // Move incoming content to current layer
        current.innerHTML = incoming.innerHTML;
        current.style.transition = 'none';
        current.style.transform = 'translateX(0)';
        current.style.opacity = '1';
        current.style.pointerEvents = 'auto';
        
        // Reset incoming
        incoming.innerHTML = '';
        incoming.style.transition = 'none';
        incoming.style.transform = 'translateX(0)';
        incoming.style.opacity = '0';
        incoming.style.pointerEvents = 'none';
        
        _currentScreen = screenId;
    }, 250);
}
```

**IMPORTANT:** The transition uses ONLY `transform` and `opacity` — fully GPU-accelerated. No layout properties animated.

## Part 4: Auto-Navigate on Nav Slide

When Left/Right is pressed in the top nav zone:
1. Move focus to next/previous nav item
2. Slide the pill to that item
3. IMMEDIATELY trigger page navigation with the cross-fade transition
4. The page transition happens simultaneously with the pill slide

```javascript
// In the topnav focus zone handler:
onKey: function(direction) {
    if (direction === 'left') {
        navIndex = (navIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;  // wrap
    } else if (direction === 'right') {
        navIndex = (navIndex + 1) % NAV_ITEMS.length;  // wrap
    } else if (direction === 'down') {
        // Enter page content
        setPillState('selected');
        FocusManager.setActiveZone(getPageFirstZone());
        return true;
    }
    
    // Update pill and navigate
    updateNavFocus(navIndex);
    var slideDirection = direction === 'right' ? 'left' : 'right';
    navigateToScreen(NAV_ITEMS[navIndex].id, slideDirection);
    return true;
}
```

### Pressing Up to Return to Nav
When the user is at the top of any page content and presses Up:
```javascript
// In page content zone, when Up is pressed and at the top:
if (atTopOfPage && direction === 'up') {
    FocusManager.setActiveZone('topnav');
    setPillState('focused');
    return true;
}
```

## Part 5: FocusManager Updates

### Remove sidebar zone
Delete the entire `sidebar` zone definition and all related code.

### Add topnav zone
```javascript
FocusManager.addZone('topnav', {
    selector: '.top-nav-item',
    orientation: 'horizontal',
    wrap: true,   // Right from last item → first item
    onFocus: function(element, index) {
        navIndex = index;
        updatePillPosition(index, true);
        // Update item classes
        navItemElements.forEach(function(el, i) {
            el.classList.toggle('focused', i === index);
        });
    },
    onActivate: function(element, index) {
        // Enter is pressed — same as pressing Down (enter page content)
        setPillState('selected');
        FocusManager.setActiveZone(getPageFirstZone());
    },
    onKey: function(direction, element, index) {
        if (direction === 'down') {
            setPillState('selected');
            // Move focus to the page's first zone
            FocusManager.setActiveZone(getPageFirstZone());
            return true;
        }
        if (direction === 'left' || direction === 'right') {
            // Auto-navigate: move pill + transition page
            var newIndex = direction === 'right' 
                ? (index + 1) % NAV_ITEMS.length 
                : (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
            
            FocusManager.focusIndex('topnav', newIndex);
            var slideDir = direction === 'right' ? 'left' : 'right';
            navigateToScreen(NAV_ITEMS[newIndex].id, slideDir);
            return true;  // consumed
        }
        return false;
    }
});
```

### Update all page zones
Every screen's focus zones need updating:
- When Up is pressed at the topmost row → return focus to `topnav`
- Remove any sidebar-related navigation (Left from first column → sidebar)

## Part 6: Content Layout — Centred

All page content should now be centred within the full 1920px width:

```css
.page-content {
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 48px;
}
```

Each screen's render function should wrap its content in a `.page-content` container. This replaces the old offset-from-sidebar layout.

## Part 7: Hide Nav Bar on Certain Screens

The nav bar should be hidden on:
- Login screen (before app shell loads)
- Now Playing screen (when navigated to directly — the full-screen NP view)
- Visualiser screen (if re-added)

```javascript
function setNavBarVisible(visible) {
    var nav = document.getElementById('top-nav');
    if (nav) {
        nav.style.display = visible ? '' : 'none';
    }
    // Adjust page container top
    var container = document.getElementById('page-container');
    if (container) {
        container.style.top = visible ? '80px' : '0';
    }
}
```

Call `setNavBarVisible(false)` when entering NP/login, `setNavBarVisible(true)` when leaving.

## Part 8: Now Playing Bar (Unchanged)

The NP bar stays at the bottom. Its width was previously offset by the sidebar — now it should span the full width:
- Remove any `left` offset or margin that made room for the sidebar
- `left: 0; right: 0; width: 100%;`

## DO NOT MODIFY — PROTECTED FILES
These files contain working audio, API, and authentication logic. DO NOT change them in this patch:
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client
- `js/auth.js` — authentication manager
- `js/starred.js` — favourites cache
- `js/utils.js` — pagination, helpers
- `config.xml` — Tizen widget configuration and privileges

If you need to call functions FROM these files (e.g. `Player.getState()`, `navigateTo()`), that's fine. But do not edit the files themselves.

## HARDWARE ACCELERATION — MANDATORY
The Samsung Q90R (Tizen 5.0) has a weak CPU but a capable GPU. ALL animations MUST be GPU-composited:
- ✅ `transform` (translateX, translateY, scale) — GPU-composited
- ✅ `opacity` — GPU-composited
- ❌ `width`, `height`, `margin`, `padding`, `left`, `right`, `top`, `bottom` — triggers CPU layout reflow
- ❌ `font-size`, `font-weight`, `line-height` — triggers CPU text layout
- ❌ `background-color`, `color`, `border` — triggers CPU paint (snap these instantly, no transition)
- ❌ `transition: all` — catches layout properties, NEVER use this

Every `transition` declaration must EXPLICITLY list only `transform` and/or `opacity`:
```css
transition: transform 0.25s ease, opacity 0.2s ease;  /* CORRECT */
transition: all 0.3s ease;                              /* NEVER */
```

If a property like `color` or `background` needs to change, let it SNAP instantly (no transition on it). Only the movement (`transform`) and visibility (`opacity`) should animate.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin.
- ONLY animate `transform` and `opacity` — NEVER `transition: all`
- `will-change: transform, opacity` on animated elements
- `SamsungOne` font — system font on Tizen, fallback in browser
- Use `grid-gap` not `gap` for grids
- NO `backdrop-filter`
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
1. App loads → top nav bar visible, centred, with pill on "Home"
2. Press Right → pill slides to "Library", page cross-fades to Library
3. Press Right again → pill slides to "Playlists", page transitions
4. Continue through all 7 nav items — wraps from ⚙ back to Home
5. Press Left from Home → wraps to ⚙
6. Press Down → pill changes to accent tint (selected), focus moves to page content
7. Navigate page content normally
8. Press Up at top of page → focus returns to nav bar, pill changes back to light (focused)
9. No sidebar visible anywhere
10. NP bar spans full width
11. Page transitions are smooth (no jank, GPU-only animations)
12. All pages render with centred content
13. Now Playing screen hides the nav bar
14. Login screen has no nav bar

### Verify no regressions:
- [ ] Play a track → audio plays, NP bar updates
- [ ] Play/Pause, Next, Previous all work
- [ ] Gapless playback: tracks auto-advance
- [ ] Synced lyrics: toggle works, lines scroll
- [ ] Star/unstar: works on albums and tracks
- [ ] Queue management: Yellow/Blue/Red colour buttons work
- [ ] Settings: lyrics offset, accent colour, auto NP all work
- [ ] Search: keyboard works, results clickable
- [ ] All screens render correctly (Home, Library, Search, Album Detail, Artist, Playlists, Queue, NP, Settings)
- [ ] No `transition: all` — run: `grep -rn 'transition.*all' css/styles.css js/`
- [ ] No flex `gap` — run: `grep -rn '[^-]gap:' css/styles.css | grep -v 'grid-gap'`

Update PROGRESS.md.

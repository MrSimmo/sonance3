You are performing a major UI redesign on Sonance — a music player app for Samsung Tizen TVs. This is V3-3: Library Sub-Navigation Pill Menu.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — V3-1 and V3-2 must be complete
3. Read js/screens/library.js — understand the current tab system (Albums/Artists/Songs/Genres)

## FEATURE: Library Vertical Pill Sub-Nav

Replace the horizontal tabs at the top of the Library screen with a vertical pill menu on the left side, similar to Apple Music's Tizen app.

### Current Layout (v2)
```
┌──────────────────────────────────────────┐
│  [Albums] [Artists] [Songs] [Genres]      │  ← horizontal tabs
│                                           │
│  [album grid fills the whole width]       │
└──────────────────────────────────────────┘
```

### New Layout (v3)
```
┌─────────────────────────────────────────────────────┐
│                                                      │
│   ┌──────────┐                                       │
│   │ Albums   │   [album grid / artist grid / etc]    │
│   │ Artists  │                                       │
│   │ Songs    │                                       │
│   │ Genres   │                                       │
│   └──────────┘                                       │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Left Pill Menu Design

Container:
```css
.library-subnav {
    position: absolute;
    left: 48px;
    top: 50%;
    transform: translateY(-50%);  /* vertically centred */
    display: flex;
    flex-direction: column;
    background: rgba(30, 30, 38, 0.60);
    border-radius: 20px;
    padding: 6px;
    z-index: 10;
    width: 140px;
}
```

Items:
```css
.library-subnav-item {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    border-radius: 16px;
    text-align: centre;
    position: relative;
    z-index: 2;
    transition: color 0.15s ease;
    margin: 2px 0;  /* NOT flex gap */
}

.library-subnav-item.focused {
    color: white;
    font-weight: 600;
}

.library-subnav-item.selected {
    color: white;
    font-weight: 600;
}
```

### Sliding Pill (same pattern as top nav)

A pill element that slides vertically behind the focused item:

```css
.library-subnav-pill {
    position: absolute;
    left: 6px;
    right: 6px;
    border-radius: 16px;
    z-index: 1;
    transition: transform 0.2s ease;
    will-change: transform;
    pointer-events: none;
}

.library-subnav-pill.focused {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.library-subnav-pill.selected {
    background: rgba(var(--accent-rgb), 0.4);
    box-shadow: none;
}
```

Position the pill using `transform: translateY()` based on the focused item's index:

```javascript
function updateLibraryPill(index, animate) {
    var pill = document.querySelector('.library-subnav-pill');
    var items = document.querySelectorAll('.library-subnav-item');
    if (!items[index] || !pill) return;
    
    var itemTop = items[index].offsetTop - items[0].offsetTop;
    var itemHeight = items[index].offsetHeight;
    
    pill.style.height = itemHeight + 'px';
    
    if (animate) {
        pill.style.transition = 'transform 0.2s ease';
    } else {
        pill.style.transition = 'none';
    }
    
    pill.style.transform = 'translateY(' + itemTop + 'px)';
}
```

### Auto-Navigate on Slide (same as top nav)

When Up/Down is pressed in the library sub-nav:
1. Pill slides to next/previous item
2. Content area cross-fades to the new sub-page (albums grid, artists grid, etc.)
3. No Enter needed — navigation is automatic

### Content Area Cross-Fade

The library content (album grid, artist list, etc.) transitions with a quick cross-fade when switching sub-nav items:

```javascript
function switchLibraryContent(newTab, direction) {
    var container = document.querySelector('.library-content');
    
    // Fade out current content
    container.style.transition = 'opacity 0.15s ease';
    container.style.opacity = '0';
    
    setTimeout(function() {
        // Swap content
        renderLibraryTab(newTab, container);
        
        // Fade in new content
        container.style.transition = 'opacity 0.15s ease';
        container.style.opacity = '1';
    }, 160);
}
```

This is a simple opacity cross-fade — faster and lighter than the full page slide transition.

### Layout Structure

```css
.library-screen {
    display: flex;
    height: 100%;
    position: relative;
}

.library-subnav {
    /* positioned absolutely, vertically centred */
}

.library-content-area {
    flex: 1;
    margin-left: 220px;  /* clear the subnav — NOT flex gap */
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    transition: opacity 0.15s ease;
    will-change: opacity;
}
```

### Focus Behaviour

**When entering Library from top nav (press Down):**
- Focus goes to the library sub-nav (not directly to content)
- Sub-nav pill shows as "focused" (light fill)
- Content shows the currently selected tab

**When in the sub-nav, pressing Up/Down:**
- Slides between Albums/Artists/Songs/Genres
- Content cross-fades to match
- Wraps: Down from Genres → Albums, Up from Albums → Genres

**When in the sub-nav, pressing Right:**
- Focus moves to the content area (first focusable item in the grid)
- Sub-nav pill changes to "selected" (accent tint)

**When in the content area, pressing Left at the leftmost column:**
- Focus returns to the sub-nav
- Sub-nav pill changes back to "focused"

**When in the sub-nav, pressing Up from Albums (first item):**
- Focus returns to the top nav bar
- Library sub-nav pill stays on the last selected tab (selected state)

### FocusManager Zones

Add a `library-subnav` zone:
```javascript
FocusManager.addZone('library-subnav', {
    selector: '.library-subnav-item',
    orientation: 'vertical',
    wrap: true,
    onFocus: function(element, index) {
        updateLibraryPill(index, true);
        switchLibraryContent(LIBRARY_TABS[index].id, index > prevIndex ? 'down' : 'up');
    },
    onKey: function(direction, element, index) {
        if (direction === 'right') {
            setLibraryPillState('selected');
            FocusManager.setActiveZone(getCurrentLibraryContentZone());
            return true;
        }
        if (direction === 'up' && index === 0) {
            // Return to top nav
            FocusManager.setActiveZone('topnav');
            return true;
        }
        return false;
    }
});
```

The content zones (album grid, artist grid, song list, genre grid) need:
```javascript
// When Left is pressed at the leftmost item:
if (direction === 'left' && atLeftEdge) {
    setLibraryPillState('focused');
    FocusManager.setActiveZone('library-subnav');
    return true;
}
```

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
ALL animations MUST be GPU-composited:
- ✅ `transform` and `opacity` — GPU-composited
- ❌ Everything else — CPU layout reflow, NEVER transition
- ❌ `transition: all` — NEVER use this

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin.
- ONLY animate `transform` and `opacity`
- `will-change: transform` on the pill
- Library sub-nav uses the SAME pill pattern as the top nav (consistency)
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
1. Navigate to Library (top nav) → sub-nav appears on the left with pill on "Albums"
2. Press Down → pill slides to "Artists", content cross-fades to artists grid
3. Press Down → "Songs" → content shows song list
4. Press Down → "Genres" → content shows genre grid
5. Press Down from Genres → wraps to "Albums"
6. Press Right → focus moves to album grid, pill becomes accent-tinted
7. Navigate album grid normally
8. Press Left at leftmost album → focus returns to sub-nav
9. Press Up from "Albums" in sub-nav → focus returns to top nav
10. Cross-fade is smooth, no jank
11. Sub-nav is vertically centred on the page

Update PROGRESS.md.

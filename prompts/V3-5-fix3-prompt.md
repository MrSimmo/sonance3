You are fixing THREE remaining issues with Sonance v3-5 — a music player app for Samsung Tizen TVs.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read js/screens/search.js — find the ENTIRE quick access / right-hand panel rendering code
2. Read css/styles.css — find all pill width calculations and track row focus styles
3. Read js/screens/artist.js, js/screens/album.js — find left menu pill rendering

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## FIX 1: Side Menu Pills — Play Narrower Than Shuffle

**Problem:** In album detail and artist detail left menus, the "Play" pill is narrower than the "Shuffle" pill. They should be the SAME width — both should match the width of the WIDER item.

**Root cause:** The pill width is calculated from each individual item's text width. "Play" is shorter text than "Shuffle All", so its pill is narrower.

**Fix:** Make ALL menu items in a vertical pill group the SAME width — the width of the container or the widest item:

```javascript
function equaliseMenuPills(menuContainer) {
    var items = menuContainer.querySelectorAll('.menu-item, .action-btn, .focusable');
    if (items.length === 0) return;
    
    // Find the widest item
    var maxWidth = 0;
    for (var i = 0; i < items.length; i++) {
        var w = items[i].offsetWidth;
        if (w > maxWidth) maxWidth = w;
    }
    
    // Set all items to the same width
    for (var j = 0; j < items.length; j++) {
        items[j].style.width = maxWidth + 'px';
        items[j].style.textAlign = 'center';
    }
}
```

Call this after rendering the left menu on album detail, artist detail, and any other screen with a vertical button group.

**Alternative simpler approach — use CSS:**
```css
.detail-left-menu .action-btn,
.detail-left-menu .menu-item {
    display: block;
    width: 100%;          /* fill the container width */
    text-align: center;
    box-sizing: border-box;
}
```

If the left menu container has a fixed width (e.g. `width: 200px`), all buttons inside it will be 200px wide. The pill then matches because it sizes to the item which is always the full width.

**The pill itself** should NOT calculate width per-item. It should match the container width or be `left: 6px; right: 6px;` (stretching to fill):

```css
.detail-menu-pill {
    position: absolute;
    left: 6px;
    right: 6px;           /* stretches to match container, not individual item */
    border-radius: 20px;
    z-index: 1;
    transition: transform 0.2s ease;
    will-change: transform;
    pointer-events: none;
}
```

Then the pill only needs to move vertically with `transform: translateY()` — no width changes at all.

**Apply to ALL vertical pill menus:**
- Album detail left: Play / Shuffle
- Artist detail left: Play All / Shuffle All
- Library sub-nav: Albums / Artists / Songs / Genres

## FIX 2: Search Quick Access STILL Not Updated

**Problem:** The search screen right-hand quick access cards still show the old grey rectangles with coloured left borders. They need to match the icon card design shown in the mockup.

**This has been attempted twice and not applied. The issue is likely that the code is not finding or replacing the correct rendering function.**

**Step-by-step approach:**

**Step A: Find exactly where quick access renders**
```bash
grep -n 'function\|render\|Quick\|quick\|QUICK\|access\|ACCESS\|qa-\|QA' js/screens/search.js | head -40
```

Log the function name and line number.

**Step B: Find where the right-hand panel content is created**
The search screen has two areas:
- LEFT: keyboard + search input
- RIGHT: either quick access cards (before search) OR search results (after typing)

Find the RIGHT panel rendering:
```bash
grep -n 'right\|Right\|results\|Results\|panel\|Panel' js/screens/search.js | head -30
```

**Step C: Find the specific elements being created for quick access**
```bash
grep -n 'createElement\|innerHTML\|appendChild' js/screens/search.js | head -40
```

Look for where cards/items are created with genre names like "Rock", "Jazz" or categories like "Favourites", "Recently Added".

**Step D: REPLACE the entire quick access rendering function**

Once you've found the function, replace it ENTIRELY with this:

```javascript
function renderSearchQuickAccess(container) {
    // Clear any existing content
    container.innerHTML = '';
    
    var heading = document.createElement('div');
    heading.textContent = 'QUICK ACCESS';
    heading.style.cssText = 'font-size:13px;font-weight:600;color:rgba(255,255,255,0.4);letter-spacing:1px;margin-bottom:16px;';
    container.appendChild(heading);
    
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;grid-gap:10px;';
    
    var items = [
        { label: 'Favourites', icon: '\u2605', iconColor: getAccentColor(), bgColor: 'rgba(' + getAccentRgb() + ', 0.2)', action: 'favourites' },
        { label: 'Recently Added', icon: '\u266B', iconColor: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.2)', action: 'recent' },
        { label: 'Most Played', icon: '\u25B6', iconColor: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)', action: 'frequent' },
        { label: 'Rock', icon: '\u266A', iconColor: '#f97316', bgColor: 'rgba(249, 115, 22, 0.2)', action: 'genre-rock' },
        { label: 'Jazz', icon: '\u266A', iconColor: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.2)', action: 'genre-jazz' },
        { label: 'Electronic', icon: '\u266A', iconColor: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.2)', action: 'genre-electronic' }
    ];
    
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var card = document.createElement('div');
        card.className = 'search-qa-card focusable';
        card.setAttribute('data-action', item.action);
        
        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = 'width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;background:' + item.bgColor + ';color:' + item.iconColor + ';';
        iconWrap.textContent = item.icon;
        
        var label = document.createElement('span');
        label.style.cssText = 'color:rgba(255,255,255,0.85);font-size:14px;font-weight:500;';
        label.textContent = item.label;
        
        card.appendChild(iconWrap);
        card.appendChild(label);
        grid.appendChild(card);
    }
    
    container.appendChild(grid);
}
```

**Step E: Add the CSS if not already present**
Add to styles.css (check it doesn't already exist first):
```css
.search-qa-card {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 14px 16px;
    transition: transform 0.15s ease;
    cursor: pointer;
}

.search-qa-card .search-qa-icon {
    margin-right: 12px;
}

.search-qa-card.focused {
    transform: scale(1.04);
    background: rgba(255, 255, 255, 0.10);
}
```

**Step F: Remove ALL old quick access styles**
Search and DELETE any old styles:
```bash
grep -n 'border-left' css/styles.css | grep -i 'color\|genre\|access\|qa'
grep -n 'quick-access\|quickAccess\|qa-card\|qa-item' css/styles.css
```

Remove any CSS rules that apply coloured left borders to quick access cards.

Also search the JS for old inline styles that might override:
```bash
grep -n 'borderLeft\|border-left' js/screens/search.js
```

**Step G: Verify the function is actually called**
Add a console.log at the top of the new function:
```javascript
console.log('[Sonance][Search] renderSearchQuickAccess called');
```

If this doesn't appear in the console when opening the Search screen, the old function is still being called instead. Find where search initialises and ensure it calls the NEW function.

## FIX 3: Track Row Focus Accent Too Dark

**Problem:** The track row focus accent highlight (from fix2) is too dark — same issue the top nav pill had. The `rgba(var(--accent-rgb), 0.15)` is too subtle.

**Fix:** Increase the opacity:

```css
.track-row.focused,
.song-row.focused,
.queue-item.focused,
.result-row.focused {
    transform: scale(1.02);
    background: rgba(var(--accent-rgb), 0.25);  /* was 0.15 — increase for visibility */
}
```

Search for ALL focused track/row styles and update:
```bash
grep -n 'accent-rgb.*0\.15\|accent-rgb.*0\.1[0-5]' css/styles.css
```

Change any `0.15` or lower values for track row focus backgrounds to `0.25`.

**Don't change these** (they're correct at lower opacity):
- Quick access cards: `0.06` unfocused is fine
- Nav pills: already fixed at `0.55`

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- `transform` and `opacity` only for animations
- DO NOT modify protected files
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Fix 1 — Equal pill widths:
1. [ ] Album detail: Play and Shuffle pills are the SAME width
2. [ ] Artist detail: Play All and Shuffle All pills are the SAME width
3. [ ] Library sub-nav: all items are the same width
4. [ ] No text truncation on any pill

### Fix 2 — Search quick access:
5. [ ] Open Search screen → right panel shows icon cards with coloured circles
6. [ ] Cards have: coloured icon (★ ♫ ▶ ♪), label text, rounded card shape
7. [ ] NO grey rectangles with coloured left borders
8. [ ] Cards scale on focus (1.04x)
9. [ ] Console shows: "[Sonance][Search] renderSearchQuickAccess called"

### Fix 3 — Track row brightness:
10. [ ] Album tracklist: focused row has VISIBLE accent tint (not too subtle)
11. [ ] Queue: focused item has visible accent tint
12. [ ] The accent colour is clearly distinguishable (not just slightly-different-grey)

Update PROGRESS.md.

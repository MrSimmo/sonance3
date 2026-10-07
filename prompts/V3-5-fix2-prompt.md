You are fixing issues with Sonance v3-5 — a music player app for Samsung Tizen TVs. Five bugs to fix.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read css/styles.css — search for pill styles, track row focus styles, accent colour usage
3. Read js/screens/artist.js — find the left menu (Play All/Shuffle All) and its pill
4. Read js/screens/album.js — find the left menu and its pill
5. Read js/screens/library.js — find the sub-nav pill sizing
6. Read js/screens/search.js — find quick access card rendering
7. Read js/app.js — find the top nav Enter/select handler and how it triggers navigation

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## BUG 1: Left Menu Pill Too Big — Truncates Content

**Problem:** On the Artist detail page (Play All / Shuffle All menu) and Album detail page (Play / Shuffle), the highlight pill background is LARGER than the menu item text, causing text to look truncated or the pill to overflow its container. The pill should match the size of the item it highlights, not be bigger.

**Diagnosis:**
The pill width is likely calculated incorrectly — using `offsetWidth` of a parent container instead of the individual menu item, or adding extra padding.

```bash
grep -rn 'pill.*width\|pill.*offsetWidth\|pill.*getBoundingClientRect\|pill.*style\.width' js/screens/artist.js js/screens/album.js js/screens/library.js js/app.js
```

**Fix:**
The pill must match the EXACT dimensions of the focused item. Use `getBoundingClientRect()` of the focused item relative to its container:

```javascript
function updatePillSize(pill, focusedItem, container) {
    var itemRect = focusedItem.getBoundingClientRect();
    var containerRect = container.getBoundingClientRect();
    
    pill.style.width = itemRect.width + 'px';
    pill.style.height = itemRect.height + 'px';
    pill.style.transform = 'translateY(' + (itemRect.top - containerRect.top) + 'px)';
}
```

Do NOT add extra padding to the pill width beyond what the item already has. The pill should be the same size as the item's clickable area.

**Check ALL screens with pill menus:**
- Top nav bar — pill width matches nav item width
- Library sub-nav — pill width matches sub-nav item width
- Artist detail left menu — pill matches Play All / Shuffle All item size
- Album detail left menu — pill matches Play / Shuffle item size
- Any other screen with a pill-style menu

## BUG 2: Library Sub-Nav and Top Nav Accent Colour Too Dark

**Problem:** The pill accent colour on the library sub-nav and top nav is darker than the actual accent colour. It looks muted compared to buttons and other accent elements.

**Diagnosis:**
The pill is likely using `rgba(var(--accent-rgb), 0.4)` which is correct for the SELECTED state (grey/subtle when user is in content). But the FOCUSED state (user actively browsing nav) should be brighter.

**Fix:**
Check and update the opacity values:

```css
/* FOCUSED state = user is IN the nav, actively choosing = BRIGHTER accent */
#top-nav-pill.focused,
.library-subnav-pill.focused {
    background: rgba(var(--accent-rgb), 0.55);  /* was 0.4 — increase for more vibrancy */
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

/* SELECTED state = user has entered content = SUBTLE grey */
#top-nav-pill.selected,
.library-subnav-pill.selected {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: none;
}
```

Also check if any other pill menu (artist detail, album detail) has the same issue. The focused pill across ALL menus should use the same `rgba(var(--accent-rgb), 0.55)` for consistency.

**Also check the artist/album detail left menu pills** — they should match:
```css
.detail-menu-pill.focused {
    background: rgba(var(--accent-rgb), 0.55);
}
```

## BUG 3: Search Quick Access Not Updated to New Design

**Problem:** Library → Genres got the new gradient card design, but the Search screen quick access cards still use the old grey rectangle style with left borders.

**Fix:**
Find the search quick access rendering in `js/screens/search.js`:
```bash
grep -n 'quick\|Quick\|QA\|qa-\|access' js/screens/search.js
```

Replace the quick access card rendering entirely:

```javascript
var QA_ITEMS = [
    { label: 'Favourites', icon: '\u2605', iconColor: 'var(--accent)', bgColor: 'rgba(var(--accent-rgb), 0.2)', action: 'favourites' },
    { label: 'Recently Added', icon: '\u266B', iconColor: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.2)', action: 'recent' },
    { label: 'Most Played', icon: '\u25B6', iconColor: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)', action: 'frequent' },
    { label: 'Rock', icon: '\u266A', iconColor: '#f97316', bgColor: 'rgba(249, 115, 22, 0.2)', action: 'genre-rock' },
    { label: 'Jazz', icon: '\u266A', iconColor: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.2)', action: 'genre-jazz' },
    { label: 'Electronic', icon: '\u266A', iconColor: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.2)', action: 'genre-electronic' }
];

function renderQuickAccess(container) {
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;grid-gap:10px;';

    QA_ITEMS.forEach(function(item, i) {
        var card = document.createElement('div');
        card.className = 'search-qa-card focusable';
        card.dataset.action = item.action;
        card.style.cssText = 'display:flex;align-items:center;background:rgba(255,255,255,0.06);border-radius:12px;padding:14px 16px;transition:transform 0.15s ease;';

        var iconEl = document.createElement('div');
        iconEl.style.cssText = 'width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;font-size:14px;background:' + item.bgColor + ';color:' + item.iconColor + ';';
        iconEl.textContent = item.icon;

        var labelEl = document.createElement('span');
        labelEl.style.cssText = 'color:rgba(255,255,255,0.85);font-size:14px;font-weight:500;';
        labelEl.textContent = item.label;

        card.appendChild(iconEl);
        card.appendChild(labelEl);
        grid.appendChild(card);
    });

    container.appendChild(grid);
}
```

CSS for focus:
```css
.search-qa-card.focused {
    transform: scale(1.04);
    background: rgba(255, 255, 255, 0.10) !important;
}
```

**Remove ALL old quick access styles.** Search and delete:
```bash
grep -n 'border-left\|qa.*border\|quick-access.*border\|qa.*rectangle' css/styles.css js/screens/search.js
```

## BUG 4: Track Row Focus Has Grey Background Instead of Accent

**Problem:** When the user focuses a track row (album tracklist, queue), it gets a grey background highlight instead of an accent-coloured highlight.

**Fix:**
The focused track row should have a subtle accent tint, not grey:

```css
.track-row.focused {
    transform: scale(1.02);
    background: rgba(var(--accent-rgb), 0.15);  /* accent tint, NOT grey */
}

.track-row.focused .track-title {
    color: white;
    font-weight: 600;
}
```

Search for any grey background on focused track rows:
```bash
grep -n 'track-row.*focused\|track.*focused.*background\|focused.*rgba(255' css/styles.css
```

Replace `rgba(255, 255, 255, 0.06)` or similar grey values with `rgba(var(--accent-rgb), 0.15)` for track row focus.

**Apply to ALL track/song row contexts:**
- Album detail tracklist
- Queue items
- Library → Songs list
- Search results (song results)
- Any other list of tracks

Check:
```bash
grep -rn 'track-row\|song-row\|queue-item\|result-row' css/styles.css | grep -i 'focus'
```

## BUG 5: Pressing Up Then Enter on Top Nav From NP Doesn't Navigate

**Problem:** On the Now Playing screen, pressing Up brings up the top nav bar. Then pressing Enter on a nav item (e.g. Home) does nothing. The user has to press Left/Right first (which triggers auto-navigate) to change screens.

**Root cause:** The top nav's Enter/activate handler isn't triggering navigation. It likely only sets the pill to "selected" and enters page content — but on NP, "entering page content" just goes back into the NP screen instead of navigating to the selected nav item.

**Fix:**
When Enter is pressed on a top nav item:
1. Check if the current screen MATCHES the nav item. If yes → enter page content (existing behaviour).
2. If the current screen DOESN'T match → navigate to the new screen first, THEN enter page content.

```javascript
// In topnav zone onActivate:
onActivate: function(element, index) {
    var targetScreen = NAV_ITEMS[index].id;
    var currentScreen = getCurrentScreen();
    
    if (targetScreen !== currentScreen) {
        // Navigate to the new screen
        var currentIndex = getNavIndexForScreen(currentScreen);
        var direction = index > currentIndex ? 'left' : 'right';
        navigateToScreen(targetScreen, direction);
    }
    
    // Then enter page content
    setPillState('selected');
    FocusManager.setActiveZone(getPageFirstZone(targetScreen));
}
```

This means pressing Enter always works:
- If already on the correct screen → just enters content (as before)
- If on a different screen (like NP) → navigates first, then enters content

**Also handle the NP-specific cleanup:**
When navigating AWAY from NP via Enter on a nav item, the NP screen needs to deactivate properly:
```javascript
if (currentScreen === 'nowplaying' && targetScreen !== 'nowplaying') {
    // Restore page container, show NP bar, etc.
    var container = document.getElementById('page-container');
    container.style.top = '80px';
    updateNpBarVisibility();
}
```

## HARDWARE ACCELERATION
- `transform` and `opacity` ONLY
- NEVER `transition: all`
- Pill transitions: `transform` only (translateX/translateY for position, no width animation if possible)

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- DO NOT modify player.js, api.js, auth.js, starred.js, utils.js, config.xml
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Bug 1 — Pill sizing:
1. [ ] Artist detail: Play All / Shuffle All pills match item size exactly, no truncation
2. [ ] Album detail: Play / Shuffle pills match item size
3. [ ] Library sub-nav: pills match item size
4. [ ] Top nav: pills match item size

### Bug 2 — Accent brightness:
5. [ ] Top nav focused pill is visibly accent-coloured (not muted dark)
6. [ ] Library sub-nav focused pill is same brightness
7. [ ] Both match the accent colour used on buttons

### Bug 3 — Search quick access:
8. [ ] Search screen: quick access cards have coloured icon circles (★ ♫ ▶ ♪)
9. [ ] No grey rectangles with left borders
10. [ ] Cards scale on focus

### Bug 4 — Track row accent:
11. [ ] Album tracklist: focused row has subtle accent background tint
12. [ ] Queue: focused item has accent tint
13. [ ] Library Songs: focused row has accent tint
14. [ ] NOT grey — the tint should be recognisably the accent colour

### Bug 5 — NP → Enter on nav:
15. [ ] NP screen → Up → nav appears → focus on Now Playing item
16. [ ] Press Left to Home → Home loads (auto-navigate, existing behaviour)
17. [ ] NP screen → Up → nav appears → press Enter on Home → Home loads (THIS is the fix)
18. [ ] NP screen → Up → nav appears → press Enter on Library → Library loads
19. [ ] From Home, press Enter on Home nav item → enters page content (no navigation needed)

Update PROGRESS.md.

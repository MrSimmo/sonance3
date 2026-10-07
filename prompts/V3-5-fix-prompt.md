You are fixing issues with Sonance v3-5 — a music player app for Samsung Tizen TVs. Five bugs to fix.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read css/styles.css — search for all button/pill styles, genre styles, search quick access styles
4. Read js/screens/home.js — find Play/Shuffle button rendering and focus styles
5. Read js/screens/artist.js — find Play All/Shuffle All button rendering
6. Read js/screens/library.js — find genre rendering code and tab switching logic
7. Read js/screens/search.js — find quick access card rendering
8. Read js/screens/nowplaying.js — find the render function and image loading
9. Read js/app.js — find navigation handling when pressing Up to top nav and then selecting a screen

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## BUG 1: Button Pill Styling Broken — Wrong Shape, Both Filled Accent

**Problem:** Play/Shuffle buttons on the Home hero, Artist detail (Play All/Shuffle All), and possibly other screens have wrong styling:
- Both buttons are filled with accent colour (should only be the focused one)
- The pill shape has become a rectangle with slightly rounded corners instead of a full pill

**Diagnosis:**
Search for ALL Play/Shuffle button styling:
```bash
grep -rn 'action-btn\|play-btn\|shuffle-btn\|\.btn.*pill\|\.pill.*btn' css/styles.css js/screens/
grep -rn 'Play\|Shuffle\|play.*all\|shuffle.*all' js/screens/home.js js/screens/artist.js js/screens/album.js
```

**Fix:**
The buttons must have TWO distinct states:

```css
/* Base state — subtle dark fill, full pill shape */
.action-btn {
    padding: 10px 28px;
    border-radius: 24px;           /* FULL pill — not 8px or 12px */
    font-size: 15px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.08);  /* subtle, NOT accent */
    color: rgba(255, 255, 255, 0.8);
    border: none;
    outline: none;
    transition: transform 0.15s ease;
    will-change: transform;
    display: inline-block;
    margin-right: 12px;            /* NOT flex gap */
}

/* Focused state — accent fill, scale up */
.action-btn.focused {
    background: var(--accent);      /* ONLY the focused button gets accent */
    color: white;
    transform: scale(1.06);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
```

**Check if JS is overriding styles inline.** Search for:
```bash
grep -rn 'style\.background\|style\.borderRadius\|style\.border' js/screens/home.js js/screens/artist.js js/screens/album.js
```
If inline styles are setting background or borderRadius, they override CSS classes. Remove them and rely on the CSS classes only.

**Verify the class toggling.** When focus moves between Play and Shuffle:
- The previously focused button must LOSE the `.focused` class → reverts to subtle dark
- The newly focused button must GAIN the `.focused` class → gets accent fill

If BOTH buttons have `.focused` or both have accent background, the class isn't being toggled properly.

Apply the same fix to:
- Home hero Play/Shuffle
- Album detail Play/Shuffle
- Artist detail Play All/Shuffle All
- Any other button pairs

## BUG 2: Library Genres Tab Shows Songs / Can't Select Items

**Problem:** Sometimes navigating to Library → Genres shows songs instead of genres. The user can't select anything and has to back out.

**Diagnosis:**
This is likely a tab state / content mismatch. The library sub-nav says "Genres" but the content area is showing the Songs tab content.

```bash
grep -n 'switchTab\|renderTab\|currentTab\|activeTab' js/screens/library.js
```

**Likely causes:**

**Cause A: Tab index mismatch**
The sub-nav pill moves to the correct position but the content rendering uses a different index. Check that the sub-nav index maps correctly:
```
index 0 → Albums
index 1 → Artists
index 2 → Songs
index 3 → Genres
```
If the order in the sub-nav items doesn't match the order in the content render switch statement, the wrong content shows.

**Cause B: Content not re-rendering on tab switch**
The cross-fade might be running but the new content isn't actually being rendered. Add console logging:
```javascript
console.log('[Library] Switching to tab:', tabId, 'index:', index);
```

**Cause C: Focus zone not updating**
The content area's focus zone might still be registered for the previous tab's items. When a new tab renders, the old focus zone targets are stale.

**Fix:** Ensure the tab switch function:
1. Updates the content (renders correct tab)
2. Clears and re-registers the content focus zone for the new tab
3. Uses the correct tab index from the sub-nav

Also add a guard: if the content doesn't match the tab, force re-render:
```javascript
function ensureTabContentMatches(tabIndex) {
    var expected = LIBRARY_TABS[tabIndex].id;
    var actual = _currentLibraryTab;
    if (expected !== actual) {
        console.warn('[Library] Tab mismatch! Expected:', expected, 'Got:', actual);
        renderLibraryTab(expected);
    }
}
```

## BUG 3: Search Quick Access and Genres Not Using New Designs

**Problem:** The genre cards and search quick access cards are plain rectangles with slightly lighter grey backgrounds instead of the gradient genres and icon quick access cards specified in V3-5.

**Diagnosis:**
V3-5 specified:
- **Genres:** gradient cards with `linear-gradient(135deg, ...)` backgrounds per genre
- **Search quick access:** icon cards with coloured icon circles

But the implementation either didn't apply these or used the old styles.

**Fix genres — find the genre card rendering in `js/screens/library.js`:**
```bash
grep -n 'genre\|Genre' js/screens/library.js
```

Replace the genre card creation with:
```javascript
var GENRE_GRADIENTS = [
    'linear-gradient(135deg, #7c3aed, #4f46e5)',
    'linear-gradient(135deg, #0891b2, #0e7490)',
    'linear-gradient(135deg, #e44d8a, #be185d)',
    'linear-gradient(135deg, #ea580c, #c2410c)',
    'linear-gradient(135deg, #16a34a, #15803d)',
    'linear-gradient(135deg, #ca8a04, #a16207)',
    'linear-gradient(135deg, #2563eb, #1d4ed8)',
    'linear-gradient(135deg, #dc2626, #b91c1c)',
    'linear-gradient(135deg, #7c3aed, #be185d)',
    'linear-gradient(135deg, #0891b2, #16a34a)',
    'linear-gradient(135deg, #ea580c, #ca8a04)',
    'linear-gradient(135deg, #2563eb, #7c3aed)'
];

function renderGenreCard(genre, index) {
    var card = document.createElement('div');
    card.className = 'genre-card focusable';
    card.style.background = GENRE_GRADIENTS[index % GENRE_GRADIENTS.length];
    card.style.borderRadius = '12px';
    card.style.padding = '20px 18px';
    card.style.minHeight = '80px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'flex-end';

    var name = document.createElement('div');
    name.className = 'genre-name';
    name.textContent = genre.value || genre.name;
    name.style.cssText = 'color:white;font-size:16px;font-weight:600;';

    var count = document.createElement('div');
    count.className = 'genre-count';
    count.textContent = (genre.albumCount || 0) + ' albums';
    count.style.cssText = 'color:rgba(255,255,255,0.65);font-size:12px;margin-top:2px;';

    card.appendChild(name);
    card.appendChild(count);
    return card;
}
```

Genre card CSS:
```css
.genre-card {
    transition: transform 0.15s ease;
    cursor: pointer;
}
.genre-card.focused {
    transform: scale(1.08);
    z-index: 5;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

Remove ALL old genre card styles (left borders, dark background rectangles):
```bash
grep -n 'genre.*border\|genre.*rgba\|genre-card.*background' css/styles.css
```

**Fix search quick access — find in `js/screens/search.js`:**
```bash
grep -n 'quick.*access\|qa-\|quickAccess' js/screens/search.js
```

Replace with icon card rendering:
```javascript
var QA_ITEMS = [
    { label: 'Favourites', icon: '★', iconColor: 'var(--accent)', bgColor: 'rgba(var(--accent-rgb), 0.2)' },
    { label: 'Recently Added', icon: '♫', iconColor: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.2)' },
    { label: 'Most Played', icon: '▶', iconColor: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)' },
    { label: 'Rock', icon: '♪', iconColor: '#f97316', bgColor: 'rgba(249, 115, 22, 0.2)' },
    { label: 'Jazz', icon: '♪', iconColor: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.2)' },
    { label: 'Electronic', icon: '♪', iconColor: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.2)' }
];

function renderQuickAccessCard(item) {
    var card = document.createElement('div');
    card.className = 'search-qa-card focusable';

    var iconEl = document.createElement('div');
    iconEl.className = 'search-qa-icon';
    iconEl.style.background = item.bgColor;
    iconEl.style.color = item.iconColor;
    iconEl.textContent = item.icon;

    var labelEl = document.createElement('span');
    labelEl.className = 'qa-label';
    labelEl.textContent = item.label;

    card.appendChild(iconEl);
    card.appendChild(labelEl);
    return card;
}
```

Quick access CSS:
```css
.search-qa-card {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 14px 16px;
    transition: transform 0.15s ease;
}
.search-qa-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    flex-shrink: 0;
    font-size: 14px;
}
.search-qa-card .qa-label {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    font-weight: 500;
}
.search-qa-card.focused {
    transform: scale(1.04);
    background: rgba(255, 255, 255, 0.10);
}
```

Remove ALL old quick access styles (left-border boxes):
```bash
grep -n 'quick-access\|qa-.*border\|border-left.*color' css/styles.css js/screens/search.js
```

## BUG 4: Top Nav → Select Screen Does Nothing / Up-to-Nav Broken

**Problem:** Two related issues:
1. When on NP screen, pressing Up to reach the top nav, then selecting Home (or other screens) — nothing happens. The screen doesn't change.
2. Pressing Up from page content to the top nav doesn't always work across different screens.

**Diagnosis:**

**Issue 4a: NP → Top Nav → Select Home does nothing**

When the user presses Up from NP to show the top nav, focus is on the "Now Playing" nav item. They then press Left to move to "Home" — the pill slides but the page doesn't change.

The problem is likely that navigating FROM the Now Playing screen is different from other screens. When the NP screen deactivates, it needs to:
1. Restore the page container (top: 80px, not 0)
2. Show the NP bar (if a track is playing and destination isn't NP)
3. Properly clean up the NP screen's DOM

Check the `navigateToScreen` function — does it handle the case where the OUTGOING screen is Now Playing?

```javascript
// When navigating away from NP:
if (currentScreen === 'nowplaying') {
    // Restore page container position
    var container = document.getElementById('page-container');
    container.style.top = '80px';
    // Show nav bar
    setNavBarVisible(true);
    // Show NP bar if music is playing
    updateNpBarVisibility();
}
```

**Issue 4b: Up-to-nav broken on some screens**

Search for the Up handler at the top of each screen's focus zone:
```bash
grep -rn "'up'" js/screens/*.js js/focus.js
grep -rn "direction.*up\|=== 'up'\|== 'up'" js/screens/*.js js/focus.js
```

Every screen's topmost focusable zone must have:
```javascript
if (direction === 'up' && atFirstRow) {
    FocusManager.setActiveZone('topnav');
    setPillState('focused');
    return true;  // consumed — don't let default handling run
}
```

Check EACH screen:
- `home.js` — hero Play/Shuffle row or first card row
- `library.js` — sub-nav first item (Albums) or first content row
- `album.js` — first track or Play/Shuffle
- `artist.js` — first discography item or Play All
- `search.js` — first keyboard row
- `queue.js` — first queue item
- `settings.js` — first setting row
- `playlists.js` — first playlist card
- `nowplaying.js` — transport controls or first focusable element

## BUG 5: Now Playing Screen Renders Slowly (Progressive Loading)

**Problem:** When the NP screen loads, the album art appears in chunks (top half first, then bottom), and the blurred background loads progressively, as if the rendering is slow. This creates a "modem loading" effect.

**Causes:**
1. The album art image is loading from the server every time (no cache hit)
2. The blurred background is likely using `filter: blur()` which is expensive to render
3. The NP screen may be doing expensive DOM operations during the transition

**Fix:**

**5a: Pre-cache the NP album art**
When a track starts playing, immediately pre-cache the cover art at the NP display size:
```javascript
Player.on('trackchange', function(track) {
    if (track && track.coverArt) {
        // Pre-cache at NP screen size
        var npArtUrl = api.getCoverArtUrl(track.coverArt, 600);
        var preload = new Image();
        preload.src = npArtUrl;
        
        // Also pre-cache at smaller size for the NP bar
        var barArtUrl = api.getCoverArtUrl(track.coverArt, 100);
        var preload2 = new Image();
        preload2.src = barArtUrl;
    }
});
```

This way, when the user navigates to NP, the image is already in the browser's HTTP cache.

**5b: Prepare the NP screen BEFORE the transition**
Instead of rendering the NP screen during the transition (which causes the progressive load), prepare it off-screen first:

```javascript
function navigateToNowPlaying() {
    var incoming = document.getElementById('page-incoming');
    
    // Render NP into the incoming layer (hidden, off-screen)
    incoming.style.transition = 'none';
    incoming.style.opacity = '0';
    renderNowPlayingScreen(incoming);
    
    // Wait for images to load BEFORE starting the transition
    var artImg = incoming.querySelector('.np-album-art');
    if (artImg && !artImg.complete) {
        artImg.onload = function() {
            // Image loaded — now start the transition
            startPageTransition(incoming);
        };
        // Timeout fallback — don't wait forever
        setTimeout(function() {
            startPageTransition(incoming);
        }, 500);
    } else {
        // Image already cached — transition immediately
        startPageTransition(incoming);
    }
}
```

**5c: Use a pre-rendered blur background**
Instead of applying `filter: blur(100px)` to a full-size image every time (which the GPU has to compute), create the blur once and cache it:

Option A: Use a much smaller image (e.g. 50px) for the blur background. A 50px image upscaled to 1920px is naturally blurry without needing `filter: blur()`:
```css
.np-blur-bg {
    position: absolute;
    top: -20px; left: -20px; right: -20px; bottom: -20px;
    background-size: cover;
    background-position: center;
    /* Use a TINY image — natural pixelation creates blur effect */
    /* Set background-image to getCoverArtUrl(id, 50) */
    /* Optional: add a very light filter blur to smooth the pixels */
    filter: blur(30px);  /* much less work than blur(100px) on a full image */
    opacity: 0.4;
}
```

A 50px image with `blur(30px)` is MUCH cheaper than a 600px image with `blur(100px)`. The visual result is nearly identical for a full-screen background.

Option B: Pre-render the blur to an off-screen canvas and use the result as a background (more complex, skip for now).

**5d: Don't animate the blur background**
The blur background should be set BEFORE the transition starts (no transition on the blur element). Only the main NP content should animate in.

## HARDWARE ACCELERATION
- `transform` and `opacity` ONLY for transitions
- NEVER `transition: all`
- `filter: blur()` is acceptable but expensive — use on small images only
- Pre-cache images before transitions

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- DO NOT modify player.js, api.js, auth.js, starred.js, utils.js, config.xml
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Bug 1 — Buttons:
1. [ ] Home hero: Play button unfocused = subtle dark pill, focused = accent pill + scale
2. [ ] Home hero: Shuffle button unfocused = subtle dark, focused = accent + scale
3. [ ] Only ONE button has accent fill at a time (the focused one)
4. [ ] Buttons are full pill shape (border-radius: 24px) not rounded rectangles
5. [ ] Same for Album Detail Play/Shuffle
6. [ ] Same for Artist Detail Play All/Shuffle All

### Bug 2 — Genres:
7. [ ] Library → Genres → shows genre gradient cards (not songs)
8. [ ] Genres are selectable (can focus and press Enter)
9. [ ] Switching between all library tabs works correctly every time
10. [ ] No content/tab mismatch

### Bug 3 — Styles:
11. [ ] Genre cards: colourful gradients, no grey rectangles, no left borders
12. [ ] Search quick access: icon cards with coloured circles, no left-border boxes
13. [ ] Both scale on focus

### Bug 4 — Navigation:
14. [ ] NP screen → press Up → top nav appears → press Left to Home → Home screen loads
15. [ ] NP screen → press Up → top nav appears → press Left to Library → Library loads
16. [ ] Home → press Up from top content row → focus returns to top nav
17. [ ] Library → press Up from sub-nav first item → focus returns to top nav
18. [ ] Settings → press Up → focus returns to top nav
19. [ ] All screens: Up from topmost row goes to top nav

### Bug 5 — NP performance:
20. [ ] Navigate to NP → album art appears fully loaded (no progressive chunks)
21. [ ] Blur background appears without visible rendering lag
22. [ ] NP screen transition is smooth

Update PROGRESS.md.

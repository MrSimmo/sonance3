You are performing the final polish pass on Sonance — a music player app for Samsung Tizen TVs. This is V3-5: Polish & Consistency.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — V3-1 through V3-4 must be complete
3. Browse through ALL screens in the browser to spot inconsistencies
4. Read css/styles.css — look for leftover v2 styles

## FEATURE: Final Polish & Consistency Pass

This is a cleanup and refinement pass to make the v3 redesign feel complete and professional.

### 1. CRITICAL — Now Playing Screen GPU Animation Fix

The NP screen is currently jerky on the TV. The lyrics panel toggle and layout transitions are animating layout-triggering properties. Fix ALL NP screen animations to be GPU-only.

**Lyrics panel toggle (slide in/out):**
The left section and lyrics panel must ONLY use `transform` and `opacity`:
```css
.np-left {
    transition: transform 0.25s ease;
    will-change: transform;
}

/* Lyrics OFF: centred */
.np-left {
    transform: translateX(0);
}

/* Lyrics ON: shifted left */
.np-layout.lyrics-active .np-left {
    transform: translateX(-80px);
}

.np-lyrics-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 55%;
    transform: translateX(100%);  /* hidden off-screen right */
    opacity: 0;
    transition: transform 0.25s ease, opacity 0.2s ease;
    will-change: transform, opacity;
}

.np-layout.lyrics-active .np-lyrics-panel {
    transform: translateX(0);
    opacity: 1;
}
```

**Album art resize when lyrics toggle — SNAP, no transition:**
```css
.np-album-art {
    /* NO transition on width/height — snap instantly */
    width: 280px;
    height: 280px;
}
.np-layout.lyrics-active .np-album-art {
    width: 220px;
    height: 220px;
    /* Snaps instantly — only the translateX animates */
}
```

**Lyrics line highlighting — scale, not font-size:**
```css
.lyrics-line {
    font-size: 18px;  /* SAME for all states */
    transition: transform 0.2s ease, opacity 0.2s ease;
    will-change: transform, opacity;
    transform-origin: left center;
}
.lyrics-line.lyrics-active {
    transform: scale(1.15);
    opacity: 1;
    color: white;        /* snaps instantly */
    font-weight: 700;    /* snaps instantly */
}
.lyrics-line.lyrics-upcoming {
    transform: scale(1);
    opacity: 0.5;
}
.lyrics-line.lyrics-past {
    transform: scale(1);
    opacity: 0.25;
}
```

**Lyrics scroll — already using translateY (verify it still does):**
```css
.np-lyrics-lines {
    transition: transform 0.3s ease;
    will-change: transform;
}
```

**Search the NP screen code for any `transition: all` or transitions on layout properties:**
```bash
grep -n 'transition' js/screens/nowplaying.js
grep -n 'transition.*all\|transition.*width\|transition.*height\|transition.*margin\|transition.*padding\|transition.*font-size\|transition.*left\|transition.*right' css/styles.css
```
Fix every instance found.

### 2. Remove ALL Leftover v2 Styles

Search `css/styles.css` for any remaining v2 artifacts:
```bash
grep -n 'sidebar\|#sidebar\|\.sidebar' css/styles.css
grep -n 'content-area.*left\|margin-left.*160\|margin-left.*180' css/styles.css
grep -n '\.back-button\|\.album-detail-back\|back-btn' css/styles.css
```
Delete any sidebar-related CSS and any on-screen back button CSS that wasn't caught in earlier phases.

Also search JS files:
```bash
grep -rn 'sidebar\|#sidebar' --include='*.js' js/
grep -rn 'back-button\|back-btn\|backButton' --include='*.js' js/screens/
```

### 3. Verify Back Buttons Fully Removed

V3-3-fix removed on-screen back buttons from album/artist/sub-pages. Verify:
- No `← Back` text or arrow element on Album Detail
- No `← Back` on Artist Detail
- No back button focus zone entries remain
- Hardware Back (keyCode 10009) handles all backward navigation via the nav stack

### 4. Verify NP Bar Visibility Rules

V3-3-fix added NP bar visibility logic. Verify:
- App loads with no music → NP bar hidden, page container uses full height
- Play a track → NP bar fades in, page container shrinks by 76px
- Navigate to NP screen → NP bar hidden
- Navigate away from NP → NP bar reappears (if track is loaded)
- Queue empties / playback stops → NP bar fades out

### 2. Home Screen Layout Refresh

The home screen should feel spacious with the new full-width layout:

**Hero section:**
- Full-width within the centred content area (max-width: 1400px)
- The accent glow (P14d) should still work — verify it does with the new layout
- Album art larger: 200px (was ~160px)

**Recently Added / Recently Played / Playlists sections:**
- Section headers: `font-size: 18px; font-weight: 600; letter-spacing: 0.5px;`
- Horizontal scrolling rows of cards
- Cards use the new scale-on-focus from V3-4
- Add a subtle slide animation when scrolling horizontally: focused card near the edge triggers the row to slide, keeping the focused item visible

### 3. Album Detail Layout Polish

With full width available:
- Left panel: slightly wider (260px)
- Album art: 240px (larger than before)
- Right panel (tracklist): wider, more breathing room
- Track rows: use the scale(1.02) focus from V3-4
- The split-pane pattern stays but with more generous proportions

### 4. Artist Detail Layout Polish

Same as album detail — wider left panel, larger artist photo (220px circle), more spacious right panel.

### 5. CRITICAL — Button Styling Update (Play/Shuffle/Exit Dialog)

Several button menus still use old v2 text-highlight styling. Update them to match v3:

**Play All / Shuffle All buttons** (on Album Detail, Artist Detail, Home hero):
- Unfocused: pill shape, subtle dark fill (`rgba(255,255,255,0.08)`), white text
- Focused: `transform: scale(1.06)`, accent fill (`var(--accent)`), white text, subtle shadow
- Transition: `transform 0.15s ease` ONLY — no `transition: all`
```css
.action-btn {
    padding: 10px 28px;
    border-radius: 24px;
    font-size: 15px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    border: none;
    transition: transform 0.15s ease;
    will-change: transform;
}
.action-btn.focused {
    transform: scale(1.06);
    background: var(--accent);  /* snaps instantly */
    color: white;                /* snaps instantly */
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
```

**Exit dialog buttons:**
- Same pill style as action buttons
- Focused button: accent fill + `scale(1.06)`
- Unfocused button: subtle dark fill
- Dialog container: `border-radius: 16px`, `background: rgba(30, 30, 38, 0.95)`

### 6. CRITICAL — Fix Up-to-Top-Nav from All Screens

The user cannot press Up from album/artist detail or other content screens to return to the top nav bar. This is a focus zone issue.

Search ALL screen files for the Up key handler at the top of page content:
```bash
grep -rn "direction.*up\|keyCode.*38\|'up'" --include='*.js' js/screens/
```

Every screen's topmost focus zone must handle Up at the first row:
```javascript
// When Up is pressed and focus is at the top of the content area:
if (atTopOfContent && direction === 'up') {
    FocusManager.setActiveZone('topnav');
    setPillState('focused');
    return true;
}
```

Check specifically:
- `js/screens/album.js` — first focusable row (Play/Shuffle buttons or first track)
- `js/screens/artist.js` — first focusable row (Play All/Shuffle or first album)
- `js/screens/home.js` — first focusable row (hero Play/Shuffle)
- `js/screens/queue.js` — first queue item
- `js/screens/settings.js` — first setting row
- `js/screens/search.js` — top of keyboard
- `js/screens/playlists.js` — first playlist card

All must allow Up to return focus to the top nav.

### 7. Genre Cards — Gradient Style Redesign

Replace the old left-border genre cards with modern gradient cards (Apple Music style).

**Each genre gets a unique gradient from a curated palette:**
```javascript
var GENRE_GRADIENTS = [
    'linear-gradient(135deg, #7c3aed, #4f46e5)',  // purple
    'linear-gradient(135deg, #0891b2, #0e7490)',  // cyan
    'linear-gradient(135deg, #e44d8a, #be185d)',  // pink (use accent if applicable)
    'linear-gradient(135deg, #ea580c, #c2410c)',  // orange
    'linear-gradient(135deg, #16a34a, #15803d)',  // green
    'linear-gradient(135deg, #ca8a04, #a16207)',  // amber
    'linear-gradient(135deg, #2563eb, #1d4ed8)',  // blue
    'linear-gradient(135deg, #dc2626, #b91c1c)',  // red
    'linear-gradient(135deg, #7c3aed, #be185d)',  // purple-pink
    'linear-gradient(135deg, #0891b2, #16a34a)',  // teal-green
    'linear-gradient(135deg, #ea580c, #ca8a04)',  // orange-amber
    'linear-gradient(135deg, #2563eb, #7c3aed)',  // blue-purple
];
// Assign gradient by index: genre[i] gets GENRE_GRADIENTS[i % GENRE_GRADIENTS.length]
```

**Genre card layout:**
```css
.genre-card {
    border-radius: 12px;
    padding: 20px 18px;
    position: relative;
    overflow: hidden;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    transition: transform 0.15s ease;
    will-change: transform;
}

.genre-card .genre-name {
    color: white;
    font-size: 16px;
    font-weight: 600;
}

.genre-card .genre-count {
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
    margin-top: 2px;
}

.genre-card.focused {
    transform: scale(1.08);
    z-index: 5;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

**Grid:** 4 columns on TV (1920px), `grid-gap: 16px`, centred.

**Remove ALL old genre card styles:** coloured left borders, dark background boxes, etc. Search for:
```bash
grep -n 'genre.*border-left\|genre.*border-color' css/styles.css
```

### 8. Search Screen — Quick Access Redesign

Replace the old coloured left-border quick access boxes with modern icon cards.

**Quick access card:**
```css
.search-qa-card {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 14px 16px;
    transition: transform 0.15s ease;
    will-change: transform;
}

.search-qa-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;  /* NOT flex gap */
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

**Icon colours (use accent-tinted backgrounds):**
```javascript
var QA_ITEMS = [
    { label: 'Favourites', iconColor: 'var(--accent)', bgColor: 'rgba(var(--accent-rgb), 0.2)', icon: '★' },
    { label: 'Recently Added', iconColor: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.2)', icon: '♫' },
    { label: 'Most Played', iconColor: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.2)', icon: '▶' },
    // Add genre shortcuts: Rock, Jazz, Electronic etc.
];
```

**Grid:** 2 columns, `grid-gap: 10px`. Quick access appears to the RIGHT of the keyboard (same position as before, just restyled).

**Remove ALL old quick access styles:** coloured left borders, dark rectangular boxes. Search for:
```bash
grep -n 'quick-access\|qa-.*border' css/styles.css js/screens/search.js
```

### 9. Search Keyboard Polish

The keyboard itself looks fine but needs minor tweaks to match v3:
- Key background: `rgba(255, 255, 255, 0.06)` (slightly lighter)
- Key border-radius: `8px` (slightly more rounded)
- Focused key: `transform: scale(1.08)`, accent fill, white text — same as V3-4 cards
- Key transition: `transform 0.12s ease` ONLY
- SPACE and DEL: same styling but wider

### 10. Settings Screen Polish

- Settings left column: wider, more padding
- About card (right column): updated to match v3 aesthetic
- Accent colour swatches: slightly larger (40px diameter)
- All setting rows: use consistent padding and font sizes

### 11. Queue Screen Polish

- Queue items use scale(1.02) on focus
- Centred layout with max-width
- Currently playing item has accent indicator

### 12. Playlists Screen Polish

- Playlist grid: centred, cards use scale(1.08) on focus
- Playlist detail: same split-pane as album detail

### 13. Login Screen Polish

- SamsungOne font applied
- Input fields: modern, rounded (border-radius: 12px), subtle border
- Login button: accent colour, rounded pill shape
- Centre the login card vertically and horizontally
- Sonance logo/name: larger, prominent
- "By Simmo" tagline: subtle, below the logo
- Clean, minimal — no background clutter

### 14. NP Bar Polish

- Verify it spans full width correctly
- Track info text: SamsungOne font, clean rendering
- Progress bar: accent colour, smooth
- Controls: properly spaced with margin (not gap)

### 15. Exit Dialogue Polish

- Rounded corners (16px)
- SamsungOne font
- Centred on screen
- Semi-transparent dark overlay behind it
- Buttons: use the new v3 pill button style from section 5

### 16. Toast Notifications Polish

- Rounded pill shape (border-radius: 24px)
- SamsungOne font
- Position: bottom-centre, above NP bar
- Subtle entrance animation: slide up + fade in (`transform: translateY(20px)` → `translateY(0)`, `opacity: 0 → 1`)

### 17. Colour Button Hints

The colour button hints (G=Favourite, Y=Add to Queue, B=Play Next, R=Remove):
- Position these consistently across screens
- Use smaller, subtler text (12px, muted colour)
- Bottom of the content area or bottom-right

### 18. Loading States

Add consistent loading indicators:
- When navigating to a new screen that needs API data: show a subtle pulsing dot or "Loading..." text centred
- Album art loading: show a placeholder with a subtle pulse animation before the image loads
- Use `opacity` animation for the pulse (GPU-friendly):
  ```css
  @keyframes pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 0.6; }
  }
  .loading-placeholder {
      animation: pulse 1.5s ease infinite;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
  }
  ```

### 19. Scrollbar Hiding

Hide browser scrollbars on all scrollable areas (they look ugly on TV):
```css
/* Hide scrollbars but keep scrolling functional */
.library-content-area::-webkit-scrollbar,
.album-detail-right::-webkit-scrollbar,
.artist-detail-right::-webkit-scrollbar,
.page-layer::-webkit-scrollbar {
    display: none;
}
```

Chromium 63 supports `::-webkit-scrollbar`.

### 20. Verify All Accent Colour Integration

Switch to each accent colour in Settings and verify EVERY element updates:
- Top nav pill (focused state = accent, selected state = grey)
- Library sub-nav pill (focused state = accent, selected state = grey)
- Play/Shuffle buttons (accent fill on focus)
- Genre gradient cards (these use fixed gradients, NOT accent — that's correct)
- Search quick access icon backgrounds (some use accent)
- NP bar play button
- NP screen controls
- Star icons
- Lyrics button active state
- Home hero glow
- Toast notifications (if any use accent)

Verify the pill convention is CONSISTENT:
- **Focused (user is actively browsing) = ACCENT colour**
- **Selected (user has entered content) = GREY/SUBTLE**
- This applies to BOTH the top nav AND the library sub-nav

### 21. Font Consistency Audit

Verify SamsungOne is used everywhere:
- Top nav items
- Page headings
- Track titles and artist names
- Settings labels
- Login screen
- All buttons
- Toast text
- NP bar text

No element should fall back to a different font unless SamsungOne isn't available (browser dev).

### 22. Spacing Consistency

Audit spacing across all screens for consistency:
- Section margins: 32px between sections
- Card grid gaps: 24px (using grid-gap)
- Track row padding: 12px vertical
- Content max-width: 1400px for grids, 1000px for lists
- Page padding: 0 48px

## DO NOT MODIFY — PROTECTED FILES
These files contain working audio, API, and authentication logic. DO NOT change them in this patch:
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client
- `js/auth.js` — authentication manager
- `js/starred.js` — favourites cache
- `js/utils.js` — pagination, helpers
- `config.xml` — Tizen widget configuration and privileges

This is a polish pass — CSS changes, layout tweaks, and minor screen JS adjustments only.

## HARDWARE ACCELERATION — MANDATORY
ALL animations MUST be GPU-composited:
- ✅ `transform` and `opacity` — GPU-composited
- ❌ Everything else — NEVER transition
- ❌ `transition: all` — NEVER use this
Verify that no previous V3 phase accidentally introduced a `transition: all` — search and fix.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- ONLY animate `transform` and `opacity`
- SamsungOne font everywhere
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Full walkthrough:
1. Login screen → clean, centred, modern
2. Login → zoom into Home
3. Home → hero looks good, sections are spaced well
4. Home → Play/Shuffle buttons: pill style, accent fill on focus, scale animation
5. Top nav → slide between all screens, transitions smooth
6. Library → sub-nav works, content cross-fades
7. Library → Albums → focus cards → scale up smoothly
8. Library → Genres → **gradient cards** with unique colours, scale on focus
9. Enter on album → zoom into Album Detail (NO on-screen back button)
10. Album Detail → Play/Shuffle buttons: v3 pill style with scale
11. Album Detail → tracks scale on focus, split-pane looks good
12. Album Detail → **press Up from top row → returns to top nav**
13. Hardware Back → zoom out to Library
14. Artist Detail → Play All/Shuffle: v3 pill style. **Press Up → returns to top nav**
15. Search → **gradient quick access cards** (no coloured left borders)
16. Search → keyboard keys scale on focus
17. Queue → items scale on focus
18. Settings → accent swatches, lyrics offset, all clean
19. Change accent to Blue → verify everything updates including pills and buttons
20. **Now Playing → toggle lyrics → slide is SMOOTH (not jerky)**
21. **Now Playing → lyrics lines scale smoothly, no layout jank**
22. NP bar → full width, hidden when no music, visible when playing
23. **Exit dialogue → v3 pill buttons, accent fill on focus, captures focus**
24. No scrollbars visible
25. No leftover v2 styles visible (no sidebar refs, no back buttons, no coloured left borders)
26. SamsungOne font rendering on all text
27. Top nav pill: accent when focused, grey when selected
28. Library sub-nav pill: accent when focused, grey when selected

### FUNCTIONAL REGRESSION CHECK (critical — all must pass):
- [ ] Play a track from Album Detail → audio plays, NP bar appears
- [ ] Play/Pause button works (remote and on-screen)
- [ ] Next/Previous track works
- [ ] Gapless playback: tracks auto-advance with minimal gap
- [ ] Synced lyrics: toggle lyrics panel — slide is SMOOTH on TV
- [ ] Lyrics line changes — scale animation is smooth, no font-size jank
- [ ] Lyrics offset: change in Settings, lyrics shift earlier/later
- [ ] Star/unstar: star an album and a track, verify in Navidrome
- [ ] Search: type query, results appear, clicking result navigates
- [ ] Search: quick access cards are icon style (no coloured left borders)
- [ ] Genres: gradient cards with unique colours (no coloured left borders)
- [ ] Queue: add to queue (Yellow), play next (Blue), remove (Red)
- [ ] Shuffle and Repeat modes work
- [ ] Accent colour: change in Settings, entire app updates including both pill bars and buttons
- [ ] Auto Now Playing: setting works (On=navigates, Off=stays)
- [ ] Login: fresh login with empty fields works
- [ ] Hardware Back button: returns to previous screen at every level
- [ ] Back from NP → returns to previous screen (NOT exit dialog)
- [ ] Up from ANY screen's top row → returns to top nav bar
- [ ] Exit dialogue: v3 pill buttons, captures focus, appears only on top-level
- [ ] NP bar: hidden when no music, visible when playing, hidden on NP screen
- [ ] No on-screen back buttons anywhere
- [ ] Play/Shuffle buttons everywhere: v3 pill style with scale on focus
- [ ] No `transition: all` — run: `grep -rn 'transition.*all' css/styles.css js/`
- [ ] No layout transitions — run: `grep -rn 'transition.*width\|transition.*height\|transition.*margin\|transition.*padding\|transition.*font-size' css/styles.css`
- [ ] No flex `gap` — run: `grep -rn '[^-]gap:' css/styles.css | grep -v 'grid-gap'`
- [ ] No old genre left-border styles — run: `grep -rn 'border-left' css/styles.css`

Update PROGRESS.md — document v3 redesign as complete.

# V3-1 — Top Navigation Bar (Replace Sidebar)

## Overview
Replace the left sidebar with a floating top navigation bar. This is the architectural foundation for the v3 UI redesign — all subsequent phases build on this new navigation model.

## Design

### Top Nav Bar
```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│        ┌─────────────────────────────────────────────────────────┐         │
│        │  Home   Library   Playlists   Queue   Now Playing  🔍  ⚙  │         │
│        │        ═══════                                          │         │
│        └─────────────────────────────────────────────────────────┘         │
│                                                                            │
│                                                                            │
│                       [ PAGE CONTENT ]                                     │
│                       (centred, full width)                                │
│                                                                            │
│                                                                            │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ [Now Playing Bar — full width]                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Nav Bar Specs
- Position: fixed at top, centred horizontally
- Shape: rounded pill container (`border-radius: 25px`)
- Background: `rgba(30, 30, 38, 0.80)` — dark, 80% opacity
- Backdrop: NO `backdrop-filter` (Chromium 63). The opacity alone provides sufficient contrast.
- Height: 50px
- Top margin: 24px from screen top
- Z-index: above page content, below NP bar modals
- Items: horizontally laid out with margin between (NOT flex gap)
- Font: `'SamsungOne', 'SamsungOneUIFW', sans-serif` — the TV's system font

### Nav Items
Order: `Home | Library | Playlists | Queue | Now Playing | 🔍 | ⚙`

- Text items: `Home`, `Library`, `Playlists`, `Queue`, `Now Playing`
- Icon items: Search (magnifying glass SVG), Settings (cog SVG)
- Each item: `padding: 8px 20px; font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.6)`

### Pill Highlight (focused item)
A sliding pill element that moves behind the focused nav item:
- Background: `rgba(255, 255, 255, 0.15)` — subtle light fill
- `border-radius: 20px`
- Moves with `transform: translateX()` — GPU-accelerated
- `transition: transform 0.25s ease`
- Text of focused item: `color: white; font-weight: 600`
- Subtle shadow: `box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3)`

### Selected Item (current page, when user has pressed Down into content)
When the user presses Down and enters the page content, the nav pill changes to "selected" state:
- Background: darker shade of accent colour — use `rgba(var(--accent-rgb), 0.4)`
- Text: `color: white`
- The pill stays on the current page's nav item
- No shadow (shadow only on focused/hovering state)

### Auto-Navigate on Slide
When the user presses Left/Right while the nav bar is focused:
1. The pill slides to the next/previous nav item (0.25s transform animation)
2. The page content below transitions simultaneously (see page transitions below)
3. NO need to press Enter/Select — navigation is automatic on focus change

### Page Transitions (cross-fade + slide)
When navigating between pages via the top nav:

**Outgoing page:**
- `opacity: 1 → 0` over 0.2s
- `transform: translateX(0) → translateX(-60px)` (if going right) or `translateX(60px)` (if going left)

**Incoming page:**
- `opacity: 0 → 1` over 0.2s (with 0.05s delay to avoid full overlap)
- `transform: translateX(60px) → translateX(0)` (if going right) or `translateX(-60px) → translateX(0)` (if going left)

Both use ONLY `transform` and `opacity` — fully GPU-accelerated.

**Implementation:**
Use two container divs that swap:
```html
<div id="page-container">
    <div id="page-current" class="page-layer"></div>
    <div id="page-incoming" class="page-layer"></div>
</div>
```

```css
.page-layer {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    will-change: transform, opacity;
    transition: transform 0.2s ease, opacity 0.2s ease;
}
```

When navigating:
1. Render new page into `#page-incoming`
2. Set incoming initial state: `opacity: 0; transform: translateX(60px)` (or -60px)
3. Trigger transition: outgoing → fade+slide out, incoming → fade+slide in
4. After transition completes (200ms), swap: incoming becomes current, clean up old

### Pressing Down — Enter Page Content
When the nav bar is focused and the user presses Down:
1. The nav pill changes from "focused" to "selected" state (accent-tinted)
2. Focus moves to the first focusable element on the page
3. The nav bar remains visible but is no longer in the active focus zone

### Pressing Up — Return to Nav Bar
When the user is in page content and presses Up at the topmost focusable row:
1. Focus returns to the nav bar
2. The nav pill changes from "selected" back to "focused" state (light fill + shadow)
3. The pill is on the correct nav item for the current page

### Nav Bar Visibility
- Always visible on all screens EXCEPT:
  - Now Playing screen (full-screen, nav bar hidden)
  - Visualiser screen (if re-added later)
  - Login screen (no nav bar)
- When hidden, page content expands to fill the space

### Icon SVGs

**Search (magnifying glass):**
```svg
<svg viewBox="0 0 24 24" width="18" height="18" fill="none">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
    <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

**Settings (cog):**
```svg
<svg viewBox="0 0 24 24" width="18" height="18" fill="none">
    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.5"/>
</svg>
```

### Background Colour
All pages now use a dark grey background instead of the current near-black:
- `--bg-main: #1a1a24` — slightly warmer dark grey, works well with all accent colours
- Apply to `body` or `#app` root

### Font
Set the global font to SamsungOne (available on all Tizen TVs):
```css
body {
    font-family: 'SamsungOne', 'SamsungOneUIFW', -apple-system, BlinkMacSystemFont, sans-serif;
}
```
This falls back gracefully in the browser.

### Layout Changes
- **Remove sidebar entirely** — delete the `#sidebar` element and all sidebar-related CSS/JS
- **Remove `#content-area` left offset** — content now starts at the left edge
- **Content area**: full width (1920px), with top padding to clear the nav bar (80px)
- **NP bar**: unchanged, full width at the bottom
- **All page content**: centred within the full width (max-width with auto margins, or centred flex)

### FocusManager Changes
The FocusManager needs significant updates:
- Remove the `sidebar` zone entirely
- Add a `topnav` zone (horizontal, 7 items)
- The `topnav` zone is active when the user presses Up from the top of any page
- Down from `topnav` enters the page's first focus zone
- Left/Right in `topnav` moves between nav items AND triggers page navigation
- The `topnav` zone wraps: Right from ⚙ goes to Home, Left from Home goes to ⚙

## Chromium 63 Constraints
- NO flex `gap` — use margin on nav items
- NO `backdrop-filter` — rely on rgba background opacity
- `transform: translateX()` and `opacity` for ALL animations
- `SamsungOne` font is a system font — no loading needed
- `will-change: transform, opacity` on animated elements
- `transition` only on `transform` and `opacity` — NEVER `transition: all`

## Files Modified
- `index.html` — remove sidebar DOM, add top nav bar DOM, add page transition containers
- `css/styles.css` — complete nav bar styles, remove sidebar styles, page transition animations, new background, font
- `js/app.js` — new nav rendering, page transition logic, remove sidebar code
- `js/focus.js` — replace sidebar zone with topnav zone, update Up/Down logic
- `js/screens/*.js` — remove any sidebar references, update content layout
- All screen files may need centring adjustments
- `PROGRESS.md`

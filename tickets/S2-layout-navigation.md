# S2 — Core Layout, Sidebar Navigation, Routing & D-Pad Focus

## Overview
Build the persistent app shell (sidebar, top bar, now playing bar), the screen routing system, and the central FocusManager for d-pad/remote navigation. After this phase, all screens are reachable via sidebar nav and keyboard navigation works throughout.

## Prerequisites
- Phase S1 complete (login working, API client, dev server running)
- Read `docs/UI-MOCKUP-REFERENCE.md` — sidebar, top bar, and now playing bar specs
- Read `docs/ARCHITECTURE.md` section 3.4 (Focus Manager)

## Tasks

### S2.1 — Screen Router
- Implement a simple screen router in `app.js`:
  - `navigateTo(screenName, params)` — activates a screen by name
  - Calls `deactivate()` on current screen, `render()` + `activate(params)` on new screen
  - Maintains a navigation history stack for Back button support
  - `goBack()` — pops history and navigates to previous screen
  - Screens are registered by name: `login`, `home`, `library`, `album`, `search`, `nowplaying`, `queue`, `playlists`, `settings`
- Screen content renders into a `#content-area` div inside the main layout
- Login screen is special — renders full-screen without the app shell (no sidebar/top bar/now playing bar)

### S2.2 — App Shell Layout
- After login, render the persistent app shell into `#app`:
  ```
  #app-shell
    #sidebar          (220px, fixed left)
    #main
      #top-bar        (60px, fixed top)
      #content-area   (scrollable, flex: 1)
      #now-playing-bar (76px, fixed bottom)
  ```
- Use CSS flexbox for the layout
- `#content-area` must scroll vertically; padding: 28px top, 100px bottom (to clear now playing bar)

### S2.3 — Sidebar
Build exactly per UI-MOCKUP-REFERENCE.md:
- Logo section: gradient icon (36×36, gradient `#e44d8a → #8a4dff`, music note SVG) + "Sonance" text + "BY SIMMO" subtitle
- Nav items list with icons (SVG inline):
  - Home, Library, Search, Playlists, Now Playing, Queue, Settings
  - Each item: 12px 24px padding, icon (22×22) + label (14px)
  - Active state: `--accent` colour, `--accent-soft` background, 2px right border
  - Focused state: subtle highlight
  - Clicking/pressing Enter navigates to that screen
- Connection status footer: green dot + "Connected" + server address from stored credentials
- If connection is lost (ping fails), show red dot + "Disconnected"

### S2.4 — Top Bar
- Left: current screen title (22px, weight 700)
- Right: placeholder stats text (12px, `--text-muted`) + user avatar circle (32px, gradient, first letter of username)
- Title updates when screen changes

### S2.5 — Now Playing Bar (Stub)
- Render the 76px bar at the bottom per mockup spec
- For now, show static placeholder content (will be wired to Player in S5):
  - Mini progress line at top (2px)
  - Album art placeholder (48px)
  - "No track playing" text
  - Disabled transport controls (prev, play/pause circle, next)
  - Volume indicator
- Clicking the bar navigates to Now Playing screen

### S2.6 — Focus Manager (focus.js)
Implement the central d-pad navigation system:

**FocusManager class:**
- `registerZone(name, config)` — registers a focus zone with items and layout (grid columns/rows or list)
- `setActiveZone(name)` — moves focus to a zone
- `moveFocus(direction)` — moves focus within current zone (up/down/left/right)
- `activateFocused()` — triggers action on focused element (Enter key)
- `goBack()` — triggers back navigation (Back key)
- `getCurrentFocused()` — returns currently focused element

**Zone Configuration:**
```javascript
{
  name: 'sidebar',
  selector: '#sidebar .nav-item',     // CSS selector for focusable items
  columns: 1,                          // Grid layout (1 = vertical list)
  onActivate: (index, element) => {},  // Enter key handler
  onFocus: (index, element) => {},     // Focus change handler
  neighbors: {                         // Zone transitions
    right: 'content',
    down: 'nowplaying-bar'             // at end of list
  }
}
```

**Key Handling:**
- Listen on `document` for `keydown`
- Arrow keys (37/38/39/40): call `moveFocus(direction)`
- Enter (13): call `activateFocused()`
- Back/Escape (10009 / 27): call `goBack()`
- Media keys (10252/10253/10412/10417): forward to Player engine directly
- Apply `.focused` CSS class to focused element, remove from previous
- Scroll focused element into view if needed

**Zone Transitions:**
- When focus reaches edge of zone and tries to move further, check `neighbors` config
- If neighbor zone exists, transition focus to that zone (first/last item depending on direction)
- Sidebar ↔ Content: Left/Right
- Content ↔ Now Playing Bar: Down at bottom / Up at top

### S2.7 — Placeholder Screens
Create minimal placeholder screens for all routes so navigation works:
- `home.js`: "Home" heading + placeholder text
- `library.js`: "Library" heading + placeholder text
- `search.js`: "Search" heading + placeholder text
- `nowplaying.js`: "Now Playing" heading + placeholder text
- `queue.js`: "Queue" heading + placeholder text
- `playlists.js`: "Playlists" heading + placeholder text
- `settings.js`: "Settings" heading + logout button (functional — calls AuthManager.logout(), navigates to login)

Each placeholder exports `render()`, `activate()`, `deactivate()`, `getFocusMap()`.

### S2.8 — Browser Testing
- Navigate between all screens via sidebar
- Keyboard navigate: arrow keys move focus in sidebar, Enter selects, Right arrow moves to content area
- Back key (Escape in browser) returns to previous screen
- Logout from Settings returns to login screen
- Focus ring visible on all focusable elements
- Screen title in top bar updates on navigation
- Connection status shows correct server address

## Acceptance Criteria
- [ ] App shell renders with sidebar, top bar, content area, now playing bar
- [ ] All 9 screens reachable via sidebar navigation
- [ ] Sidebar active state highlights correctly
- [ ] Screen title in top bar updates on navigation
- [ ] FocusManager handles d-pad navigation (arrow keys, Enter, Escape)
- [ ] Focus ring (pink outline) visible and correctly positioned on focused elements
- [ ] Focus transitions between sidebar ↔ content area work
- [ ] Back key navigates to previous screen
- [ ] Logout button works (Settings → clears session → login screen)
- [ ] Connection status shows server address and connection state
- [ ] Layout matches UI mockup (colours, spacing, dimensions)

## Update PROGRESS.md

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P15c: Two pre-release fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read js/screens/login.js — find where the server URL and port fields are populated
3. Read js/screens/settings.js — understand the full layout

## FIX 1: Clear Pre-Populated Login Fields

The login screen currently has the server URL/IP and port pre-filled (likely with the dev/test values like `192.168.0.2` and `4534`). These must be EMPTY for a public release.

**Find and fix:**
- Search `js/screens/login.js` for any `value =`, `defaultValue =`, `placeholder =`, or `.value =` assignments on the server URL and port input fields
- Search for hardcoded `192.168.0.2`, `4534`, or any IP/URL/port values
- Also check `index.html` for `value="..."` attributes on login input elements
- Check if there's a config file (e.g. `config.js`, `settings.js`, or similar) that stores default connection details

**The fix:**
- Set both fields to empty: `value = ''`
- Add placeholder text (grey hint text) instead:
  - Server URL field: `placeholder = 'Server URL (e.g. 192.168.0.1)'`
  - Port field: `placeholder = 'Port (e.g. 4533)'`
- Placeholders show as light grey hint text but the actual value is empty
- The user must type their own server details

**If the values come from localStorage** (saved from a previous login), that's fine — that's user data persisting between sessions, not hardcoded defaults. Only clear HARDCODED defaults in the source code.

## FIX 2: Settings Screen Layout — Move About to Top-Right

The Settings screen is now too long vertically with the added settings (Lyrics Offset, Accent Colour, Auto Now Playing). The About section (app name, version, platform info) at the bottom is getting truncated/cut off.

**Fix: Restructure the Settings screen as a two-column layout.**

Left column (wider, ~60%): all settings sections stacked vertically
Right column (~35%): About section pinned to the top-right

```
┌──────────────────────────────────────────────────────┐
│ Settings                                              │
├────────────────────────┬─────────────────────────────┤
│                        │  ABOUT                       │
│  PLAYBACK              │  Sonance — By Simmo          │
│  Auto Now Playing  On  │  Version 2.0                 │
│                        │  Platform: Tizen 5.0         │
│  LYRICS                │                              │
│  Lyrics Offset  0 ms   │                              │
│                        │                              │
│  APPEARANCE            │                              │
│  Accent Colour         │                              │
│  [●][●][●][●][●][●]   │                              │
│  Reset to default      │                              │
│                        │                              │
│                        │                              │
│  (scrolls if needed)   │                              │
├────────────────────────┴─────────────────────────────┤
│ [Now Playing Bar]                                     │
└──────────────────────────────────────────────────────┘
```

**Implementation:**

```css
.settings-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
}

.settings-left {
    flex: 1;
    overflow-y: auto;
    padding-right: 40px;  /* NOT flex gap — Chromium 63 */
    min-height: 0;        /* allow flex child to scroll */
}

.settings-right {
    width: 280px;
    flex-shrink: 0;
    padding-top: 8px;
}
```

Use `margin-right` or `padding-right` on the left column for spacing — NOT flex `gap`.

**About section styling (right column):**
```css
.settings-about {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    padding: 20px 24px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
}

.settings-about-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 4px;
}

.settings-about-subtitle {
    font-size: 13px;
    color: var(--accent);
    margin-bottom: 16px;
}

.settings-about-row {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 6px;
}
```

**About content:**
- App name: "Sonance"
- Tagline: "By Simmo"
- Version: read from wherever the version string is stored
- Platform: show `Tizen 5.0` on TV, `Browser` on localhost

**Move the About section** from wherever it currently lives (bottom of settings) into the right column. Remove it from the left column's content flow.

**The left column scrolls independently** if the settings list is long. The right column stays fixed. Same split-pane pattern as album detail.

**Scroll-into-view:** Use the manual scroll function for focused settings items in the left column:
```javascript
function scrollToFocused(container, element) {
    var elTop = element.offsetTop;
    var elBottom = elTop + element.offsetHeight;
    var viewTop = container.scrollTop;
    var viewBottom = viewTop + container.clientHeight;
    if (elBottom > viewBottom) {
        container.scrollTop = elBottom - container.clientHeight + 20;
    } else if (elTop < viewTop) {
        container.scrollTop = elTop - 20;
    }
}
```

**Focus zones:** All focusable settings items remain in the left column. The About section in the right column has NO focusable elements — it's purely informational.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use padding-right or margin.
- `min-height: 0` on the scrollable settings column
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Fix 1:
- Open app fresh → login screen shows empty URL and port fields
- Placeholder text is visible (grey hint)
- User can type their details and connect
- If previously logged in (localStorage), saved credentials may auto-fill — that's fine

### Fix 2:
- Open Settings → About section is in the top-right
- All settings (Playback, Lyrics, Appearance) are in the left column
- Left column scrolls if content exceeds viewport
- About section stays visible while scrolling settings
- No truncation — all content accessible

Update PROGRESS.md.

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P14e: Global Accent Colour Picker.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read css/styles.css — find all uses of `--accent`, `--accent-rgb`, `--accent-glow`, and the hardcoded hex `#e44d8a`
4. Read js/screens/settings.js — understand the settings screen layout

## PREREQUISITE
P14d must be complete. It should have added these CSS custom properties:
```css
:root {
    --accent: #e44d8a;
    --accent-rgb: 228, 77, 138;
    --accent-glow: rgba(228, 77, 138, 0.35);
}
```

If P14d didn't add these, add them now.

## FEATURE: Global Accent Colour Picker

Let the user choose a custom accent colour for the entire app. The colour replaces `--accent` everywhere — focused highlights, buttons, sidebar active, star icons, NP controls, the hero glow, etc. Persisted via localStorage.

### Step 1: Ensure ALL accent usage goes through CSS variables

Search the entire codebase for hardcoded `#e44d8a` (or `rgb(228, 77, 138)` or similar). Replace EVERY instance with `var(--accent)` or `rgba(var(--accent-rgb), ...)`.

Common places to check:
- `css/styles.css` — all focused states, active states, button fills, sidebar highlights, star colours
- `js/screens/*.js` — any inline `style.color = '#e44d8a'` or `style.background = '#e44d8a'`
- `js/app.js` — toast styles, any hardcoded accent references
- SVG inline styles — star icons, transport icons when focused

**This is the most important step.** If any accent colour is hardcoded, it won't update when the user picks a new colour. Be thorough — grep for `e44d8a`, `#e44`, `228, 77, 138`, and any pink-looking hex values in style assignments.

Replace patterns:
```
#e44d8a                    → var(--accent)
rgba(228, 77, 138, 0.X)   → rgba(var(--accent-rgb), 0.X)
style.color = '#e44d8a'    → style.color = 'var(--accent)'
```

For inline JS style assignments where CSS variables don't work (e.g. `element.style.color = 'var(--accent)'` may not work in Chromium 63), use a helper:
```javascript
function getAccentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e44d8a';
}
function getAccentRgb() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '228, 77, 138';
}
```

Then: `element.style.color = getAccentColor();`

### Step 2: Colour Picker UI in Settings

Add a new section to the Settings screen:

```
APPEARANCE
────────────────────
Accent Colour    [●] [●] [●] [●] [●] [●] [●] [●] [custom]
```

**Pre-defined colour swatches** (8 options + custom):

| Name | Hex | RGB |
|------|-----|-----|
| Pink (default) | #e44d8a | 228, 77, 138 |
| Red | #ef4444 | 239, 68, 68 |
| Orange | #f97316 | 249, 115, 22 |
| Amber | #f59e0b | 245, 158, 11 |
| Green | #22c55e | 34, 197, 94 |
| Teal | #14b8a6 | 20, 184, 166 |
| Blue | #3b82f6 | 59, 130, 246 |
| Purple | #8b5cf6 | 139, 92, 246 |

**Layout:**

```
APPEARANCE

Accent Colour

  [●] [●] [●] [●] [●] [●] [●] [●]
  Pink Red Orange Amber Green Teal Blue Purple
```

Each swatch is a focusable circle (36px diameter) filled with its colour:
```css
.accent-swatch {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2px solid transparent;
    display: inline-block;
    margin-right: 12px;  /* NOT flex gap */
    margin-bottom: 8px;
    cursor: pointer;
}

.accent-swatch.focused {
    border-color: white;
    transform: scale(1.15);
}

.accent-swatch.selected {
    border-color: white;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}
```

**D-pad navigation:**
- Left/Right moves between swatches (horizontal row)
- Enter selects a swatch and applies the colour immediately
- The currently active swatch has a white border ring (`.selected`)
- The focused swatch has a white border + slight scale (`.focused`)

**Apply on select:**
When the user presses Enter on a swatch:
1. Update CSS custom properties on `document.documentElement`:
   ```javascript
   document.documentElement.style.setProperty('--accent', hex);
   document.documentElement.style.setProperty('--accent-rgb', rgb);
   document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ', 0.35)');
   ```
2. The entire app updates instantly (all CSS using var(--accent) reflows automatically)
3. Save to localStorage:
   ```javascript
   localStorage.setItem('sonance-accent-color', hex);
   localStorage.setItem('sonance-accent-rgb', rgb);
   ```
4. Show toast: "Accent colour updated"
5. Update the `.selected` class to the new swatch

### Step 3: Load Saved Accent on App Start

In `js/app.js` init (EARLY — before any rendering):
```javascript
function loadAccentColor() {
    var savedHex = localStorage.getItem('sonance-accent-color');
    var savedRgb = localStorage.getItem('sonance-accent-rgb');
    if (savedHex && savedRgb) {
        document.documentElement.style.setProperty('--accent', savedHex);
        document.documentElement.style.setProperty('--accent-rgb', savedRgb);
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + savedRgb + ', 0.35)');
    }
}
loadAccentColor();
```

Call this BEFORE the app shell renders so the user never sees a flash of pink before their chosen colour loads.

### Step 4: Update Inline JS Styles

Any place in JS that sets accent-coloured styles inline needs updating. Search for patterns like:
- `style.color = '#e44d8a'`
- `style.background = '#e44d8a'`
- `style.borderColor = '#e44d8a'`
- `style.fill = '#e44d8a'`
- `fill="currentColor"` (these are fine — they inherit from CSS `color`)
- `stroke="#e44d8a"`

Replace with `getAccentColor()` helper or `var(--accent)` where possible.

**SVG inline styles are tricky.** For SVGs rendered in JS as innerHTML strings:
```javascript
// BAD:
var svg = '<svg><path fill="#e44d8a" .../></svg>';

// GOOD — use currentColor and set color on parent:
var svg = '<svg><path fill="currentColor" .../></svg>';
parentElement.style.color = 'var(--accent)';

// OR if var() doesn't work inline:
parentElement.style.color = getAccentColor();
```

### Step 5: Verify All Accent Surfaces Update

After applying a new colour, ALL of these should change:

- Sidebar: active item pink fill → new colour fill
- Library tabs: focused tab text → new colour
- Album cards: focused box-shadow → new colour
- Search keyboard: focused key fill → new colour
- Back buttons: focused fill → new colour
- NP bar: play button focused fill → new colour
- NP screen: play button focused fill → new colour
- NP screen: progress bar filled portion → new colour
- Star icons: focused/starred fill → new colour
- Lyrics button: active state → new colour
- Home hero: glow behind album art → new colour
- Toast notifications: any accent elements
- Play/Shuffle buttons on album/artist detail: background → new colour
- "LATEST ADDITION" label on hero: text → new colour
- Genre card left borders (if accent-coloured)

If any of these DON'T change, there's a hardcoded colour that needs replacing.

### Step 6: Reset to Default

Add a "Reset to default" option below the swatches:
```
[●] [●] [●] [●] [●] [●] [●] [●]

  Reset to default
```
This is a focusable text link. Enter resets to `#e44d8a`, removes localStorage entries, and shows toast "Accent colour reset".

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin-right on swatches.
- `var(--accent)` works in Chromium 63 CSS
- `getComputedStyle().getPropertyValue()` works in Chromium 63
- `document.documentElement.style.setProperty()` works in Chromium 63
- localStorage is available on Tizen WebView
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Functional:
1. Open Settings → Accent Colour section visible with 8 swatches
2. Default pink swatch has white border (selected)
3. Focus moves between swatches with Left/Right
4. Press Enter on Blue → entire app turns blue instantly
5. Sidebar active = blue, focused items = blue, NP play button = blue, hero glow = blue
6. Close and reopen app → blue persists
7. Go to Settings → Blue swatch still shows as selected
8. Select "Reset to default" → app returns to pink
9. Verify EVERY accent surface listed in Step 5 changes colour

### Edge cases:
- Light colours (amber) should still be visible on dark backgrounds
- The selected swatch indicator (white border) should be visible on all colour options
- Switching colours rapidly shouldn't cause flicker or lag

Update PROGRESS.md.

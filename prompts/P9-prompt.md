You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P9: Chromium 63 Compatibility Fix.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P9-v1.2.4-tizen-spacing.md for full details — READ THE WHOLE THING, the root cause explanation is critical
3. Read PROGRESS.md for current state

## CRITICAL ROOT CAUSE — READ THIS FIRST
**CSS `gap` on flexbox containers is NOT supported on Chromium 63 (Tizen 5.0).** It was added in Chrome 84. Every `gap` on a flex container is SILENTLY IGNORED on the TV, resulting in ZERO spacing. This is why the app looks perfect in modern Chrome but has no spacing on the TV.

Additionally, the modern `gap` shorthand for grid was added in Chrome 66. On Chromium 63, only the legacy `grid-gap` property works.

## WHAT YOU MUST DO:

### Step 1: Find EVERY instance of `gap` in the codebase
Search all CSS and JS files:
```bash
grep -rn "gap" css/ js/ --include="*.css" --include="*.js"
```
This includes `gap:` in CSS, `.gap =` in JS, `gap:` in template strings, and `style.gap` assignments.

### Step 2: For each instance, determine if it's on a flex or grid container

### Step 3: Replace according to these rules:

**FLEX containers — replace `gap` with `margin` on children:**
```css
/* BEFORE (broken on Tizen): */
.flex-row { display: flex; gap: 20px; }

/* AFTER (works everywhere): */
.flex-row { display: flex; }
.flex-row > * + * { margin-left: 20px; }

/* For flex-direction: column: */
.flex-col > * + * { margin-top: 20px; }
```
In JS where elements are created dynamically, add `marginLeft` or `marginTop` directly to child elements (all except the first child).

**GRID containers — replace `gap` with `grid-gap`:**
```css
/* BEFORE: */
.grid { display: grid; gap: 20px 16px; }

/* AFTER: */
.grid { display: grid; grid-gap: 20px 16px; }
```

### Step 4: Fix the login highlight regression
```css
.login-card input { outline: none; -webkit-tap-highlight-color: transparent; }
.login-card input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 2px rgba(228,77,138,0.3) !important; }
```

### Step 5: Remove debug overlay from js/app.js

### Step 6: Final audit — confirm zero flex gap remaining:
```bash
grep -rn "gap" css/ js/ --include="*.css" --include="*.js" | grep -v "grid-gap" | grep -v "// " | grep -v "padding"
```
Manually verify each remaining match is NOT a flex gap.

### Step 7: Rebuild Sonance.wgt

RULES:
- Vanilla JS, ES2017. No ?., ??, Array.flat(), Object.fromEntries().
- No `gap` on flex containers — use margin instead.
- No `gap` on grid containers — use `grid-gap` instead.
- Run autonomously.

## THIS IS THE MOST IMPORTANT PATCH SO FAR
Every spacing issue on the TV traces back to this single Chromium 63 incompatibility. Get this right and all the spacing problems disappear.

Update PROGRESS.md — document the Chromium 63 flex gap finding prominently. This is critical knowledge for future development.

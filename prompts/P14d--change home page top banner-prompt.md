You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P14d: Fix Home Screen Hero Gradient.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read js/screens/home.js — find where the hero/featured section is rendered
4. Read css/styles.css — find the hero section styles

## THE PROBLEM
The home screen hero section (Latest Addition / Recently Played) has a green gradient background that doesn't match the app's pink accent colour scheme. The green likely comes from extracting colours from the album art — this looks inconsistent.

## THE FIX: Accent Glow Behind Album Art (Option E)

Replace the current hero gradient with a subtle accent-coloured radial glow positioned behind the album art. The rest of the hero background is the standard dark app background.

**Design:**
- Hero background: `#0d0d12` (standard app dark background, or `var(--bg-main)` if defined)
- Behind the album art: a radial gradient glow using the accent colour at low opacity
- The glow is a pseudo-element or absolutely positioned div, NOT a full-width gradient

**Implementation:**

The hero section should have `position: relative; overflow: hidden;` and the glow is an absolutely positioned element:

```css
.hero-section {
    position: relative;
    overflow: hidden;
    background: var(--bg-main, #0d0d12);
    border-radius: 12px;
    padding: 24px 32px;
}

.hero-glow {
    position: absolute;
    /* Position centred on where the album art sits */
    left: 32px;       /* match the album art's left position */
    top: 50%;
    transform: translateY(-50%);
    width: 250px;     /* slightly larger than the album art */
    height: 250px;
    background: radial-gradient(circle, rgba(228, 77, 138, 0.35) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
}

.hero-content {
    position: relative;
    z-index: 1;       /* content sits above the glow */
}
```

**IMPORTANT:** Use the accent colour for the glow. Currently the accent is `#e44d8a`. To make this ready for a future accent colour picker, use `var(--accent)` if it's defined as a CSS custom property, or use the hardcoded value with a comment noting it should become a variable.

Check if `--accent` is already defined in styles.css as a CSS custom property. If so, use it:
```css
/* If --accent is defined as a CSS variable: */
background: radial-gradient(circle, var(--accent-glow, rgba(228, 77, 138, 0.35)) 0%, transparent 70%);
```

If `--accent` is not yet a CSS variable, add it to the `:root` or body selector:
```css
:root {
    --accent: #e44d8a;
    --accent-rgb: 228, 77, 138;  /* RGB components for rgba() usage */
    --accent-glow: rgba(228, 77, 138, 0.35);
}
```

Then use:
```css
.hero-glow {
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.35) 0%, transparent 70%);
}
```

**Note on `rgba(var(--accent-rgb), 0.35)`:** This pattern works in Chromium 63 as long as `--accent-rgb` contains comma-separated numbers (e.g. `228, 77, 138`). Test this works — if not, fall back to a separate `--accent-glow` variable.

### Remove Old Gradient Logic
Find wherever the current green gradient is generated. It may be:
- Extracting dominant colour from album art via canvas
- A hardcoded green gradient
- A CSS class applied to the hero section

Remove it entirely and replace with the simple dark background + glow approach.

### Glow Positioning
The glow should be centred on the album art image. If the album art is positioned at `left: 32px` and is `160px` wide, the glow centre should be at approximately `left: 32px + 80px = 112px` (centre of the art). Adjust the glow div's left position and use `transform: translate(-50%, -50%)` for centre alignment:

```css
.hero-glow {
    position: absolute;
    left: 112px;  /* centre of album art — adjust based on actual layout */
    top: 50%;
    transform: translate(-50%, -50%);
    width: 280px;
    height: 280px;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.35) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
}
```

Or more robustly, place the glow div INSIDE the album art container and use CSS to make it overflow:
```html
<div class="hero-art-wrapper" style="position:relative;">
    <div class="hero-glow"></div>
    <img class="hero-art" src="..." />
</div>
```
```css
.hero-art-wrapper {
    position: relative;
    z-index: 0;
}
.hero-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 280px;
    height: 280px;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.35) 0%, transparent 70%);
    pointer-events: none;
    z-index: -1;
}
```

This approach means the glow automatically follows the album art regardless of layout changes.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- Do NOT use `backdrop-filter` or `filter: blur()` for the glow — use `radial-gradient` (it's GPU-composited and cheap)
- Define `--accent`, `--accent-rgb`, and `--accent-glow` as CSS custom properties if not already done — future patches will use these for the accent colour picker
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
- Home screen: hero section shows dark background with a subtle pink glow behind the album art
- No green gradient anywhere
- The glow is centred on the album art, not spanning the full width
- The glow colour matches the accent pink (#e44d8a)
- All text in the hero is readable (glow is subtle, not overpowering)
- Other screens unaffected

Update PROGRESS.md.

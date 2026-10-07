You are patching Sonance — a music player app for Samsung Tizen TVs. This is an URGENT performance fix for P14b: lyrics slide animation is slow and jittery on the TV.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read js/screens/nowplaying.js — find the lyrics toggle animation
2. Read css/styles.css — find .np-layout, .np-left, .np-lyrics-panel transition rules

## THE PROBLEM
The lyrics slide-in animation is jittery on the Samsung TV. The TV's GPU cannot smoothly animate layout-triggering CSS properties.

## ROOT CAUSE
CSS `transition` on these properties triggers a full layout recalculation EVERY FRAME:
- `width` (shrinking album art from 280px to 220px)
- `padding-left` / `padding` (shifting the layout)
- `justify-content` (changing flex alignment)
- `font-size` (lyrics line size changes)
- `max-width`, `flex`, `left`, `right`

The TV GPU can ONLY hardware-accelerate two properties cheaply:
- `transform` (translateX, translateY, scale)
- `opacity`

Everything else goes through the CPU layout engine, which is slow on the Q90R.

## THE FIX: Transform-Only Animation

### Rule: NEVER animate layout properties. ONLY animate transform and opacity.

### Step 1: Replace ALL transition rules on lyrics-related elements

Find and replace every `transition: all 0.4s ease` or similar on:
- `.np-layout`
- `.np-left`
- `.np-lyrics-panel`
- `.lyrics-active` related rules

Replace with transitions that ONLY target transform and opacity:

```css
.np-left {
    transition: transform 0.25s ease, opacity 0.25s ease;
    will-change: transform;
}

.np-lyrics-panel {
    transition: transform 0.25s ease, opacity 0.25s ease;
    will-change: transform, opacity;
}
```

**NEVER use `transition: all`** — it transitions every changed property including layout ones.

### Step 2: Rewrite the lyrics toggle

**Lyrics OFF → ON:**
Instead of changing widths, padding, and justify-content, do this:

1. The `.np-left` section uses `transform: translateX(-Xpx)` to slide left
2. The album art snaps to smaller size INSTANTLY (no transition on width/height)
3. The `.np-lyrics-panel` uses `transform: translateX(0)` + `opacity: 1` to slide in from the right

```css
/* Default state: lyrics OFF */
.np-left {
    transform: translateX(0);
    transition: transform 0.25s ease;
    will-change: transform;
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
    overflow: hidden;
}

/* Lyrics ON */
.np-layout.lyrics-active .np-left {
    transform: translateX(-80px);  /* slide left */
}

.np-layout.lyrics-active .np-lyrics-panel {
    transform: translateX(0);     /* slide in from right */
    opacity: 1;
}
```

**Album art size change — INSTANT, no transition:**
```css
.np-album-art {
    /* NO transition on width/height */
    width: 280px;
    height: 280px;
}

.np-layout.lyrics-active .np-album-art {
    width: 220px;
    height: 220px;
    /* The size snaps instantly — only the translateX slides */
}
```

### Step 3: Lyrics line highlighting — NO font-size animation

The lyrics scroller currently animates `font-size` between 18px and 22px when a line becomes active. Font-size changes trigger layout reflow on EVERY line element.

**Fix: use transform: scale() instead of font-size change.**

All lines render at the SAME font-size (18px). The active line uses `transform: scale(1.15)` to appear larger:

```css
.lyrics-line {
    font-size: 18px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.5);
    padding: 10px 0;
    transition: transform 0.2s ease, opacity 0.2s ease;
    transform-origin: left center;
    will-change: transform, opacity;
    /* NO transition on font-size, font-weight, or color */
}

.lyrics-line.lyrics-active {
    transform: scale(1.15);
    opacity: 1;
    color: white;           /* snaps instantly — no transition */
    font-weight: 700;       /* snaps instantly — no transition */
}

.lyrics-line.lyrics-upcoming {
    transform: scale(1);
    opacity: 0.5;
    color: rgba(255, 255, 255, 0.5);
}

.lyrics-line.lyrics-past {
    transform: scale(1);
    opacity: 0.25;
    color: rgba(255, 255, 255, 0.25);
}
```

The `color` and `font-weight` changes snap instantly (no transition on those properties). Only `transform` and `opacity` are transitioned — both GPU-composited.

### Step 4: Lyrics auto-scroll — already using translateY (good)

The LyricsScroller already uses `transform: translateY()` for scrolling — this is correct and GPU-friendly. Keep it but reduce the transition duration:

```javascript
this._container.style.transition = 'transform 0.3s ease';  // was 0.5s
this._container.style.transform = 'translateY(' + (-targetScroll) + 'px)';
```

### Step 5: Remove ALL will-change after animation completes (optional optimisation)

`will-change` reserves GPU memory. On a TV with limited VRAM, having too many `will-change` elements can cause issues. Only set it on elements that are actively animating:

```javascript
// When toggling lyrics ON:
npLeft.style.willChange = 'transform';
lyricsPanel.style.willChange = 'transform, opacity';

// After animation completes (250ms later):
setTimeout(function() {
    npLeft.style.willChange = 'auto';
    // Keep will-change on lyrics panel since lines will keep animating
}, 300);
```

### Step 6: Reduce animation duration

0.4s is too long for the TV — it exposes the jank. Use 0.25s for the slide, 0.2s for opacity:
- Slide: `transition: transform 0.25s ease`
- Fade: `transition: opacity 0.2s ease`
- Lyrics scroll: `transition: transform 0.3s ease`
- Line highlight: `transition: transform 0.2s ease, opacity 0.2s ease`

### Summary of what MUST NOT be transitioned:
- ❌ `width`, `height` (album art resize)
- ❌ `padding`, `margin` (layout shift)
- ❌ `left`, `right`, `top`, `bottom` (use transform instead)
- ❌ `font-size`, `font-weight` (lyrics line highlight)
- ❌ `justify-content`, `align-items` (flex reflow)
- ❌ `max-width`, `flex`, `flex-shrink`
- ❌ `transition: all` (catches everything above)

### Summary of what CAN be transitioned:
- ✅ `transform` (translateX, translateY, scale)
- ✅ `opacity`
- That's it. Nothing else.

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- ONLY transition `transform` and `opacity`
- NEVER use `transition: all`
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
Browser:
- Toggle lyrics → slide animation is snappy (0.25s)
- Active lyrics line scales up smoothly
- Auto-scroll is smooth
- No visible jank or stutter

TV (when deployed):
- Toggle lyrics → slide should now be smooth
- Lyrics line changes should be smooth
- No frame drops visible

Update PROGRESS.md.

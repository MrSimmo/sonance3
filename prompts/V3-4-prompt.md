You are performing a major UI redesign on Sonance — a music player app for Samsung Tizen TVs. This is V3-4: Item Focus Redesign.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — V3-1, V3-2, V3-3 must be complete
3. Read css/styles.css — find all current focus/highlight styles
4. Read js/screens/*.js — find inline focus style assignments

## FEATURE: Modern Focus Style — Scale + Enlarge, No Borders

Replace the current border/box-shadow/outline focus indicators with a modern scale-up animation on focus. Focused items enlarge smoothly and lift slightly, like Apple Music's TV UI.

### What Changes

**OLD (v2) focus style:**
- Album cards: thin accent `box-shadow`, slight scale
- Track rows: subtle background highlight
- Buttons: accent text colour or fill
- Genre cards: accent border

**NEW (v3) focus style:**
- Album/artist/genre/playlist cards: `transform: scale(1.08)` + slight lift shadow
- Track rows: `transform: scale(1.02)` on the row + brighter text
- Buttons: unchanged (accent fill on focus is fine)
- Search results: same as track rows

### Album/Artist Card Focus

```css
.card-item {
    transition: transform 0.15s ease, opacity 0.15s ease;
    will-change: transform;
    transform-origin: center center;
}

.card-item.focused {
    transform: scale(1.08);
    z-index: 5;  /* lift above neighbours */
}

/* Remove old focus styles */
.card-item.focused {
    box-shadow: none !important;    /* remove old accent shadow */
    outline: none !important;        /* remove any outline */
    border-color: transparent !important;  /* remove accent border */
}
```

The enlarged card naturally draws the eye without needing a coloured border. The scale-up IS the focus indicator.

### Album Art Enlargement Detail

When a card is focused, the album art and text below it both scale up together. The card container scales, not the art alone:

```css
.card-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: transform 0.15s ease;
    will-change: transform;
    transform-origin: center center;
    border-radius: 8px;
}

.card-item.focused {
    transform: scale(1.08);
    z-index: 5;
}

/* Subtle shadow on focused card to create lift effect */
.card-item.focused .card-art {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

### Track/Song Row Focus

Track rows in album detail, queue, search results, and song lists:

```css
.track-row {
    transition: transform 0.12s ease, background 0s;
    will-change: transform;
    transform-origin: left center;
    border-radius: 8px;
}

.track-row.focused {
    transform: scale(1.02);
    background: rgba(255, 255, 255, 0.06);
}

.track-row.focused .track-title {
    color: white;
    font-weight: 600;
}

/* Remove old focus styles */
.track-row.focused {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
}
```

The row slightly expands horizontally (2%) with a subtle background. `transform-origin: left center` means it grows rightward, keeping the track number/art aligned.

### Genre Card Focus

```css
.genre-card {
    transition: transform 0.15s ease;
    will-change: transform;
    transform-origin: center center;
}

.genre-card.focused {
    transform: scale(1.08);
    z-index: 5;
}

/* Remove old coloured left border on focus */
.genre-card.focused {
    border-left: none !important;
    border-color: transparent !important;
}
```

### Playlist Card Focus
Same as album cards — `scale(1.08)` on focus.

### Search Result Items
Same as track rows — `scale(1.02)` with subtle background.

### Artist Detail — Discography Album Rows
```css
.artist-album-row {
    transition: transform 0.12s ease;
    will-change: transform;
    transform-origin: left center;
}

.artist-album-row.focused {
    transform: scale(1.03);
}

.artist-album-row.focused .artist-album-art {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
```

### Similar Artist Cards (in Artist Detail)
Same as album cards — `scale(1.08)`.

### Sliding Animation Between Grid Items

When the user moves between cards in a grid with Left/Right/Up/Down, the PREVIOUSLY focused card should smoothly scale back down while the newly focused card scales up. This happens naturally with CSS transitions — no JS animation needed. The CSS `transition: transform 0.15s ease` handles both the scale-up of the new item and the scale-down of the old one.

For the movement to feel fluid, the transition should be SHORT (0.12-0.15s). Longer transitions feel sluggish on d-pad navigation.

### Remove ALL Old Focus Indicators

Search the entire codebase for old focus styles and remove them:

```bash
# Find in CSS:
grep -n 'box-shadow.*accent\|box-shadow.*e44d8a\|box-shadow.*var(--accent)' css/styles.css
grep -n 'border.*accent\|border.*e44d8a\|outline.*accent' css/styles.css
grep -n '\.focused.*box-shadow\|\.focused.*border\|\.focused.*outline' css/styles.css

# Find in JS (inline styles):
grep -rn 'boxShadow\|box-shadow.*accent\|borderColor.*accent\|outline.*accent' --include='*.js' js/
```

Remove or replace every instance. The ONLY focus indicators in v3 are:
1. `transform: scale()` — cards and rows
2. `background` colour — subtle bg on rows
3. `color: white` + `font-weight: 600` — text brightening
4. Pill highlight — top nav and library sub-nav (already done in V3-1 and V3-3)
5. Accent fill — buttons (Play, Shuffle, NP controls) — this stays

### Centralised Content Layout

All grid layouts should be centred within the page, not left-justified:

```css
.album-grid, .artist-grid, .genre-grid, .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    grid-gap: 24px;  /* grid-gap not gap — Chromium 63 */
    justify-content: center;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 48px;
}
```

For grids with fewer items than a full row, `justify-content: center` centres them. For full rows, items distribute evenly.

Track lists, queue, and song lists:
```css
.track-list, .song-list, .queue-list {
    max-width: 1000px;
    margin: 0 auto;
}
```

### Overflow Handling for Scaled Items

When items at the edge of the screen scale up, they might clip. Add padding/margin to grid containers so edge items have room to grow:

```css
.album-grid {
    padding: 16px 48px;  /* extra padding so scaled edge items aren't clipped */
    overflow: visible;
}
```

Or ensure the grid's parent has `overflow: visible` (not `hidden`) in the horizontal direction.

## DO NOT MODIFY — PROTECTED FILES
These files contain working audio, API, and authentication logic. DO NOT change them in this patch:
- `js/player.js` — AVPlay + HTML5 Audio engine, gapless playback
- `js/api.js` — Subsonic REST API client
- `js/auth.js` — authentication manager
- `js/starred.js` — favourites cache
- `js/utils.js` — pagination, helpers
- `config.xml` — Tizen widget configuration and privileges

You may modify screen files (`js/screens/*.js`) and `css/styles.css` for focus style changes only.

## HARDWARE ACCELERATION — MANDATORY
ALL animations MUST be GPU-composited:
- ✅ `transform` (scale, translateX/Y) and `opacity` — GPU-composited
- ❌ `width`, `height`, `margin`, `padding`, `font-size`, `border`, `box-shadow` — CPU reflow/paint, NEVER transition
- ❌ `transition: all` — NEVER use this

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- ONLY animate `transform` and `opacity` — no `width`, `height`, `margin`, `font-size`
- Transition duration: 0.12-0.15s (snappy for d-pad)
- `will-change: transform` on focusable items
- `transform-origin: center center` for cards, `left center` for rows
- Remove ALL old border/outline/box-shadow focus indicators
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
1. Library Albums → focus an album card → it scales up smoothly (1.08x)
2. Move Right → previous card scales down, new card scales up — fluid
3. Move Down to next row → smooth
4. No coloured borders, outlines, or box-shadows on focused items
5. Track rows in Album Detail → focused row slightly expands (1.02x) with subtle bg
6. Genre cards scale up on focus
7. Artist cards scale up on focus
8. Search results: rows expand slightly
9. All grids are centred (not left-justified)
10. Edge items don't clip when scaled
11. NP transport controls: still use accent fill (unchanged)
12. Play/Shuffle buttons: still use accent fill (unchanged)

Update PROGRESS.md.

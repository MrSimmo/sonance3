You are updating the CLAUDE.md project rules file for Sonance — a music player app for Samsung Tizen TVs — to reflect the v3 UI redesign.

BEFORE WRITING ANY CODE:
1. Read the current CLAUDE.md

## WHAT TO UPDATE

Add a new section at the top called "## v3 UI Design System" with these rules. Do NOT remove existing Tizen constraints or project rules — add to them.

### Add this content:

```markdown
## v3 UI Design System (current)

### Navigation
- **Top nav bar** replaces the sidebar. Floating, centred, pill-shaped container with 80% opacity dark background.
- Nav items: Home, Library, Playlists, Queue, Now Playing, Search (🔍 icon), Settings (⚙ icon)
- **Sliding pill highlight** behind focused item — moves with `transform: translateX()`. Light fill when focused, accent-tinted when selected.
- **Auto-navigate on slide** — Left/Right in nav bar immediately transitions to the page, no Enter needed.
- **Down enters page content**, Up returns to nav bar.
- There is NO sidebar. Do not create or reference a sidebar.

### Library Sub-Navigation
- Vertical pill menu on the left side of the Library screen (Albums, Artists, Songs, Genres).
- Same sliding pill pattern as the top nav but vertical (`translateY`).
- Auto-navigate on Up/Down. Right enters content, Left returns to sub-nav.

### Transitions (ALL must be GPU-accelerated)
- **Page slide** (top nav Left/Right): outgoing page slides + fades out, incoming slides + fades in. `transform: translateX()` + `opacity`.
- **Zoom in** (Enter on item → sub-page): outgoing `scale(1.08) + opacity:0`, incoming starts at `scale(0.92)` and animates to `scale(1)`.
- **Zoom out** (Back from sub-page): reverse of zoom in.
- **Cross-fade** (library tab switch): simple `opacity` fade, 0.15s.

### Focus Styles
- **Cards** (album, artist, genre, playlist): `transform: scale(1.08)` on focus. NO border, NO outline, NO box-shadow highlight.
- **Track/song rows**: `transform: scale(1.02)` + subtle background. `transform-origin: left center`.
- **Buttons** (Play, Shuffle, NP controls): accent fill on focus (unchanged from v2).
- **Nav pills**: sliding pill highlight (top nav and library sub-nav).
- Transition duration: 0.12-0.15s for focus changes, 0.2-0.25s for page transitions.

### Layout
- Full-width (1920px). Content centred with `max-width: 1400px; margin: 0 auto;`.
- Background: `--bg-main: #1a1a24` (warm dark grey).
- Font: `'SamsungOne', 'SamsungOneUIFW', sans-serif` (system font on Tizen).
- No sidebar offset — content starts at left edge.

### Animation Rules (CRITICAL)
- ONLY animate `transform` and `opacity` — these are GPU-composited.
- NEVER use `transition: all` — it catches layout properties.
- NEVER transition `width`, `height`, `margin`, `padding`, `left`, `right`, `font-size`, `border`.
- Properties like `color`, `background`, `font-weight` should snap instantly (no transition).
- Use `will-change: transform, opacity` on elements that animate.
- Keep durations short: 0.12-0.25s maximum.
```

### Also update:
- Remove any references to "sidebar" in the existing rules
- Update the "UI Highlight System" table if it exists — replace with the v3 focus system (scale, no borders)
- Keep ALL existing Tizen 5.0 constraints, Chromium 63 limitations, and build/deploy instructions unchanged

DO NOT modify any other files. ONLY update CLAUDE.md. Run autonomously.

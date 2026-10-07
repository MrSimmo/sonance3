You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P5a: v1.2 Visual & Layout Refinements.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P5-v1.2-refinements.md — do tasks P5.1, P5.4, P5.5, P5.6, P5.9 in this session
3. Read PROGRESS.md for current state

This session handles VISUAL/CSS tasks only:

### P5.1 — Library Grid Vertical Scroll
- Library Albums and Artists tabs: grids must wrap to fill width and scroll vertically
- Set overflow-x: hidden, overflow-y: auto on the scroll container
- Do NOT change Home screen horizontal rows — those stay horizontal

### P5.4 — Highlight Style Overhaul
This is the most important change. Different highlight styles for different contexts:

**Now Playing transport controls (shuffle, prev, play/pause, next, repeat):**
- NO pink outline box. When focused: tint the icon with --accent colour. Play/pause circle gets a subtle pink glow (box-shadow: 0 0 20px rgba(228,77,138,0.5)). No scale transform on these.

**Sidebar nav items:**
- Remove ALL pink outline boxes and right-hand borders from sidebar items
- Active item (current screen): full-width --accent background fill, white text, white icon, border-radius 8px, margin 0 12px. No border at all.
- Focused item (d-pad hovering, not the active screen): text and icon change to --accent colour, font-weight 600. No background, no border.
- Unfocused/inactive: --text-secondary, normal weight

**Library cards, album cards, playlist cards:**
- Keep pink outline but thinner: 1.5px, outline-offset 2px
- Keep scale(1.04)

**Search keyboard, queue rows, tracklist rows:**
- Keep current styles (background highlight)

### P5.5 — Remove Sidebar Right Border
- Covered by P5.4 — ensure no border-right on active sidebar item

### P5.6 — Album Detail: Smaller Cover Art, Fix Clipped Highlight
- Reduce album art from 300px to 240px
- Reduce left panel from 300px to 260px
- Fix clipped outlines on library album cards: add padding to grid container (6px) so outlines aren't clipped by overflow. Or switch from outline to box-shadow: 0 0 0 1.5px var(--accent) which isn't clipped.

### P5.9 — Search Screen: Larger Keyboard
- Keyboard panel: increase from 380px to ~480px
- Key font size: 16px → 18px
- Increase key padding
- Search input font: 18px
- Quick Access: reduce to 2-column grid
- SPACE/DEL keys: proportionally larger

RULES:
- Vanilla JS, ES2017 only. No ?., ??, Array.flat(), Object.fromEntries().
- No backdrop-filter. No external URLs.
- CSS `filter: blur()` IS allowed (it's supported on Chromium 63).
- Run autonomously.
- Test all modified screens in browser at 1920×1080.

Update PROGRESS.md with v1.2a changes.

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P4a: v1.1 Visual & Layout Tweaks.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P4-v1.1-tweaks.md — complete all tasks EXCEPT P4.5 (shuffle/repeat testing) and P4.7 (queue colour buttons). Those are handled in P4b.
3. Read PROGRESS.md for current state

IMPORTANT: This is a large patch split into two sessions to avoid compaction. This session (P4a) handles:
- P4.1 — Shrink album art in library grid (8 columns)
- P4.2 — Remove volume controls from ALL screens (Now Playing, NP bar, Settings)
- P4.3 — Enlarge icon SVG content in login screen and sidebar
- P4.4 — Remove the entire top bar from the app shell
- P4.6 — Move connection status from sidebar to Settings screen
- P4.8 — Validate viewport is set to width=1920
- P4.9 — Add "Recently Added" section to Home screen
- P4.10 — Shrink play button on Now Playing (68px → 52px)
- P4.11 — Redesign genre cards (dark cards with curated coloured left border, no rainbow gradients)
- P4.12 — Rebuild wgt

DO NOT do P4.5 (shuffle/repeat deep testing) or P4.7 (colour buttons/queue management) in this session.

RULES:
- Vanilla JS, ES2017 only. No ?., ??, Array.flat(), Object.fromEntries().
- No backdrop-filter. No external URLs.
- Run autonomously.

GENRE CARD REDESIGN (P4.11) — use this exact palette cycling by index:
```
#6366f1, #8b5cf6, #e44d8a, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6
```
Cards: --bg-card background, 1px --border border, 3px coloured left border, border-radius 0 (since single-side coloured border). Apply to Library genres AND Search Quick Access.

When complete, test all modified screens in browser and rebuild Sonance.wgt.
Update PROGRESS.md with v1.1a changes.

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P10a: Highlight & Focus Fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially the Tizen 5.0 Constraints section about NO flex `gap`
2. Read tickets/P10-v1.3-polish.md — do tasks P10.1, P10.2, P10.3 only
3. Read PROGRESS.md

THREE simple highlight fixes:

### P10.1 — Search keyboard keys: pink fill on focus
Focused key: `background: var(--accent); color: white`
Unfocused key: `background: var(--bg-card); color: var(--text-secondary)`
Apply to all keys including SPACE and DEL. No outline/border — just background fill.

### P10.2 — Back button: visible rounded rect, pink fill on focus
The back button on sub-pages should ALWAYS be a visible rounded rectangle (not floating text):
- Unfocused: `background: rgba(255,255,255,0.06); color: var(--text-secondary); padding: 8px 20px; border-radius: 10px; border: 1px solid var(--border)`
- Focused: `background: var(--accent); color: white; border-color: var(--accent)`
- Override `.focusable.focused` for back buttons: `outline: none; transform: none`

### P10.3 — NP bar play/pause: pink fill on focus
The play/pause button in the persistent bottom Now Playing bar should turn pink when focused:
- Unfocused: white background, dark icon
- Focused: `background: var(--accent)`, white icon
- Add specific CSS rule for the NP bar play button focused state

RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap` for grids.
- Run autonomously.

Update PROGRESS.md.

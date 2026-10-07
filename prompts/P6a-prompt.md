You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P6a: Highlight Consistency & Layout Fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P6-v1.2.1-bugfixes.md — do tasks P6.3, P6.4, P6.5, P6.6, P6.7, P6.8, P6.9, P6.11 in this session
3. Read PROGRESS.md for current state

THIS IS THE HIGHLIGHT CONSISTENCY PASS. The core problem is that focused elements use different highlight styles inconsistently. After this patch, the rule is:

**NO pink outline/border boxes on focused elements EXCEPT album/playlist cards and login inputs.**

Everything else uses either pink text, pink fill, or pink colour tint. Here's the full table:

| Element | Focus Style |
|---|---|
| Sidebar nav | Active: pink fill. Focused: pink bold text only |
| Library tabs | Focused: pink bold text only, NO outline |
| Hero Play/Shuffle | Focused: brighter pink fill or filter:brightness(1.15), NO outline |
| Album/playlist cards | Focused: box-shadow 0 0 0 1.5px accent (NOT outline), scale 1.04 |
| Track/queue rows | Focused: subtle bg highlight only |
| NP transport icons | Focused: icon colour → pink only, NO border/glow |
| NP play/pause circle | Focused: box-shadow glow, NO size change |
| Search keys | Focused: bg colour change |
| Dialogue buttons | Focused: pink fill, NO outline |
| Login inputs | Focused: pink outline (kept for IME compat) |

IMPORTANT: Many elements currently get a pink outline from a generic `.focusable.focused` CSS rule. You need to OVERRIDE this for specific element types. The safest approach is:
1. Keep the generic `.focusable.focused { outline: 1.5px solid var(--accent); }` rule
2. Add specific overrides: `.sidebar-item.focused { outline: none !important; }`, `.np-control.focused { outline: none !important; }`, etc.

Also fix in this session:
- P6.4: Add 32px gap between search keyboard and results panels
- P6.5: Track rows — use inset box-shadow instead of outline, no layout shift, no scale
- P6.6: Artist grid — add padding to container or use box-shadow instead of outline
- P6.9: Album detail — cover art 200px, left panel 220px, more spacing between elements
- P6.11: Exit dialogue — Cancel focused = pink fill, Exit = consistent #ef4444 red, focused = #dc2626

RULES:
- Vanilla JS, ES2017. No ?., ??
- No backdrop-filter. filter: blur() is fine.
- Run autonomously.

Update PROGRESS.md with P6a changes.

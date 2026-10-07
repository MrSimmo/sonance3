You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P7: Final polish fixes.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P7-v1.2.2-fixes.md for all 6 issues
3. Read PROGRESS.md for current state
4. Inspect the current CSS carefully — most of these are caused by the generic `.focusable.focused` rule leaking styles onto elements that need custom focus behaviour

## THE CORE PRINCIPLE FOR THIS PATCH
**Focused elements should change as LITTLE as possible.** The user's feedback is clear: no shape changes, no size changes, no background fills (except the Play button which is already pink). Focus = pink text/icon only, or subtle glow on the NP play button. That's it.

## Six fixes, all mostly CSS:

### P7.1 — NP Screen Black Bar
The NP screen background doesn't reach the bottom. The NP screen root container MUST be `position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden;` inside `#content-area`. The content area itself needs `padding: 0` and `overflow: hidden` when NP is active. If the content area is a flex child, ensure it has `flex: 1; min-height: 0;` and the NP screen fills it completely. Check for any `margin-bottom` or `padding-bottom` that creates the gap.

### P7.2 — NP Play/Pause: Keep Rounded Rectangle, Turn Pink on Focus
The button MUST always be `border-radius: 16px` (rounded rectangle, NOT circle). Same dimensions in both states. Unfocused: white bg, dark icon. Focused: `background: var(--accent)`, white icon, subtle glow. NO size change, NO border-radius change. Check if there's a `.focused` rule changing `border-radius` to `50%` or swapping elements.

### P7.3 — Library Tabs: No Shape Change on Focus
Override for tab elements: `transform: none !important; padding: same !important; border-radius: same !important;` when focused. Active+focused tab: only text colour → pink. Nothing else changes.

### P7.4 — Home Shuffle: Text Pink Only, No Background Fill
Shuffle focused: keep existing background (`rgba(255,255,255,0.08)`), only change text/icon colour to `--accent`. Remove any rule that sets `background: var(--accent)` on the shuffle button when focused. Play button is different — it's already pink, so focus = `filter: brightness(1.15)`.

### P7.5 — Album Grid: Force Consistent Card Sizes
Use the padding-bottom aspect ratio trick (NOT `aspect-ratio` CSS property — unsupported on Chromium 63):
```css
.album-art-wrapper { width: 100%; height: 0; padding-bottom: 100%; position: relative; overflow: hidden; border-radius: 8px; }
.album-art-wrapper img, .album-art-wrapper .placeholder { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
```
Apply to ALL album art containers in the Library grid. Text goes below the wrapper, outside it.

### P7.6 — Exit Dialogue: Both Buttons Same Style, Pink Text on Focus
Both Cancel and Exit buttons: identical appearance when unfocused (`--bg-elevated` bg, `--text-primary` text). When focused: same background, `color: var(--accent); font-weight: 600`. No pink fill, no red colour. Just pink text.

RULES:
- Vanilla JS, ES2017. No ?., ??
- No `aspect-ratio` CSS property (Chromium 63 doesn't support it)
- Run autonomously
- Rebuild Sonance.wgt when done

Test at 1920×1080 in browser:
- NP screen: no black bar, play button stays rounded-rect and turns pink
- Library: tabs don't change shape, album cards all same size
- Home: shuffle only turns text pink
- Exit: both buttons identical, focused = pink text

Update PROGRESS.md.

# V3-6 Fix-5 — Three Minor UI Fixes

You are doing the fifth post-3.6 fix run on Sonance — a music player app for Samsung Tizen TVs (Q90R / Tizen 5.0 / Chromium ~63). Vanilla JS, no build step.

**Three small UI fixes. No new features.** Complete `prompts/V3-6-fix4-prompt.md` first if it has not yet shipped (per `PROGRESS.md` it has — V3-6 Fix-4 is the most recent entry).

## Parent prompts to read first

- `CLAUDE.md` (project rules — Tizen constraints, animation rules, protected files, accent colour token)
- `PROGRESS.md` (current state — V3-6 Fix-4 is the latest entry)
- `prompts/V3-6-prompt.md` (parent v3.6 ticket)
- `prompts/V3-6-fix-prompt.md`, `prompts/V3-6-fix2-prompt.md`, `prompts/V3-6-fix3-prompt.md`, `prompts/V3-6-fix4-prompt.md` (predecessors — should already be merged)

## Test configuration

- Test Navidrome server: `http://192.168.0.2:4534`
- Dev server: `python3 -m http.server 8080` from project root
- Browser test all changes; **leave the dev server running at the end** so the user can manually verify on TV / localhost
- Test credentials are in your auto-memory ("Test Navidrome credentials") — ask the user if not available

## DO NOT MODIFY — protected files

- `js/player.js`
- `js/auth.js`
- `js/starred.js`
- `config.xml`
- `js/api.js` — you may ADD methods but NOT modify or remove existing ones

## Tizen constraints

- No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`
- Animate `transform` and `opacity` only. No `transition: all`. No `backdrop-filter`. No `gap` on flex containers (use `> * + *` margin pattern); use `grid-gap` not `gap` on grids.
- Do not regress any prior V3-6-* work — especially V3-6-fix4 NP open performance (lyrics fetch deferral, layout cache, deferred panel build, dynamic `will-change`).

---

## FIX 1 — Artist Detail right-side highlight uses accent, not grey

**Problem.** On the Artist Detail screen (artist info / discography), the focused item on the right (album rows and similar-artist cards) is highlighted with a grey/transparent background instead of the app's accent tint. This is inconsistent with focused song / track rows elsewhere, which use `rgba(var(--accent-rgb), 0.55)` per the V3-6-fix GFX-4 pass.

**Files.**

- `css/styles.css`
  - `.artist-album-row.focused` at lines 3694–3700 — current `background: rgba(255, 255, 255, 0.06)` (grey)
  - `.artist-similar-card.focused` at lines 3772–3779 — current `background: transparent !important`

**Reference patterns to match.**

- `.song-row.focused` at lines 2122–2128: `background: rgba(var(--accent-rgb), 0.55)` + `transform: scale(1.02)`
- `.track-row.focused` at lines 2410–2416: same pattern
- Comment on both: `V3-6-fix GFX-4: focused songs match the top-nav pill (0.55).`

**Steps.**

1. Update `.artist-album-row.focused`: replace `background: rgba(255, 255, 255, 0.06)` with `background: rgba(var(--accent-rgb), 0.55)`. Keep `transform: scale(1.03)` (album rows lift slightly more than song rows by design — do NOT change to 1.02). Keep `outline: none !important`, `box-shadow: none !important`, `border-color: transparent !important`. Update the leading comment to `/* V3-6-fix5 FIX-1: focus uses accent (matches song/track rows). */`.
2. Update `.artist-similar-card.focused`: replace `background: transparent !important` with `background: rgba(var(--accent-rgb), 0.55) !important`. Keep `transform: scale(1.08)`, `z-index: 5`, `outline: none !important`, `box-shadow: none !important`, `border-color: transparent !important`. Update the leading comment similarly.
3. Do NOT touch `.artist-album-row.focused .artist-album-art` or `.artist-similar-card.focused .artist-similar-avatar` shadow rules — only the parent background changes.
4. Bump the cache buster in `index.html`: `?v=v3-6-fix4` → `?v=v3-6-fix5` on every script tag and the stylesheet.

**Acceptance.**

- [ ] Focused album row in Artist Detail shows the accent-pink background, not grey.
- [ ] Focused similar-artist card shows the accent-pink background.
- [ ] Scale transforms unchanged (album row 1.03, similar card 1.08).
- [ ] Song / track / playlist row focus colours unchanged elsewhere — visually identical to before.
- [ ] No console errors. No regressions in V3-6-fix3 nav focus or V3-6-fix4 NP perf.

---

## FIX 2 — Now Playing opens with play/pause focused

**Problem.** When the Now Playing screen opens, the play/pause button should be the initially focused element. The intent is in the code at `js/screens/nowplaying.js:502` (`FocusManager.setActiveZone('content', 2);` — index 2 is the play button) but the focus is not visually applied.

**Likely cause.** `_registerFocusZones()` at `js/screens/nowplaying.js:526-567` registers BOTH `np-controls` and `content` zones using the same selector (`.np-screen-controls .focusable:not(.is-unavailable)`). The duplicate is suspicious — depending on ordering inside `js/focus.js`, the active-zone flip may not actually paint focus onto the play button. Alternatively, focus is being applied before the DOM elements are queryable, or another zone steals it shortly after.

**Files.**

- `js/screens/nowplaying.js` — `activate()` lines ~480–525, `_registerFocusZones()` lines 526–567
- `js/focus.js` — inspect `setActiveZone(zoneName, focusIndex)` and any related API for setting focus on a specific element / id

**Steps.**

1. **Diagnose first.** Add temporary `console.log` lines around the `setActiveZone` call to verify whether `#np-play` actually receives the `.focused` class on screen open. Run a Playwright check or browser DevTools inspection to confirm.
2. **Fix paths in priority order — try the simplest first, then escalate.**
   - **(a) Defer the focus call to `requestAnimationFrame`.** Wrap `FocusManager.setActiveZone('content', 2);` in a `requestAnimationFrame(function() { ... });` so all elements are guaranteed mounted and any earlier focus calls have settled. Mirrors the post-paint pattern already used in V3-6-fix4 PERF-6 at `nowplaying.js:508-513`.
   - **(b) Eliminate the duplicate `np-controls` zone.** Both `np-controls` and `content` use the same selector. If `np-controls` is the canonical zone for transport controls and `content` is unused / leftover, remove `content` from `_registerFocusZones` and switch the activation line to `FocusManager.setActiveZone('np-controls', 2);`. Conversely, if `content` is the right zone, remove `np-controls`. Decide based on what the rest of the screen (Up to progress, Down to bottom NP bar, etc.) actually targets.
   - **(c) Direct element focus.** Inspect `js/focus.js`. If it exposes a method like `FocusManager.focusElement(selector)` or similar, call it with `#np-play` directly after the zones are registered.
3. The chosen fix MUST NOT regress:
   - NP → home Back-button behaviour (V3-1-fix3)
   - Up arrow opens scrubber zone; Down returns to controls
   - Left / Right between transport controls
   - Lyrics-button visibility (P14b) and lyrics toggle
   - V3-6-fix4 dynamic-`will-change` and progress-bar width caching
   - Auto-open NP on track start (V3-5-fix2)
4. **Remove all temporary logging** before completing the fix.

**Acceptance.**

- [ ] Cold open of NP from the top nav: the play/pause button (`#np-play`) has the `.focused` class within the first paint frame and is visually highlighted.
- [ ] Warm open (NP → home → NP via the persistent NP bar): play/pause focused.
- [ ] Auto-open NP on track start (V3-5-fix2): play/pause focused.
- [ ] Left / Right between transport controls still works.
- [ ] Up still moves to the progress bar zone; Down returns from progress to controls.
- [ ] Back from NP returns to previous screen with focus restored (V3-1-fix3 unchanged).
- [ ] Lyrics toggle button still focusable when present (P14b).
- [ ] No console errors and no temporary log output left in.

---

## FIX 3 — Now Playing lyrics font size 2×; lines must wrap (no truncation, no overflow)

**Problem.** The lyrics font on the Now Playing screen is too small. Double it (18 → 36 px). Long lyric lines must wrap inside the panel — they must NOT truncate with ellipsis, NOT scroll horizontally, and NOT overflow the right edge of the panel.

**Files.**

- `css/styles.css`
  - `.lyrics-line` at lines 3301–3313 — current `font-size: 18px`, `padding: 10px 0`, `line-height: 1.4`
  - `.lyrics-line.lyrics-active` at lines 3315–3320 — `transform: scale(1.15)` (do NOT change to font-size; the comment at 3299–3300 explains why)
  - `.np-lyrics-panel` at lines 3253–3270 — `width: 55%`, `padding: 0 40px 0 48px`
  - `.np-lyrics-scroll-wrapper` at lines 3278–3291 — `height: 72%`, mask-image fade kept after V3-6-fix4 PERF-5 evaluation
- `js/screens/nowplaying.js` — `LyricsScroller` ~lines 100–160 (`_refreshLayoutCache`, `_lineOffsets[]`, `_lineHeights[]`)

**Constraints.**

- Active line scale-up (`scale(1.15)`) must not push text past the right edge. `transform-origin: left center` is already set (line 3309), so growth is rightward only — there is enough horizontal room (panel content width ≈ 968 px at 1920 px; active line at 1.15× equals ≈ 842 px of effective text room).
- Lines must wrap naturally. `.lyrics-line` does NOT currently set `white-space: nowrap` or `text-overflow: ellipsis`. **Do NOT add either.** If the executor finds wrapping is being suppressed elsewhere in the cascade, fix the cascade — do not introduce truncation.
- The mask-image fade is kept (per V3-6-fix4 PERF-5 reversion). With taller lines fewer lines are visible at once — this is acceptable.
- Do not change `.lyrics-line.lyrics-active`'s scale value or `.lyrics-line` opacity / color rules.

**Steps.**

1. In `.lyrics-line`, change `font-size: 18px` → `font-size: 36px`. Keep `line-height: 1.4`.
2. Increase `padding: 10px 0` → `padding: 14px 0` to maintain visual breathing room without halving the on-screen line count. (If the user wants different vertical density after testing, adjust this single value — record the chosen value in `PROGRESS.md`.)
3. Browser-verify the panel + wrapping math at 1920 × 1080: panel content width = `0.55 × 1920 - (40 + 48) = 968 px`. Long lines wrap to 2–3 visual rows at 36 px. Confirm by playing a song with verbose lines (any rap track or one with multi-clause lyrics) and checking that no line truncates, scrolls horizontally, or crosses the right edge.
4. After the CSS change, the JS `_lineHeights[]` / `_lineOffsets[]` cache built in `_refreshLayoutCache` automatically picks up the new measurements at next init (the cache is rebuilt on every `init` call and on `window.resize`). **Browser-verify scroll-to-active alignment**: as the song progresses, the active line should remain centred in the wrapper. If it drifts, force a `_refreshLayoutCache()` call after `_ensureLyricsPanelInner()` finishes its deferred panel build (V3-6-fix4 PERF-3). Do not change the cache structure.
5. Bump the cache buster in `index.html` (same change as FIX 1 — `?v=v3-6-fix5`).

**Acceptance.**

- [ ] Lyrics font is visibly twice as large as before (18 → 36 px).
- [ ] Long lyric lines wrap inside the panel — NO horizontal scrollbar, NO `…` truncation, NO text past the right edge.
- [ ] Active line scale-up (1.15) still works and does not overflow the right edge.
- [ ] Mask-image top/bottom fade still visible.
- [ ] Scroll-to-active keeps the current line centred during playback.
- [ ] V3-6-fix4 PERF-3 deferred lyrics-panel build still works (panel renders correctly on first lyrics-toggle).
- [ ] No console errors.

---

## OUT OF SCOPE

- Any work beyond the three fixes above. No refactors, no new features, no further perf tuning.
- Do NOT touch `js/player.js`, `js/auth.js`, `js/starred.js`, `config.xml`, or modify existing methods on `js/api.js`.
- Do NOT change focus colours / styles for any rows other than `.artist-album-row` and `.artist-similar-card`.
- Do NOT change lyrics typography beyond `font-size` and the small `padding` adjustment in FIX 3.
- Do NOT touch the V3-6-fix4 PERF infrastructure (`_scheduleLyricsForTrack`, `_ensureLyricsPanelInner`, will-change toggles, progress-bar width cache) except where FIX 2 / FIX 3 explicitly call for a `requestAnimationFrame` follow-up call.

## VERIFICATION (browser at `http://localhost:8080`)

1. **FIX 1.** Library → Artists → pick any multi-album artist. Down-arrow into the discography on the right; the focused album row shows accent-pink background. If similar-artists are present, Right/Tab into them; the focused card shows the same accent-pink background. Compare directly with Library → Songs to confirm the colour matches `.song-row.focused`.
2. **FIX 2.** Press Play/Now Playing from the top nav, from the persistent NP bar, and via auto-open on track start (V3-5-fix2). In every case, the play/pause button is highlighted on first paint. Left/Right cycles transport controls; Up moves to progress bar; Back returns to previous screen with focus restored.
3. **FIX 3.** With lyrics ON in settings, play a track that has lyrics. Open NP. Confirm font visibly doubled. Pick a track with long lines and confirm wrapping (no truncation, no horizontal overflow). Active-line scale-up still highlights the current line. Scroll-to-active keeps current line centred.

## RULES

- Vanilla JS, ES2017. No `?.`, no `??`, no `Array.flat()`, no `Object.fromEntries()`.
- `transform` and `opacity` only for animations. No `transition: all`. No `backdrop-filter`. No `gap` on flex.
- Build on V3-6 / V3-6-fix / V3-6-fix2 / V3-6-fix3 / V3-6-fix4 infrastructure. Do NOT replace or refactor.
- Run autonomously. Use the test config above.
- After all changes pass, **rebuild `Sonance3.wgt` via `./build.sh`** and **leave `python3 -m http.server 8080` running** from the project root.
- Update `PROGRESS.md` with a new top-level section `## V3-6 Fix-5 — Three Minor UI Fixes`: date 2026-04-27, what shipped per fix, what was browser-tested, anything skipped or noted. Mention the `padding: 14px 0` decision on FIX 3 explicitly so it can be re-tuned later.

## TESTING (executor checklist)

Functional (browser):

- [ ] FIX 1: artist detail album row + similar-artist card focus colours match accent
- [ ] FIX 1: song / track / playlist row focus colours unchanged
- [ ] FIX 2: NP play/pause button focused on cold open, warm open, auto-open
- [ ] FIX 2: NP transport navigation (Left/Right, Up to progress, Down to controls) intact
- [ ] FIX 2: Back from NP works (V3-1-fix3)
- [ ] FIX 3: lyrics font is 36 px, lines wrap, no truncation
- [ ] FIX 3: active line scale-up still works
- [ ] FIX 3: scroll-to-active still centred during playback
- [ ] FIX 3: deferred panel build (V3-6-fix4 PERF-3) still works on first lyrics-toggle

Regression sanity:

- [ ] Library, Search, Queue, Settings unchanged
- [ ] V3-6-fix3 navigation focus still in effect
- [ ] V3-6-fix4 NP open performance not regressed
- [ ] No console errors

End state:

- [ ] `./build.sh` produced a fresh `Sonance3.wgt`
- [ ] `python3 -m http.server 8080` running from project root
- [ ] `index.html` cache buster updated to `?v=v3-6-fix5`
- [ ] `PROGRESS.md` updated with V3-6 Fix-5 section

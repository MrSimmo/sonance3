# Prompt 3.7-fix28 — Item 3.8: `--progress` CSS-var write batching

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Confirm that the throttling done by `prompt-3.7-fix2.md` is sufficient to amortise the `--progress` CSS-var writes, and add a final guard so writes that result in the same numeric value are skipped.

## Context

- `js/app.js:820-821, 888` — `style.setProperty('--progress', ratio)` calls for the NP-bar progress fill and NP-screen scrubber.
- After `prompt-3.7-fix2.md`, these run at ≤ 10 Hz.
- Even at 10 Hz, identical `ratio` values (e.g. when paused) trigger a style recalculation.

## Task

1. In each `setProperty('--progress', …)` callsite in `js/app.js`:
   - Track the last-set value in a closure (e.g. `_lastNpBarProgress`, `_lastNpScreenProgress`).
   - Round the new ratio to 4 decimals.
   - If the new rounded value equals the last, skip the `setProperty` call.
2. Reset the last-value caches whenever the player loads a new track.

## Constraints

- Do not change the visible progress smoothness during normal playback.
- Do not skip the initial 0 value at track start.

## Acceptance criteria

- During pause, `setProperty('--progress', …)` is not called repeatedly for the same value (verify by stubbing the method temporarily).
- Resume from pause snaps the progress fill correctly.
- Browser Smoke Test passes.

## Out of scope

- Changes to `js/player.js` (covered by `prompt-3.7-fix2.md`).
- The hidden video-display rect for AVPlay (covered by `prompt-3.7-fix27.md`).

## Verification

1. Stub: `var _orig = CSSStyleDeclaration.prototype.setProperty; var _setProgressN = 0; CSSStyleDeclaration.prototype.setProperty = function(n, v) { if (n === '--progress') _setProgressN++; return _orig.apply(this, arguments); };`
2. Pause playback for 5 seconds; confirm `_setProgressN` does not grow (or grows only by 1 — the pause snapshot value).
3. Resume; confirm progress moves visibly.
4. Browser Smoke Test from ticket-3.7.md.

# Prompt 3.7-fix22 — Item 3.2: Pill initial paint — rAF over `setTimeout(0)`

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Switch the top-nav pill's initial-position scheduling from `setTimeout(…, 0)` to `requestAnimationFrame`, so the pill is positioned in the same paint frame as the nav rendering rather than the next macro-task.

## Context

- `js/app.js:560` — `setTimeout(() => _updatePillPosition(_navIndex, false), 0)` is used after rendering the top nav to wait for layout before positioning.
- `setTimeout(0)` typically defers to the next macro-task (≥ 4 ms in Chromium 63), which can produce a visible single-frame flicker on cold mount.
- `requestAnimationFrame` aligns with the browser's render pipeline and runs before the next paint.

## Task

1. Replace `setTimeout(() => _updatePillPosition(_navIndex, false), 0)` with `requestAnimationFrame(function() { _updatePillPosition(_navIndex, false); });`.
2. Note: if `prompt-3.7-fix8.md` has landed, `_updatePillPosition` reads from a cache populated by `_measureNavRects()`. Ensure the rect measurement happens before the rAF callback runs (it should, since it runs synchronously after the DOM nodes are inserted).

## Constraints

- Do not change the pill's resting position or animation.
- Do not break first-render paint order.

## Acceptance criteria

- On cold app load, the pill is in its initial position with no visible jump.
- Subsequent pill movements unchanged.
- Browser Smoke Test passes.

## Out of scope

- Pill animation timing.

## Verification

1. Hard-reload the browser (Cmd-Shift-R); watch the top nav as it appears.
2. The pill should be under the focused item from the first painted frame.
3. Browser Smoke Test from ticket-3.7.md.

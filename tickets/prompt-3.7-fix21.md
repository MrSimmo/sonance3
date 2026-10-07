# Prompt 3.7-fix21 — Item 3.1: Toast — rAF instead of forced reflow

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the synchronous `_toastEl.offsetHeight` reflow trigger with a `requestAnimationFrame` callback that adds the visibility class on the next frame.

## Context

- `js/app.js:66` — current pattern reads `_toastEl.offsetHeight` to flush styles before adding `visible` class so the CSS transition fires.
- This forces a layout pass on the main thread every time a toast appears.

## Task

1. Replace the `_toastEl.offsetHeight;` line with `requestAnimationFrame(function() { _toastEl.classList.add('visible'); });`.
2. Verify the toast still animates in correctly (CSS transition on the `.visible` class).
3. If the existing code reads `offsetHeight` for any other reason, leave that read in place but consider whether it can also be removed.

## Constraints

- Do not change the toast's appearance, timing, or transition.
- Do not change the toast API.

## Acceptance criteria

- Toast still appears and animates the same way on `App.toast(message)`.
- DevTools Performance shows no forced layout entry from `_toastEl.offsetHeight`.
- Browser Smoke Test passes.

## Out of scope

- Toast styling.
- Toast queueing.

## Verification

1. Trigger a toast (e.g. force a logout warning); confirm it animates in normally.
2. DevTools Performance: record toast trigger; confirm no purple "Layout (forced)" warning.
3. Browser Smoke Test from ticket-3.7.md.

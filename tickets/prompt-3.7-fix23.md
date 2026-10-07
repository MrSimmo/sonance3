# Prompt 3.7-fix23 — Item 3.3: Hint-bar shallow-equal early-out

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Skip the hint-bar DOM rebuild when the requested hints are identical to the currently-displayed set.

## Context

- `js/app.js:87-102` — `showColourHints(hints)` clears `_hintBar.textContent = ''` and rebuilds child nodes from the `hints` array even when nothing has changed.
- `hints` is a small array (typically 0-4 items) of `{key, label}` shape.

## Task

1. Add module-level `_lastHints = null` in `js/app.js`.
2. At the top of `showColourHints(hints)`:
   - If `_lastHints` and `hints` have the same length and each pair has the same `key` and `label`, return early.
   - Otherwise, rebuild as before and store `_lastHints = hints.slice().map(function(h) { return { key: h.key, label: h.label }; });` (defensive copy so external mutation doesn't fool the equality check).
3. Add `clearColourHints()` (if it exists) to reset `_lastHints = null` so the next `showColourHints` always rebuilds.

## Constraints

- Do not change the hint-bar visual appearance.
- Equality is shallow on `{key, label}`; if a hint has additional properties affecting render, include them in the check.

## Acceptance criteria

- Repeated calls to `showColourHints` with identical hints (e.g. when re-focusing the same item) cause zero DOM mutation on the hint bar (verify with MutationObserver).
- Different hints still update correctly.
- Browser Smoke Test passes.

## Out of scope

- Hint-bar styling.
- New hint types.

## Verification

1. Add `var _hb = document.querySelector('.hint-bar'); var _mo = new MutationObserver(function() { console.log('hint-bar mutated'); }); _mo.observe(_hb, {childList: true, subtree: true});` in DevTools.
2. Re-focus the same focusable element 10 times; confirm zero "hint-bar mutated" logs.
3. Move to a different element with different hints; confirm one log on the change.
4. Browser Smoke Test from ticket-3.7.md.

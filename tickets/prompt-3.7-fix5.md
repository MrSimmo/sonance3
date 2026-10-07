# Prompt 3.7-fix5 — Item 1.4: Bound `_willChangeElements` tracking

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the unbounded `_willChangeElements` array in `js/focus.js` with a small fixed-capacity tracking set, so dynamic `will-change` is only applied to the focused element and a small neighbourhood, never accumulates, and never iterates an array that has grown.

## Context

- `js/focus.js:147-170` — `_updateWillChange(newEl)` clears `will-change` from every element in `_willChangeElements[]`, then applies `will-change: transform` to `newEl` and pushes it into the array.
- The array can grow unbounded as focus crosses zones across long sessions.
- The intent is that only the current focused element + immediate row neighbours benefit from layer promotion; all others should have `will-change: auto`.
- Pairs with `prompt-3.7-fix4.md` (focus-zone caching). Land that one first if possible.

## Task

1. Replace `_willChangeElements` (array) with `_willChangeSet` — a `Set` of HTMLElements with a fixed cap of 5 entries.
2. Implement `_setWillChange(el)`:
   - If `_willChangeSet` already includes `el`, no-op.
   - Otherwise, add `el`. If size > 5, remove the oldest entry and clear its `style.willChange`.
   - Set `el.style.willChange = 'transform'`.
3. On focus change, call `_setWillChange(newEl)` once. Do not iterate to clear other elements — eviction handles them.
4. Add a `_clearAllWillChange()` helper called by `clearContentZones()` so screen swaps drop all promotions.
5. Track insertion order via a small companion array (e.g. `_willChangeOrder = []`) since `Set` does preserve insertion but we still need to pop from the front cleanly.

## Constraints

- Do not change any focus-visual styling. The element classes and transform values stay identical.
- Do not promote elements that are not focused (e.g. don't aggressively pre-promote neighbours unless the existing logic already did — match current behaviour).
- Cap at 5 elements; tune up only if Browser Smoke Test reveals visible jank.

## Acceptance criteria

- Rapid d-pad presses across 100+ items leave at most 5 elements with `style.willChange` set at any time.
- No console errors during navigation.
- Focus animation still feels smooth (subjective).
- Browser Smoke Test passes.

## Out of scope

- Changes to the static `will-change` allowlist in CSS.
- Changes to focus-zone resolution (covered by `prompt-3.7-fix4.md`).

## Verification

1. In DevTools console after navigating: `Array.from(document.querySelectorAll('[style*="will-change"]')).length` — confirm ≤ 5.
2. Rapidly arrow through Library Artists for 5 seconds; re-check; confirm still ≤ 5.
3. Switch screens (Home → Library → Now Playing); confirm no leftover `will-change` from prior screens.
4. Browser Smoke Test from ticket-3.7.md.

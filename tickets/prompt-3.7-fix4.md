# Prompt 3.7-fix4 — Item 1.3: Cache focus-zone elements

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Stop running `document.querySelectorAll(zone.selector)` on every d-pad keypress. Resolve the zone's element list once at registration and reuse it until invalidated.

## Context

- `js/focus.js:114-118` — `_getElements(zone)` returns `Array.prototype.slice.call(document.querySelectorAll(zone.selector))` every time it is called.
- `_getElements` is invoked from `_updateFocus` and from `moveFocus` paths — fires on every Up/Down/Left/Right.
- Static zones use `zone.selector`. Virtual zones use `zone.getCount()` + `zone.getElement(i)` and should remain unaffected.
- `clearContentZones()` at `js/focus.js:59-78` already drops zones on screen change.

## Task

1. In `registerZone(name, config)` add: if `config.selector` is provided (static zone), resolve and store `_zones[name]._cachedEls = Array.prototype.slice.call(document.querySelectorAll(config.selector))`. Virtual zones with `getCount`/`getElement` skip this step.
2. Modify `_getElements(zone)` to return `zone._cachedEls` for static zones; fall back to the old query path for virtual zones (or for safety if `_cachedEls` is missing).
3. Add a public `FocusManager.invalidateZone(name)` that re-runs the selector resolve for that zone and updates `_cachedEls`.
4. Auto-invalidate inside `registerZone` when called for an existing name (re-register replaces the cache).
5. Call sites that currently re-render the DOM and re-register the zone (e.g. `js/screens/library.js`, `album.js`, `home.js`) keep working unchanged because `registerZone` will recompute the cache for them. No screen edits in this prompt.

## Constraints

- Do not change `moveFocus` behaviour, key handling, or wrap-around semantics.
- Virtual-grid zones (Library Artists ≥80 case) must continue to use `getCount()`/`getElement()` and not the cache.
- Do not introduce any new public API beyond `invalidateZone`.

## Acceptance criteria

- D-pad navigation across the Library Albums grid (~50–200 cards) shows zero `querySelectorAll` calls per keypress (verify with a temporary `console.count` in `_getElements`).
- Virtual artists grid still works unchanged.
- All screens still navigate correctly with d-pad.
- Browser Smoke Test passes.

## Out of scope

- Changes to virtual grid behaviour.
- Changes to `_willChangeElements` (covered by `prompt-3.7-fix5.md`).

## Verification

1. Add `var _qs = 0; var _orig = document.querySelectorAll; document.querySelectorAll = function(){ _qs++; return _orig.apply(document, arguments); };` in DevTools, then mash arrow keys in Library Albums for 3 seconds, log `_qs`, confirm low (single-digit growth, not per-press).
2. Browse Library Artists (>80), confirm virtual grid still navigates fully and focus restore works.
3. Browser Smoke Test from ticket-3.7.md.

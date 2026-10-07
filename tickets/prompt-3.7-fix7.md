# Prompt 3.7-fix7 — Item 1.2: Eliminate full-page `cloneNode` ghosts

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Stop deep-cloning the entire outgoing page DOM on every screen transition. Reuse the existing outgoing element as the ghost so transitions cost a class swap rather than thousands of node copies.

## Context

- `js/app.js:1500` — page transitions: `ghost = _pageCurrent.cloneNode(true);` then the new screen renders into `_pageCurrent`.
- `js/app.js:1614` — zoom transitions: same `cloneNode(true)` pattern on a container element. Lines 1620-1621 then read `offsetWidth` and `offsetHeight` for sizing.
- Forced-reflow companions at `js/app.js:1644`, `:1353`, `:1406`, and `:437` write a property then read `offsetHeight` to flush layout.
- Outgoing pages routinely contain hundreds of `<img>` tags (album cards) which re-decode on `appendChild` of the clone.

## Task

Adopt the **detach-and-reuse** strategy:

1. Refactor `js/app.js:1497-1530` (page transitions) so the outgoing `_pageCurrent` element is the ghost:
   - Rename its id (set `_pageCurrent.id = ''` and add `class="page-ghost"`).
   - Create a new fresh `<div id="page-current" class="page-current">` to be the new live layer; insert into the same parent.
   - Update the module-local `_pageCurrent` ref to the new element.
   - Render the new screen into the new `_pageCurrent`.
   - Run the existing slide / zoom transition CSS class swap on the renamed ghost.
   - Remove the ghost on `transitionend` (or after a safety timer, e.g. 400 ms, in case the event is missed).
2. Apply the same pattern at `js/app.js:1614` for zoom transitions on `containerEl`. The width/height read at lines 1620-1621 is no longer needed because the ghost already has the correct layout — remove those lines (and the `offsetHeight` read at 1644 if it was solely for ghost sizing).
3. Keep the slide / zoom CSS as-is. The animation classes already key off `.page-ghost` selectors (or whatever class the ghost carries) — verify and adjust selectors only if the rename in step 1.a changes the existing class name.

## Constraints

- Visible animation timing, easing, and direction must be identical to V3-6-fix5.
- The new live layer must be ready to render into before `screen.render(_pageCurrent)` is called.
- Handle the first-render case (no existing content): skip ghost creation entirely (existing code already checks `_pageCurrent.firstChild`).
- If the existing animation CSS depends on `#page-current` (id selector), update the CSS to use the `.page-current` class instead, or keep the id by swapping which element holds it. Pick whichever is least invasive.

## Acceptance criteria

- Slide-left, slide-right, zoom-in, and zoom-out transitions all animate identically to V3-6-fix5 (eyeball comparison).
- DevTools Performance panel shows zero `cloneNode` work during a screen transition.
- No memory growth across 50 successive screen transitions (DevTools Memory snapshot pair).
- Browser Smoke Test passes.

## Out of scope

- Changing transition timings or easings.
- Replacing the ghost with a canvas/screenshot.
- Changing how the screen modules render their content.

## Verification

1. Open DevTools Performance, record a flow Home → Library → Album → Now Playing → back; confirm no `Element.cloneNode` entries appear.
2. Eyeball each transition direction against V3-6-fix5 — should be visually indistinguishable.
3. Run for 50 navigations in a loop; check `performance.memory.usedJSHeapSize` (Chrome only) before and after.
4. Browser Smoke Test from ticket-3.7.md.

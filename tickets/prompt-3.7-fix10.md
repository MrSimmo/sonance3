# Prompt 3.7-fix10 — Item 2.3: Event delegation for grid card clicks

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the per-card `addEventListener('click', …)` pattern in grid renders with one delegated listener on the grid container. Reduces listener allocation per render and removes a subtle re-render leak.

## Context

- `js/screens/home.js:217-222, 239-254, 271-288` — recently-added, recently-played, top-songs rows each attach a click handler per card via `.forEach(card => card.addEventListener('click', …))`.
- `js/screens/library.js`, `js/screens/playlists.js`, `js/screens/search.js` follow the same pattern.
- `js/screens/album.js` track rows similarly.
- D-pad Enter is already delegated through `FocusManager` so this prompt only affects mouse/click paths used in browser dev. On TV there is no click. Still: the listener-allocation and GC cost on every render adds up in the browser dev loop; consolidating prevents accidental leaks if a future change triggers re-render.

## Task

For each grid container in `home.js`, `library.js`, `playlists.js`, `search.js`, `album.js`:

1. Identify the parent container element (e.g. `.home-row`, `.library-grid`, `.album-tracks`).
2. After it is rendered the first time, attach exactly one delegated `click` handler:
   ```js
   container.addEventListener('click', function(ev) {
       var card = ev.target.closest('.album-card');
       if (!card) return;
       var id = card.getAttribute('data-id');
       if (!id) return;
       // existing per-card click action goes here
   });
   ```
3. Ensure each card has a `data-id` attribute when rendered. Add it if missing.
4. Remove the per-card `addEventListener('click', …)` calls inside the render loops.
5. Track the delegated listener via a closure flag so re-renders of the same container don't double-attach. If the container is destroyed and recreated on screen leave/return, the new container needs a new listener — leverage the existing screen `activate()`/`deactivate()` lifecycle.

## Constraints

- Do not change the d-pad Enter behaviour. That goes through `FocusManager.handleEnter` — leave it alone.
- Do not alter what the click does — only how it is wired up.
- Use `ev.target.closest('.album-card')` (Chromium 63 supports `Element.closest`).

## Acceptance criteria

- Each grid container has exactly one click listener regardless of re-render count (verify with `getEventListeners(container)` in DevTools).
- Clicking an album / track / playlist still navigates / plays as before.
- D-pad Enter still works on every card.
- Browser Smoke Test passes.

## Out of scope

- Refactoring d-pad navigation flows.
- Touch event handling (the app is d-pad / mouse only).

## Verification

1. In DevTools, after entering a screen, run `getEventListeners(document.querySelector('.library-grid'))` (Chrome). Confirm one `click` listener.
2. Click multiple cards; confirm each navigates correctly.
3. Re-enter the screen 10 times; re-check listener count is still one (or one per fresh container instance).
4. Browser Smoke Test from ticket-3.7.md.

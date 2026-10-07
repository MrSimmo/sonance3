# Prompt 3.7-fix13 — Item 2.6: Queue — append-only / diffed updates

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Stop rebuilding the entire queue list DOM on every `queuechange` event. Diff old vs new queue arrays and only mutate the rows that actually changed. Mirror the album-screen playing-indicator approach for the "now playing" row.

## Context

- `js/screens/queue.js:205-252` — queue render listens for `queuechange` and clears + rebuilds the full list.
- The Player emits `queuechange` on add, remove, reorder, and "advance to next track".
- After `prompt-3.7-fix3.md`, the Album screen has a precedent for mutate-only playing-indicator updates.

## Task

1. Add a module-level `_lastQueueIds = []` and `_currentPlayingRow` ref in `js/screens/queue.js`.
2. Replace the rebuild handler with a diff:
   - Compute `currentIds = queue.map(t => t.id + '|' + t.queueIndex)` (use whatever uniquely identifies a row position; fall back to `id` if positions are unique already).
   - If `_lastQueueIds` is empty, do a full render (initial mount).
   - Otherwise, compare with the previous list:
     - Rows present in old but not new → remove via `node.remove()`.
     - Rows present in new but not old → create and `appendChild` (or `insertBefore` at the correct index).
     - Rows whose order changed → minimal `insertBefore` swap.
   - Update `_lastQueueIds = currentIds`.
3. Implement `_updateQueuePlayingIndicator(songId)` matching the pattern from `prompt-3.7-fix3.md`:
   - Remove `.queue-row-playing` from `_currentPlayingRow`.
   - Find the new row by `data-song-id`; add the class.
4. Listen for the Player's `trackchange` separately from `queuechange`; route `trackchange` only through the indicator updater so simply advancing to the next queue entry no longer triggers a list diff.
5. On `deactivate()`, clear `_lastQueueIds` and `_currentPlayingRow`.

## Constraints

- Do not change row content or visual style.
- Diff must be O(n) where n is queue length; avoid O(n²) loops.
- Focus position must be preserved across queue changes when the focused row is still present.

## Acceptance criteria

- Adding a track to the queue mutates the DOM by exactly one inserted row.
- Removing a track removes exactly one row.
- Track-end advancement triggers an indicator-only update; no list churn.
- Focus preserved on a focused row that still exists post-update.
- Browser Smoke Test passes.

## Out of scope

- Drag-and-drop or manual reorder UI.
- Queue persistence to localStorage.

## Verification

1. With Queue open and focus on row 5, add a new track via Library; confirm focus stays on the same logical row and exactly one new row appears.
2. Skip to next track; confirm no full list rebuild (DevTools Elements shows other rows untouched).
3. Remove the focused row; focus moves to a sensible neighbour; no errors.
4. Browser Smoke Test from ticket-3.7.md.

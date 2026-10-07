# Prompt 3.7-fix16 — Item 2.9: Binary-search the active lyrics line

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the linear scan that finds the active lyrics line on each progress tick with a binary search over the sorted timestamp array.

## Context

- `js/screens/nowplaying.js:198-203` — `LyricsScroller.update(currentTimeSec)` walks `_lines` linearly looking for the largest line whose `time <= currentTimeSec`.
- `_lines` is built once and is sorted by timestamp.
- After `prompt-3.7-fix2.md` lands, this update fires up to 10 Hz (vs. 4 Hz before).

## Task

1. In `js/screens/nowplaying.js` `LyricsScroller`:
   - Confirm `_lines` is sorted ascending by `time`. If construction does not guarantee sort, sort once after parsing.
2. Replace the linear scan in `update(currentTimeSec)` with a binary search returning the largest index `i` such that `_lines[i].time <= currentTimeSec`. Standard implementation:
   ```js
   var lo = 0, hi = _lines.length - 1, idx = -1;
   while (lo <= hi) {
       var mid = (lo + hi) >> 1;
       if (_lines[mid].time <= currentTimeSec) { idx = mid; lo = mid + 1; }
       else { hi = mid - 1; }
   }
   ```
3. Keep the optimisation: if the resolved index equals the previously-active index, do nothing (no scroll work, no class swap).
4. If `currentTimeSec` is before the first line, set the active index to -1 (no line highlighted) — same as current behaviour.

## Constraints

- Do not change the `LyricsScroller` public API.
- Do not change the visible scroll/highlight behaviour.

## Acceptance criteria

- Lyrics still highlight on the correct line at all times during playback.
- Seeks (forward and backward) jump to the correct line.
- The cost-per-update is constant regardless of song length.
- Browser Smoke Test passes.

## Out of scope

- Lyrics fetch / parse code.
- Mask / fade visual effects.

## Verification

1. Pick a long song with synced lyrics; let it play; confirm correct line highlight at multiple checkpoints.
2. Seek forward 60 s; confirm the active line snaps correctly.
3. Seek backward 60 s; confirm same.
4. Browser Smoke Test from ticket-3.7.md.

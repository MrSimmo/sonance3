# Prompt 3.7-fix3 — Item 1.5: Album detail — stop full re-render on track change

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

When the playing track changes while the Album detail screen is visible, mutate only the two affected track rows (old + new) instead of rebuilding the entire track list and re-registering focus zones.

## Context

- `js/screens/album.js:104-110` — `_onTrackChange()` calls `_renderAlbum(_albumData, api)` then `_registerFocusZones()`.
- `_renderAlbum` rebuilds the track list DOM via `textContent = ''` + per-row `createElement`/`appendChild`.
- The "playing" indicator on a track row consists of a `.track-playing` class plus an inline EQ-bar SVG inserted into the row's left cell.
- `_registerFocusZones()` calls `FocusManager.registerZone(...)` which (post-1.3 fix) caches a `querySelectorAll`. Re-registering on every track change wastes that cache.

## Task

1. Add a module-level `_currentPlayingRow` ref in `js/screens/album.js` initialised to `null`.
2. Implement `_updatePlayingIndicator(songId)`:
   - If `_currentPlayingRow` exists, remove `.track-playing` from it and remove its EQ-bar SVG node.
   - Find the new row by `data-song-id` (ensure rows have this attribute when rendered).
   - Add `.track-playing` and append the EQ-bar SVG to the new row.
   - Update `_currentPlayingRow` to the new row.
3. Replace the body of `_onTrackChange` to call `_updatePlayingIndicator(currentSong.id)` only — no `_renderAlbum`, no `_registerFocusZones`.
4. In `_renderAlbum`, ensure each track row has `data-song-id="<id>"` and that `_currentPlayingRow` is set if the currently-playing song is on this album when the screen first renders.
5. On `deactivate()`, null out `_currentPlayingRow`.

## Constraints

- Do not change the visual appearance of the playing indicator or the row layout.
- Do not change focus behaviour — the existing zone registration on first render still applies.
- Keep the EQ-bar SVG identical to the current implementation.

## Acceptance criteria

- Playing a track on the album you're viewing updates only that row; DevTools shows no DOM rebuild on the track list.
- Focus position on the album screen is preserved across track changes.
- No console errors when the now-playing track is *not* on this album (indicator is simply removed).
- Browser Smoke Test passes.

## Out of scope

- Applying the same pattern to `playlists.js` and `queue.js` (covered separately by `prompt-3.7-fix13.md`).
- Reordering, sorting, or any data changes.

## Verification

1. On Album detail, queue 3 tracks from this album; verify the playing-row indicator hops correctly across them.
2. Use DevTools Elements panel: pin a non-playing row; verify it is not removed/re-created when the playing track advances.
3. Temporarily add `console.count('renderAlbum')` and confirm it does not increment on track change.
4. Browser Smoke Test from ticket-3.7.md.

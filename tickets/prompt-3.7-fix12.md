# Prompt 3.7-fix12 — Item 2.5: Virtualise long search result lists

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

When a search returns more than 30 results in a section, mount that section's list using `SonanceUtils.VirtualGrid` (already proven in Library Artists) so DOM stays bounded. Confirm the existing 300 ms input debounce cancels properly on Back.

## Context

- `js/screens/search.js:214-216` — search committed; results re-rendered.
- The `SonanceUtils.VirtualGrid` constructor is in `js/utils.js`. It mounts a tall spacer + absolutely-positioned inner list and only keeps visible rows + a 2-row buffer in the DOM. `FocusManager` virtual zone integration already exists.
- Search has three result categories (typically Songs, Albums, Artists). Each is its own list/grid.

## Task

1. For each result section in `js/screens/search.js`:
   - If `results.length <= 30`, render normally (existing path).
   - Otherwise, instantiate a `SonanceUtils.VirtualGrid` for that section and register it as a virtual focus zone (mirror the Library Artists implementation).
2. Re-use the existing card / row factory functions per section so visual output is identical.
3. Confirm the input debounce in `js/screens/search.js`:
   - Locate the keystroke handler and its `setTimeout` (~300 ms).
   - On screen `deactivate()` (Back from Search), `clearTimeout` the pending search.
   - Add this if it doesn't already exist.
4. Pause/resume any in-flight fetch when navigating away mid-typing — at minimum, ignore late-arriving results when the screen is no longer active (check `_active` flag in the `.then(...)`).

## Constraints

- Do not change the look of result rows / cards.
- Do not change debounce timing.
- Do not introduce a new VirtualGrid implementation; reuse `SonanceUtils.VirtualGrid`.

## Acceptance criteria

- Searching "the" against a large library (1000+ songs) produces a results screen whose DOM contains roughly the visible rows + buffer for each section, not the full result count.
- Focus navigation across virtualised results works fully (top to bottom of section).
- Pressing Back during typing cancels any pending fetch and does not pollute the next screen.
- Browser Smoke Test passes.

## Out of scope

- Server-side pagination of search results (Subsonic `search3` already supports `count`/`offset` but this prompt just renders client-side).
- Search filters.

## Verification

1. In a library with 1000+ songs/albums, search "the".
2. DevTools Elements panel: confirm each section's mounted DOM stays small (≤ ~20 rows) regardless of total count.
3. Arrow Down through one section to the bottom — must reach the last result.
4. Type "th", press Back before debounce fires; navigate to Library; confirm no console errors and no late results appear there.
5. Browser Smoke Test from ticket-3.7.md.

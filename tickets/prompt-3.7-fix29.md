# Prompt 3.7-fix29 — NP & top-nav regressions from Phase 2

**Parent ticket:** `tickets/ticket-3.7.md` — read it first. Inherit all V3.7 constraints (Tizen 5.0 / Chromium ~63 ES2017, no `gap` on flex, transform/opacity-only animations, no `transition: all`, AVPlay only on TV, no external network, etc.).

## Objective

Fix five regressions on the Now Playing (NP) screen and top-nav that surfaced during Phase 2 of V3.7. No new features, no design changes.

## Context

Five user-reported bugs:

1. **Lyrics button unreachable on NP.** Right-arrowing across NP options stops before the lyrics button.
2. **Lyrics panel resets on every track change.** If the user has lyrics open and the track changes, the panel closes — even when the next track has lyrics. This is a long-standing bug worth fixing now.
3. **Top-nav slide to NP auto-enters play/pause.** Sliding Right onto the "Now Playing" item should keep focus on the nav pill until either 5 s elapses or the user presses Down. Today it drops focus straight into the NP play button.
4. **NP nav pill stays in "focused" colour when user presses Down.** The pill should change to the accent-tinted "selected" colour as the user moves into NP options. Today the bar hides instantly so the change is invisible.
5. **Up from NP highlights the wrong nav item.** Going Up from NP options sends focus to whichever nav item the user last topnav-visited (often Genres) instead of "Now Playing".

### Files involved

- `js/screens/nowplaying.js` — NP screen render, focus zones, lyrics state, activate handler.
- `js/app.js` — top-nav zone, `onKey('down')`, `_updateTopNavForScreen`, NP auto-hide timer.
- `js/focus.js` — `registerZone` re-register early-out, `_tryTransition` to topnav, `_focusIndex` per-zone state.

Inherited V3.7 ground:
- `prompt-3.7-fix4.md` introduced `_cachedEls` cache on each zone.
- `prompt-3.7-fix17.md` introduced `onceZoneRegistered` and `invalidateZone`.
- `prompt-3.7-fix20.md` introduced the same-selector early-out in `registerZone` (the proximate cause of Bug 1).

## Task

### 1. `js/focus.js` — make re-register propagate config updates

In the early-out branch at the top of `registerZone(name, config)` (currently lines ~48-71), the code refreshes `existing._cachedEls` but ignores the rest of `config`. That is wrong when the caller re-registers with the *same selector* but updated `columns`, `neighbors`, `onActivate`, `onFocus`, `onKey`, or `defaultIndex`.

Update the early-out so that, before returning, it copies these fields from `config` onto `existing`:

```javascript
existing.columns = config.columns;
existing.neighbors = config.neighbors;
existing.onActivate = config.onActivate;
existing.onFocus = config.onFocus;
existing.onKey = config.onKey;
existing.getElements = config.getElements;
// preserve _cachedEls (just refreshed above) and any other internal state
```

Do **not** reset `_focusIndex[name]` here — preserve the user's current position.

Also add a small public helper:

```javascript
// Set the remembered focus index for a zone without changing the active zone
// or current element. Used by app.js to keep _focusIndex['topnav'] in sync
// with the current primary screen when navigation happens outside the topnav.
function setZoneIndex(name, idx) {
    if (!_zones[name]) return;
    if (typeof idx !== 'number' || idx < 0) return;
    _focusIndex[name] = idx;
}
```

Export it on the `FocusManager` public surface.

### 2. `js/screens/nowplaying.js` — Bug 1: stop using selector filter to gate lyrics button

The current selector `.np-screen-controls .focusable:not(.is-unavailable)` plus dynamic `columns: 6 or 7` was the source of the unreachable-button bug. Replace it with a stable shape: always include the lyrics button in the zone, always `columns: 7`.

- Keep the `is-unavailable` class for **visual** styling only (it should still grey the icon and stay un-clickable when no lyrics exist).
- Update `_registerFocusZones()` (around line 631-647):
    - `selector: '.np-screen-controls .focusable'` (drop `:not(.is-unavailable)`).
    - `columns: 7` (constant).
    - Drop the `lyricsAvailable` / `cols` calculation in this function.
- Update the lyrics button click handler so a click while `is-unavailable` is a no-op (don't open the panel; don't toggle `_lyricsVisible`). The handler currently calls `_toggleLyrics`; either guard inside `_toggleLyrics` or check `_lyricsBtn.classList.contains('is-unavailable')` at the top of `_openLyrics` (`_openLyrics` already returns early when `_currentLyrics` is empty — but the check should also cover the panel-already-open / no-lyrics case from Bug 2 below).

### 3. `js/screens/nowplaying.js` — Bug 2: retain panel state across track change

The user's intent (panel open vs closed) is `_lyricsVisible`. The data state (lyrics for current track) is `_currentLyrics`. Decouple them.

In `_updateLyricsUI()` (around lines 809-833):
- Keep the `is-unavailable` class toggle on the button (visual only).
- **Remove** the auto-close: delete the `if (_lyricsVisible) { _closeLyrics(); }` block. `_lyricsVisible` is the user's choice and must only flip via `_toggleLyrics`, `_openLyrics`, `_closeLyrics` from user input.
- Keep the `if (_lyricsVisible && available)` branch that re-inits `LyricsScroller` for the new track.
- Add a sibling branch: `if (_lyricsVisible && !available)` → call `LyricsScroller.reset()` so the panel shows an empty state (and progress events on `_onProgress` / `_onSeeked` already guard with `_currentLyrics &&` so they're safe).

In `_openLyrics()` (around line 869), the existing early-return on `!_currentLyrics` is fine — but make sure that the user is never able to *open* a panel for a track with no lyrics (button is `is-unavailable` so this should already hold). Confirm by reading both call sites.

In `_onTrackChange` (line 673), no change needed — `_scheduleLyricsForTrack` will call `_updateLyricsUI`, which now no longer closes the panel.

Verify `LyricsScroller.reset()` leaves the `.np-lyrics-lines` element empty without throwing. If it doesn't tolerate being called twice or with no current state, fix the no-op case there.

### 4. `js/screens/nowplaying.js` — Bug 3: don't auto-steal topnav focus on activate

In `activate()` around lines 582-593, the rAF calls `FocusManager.setActiveZone('np-controls', 2, true)` with `force=true`, which bypasses the topnav-protection in `js/focus.js:180-184`. That's the wrong default when the user arrived via a topnav slide.

Change the rAF body to:

```javascript
_initialFocusRaf = requestAnimationFrame(function() {
    _initialFocusRaf = null;
    if (!_active) return;
    // Don't yank focus out of the top nav. If the user arrived via a
    // top-nav slide (or pressed Up to return), let them stay on the
    // nav pill. The Down handler / 5 s auto-hide drops focus into
    // np-controls when the user is ready.
    if (FocusManager.getActiveZone() === 'topnav') return;
    // Cold-open from the now-playing-bar / track-play / Auto-NP setting:
    // focus stays here, on the play button.
    FocusManager.setActiveZone('np-controls', 2, true);
});
```

Verify the cold-open paths still focus play:
- Now-playing-bar Enter on play → `Player.togglePlayPause()` doesn't navigate; the existing flow that opens NP from the bar is the one that needs the play-button focus. Confirm via `grep`.
- "Auto Now Playing" on track-play (`SonanceSettings.autoNowPlaying`, around `js/app.js:431`) — when this fires, `_activeZone` is whatever it was before; usually NOT topnav, so the new guard is fine.

### 5. `js/app.js` — Bug 4: don't hide the nav bar instantly on Down

In the topnav zone's `onKey('down')` handler (around lines 1015-1025), remove the immediate `setNavBarVisible(false)` for NP. Let the existing 5 s auto-hide timer (`_scheduleNavAutoHide`) hide the bar after the configured delay so the user can see the pill transition to the "selected" accent.

Replacement:

```javascript
if (direction === 'down') {
    // Don't cancel the NP auto-hide here — let the existing 5 s timer
    // continue running so the user sees the pill state transition from
    // 'focused' to 'selected' before the bar fades out.
    if (_currentScreen !== 'nowplaying') _cancelNavAutoHide();
    var zone = _getPageFirstZone();
    if (zone) {
        _setPillState('selected');
        _updateNavItemClasses();
        FocusManager.setActiveZone(zone, undefined, true);
    }
    return true;
}
```

(The `setNavBarVisible(false)` line is removed entirely. On non-NP screens the nav bar was already always visible, so this is a no-op there.)

If the user presses Up again before the 5 s expires, the existing `onFocus` handler at `js/app.js:982-985` re-shows the bar and re-schedules the timer — that path stays correct.

### 6. `js/app.js` — Bug 5: sync topnav focus index when screen changes outside topnav

In `_updateTopNavForScreen(screenName)` (around lines 1639-1652), after setting `_navIndex = navIdx`, mirror that index into FocusManager so a later Up-press from page content lands on the correct pill:

```javascript
if (navIdx >= 0) {
    _navIndex = navIdx;
    FocusManager.setZoneIndex('topnav', navIdx);   // <-- new
    _updateNavItemClasses();
    _updatePillPosition(navIdx, true);
} else {
    // Sub-screen (album/artist) — keep selection on whatever primary led
    // here; don't change index
    _updateNavItemClasses();
}
```

Use the new `setZoneIndex` helper from Task 1 — it does NOT change `_activeZone`, only updates the remembered focus index for the topnav zone.

## Constraints

- Do not change visible animation timing, durations, or transforms.
- Do not introduce new `transition: all` or layout-property transitions.
- Don't change AVPlay lifecycle, Player engine, or Subsonic API calls.
- Don't change the public shape of `FocusManager` exports beyond adding `setZoneIndex`.
- Don't add new external dependencies.
- Don't change the V3.7 perf wins from prior fixes (cached rects, throttled progress, deferred lyrics fetch, etc.).
- ES2017 only. No optional chaining / nullish coalescing.

## Acceptance criteria

1. **Bug 1.** On NP, with a track that has lyrics, the lyrics button is reachable by pressing Right from any other NP control. Pressing Enter on it toggles the lyrics panel as before.
2. **Bug 1.** On NP, with a track that has no lyrics, the lyrics button is still focusable but visually marked unavailable, and pressing Enter on it is a no-op.
3. **Bug 2.** With lyrics open on track A, when the player advances to track B (also has lyrics), the panel stays open and the new track's lyrics render. With lyrics open on track A, when track B has no lyrics, the panel stays open showing an empty state — and re-opens lyrics automatically when track C (with lyrics) starts. Closing lyrics still works via the lyrics button.
4. **Bug 3.** Sliding Right onto "Now Playing" from another nav item leaves focus on the NP pill (focused state) for 5 s before auto-dropping into NP options. Pressing Down at any time during that window drops focus to the play button immediately. Cold-opening NP from the now-playing-bar still lands focus on play.
5. **Bug 4.** Pressing Down from the NP pill changes the pill to the "selected" (accent-tinted) colour and the nav bar stays visible until the 5 s auto-hide timer fires, then it hides cleanly.
6. **Bug 5.** Open NP from a track row (e.g. Library → Albums → an album → a track), then press Up. The top-nav highlights "Now Playing", not whichever nav item the user last visited.
7. Browser Smoke Test from `ticket-3.7.md` passes with no console errors and no visual regression vs. V3.7-fix28.

## Out of scope

- Any redesign of the lyrics panel UI or scroller behaviour.
- Removing the 5 s auto-hide entirely.
- Any change to AVPlay or to Player.
- Changes to non-NP screens' Down/Up handlers.
- Replacing `is-unavailable` with a different attribute name.

## Verification

1. Start dev server: `python3 -m http.server 8080` from project root.
2. Open Chrome at `http://localhost:8080/` and log in to the Navidrome at `http://192.168.0.2:4534` (credentials in user memory).
3. Bug 1 verification:
   - Play a track that has lyrics (e.g. anything from a popular album).
   - On NP, press Left/Right across the controls; confirm the lyrics button is reachable as the rightmost focusable.
   - Press Enter on it; confirm the lyrics panel toggles open/closed.
4. Bug 2 verification:
   - With lyrics open, press Next; confirm the panel stays open and the new track's lyrics render (or empty state if none).
   - With lyrics open and the next track having no lyrics, confirm the panel stays open (empty), then the track after — with lyrics — auto-renders into the same open panel.
5. Bug 3 verification:
   - From Home, slide Right repeatedly until "Now Playing" is focused in the top nav.
   - Confirm focus stays on the NP pill (top-nav still active) and does NOT auto-jump into the play button.
   - Wait 5 s; confirm focus drops into NP controls and the bar hides.
   - Repeat: Right onto NP, then immediately press Down; confirm focus drops to play button, bar transitions to "selected" colour briefly, then hides.
6. Bug 4 verification:
   - On NP with the bar visible (focused state), press Down. Watch the NP pill: it must change to the accent-tinted "selected" colour and stay visible briefly before the auto-hide fades it out.
7. Bug 5 verification:
   - From Library → Genres tab, focus a genre, then press Back to NP via any path that doesn't go through the top nav (e.g. Now-Playing-bar Enter, or Auto-NP after pressing play on a track row).
   - On NP, press Up; confirm the top-nav highlights "Now Playing", not "Genres".
8. Run the full Browser Smoke Test from `ticket-3.7.md`. Console should have zero errors. No visual regression vs. V3.7-fix28.
9. Update `PROGRESS.md` with what was completed, what was tested, and any deferred follow-ups.

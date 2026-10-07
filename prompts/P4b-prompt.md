You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P4b: v1.1 Functional Tweaks (Shuffle/Repeat, Queue Management).

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P4-v1.1-tweaks.md — focus on P4.5 (shuffle/repeat) and P4.7 (queue colour buttons)
3. Read PROGRESS.md for current state (P4a should be complete)
4. Read js/player.js to understand current shuffle/repeat implementation
5. Read js/focus.js to understand key handling

This session handles TWO tasks:

## TASK 1: P4.5 — Shuffle/Repeat Testing & Fix
- Remove shuffle/repeat toggles from Settings screen if P4a didn't already do this
- Verify shuffle and repeat work on the Now Playing screen:
  - Shuffle icon: Enter toggles on/off, highlights in --accent when active
  - Repeat icon: Enter cycles none → all → one, highlights when active, shows "1" badge for repeat-one
  - State persists in localStorage
- **Run these tests and log results to PROGRESS.md:**
  1. Play an album → enable shuffle → verify tracks play in non-sequential order
  2. Disable shuffle → verify queue reverts to album order
  3. Enable repeat all → play to end of queue → verify it loops
  4. Enable repeat one → verify current track loops
  5. Disable repeat → verify playback stops after last track
  6. Shuffle + Repeat All combined → verify shuffled queue loops
  7. Navigate away from Now Playing → return → verify indicators still correct
  8. Reload page → verify shuffle/repeat state persists
- Fix any bugs found during testing

## TASK 2: P4.7 — Queue Management via Colour Buttons
Register Samsung TV colour button keycodes in the key handler:
- Red: 403 (and key "ColorF0Red") 
- Green: 404 (and key "ColorF1Green")
- Yellow: 405 (and key "ColorF2Yellow")
- Blue: 406 (and key "ColorF3Blue")
- For browser dev testing, also map: R=Red, G=Green, Y=Yellow, B=Blue (keyboard letters)

### Colour Button Actions
On screens with focusable tracks (Album Detail tracklist, Library Songs tab, Search results, Playlist detail):
- **Yellow (405 / Y):** Add focused track to end of queue → show toast "Added to queue"
- **Blue (406 / B):** Insert focused track after current playing track → show toast "Playing next"

On Album Detail when Play/Shuffle buttons are focused:
- **Yellow:** Add all album tracks to end of queue → show toast "Album added to queue"

On Queue screen:
- **Red (403 / R):** Remove focused track from queue → show toast "Removed from queue"

### Toast Notification System
Create a simple toast function:
```javascript
function showToast(message, duration) {
    // Create a small dark pill (rgba(0,0,0,0.85), white text, 14px, padding 10px 20px)
    // Position: bottom-centre, 120px above the now playing bar
    // Animate: fade in, hold, fade out
    // Auto-remove after duration (default 2000ms)
}
```

### Colour Button Hint Bar
Add a thin bar (28px height) that appears above the Now Playing bar on screens where colour buttons are active:
- Background: rgba(255,255,255,0.03)
- Content: colour dots (8px circles) + action labels (12px, --text-muted)
- Example: "● Add to queue   ● Play next" (yellow dot, blue dot)
- On Queue screen: "● Remove" (red dot)
- Only visible when a track/album is focused
- Do NOT show on: Home hero, Settings, Search keyboard area, Now Playing screen

### Testing
- In browser, use Y/B/R keys to test colour button actions
- Verify toast appears and disappears
- Verify tracks are added to queue correctly
- Verify "Play next" inserts at correct position
- Verify "Remove" on Queue screen removes the correct track
- Log all results to PROGRESS.md

RULES:
- Vanilla JS, ES2017 only
- Run autonomously
- Rebuild Sonance.wgt when done

Update PROGRESS.md with v1.1b changes.

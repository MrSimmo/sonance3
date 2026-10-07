# S6 — Polish, Browser Testing & .wgt Packaging

## Overview
Final UI polish pass, comprehensive browser testing, bug fixes, build the test harness, and package the app as a `.wgt` for deployment to the Samsung TV via Jellyfin2Samsung.

## Prerequisites
- Phases S1–S5 complete (all screens built, playback working)
- All known bugs from previous phases logged in PROGRESS.md

## Tasks

### S6.1 — UI Polish Pass
Walk through every screen and compare pixel-by-pixel against `docs/UI-MOCKUP-REFERENCE.md`:

**Checklist:**
- [ ] Login screen: card centring, input styling, button styling, error states
- [ ] Sidebar: logo, nav items, active states, connection status, spacing
- [ ] Top bar: title, stats, avatar
- [ ] Home: hero banner gradient, album art sizes, section spacing, playlist cards
- [ ] Library: tab pills, grid gaps, album cards, artist avatars, song list rows, genre cards
- [ ] Album Detail: split layout proportions, back button, play/shuffle pills, tracklist row heights, equaliser animation
- [ ] Search: keyboard layout (9 columns), key sizes, input styling, results list, empty state
- [ ] Now Playing: background blur, album art shadow, progress bar scrubber glow, control sizes, volume bar
- [ ] Queue: split layout, now playing card, queue list with thumbnails
- [ ] Now Playing Bar: mini progress, control sizes, spacing

**Typography Check:**
- Verify all font sizes, weights, colours, letter-spacing match spec
- Ensure `font-variant-numeric: tabular-nums` on all timestamps/durations
- Ensure uppercase labels have correct letter-spacing

**Colour Check:**
- All colours use CSS custom properties (no hardcoded hex in component code)
- Focus rings consistent: 2px solid `--accent`, 4px offset, 0.2s transition
- Hover/focus scale: 1.04 transform on cards

**Animation Check:**
- Equaliser bars animate smoothly
- Focus transitions are 0.2s ease
- Loading skeletons pulse
- Progress bars animate smoothly

### S6.2 — Focus Navigation Audit
Test every screen with keyboard only (no mouse):

**Per-screen checklist:**
- [ ] All interactive elements reachable via d-pad
- [ ] Focus ring visible on every focused element
- [ ] Zone transitions (sidebar ↔ content, content ↔ now playing bar) work correctly
- [ ] No focus traps (can always navigate away from any zone)
- [ ] Back key returns to previous screen from every screen
- [ ] Enter key activates correct action on every focusable element
- [ ] Focus is set to a sensible default item when entering each screen
- [ ] Scroll follows focus (focused item always in viewport)

**Edge cases:**
- [ ] Rapidly pressing arrow keys doesn't break focus state
- [ ] Pressing Back on Home screen doesn't crash (should do nothing or show a subtle indicator)
- [ ] Focus persists correctly when data loads asynchronously (no focus on stale elements)

### S6.3 — Playback Robustness
- [ ] Play a full album start to finish — all tracks advance correctly
- [ ] Shuffle play an album — all tracks play once, order is random
- [ ] Repeat All — queue loops back to start
- [ ] Repeat One — same track replays indefinitely
- [ ] Skip rapidly (press Next 10 times fast) — no crash, lands on correct track
- [ ] Play track from search results — queue correct
- [ ] Play track from Album Detail — queue is full album starting at that track
- [ ] Switch albums mid-playback — old queue replaced, new playback starts
- [ ] Volume persists across screen changes
- [ ] Volume persists across app reload (localStorage)
- [ ] Audio continues playing while navigating between screens

### S6.4 — Error Handling & Edge Cases
- [ ] Server unreachable during browsing: show error toast, don't crash
- [ ] Server unreachable during playback: pause, show reconnection message
- [ ] Invalid stream URL (e.g. deleted track): skip to next with error notification
- [ ] Empty library: Home and Library screens show appropriate empty states
- [ ] Very long album/track titles: text truncation with ellipsis, no layout break
- [ ] Albums with no cover art: placeholder renders correctly everywhere
- [ ] Session expired during use: prompt re-login
- [ ] localStorage full: graceful handling

### S6.5 — Browser Test Harness
Create `tests/browser/index.html`:
- A standalone test page that runs validation tests
- Tests grouped by module:

**API Tests:**
- Ping connection
- Fetch artists (verify response structure)
- Fetch albums (verify response structure)
- Fetch album detail (verify tracks present)
- Search query (verify results)
- Cover art URL generates correctly
- Stream URL generates correctly

**Focus Manager Tests:**
- Register zone → verify zone exists
- Move focus → verify correct item highlighted
- Zone transition → verify focus moves to neighbor zone
- Key event simulation → verify correct handler called

**Player Tests:**
- Play album → verify queue populated
- Next/Previous → verify index changes
- Shuffle → verify queue order differs from original
- Repeat → verify correct behaviour at end of queue

**Test Output:**
- Simple pass/fail display in the browser
- Green/red indicators per test
- Total pass/fail count
- Requires user to input server URL + credentials at top of page

### S6.6 — Settings Screen
Build a proper Settings screen:
- Server Information section:
  - Server URL (display only)
  - Username (display only)
  - Navidrome version (fetch from ping response if available)
  - Library stats: album count, artist count, song count (from API or cached data)
- Playback section:
  - Current volume level indicator
  - Shuffle state indicator
  - Repeat mode indicator
- App Information section:
  - "Sonance v1.0.0"
  - "By Simmo"
- Logout button:
  - Destructive style: subtle red background or red text
  - Confirm dialog: "Are you sure you want to log out?"
  - On confirm: clear session, stop playback, navigate to login

### S6.7 — Build Script & Packaging
- Update `build.sh`:
  ```bash
  #!/bin/bash
  # Build Sonance.wgt for Samsung Tizen TV
  
  set -e
  
  echo "Building Sonance.wgt..."
  
  # Clean previous build
  rm -f Sonance.wgt
  
  # Create wgt (zip with specific files only)
  zip -r Sonance.wgt \
    config.xml \
    icon.png \
    index.html \
    css/ \
    js/ \
    -x "*.DS_Store" \
    -x "__MACOSX/*"
  
  echo "Built Sonance.wgt ($(du -h Sonance.wgt | cut -f1))"
  echo ""
  echo "Deploy with Jellyfin2Samsung:"
  echo "  1. Enable Developer Mode on TV"
  echo "  2. Open Jellyfin2Samsung"
  echo "  3. Go to Settings → select custom .wgt"
  echo "  4. Select Sonance.wgt"
  echo "  5. Install to TV"
  ```
- Ensure `config.xml` is complete and valid (privileges: internet, tv.audio, volume.set)
- Create a simple `icon.png` (256×256, gradient background matching app logo)
- Test: run `build.sh`, verify `.wgt` contents with `unzip -l Sonance.wgt`
- Verify `.wgt` file size is reasonable (should be well under 1MB without heavy assets)

### S6.8 — Deployment Documentation
Create `docs/DEPLOYMENT.md`:
- Prerequisites: Samsung Q90R with Developer Mode enabled, Jellyfin2Samsung installed on PC/Mac
- Step-by-step deployment instructions
- Troubleshooting: common issues (certificate errors, connection refused, developer mode timeout)
- How to update the app (rebuild .wgt, reinstall)
- CORS configuration for Navidrome: document `ND_CORSORGINS` env var if needed
- Network requirements: TV and Navidrome server on same LAN

### S6.9 — Final PROGRESS.md Update
- Update all phase statuses to complete
- Document any known issues or limitations
- Document any future enhancement ideas that came up during development
- Record final file sizes, line counts, etc.

## Acceptance Criteria
- [ ] All screens match UI mockup specification exactly
- [ ] D-pad navigation works flawlessly on every screen (keyboard-only testing)
- [ ] No focus traps anywhere in the app
- [ ] Full album playback works end-to-end
- [ ] Shuffle and repeat modes work correctly
- [ ] Error states handled gracefully (server down, bad URLs, empty library)
- [ ] Browser test harness passes all tests against live Navidrome
- [ ] Settings screen shows server info and has working logout
- [ ] `build.sh` produces valid `Sonance.wgt`
- [ ] `.wgt` contents are correct (no extra files, valid config.xml)
- [ ] `docs/DEPLOYMENT.md` has complete deployment instructions
- [ ] PROGRESS.md fully updated with final status

## Update PROGRESS.md

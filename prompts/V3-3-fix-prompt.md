You are fixing issues with Sonance v3-3 — a music player app for Samsung Tizen TVs. Four library sub-nav bugs plus one NP bar fix.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read js/screens/library.js — the library sub-nav and tab content
3. Read js/screens/album.js — find the back button element
4. Read js/screens/artist.js — find the back button element
5. Read css/styles.css — library sub-nav pill styles, NP bar styles
6. Read js/app.js — NP bar rendering and visibility

## DO NOT MODIFY — PROTECTED FILES
- `js/player.js`, `js/api.js`, `js/auth.js`, `js/starred.js`, `js/utils.js`, `config.xml`

## FIX 1: Remove Back Button from Album Detail, Artist Detail, and All Sub-Pages

The hardware remote Back button (keyCode 10009) now handles all back navigation via the navigation stack. The on-screen back button/arrow is redundant.

Find and remove:
- The `← Back` button element in Album Detail (`js/screens/album.js`)
- The `← Back` button element in Artist Detail (`js/screens/artist.js`)
- Any other sub-page that has an on-screen back button (genre songs, playlist detail)
- The `.back-button` or `.album-detail-back` or similar CSS
- The focus zone entry for the back button
- Any click/activate handler for the back button

This frees up vertical space — the content can start higher on the page.

## FIX 2: Library Songs Tab — Tracks Don't Trigger Playback

When the user selects a song in Library → Songs, nothing happens. The track should start playing.

Find the Songs tab rendering in `js/screens/library.js`. The song rows need an `onActivate` handler:

```javascript
// When a song row is activated (Enter pressed):
function onSongActivate(songIndex) {
    // Get all songs currently loaded in the songs list
    var songs = getCurrentSongsList();
    
    // Play from this position
    Player.playAlbum(songs, songIndex);  // or Player.playTrack depending on the API
    
    // Auto-navigate to NP if setting is on
    if (SonanceSettings.autoNowPlaying) {
        navigateToNowPlaying();
    }
}
```

Check if the song rows are:
- Missing the `focusable` class (so they can't receive focus)
- Missing the activation handler (so Enter does nothing)
- Not wired into the FocusManager zone for the songs list

All three need to be present for playback to work.

## FIX 3: Library Sub-Nav Too Low — Align Top with Content

The vertical pill menu on the left is positioned too far down. Its top should align with the top of the first row of content on the right.

**Current (wrong):**
```css
.library-subnav {
    top: 50%;
    transform: translateY(-50%);  /* vertically centred — too low */
}
```

**Fix:**
```css
.library-subnav {
    top: 0;          /* align to the top of the content area */
    transform: none; /* remove vertical centering */
    /* OR if there's padding to account for: */
    top: 8px;        /* small offset to align with first content row */
}
```

The sub-nav should start at the same vertical position as the first album card / artist card / song row in the content area. Visually the top of the sub-nav pill container aligns with the top of the grid.

Check what padding/margin the content area has at the top and match it on the sub-nav.

## FIX 4: Library Sub-Nav Pill Colours Inverted

Same issue as the top nav had — highlight and selected states are the wrong way round.

The pill should be:
- **ACCENT** when focused (user is actively browsing the sub-nav with Up/Down)
- **GREY/SUBTLE** when selected (user has pressed Right and is in the content area)

```css
/* Focused = user is IN the sub-nav, browsing items = ACCENT */
.library-subnav-pill.focused {
    background: rgba(var(--accent-rgb), 0.4);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Selected = user has moved into content, sub-nav shows current tab = GREY */
.library-subnav-pill.selected {
    background: rgba(255, 255, 255, 0.15);
    box-shadow: none;
}
```

This matches the top nav bar convention established in V3-1-fix (accent = active attention, grey = passive indicator).

## FIX 5: Now Playing Bar — Hidden by Default, Visible Only When Music Is Playing

The NP bar at the bottom should:
- **Hidden** when no music is playing (no track loaded)
- **Visible** when music is playing AND the user is NOT on the Now Playing screen
- **Hidden** when the user IS on the Now Playing screen (the full NP screen replaces it)

```javascript
function updateNpBarVisibility() {
    var bar = document.getElementById('now-playing-bar');
    if (!bar) return;
    
    var state = Player.getState();
    var currentScreen = getCurrentScreen();
    var hasTrack = state.currentTrack !== null;
    var onNpScreen = currentScreen === 'nowplaying';
    
    if (hasTrack && !onNpScreen) {
        bar.style.opacity = '1';
        bar.style.pointerEvents = 'auto';
        // Adjust page container bottom to make room
        var container = document.getElementById('page-container');
        if (container) container.style.bottom = '76px';
    } else {
        bar.style.opacity = '0';
        bar.style.pointerEvents = 'none';
        // Expand page container to use the NP bar space
        var container = document.getElementById('page-container');
        if (container) container.style.bottom = '0';
    }
}
```

Use `opacity` for the show/hide (GPU-friendly). Add a quick transition:
```css
#now-playing-bar {
    transition: opacity 0.2s ease;
    will-change: opacity;
}
```

**Call `updateNpBarVisibility()` in these places:**
- After app loads (initial state — no track, bar hidden)
- On `Player.on('trackchange')` — track loaded, show bar
- On `Player.on('play')` — playback started
- On screen navigation — hide bar when entering NP screen, show when leaving
- On `Player.on('stop')` or when queue empties — hide bar

**Also update the page container height dynamically:**
When the NP bar is hidden, the page container gets extra space at the bottom (76px). When shown, the container shrinks. Use `bottom: 0` vs `bottom: 76px` — no animation on this property (instant snap, the opacity handles the visual transition).

**On app start:**
```javascript
// Initial state — no music, bar hidden
var bar = document.getElementById('now-playing-bar');
bar.style.opacity = '0';
bar.style.pointerEvents = 'none';
```

## HARDWARE ACCELERATION
- NP bar show/hide uses `opacity` only (GPU)
- No `transition: all`
- No layout property transitions

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- DO NOT modify player.js, api.js, auth.js, starred.js, utils.js, config.xml
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Fix 1 — No back buttons:
1. [ ] Album Detail — no on-screen back button visible
2. [ ] Artist Detail — no on-screen back button visible
3. [ ] Hardware Back button still works (zooms out to previous screen)

### Fix 2 — Songs playback:
4. [ ] Library → Songs → focus a song → press Enter → music plays
5. [ ] NP bar updates with the song
6. [ ] Auto-now-playing navigates to NP (if setting is on)

### Fix 3 — Sub-nav alignment:
7. [ ] Library sub-nav top aligns with the top of the content grid
8. [ ] Looks correct on all tabs (Albums, Artists, Songs, Genres)

### Fix 4 — Pill colours:
9. [ ] Sub-nav focused (browsing) = accent-coloured pill
10. [ ] Sub-nav selected (in content) = grey pill
11. [ ] Matches the top nav bar convention

### Fix 5 — NP bar visibility:
12. [ ] App loads with no music → NP bar is hidden
13. [ ] Play a track → NP bar appears (fades in)
14. [ ] Navigate to NP screen → NP bar hides
15. [ ] Navigate away from NP → NP bar reappears
16. [ ] Page content uses the extra space when NP bar is hidden

Update PROGRESS.md.

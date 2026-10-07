You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P15b: Auto-Open Now Playing Setting.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read js/screens/settings.js — understand how existing settings (lyrics offset, accent colour) are stored and displayed
4. Read js/player.js — find where playback is initiated (playTrack, playAlbum, etc.)
5. Read js/app.js — find the navigation/routing function (navigateTo or similar)

## FEATURE: Auto-Open Now Playing Screen

When the user starts playing a song (from any screen — album detail, search, library, queue), automatically navigate to the Now Playing screen. Controlled by a setting, default ON. Persisted via localStorage.

### Setting Storage

Add to whatever settings manager exists (SonanceSettings or similar):

```javascript
// Load
var stored = localStorage.getItem('sonance-auto-now-playing');
SonanceSettings.autoNowPlaying = stored !== 'false';  // default true

// Save
localStorage.setItem('sonance-auto-now-playing', value.toString());
```

Default is `true` (auto-open ON). Only stored as `'false'` when the user turns it off.

### Auto-Navigate Logic

Find where playback is initiated — likely in Player methods like `playTrack()`, `playAlbum()`, or the general `_loadAndPlay()`. The navigation should trigger when the user INITIATES playback, NOT on:
- Gapless auto-advance (track changes automatically)
- Next/Previous button (user is already aware of what's playing)
- Resume after pause

The cleanest approach: emit a custom event when USER-initiated playback starts, and listen for it in the app shell.

**Option A (simpler):** Add the navigation directly where user actions trigger playback:

In `js/screens/album.js` — when user clicks Play or a track:
```javascript
// After calling Player.playAlbum() or Player.playTrack():
if (SonanceSettings.autoNowPlaying) {
    navigateTo('nowplaying');
}
```

In `js/screens/search.js` — when user clicks a song result:
```javascript
if (SonanceSettings.autoNowPlaying) {
    navigateTo('nowplaying');
}
```

In `js/screens/library.js` — when user clicks a song in the Songs tab:
```javascript
if (SonanceSettings.autoNowPlaying) {
    navigateTo('nowplaying');
}
```

In `js/screens/artist.js` — when user clicks Play All or Shuffle All:
```javascript
if (SonanceSettings.autoNowPlaying) {
    navigateTo('nowplaying');
}
```

**Option B (cleaner):** Emit a 'userplay' event from the Player, listen once in app.js:

In Player, add a flag to distinguish user-initiated vs auto-advance:
```javascript
playTrack: function(track, queue, index) {
    this._userInitiated = true;
    // ... existing logic that calls _loadAndPlay
},

playAlbum: function(tracks, startIndex) {
    this._userInitiated = true;
    // ... existing logic
},

_loadAndPlay: function(url, track) {
    // ... existing logic
    if (this._userInitiated) {
        this.emit('userplay', track);
        this._userInitiated = false;
    }
}
```

In `js/app.js`:
```javascript
Player.on('userplay', function() {
    if (SonanceSettings.autoNowPlaying) {
        navigateTo('nowplaying');
    }
});
```

**Use Option B** — it's centralised and doesn't require modifying every screen.

Do NOT navigate on:
- `_onTrackEnded` auto-advance (gapless or normal)
- `next()` / `previous()` calls (user is controlling from NP bar or NP screen)
- `togglePlayPause()` (resume/pause)

### Settings Screen UI

Add to the Settings screen, in a "PLAYBACK" section (or add to an existing section):

```
PLAYBACK
────────────────────
Auto Now Playing        On ►
```

This is a toggle row. When focused, Left/Right or Enter toggles between On and Off:

```javascript
var autoNpRow = document.createElement('div');
autoNpRow.className = 'setting-row focusable';
// ... same pattern as lyrics offset row

var autoNpLabel = document.createElement('span');
autoNpLabel.textContent = 'Auto Now Playing';

var autoNpValue = document.createElement('span');
autoNpValue.textContent = SonanceSettings.autoNowPlaying ? 'On' : 'Off';
```

Key handler when focused:
```javascript
// Enter, Left, or Right toggles the value
SonanceSettings.autoNowPlaying = !SonanceSettings.autoNowPlaying;
localStorage.setItem('sonance-auto-now-playing', SonanceSettings.autoNowPlaying.toString());
autoNpValue.textContent = SonanceSettings.autoNowPlaying ? 'On' : 'Off';
```

Show arrows when focused: `◄ On ►` or `◄ Off ►`

### Navigation Guard

Don't navigate to Now Playing if the user is ALREADY on the Now Playing screen:
```javascript
Player.on('userplay', function() {
    if (SonanceSettings.autoNowPlaying && getCurrentScreen() !== 'nowplaying') {
        navigateTo('nowplaying');
    }
});
```

Check how the current screen is tracked (there should be a variable or function for this in the router).

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- localStorage for persistence
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
1. Setting defaults to On
2. Click a track in Album Detail → automatically navigates to Now Playing
3. Click Play on an album → navigates to Now Playing
4. Track auto-advances (gapless or normal) → stays on Now Playing (no re-navigation)
5. Press Next/Previous → stays on current screen
6. Settings → turn Auto Now Playing Off
7. Click a track → stays on Album Detail, music plays, NP bar updates
8. Close and reopen app → setting persists
9. Turn back On → auto-navigation works again

Update PROGRESS.md.

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P14c: Lyrics Timing Offset Setting.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md
3. Read js/screens/nowplaying.js — find the LyricsScroller and the progress event handler
4. Read js/screens/settings.js — understand how existing settings are stored

## FEATURE: Lyrics Timing Offset

Add a configurable offset (in milliseconds) that shifts lyrics timing earlier or later. Default is 0. Persisted between app restarts via localStorage.

### Why
Some Navidrome setups serve lyrics ~1 second late. This setting lets users compensate by adjusting the offset without modifying their .lrc files.

### Settings Page UI

Add a new section to the Settings screen:

```
LYRICS
────────────────────
Lyrics Offset    [-]  0 ms  [+]
```

- Label: "Lyrics Offset"
- Value display: shows current offset in milliseconds (e.g. "-500 ms", "0 ms", "+1000 ms")
- [-] and [+] buttons: decrease/increase by 100ms per press
- Hold/rapid press: keep incrementing (the d-pad repeat will handle this naturally)
- Range: -5000 to +5000 ms (±5 seconds should cover any reasonable drift)
- Default: 0
- Negative offset = lyrics appear EARLIER (compensates for late server lyrics)
- Positive offset = lyrics appear LATER

**Focus zones:**
- The [-] button and [+] button are focusable
- Left/Right arrows move between [-] and [+]
- Enter on [-] decreases by 100ms, Enter on [+] increases by 100ms
- Or simpler: make the whole row focusable, Left decreases, Right increases

**Simpler approach (recommended for d-pad):**
Make the offset value itself a single focusable row. When focused:
- **Left arrow:** decrease by 100ms
- **Right arrow:** increase by 100ms
- Display updates immediately
- No separate [-]/[+] buttons needed

```
Lyrics Offset          ◄ -500 ms ►
```

When focused, show left/right arrows. Pressing Left/Right adjusts the value.

### Persistence

Use localStorage to persist the offset:
```javascript
// Save
localStorage.setItem('sonance-lyrics-offset', offset.toString());

// Load (on app init)
var stored = localStorage.getItem('sonance-lyrics-offset');
var lyricsOffset = stored ? parseInt(stored, 10) : 0;
if (isNaN(lyricsOffset)) lyricsOffset = 0;
```

Store the offset in a global/shared location accessible by the NP screen:
```javascript
// In a settings manager or global config:
var SonanceSettings = {
    lyricsOffset: 0,  // milliseconds
    
    load: function() {
        var stored = localStorage.getItem('sonance-lyrics-offset');
        this.lyricsOffset = stored ? parseInt(stored, 10) : 0;
        if (isNaN(this.lyricsOffset)) this.lyricsOffset = 0;
    },
    
    setLyricsOffset: function(ms) {
        this.lyricsOffset = Math.max(-5000, Math.min(5000, ms));
        localStorage.setItem('sonance-lyrics-offset', this.lyricsOffset.toString());
    }
};
```

If a SonanceSettings object or similar already exists, add the lyrics offset to it. If not, create one.

Call `SonanceSettings.load()` during app initialisation.

### Apply Offset to Lyrics Sync

In the Now Playing screen's progress handler (where LyricsScroller.update is called), apply the offset:

```javascript
Player.on('progress', function(currentTime) {
    if (_lyricsVisible && _lyricsScroller && _currentLyrics && _currentLyrics.synced) {
        var adjustedMs = (currentTime * 1000) + SonanceSettings.lyricsOffset;
        _lyricsScroller.update(adjustedMs);
    }
});
```

That's it — a negative offset (e.g. -1000) makes `adjustedMs` smaller than the actual time, causing lyrics to match an earlier point in the song (i.e. they appear earlier, compensating for a late server).

### Settings Screen Implementation

In `js/screens/settings.js`, add the lyrics offset row:

```javascript
// Create lyrics section
var lyricsSection = document.createElement('div');
lyricsSection.style.cssText = 'margin-top: 32px;';

var lyricsLabel = document.createElement('div');
lyricsLabel.textContent = 'LYRICS';
lyricsLabel.style.cssText = 'font-size:13px;color:var(--text-muted);letter-spacing:1px;margin-bottom:16px;text-transform:uppercase;';
lyricsSection.appendChild(lyricsLabel);

var offsetRow = document.createElement('div');
offsetRow.className = 'setting-row focusable';
offsetRow.setAttribute('data-setting', 'lyrics-offset');
offsetRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-radius:8px;';

var offsetLabel = document.createElement('span');
offsetLabel.textContent = 'Lyrics Offset';
offsetLabel.style.cssText = 'font-size:15px;color:var(--text-primary);';

var offsetValue = document.createElement('span');
offsetValue.className = 'offset-value';
offsetValue.style.cssText = 'font-size:15px;color:var(--text-secondary);';
offsetValue.textContent = formatOffset(SonanceSettings.lyricsOffset);

offsetRow.appendChild(offsetLabel);
offsetRow.appendChild(offsetValue);
lyricsSection.appendChild(offsetRow);
```

Format helper:
```javascript
function formatOffset(ms) {
    if (ms === 0) return '0 ms';
    var sign = ms > 0 ? '+' : '';
    return sign + ms + ' ms';
}
```

Key handler for the offset row when focused:
```javascript
// When Left is pressed on the offset row:
SonanceSettings.setLyricsOffset(SonanceSettings.lyricsOffset - 100);
offsetValue.textContent = formatOffset(SonanceSettings.lyricsOffset);

// When Right is pressed on the offset row:
SonanceSettings.setLyricsOffset(SonanceSettings.lyricsOffset + 100);
offsetValue.textContent = formatOffset(SonanceSettings.lyricsOffset);
```

Add a visual hint when the row is focused:
```css
.setting-row.focused .offset-value::before { content: '◄ '; }
.setting-row.focused .offset-value::after { content: ' ►'; }
```
Or add the arrows via JS when the row receives focus.

### Focused State
When the offset row is focused:
- Show `◄ -500 ms ►` (arrows indicate Left/Right adjustability)
- Background: subtle highlight (same as other focused settings rows)

When unfocused:
- Show `-500 ms` (no arrows)

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin.
- localStorage is available on Tizen WebView
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
1. Open Settings screen → verify "Lyrics Offset" row appears
2. Focus it → arrows appear (◄ ► )
3. Press Right → offset increases by 100ms, display updates
4. Press Left → offset decreases by 100ms
5. Set to -1000 ms → play a song with lyrics → verify lyrics appear earlier
6. Set to +1000 ms → lyrics appear later
7. Close and reopen app → offset persists
8. Set to 0 ms → lyrics sync as before

Update PROGRESS.md.

# P14b — Synced Lyrics Display

## Overview
Add synced lyrics support to the Now Playing screen, using Navidrome's `getLyricsBySongId` OpenSubsonic endpoint. Lyrics display alongside the album art with real-time line highlighting synced to playback, Apple Music style.

## API

### Endpoint: getLyricsBySongId
```
GET /rest/getLyricsBySongId.view?id={songId}&f=json&...auth_params
```

**Response structure:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "lyricsList": {
      "structuredLyrics": [
        {
          "lang": "eng",
          "synced": true,
          "line": [
            { "start": 0, "value": "First line of lyrics" },
            { "start": 2000, "value": "Second line" },
            { "start": 3500, "value": "Third line..." }
          ]
        }
      ]
    }
  }
}
```

- `synced: true` means timing data is available (`start` in milliseconds)
- `synced: false` means plain text only (no timing — display as static text)
- Multiple `structuredLyrics` entries may exist (different languages) — use the first one, or prefer `lang: "eng"`
- `start` is in milliseconds from the beginning of the track
- If no lyrics available, the endpoint returns an empty `structuredLyrics` array or error

### Implementation in api.js
```javascript
getLyricsBySongId: function(songId) {
    return this._request('getLyricsBySongId.view', { id: songId });
}
```

Parse response:
```javascript
var data = response['subsonic-response'];
if (data.lyricsList && data.lyricsList.structuredLyrics) {
    var lyrics = data.lyricsList.structuredLyrics;
    // Prefer synced lyrics, then unsynced
    var synced = lyrics.filter(function(l) { return l.synced; });
    var unsynced = lyrics.filter(function(l) { return !l.synced; });
    return synced.length > 0 ? synced[0] : (unsynced.length > 0 ? unsynced[0] : null);
}
return null;
```

## UI Design — Now Playing Screen with Lyrics

### Toggle Behaviour
- **Lyrics button** in Now Playing transport controls (after star, before or after existing controls)
- Icon: speech bubble or text lines icon
- When pressed: Now Playing content slides LEFT, lyrics panel appears on the RIGHT
- When pressed again: lyrics slide out, Now Playing content slides back to CENTRE

### Layout: Lyrics OFF (default — current Now Playing screen)
```
┌──────────────────────────────────────────────┐
│          [blurred background]                 │
│                                               │
│              [Album Art 280px]                 │
│              Track Title                      │
│              Artist — Album                   │
│              ────●─────── 1:30 / 4:17        │
│         ⤮  ⏮  ⏸  ⏭  🔁  ☆  💬            │
│                                               │
└──────────────────────────────────────────────┘
```

### Layout: Lyrics ON
```
┌──────────────────────────────────────────────┐
│          [blurred background]                 │
│                                               │
│  [Album Art 220px]   │  Previous line         │
│  Track Title         │  Previous line         │
│  Artist — Album      │  ▸ CURRENT LINE ◂     │
│  ────●─────          │  Next line             │
│  ⤮ ⏮ ⏸ ⏭ 🔁 ☆ 💬  │  Next line             │
│                      │  Next line             │
│                      │  (auto-scrolls)        │
└──────────────────────────────────────────────┘
```

- Left side: album art shrinks from 280px to 220px, everything shifts left
- Right side: lyrics panel takes up ~50% of the width
- Divider: no visible line, just spacing (40px gap)
- Slide animation: 0.4s ease transition on the left section's position and the lyrics panel opacity/position

### Lyrics Panel Design

**Active line (currently playing):**
- `--text-primary` colour (white)
- Font size: 22px, weight 700
- Full opacity

**Upcoming lines (after current):**
- `--text-secondary` colour
- Font size: 18px, weight 400
- Opacity: 0.6

**Past lines (before current):**
- `--text-muted` colour
- Font size: 18px, weight 400
- Opacity: 0.3

**Auto-scroll:**
- The active line should be positioned approximately 1/3 from the top of the lyrics panel
- As lines change, the panel smoothly scrolls to keep the active line at this position
- Use `transform: translateY()` with CSS transition for smooth scrolling (NOT scrollTop animation which is janky)
- All lyrics are rendered in a single container, and the container's `translateY` is adjusted

**Line transition:**
- When the active line changes, the new line animates to the bold/bright state over 0.3s
- The previous line fades to the "past" state simultaneously

### Synced vs Unsynced Behaviour

**If `synced: true`:**
- Track playback time from Player `progress` events (fires frequently)
- Find the active line: the last line where `line.start <= currentTime * 1000`
- Highlight that line, fade past lines, show upcoming lines
- Auto-scroll to active line

**If `synced: false`:**
- Display all lyrics as static text, no highlighting
- User can scroll manually with Up/Down arrows when lyrics panel is focused
- No auto-scroll

**If no lyrics available:**
- The lyrics button is greyed out / not shown
- Or: pressing it shows "No lyrics available" message

### Lyrics Caching
- Cache lyrics per song ID in memory (don't re-fetch on every lyrics toggle)
- Clear cache when app restarts
- Fetch lyrics when a new track starts playing (pre-fetch for smooth toggle)

### Pre-fetching
When a new track starts:
1. Call `getLyricsBySongId(track.id)` in the background
2. Store the result in a lyrics cache: `_lyricsCache[songId] = lyricsData`
3. If the lyrics panel is already open, update it immediately
4. If the panel is closed, the data is ready for when the user toggles it

## Implementation Details

### Lyrics Button Icon SVG
```svg
<!-- Text/lyrics icon -->
<svg viewBox="0 0 24 24" fill="none">
    <path d="M3 5h14M3 9h10M3 13h12M3 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### Now Playing Screen Modifications

The Now Playing screen needs to support two states:

**State: lyrics OFF**
- Current layout — centred album art, track info, controls
- Album art: 280px
- All content centred

**State: lyrics ON**
- Left section: shrink art to 220px, shift everything left
- Right section: lyrics panel with synced scrolling text
- CSS transition between states: `transition: all 0.4s ease`

Implementation approach — wrap the NP content in a container that shifts:
```css
.np-layout {
    display: flex;
    justify-content: center;
    transition: all 0.4s ease;
}
.np-layout.lyrics-active {
    justify-content: flex-start;
    padding-left: 80px;
}
.np-left {
    /* existing NP content (art, title, controls) */
    width: 400px;
    flex-shrink: 0;
    transition: all 0.4s ease;
}
.np-lyrics-panel {
    flex: 1;
    opacity: 0;
    transform: translateX(40px);
    transition: all 0.4s ease;
    overflow: hidden;
    pointer-events: none;
}
.lyrics-active .np-lyrics-panel {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
}
```
NOTE: Use `margin-left: 40px` on `.np-lyrics-panel` (NOT flex gap — Chromium 63).

### Lyrics Scroll Engine
```javascript
var LyricsScroller = {
    _container: null,
    _lines: [],
    _activeIndex: -1,
    _offset: 0,
    
    init: function(container, lyricsData) {
        this._container = container;
        this._lines = lyricsData.line;
        this._render();
    },
    
    _render: function() {
        // Create all line elements
        var frag = document.createDocumentFragment();
        var self = this;
        this._lineElements = [];
        this._lines.forEach(function(line, i) {
            var el = document.createElement('div');
            el.className = 'lyrics-line lyrics-upcoming';
            el.textContent = line.value;
            el.style.cssText = 'padding: 8px 0; transition: all 0.3s ease;';
            frag.appendChild(el);
            self._lineElements.push(el);
        });
        this._container.innerHTML = '';
        this._container.appendChild(frag);
    },
    
    update: function(currentTimeMs) {
        // Find active line
        var newIndex = -1;
        for (var i = this._lines.length - 1; i >= 0; i--) {
            if (this._lines[i].start <= currentTimeMs) {
                newIndex = i;
                break;
            }
        }
        
        if (newIndex === this._activeIndex) return;
        this._activeIndex = newIndex;
        
        // Update line styles
        for (var j = 0; j < this._lineElements.length; j++) {
            var el = this._lineElements[j];
            if (j === newIndex) {
                el.className = 'lyrics-line lyrics-active';
            } else if (j < newIndex) {
                el.className = 'lyrics-line lyrics-past';
            } else {
                el.className = 'lyrics-line lyrics-upcoming';
            }
        }
        
        // Scroll: position active line at ~1/3 from top
        if (newIndex >= 0) {
            var targetY = this._lineElements[newIndex].offsetTop;
            var containerH = this._container.parentElement.clientHeight;
            var scrollTo = targetY - containerH * 0.33;
            this._container.style.transform = 'translateY(' + (-Math.max(0, scrollTo)) + 'px)';
            this._container.style.transition = 'transform 0.5s ease';
        }
    },
    
    destroy: function() {
        this._container.innerHTML = '';
        this._lineElements = [];
        this._activeIndex = -1;
    }
};
```

### CSS for Lyrics Lines
```css
.lyrics-line {
    padding: 8px 0;
    transition: color 0.3s ease, opacity 0.3s ease, font-size 0.3s ease;
}
.lyrics-active {
    color: var(--text-primary);
    font-size: 22px;
    font-weight: 700;
    opacity: 1;
}
.lyrics-upcoming {
    color: var(--text-secondary);
    font-size: 18px;
    font-weight: 400;
    opacity: 0.6;
}
.lyrics-past {
    color: var(--text-muted);
    font-size: 18px;
    font-weight: 400;
    opacity: 0.3;
}
```

### Player Progress Hook
In the NP screen, listen for Player progress events and update lyrics:
```javascript
Player.on('progress', function(currentTime) {
    if (self._lyricsVisible && self._lyricsScroller) {
        self._lyricsScroller.update(currentTime * 1000); // convert seconds to ms
    }
});
```

### Track Change Hook
```javascript
Player.on('trackchange', function(track) {
    if (track) {
        // Pre-fetch lyrics for new track
        api.getLyricsBySongId(track.id).then(function(data) {
            self._currentLyrics = self._parseLyrics(data);
            if (self._lyricsVisible && self._currentLyrics) {
                self._lyricsScroller.init(lyricsContainer, self._currentLyrics);
            }
            // Show/hide lyrics button based on availability
            self._updateLyricsButton();
        }).catch(function() {
            self._currentLyrics = null;
            self._updateLyricsButton();
        });
    }
});
```

## Test Data
- **Test song:** "Phony Rappers" by A Tribe Called Quest (album: Beats, Rhymes and Life)
- The user has placed `.lrc` files alongside songs in Navidrome
- Navidrome serves these via `getLyricsBySongId`

## Chromium 63 Reminders
- NO flex `gap` — use margin-left on lyrics panel
- `transition` CSS property is fully supported
- `transform: translateY()` is fully supported
- `element.offsetTop` is supported
- NO optional chaining or nullish coalescing

## Files Modified
- `js/api.js` — add getLyricsBySongId method
- `js/screens/nowplaying.js` — lyrics toggle, panel, scroll engine, pre-fetch
- `css/styles.css` — lyrics panel styles, line states, slide animation
- `PROGRESS.md`

You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P14b: Synced Lyrics Display on Now Playing Screen.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Test song with .lrc file: "Phony Rappers" by A Tribe Called Quest (album: Beats, Rhymes and Life)

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints (NO flex gap, NO ?., etc.)
2. Read PROGRESS.md
3. Read tickets/P14b-lyrics.md — the full spec
4. Read js/screens/nowplaying.js — understand the current NP screen layout
5. Read js/api.js — you'll add the getLyricsBySongId method here

## FEATURE: Apple Music-Style Synced Lyrics

### Part 1: API (js/api.js)

Add the OpenSubsonic lyrics endpoint:
```javascript
getLyricsBySongId: function(songId) {
    return this._request('getLyricsBySongId.view', { id: songId });
}
```

Parse helper (can live in NP screen or utils):
```javascript
function parseLyricsResponse(response) {
    var data = response['subsonic-response'];
    if (!data || !data.lyricsList || !data.lyricsList.structuredLyrics) return null;
    var all = data.lyricsList.structuredLyrics;
    if (!all.length) return null;
    // Prefer synced, then unsynced
    var synced = null;
    var unsynced = null;
    for (var i = 0; i < all.length; i++) {
        if (all[i].synced && !synced) synced = all[i];
        if (!all[i].synced && !unsynced) unsynced = all[i];
    }
    return synced || unsynced || null;
}
```

### Part 2: Now Playing Screen Layout Changes

The NP screen needs TWO states:

**State A: Lyrics OFF (default — current layout)**
- Everything centred as it is now
- Album art at current size (280px or whatever it currently is)

**State B: Lyrics ON**
- Left section slides left (album art shrinks to 220px, all NP content shifts left)
- Right section: lyrics panel appears with slide-in animation
- CSS transition: 0.4s ease

**Implementation approach:**

Wrap all existing NP content in a `.np-layout` flex container with two children:
```html
<div class="np-layout">
    <div class="np-left">
        <!-- ALL existing NP content: art, title, artist, progress, controls -->
    </div>
    <div class="np-lyrics-panel">
        <div class="np-lyrics-scroll-wrapper">
            <div class="np-lyrics-lines">
                <!-- Line elements rendered here -->
            </div>
        </div>
    </div>
</div>
```

CSS:
```css
.np-layout {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    height: 100%;
    transition: all 0.4s ease;
}

.np-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: all 0.4s ease;
    flex-shrink: 0;
}

.np-lyrics-panel {
    flex: 1;
    max-width: 55%;
    opacity: 0;
    transform: translateX(40px);
    transition: opacity 0.4s ease, transform 0.4s ease;
    overflow: hidden;
    height: 100%;
    pointer-events: none;
    margin-left: 0;  /* NOT flex gap — Chromium 63 */
}

/* When lyrics are active */
.np-layout.lyrics-active {
    justify-content: flex-start;
    padding-left: 80px;
}

.np-layout.lyrics-active .np-left {
    width: 400px;
}

.np-layout.lyrics-active .np-lyrics-panel {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
    margin-left: 48px;  /* spacing — NOT gap */
}

/* Shrink album art when lyrics are shown */
.np-layout.lyrics-active .np-album-art {
    width: 220px;
    height: 220px;
}
```

NOTE: Use `margin-left: 48px` on the lyrics panel — NOT flex gap. Chromium 63 does NOT support flex gap.

### Part 3: Lyrics Panel & Scroll Engine

**Line rendering:**
Create all line elements up front. Each line is a `<div>` with class based on state:

```css
.lyrics-line {
    padding: 10px 0;
    transition: color 0.3s ease, opacity 0.3s ease, font-weight 0.3s ease;
    line-height: 1.4;
}

.lyrics-line.lyrics-active {
    color: white;
    font-size: 22px;
    font-weight: 700;
    opacity: 1;
}

.lyrics-line.lyrics-upcoming {
    color: rgba(255, 255, 255, 0.6);
    font-size: 18px;
    font-weight: 400;
    opacity: 0.6;
}

.lyrics-line.lyrics-past {
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    font-weight: 400;
    opacity: 0.3;
}
```

**Auto-scroll with translateY:**
The lyrics container uses `transform: translateY()` to scroll, keeping the active line at approximately 1/3 from the top of the visible area. CSS `transition: transform 0.5s ease` makes it smooth.

```javascript
var LyricsScroller = {
    _container: null,       // the .np-lyrics-lines div
    _wrapper: null,         // the .np-lyrics-scroll-wrapper div (overflow hidden)
    _lines: [],             // lyrics data from API
    _lineElements: [],      // DOM elements
    _activeIndex: -1,

    init: function(wrapper, container, lyricsData) {
        this._wrapper = wrapper;
        this._container = container;
        this._lines = lyricsData.line || [];
        this._synced = lyricsData.synced;
        this._activeIndex = -1;
        this._render();
    },

    _render: function() {
        this._container.innerHTML = '';
        this._lineElements = [];
        var frag = document.createDocumentFragment();
        for (var i = 0; i < this._lines.length; i++) {
            var el = document.createElement('div');
            el.className = 'lyrics-line lyrics-upcoming';
            el.textContent = this._lines[i].value || '';
            frag.appendChild(el);
            this._lineElements.push(el);
        }
        this._container.appendChild(frag);
        // Reset scroll position
        this._container.style.transform = 'translateY(0)';
    },

    update: function(currentTimeMs) {
        if (!this._synced || !this._lines.length) return;

        // Find active line: last line where start <= currentTime
        var newIndex = -1;
        for (var i = this._lines.length - 1; i >= 0; i--) {
            if (this._lines[i].start <= currentTimeMs) {
                newIndex = i;
                break;
            }
        }

        if (newIndex === this._activeIndex) return;
        this._activeIndex = newIndex;

        // Update line classes
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

        // Auto-scroll: keep active line at ~1/3 from top
        if (newIndex >= 0 && this._lineElements[newIndex]) {
            var lineTop = this._lineElements[newIndex].offsetTop;
            var wrapperH = this._wrapper.clientHeight;
            var targetScroll = lineTop - (wrapperH * 0.33);
            targetScroll = Math.max(0, targetScroll);
            this._container.style.transition = 'transform 0.5s ease';
            this._container.style.transform = 'translateY(' + (-targetScroll) + 'px)';
        }
    },

    reset: function() {
        this._activeIndex = -1;
        if (this._container) {
            this._container.style.transform = 'translateY(0)';
        }
        for (var k = 0; k < this._lineElements.length; k++) {
            this._lineElements[k].className = 'lyrics-line lyrics-upcoming';
        }
    },

    destroy: function() {
        if (this._container) this._container.innerHTML = '';
        this._lineElements = [];
        this._lines = [];
        this._activeIndex = -1;
    }
};
```

### Part 4: Lyrics Button in Transport Controls

Add a lyrics button to the NP transport controls row. Position: AFTER the star button (rightmost, or second-to-last).

Icon SVG (text lines icon):
```html
<svg viewBox="0 0 24 24" width="24" height="24" fill="none">
    <path d="M3 5h14M3 9h10M3 13h12M3 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

Focus behaviour: icon colour → `--accent` (pink), same as other NP controls.

States:
- **Lyrics available:** normal icon, clickable
- **No lyrics:** hide the button or show it greyed out (opacity: 0.3, not focusable)
- **Lyrics active:** icon is pink even when unfocused (indicator that lyrics panel is open)

On Enter: toggle lyrics panel open/closed.

### Part 5: Lyrics Pre-Fetching & Caching

```javascript
var _lyricsCache = {};  // songId → parsed lyrics data (or null)
var _currentLyrics = null;
var _lyricsVisible = false;

// On track change:
Player.on('trackchange', function(track) {
    if (!track) return;
    var songId = track.id;
    if (_lyricsCache[songId] !== undefined) {
        // Already cached
        _currentLyrics = _lyricsCache[songId];
        _updateLyricsUI();
    } else {
        // Fetch
        api.getLyricsBySongId(songId).then(function(response) {
            _currentLyrics = parseLyricsResponse(response);
            _lyricsCache[songId] = _currentLyrics;
            _updateLyricsUI();
        }).catch(function() {
            _currentLyrics = null;
            _lyricsCache[songId] = null;
            _updateLyricsUI();
        });
    }
});
```

`_updateLyricsUI()`:
- If `_currentLyrics` exists: show lyrics button, if lyrics panel is open re-init scroller
- If `_currentLyrics` is null: hide/grey lyrics button, close lyrics panel if open

### Part 6: Progress Sync

Hook into the Player's progress event to drive lyrics scrolling:
```javascript
Player.on('progress', function(currentTime) {
    if (_lyricsVisible && _lyricsScroller && _currentLyrics && _currentLyrics.synced) {
        _lyricsScroller.update(currentTime * 1000);  // Player gives seconds, API uses milliseconds
    }
});
```

This fires frequently enough (every ~250ms from AVPlay's `oncurrentplaytime` or HTML5 `timeupdate`) to keep lyrics in sync.

### Part 7: Seek Handling

When the user seeks, the lyrics need to jump to the correct position immediately (not smooth-scroll through intermediate lines):

```javascript
Player.on('seeked', function(currentTime) {
    if (_lyricsVisible && _lyricsScroller) {
        // Force immediate update without transition
        _lyricsScroller._container.style.transition = 'none';
        _lyricsScroller.update(currentTime * 1000);
        // Re-enable transition after a frame
        setTimeout(function() {
            _lyricsScroller._container.style.transition = 'transform 0.5s ease';
        }, 50);
    }
});
```

If a 'seeked' event doesn't exist yet in the player, add one. Fire it from the seek functions in player.js after seeking completes.

### Part 8: Unsynced Lyrics Fallback

If `synced: false`, display all lyrics as static text without highlighting or auto-scroll:
- All lines rendered in `lyrics-upcoming` style (uniform appearance)
- User can scroll manually with Up/Down arrow keys
- Manual scroll: adjust `translateY` by ±50px per key press

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin-left. Use `grid-gap` for grids.
- No `aspect-ratio` CSS. No `backdrop-filter`.
- No `scrollIntoView` with options — use translateY approach.
- Use `transition` for all animations (supported on Chromium 63).
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
1. Play "Phony Rappers" by A Tribe Called Quest
2. Go to Now Playing screen
3. Verify lyrics button appears in transport controls
4. Press lyrics button → NP content slides left, lyrics panel slides in from right
5. Verify lyrics lines appear with correct text
6. If synced: active line is bold white, past lines faded, upcoming lines dimmed
7. As music plays, active line changes and panel auto-scrolls
8. Press lyrics button again → lyrics slide out, NP content centres
9. Change track → lyrics update (or button hides if no lyrics)
10. Seek → lyrics jump to correct position

### Check:
- No flex gap used
- Slide animation is smooth (0.4s)
- Auto-scroll is smooth (0.5s ease)
- No layout break when lyrics toggle on/off
- Works with and without lyrics (button state changes)

Update PROGRESS.md.

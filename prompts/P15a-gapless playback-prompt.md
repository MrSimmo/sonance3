You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P15a: Near-Gapless Playback.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — Tizen 5.0 constraints
2. Read PROGRESS.md — understand everything that's been built
3. Read js/player.js VERY CAREFULLY — understand the AVPlay backend, HTML5 Audio backend, event system, state management
4. Read js/screens/nowplaying.js — understand what listens to Player events (trackchange, progress, seeked)
5. Read js/starred.js or wherever StarredCache is — it listens to trackchange

## CRITICAL: NO REGRESSIONS
This patch modifies the player's track transition logic. The following MUST still work after this patch:
- [ ] AVPlay playback on Tizen (open → prepareAsync → play lifecycle)
- [ ] HTML5 Audio playback in browser
- [ ] Track auto-advances at end of song
- [ ] Next/Previous buttons work
- [ ] Shuffle/Repeat modes work
- [ ] Player.emit('trackchange', track) fires on EVERY track transition (gapless or not)
- [ ] Synced lyrics update on track change (NP screen listens to trackchange)
- [ ] Star icon updates on track change
- [ ] Play/Pause works during and after gapless transitions
- [ ] Seek works (and lyrics jump to correct position)
- [ ] Queue management (add, remove, play next) still works

## FEATURE: Near-Gapless Playback

### Strategy

**AVPlay (Tizen):** Pre-compute the next track's stream URL 5 seconds before the current track ends. When `onstreamcompleted` fires, immediately start the `stop → close → open → prepareAsync → play` cycle with the URL ready. The gap is the AVPlay lifecycle time (~100-300ms), but we skip the URL lookup time.

**HTML5 Audio (Browser):** Add a second hidden `<audio>` element that pre-loads the next track. When the active element fires `ended`, immediately play the pre-loaded element and swap references. Near-zero gap since the audio is already buffered.

### Part 1: Shared Logic — Determine Next Track

Add a method that determines the next track WITHOUT advancing the queue. This is used by both backends for pre-preparation:

```javascript
_determineNextTrack: function() {
    if (!this.queue || !this.queue.length) return null;

    if (this.repeat === 'one') {
        return { track: this.currentTrack, index: this.queueIndex };
    }

    var nextIndex = this.queueIndex + 1;

    if (this.shuffle) {
        // If shuffle is on, the queue is already shuffled
        // Just advance to the next position
    }

    if (nextIndex >= this.queue.length) {
        if (this.repeat === 'all') {
            nextIndex = 0;
        } else {
            return null;  // End of queue, no repeat — playback will stop
        }
    }

    return { track: this.queue[nextIndex], index: nextIndex };
},
```

### Part 2: Pre-Prepare State

Add state variables to the Player:
```javascript
_nextPreparedUrl: null,
_nextPreparedTrack: null,
_nextPreparedIndex: -1,
_preloadAudio: null,        // browser only — second audio element
_preloadReady: false,       // browser only — preload element has buffered

_resetPreparedTrack: function() {
    this._nextPreparedUrl = null;
    this._nextPreparedTrack = null;
    this._nextPreparedIndex = -1;
    this._preloadReady = false;
    if (this._preloadAudio) {
        this._preloadAudio.pause();
        this._preloadAudio.removeAttribute('src');
        this._preloadAudio.load();  // reset
    }
},
```

### Part 3: Pre-Prepare Trigger

**For AVPlay (in `oncurrentplaytime` callback):**
```javascript
oncurrentplaytime: function(ms) {
    self.currentTime = ms / 1000;
    self.emit('progress', self.currentTime, self.duration);
    self._checkScrobble();

    // Pre-prepare next track 5 seconds before end
    if (self.duration > 10 && self.currentTime > self.duration - 5 && !self._nextPreparedUrl) {
        var nextInfo = self._determineNextTrack();
        if (nextInfo) {
            self._nextPreparedUrl = self._getStreamUrl(nextInfo.track.id);
            self._nextPreparedTrack = nextInfo.track;
            self._nextPreparedIndex = nextInfo.index;
            console.log('[Sonance][Player] Pre-prepared next: ' + nextInfo.track.title);
        }
    }
},
```

**For HTML5 Audio (in `timeupdate` handler):**
```javascript
self._audioElement.addEventListener('timeupdate', function() {
    self.currentTime = self._audioElement.currentTime;
    self.duration = self._audioElement.duration || 0;
    self.emit('progress', self.currentTime, self.duration);
    self._checkScrobble();

    // Pre-load next track 5 seconds before end
    if (self.duration > 10 && self.currentTime > self.duration - 5
        && !self._preloadReady && self._preloadAudio) {
        var nextInfo = self._determineNextTrack();
        if (nextInfo) {
            self._nextPreparedTrack = nextInfo.track;
            self._nextPreparedIndex = nextInfo.index;
            self._preloadAudio.src = self._getStreamUrl(nextInfo.track.id);
            self._preloadAudio.load();
            self._preloadReady = true;
            console.log('[Sonance][Player] Pre-loaded next: ' + nextInfo.track.title);
        }
    }
});
```

### Part 4: Fast Transition on Track End

**AVPlay (`onstreamcompleted`):**
```javascript
onstreamcompleted: function() {
    console.log('[Sonance][Player] Stream completed');
    if (self._nextPreparedUrl && self._nextPreparedTrack) {
        // Fast path: URL is ready, skip the lookup
        var url = self._nextPreparedUrl;
        var track = self._nextPreparedTrack;
        var idx = self._nextPreparedIndex;

        // Clear pre-prepared state BEFORE loading (prevent re-trigger)
        self._nextPreparedUrl = null;
        self._nextPreparedTrack = null;
        self._nextPreparedIndex = -1;

        // Update queue position
        self.queueIndex = idx;

        // Load and play — this calls _avplayLoadAndPlay which handles
        // stop → close → open → prepareAsync → play
        self._loadAndPlay(url, track);
    } else {
        // No pre-prepared track — use normal next() logic
        self._onTrackEnded();
    }
},
```

**HTML5 Audio (`ended`):**
```javascript
self._audioElement.addEventListener('ended', function() {
    if (self._preloadReady && self._preloadAudio && self._nextPreparedTrack) {
        // Swap: preload becomes active
        var oldActive = self._audioElement;
        self._audioElement = self._preloadAudio;
        self._preloadAudio = oldActive;

        // Update state
        self.queueIndex = self._nextPreparedIndex;
        self.currentTrack = self._nextPreparedTrack;
        self.currentTime = 0;
        self.duration = self._audioElement.duration || 0;
        self._scrobbled = false;

        // Play the pre-loaded audio
        self._audioElement.play().catch(function(e) {
            console.error('[Sonance][Player] Preload play failed:', e);
        });
        self.isPlaying = true;

        // Re-attach event listeners to new active element
        self._detachHtmlListeners(oldActive);
        self._attachHtmlListeners(self._audioElement);

        // Reset preload state
        self._preloadReady = false;
        self._nextPreparedTrack = null;
        self._nextPreparedIndex = -1;

        // CRITICAL: Emit trackchange so lyrics, stars, NP screen all update
        self.emit('trackchange', self.currentTrack);
        self.emit('play');

        console.log('[Sonance][Player] Gapless swap to: ' + self.currentTrack.title);
    } else {
        // Normal path
        self._onTrackEnded();
    }
});
```

### Part 5: Event Listener Management (Browser)

Since we swap audio elements, we need clean attach/detach:

```javascript
_attachHtmlListeners: function(audioEl) {
    var self = this;
    audioEl._onTimeUpdate = function() {
        self.currentTime = audioEl.currentTime;
        self.duration = audioEl.duration || 0;
        self.emit('progress', self.currentTime, self.duration);
        self._checkScrobble();

        // Pre-load trigger
        if (self.duration > 10 && self.currentTime > self.duration - 5
            && !self._preloadReady && self._preloadAudio) {
            var nextInfo = self._determineNextTrack();
            if (nextInfo) {
                self._nextPreparedTrack = nextInfo.track;
                self._nextPreparedIndex = nextInfo.index;
                self._preloadAudio.src = self._getStreamUrl(nextInfo.track.id);
                self._preloadAudio.load();
                self._preloadReady = true;
                console.log('[Sonance][Player] Pre-loaded next: ' + nextInfo.track.title);
            }
        }
    };
    audioEl._onEnded = function() {
        if (self._preloadReady && self._preloadAudio && self._nextPreparedTrack) {
            // Gapless swap (code from Part 4 above)
            // ... (same logic)
        } else {
            self._onTrackEnded();
        }
    };
    audioEl._onError = function(e) {
        console.error('[Sonance][Player] HTML5 audio error:', e);
        self.next();
    };

    audioEl.addEventListener('timeupdate', audioEl._onTimeUpdate);
    audioEl.addEventListener('ended', audioEl._onEnded);
    audioEl.addEventListener('error', audioEl._onError);
},

_detachHtmlListeners: function(audioEl) {
    if (audioEl._onTimeUpdate) {
        audioEl.removeEventListener('timeupdate', audioEl._onTimeUpdate);
    }
    if (audioEl._onEnded) {
        audioEl.removeEventListener('ended', audioEl._onEnded);
    }
    if (audioEl._onError) {
        audioEl.removeEventListener('error', audioEl._onError);
    }
},
```

### Part 6: Second Audio Element for Browser

Add to `index.html`:
```html
<audio id="sonance-audio" preload="auto" crossorigin="anonymous"></audio>
<audio id="sonance-audio-preload" preload="auto" crossorigin="anonymous"></audio>
```

In Player.init():
```javascript
if (!IS_TIZEN) {
    this._audioElement = document.getElementById('sonance-audio');
    this._preloadAudio = document.getElementById('sonance-audio-preload');
    this._attachHtmlListeners(this._audioElement);
}
```

### Part 7: Reset Pre-Prepared State on Manual Actions

Call `_resetPreparedTrack()` in ALL of these methods:
- `next()` — user manually skips
- `previous()` — user goes back
- `playAlbum()` / `playTrack()` — user starts new playback
- `toggleShuffle()` — shuffle changes next track order
- `setRepeat()` — repeat mode changes next track
- `removeFromQueue()` — queue changed
- `clearQueue()` — queue cleared
- `seekTo()` — if user seeks backward past the 5-second window, the pre-prepared track may be wrong

```javascript
next: function() {
    this._resetPreparedTrack();
    // ... existing next logic
},

previous: function() {
    this._resetPreparedTrack();
    // ... existing previous logic
},

// etc.
```

### Part 8: getActiveAudioElement (Browser)

Ensure this always returns the CURRENT active element (not the preload one):
```javascript
getActiveAudioElement: function() {
    if (!IS_TIZEN && this._audioElement) {
        return this._audioElement;
    }
    return null;
},
```

After a swap, `this._audioElement` points to the new active one — this is correct.

### Part 9: Verify _onTrackEnded Still Works

The existing `_onTrackEnded` method handles:
- Repeat one: replay current track
- Repeat all: loop back to start
- No repeat: stop at end of queue
- Normal advance: next track

This method must NOT be modified — it's the fallback when pre-preparation didn't happen (e.g. very short tracks under 10 seconds, or edge cases). The gapless paths bypass `_onTrackEnded` only when a pre-prepared track is available.

### Part 10: Edge Cases

- **Track shorter than 10 seconds:** The `duration > 10` guard prevents pre-loading for very short tracks. These use the normal sequential transition. This is fine — the gap on a 5-second interlude track is acceptable.
- **Repeat One:** `_determineNextTrack` returns the same track. AVPlay: same URL, still pre-prepared. Browser: preload element loads same URL.
- **End of queue (no repeat):** `_determineNextTrack` returns null. No pre-preparation happens. `_onTrackEnded` handles the stop.
- **Shuffle toggle near end:** `_resetPreparedTrack()` clears the pre-prepared state. If less than 5 seconds remain, there may not be time to re-prepare — falls back to sequential.
- **Seek backward:** If user seeks from 3:55 to 1:00, the pre-prepared state should reset since we might re-enter the 5-second window later. Add reset on seek:
  ```javascript
  seekTo: function(seconds) {
      // If seeking backward past the pre-prepare threshold, reset
      if (this._nextPreparedUrl || this._preloadReady) {
          this._resetPreparedTrack();
      }
      // ... existing seek code
  }
  ```

## RULES
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- AVPlay state checks: ALWAYS call `getState()` before `stop()` or `close()`
- Wrap all AVPlay calls in try/catch
- ALWAYS emit `trackchange` on every transition — gapless or not
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING — ALL MUST PASS

### Browser:
- [ ] Play an album, let tracks auto-advance — gap should be imperceptible
- [ ] Console: "[Sonance][Player] Pre-loaded next: {title}" at 5 seconds before end
- [ ] Console: "[Sonance][Player] Gapless swap to: {title}" at transition
- [ ] Press Next manually — works, resets pre-prepared state
- [ ] Press Previous — works
- [ ] Toggle shuffle near end of track — no crash
- [ ] Repeat One — same track replays with minimal gap
- [ ] Repeat All — loops from last track to first
- [ ] No Repeat — playback stops at end of queue
- [ ] Seek backward during pre-prepare window — resets cleanly
- [ ] Synced lyrics update on gapless transition (trackchange fires)
- [ ] Star icon updates on gapless transition
- [ ] Play/Pause works during and after transitions
- [ ] Queue add/remove works

### TV (after deployment):
- [ ] Same tests as browser
- [ ] Gap between tracks should be short (~100-300ms)
- [ ] No AVPlay errors in console
- [ ] No audio glitches or double-play

Update PROGRESS.md.

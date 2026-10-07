You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P13e: Near-Gapless Playback.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — P13c (AVPlay) and P13d (visualiser) must be complete
3. Read js/player.js — understand the AVPlay and HTML5 Audio backends

## FEATURE: Near-Gapless Playback

Minimise the gap between tracks on both backends.

### AVPlay Backend (Tizen)

AVPlay only supports one active instance. The gap is caused by the sequential: `stop() → close() → open(url) → prepareAsync() → play()` lifecycle. We can minimise this by pre-computing the next track URL.

**Pre-prepare logic:**
```javascript
var _nextTrackUrl = null;
var _nextTrack = null;

// In the oncurrentplaytime callback, when near end of track:
oncurrentplaytime: function(ms) {
    self.currentTime = ms / 1000;
    
    // Pre-prepare next track URL 5 seconds before end
    if (self.duration > 0 && self.currentTime > self.duration - 5 && !_nextTrackUrl) {
        var nextInfo = self._determineNextTrack();
        if (nextInfo) {
            _nextTrackUrl = self._api.getStreamUrl(nextInfo.track.id);
            _nextTrack = nextInfo.track;
            _nextQueueIndex = nextInfo.index;
            console.log('[Sonance][Player] Pre-prepared next: ' + nextInfo.track.title);
        }
    }
    
    self.emit('progress', self.currentTime, self.duration);
    self._checkScrobble();
}
```

**Fast transition on track end:**
```javascript
_onTrackEnded: function() {
    if (_nextTrackUrl && _nextTrack) {
        // Use pre-prepared URL — skip the lookup
        var url = _nextTrackUrl;
        var track = _nextTrack;
        var idx = _nextQueueIndex;
        _nextTrackUrl = null;
        _nextTrack = null;
        
        this.queueIndex = idx;
        this._loadAndPlay(url, track);
    } else {
        // Fallback: determine next track normally
        this.next();
    }
}
```

**Reset pre-prepared track on manual actions:**
```javascript
// When user presses Next, Previous, or changes queue:
_resetPreparedTrack: function() {
    _nextTrackUrl = null;
    _nextTrack = null;
}
```
Call `_resetPreparedTrack()` in `next()`, `previous()`, `playAlbum()`, `toggleShuffle()`.

**Helper to determine next track without advancing:**
```javascript
_determineNextTrack: function() {
    if (this.repeat === 'one') {
        return { track: this.currentTrack, index: this.queueIndex };
    }
    var nextIndex = this.queueIndex + 1;
    if (nextIndex >= this.queue.length) {
        if (this.repeat === 'all') {
            nextIndex = 0;
        } else {
            return null; // End of queue, no repeat
        }
    }
    return { track: this.queue[nextIndex], index: nextIndex };
}
```

### HTML5 Audio Backend (Browser)

Use two `<audio>` elements and swap between them for true near-gapless:

**Add second audio element to index.html:**
```html
<audio id="sonance-audio" preload="auto" crossorigin="anonymous"></audio>
<audio id="sonance-audio-preload" preload="auto" crossorigin="anonymous"></audio>
```

**Pre-load logic:**
```javascript
var _preloadAudio = document.getElementById('sonance-audio-preload');
var _preloadReady = false;

// In timeupdate handler, near end of track:
if (self.duration > 0 && self.currentTime > self.duration - 5 && !_preloadReady) {
    var nextInfo = self._determineNextTrack();
    if (nextInfo) {
        _preloadAudio.src = self._api.getStreamUrl(nextInfo.track.id);
        _preloadAudio.load();
        _nextTrack = nextInfo.track;
        _nextQueueIndex = nextInfo.index;
        _preloadReady = true;
    }
}
```

**On track ended:**
```javascript
// HTML5 path in _onTrackEnded:
if (!IS_TIZEN && _preloadReady && _preloadAudio) {
    // Swap: preload becomes active, active becomes preload
    var oldActive = self._audioElement;
    self._audioElement = _preloadAudio;
    _preloadAudio = oldActive;
    
    // Update element IDs for future reference (optional)
    self.queueIndex = _nextQueueIndex;
    self.currentTrack = _nextTrack;
    
    // Play the pre-loaded audio
    self._audioElement.play();
    self.isPlaying = true;
    
    // Re-attach event listeners to new active element
    self._setupHtmlListeners();
    
    // Reset
    _preloadReady = false;
    _nextTrack = null;
    
    self.emit('trackchange', self.currentTrack);
    self.emit('play');
} else {
    // Fallback: normal sequential load
    self.next();
}
```

**CRITICAL for browser swap:**
- Remove event listeners from old active element before swapping
- Re-attach listeners to new active element
- The `getActiveAudioElement()` method must always return `_audioElement` (the current active one)
- Reset `_preloadReady` on any manual action (next, previous, playAlbum, etc.)

### Edge Cases
- **Shuffle toggle near end of track:** Reset pre-prepared track
- **Repeat One:** Pre-prepare the SAME track URL
- **End of queue (no repeat):** Don't pre-prepare anything, let playback stop naturally
- **User skips (Next/Previous):** Call `_resetPreparedTrack()`, load normally
- **Queue change (add/remove):** Call `_resetPreparedTrack()`

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- AVPlay: the gap is `stop→close→open→prepareAsync→play` (~100-300ms). Pre-computing the URL saves the lookup time.
- HTML5: dual elements give near-zero gap since the preload element is already buffered.
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
- Play an album, let tracks auto-advance
- Gap between tracks should be imperceptible
- Console: "[Sonance][Player] Pre-prepared next: {title}" appears 5 seconds before track ends
- Skip with Next → resets pre-prepared, loads normally
- Shuffle on/off near end of track → no crash
- Repeat One → same track replays

### TV:
- Same tests
- Gap should be noticeable but short (~100-300ms)

Update PROGRESS.md.

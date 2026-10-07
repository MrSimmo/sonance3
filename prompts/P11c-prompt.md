You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P11c: Near-Gapless Playback.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read tickets/P11-v1.4-features.md — do task P11.3 only
3. Read PROGRESS.md
4. Read js/player.js carefully — understand the current playback flow

## FEATURE: Near-Gapless Playback

### HTML5 Audio Backend (browser) — Dual Element Swap

Add a second audio element to `index.html`:
```html
<audio id="sonance-audio-a" preload="auto"></audio>
<audio id="sonance-audio-b" preload="auto"></audio>
```
Remove the old `#sonance-audio` element (or keep as alias to A).

In `player.js` (HTML5 path):
```javascript
var _audioA = document.getElementById('sonance-audio-a');
var _audioB = document.getElementById('sonance-audio-b');
var _activeAudio = _audioA;
var _preloadAudio = _audioB;
var _nextTrackPrepared = false;
```

**Pre-load logic:**
- Add a `timeupdate` handler that checks: `if (currentTime > duration - 5 && !_nextTrackPrepared)`
- When triggered:
  1. Determine the next track (respecting queue, shuffle, repeat)
  2. Set `_preloadAudio.src = nextTrackStreamUrl`
  3. Call `_preloadAudio.load()` — this pre-buffers the next track
  4. Set `_nextTrackPrepared = true`
  5. Log: `[Sonance][Player] Pre-loaded next track: {title}`

**Track transition:**
- When `_activeAudio` fires `ended`:
  1. If `_nextTrackPrepared`:
     - `_preloadAudio.play()` — starts immediately since it's pre-buffered
     - Swap references: `var temp = _activeAudio; _activeAudio = _preloadAudio; _preloadAudio = temp;`
     - Update player state (currentTrack, queueIndex, etc.)
     - Emit `trackchange` event
     - Reset: `_nextTrackPrepared = false`
  2. If NOT prepared (e.g. track ended before 5-second threshold): fall back to current sequential load

**Event listener management:**
- `timeupdate`, `ended`, `play`, `pause`, `error` listeners must be on the ACTIVE audio element
- When swapping, move listeners from old active to new active
- OR: put listeners on BOTH elements but check `if (e.target === _activeAudio)` before acting

**Edge cases:**
- Shuffle mode: next track is determined at pre-load time, not transition time. If the user changes shuffle mode in the last 5 seconds, the pre-loaded track may be wrong. Handle by re-determining next track at transition and falling back to sequential load if it changed.
- Repeat One: don't pre-load a different track. Pre-load the SAME track's URL into the other element.
- Queue ends (no repeat): don't pre-load anything. Let the normal `ended` handler stop playback.
- Skip (Next/Previous): cancel any pre-loaded track. Set `_nextTrackPrepared = false` and `_preloadAudio.src = ''`.

### AVPlay Backend (Tizen) — Pre-Prepare URL

AVPlay only supports one active instance, so we can't pre-buffer. But we can minimise the transition:

```javascript
var _nextTrackUrl = null;

// When current track is 5 seconds from end:
_nextTrackUrl = api.getStreamUrl(nextTrack.id);

// When onstreamcompleted fires:
if (_nextTrackUrl) {
    // Immediately transition — URL is ready, skip the lookup
    _loadAndPlay(_nextTrackUrl, nextTrack);
    _nextTrackUrl = null;
} else {
    // Fallback: determine next track and load
    _playNextTrack();
}
```

The AVPlay gap will be ~100-300ms (the time for `open` + `prepareAsync` + `play`). This is an improvement over the current approach which also includes the time to determine the next track and construct the URL.

### Testing (browser — HTML5 Audio backend)
- Play an album with 3+ tracks
- Listen to the transition between tracks — gap should be imperceptible or very short (<100ms)
- Check console: "[Sonance][Player] Pre-loaded next track: {title}" should appear 5 seconds before track ends
- Test shuffle: pre-loaded track matches the shuffled order
- Test repeat one: same track replays with minimal gap
- Test skip (press Next): pre-loaded state resets, new track plays correctly
- Test end of queue (no repeat): playback stops cleanly

Note: AVPlay backend can only be tested on the actual TV.

RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- Run autonomously. Rebuild Sonance.wgt when done.

Update PROGRESS.md.

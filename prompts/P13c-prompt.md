You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P13c: Activate AVPlay as the Actual Playback Backend on Tizen.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially "Audio Playback (AVPlay)" section and Tizen 5.0 constraints
2. Read PROGRESS.md
3. Read js/player.js VERY CAREFULLY — understand the current single HTML5 Audio implementation
4. Read the Samsung AVPlay API docs: the lifecycle is open → setDisplayRect → prepareAsync → play → stop → close

## THIS IS THE MOST IMPORTANT PATCH IN THE REBUILD
This patch changes the player to actually use AVPlay on Tizen. Currently the player uses a single HTML5 `<audio>` element on all platforms. After this patch:
- **Tizen (TV):** Uses `webapis.avplay` for all playback
- **Browser:** Continues using HTML5 `<audio>` (unchanged)

## AVPlay Lifecycle (MUST follow this exactly)

```
NONE → open(url) → IDLE
IDLE → prepareAsync(successCb, errorCb) → READY
READY → play() → PLAYING
PLAYING → pause() → PAUSED
PAUSED → play() → PLAYING
PLAYING/PAUSED → stop() → IDLE
IDLE → close() → NONE

To play a NEW track:
  If currently PLAYING or PAUSED: stop() → close() → open(newUrl) → prepareAsync → play()
  If IDLE: close() → open(newUrl) → prepareAsync → play()
  If NONE: open(newUrl) → prepareAsync → play()
```

**CRITICAL:** You MUST call `stop()` before `close()` if the player is in PLAYING or PAUSED state. Calling `close()` while playing causes errors.

## Implementation

### Step 1: Platform Detection
At the TOP of player.js (not inside a function):
```javascript
var IS_TIZEN = typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined';
console.log('[Sonance][Player] Platform: ' + (IS_TIZEN ? 'Tizen (AVPlay)' : 'Browser (HTML5 Audio)'));
```

### Step 2: Dual Backend in Player

The Player object currently has methods like `_loadAndPlay(url)`, `play()`, `pause()`, `next()`, etc. Refactor the INTERNAL methods to branch on `IS_TIZEN`:

```javascript
var Player = {
    // ... existing state (currentTrack, queue, queueIndex, isPlaying, etc.)
    
    _audioElement: null,      // HTML5 Audio (browser only)
    _avplayState: 'NONE',     // Track AVPlay state manually
    _progressInterval: null,  // For AVPlay progress polling
    
    init: function() {
        if (!IS_TIZEN) {
            this._audioElement = document.getElementById('sonance-audio');
            this._setupHtmlListeners();
        }
        // Load persisted preferences
        this._loadPreferences();
    },
    
    _loadAndPlay: function(streamUrl, track) {
        this.currentTrack = track;
        this._scrobbled = false;
        
        if (IS_TIZEN) {
            this._avplayLoadAndPlay(streamUrl);
        } else {
            this._htmlLoadAndPlay(streamUrl);
        }
        
        this.emit('trackchange', track);
    },
```

### Step 3: AVPlay Backend Methods

```javascript
    _avplayLoadAndPlay: function(url) {
        var self = this;
        
        // Stop current playback if active
        try {
            var state = webapis.avplay.getState();
            if (state === 'PLAYING' || state === 'PAUSED') {
                webapis.avplay.stop();
            }
            if (state !== 'NONE') {
                webapis.avplay.close();
            }
        } catch (e) {
            console.warn('[Sonance][Player] AVPlay cleanup error:', e);
        }
        
        try {
            // Open new source
            webapis.avplay.open(url);
            
            // Set display rect — 1x1 pixel offscreen for audio-only
            webapis.avplay.setDisplayRect(0, 0, 1, 1);
            
            // Set listener for callbacks
            webapis.avplay.setListener({
                oncurrentplaytime: function(ms) {
                    self.currentTime = ms / 1000;
                    self.emit('progress', self.currentTime, self.duration);
                    self._checkScrobble();
                },
                onstreamcompleted: function() {
                    console.log('[Sonance][Player] Stream completed');
                    self._onTrackEnded();
                },
                onbufferingstart: function() {
                    console.log('[Sonance][Player] Buffering start');
                    self.emit('buffering', true);
                },
                onbufferingcomplete: function() {
                    console.log('[Sonance][Player] Buffering complete');
                    self.emit('buffering', false);
                },
                onerror: function(error) {
                    console.error('[Sonance][Player] AVPlay error:', error);
                    self.next(); // Skip to next track on error
                }
            });
            
            // Prepare asynchronously
            webapis.avplay.prepareAsync(
                function() {
                    // Success — get duration and play
                    try {
                        self.duration = webapis.avplay.getDuration() / 1000;
                    } catch (e) {
                        self.duration = 0;
                    }
                    webapis.avplay.play();
                    self.isPlaying = true;
                    self._avplayState = 'PLAYING';
                    self.emit('play');
                    console.log('[Sonance][Player] AVPlay playing: ' + self.currentTrack.title);
                },
                function(error) {
                    console.error('[Sonance][Player] AVPlay prepare failed:', error);
                    self.next(); // Skip on prepare failure
                }
            );
            
        } catch (e) {
            console.error('[Sonance][Player] AVPlay load failed:', e);
            this.next();
        }
    },
    
    _avplayPlay: function() {
        try {
            var state = webapis.avplay.getState();
            if (state === 'PAUSED' || state === 'READY') {
                webapis.avplay.play();
                this.isPlaying = true;
                this._avplayState = 'PLAYING';
                this.emit('play');
            }
        } catch (e) {
            console.error('[Sonance][Player] AVPlay play error:', e);
        }
    },
    
    _avplayPause: function() {
        try {
            var state = webapis.avplay.getState();
            if (state === 'PLAYING') {
                webapis.avplay.pause();
                this.isPlaying = false;
                this._avplayState = 'PAUSED';
                this.emit('pause');
            }
        } catch (e) {
            console.error('[Sonance][Player] AVPlay pause error:', e);
        }
    },
    
    _avplaySeek: function(seconds) {
        try {
            webapis.avplay.seekTo(seconds * 1000); // AVPlay uses milliseconds
        } catch (e) {
            console.error('[Sonance][Player] AVPlay seek error:', e);
        }
    },
    
    _avplayStop: function() {
        try {
            var state = webapis.avplay.getState();
            if (state === 'PLAYING' || state === 'PAUSED') {
                webapis.avplay.stop();
            }
            if (state !== 'NONE') {
                webapis.avplay.close();
            }
            this._avplayState = 'NONE';
        } catch (e) {
            console.warn('[Sonance][Player] AVPlay stop error:', e);
        }
        this.isPlaying = false;
        this.emit('pause');
    },
```

### Step 4: Update Public Methods to Branch

```javascript
    play: function() {
        if (IS_TIZEN) { this._avplayPlay(); }
        else { /* existing HTML5 play code */ }
    },
    
    pause: function() {
        if (IS_TIZEN) { this._avplayPause(); }
        else { /* existing HTML5 pause code */ }
    },
    
    togglePlayPause: function() {
        if (this.isPlaying) { this.pause(); }
        else { this.play(); }
    },
    
    seekTo: function(seconds) {
        if (IS_TIZEN) { this._avplaySeek(seconds); }
        else { /* existing HTML5 seek code */ }
    },
    
    // next(), previous(), playAlbum(), etc. all call _loadAndPlay() internally
    // which already branches — so they don't need changes
```

### Step 5: HTML5 Audio Backend (preserve existing)

Keep all existing HTML5 Audio code but namespace it clearly:
```javascript
    _htmlLoadAndPlay: function(url) {
        this._audioElement.src = url;
        this._audioElement.play().catch(function(e) {
            console.error('[Sonance][Player] HTML5 play error:', e);
        });
        this.isPlaying = true;
        this.emit('play');
    },
    
    _setupHtmlListeners: function() {
        var self = this;
        this._audioElement.addEventListener('timeupdate', function() {
            self.currentTime = self._audioElement.currentTime;
            self.duration = self._audioElement.duration || 0;
            self.emit('progress', self.currentTime, self.duration);
            self._checkScrobble();
        });
        this._audioElement.addEventListener('ended', function() {
            self._onTrackEnded();
        });
        this._audioElement.addEventListener('error', function(e) {
            console.error('[Sonance][Player] HTML5 audio error:', e);
            self.next();
        });
    },
```

### Step 6: Expose Active Audio Element (for browser visualiser)

```javascript
    getActiveAudioElement: function() {
        if (!IS_TIZEN && this._audioElement) {
            return this._audioElement;
        }
        return null;
    },
```

### Step 7: Screen Saver Suppression (Tizen)

When music is playing, prevent the TV screen saver from activating:
```javascript
    _suppressScreenSaver: function(suppress) {
        if (typeof webapis === 'undefined' || !webapis.appcommon) return;
        try {
            var state = suppress 
                ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF
                : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON;
            webapis.appcommon.setScreenSaver(state, function() {}, function() {});
        } catch (e) {}
    },
```
Call `_suppressScreenSaver(true)` when playback starts, `_suppressScreenSaver(false)` when it stops.

### Step 8: Verify index.html

Ensure there is exactly ONE audio element for browser use:
```html
<audio id="sonance-audio" preload="auto" crossorigin="anonymous"></audio>
```
Remove any dual `sonance-audio-a` / `sonance-audio-b` elements if they exist from the rolled-back state (they shouldn't at P11a baseline, but check).

### Step 9: Add object element for AVPlay

AVPlay requires an `<object>` element in the DOM:
```html
<object id="av-player" type="application/avplayer" style="position:absolute;left:0;top:0;width:1px;height:1px;"></object>
```
Add this to index.html. It's a 1×1px invisible element that AVPlay uses internally.

### Step 10: WebAPIs Library

Ensure index.html loads the Samsung WebAPIs library. On the TV, this path is provided by the system. For browser compatibility, wrap in a check:
```html
<script>
    // Load Samsung WebAPIs if available (TV only)
    if (typeof webapis === 'undefined') {
        // Browser — webapis not available, which is fine
        console.log('[Sonance] Not on Tizen — WebAPIs not loaded');
    }
</script>
```

The actual WebAPIs script is loaded automatically by the Tizen runtime from `$WEBAPIS/webapis/webapis.js`. Check if this is already in index.html. If not, add:
```html
<script type="text/javascript" src="$WEBAPIS/webapis/webapis.js"></script>
```
This path only resolves on the TV — in the browser it will 404 silently, which is fine.

## TESTING

### Debug Overlay (KEEP IN THIS BUILD)
Add a persistent debug overlay to the Now Playing bar area or bottom-right of the screen that shows AVPlay status. This is visible on ALL screens so we can monitor playback state at all times.

In `js/app.js`, after the app shell renders, create the debug overlay:
```javascript
var playerDebug = document.createElement('div');
playerDebug.id = 'player-debug';
playerDebug.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.85);color:#0f0;font-size:12px;padding:8px 12px;z-index:99999;font-family:monospace;white-space:pre;border-radius:6px;pointer-events:none;';
document.body.appendChild(playerDebug);

// Update every 500ms
setInterval(function() {
    var lines = [];
    lines.push('Backend: ' + (IS_TIZEN ? 'AVPlay' : 'HTML5'));
    if (IS_TIZEN && typeof webapis !== 'undefined' && webapis.avplay) {
        try {
            lines.push('AVPlay state: ' + webapis.avplay.getState());
        } catch (e) {
            lines.push('AVPlay state: ERROR');
        }
    }
    var state = Player.getState();
    lines.push('Playing: ' + state.isPlaying);
    lines.push('Track: ' + (state.currentTrack ? state.currentTrack.title : 'none'));
    lines.push('Time: ' + (state.currentTime || 0).toFixed(1) + '/' + (state.duration || 0).toFixed(1));
    lines.push('Queue: ' + (state.queueIndex + 1) + '/' + state.queue.length);
    playerDebug.textContent = lines.join('\n');
}, 500);
```

This tells us:
- **Backend: AVPlay** — confirms the Tizen path is active (not HTML5 fallback)
- **AVPlay state: PLAYING/PAUSED/IDLE/NONE** — confirms the AVPlay lifecycle is working
- **Track/Time** — confirms progress events are firing
- **Queue** — confirms queue management works

Do NOT remove this overlay. We need to see it on the TV.

### Browser (must still work exactly as before):
- Play a track → audio plays via HTML5 Audio
- Console shows: "[Sonance][Player] Platform: Browser (HTML5 Audio)"
- Play/Pause/Next/Previous all work
- Progress bar updates
- Queue works
- Star/unstar still works
- No regressions

### TV (deploy and test):
- Console should show: "[Sonance][Player] Platform: Tizen (AVPlay)"
- Play a track → audio plays through TV speakers
- Play/Pause works
- Next/Previous works
- Progress updates
- Track auto-advances at end
- FLAC files play (AVPlay's hardware decoder handles this)
- Media keys on remote work

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`.
- AVPlay state management is CRITICAL — always check state before calling methods
- Always wrap AVPlay calls in try/catch
- Run autonomously. Rebuild Sonance.wgt when done.

Update PROGRESS.md — document the AVPlay activation prominently. This is a major architectural milestone.

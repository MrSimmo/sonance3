You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P13d: Music Visualiser with Native AVPlay Spectrum Analysis.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md — P13c (AVPlay activation) must be complete
3. Read js/player.js — confirm AVPlay is the active backend on Tizen
4. Read tickets/P12-v1.5-visualiser.md — the original visualiser spec (architecture, presets, screen design)

## FIRST: Remove P13c Debug Overlay
The P13c patch added a persistent debug overlay (`#player-debug`) in `js/app.js` showing AVPlay state. Find and remove:
- The `playerDebug` div creation code
- The `setInterval` that updates it
- Any related variables

This debug overlay has served its purpose — AVPlay is confirmed working. The visualiser screen below adds its OWN debug overlay that only shows within the visualiser — that one stays for now.

## FEATURE: Full-Screen Music Visualiser

This implements the complete visualiser feature: audio analysis, render engine, 6 visual presets, and the full-screen visualiser screen. AVPlay's `setSoundAnalysisListener` provides native spectrum data on the TV. Web Audio API provides data in the browser.

### Three new files to create:
1. `js/audio-analyser.js` — unified audio analysis interface
2. `js/visualiser.js` — Canvas 2D render engine with 6 presets
3. `js/screens/visualiser.js` — full-screen visualiser screen

## Part 1: Audio Analyser (js/audio-analyser.js)

Dual backend:

**Tizen (AVPlay is now the active player):**
```javascript
startTizenAnalysis: function() {
    var self = this;
    try {
        webapis.avplay.setSoundAnalysisListener({
            ongetextradata: function(spectrum) {
                self._callbackCount++;
                for (var i = 0; i < spectrum.length && i < 32; i++) {
                    var val = spectrum[i];
                    if (val > 1) val = val / 255;
                    self._spectrumData[i] = Math.min(1, Math.max(0, val));
                }
            }
        });
        this._tizenAnalysisActive = true;
        console.log('[Sonance][AudioAnalyser] Tizen analysis started');
    } catch (e) {
        console.error('[Sonance][AudioAnalyser] Tizen analysis failed:', e);
        this._useFallback = true;
    }
}
```

IMPORTANT: `setSoundAnalysisListener` must be called AFTER `avplay.play()` has been called (i.e., audio is actually playing). Call it from the visualiser screen's activate(), not during app init.

Also: re-register the listener after each new track starts. Listen for the Player's `trackchange` event:
```javascript
Player.on('trackchange', function() {
    if (AudioAnalyser._tizenAnalysisActive) {
        // Re-register — the listener may reset when avplay opens a new URL
        AudioAnalyser.startTizenAnalysis();
    }
});
```

**Browser (Web Audio API):**
```javascript
connectToAudio: function(audioElement) {
    if (this._sourceConnected) return;
    try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        this._audioContext = new AudioCtx();
        if (this._audioContext.state === 'suspended') this._audioContext.resume();
        this._source = this._audioContext.createMediaElementSource(audioElement);
        this._analyserNode = this._audioContext.createAnalyser();
        this._analyserNode.fftSize = 256;
        this._analyserNode.smoothingTimeConstant = 0.8;
        this._source.connect(this._analyserNode);
        this._analyserNode.connect(this._audioContext.destination);
        this._sourceConnected = true;
    } catch (e) {
        console.error('[Sonance][AudioAnalyser] Web Audio failed:', e);
        this._useFallback = true;
    }
}
```

CRITICAL: `createMediaElementSource()` can only be called ONCE per element. Check `_sourceConnected` before calling.

**Unified getData():** returns `{ spectrum, waveform, bass, mid, treble, energy, beat }` — same format regardless of backend. Beat detection via threshold on running energy average.

**Fallback generator:** if both backends fail, generate smooth pseudo-random data that looks like music.

## Part 2: Visualiser Engine (js/visualiser.js)

Canvas 2D render engine at 30fps (skip every other requestAnimationFrame).

**6 Presets — build ALL of them:**

1. **Plasma Tunnel** — concentric rings expanding from drifting centre, hue cycling with energy, bass-reactive radius, trail effect via `rgba(0,0,0,0.06)` clear
2. **Particle Storm** — 200 particles from centre, velocity from spectrum bands, colour mapped to frequency (bass=pink, mid=purple, treble=cyan), burst on beat
3. **Waveform Ribbons** — 4 flowing horizontal lines using waveform data, colours: pink/cyan/purple/amber, thickness varies with energy, long trails
4. **Kaleidoscope** — 8-fold symmetry, shapes driven by spectrum, rotation speed tied to energy, scale pulses with bass
5. **Starfield** — 400 stars moving toward camera (3D perspective), speed = energy, warp on beat, trails
6. **Spectrum Bars** — 32 vertical bars, height = spectrum values, colour gradient bass→treble, glow effect (draw twice), mirror reflection below

**Auto-cycle presets every 30 seconds.**
**Transition: fade to black over 0.5s, switch preset, new preset fades in.**

**Performance rules:**
- Canvas 2D ONLY, no WebGL
- 30fps (skip alternate frames)
- Pre-allocate ALL particle arrays — no allocation in render loop
- No `filter: blur()` in render loop — use double-draw for glow
- Reuse typed arrays for spectrum/waveform data

## Part 3: Visualiser Screen (js/screens/visualiser.js)

**Full-screen takeover:**
- Canvas fills entire 1920×1080
- HIDE sidebar and NP bar on activate, RESTORE on deactivate
- Expand content area to full width

**Track info overlay:**
- Bottom-left: album art (60px) + track title + artist
- Auto-fades after 5 seconds of no input
- Reappears on any key press
- Updates on track change

**Preset name:** top-right, fades with overlay

**Key handling (special — no FocusManager):**
- Back (10009/27): return to Now Playing
- Left: previous preset
- Right: next preset
- Enter: toggle overlay
- Play/Pause (10252): pass to Player
- Any other key: show overlay briefly

**Activate flow:**
```javascript
activate: function() {
    // Hide shell
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('now-playing-bar').style.display = 'none';
    document.getElementById('content-area').style.left = '0';
    document.getElementById('content-area').style.padding = '0';
    document.getElementById('content-area').style.overflow = 'hidden';
    
    // Init audio analysis
    AudioAnalyser.init();
    if (IS_TIZEN) {
        AudioAnalyser.startTizenAnalysis();
    } else {
        var el = Player.getActiveAudioElement();
        if (el) AudioAnalyser.connectToAudio(el);
        else AudioAnalyser._useFallback = true;
    }
    
    // Start visualiser
    VisualiserEngine.init(this._canvas);
    VisualiserEngine.start();
}
```

**Now Playing button:**
Add a visualiser button (spectrum bars icon) as the LAST item in the NP transport controls row. Enter → `navigateTo('visualiser')`. Only show when music is playing.

**Add a temporary debug overlay** (top-left, monospace) showing:
- Backend: Tizen/Browser
- Analysis: active/fallback
- Callbacks (Tizen only)
- Energy/Bass values
- FPS

Keep the debug overlay in this build so we can verify on the TV.

## Script Loading
Add to index.html (BEFORE app.js, AFTER player.js):
```html
<script src="js/audio-analyser.js"></script>
<script src="js/visualiser.js"></script>
<script src="js/screens/visualiser.js"></script>
```

Register `'visualiser'` in the router.

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- Canvas 2D only, no WebGL
- `webkitAudioContext` fallback
- Pre-allocate arrays, no allocation in render loop
- 30fps target
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING

### Browser:
- Play a track, go to Now Playing, press visualiser button
- Full-screen canvas renders, sidebar/NP bar hidden
- Visuals react to audio (if Web Audio connects)
- Left/Right changes preset
- Back returns to NP, shell restores
- All 6 presets render without errors

### TV (after deployment):
- Same flow
- Debug overlay should show: Analysis: active, Callbacks incrementing
- Visuals should react to actual music
- Performance should be smooth (~30fps)

Update PROGRESS.md.

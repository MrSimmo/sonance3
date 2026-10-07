You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P11a: Register Samsung Remote Media Keys.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read tickets/P11-v1.4-features.md — do task P11.1 only
3. Read PROGRESS.md

## THE PROBLEM
Pressing Play/Pause on the Samsung remote shows a Samsung system overlay instead of controlling Sonance. The Tizen WebView requires apps to explicitly register for media key events, otherwise the system intercepts them.

## THE FIX
In `js/app.js`, during app initialisation (after the app shell loads, NOT on the login screen), register media keys:

```javascript
function registerTizenKeys() {
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) {
        console.log('[Sonance][App] Not on Tizen — skipping key registration');
        return;
    }
    var keys = [
        'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
    ];
    keys.forEach(function(key) {
        try {
            tizen.tvinputdevice.registerKey(key);
        } catch (e) {
            console.warn('[Sonance][App] Failed to register key: ' + key, e);
        }
    });
    console.log('[Sonance][App] Registered ' + keys.length + ' media/colour keys');
}
```

Call `registerTizenKeys()` once after login success / app shell render.

Also check `config.xml` — add this privilege if not present:
```xml
<tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
```

This is a small, low-risk change. Only touches `js/app.js` and `config.xml`.

RULES:
- Vanilla JS, ES2017. Wrap in typeof checks for browser compatibility.
- Run autonomously. Rebuild Sonance.wgt when done.

Update PROGRESS.md.

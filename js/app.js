/* ============================================
   Sonance — App Shell, Router & Screen Manager
   ============================================ */

// =========================================
//  SonanceSettings — persisted user preferences
// =========================================
var SonanceSettings = {
    // Auto-open Now Playing screen when user starts playback. Default ON.
    autoNowPlaying: localStorage.getItem('sonance-auto-now-playing') !== 'false',
    // v3.10 A8: save the queue to the server and bring it back, paused, at
    // the next start. Default ON ('on' / 'off').
    resumeQueue: localStorage.getItem('sonance-resume-queue') !== 'off',
    // v3.10 R10: Settings -> Appearance -> Background. 'solid' (default) or
    // 'gradient' (the backdrop-gradient class on <html>; App.setBackdrop).
    backdrop: localStorage.getItem('sonance-backdrop') === 'gradient' ? 'gradient' : 'solid',
    // v3.10-fix2 F2: Settings -> Appearance -> Up next on Now Playing.
    // 'show' (default) or 'hide'; read when Now Playing renders.
    npUpNext: localStorage.getItem('sonance-np-upnext') === 'hide' ? 'hide' : 'show',
    // v3.10-fix2 F7: Now Playing's Focus mode (the 50 % dim), remembered
    // until toggled off. Default off ('on' / 'off').
    npFocus: localStorage.getItem('sonance-np-focus') === 'on',
    // v3.12 R4 (D178): Settings -> Appearance -> Albums per Home row. 6
    // (Standard, the default: no key stored), 9 or 12; read when Home is built.
    homeRowSize: localStorage.getItem('sonance-home-row-size') === '12' ? 12
        : (localStorage.getItem('sonance-home-row-size') === '9' ? 9 : 6)
};

// Applied as this file loads, before the shell (and its #app-backdrop) is
// built, so a stored Gradient is there from the shell's first frame.
document.documentElement.classList.toggle('backdrop-gradient', SonanceSettings.backdrop === 'gradient');

var App = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var $ = SonanceUtils.$;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var rem = SonanceUtils.rem;

    // S-wave logo SVG — enlarged paths (P4.3: fill 70-80% of viewBox)
    function _createLogoSvg() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var paths = [
            { d: 'M15.5,4 A7,7 0 0,0 8.5,9', sw: '2.4', o: '0.95' },
            { d: 'M8.5,9 A7,7 0 0,1 15.5,14', sw: '2.4', o: '0.95' },
            { d: 'M15.5,14 A7,7 0 0,0 8.5,19', sw: '2.4', o: '0.2' },
            { d: 'M18,5 Q20.5,7.5 18,10', sw: '1.6', o: '0.5' },
            { d: 'M20,3.5 Q23.5,7.5 20,11.5', sw: '1.3', o: '0.3' },
            { d: 'M6,10 Q3.5,12 6,14', sw: '1.6', o: '0.5' },
            { d: 'M4,8.5 Q0.5,12 4,15.5', sw: '1.3', o: '0.3' }
        ];
        paths.forEach(function(p) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', p.d);
            path.setAttribute('stroke', 'white');
            path.setAttribute('stroke-width', p.sw);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('opacity', p.o);
            svg.appendChild(path);
        });
        return svg;
    }

    // --- Toast system ---
    var _toastEl = null;
    var _toastTimer = null;

    function showToast(message, duration) {
        duration = duration || 2000;
        if (_toastEl && _toastEl.parentNode) {
            _toastEl.parentNode.removeChild(_toastEl);
        }
        if (_toastTimer) {
            clearTimeout(_toastTimer);
            _toastTimer = null;
        }
        _toastEl = el('div', { className: 'sonance-toast' }, message);
        document.body.appendChild(_toastEl);
        // Force reflow then show
        _toastEl.offsetHeight;
        _toastEl.classList.add('visible');
        _toastTimer = setTimeout(function() {
            if (_toastEl) _toastEl.classList.remove('visible');
            setTimeout(function() {
                if (_toastEl && _toastEl.parentNode) {
                    _toastEl.parentNode.removeChild(_toastEl);
                }
                _toastEl = null;
            }, 300);
        }, duration);
    }

    // --- Colour hint bar ---
    var _hintBar = null;

    function _buildColourHintBar() {
        _hintBar = el('div', { className: 'colour-hint-bar', id: 'colour-hint-bar' });
        return _hintBar;
    }

    function showColourHints(hints) {
        // hints: array of { colour: 'yellow'|'blue'|'red'|'green', label: 'Add to queue' }
        if (!_hintBar) return;
        _hintBar.textContent = '';
        if (!hints || hints.length === 0) {
            _hintBar.classList.remove('visible');
            return;
        }
        hints.forEach(function(hint) {
            var item = el('div', { className: 'colour-hint-item' });
            item.appendChild(el('span', { className: 'colour-hint-dot ' + hint.colour }));
            item.appendChild(el('span', { className: 'colour-hint-label' }, hint.label));
            _hintBar.appendChild(item);
        });
        _hintBar.classList.add('visible');
    }

    function hideColourHints() {
        if (!_hintBar) return;
        _hintBar.classList.remove('visible');
    }

    // --- State ---
    var _appContainer = null;
    var _contentArea = null;      // Alias for the page-current layer (back-compat)
    var _pageCurrent = null;      // The live page layer (screens render into this)
    var _topNavEl = null;         // #top-nav
    var _topNavPillEl = null;     // #top-nav-pill
    var _navItemElements = [];    // .top-nav-item DOM nodes
    var _navIndex = 0;            // Current focused/selected nav index
    var _pillState = 'focused';   // 'focused' | 'selected'
    // V3.7-fix8: cached nav-item rects to avoid getBoundingClientRect on every focus change
    var _navItemRects = null;     // Array of { left, width } per nav item, or null when stale
    var _navBarLeft = 0;          // Cached top-nav-bar getBoundingClientRect().left
    var _pillBaseWidth = 0;       // Cached #top-nav-pill layout width (D65)
    var _navRectsBoldIndex = -1;  // Nav item that was .selected (bold) when the rects were measured (D69)
    var _navResizeTimer = null;   // Debounce timer for window resize re-measure
    var _navResizeBound = false;  // Resize listener bound flag
    var _currentScreen = null;    // screen name string
    var _historyStack = [];       // [{ screen, params }]

    // v3.10 R1.2 (D52, D87): transitions are interruptible. There is no input
    // lock (V3-2's 300 ms TRANSITION_LOCK_MS dropped every key press inside
    // it, and V3-5's pending-target catch-up re-rendered after it). Instead
    // the running transition is one record, and a new navigation finishes it
    // instantly (_finishTransition) before starting its own, so no press is
    // ignored and at most one ghost exists.
    var _transition = null;   // { timer, finish } while a transition runs

    // The login zoom (_loginToAppShellZoom) still must run once per sign-in.
    var _loginZooming = false;

    // V3-6-fix NAV-1: snapshot map keyed by `_focusKeyForScreen()`. Library
    // grid focus is saved on Enter; album-tracks focus is saved on Enter.
    // Back from a sub-screen (or NP) tries to restore the matching snapshot
    // so the user lands on the row/tile they came from instead of being
    // bounced back to the top nav.
    var _savedFocus = {};

    // Track `finish` as the running transition. It runs once: after `ms`, or
    // earlier from _finishTransition. It must leave the layers at rest.
    function _trackTransition(finish, ms) {
        var rec = { timer: null, finish: null };
        rec.finish = function() {
            if (_transition !== rec) return;
            _transition = null;
            clearTimeout(rec.timer);
            finish();
        };
        rec.timer = setTimeout(rec.finish, ms);
        _transition = rec;
    }

    // Finish the running transition now (D87). Called first by everything
    // that starts one, and by every screen change.
    function _finishTransition() {
        if (_transition) _transition.finish();
    }

    // Map legacy 'left' / 'right' third-arg values to the new transition names.
    function _normaliseTransition(t) {
        if (t === 'left') return 'slide-left';
        if (t === 'right') return 'slide-right';
        return t || null;
    }

    // --- Screen Registry ---
    var _screens = {
        home: HomeScreen,
        library: LibraryScreen,
        search: SearchScreen,
        playlists: PlaylistsScreen,
        nowplaying: NowPlayingScreen,
        queue: QueueScreen,
        settings: SettingsScreen,
        album: AlbumScreen,
        artist: ArtistScreen
    };

    var _screenTitles = {
        home: 'Home',
        library: 'Library',
        search: 'Search',
        playlists: 'Playlists',
        nowplaying: 'Now Playing',
        queue: 'Queue',
        settings: 'Settings',
        album: 'Album',
        artist: 'Artist'
    };

    // v3 top nav order: Home | Library | Playlists | Queue | Now Playing | Search | Settings
    var NAV_ITEMS = [
        { id: 'home',       label: 'Home',        type: 'text' },
        { id: 'library',    label: 'Library',     type: 'text' },
        { id: 'playlists',  label: 'Playlists',   type: 'text' },
        { id: 'queue',      label: 'Queue',       type: 'text' },
        { id: 'nowplaying', label: 'Now Playing', type: 'text' },
        { id: 'search',     label: null,          type: 'icon', icon: 'search' },
        { id: 'settings',   label: null,          type: 'icon', icon: 'settings' }
    ];

    // Primary nav screen ids (flat, no drill-down). Sub-screens (album, artist) push onto history.
    var _navScreens = ['home', 'library', 'playlists', 'queue', 'nowplaying', 'search', 'settings'];

    function _navIndexForScreen(screenName) {
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            if (NAV_ITEMS[i].id === screenName) return i;
        }
        return -1;
    }

    // The nav index of the primary screen under the current one: itself, or
    // for a sub-screen (album, artist) the primary it was opened from.
    function _primaryNavIndex() {
        for (var i = _historyStack.length - 1; i >= 0; i--) {
            var idx = _navIndexForScreen(_historyStack[i].screen);
            if (idx >= 0) return idx;
        }
        return _navIndexForScreen(_currentScreen);
    }

    // =========================================
    //  Tizen Media Key Registration
    // =========================================

    function registerTizenKeys() {
        if (typeof tizen === 'undefined' || !tizen.tvinputdevice) {
            log('App', 'Not on Tizen — skipping key registration');
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
        log('App', 'Registered ' + keys.length + ' media/colour keys');
    }

    // =========================================
    //  Accent Colour (P14e)
    // =========================================

    var DEFAULT_ACCENT_HEX = '#e44d8a';
    var DEFAULT_ACCENT_RGB = '228, 77, 138';

    // v3.10 R6 (D50): text and icons on the solid focus fill. The soft ink
    // is the ink at 0.86 alpha, spelled out because Chromium 63 has no
    // color-mix. css/styles.css :root carries the light pair as the default.
    var FOCUS_INK_LIGHT = { ink: '#ffffff', soft: 'rgba(255, 255, 255, 0.86)' };
    var FOCUS_INK_DARK = { ink: '#15151c', soft: 'rgba(21, 21, 28, 0.86)' };

    // D50/D72: white ink when white-on-accent contrast is at least 3:1, by
    // WCAG 2 relative luminance; otherwise the dark ink. `rgb` is the
    // "r, g, b" string the accent is stored as. White wins on Pink, Red,
    // Blue and Purple; dark on Orange, Amber, Green and Teal.
    function _focusInkFor(rgb) {
        var parts = String(rgb).split(',');
        var weights = [0.2126, 0.7152, 0.0722];
        var lum = 0;
        for (var i = 0; i < 3; i++) {
            var c = (parseFloat(parts[i]) || 0) / 255;
            c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            lum += weights[i] * c;
        }
        return 1.05 / (lum + 0.05) >= 3 ? FOCUS_INK_LIGHT : FOCUS_INK_DARK;
    }

    function applyAccentColor(hex, rgb) {
        var ink = _focusInkFor(rgb);
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-rgb', rgb);
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ', 0.35)');
        document.documentElement.style.setProperty('--accent-soft', 'rgba(' + rgb + ', 0.15)');
        document.documentElement.style.setProperty('--focus-fill', hex);
        document.documentElement.style.setProperty('--focus-ink', ink.ink);
        document.documentElement.style.setProperty('--focus-ink-soft', ink.soft);
    }

    function resetAccentColor() {
        try {
            localStorage.removeItem('sonance-accent-color');
            localStorage.removeItem('sonance-accent-rgb');
        } catch (e) {}
        applyAccentColor(DEFAULT_ACCENT_HEX, DEFAULT_ACCENT_RGB);
    }

    function loadAccentColor() {
        try {
            var savedHex = localStorage.getItem('sonance-accent-color');
            var savedRgb = localStorage.getItem('sonance-accent-rgb');
            if (savedHex && savedRgb) {
                applyAccentColor(savedHex, savedRgb);
            }
        } catch (e) {
            log('App', 'Failed to load accent color: ' + e.message);
        }
    }

    function saveAccentColor(hex, rgb) {
        try {
            localStorage.setItem('sonance-accent-color', hex);
            localStorage.setItem('sonance-accent-rgb', rgb);
        } catch (e) {
            log('App', 'Failed to save accent color: ' + e.message);
        }
        applyAccentColor(hex, rgb);
    }

    /**
     * v3.10 R10: Settings -> Appearance -> Background, live. `mode` is
     * 'solid' or 'gradient'; stored in sonance-backdrop. The layer follows
     * the accent by itself (its gradient reads --accent-rgb).
     */
    function setBackdrop(mode) {
        SonanceSettings.backdrop = mode === 'gradient' ? 'gradient' : 'solid';
        try {
            localStorage.setItem('sonance-backdrop', SonanceSettings.backdrop);
        } catch (e) {
            log('App', 'Failed to save the background: ' + e.message);
        }
        document.documentElement.classList.toggle('backdrop-gradient', SonanceSettings.backdrop === 'gradient');
    }

    function getAccentColor() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
        return (v && v.trim()) || DEFAULT_ACCENT_HEX;
    }

    function getAccentRgb() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb');
        return (v && v.trim()) || DEFAULT_ACCENT_RGB;
    }

    // Apply saved accent immediately so nothing paints with stale pink
    loadAccentColor();

    // =========================================
    //  Interface size (v3.10 R4, D49)
    // =========================================

    /**
     * Apply an interface size live (D66). `scale` is one of
     * SonanceUtils.UI_SCALES; anything else is ignored. The boot-time size is
     * applied by the <head> script in index.html, not here.
     *
     * Sets and persists the root font size (css/styles.css is rem on it),
     * re-measures the top-nav pill, then re-renders the current screen with no
     * transition so the layout JS measured at the old size (virtual grids,
     * the Library sub-nav pill, lyrics offsets, the NP scrubber) is rebuilt,
     * and puts focus back on the zone and index it was on. The NP bar's icons
     * are sized in rem, so it reflows without a rebuild. Playback is not
     * touched. Returns true if the size changed.
     */
    function applyUiScale(scale) {
        if (SonanceUtils.UI_SCALES.indexOf(scale) < 0) return false;
        if (scale === SonanceUtils.uiScale()) return false;
        document.documentElement.style.fontSize = (10 * scale) + 'px';
        SonanceUtils.setUiScale(scale);
        try {
            localStorage.setItem('sonance-ui-scale', String(scale));
        } catch (e) {
            log('App', 'Failed to save interface size: ' + e.message);
        }
        _measureNavRects();
        _updatePillPosition(_navIndex, false);
        if (_currentScreen && _pageCurrent) {
            var top = _historyStack[_historyStack.length - 1];
            var params = (top && top.screen === _currentScreen) ? top.params : null;
            // The Back path's snapshot/restore: it handles zones that the
            // screen registers asynchronously as well as synchronously.
            saveCurrentFocus();
            _navigateToScreen(_currentScreen, params, null);
            _tryRestoreFocusForCurrentScreen();
        }
        log('App', 'Interface size ' + Math.round(scale * 100) + '%');
        return true;
    }

    // =========================================
    //  Init
    // =========================================

    function init() {
        log('App', 'Sonance starting...');

        _appContainer = document.getElementById('app');

        // Re-apply saved accent (belt-and-braces in case <html> was replaced)
        loadAccentColor();

        // Initialize subsystems
        FocusManager.init();
        Player.init();
        if (typeof LazyLoader !== 'undefined') LazyLoader.init();

        // Check auth state
        if (AuthManager.isLoggedIn()) {
            log('App', 'Existing session found, validating...');
            _validateAndShowApp();
        } else {
            log('App', 'No session, showing login');
            _showLogin();
        }
    }

    // =========================================
    //  Login / Auth
    // =========================================

    function _showLogin() {
        _appContainer.textContent = '';
        _currentScreen = null;
        _historyStack = [];
        _topNavEl = null;
        _topNavPillEl = null;
        _navItemElements = [];
        _navItemRects = null;
        _pageCurrent = null;
        _contentArea = null;
        _finishTransition();
        _cancelNavDwell();
        if (typeof OptionsSheet !== 'undefined') OptionsSheet.close(false);
        _loginZooming = false;
        _shellGen++;   // v3.10 A8: a queue restore still on the wire is dropped
        // V3.7-fix18: clear the per-screen preload completion gate so a
        // different user (or a fresh login) starts with cold caches.
        _preloadDone = {};

        // Reset FocusManager — clear all zones
        FocusManager.clearContentZones();
        FocusManager.unregisterZone('topnav');
        FocusManager.unregisterZone('nowplaying-bar');

        LoginScreen.render(_appContainer, function() {
            // V3-2: zoom the login screen forward, then swap to the app shell
            // which zooms the home screen in behind it.
            _loginToAppShellZoom();
        });
        LoginScreen.activate();
    }

    // V3-2: login-success zoom. The login card scales up (as if diving through
    // it) while fading out, then we tear it down and bring up the app shell
    // with the home screen scaling from 0.95 to 1.
    function _loginToAppShellZoom() {
        if (_loginZooming) return;
        _loginZooming = true;

        var loginEl = document.querySelector('.login-screen');
        if (!loginEl) {
            _showAppShell(true);
            return;
        }

        loginEl.style.willChange = 'transform, opacity';
        loginEl.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
        loginEl.style.transform = 'scale(1.15)';
        loginEl.style.opacity = '0';

        setTimeout(function() {
            _showAppShell(true);
        }, 350);
    }

    function _validateAndShowApp() {
        var api = AuthManager.getApi();
        if (!api) {
            _showLogin();
            return;
        }

        api.ping().then(function() {
            log('App', 'Session valid');
            _showAppShell();
        }).catch(function(err) {
            log('App', 'Session validation failed: ' + err.message);
            _showLogin();
        });
    }

    // =========================================
    //  App Shell
    // =========================================

    function _showAppShell(entryZoom) {
        _appContainer.textContent = '';
        _historyStack = [];

        // V3.9 S4 T5: drop the previous shell's Player subscriptions before
        // this one attaches its own. Re-entered on every logout → login.
        _unsubscribeShellPlayerEvents();

        var layout = el('div', { className: 'app-layout' });

        // v3.10 R10: the gradient backdrop's layer, first so everything else
        // paints over it. Drawn only with html.backdrop-gradient (css).
        layout.appendChild(el('div', { className: 'app-backdrop', id: 'app-backdrop' }));

        // Top navigation bar (floating)
        layout.appendChild(_buildTopNav());

        // Page container with live page layer
        var pageContainer = el('div', { id: 'page-container' });
        _pageCurrent = el('div', { id: 'page-current', className: 'page-layer content-area' });
        pageContainer.appendChild(_pageCurrent);
        // Keep content-area alias for existing code that reads #content-area
        _pageCurrent.setAttribute('data-content-area', '1');
        _contentArea = _pageCurrent;
        layout.appendChild(pageContainer);

        // Colour hint bar + NP bar are fixed-position (CSS handles it)
        layout.appendChild(_buildColourHintBar());
        layout.appendChild(_buildNowPlayingBar());

        _appContainer.appendChild(layout);

        // Register persistent focus zones
        _registerTopNavZone();
        registerNowPlayingBarZone();

        // Auto-open Now Playing when user initiates playback (P15b)
        Player.on('userplay', _onPlayerUserPlay);

        // Navigate to home screen
        navigateTo('home');

        // v3.10 A8: the saved queue, paused (no auto Now Playing).
        _shellGen++;
        _restoreSavedQueue();

        // V3-2 login zoom entry: page layer scales up from 0.95 to 1 to mirror
        // the outgoing login scaling past 1.
        if (entryZoom && _pageCurrent) {
            var entering = _pageCurrent;
            entering.style.transition = 'none';
            entering.style.transform = 'scale(0.95)';
            entering.style.opacity = '0';
            entering.style.willChange = 'transform, opacity';
            void entering.offsetHeight;
            entering.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            entering.style.transform = 'scale(1)';
            entering.style.opacity = '1';
            // D87: tracked like any transition, so a key pressed during it
            // finishes it rather than racing its clean-up.
            _trackTransition(function() { _clearTransitionStyles(entering); }, 320);
        }

        // Set initial focus to top nav
        FocusManager.setActiveZone('topnav', 0);
        _setPillState('focused');

        // Register Samsung remote media/colour keys (no-op in browser)
        registerTizenKeys();

        // Load starred (favourites) cache in the background
        var api = AuthManager.getApi();
        if (api && typeof StarredCache !== 'undefined') {
            StarredCache.load(api).catch(function(err) {
                log('App', 'StarredCache load failed: ' + (err && err.message));
            });
        }

        log('App', 'App shell rendered');
    }

    // =========================================
    //  Top Nav Builder (v3)
    // =========================================

    function _createSearchIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '11');
        circle.setAttribute('cy', '11');
        circle.setAttribute('r', '7');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        var line = document.createElementNS(ns, 'path');
        line.setAttribute('d', 'M16.5 16.5L21 21');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
        return svg;
    }

    function _createSettingsIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '3');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        return svg;
    }

    function _buildTopNav() {
        var topNav = el('div', { id: 'top-nav' });
        var bar = el('div', { id: 'top-nav-bar' });
        var pill = el('div', { id: 'top-nav-pill' });
        bar.appendChild(pill);

        var items = el('div', { className: 'top-nav-items' });
        _navItemElements = [];
        // V3.7-fix8: invalidate rect cache; will be measured after layout below.
        _navItemRects = null;

        NAV_ITEMS.forEach(function(spec, i) {
            var item = el('div', {
                className: 'top-nav-item',
                'data-screen': spec.id
            });
            if (spec.type === 'icon') {
                var icon;
                if (spec.icon === 'search') icon = _createSearchIcon();
                else if (spec.icon === 'settings') icon = _createSettingsIcon();
                if (icon) item.appendChild(icon);
            } else {
                item.appendChild(document.createTextNode(spec.label));
            }

            item.addEventListener('click', function() {
                var oldIdx = _navIndex;
                _navIndex = i;
                FocusManager.setActiveZone('topnav', i);
                _setPillState('focused');
                _updateNavItemClasses();
                _updatePillPosition(i, oldIdx !== i);
                if (_currentScreen !== spec.id) {
                    var dir = i > oldIdx ? 'left' : 'right';
                    navigateTo(spec.id, null, dir);
                }
            });

            _navItemElements.push(item);
            items.appendChild(item);
        });

        bar.appendChild(items);
        topNav.appendChild(bar);
        _topNavEl = topNav;
        _topNavPillEl = pill;

        // Position the pill once the items are on the DOM (deferred).
        // V3.7-fix8: also (re-)measure rects after layout settles.
        setTimeout(function() {
            _measureNavRects();
            _updatePillPosition(_navIndex, false);
        }, 0);

        // V3.7-fix8: bind a debounced resize listener once to invalidate +
        // re-measure cached rects when the viewport changes (browser only).
        if (!_navResizeBound) {
            _navResizeBound = true;
            window.addEventListener('resize', function() {
                if (_navResizeTimer) clearTimeout(_navResizeTimer);
                _navResizeTimer = setTimeout(function() {
                    _navResizeTimer = null;
                    _measureNavRects();
                    _updatePillPosition(_navIndex, false);
                }, 120);
            });
        }

        return topNav;
    }

    // V3.7-fix8: measure nav item rects once after render / on resize so that
    // _updatePillPosition() can avoid getBoundingClientRect() on every focus
    // change. Falls back to nulling the cache if the bar isn't yet rendered.
    function _measureNavRects() {
        var bar = document.getElementById('top-nav-bar');
        if (!bar || !_navItemElements.length) {
            _navItemRects = null;
            return;
        }
        var barRect = bar.getBoundingClientRect();
        _navBarLeft = barRect.left;
        // D65 (v3.10 R4): the pill's CSS base width is 10rem, so its px width
        // follows the interface size. Measured with the item rects rather
        // than assumed; offsetWidth ignores the pill's own scaleX.
        _pillBaseWidth = _topNavPillEl ? _topNavPillEl.offsetWidth : 0;
        var rects = [];
        var anyZero = _pillBaseWidth === 0;
        _navRectsBoldIndex = -1;
        for (var i = 0; i < _navItemElements.length; i++) {
            var r = _navItemElements[i].getBoundingClientRect();
            if (r.width === 0) anyZero = true;
            rects.push({ left: r.left, width: r.width });
            if (_navItemElements[i].classList.contains('selected')) _navRectsBoldIndex = i;
        }
        // If layout isn't ready (any zero-width item), keep cache stale so the
        // next call retries; do not memoise broken values.
        _navItemRects = anyZero ? null : rects;
    }

    function _updatePillPosition(itemIndex, animate) {
        if (!_topNavPillEl) return;
        var item = _navItemElements[itemIndex];
        if (!item) return;
        // V3.7-fix8: lazy-measure if cache is stale (first paint or post-resize
        // before timer fires).
        if (!_navItemRects || !_navItemRects[itemIndex]) {
            _measureNavRects();
        }
        if (!_navItemRects || !_navItemRects[itemIndex] || _navItemRects[itemIndex].width === 0) {
            // Not yet laid out (hidden or mid-transition); retry on next frame —
            // but only if the caller's index is still the current nav index.
            setTimeout(function() {
                if (_navIndex === itemIndex) _updatePillPosition(itemIndex, animate);
            }, 16);
            return;
        }
        var rect = _navItemRects[itemIndex];
        var itemWidth = rect.width;
        // Item's actual rendered left offset relative to the bar — includes any
        // margin/padding that offsetLeft would miss in certain layouts.
        var itemLeft = rect.left - _navBarLeft;
        // GPU-only: translateX positions the pill, scaleX stretches its fixed
        // base width (10rem, measured - D65) to match the target item's width.
        // transform-origin:left keeps the left edge anchored to itemLeft.
        var scaleX = itemWidth / _pillBaseWidth;
        if (animate) {
            _topNavPillEl.style.transition = 'transform 0.25s ease';
        } else {
            _topNavPillEl.style.transition = 'none';
        }
        _topNavPillEl.style.transform = 'translateX(' + itemLeft + 'px) scaleX(' + scaleX + ')';
    }

    function _setPillState(state) {
        _pillState = state;
        if (!_topNavPillEl) return;
        _topNavPillEl.classList.remove('focused', 'selected');
        _topNavPillEl.classList.add(state);
    }

    function _updateNavItemClasses() {
        _navItemElements.forEach(function(el, i) {
            el.classList.toggle('focused', i === _navIndex && _pillState === 'focused');
            el.classList.toggle('selected', i === _navIndex);
        });
        // D69 (v3.10 S2): the selected item is weight 600 and the rest 500,
        // so moving the selection changes that item's width and, the bar
        // being centred, every item's left. Rects measured with another item
        // selected are stale: drop them so the next pill update re-measures.
        // Once per selection change, not per focus change (V3.7-fix8).
        if (_navRectsBoldIndex !== _navIndex) _navItemRects = null;
    }

    function setNavBarVisible(visible) {
        if (_topNavEl) {
            _topNavEl.style.display = visible ? '' : 'none';
        }
        // Note: page-container `.no-nav` (fullbleed top:0) is managed separately
        // per-screen via _setPageFullbleed() — decoupled so the nav can float
        // over a fullbleed screen (Now Playing) while staying visible.
    }

    function _setPageFullbleed(fullbleed) {
        var container = document.getElementById('page-container');
        if (!container) return;
        if (fullbleed) container.classList.add('no-nav');
        else container.classList.remove('no-nav');
    }

    // --- Now Playing auto-hide nav timer ---
    var _navAutoHideTimer = null;
    var NAV_AUTO_HIDE_MS = 5000;

    function _isNavBarVisible() {
        return !!(_topNavEl && _topNavEl.style.display !== 'none');
    }

    function _scheduleNavAutoHide() {
        _cancelNavAutoHide();
        _navAutoHideTimer = setTimeout(function() {
            _navAutoHideTimer = null;
            if (_currentScreen !== 'nowplaying') return;
            if (!_isNavBarVisible()) return;
            setNavBarVisible(false);
            _setPillState('selected');
            _updateNavItemClasses();
            // If the user is still on the nav bar when the timer fires,
            // drop focus into NP content (same behaviour as pressing Down).
            if (FocusManager.getActiveZone() === 'topnav') {
                var zone = _getPageFirstZone();
                if (zone) FocusManager.enterZone(zone, undefined, true);
            }
        }, NAV_AUTO_HIDE_MS);
    }

    function _cancelNavAutoHide() {
        if (_navAutoHideTimer) {
            clearTimeout(_navAutoHideTimer);
            _navAutoHideTimer = null;
        }
    }

    function _setNpBarCollapsed(collapsed) {
        var container = document.getElementById('page-container');
        if (!container) return;
        if (collapsed) container.classList.add('no-np-bar');
        else container.classList.remove('no-np-bar');
    }

    function _getPageFirstZone() {
        // Zones that screens register (in priority order).
        // V3-6-fix NAV-3: library-grid is preferred over library-subnav so
        // Down from the top nav lands on the first grid tile, not the side
        // sub-nav. The sub-nav is reachable via Left from the grid.
        // V3-6-fix3 NAV-1: 'queue-list' is preferred over 'queue-card' so
        // Down from the topnav lands on the first queue row when there are
        // items; 'queue-card' is the empty-queue fallback.
        for (var i = 0; i < PAGE_FIRST_ZONES.length; i++) {
            if (FocusManager.hasZone(PAGE_FIRST_ZONES[i])) return PAGE_FIRST_ZONES[i];
        }
        return null;
    }

    // =========================================
    //  Now Playing Bar (Live)
    // =========================================

    // References for live updates
    var _npBarArt = null;
    var _npBarTitle = null;
    var _npBarArtist = null;
    var _npBarMiniProgress = null;
    var _npBarPlayBtn = null;

    function _buildNowPlayingBar() {
        var npBar = el('div', { className: 'now-playing-bar', id: 'now-playing-bar' });

        // Initial state — no track, bar hidden. updateNpBarVisibility will
        // adjust once playback starts or the user navigates.
        npBar.style.opacity = '0';
        npBar.style.pointerEvents = 'none';

        // Mini progress line at top (GPU-safe scaleX)
        _npBarMiniProgress = el('div', { className: 'mini-progress' });
        _npBarMiniProgress.style.setProperty('--progress', '0');
        npBar.appendChild(_npBarMiniProgress);

        // Left: album art + track info. v3.10 R9 (D56): also the bar's first
        // d-pad target, `.np-bar-open`; Enter or a click opens Now Playing.
        var npLeft = el('div', { className: 'now-playing-bar-left np-bar-open' });
        npLeft.style.cursor = 'pointer';
        npLeft.addEventListener('click', _openNowPlayingFromBar);

        _npBarArt = el('div', { className: 'now-playing-bar-art' });
        npLeft.appendChild(_npBarArt);

        var npInfo = el('div', { className: 'now-playing-bar-info' });
        _npBarTitle = el('div', { className: 'now-playing-bar-title' }, 'No track playing');
        _npBarArtist = el('div', { className: 'now-playing-bar-artist' }, 'Select a song to begin');
        npInfo.appendChild(_npBarTitle);
        npInfo.appendChild(_npBarArtist);
        npLeft.appendChild(npInfo);
        // D80: what OK does here (mockup 11); transparent until focused.
        npLeft.appendChild(el('div', { className: 'np-bar-open-hint' }, 'OK \u2192 Now Playing'));
        npBar.appendChild(npLeft);

        // Centre: transport controls
        var npCenter = el('div', { className: 'now-playing-bar-center' });

        var prevBtn = el('button', { className: 'np-bar-btn' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = rem(20);
        prevSvg.style.height = rem(20);
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        npCenter.appendChild(prevBtn);

        _npBarPlayBtn = el('button', { className: 'play-btn-main np-bar-btn' });
        var playSvg = createSvg(SVG_PATHS.play);
        playSvg.style.width = rem(18);
        playSvg.style.height = rem(18);
        _npBarPlayBtn.appendChild(playSvg);
        _npBarPlayBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        npCenter.appendChild(_npBarPlayBtn);

        var nextBtn = el('button', { className: 'np-bar-btn' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = rem(20);
        nextSvg.style.height = rem(20);
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        npCenter.appendChild(nextBtn);

        npBar.appendChild(npCenter);

        // Subscribe to player events
        _subscribeNowPlayingBar();
        _subscribeQueueResume();

        return npBar;
    }

    // V3-5: preload the NP-sized cover art the moment the track changes.
    // When the user later opens the Now Playing screen the image comes from
    // the browser HTTP cache, so it renders in one frame rather than painting
    // in horizontal bands as the network bytes arrive.
    // V3-6: warm ImageCache for the screen the user is sliding toward, so
    // album art is already decoded by the time the transition lands.
    // Throttled to once per (screen, second) to avoid hammering the API
    // when the user flicks across the nav bar.
    // V3.7-fix18: 5-minute completion gate. The inner getAlbumList2 calls
    // already go through SubsonicAPI._cachedRequest (which has an in-memory
    // map and a localStorage TTL after fix6), so the gate prevents redundant
    // ImageCache.preload churn within the cache TTL window. Reset on logout
    // (see _showLogin) so a different user starts fresh.
    var _preloadDone = {};
    var PRELOAD_GATE_MS = 5 * 60 * 1000;
    function _preloadScreenImages(screenId) {
        var now = Date.now();
        var last = _preloadDone[screenId] || 0;
        if (now - last < PRELOAD_GATE_MS) return;

        var api = AuthManager.getApi();
        if (!api) return;

        // V3.9 T6: these have to be the SAME calls the screens make, or the
        // preload is pure waste. The cache key is
        // username|serverUrl|endpoint|JSON.stringify(params), so a different
        // `size` — or a missing `libraryIds` — is a different key, and no
        // preload could ever serve a screen. Before v3.9 the preload asked for
        // 12 / 24 with no library scope while Home asks for 6
        // (js/screens/home.js) and Library asks for 50 (the albums
        // PaginatedLoader page size); a single Library navigation on a cold
        // cache therefore made two getAlbumList2 round trips instead of one,
        // and warmed art from libraries the user had deselected.
        //
        // The image size must match too: after T1 the grid cards and the home
        // cards both request 180, so preloading 300 would be 24 downloads
        // nothing ever displays.
        var libraryIds = AuthManager.getSelectedLibraries();

        function warm(albums) {
            var ids = [];
            for (var i = 0; i < albums.length; i++) {
                if (albums[i].coverArt) ids.push(albums[i].coverArt);
            }
            ImageCache.preload(ids, SonanceUtils.artSize(180));   // D70: = the cards' request
            _preloadDone[screenId] = Date.now();
        }

        if (screenId === 'home') {
            // v3.12 R4: Home's own request, so its size follows the setting.
            api.getAlbumList2('newest', SonanceSettings.homeRowSize, 0, libraryIds).then(warm).catch(function() {});
        } else if (screenId === 'library') {
            api.getAlbumList2('alphabeticalByName', 50, 0, libraryIds).then(warm).catch(function() {});
        }
    }

    function _preloadNpArt(track) {
        if (!track) return;
        var coverId = track.coverArt || track.albumId;
        if (!coverId) return;
        // Route through ImageCache so the NP screen and bg blur both reuse
        // the same in-memory entries on subsequent visits.
        // V3.9 T1: 320 is the NP screen's request size; 100 stays, it is the
        // shared source for both the NP bar art (48 px) and the blurred
        // .np-bg-image, so one download serves both.
        // v3.10 D70: the sizes Now Playing (art, backdrop) and the bar request.
        ImageCache.get(coverId, SonanceUtils.artSize(320), null);
        ImageCache.get(coverId, SonanceUtils.artSize(100), null);
    }

    // V3.9 S4 T5: these five were anonymous closures, so nothing could ever
    // detach them. Player's `_listeners` registry is module-global and
    // survives _showLogin() — which tears down the shell's DOM and focus
    // zones but never unsubscribed — so every logout → login cycle added five
    // permanent listeners, each closed over the *previous* shell's detached
    // elements and each firing on every progress tick. Named functions so
    // _unsubscribeShellPlayerEvents() can remove exactly this set.
    function _onPlayerUserPlay() {
        if (SonanceSettings.autoNowPlaying && _currentScreen !== 'nowplaying') {
            // v3.10 R2 (D93): Now Playing rises over the page.
            navigateTo('nowplaying', null, 'rise');
        }
    }

    function _onPlayerTrackChange(track) {
        _preloadNpArt(track);
        _updateNpBarTrack(track);
        _updateNpBarVisibility();
    }

    function _onPlayerProgress(data) {
        if (_npBarMiniProgress && data.duration > 0) {
            var ratio = data.currentTime / data.duration;
            _npBarMiniProgress.style.setProperty('--progress', ratio.toString());
        }
    }

    function _onPlayerPlay() {
        _updateNpBarPlayIcon(true);
        _updateNpBarVisibility();
    }

    function _onPlayerPause() {
        _updateNpBarPlayIcon(false);
    }

    // Idempotent: Player.off filters by identity, so removing a set that was
    // never attached is a no-op.
    function _unsubscribeShellPlayerEvents() {
        Player.off('userplay', _onPlayerUserPlay);
        Player.off('trackchange', _onPlayerTrackChange);
        Player.off('progress', _onPlayerProgress);
        Player.off('play', _onPlayerPlay);
        Player.off('pause', _onPlayerPause);
        _unsubscribeQueueResume();
    }

    // =========================================
    //  Resume queue (v3.10 A8)
    // =========================================

    // The server keeps one saved queue per user (savePlayQueue). Sonance
    // saves on a track change, on pause, at most every 30 s of playback and
    // when the page is hidden; it restores at shell start, paused.
    var QUEUE_SAVE_MAX = 1000;            // ids around the current one
    var QUEUE_SAVE_EVERY_MS = 30000;      // while playing
    var QUEUE_SAVE_DEBOUNCE_MS = 1000;    // a run of Next presses saves once
    var _queueSaveTimer = null;
    var _lastQueueSaveAt = 0;
    var _lastQueueSig = null;
    var _shellGen = 0;                    // a restore answer for a torn-down shell is dropped

    // The 1,000 ids nearest the current index, that index within them and
    // the position in ms; null with no track.
    function _queueSnapshot() {
        var s = Player.getState();
        if (!s.currentTrack || !s.queue.length) return null;
        var start = Math.max(0, Math.min(s.queueIndex - QUEUE_SAVE_MAX / 2, s.queue.length - QUEUE_SAVE_MAX));
        var ids = s.queue.slice(start, start + QUEUE_SAVE_MAX).map(function(t) { return t.id; });
        return { ids: ids, index: s.queueIndex - start, positionMs: Math.round((s.currentTime || 0) * 1000) };
    }

    function _saveQueueNow() {
        if (_queueSaveTimer !== null) {
            clearTimeout(_queueSaveTimer);
            _queueSaveTimer = null;
        }
        if (!SonanceSettings.resumeQueue) return;
        var api = AuthManager.getApi();
        var snap = _queueSnapshot();
        if (!api || !snap) return;
        // Identical to the last save (the restore's own trackchange, a second
        // pause): nothing to write. Position to the second.
        var sig = snap.ids.join(',') + '|' + snap.index + '|' + Math.floor(snap.positionMs / 1000);
        if (sig === _lastQueueSig) return;
        _lastQueueSig = sig;
        _lastQueueSaveAt = Date.now();
        api.savePlayQueue(snap.ids, snap.index, snap.positionMs).then(function(r) {
            log('App', 'Queue saved: ' + snap.ids.length + ' ids' + (r && r.post ? ' (POST)' : ''));
        }).catch(function(err) {
            _lastQueueSig = null;
            log('App', 'Queue save failed: ' + (err && err.message));
        });
    }

    function _saveQueueSoon() {
        if (!SonanceSettings.resumeQueue) return;
        if (_queueSaveTimer !== null) clearTimeout(_queueSaveTimer);
        _queueSaveTimer = setTimeout(_saveQueueNow, QUEUE_SAVE_DEBOUNCE_MS);
    }

    function _onQueueResumeProgress() {
        if (!SonanceSettings.resumeQueue || !Player.getState().isPlaying) return;
        if (Date.now() - _lastQueueSaveAt >= QUEUE_SAVE_EVERY_MS) _saveQueueNow();
    }

    function _onQueueResumeHidden() {
        if (document.visibilityState === 'hidden') _saveQueueNow();
    }

    function _subscribeQueueResume() {
        Player.on('trackchange', _saveQueueSoon);
        Player.on('pause', _saveQueueSoon);
        Player.on('progress', _onQueueResumeProgress);
        document.addEventListener('visibilitychange', _onQueueResumeHidden);
    }

    function _unsubscribeQueueResume() {
        Player.off('trackchange', _saveQueueSoon);
        Player.off('pause', _saveQueueSoon);
        Player.off('progress', _onQueueResumeProgress);
        document.removeEventListener('visibilitychange', _onQueueResumeHidden);
        if (_queueSaveTimer !== null) {
            clearTimeout(_queueSaveTimer);
            _queueSaveTimer = null;
        }
    }

    // Shell start: the saved queue comes back paused in the NP bar, unless
    // the user has started something in the meantime.
    function _restoreSavedQueue() {
        if (!SonanceSettings.resumeQueue || Player.getState().currentTrack) return;
        var api = AuthManager.getApi();
        if (!api) return;
        var gen = _shellGen;
        api.getPlayQueue().then(function(q) {
            if (gen !== _shellGen || !q || Player.getState().currentTrack) return;
            Player.restoreQueue(q.entries, q.index, q.positionMs);
            // What was just restored is what the server holds.
            var snap = _queueSnapshot();
            if (snap) _lastQueueSig = snap.ids.join(',') + '|' + snap.index + '|' + Math.floor(snap.positionMs / 1000);
            if (_queueSaveTimer !== null) {
                clearTimeout(_queueSaveTimer);
                _queueSaveTimer = null;
            }
        }).catch(function(err) {
            log('App', 'Queue restore failed: ' + (err && err.message));
        });
    }

    function _subscribeNowPlayingBar() {
        Player.on('trackchange', _onPlayerTrackChange);
        Player.on('progress', _onPlayerProgress);
        Player.on('play', _onPlayerPlay);
        Player.on('pause', _onPlayerPause);
    }

    // The NP bar shows only when a track is loaded AND the user is not on the
    // Now Playing screen (which replaces the bar). Also the bar zone's
    // isAvailable (v3.10 D56/D78): a hidden bar is never a focus target.
    function _shouldShowNpBar() {
        var state = Player.getState();
        var hasTrack = !!(state && state.currentTrack);
        return hasTrack && _currentScreen !== 'nowplaying';
    }

    function _openNowPlayingFromBar() {
        if (Player.getState().currentTrack) {
            // v3.10 D95: Back from this Now Playing returns to the item focus
            // came down to the bar from (the bar's D79 origin), as Back from
            // a detail returns to its card. saveCurrentFocus never records
            // the bar itself.
            var key = _focusKeyForScreen(_currentScreen);
            var origin = FocusManager.getActiveZone() === 'nowplaying-bar'
                ? FocusManager.getOrigin('nowplaying-bar') : null;
            if (key && origin) _savedFocus[key] = origin;
            // v3.10 R2 (D93): Now Playing rises out of the bar.
            navigateTo('nowplaying', null, 'rise');
        }
    }

    // Opacity transition is GPU-composited; page-container bottom snaps
    // instantly via `no-np-bar`.
    function _updateNpBarVisibility() {
        var bar = document.getElementById('now-playing-bar');
        if (!bar) return;

        var shouldShow = _shouldShowNpBar();
        var container = document.getElementById('page-container');
        var wasCollapsed = !!(container && container.classList.contains('no-np-bar'));

        // D78: the bar is going away under the focus (its track was
        // cleared). Its zone now counts as empty, so Up leaves it for the
        // zone focus came from. Opening Now Playing is not this case: that
        // screen puts focus on its own controls.
        if (!shouldShow && _currentScreen !== 'nowplaying' &&
                FocusManager.getActiveZone() === 'nowplaying-bar') {
            FocusManager.moveFocus('up');
        }

        if (shouldShow) {
            bar.style.display = '';
            bar.style.opacity = '1';
            bar.style.pointerEvents = 'auto';
            _setNpBarCollapsed(false);
            // v3.10 S3 (D86): the page just lost the bar's height under the
            // focus (first play with Auto Now Playing off). Re-apply the
            // content focus so the screen's own scroll-follow runs against
            // the smaller page; a row near the bottom would otherwise sit
            // under the bar. Same zone and index, so nothing else changes.
            if (wasCollapsed) {
                var zone = FocusManager.getActiveZone();
                if (zone && zone !== 'topnav' && zone !== 'nowplaying-bar') {
                    FocusManager.setActiveZone(zone, undefined, true);
                }
            }
        } else {
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            _setNpBarCollapsed(true);
        }
    }

    function _updateNpBarTrack(track) {
        if (!track) return;
        if (_npBarTitle) _npBarTitle.textContent = track.title || 'Unknown';
        if (_npBarArtist) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _npBarArtist.textContent = parts.join(' \u2014 ') || 'Unknown';
        }

        // Update album art (always visible — no lazy load, but cache-routed)
        if (_npBarArt) {
            _npBarArt.textContent = '';
            var api = AuthManager.getApi();
            var coverId = track.coverArt || track.albumId;
            if (api && coverId) {
                var img = document.createElement('img');
                img.className = 'lazy-art loaded';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                };
                img.src = ImageCache.getUrl(coverId, SonanceUtils.artSize(100));   // D70
                _npBarArt.appendChild(img);
            }
        }

        // Reset progress
        if (_npBarMiniProgress) _npBarMiniProgress.style.setProperty('--progress', '0');
    }

    function _updateNpBarPlayIcon(isPlaying) {
        if (!_npBarPlayBtn) return;
        _npBarPlayBtn.textContent = '';
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = rem(18);
        icon.style.height = rem(18);
        _npBarPlayBtn.appendChild(icon);
    }

    // =========================================
    //  Focus Zone Registration
    // =========================================

    function _registerTopNavZone() {
        FocusManager.registerZone('topnav', {
            selector: '.top-nav-item',
            columns: NAV_ITEMS.length,
            defaultIndex: 0,
            onFocus: function(index) {
                _navIndex = index;
                // Returning to the nav from content — show focused (accent) pill.
                _setPillState('focused');
                _updateNavItemClasses();
                _updatePillPosition(index, true);
                // V3-6: warm ImageCache for the nav item under focus so the
                // images are already in memory when the slide transition
                // completes.
                _preloadScreenImages(NAV_ITEMS[index].id);
                // On NP, returning focus to the nav (via Up) re-shows the bar
                // and restarts the 5s auto-hide timer.
                if (_currentScreen === 'nowplaying') {
                    setNavBarVisible(true);
                    _scheduleNavAutoHide();
                }
            },
            onActivate: function(index) {
                // Enter — navigate to the activated nav item if it's not the
                // current screen, then drop focus into page content. Without
                // this, pressing Enter on (e.g.) Home from the NP screen would
                // just re-enter NP's content — the user expects it to switch
                // screens like Left/Right does, but immediately enter content.
                _cancelNavAutoHide();

                // D89: a pending dwell targets this item; go now.
                var navigated = _flushNavDwell();
                var targetScreen = NAV_ITEMS[index].id;
                if (_currentScreen !== targetScreen) {
                    var oldIdx = _primaryNavIndex();
                    _navIndex = index;
                    navigateTo(targetScreen, null, index > oldIdx ? 'left' : 'right');
                    navigated = true;
                }

                // After navigation, _currentScreen is the target. If we just
                // left NP, hide the NP-only nav-bar overlay.
                if (_currentScreen === 'nowplaying') setNavBarVisible(false);

                _dropIntoContent(navigated);
            },
            onKey: function(direction) {
                if (direction === 'down') {
                    // V3.7-fix29 Bug 4: don't cancel the NP auto-hide here
                    // and don't yank the bar invisible. Let the existing
                    // 5 s timer run so the user sees the pill state
                    // transition from 'focused' to 'selected' before the
                    // bar fades out. On non-NP screens the nav bar is
                    // always visible, so cancelling the timer is a no-op
                    // there but keeps explicit semantics.
                    if (_currentScreen !== 'nowplaying') _cancelNavAutoHide();
                    // D51/D89: Down during the dwell navigates at once.
                    _dropIntoContent(_flushNavDwell());
                    return true;
                }
                if (direction === 'left' || direction === 'right') {
                    // User is actively browsing — restart the auto-hide timer on NP.
                    if (_currentScreen === 'nowplaying') _scheduleNavAutoHide();
                    var len = NAV_ITEMS.length;
                    var newIndex = direction === 'right'
                        ? (_navIndex + 1) % len
                        : (_navIndex - 1 + len) % len;
                    // The pill and its label move now (onFocus repeats this a
                    // frame later); _navIndex is set here, not left to the
                    // rAF-deferred onFocus, so a second press inside the same
                    // frame steps from the right item.
                    _navIndex = newIndex;
                    FocusManager.setActiveZone('topnav', newIndex);
                    _setPillState('focused');
                    _updateNavItemClasses();
                    _updatePillPosition(newIndex, true);
                    // v3.10 R1.3 (D51): the screen follows after the dwell.
                    _scheduleNavDwell(direction === 'right' ? 1 : -1);
                    return true;
                }
                return false;
            },
            neighbors: {}
        });
    }

    // =========================================
    //  Top-nav dwell (v3.10 R1.3, D51, D89)
    // =========================================

    // Left/Right on the top nav moves the pill at once; the screen changes
    // NAV_DWELL_MS after the last press (a setTimeout restarted by each
    // press; no repeating timer). A flick across several items renders only
    // the destination; before v3.10 every press rendered its screen.
    var NAV_DWELL_MS = 180;
    var _navDwellTimer = null;
    // Net presses since the dwell began (+1 Right, -1 Left). The slide runs
    // the way the user moved overall, also across the Settings→Home wrap.
    var _navDwellNet = 0;

    function _scheduleNavDwell(step) {
        _navDwellNet += step;
        if (_navDwellTimer !== null) clearTimeout(_navDwellTimer);
        _navDwellTimer = setTimeout(_flushNavDwell, NAV_DWELL_MS);
    }

    function _cancelNavDwell() {
        if (_navDwellTimer !== null) clearTimeout(_navDwellTimer);
        _navDwellTimer = null;
        _navDwellNet = 0;
    }

    // Navigate now to the item the dwell is waiting on, if one is pending.
    // Called by the timer, and first by any other input on the nav (Down,
    // Enter, Back). Returns true if it changed the screen.
    function _flushNavDwell() {
        if (_navDwellTimer === null) return false;
        var net = _navDwellNet;
        _cancelNavDwell();
        var target = NAV_ITEMS[_navIndex] && NAV_ITEMS[_navIndex].id;
        if (!target || target === _currentScreen) return false;
        navigateTo(target, null, net >= 0 ? 'slide-left' : 'slide-right');
        return true;
    }

    // Candidate first zones, in priority order (see _getPageFirstZone).
    var PAGE_FIRST_ZONES = ['content', 'library-grid', 'library-subnav', 'queue-list', 'queue-card', 'search-results', 'album-tracks', 'np-controls'];

    // How long a drop that follows a navigation waits for the screen's
    // content zone before settling for what there is (as the focus
    // restore's safety timeout).
    var DROP_WAIT_MS = 2000;

    // Drop focus from the top nav into the current screen's first content
    // zone. D89: right after a navigation the new screen has not registered
    // its zones yet (they arrive with its data), so the drop waits for them.
    // Library registers its sub-nav at once and its grid with the data; a
    // drop onto a loaded Library lands on the grid, so the wait does too,
    // and takes the sub-nav only after DROP_WAIT_MS (an empty tab has no
    // grid). It gives up if the screen changes or focus leaves the nav.
    function _dropIntoContent(afterNavigation) {
        var screen = _currentScreen;
        var done = false;
        function drop(final) {
            if (done) return true;
            if (_currentScreen !== screen || FocusManager.getActiveZone() !== 'topnav') {
                done = true;
                return true;
            }
            var zone = _getPageFirstZone();
            if (!zone || (zone === 'library-subnav' && !final)) return false;
            done = true;
            _setPillState('selected');
            _updateNavItemClasses();
            FocusManager.enterZone(zone, undefined, true);
            return true;
        }
        if (!afterNavigation) {
            drop(true);
            return;
        }
        PAGE_FIRST_ZONES.forEach(function(name) {
            FocusManager.onceZoneRegistered(name, function() { drop(false); });
        });
        setTimeout(function() { drop(true); }, DROP_WAIT_MS);
    }

    /**
     * v3.10 R9 (D56): the one registration of the NP bar's focus zone. The
     * shell calls it with no argument; every screen calls it with the zone
     * above the bar. Targets, in order: "open Now Playing" (.np-bar-open),
     * Previous, Play/Pause, Next.
     * - Down from content enters on "open Now Playing" (entryIndex 0).
     * - Up goes back to the zone and item focus came from (returnToOrigin,
     *   D79), else to `upNeighbour`.
     * - While the bar is hidden the zone counts as empty (isAvailable, D78),
     *   so no transition enters it.
     */
    function registerNowPlayingBarZone(upNeighbour) {
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-open, .np-bar-btn',
            columns: 4,
            entryIndex: 0,
            returnToOrigin: true,
            isAvailable: _shouldShowNpBar,
            onActivate: function(index) {
                if (index === 0) _openNowPlayingFromBar();
                else if (index === 1) Player.previous();
                else if (index === 2) Player.togglePlayPause();
                else if (index === 3) Player.next();
            },
            neighbors: upNeighbour ? { up: upNeighbour, left: 'topnav' } : { up: 'topnav' }
        });
    }

    // =========================================
    //  Screen Router
    // =========================================

    /**
     * Navigate to a screen by name.
     * Primary nav screens replace the history stack; sub-screens push to it.
     * `transition` may be:
     *   'slide-left' | 'slide-right' — top-nav left/right slide
     *   'zoom-in' | 'zoom-out'       — sub-page zoom (Enter / Back)
     *   'left' | 'right'             — legacy aliases for slide-*
     *   null                         — snap (no animation)
     */
    function navigateTo(screenName, params, transition) {
        var screen = _screens[screenName];
        if (!screen) {
            log('App', 'Unknown screen: ' + screenName);
            return;
        }

        transition = _normaliseTransition(transition);

        // v3.10 D52/D87: no input lock. _navigateToScreen finishes any
        // running transition before it starts this one.
        // D53/D92: a zoom in starts from the focused element; the origin is
        // kept with the history entry so Back zooms out into it. Measured
        // with the layer at rest, so the running transition finishes first.
        var origin = null;
        if (transition === 'zoom-in') {
            _finishTransition();
            origin = _focusOrigin(_pageCurrent);
        }

        _navigateToScreen(screenName, params, transition, origin);

        // History management
        var entry = { screen: screenName, params: params };
        if (origin) entry.origin = origin;
        var isPrimary = _navScreens.indexOf(screenName) >= 0;
        if (isPrimary) {
            if (screenName === 'nowplaying') {
                // NP is a temporary view — push instead of replace so Back
                // returns to the screen the user came from. Guard against
                // double-push when NP is already on top (e.g. NP bar click
                // while already on NP).
                // D93: an NP that rose sinks on Back.
                if (transition === 'rise') entry.rose = true;
                if (_historyStack.length === 0
                    || _historyStack[_historyStack.length - 1].screen !== 'nowplaying') {
                    _historyStack.push(entry);
                }
            } else {
                // Primary nav: replace stack (nav navigation is flat)
                _historyStack = [entry];
            }
        } else {
            // Sub-screen: push to stack (drill-down)
            _historyStack.push(entry);
        }
    }

    // v3.10 D53/D92: the centre of the focused element as drawn
    // (getBoundingClientRect, so a card's 1.12 and a row's left-anchored 1.02
    // count), in `layer`'s border-box coordinates, which is what
    // transform-origin uses. Null when focus is not inside `layer` (a mouse
    // click): the zoom then runs about the layer's centre.
    function _focusOrigin(layer) {
        var el = FocusManager.getCurrentFocused();
        if (!layer || !el || el === layer || !layer.contains(el)) return null;
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        var l = layer.getBoundingClientRect();
        return {
            x: Math.round((r.left + r.width / 2 - l.left) * 10) / 10,
            y: Math.round((r.top + r.height / 2 - l.top) * 10) / 10
        };
    }

    // =========================================
    //  Focus snapshot/restore (V3-6-fix NAV-1)
    // =========================================

    function _focusKeyForScreen(screenName) {
        if (!screenName) return null;
        // Library is sub-tabbed — key the snapshot to the active tab so
        // switching tabs after a drill-down doesn't cross-pollute focus.
        if (screenName === 'library' &&
            typeof LibraryScreen !== 'undefined' &&
            typeof LibraryScreen.getActiveTab === 'function') {
            return 'library:' + LibraryScreen.getActiveTab();
        }
        return screenName;
    }

    function saveCurrentFocus() {
        var key = _focusKeyForScreen(_currentScreen);
        if (!key) return;
        var snap = FocusManager.snapshot();
        if (!snap || !snap.zone) return;
        // Only save content focus — never the top nav or NP bar.
        if (snap.zone === 'topnav' || snap.zone === 'nowplaying-bar') return;
        _savedFocus[key] = snap;
    }

    /**
     * Try to restore the saved focus for the screen we just navigated TO.
     * Returns true if the snapshot existed and we either restored it
     * synchronously or scheduled an async retry; in both cases the caller
     * should NOT fall back to forcing the top nav. Returns false when no
     * snapshot is available — caller should apply default focus behaviour.
     */
    function _tryRestoreFocusForCurrentScreen() {
        var key = _focusKeyForScreen(_currentScreen);
        if (!key) return false;
        var snap = _savedFocus[key];
        if (!snap) return false;

        // Sync attempt — succeeds when the destination's content zones are
        // already registered (e.g. fast LAN, cached data).
        if (FocusManager.restore(snap)) {
            delete _savedFocus[key];
            _setPillState('selected');
            _updateNavItemClasses();
            return true;
        }

        // V3.7-fix17: replace the 50ms × 20 polling loop with a one-shot
        // observer fired by FocusManager.registerZone. A 2s safety timeout
        // drops the snapshot quietly if the zone never registers.
        var fired = false;
        var safety = setTimeout(function() {
            if (fired) return;
            fired = true;
            log('App', 'Focus restore: zone "' + snap.zone + '" never registered; dropping snapshot');
            delete _savedFocus[key];
        }, 2000);
        FocusManager.onceZoneRegistered(snap.zone, function() {
            if (fired) return;
            fired = true;
            clearTimeout(safety);
            // v3.10 D95: restore after the screen's registration block, not
            // inside it. Screens set their initial focus right after
            // registering (album: the first track; home: the hero), which
            // overrode a restore made at registration time: Back from Now
            // Playing landed on track 1, not the row that was played.
            Promise.resolve().then(function() {
                if (FocusManager.restore(snap)) {
                    _setPillState('selected');
                    _updateNavItemClasses();
                }
                delete _savedFocus[key];
            });
        });
        return true;
    }

    /**
     * Go back — navigation stack handler.
     *
     * Priority of actions:
     *   1. If the exit dialog is open, dismiss it.
     *   2. If on Now Playing, pop NP from the stack and return to the previous
     *      screen. NP is a temporary view — Back always leaves it regardless
     *      of which focus zone the user was in.
     *   3. If on a sub-screen (history length > 1), zoom back to the parent.
     *   4. If focus is in page content on a primary screen, return it to the
     *      top nav.
     *   5. At the root with focus on the top nav, show the exit dialog.
     */
    function goBack() {
        // 1. Exit dialog dismiss
        if (_exitDialogOpen) {
            _dismissExitDialog();
            return;
        }

        // 1a. v3.10 A5: the options sheet (its credits view, then the sheet)
        if (typeof OptionsSheet !== 'undefined' && OptionsSheet.handleBack()) return;

        // v3.10 D89: Back during a top-nav dwell first goes where the pill is.
        _flushNavDwell();

        // 1b. Give the current screen a chance to handle Back itself — used by
        // screens that have in-screen detail modes (e.g. Library genre songs,
        // Playlists detail) where the back motion is within the screen, not a
        // navigation-stack pop.
        var current = _currentScreen && _screens[_currentScreen];
        if (current && typeof current.handleBack === 'function') {
            try {
                if (current.handleBack()) return;
            } catch (e) {
                log('App', 'handleBack threw: ' + e.message);
            }
        }

        // 2. Now Playing → pop and return to previous screen
        if (_currentScreen === 'nowplaying') {
            _cancelNavAutoHide();
            setNavBarVisible(true);

            var npIdx = _navIndexForScreen('nowplaying');

            if (_historyStack.length > 1) {
                // Remove NP from the stack
                var npEntry = _historyStack.pop();
                var prev = _historyStack[_historyStack.length - 1];

                // Find nearest primary nav screen in the remaining stack to
                // position the pill (prev may be a sub-screen like album).
                var prevPrimaryIdx = -1;
                for (var i = _historyStack.length - 1; i >= 0; i--) {
                    var idx = _navIndexForScreen(_historyStack[i].screen);
                    if (idx >= 0) { prevPrimaryIdx = idx; break; }
                }

                // Slide in from whichever side matches the pill-restore
                // motion; an NP that rose sinks instead (R2, D93).
                var slideDir = null;
                if (npEntry.rose) {
                    slideDir = 'sink';
                } else if (prevPrimaryIdx >= 0 && npIdx >= 0) {
                    slideDir = prevPrimaryIdx < npIdx ? 'right' : 'left';
                }

                _navigateToScreen(prev.screen, prev.params, slideDir);

                // If prev is a sub-screen, _navigateToScreen doesn't move the
                // pill — do it here so it ends up on the correct primary.
                var prevIsPrimary = _navIndexForScreen(prev.screen) >= 0;
                if (!prevIsPrimary && prevPrimaryIdx >= 0) {
                    _navIndex = prevPrimaryIdx;
                    // D69: bold the new selection before the pill measures it.
                    _updateNavItemClasses();
                    _updatePillPosition(prevPrimaryIdx, true);
                }
            } else {
                // NP was the only entry on the stack (auto-NP on app start).
                // Go to Home.
                _historyStack = [{ screen: 'home', params: null }];
                _navigateToScreen('home', null, 'right');
            }

            // V3-6-fix NAV-1: try to restore the saved focus first; only
            // fall through to forcing the top nav if no snapshot is queued.
            if (!_tryRestoreFocusForCurrentScreen()) {
                FocusManager.setActiveZone('topnav', _navIndex, true);
                _setPillState('focused');
                _updateNavItemClasses();
            }
            return;
        }

        // 3. Sub-screen → zoom out to parent (V3-2), into the origin the
        // zoom in started from (D53/D92).
        if (_historyStack.length > 1) {
            var leaving = _historyStack.pop();
            var prev = _historyStack[_historyStack.length - 1];
            _navigateToScreen(prev.screen, prev.params, 'zoom-out', leaving.origin || null);
            // V3-6-fix NAV-1: prefer restoring the parent's saved focus
            // (e.g. the library tile the user came from) over bouncing the
            // user back up to the top nav.
            if (!_tryRestoreFocusForCurrentScreen()) {
                FocusManager.setActiveZone('topnav', _navIndex, true);
                _setPillState('focused');
                _updateNavItemClasses();
            }
            return;
        }

        // 4. Primary screen with focus in page content → return to top nav.
        // v3.10 D94 (D85): the NP bar counts as content here; it used to
        // fall through to the exit dialog.
        var activeZone = FocusManager.getActiveZone();
        if (activeZone && activeZone !== 'topnav') {
            FocusManager.setActiveZone('topnav', _navIndex, true);
            _setPillState('focused');
            _updateNavItemClasses();
            return;
        }

        // 5. At root primary with focus on top nav → exit dialog
        _showExitDialog();
    }

    // --- Exit Dialogue (P5.2) ---
    var _exitDialogOpen = false;
    var _exitOverlay = null;
    var _exitPreviousZone = null;

    function _showExitDialog() {
        if (_exitDialogOpen) return;
        _exitDialogOpen = true;

        // Remember current zone to restore on cancel
        _exitPreviousZone = FocusManager.getActiveZone();

        // Build overlay
        _exitOverlay = el('div', { className: 'exit-overlay' });
        var card = el('div', { className: 'exit-card' });
        card.appendChild(el('div', { className: 'exit-card-title' }, 'Exit Sonance?'));
        card.appendChild(el('div', { className: 'exit-card-subtitle' }, 'Are you sure you want to exit?'));

        var buttons = el('div', { className: 'exit-card-buttons' });
        var cancelBtn = el('button', { className: 'exit-btn exit-btn-cancel focusable', id: 'exit-cancel' }, 'Cancel');
        var exitBtn = el('button', { className: 'exit-btn exit-btn-exit focusable', id: 'exit-confirm' }, 'Exit');
        buttons.appendChild(cancelBtn);
        buttons.appendChild(exitBtn);
        card.appendChild(buttons);
        _exitOverlay.appendChild(card);

        // Append to #app (so position: absolute works relative to app)
        _appContainer.appendChild(_exitOverlay);

        // Register isolated focus zone for the dialog
        FocusManager.registerZone('exit-dialog', {
            selector: '.exit-card-buttons .focusable',
            columns: 2,
            onActivate: function(idx) {
                if (idx === 0) {
                    // Cancel
                    _dismissExitDialog();
                } else {
                    // Exit
                    _exitApp();
                }
            },
            neighbors: {}
        });
        // force=true so the topnav-protection in FocusManager doesn't swallow
        // this call when Back was pressed while focused on the nav bar.
        FocusManager.setActiveZone('exit-dialog', 0, true);
    }

    function _dismissExitDialog() {
        if (!_exitDialogOpen) return;
        _exitDialogOpen = false;

        if (_exitOverlay && _exitOverlay.parentNode) {
            _exitOverlay.parentNode.removeChild(_exitOverlay);
        }
        _exitOverlay = null;

        FocusManager.unregisterZone('exit-dialog');

        // Restore previous focus zone (force: we're explicitly restoring).
        if (_exitPreviousZone && FocusManager.hasZone(_exitPreviousZone)) {
            FocusManager.setActiveZone(_exitPreviousZone, undefined, true);
        } else {
            FocusManager.setActiveZone('topnav', _navIndex, true);
            _setPillState('focused');
            _updateNavItemClasses();
        }
        _exitPreviousZone = null;
    }

    function _exitApp() {
        // Tizen exit
        if (typeof tizen !== 'undefined' && tizen.application) {
            try {
                tizen.application.getCurrentApplication().exit();
            } catch (e) {
                log('App', 'Tizen exit failed: ' + e.message);
            }
        } else {
            // Browser fallback
            window.close();
            // If window.close() doesn't work (common in browser), dismiss and show toast
            _dismissExitDialog();
            showToast('Close this tab to exit');
        }
    }

    // =========================================
    //  Page transitions (v3.10 R2, ticket §6.4)
    // =========================================

    // D91: one easing for every page transition, ticket §6.4's slide curve
    // (a fast start that settles).
    var TRANSITION_EASE = 'cubic-bezier(.2,.8,.2,1)';

    // Start and end transforms and durations (ms) of the incoming layer
    // (`in*`) and the outgoing ghost (`out*`). Both fade as they move: the
    // incoming from opacity 0, the ghost to 0. `inFrom: null` = the incoming
    // layer does not move (sink), `inFadeMs` fading it in where it is;
    // `outTo: null` = the ghost does not move (rise), `outFadeMs` fading it
    // out where it is, and `ghostBelow` putting it under the incoming layer
    // instead of over it (.page-ghost is z-index 1). Every duration is at
    // most 250 ms. Lengths are rem, so they follow the interface size (R4).
    // v3.10-fix2 F1 (D152): the rise's ghost used to stay at full opacity
    // under a Now Playing that is not opaque (Solid background, D132) and
    // vanish in one step at cleanup, which on the TV read as the old page
    // hanging, then popping out; and the sink's page appeared at once.
    var TRANSITIONS = {
        'slide-left':  { inFrom: 'translateX(8rem)', inTo: 'translateX(0)', inMs: 220,
                         outFrom: 'translateX(0)', outTo: 'translateX(-8rem)', outMs: 220, outFadeMs: 220 },
        'slide-right': { inFrom: 'translateX(-8rem)', inTo: 'translateX(0)', inMs: 220,
                         outFrom: 'translateX(0)', outTo: 'translateX(8rem)', outMs: 220, outFadeMs: 220 },
        'zoom-in':     { inFrom: 'scale(0.86)', inTo: 'scale(1)', inMs: 250,
                         outFrom: 'scale(1)', outTo: 'scale(1.08)', outMs: 200, outFadeMs: 200 },
        'zoom-out':    { inFrom: 'scale(1.08)', inTo: 'scale(1)', inMs: 250,
                         outFrom: 'scale(1)', outTo: 'scale(0.86)', outMs: 200, outFadeMs: 200 },
        'rise':        { inFrom: 'translateY(6rem)', inTo: 'translateY(0)', inMs: 250,
                         outTo: null, outFadeMs: 250, ghostBelow: true },
        'sink':        { inFrom: null, inFadeMs: 250,
                         outFrom: 'translateY(0)', outTo: 'translateY(6rem)', outMs: 250, outFadeMs: 200 }
    };

    // D98: keep a page ghost where it was drawn. Its inset-0 box would
    // otherwise follow #page-container's new top and bottom (Now Playing
    // has no nav and no bar), moving it 8rem and re-laying it out at the
    // first frame of a rise or sink.
    function _pinGhost(ghost, box) {
        var c = ghost.parentNode.getBoundingClientRect();
        if (Math.abs(c.top - box.top) < 0.5 && Math.abs(c.height - box.height) < 0.5) return;
        ghost.style.top = (box.top - c.top) + 'px';
        ghost.style.bottom = 'auto';
        ghost.style.height = box.height + 'px';
    }

    function _clearTransitionStyles(node) {
        node.style.transition = '';
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.style.opacity = '';
        node.style.willChange = '';
    }

    /**
     * Run transition `kind` (a TRANSITIONS key) from `ghost` (the outgoing
     * layer, may be null) to `incoming`. Only transform and opacity animate
     * (GPU-composited, the Tizen 5.0 rule). `origin` ({x, y} px in the
     * layers' coordinates, or null for their centre) is the transform-origin
     * of both (D53). The run is tracked (D87): it ends after its longest
     * duration, or at once when the next navigation calls
     * _finishTransition, and either way `cleanup` runs, the ghost is removed
     * and the incoming layer is left with no inline transition styles.
     */
    function _runTransition(kind, incoming, ghost, origin, cleanup) {
        var t = TRANSITIONS[kind];
        var o = origin ? origin.x + 'px ' + origin.y + 'px' : '';
        var moveIn = !!t.inFrom;
        var fadeIn = moveIn || !!t.inFadeMs;
        var moveOut = !!(ghost && t.outTo);
        var fadeOut = !!(ghost && t.outFadeMs);

        if (fadeIn) {
            incoming.style.transition = 'none';
            incoming.style.opacity = '0';
            if (moveIn) {
                incoming.style.transformOrigin = o;
                incoming.style.transform = t.inFrom;
            }
            incoming.style.willChange = moveIn ? 'transform, opacity' : 'opacity';
        }
        if (ghost) {
            ghost.style.transition = 'none';
            if (t.ghostBelow) ghost.style.zIndex = '0';
            if (fadeOut) {
                if (moveOut) {
                    ghost.style.transformOrigin = o;
                    ghost.style.transform = t.outFrom;
                }
                ghost.style.opacity = '1';
                // V3.9 T4: .page-ghost carries no static will-change; the
                // hint lives as long as the ghost does.
                ghost.style.willChange = moveOut ? 'transform, opacity' : 'opacity';
            }
        }

        // Commit the start state before setting the end state.
        void incoming.offsetHeight;

        if (moveIn) {
            incoming.style.transition = 'transform ' + t.inMs + 'ms ' + TRANSITION_EASE +
                ', opacity ' + t.inMs + 'ms ' + TRANSITION_EASE;
            incoming.style.transform = t.inTo;
            incoming.style.opacity = '1';
        } else if (fadeIn) {
            incoming.style.transition = 'opacity ' + t.inFadeMs + 'ms ' + TRANSITION_EASE;
            incoming.style.opacity = '1';
        }
        if (moveOut) {
            ghost.style.transition = 'transform ' + t.outMs + 'ms ' + TRANSITION_EASE +
                ', opacity ' + t.outFadeMs + 'ms ' + TRANSITION_EASE;
            ghost.style.transform = t.outTo;
            ghost.style.opacity = '0';
        } else if (fadeOut) {
            ghost.style.transition = 'opacity ' + t.outFadeMs + 'ms ' + TRANSITION_EASE;
            ghost.style.opacity = '0';
        }

        // The ghost is at opacity 0 before this removes it (D152).
        var ms = Math.max(t.inMs || 0, t.inFadeMs || 0, t.outMs || 0, t.outFadeMs || 0) + 30;
        _trackTransition(function() {
            if (cleanup) cleanup();
            if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
            _clearTransitionStyles(incoming);
        }, ms);
    }

    /**
     * Internal: perform the actual screen transition.
     * `transition`:
     *   'slide-left'  — new page enters from right
     *   'slide-right' — new page enters from left
     *   'zoom-in'     — current scales up & fades, new scales from 0.86 to 1
     *   'zoom-out'    — current scales down & fades, new scales from 1.08 to 1
     *   'rise' / 'sink' — Now Playing rises over the page / sinks off it
     *   null          — no animation
     * `origin`: the zoom's transform-origin ({x, y}) or null (D53).
     */
    function _navigateToScreen(screenName, params, transition, origin) {
        var screen = _screens[screenName];
        if (!screen) return;
        transition = _normaliseTransition(transition);

        // D87: whatever is still animating finishes now, before its layers
        // are replaced. A pending top-nav dwell is superseded.
        _finishTransition();
        _cancelNavDwell();
        // v3.10 A5: an options sheet belongs to the screen being left; its
        // actions close it themselves, this covers any other navigation.
        if (typeof OptionsSheet !== 'undefined') OptionsSheet.close(false);

        var previousScreen = _currentScreen;

        // D98: Now Playing coming or going resizes #page-container (no-nav,
        // no-np-bar). Keep the old layer's box so its ghost can stay put.
        var ghostBox = null;
        if (transition && _pageCurrent && _pageCurrent.firstChild &&
                (screenName === 'nowplaying') !== (previousScreen === 'nowplaying')) {
            ghostBox = _pageCurrent.getBoundingClientRect();
        }

        // Deactivate current screen
        if (_currentScreen && _screens[_currentScreen]) {
            _screens[_currentScreen].deactivate();
            // V3.9 T3: the outgoing screen's lazy images are about to be
            // discarded, so unregister them from the IntersectionObserver and
            // drop any bytes still in flight for them. One call site covers
            // every screen because this is the only place a screen is
            // deactivated.
            if (typeof LazyLoader !== 'undefined' && LazyLoader.unobserveWithin) {
                LazyLoader.unobserveWithin(_pageCurrent);
            }
        }

        // Preserve whether focus is in the top nav — screens' activate() calls
        // setActiveZone('content') which would steal focus from the nav bar.
        var wasInTopNav = FocusManager.getActiveZone() === 'topnav';

        // Clear content focus zones
        FocusManager.clearContentZones();

        // Hide colour hints on screen change
        hideColourHints();

        // Visibility adjustments for NP and login-like screens. Class state
        // for the live layer is applied AFTER the detach-and-reuse swap below
        // (V3.7-fix7), so it lands on the new layer rather than the ghost.
        var hintBar = document.getElementById('colour-hint-bar');
        if (screenName === 'nowplaying') {
            if (hintBar) hintBar.style.display = 'none';
            _setPageFullbleed(true);
            setNavBarVisible(true);
            _cancelNavAutoHide();
            setTimeout(function() {
                if (_currentScreen === 'nowplaying' && _isNavBarVisible()) {
                    _scheduleNavAutoHide();
                }
            }, 300);
        } else {
            if (previousScreen === 'nowplaying' && hintBar) {
                hintBar.style.display = '';
            }
            _setPageFullbleed(false);
            setNavBarVisible(true);
            _cancelNavAutoHide();
        }

        // V3.7-fix7: detach-and-reuse instead of cloneNode. Demote the live
        // layer to a ghost (drop the id, add the page-ghost marker) and
        // create a fresh empty layer to be the new live layer.
        // No DOM is duplicated, no <img> nodes are re-decoded.
        // v3.10 D98: the ghost keeps the layer's classes (its padding, and
        // for Now Playing the full-bleed rules; css/styles.css has ghost
        // twins of the #page-current rules), so it does not re-lay out at
        // the first frame. It used to become a bare .page-ghost, and its
        // content jumped by the page padding (-72, -42 px at 150 %).
        var ghost = null;
        if (transition && _pageCurrent.firstChild) {
            var oldPage = _pageCurrent;
            var pageParent = oldPage.parentNode;

            oldPage.id = '';
            oldPage.removeAttribute('data-content-area');
            oldPage.classList.add('page-ghost');

            var newPage = document.createElement('div');
            newPage.id = 'page-current';
            newPage.className = 'page-layer content-area';
            newPage.setAttribute('data-content-area', '1');
            pageParent.appendChild(newPage);

            _pageCurrent = newPage;
            _contentArea = newPage;
            ghost = oldPage;
        } else {
            // First render or no animation — reuse the existing layer. Strip
            // previous screen-specific classes since we're not creating a
            // fresh layer that would start clean.
            _pageCurrent.textContent = '';
            _pageCurrent.classList.remove('np-active', 'fullbleed', 'album-active');
        }

        // Apply screen-specific classes to the (new) live layer.
        if (screenName === 'nowplaying') {
            _pageCurrent.classList.add('np-active', 'fullbleed');
        }

        screen.render(_pageCurrent);

        // Update state
        _currentScreen = screenName;

        // NP bar shows only when a track is loaded and we're off the NP screen.
        _updateNpBarVisibility();

        // Activate new screen (registers focus zones, fetches data, etc.)
        screen.activate(params);

        // Update top-nav selected/focused indicator
        _updateTopNavForScreen(screenName);

        // Dispatch animation based on transition type. All animations touch ONLY
        // `transform` + `opacity` so the Tizen GPU composites them cleanly.
        if (transition && TRANSITIONS[transition]) {
            if (ghost && ghostBox) _pinGhost(ghost, ghostBox);
            _runTransition(transition, _pageCurrent, ghost, origin || null, null);
        } else if (ghost && ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
        }

        // If the user was in the top nav when they triggered this navigation,
        // keep them in the top nav — don't let the screen's activate() steal focus.
        if (wasInTopNav) {
            FocusManager.setActiveZone('topnav', _navIndex);
            _setPillState('focused');
            _updateNavItemClasses();
        } else if (!FocusManager.getActiveZone()) {
            // V3-6-fix NAV-1: when a snapshot is queued for this screen the
            // goBack path will restore focus (sync or async). Don't grab
            // the first zone in the meantime — otherwise library-subnav
            // briefly flashes into the focused (accent) state during the
            // async retry window.
            var pendingKey = _focusKeyForScreen(screenName);
            var hasPendingRestore = pendingKey && !!_savedFocus[pendingKey];
            if (!hasPendingRestore) {
                var first = _getPageFirstZone();
                if (first) FocusManager.enterZone(first, 0);
            }
        }

        log('App', 'Navigated to: ' + screenName);
    }

    /**
     * Update top nav focus/pill to match the current primary screen.
     */
    function _updateTopNavForScreen(screenName) {
        var navIdx = -1;
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            if (NAV_ITEMS[i].id === screenName) { navIdx = i; break; }
        }
        if (navIdx >= 0) {
            _navIndex = navIdx;
            // V3.7-fix29 Bug 5: mirror the index into FocusManager so a
            // later Up-press from page content lands on the pill matching
            // the current primary screen, not whichever pill the user last
            // visited via topnav slide. setZoneIndex does NOT change the
            // active zone — only updates the remembered focus index.
            FocusManager.setZoneIndex('topnav', navIdx);
            _updateNavItemClasses();
            _updatePillPosition(navIdx, true);
        } else {
            // Sub-screen (album/artist) — keep selection on whatever primary led here; don't change index
            _updateNavItemClasses();
        }
    }

    /**
     * Zoom an element's content swap (V3-2, in-screen variant).
     * For screens that toggle modes internally (Library genre mode, Playlists
     * playlist-detail) instead of routing to a new screen. `renderFn(container)`
     * is invoked to produce the new content; we animate around it.
     *
     *   direction === 'in'  — used when drilling into detail (e.g. genre card
     *                          clicked, playlist card clicked)
     *   direction === 'out' — used when returning from detail
     *
     * v3.10 D87: never refused. A running transition finishes first (before
     * v3.10 a call inside the 300 ms lock returned without rendering at all).
     * D53/D92: 'in' starts from the focused element and remembers that
     * origin for the container; 'out' zooms back into it.
     */
    var _contentZoom = null;   // { container, origin } of the last 'in'

    function zoomContent(containerEl, renderFn, direction) {
        if (!containerEl || typeof renderFn !== 'function') return;
        _finishTransition();
        direction = direction === 'out' ? 'out' : 'in';

        var origin = null;
        if (direction === 'in') {
            origin = _focusOrigin(containerEl);
            _contentZoom = { container: containerEl, origin: origin };
        } else if (_contentZoom && _contentZoom.container === containerEl) {
            origin = _contentZoom.origin;
            _contentZoom = null;
        }

        var parent = containerEl.parentNode;

        // Ensure the parent establishes a positioning context so the
        // absolutely-positioned ghost overlays the source exactly — some
        // screens (e.g. `.library-screen`) use default `position: static`.
        var savedParentPosition = null;
        if (parent) {
            var parentComputedPos = getComputedStyle(parent).position;
            if (parentComputedPos === 'static') {
                savedParentPosition = parent.style.position;
                parent.style.position = 'relative';
            }
        }

        // V3.7-fix7: detach-and-move instead of cloneNode. Move the existing
        // children into a fresh ghost wrapper so containerEl stays the
        // caller's owned ref (renderFn fills it as before) but no DOM is
        // duplicated and no <img> is re-decoded. Geometry reads still pin
        // the wrapper to the source's box.
        var ghost = null;
        var scrollTop = containerEl.scrollTop;
        if (containerEl.firstChild && parent) {
            ghost = document.createElement('div');
            // v3.10 D98: the ghost takes the container's classes (its
            // padding and scroll box; for #page-current, the ghost twins of
            // the page-layer rules) and its scroll offset, so the content
            // does not move at the first frame (a bare wrapper dropped the
            // page padding: -24, -42 px at 150 % on playlist detail).
            ghost.className = containerEl.className + ' page-ghost';
            ghost.style.boxSizing = 'border-box';
            ghost.style.position = 'absolute';
            ghost.style.top    = containerEl.offsetTop    + 'px';
            ghost.style.left   = containerEl.offsetLeft   + 'px';
            ghost.style.width  = containerEl.offsetWidth  + 'px';
            ghost.style.height = containerEl.offsetHeight + 'px';
            ghost.style.margin = '0';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '2';

            while (containerEl.firstChild) {
                ghost.appendChild(containerEl.firstChild);
            }
            parent.appendChild(ghost);
            if (scrollTop) ghost.scrollTop = scrollTop;
        }

        // Render new content into the real container
        renderFn(containerEl);

        _runTransition(direction === 'in' ? 'zoom-in' : 'zoom-out', containerEl, ghost, origin, function() {
            // D17 teardown path: the in-screen detail being left (playlist
            // rows carry lazy thumbnails since v3.10 R5) will never consume
            // its pending images. Also when the ghost goes early (D87).
            if (ghost && typeof LazyLoader !== 'undefined' && LazyLoader.unobserveWithin) {
                LazyLoader.unobserveWithin(ghost);
            }
            if (savedParentPosition !== null && parent) {
                parent.style.position = savedParentPosition;
            }
        });
    }

    /**
     * Show login screen (called by Settings logout).
     */
    function showLogin() {
        _showLogin();
    }

    /**
     * Get the API instance (convenience for screens).
     */
    function getApi() {
        return AuthManager.getApi();
    }

    /**
     * Return the current screen name (or null before first navigation).
     */
    function getCurrentScreen() {
        return _currentScreen;
    }

    // =========================================
    //  Event Bus (V3.8)
    // =========================================
    var _eventListeners = {};

    function on(name, fn) {
        if (typeof fn !== 'function') return;
        if (!_eventListeners[name]) _eventListeners[name] = [];
        _eventListeners[name].push(fn);
    }

    function off(name, fn) {
        var arr = _eventListeners[name];
        if (!arr) return;
        _eventListeners[name] = arr.filter(function(f) { return f !== fn; });
    }

    function emit(name, payload) {
        var arr = _eventListeners[name];
        if (!arr) return;
        for (var i = 0; i < arr.length; i++) {
            try { arr[i](payload); }
            catch (e) { log('App', 'Event handler error (' + name + '): ' + e.message); }
        }
    }

    // V3.8: orchestrate side-effects of a library-selection change.
    //   - Stop playback + clear queue (release AVPlay if active).
    //   - Drop in-memory + LS API caches (scoped to this user/server).
    //   - Reload StarredCache against the new selection.
    //   - Persist the new selection.
    //   - Emit 'libraries-changed' for any interested listeners.
    //   - Leave the user on the current screen; Home / Library re-fetch
    //     with the new scope on their next activation, since their
    //     activate() reads AuthManager.getSelectedLibraries() afresh and
    //     the LS cache has been cleared.
    function applyLibraryChange(newIds) {
        log('App', 'Applying library change');

        if (typeof Player !== 'undefined') {
            try { Player.stop(); } catch (e) { /* ignore */ }
            try { Player.clearQueue(); } catch (e) { /* ignore */ }
        }

        var api = AuthManager.getApi();
        var creds = AuthManager.getCredentials();
        // V3.9 T8: a library change invalidates every in-flight result.
        if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.abortAll) {
            SubsonicAPI.abortAll();
        }
        if (api && typeof api.clearMemoryCache === 'function') {
            api.clearMemoryCache();
        } else if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.clearCache) {
            SubsonicAPI.clearCache();
        }
        // V3.9 T2: ImageCache.clear() existed but was called from nowhere. A
        // library change can remove albums from view, and their decoded cover
        // URLs should not be held for the rest of the session.
        if (typeof ImageCache !== 'undefined' && ImageCache.clear) {
            ImageCache.clear();
        }
        if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.clearLocalCache) {
            SubsonicAPI.clearLocalCache(creds.username, creds.serverUrl);
        }

        if (typeof StarredCache !== 'undefined') {
            StarredCache.clear();
        }

        AuthManager.setSelectedLibraries(newIds);

        if (api && typeof StarredCache !== 'undefined' && StarredCache.load) {
            StarredCache.load(api).catch(function(err) {
                log('App', 'StarredCache reload failed: ' + (err && err.message));
            });
        }

        emit('libraries-changed', { libraryIds: newIds });
    }

    // =========================================
    //  Bootstrap
    // =========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init: init,
        navigateTo: navigateTo,
        goBack: goBack,
        showLogin: showLogin,
        showAppShell: _showAppShell,
        getApi: getApi,
        getCurrentScreen: getCurrentScreen,
        showToast: showToast,
        showColourHints: showColourHints,
        hideColourHints: hideColourHints,
        zoomContent: zoomContent,
        setNavBarVisible: setNavBarVisible,
        // V3-6-fix NAV-1: snapshot the current zone+index so Back from a
        // sub-screen / NP returns to it. Called from grid + track onActivate.
        saveCurrentFocus: saveCurrentFocus,
        // Used by Library's in-screen genre-detail handleBack so the genre
        // grid's tile is refocused after the cross-fade out.
        tryRestoreFocus: _tryRestoreFocusForCurrentScreen,
        returnToTopNav: function() {
            FocusManager.setActiveZone('topnav', _navIndex);
            _setPillState('focused');
            _updateNavItemClasses();
        },
        applyAccentColor: applyAccentColor,
        saveAccentColor: saveAccentColor,
        resetAccentColor: resetAccentColor,
        getAccentColor: getAccentColor,
        getAccentRgb: getAccentRgb,
        applyUiScale: applyUiScale,
        setBackdrop: setBackdrop,
        // v3.10 R9 (D56): every screen registers the NP bar zone through this.
        registerNowPlayingBarZone: registerNowPlayingBarZone,
        // Whether the bar is showing, i.e. whether its zone can take focus.
        isNowPlayingBarAvailable: _shouldShowNpBar,
        DEFAULT_ACCENT_HEX: DEFAULT_ACCENT_HEX,
        DEFAULT_ACCENT_RGB: DEFAULT_ACCENT_RGB,
        // V3.8 event bus + library-change orchestrator
        on: on,
        off: off,
        emit: emit,
        applyLibraryChange: applyLibraryChange
    };
})();

/* ============================================
   Sonance — Player Engine
   Dual backend: AVPlay (Tizen) + HTML5 Audio (browser)
   Queue management, shuffle, repeat, scrobble
   ============================================ */

var Player = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var error = SonanceUtils.error;
    var formatDuration = SonanceUtils.formatDuration;

    // V3.7-fix14: persist user settings without crashing on quota errors.
    // Volume / shuffle / repeat are mirrored in `state` and only flushed on
    // user changes; reads at runtime hit `state` rather than localStorage.
    function _safeLocalSet(key, value) {
        try { localStorage.setItem(key, value); }
        catch (e) { /* quota — silently swallow */ }
    }

    // --- Platform Detection ---
    var IS_TIZEN = typeof window.webapis !== 'undefined' &&
                   typeof window.webapis.avplay !== 'undefined';

    log('Player', 'Platform: ' + (IS_TIZEN ? 'Tizen (AVPlay)' : 'Browser (HTML5 Audio)'));

    // --- State ---
    var state = {
        currentTrack: null,
        queue: [],
        originalQueue: [],
        queueIndex: 0,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        volume: 0.7,
        shuffle: false,
        repeat: 'none', // 'none' | 'all' | 'one'
        buffering: false
    };

    // --- Scrobble tracking ---
    var _scrobbled = false;
    var _scrobbleTrackId = null;

    // --- Event System ---
    var _listeners = {};

    function on(event, fn) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(fn);
    }

    function off(event, fn) {
        if (!_listeners[event]) return;
        _listeners[event] = _listeners[event].filter(function(f) { return f !== fn; });
    }

    // V3.9 S4 T5: diagnostic accessor, in the spirit of Session 3's
    // SubsonicAPI.cacheSize() / LazyLoader.observedCount(). `_listeners` is
    // module-global and survives App._showLogin(), so the only way to see a
    // subscription leak from outside is to be able to count them.
    function listenerCount(event) {
        if (event) return _listeners[event] ? _listeners[event].length : 0;
        var total = 0;
        for (var k in _listeners) {
            if (Object.prototype.hasOwnProperty.call(_listeners, k)) {
                total += _listeners[k].length;
            }
        }
        return total;
    }

    function _emit(event, data) {
        var fns = _listeners[event];
        if (!fns) return;
        for (var i = 0; i < fns.length; i++) {
            try { fns[i](data); } catch (e) {
                error('Player', 'Event handler error (' + event + '): ' + e.message);
            }
        }
    }

    // --- Audio element reference (HTML5 fallback) ---
    var _audio = null;
    var _preloadAudio = null;       // browser only — second audio element used for gapless preload
    var _preloadReady = false;      // browser only — preload element has buffered something

    // V3.9 S4 T2: webapis.avplay is a process-wide singleton. On a rapid
    // double-Next the first prepareAsync is still in flight when the second
    // load runs stop() / close() / open(), and the first call's success
    // callback then drives play() against a session it does not own. Every
    // load takes a generation number; a callback whose generation has been
    // superseded returns without touching state. stop() bumps it too, so a
    // prepareAsync landing after a teardown cannot restart playback.
    var _loadGeneration = 0;

    // V3.9 S4 T3: three paths called next() on a failed load with no counter
    // and no backoff — the AVPlay onerror listener, the prepareAsync error
    // callback, and the try/catch around the load (plus the HTML5 element's
    // error event). With the server unreachable that walks the whole queue as
    // fast as errors return, a full stop/close/open/prepareAsync per track;
    // on a shuffled 14 000-track queue it locks the TV up. Advancing stops
    // after this many consecutive failures and any successful load resets it.
    var _consecutiveLoadFailures = 0;
    var MAX_CONSECUTIVE_LOAD_FAILURES = 3;

    // --- Pre-prepared next track (gapless) ---
    var _nextPreparedUrl = null;
    var _nextPreparedTrack = null;
    var _nextPreparedIndex = -1;

    // User-initiated playback flag — set true by public methods that represent
    // the user starting a fresh play (album, track, queue jump, shuffle).
    // Consumed by _loadAndPlay to emit 'userplay' for auto-navigation. Not set
    // on next/previous, resume, or gapless auto-advance.
    var _userInitiated = false;

    // v3.10 A8 / A7: a track that is current but not loaded — a queue
    // restored at start-up, or the track cued by the sleep timer's "end of
    // track". The backend holds nothing for it (no AVPlay open), and the
    // first play() loads it and starts at this position (seconds). null when
    // the current track is loaded as usual.
    var _cuedAtSec = null;
    // The position the next load of `trackId` seeks to before it plays.
    var _pendingSeek = null;     // { trackId, sec }

    // v3.12 R1 (D173): formats AVPlay cannot play from their file, streamed
    // through a server transcode instead. Samsung's 2019 TV specification
    // lists Opus only inside video containers, and a .opus file is Ogg Opus.
    // One list, matched on the suffix or the contentType.
    var TRANSCODE_TYPES = ['opus'];
    var TRANSCODE = { format: 'mp3', maxBitRate: 320 };
    // The stream loaded now. A transcode has no byte ranges, so it is seeked
    // by reloading it from an offset (Navidrome's timeOffset, whole seconds);
    // the engine counts from 0, so `offset` is added to every position it
    // reports.
    var _stream = { transcoded: false, offset: 0 };
    // v3.12 R1 (D175): a seek in a transcode. Its target (seconds) waits here
    // while presses keep coming; playing, the reload goes out once they stop
    // (each reload is a new transcode on the server); paused, at Play.
    var _seekTarget = null;
    var _seekTimer = null;
    var SEEK_RELOAD_DELAY_MS = 400;
    // The load in flight is a seek's reload of the current track (D176).
    var _loadIsSeekReload = false;

    // v3.10 A7: the sleep timer's "End of track". When the current track
    // ends, playback pauses instead of advancing, the next track is cued
    // (paused) and 'trackendstop' is emitted. One-shot.
    var _stopAtTrackEnd = false;

    // --- Progress timer (for HTML5 audio, to provide smooth updates) ---
    var _progressTimer = null;

    // --- Progress-event throttle (V3.7-fix2) ---
    // Native timeupdate and AVPlay oncurrentplaytime can fire 4–10× per second
    // each. Listeners (NP-bar, NP scrubber, lyrics scroller, scrobble) only
    // need ~10 Hz, so emissions are gated to one per 100 ms. force=true
    // bypasses the gate for seek / track-end / track-load so the UI snaps.
    var _lastProgressEmit = 0;
    var PROGRESS_INTERVAL_MS = 100;

    function _emitProgress(force) {
        var now = Date.now();
        if (force || (now - _lastProgressEmit) >= PROGRESS_INTERVAL_MS) {
            _lastProgressEmit = now;
            _emit('progress', { currentTime: state.currentTime, duration: state.duration });
        }
    }

    // =========================================
    //  Stream URLs and transcodes (v3.12 R1)
    // =========================================

    function _isTranscoded(track) {
        if (!track) return false;
        var suffix = String(track.suffix || '').toLowerCase();
        var type = String(track.contentType || '').toLowerCase();
        for (var i = 0; i < TRANSCODE_TYPES.length; i++) {
            if (suffix === TRANSCODE_TYPES[i] || type.indexOf(TRANSCODE_TYPES[i]) > -1) return true;
        }
        return false;
    }

    // The one place a track's stream URL is decided: the load path, both
    // prepare-next paths and the seek reload. `offsetSec` applies to a
    // transcode only.
    function _streamUrlFor(api, track, offsetSec) {
        if (!_isTranscoded(track)) return api.getStreamUrl(track.id);
        return api.getStreamUrl(track.id, {
            format: TRANSCODE.format,
            maxBitRate: TRANSCODE.maxBitRate,
            timeOffset: offsetSec > 0 ? Math.floor(offsetSec) : 0
        });
    }

    // A duration the engine reports, as the player keeps it. A transcode's
    // own length is only what is left after its offset, and while it is
    // being made it may be unknown (Infinity, 0), so the track's metadata
    // wins (D174). Anything else is kept as 3.11 kept it.
    function _engineDuration(sec) {
        if (_stream.transcoded) {
            var meta = state.currentTrack ? (state.currentTrack.duration || 0) : 0;
            if (meta > 0) return meta;
            return (isFinite(sec) && sec > 0) ? sec + _stream.offset : 0;
        }
        return sec || 0;
    }

    function _cancelSeekReload() {
        if (_seekTimer !== null) clearTimeout(_seekTimer);
        _seekTimer = null;
        _seekTarget = null;
    }

    // Reload the current transcode from the seek's target. It is the same
    // track, so no trackchange, the scrobble state and any A8 cue are left
    // alone, and a failure does not count toward the cap (D176).
    function _seekReload() {
        if (_seekTimer !== null) clearTimeout(_seekTimer);
        _seekTimer = null;
        var target = _seekTarget;
        _seekTarget = null;
        var track = state.currentTrack;
        var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
        if (target === null || !track || !api) return;
        var offset = Math.floor(target);
        _stream = { transcoded: true, offset: offset };
        state.currentTime = offset;
        _loadIsSeekReload = true;
        log('Player', 'Reloading the transcode at ' + offset + ' s');
        var url = _streamUrlFor(api, track, offset);
        if (IS_TIZEN) {
            _avplayLoadAndPlay(url);
        } else {
            _html5LoadAndPlay(url);
        }
    }

    // =========================================
    //  Init
    // =========================================

    function init() {
        // Restore persisted state
        var savedVolume = localStorage.getItem('sonance_volume');
        if (savedVolume !== null) state.volume = parseFloat(savedVolume);

        var savedShuffle = localStorage.getItem('sonance_shuffle');
        if (savedShuffle !== null) state.shuffle = savedShuffle === 'true';

        var savedRepeat = localStorage.getItem('sonance_repeat');
        if (savedRepeat !== null) state.repeat = savedRepeat;

        if (!IS_TIZEN) {
            _audio = document.getElementById('sonance-audio');
            _preloadAudio = document.getElementById('sonance-audio-preload');
            if (_audio) {
                _audio.volume = state.volume;
                _attachHtml5Listeners(_audio);
            }
            if (_preloadAudio) {
                _preloadAudio.volume = state.volume;
            }
        }

        log('Player', 'Player initialized. Tizen: ' + IS_TIZEN +
            ', Volume: ' + state.volume +
            ', Shuffle: ' + state.shuffle +
            ', Repeat: ' + state.repeat);
    }

    // =========================================
    //  HTML5 Audio Backend
    // =========================================

    function _attachHtml5Listeners(el) {
        if (!el) return;

        el._onTimeUpdate = function() {
            // v3.12 R1: while a seek's reload waits, the old stream's
            // position must not show, nor drive prepare-next.
            if (_seekTarget !== null) return;
            state.currentTime = el.currentTime + _stream.offset;
            state.duration = _engineDuration(el.duration);

            // Pre-load next track 5 seconds before end of current — runs BEFORE
            // the progress throttle so the boundary frame is never skipped.
            if (state.duration > 10 &&
                state.currentTime > state.duration - 5 &&
                !_preloadReady &&
                _preloadAudio) {
                var nextInfo = _determineNextTrack();
                if (nextInfo) {
                    var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
                    if (api) {
                        _nextPreparedTrack = nextInfo.track;
                        _nextPreparedIndex = nextInfo.index;
                        _nextPreparedUrl = _streamUrlFor(api, nextInfo.track, 0);
                        try {
                            _preloadAudio.src = _nextPreparedUrl;
                            _preloadAudio.volume = state.volume;
                            _preloadAudio.load();
                            _preloadReady = true;
                            log('Player', 'Pre-loaded next: ' + (nextInfo.track.title || '?'));
                        } catch (e) {
                            warn('Player', 'Preload failed: ' + e.message);
                            _resetPreparedTrack();
                        }
                    }
                }
            }

            _emitProgress(false);
            _checkScrobble();
        };

        el._onLoadedMetadata = function() {
            state.duration = _engineDuration(el.duration);
            // v3.10 A8: a resumed track starts where it was saved.
            if (_pendingSeek && state.currentTrack && _pendingSeek.trackId === state.currentTrack.id) {
                var at = Math.min(_pendingSeek.sec, state.duration || _pendingSeek.sec);
                _pendingSeek = null;
                try { el.currentTime = at; } catch (e) { /* ignore */ }
                state.currentTime = at;
            }
            _emitProgress(true);
        };

        el._onEnded = function() {
            if (_stopAtTrackEnd) {
                _stopAtEnd();
            } else if (_preloadReady && _preloadAudio && _nextPreparedTrack) {
                _html5GaplessSwap();
            } else {
                _onTrackEnded();
            }
        };

        el._onPlay = function() {
            state.isPlaying = true;
            _suppressScreenSaver(true);
            _emit('play');
        };

        el._onPause = function() {
            state.isPlaying = false;
            _suppressScreenSaver(false);
            _emit('pause');
        };

        el._onError = function() {
            var msg = el.error ? el.error.message : 'Unknown audio error';
            error('Player', 'Audio error: ' + msg);
            _onLoadFailure('html5 error', _html5Cause(el.error));
        };

        el._onWaiting = function() {
            state.buffering = true;
            _emit('buffering', true);
        };

        el._onCanPlay = function() {
            state.buffering = false;
            _onLoadSuccess();
            _emit('buffering', false);
        };

        el.addEventListener('timeupdate', el._onTimeUpdate);
        el.addEventListener('loadedmetadata', el._onLoadedMetadata);
        el.addEventListener('ended', el._onEnded);
        el.addEventListener('play', el._onPlay);
        el.addEventListener('pause', el._onPause);
        el.addEventListener('error', el._onError);
        el.addEventListener('waiting', el._onWaiting);
        el.addEventListener('canplay', el._onCanPlay);
    }

    function _detachHtml5Listeners(el) {
        if (!el) return;
        if (el._onTimeUpdate)     el.removeEventListener('timeupdate', el._onTimeUpdate);
        if (el._onLoadedMetadata) el.removeEventListener('loadedmetadata', el._onLoadedMetadata);
        if (el._onEnded)          el.removeEventListener('ended', el._onEnded);
        if (el._onPlay)           el.removeEventListener('play', el._onPlay);
        if (el._onPause)          el.removeEventListener('pause', el._onPause);
        if (el._onError)          el.removeEventListener('error', el._onError);
        if (el._onWaiting)        el.removeEventListener('waiting', el._onWaiting);
        if (el._onCanPlay)        el.removeEventListener('canplay', el._onCanPlay);
        el._onTimeUpdate = null;
        el._onLoadedMetadata = null;
        el._onEnded = null;
        el._onPlay = null;
        el._onPause = null;
        el._onError = null;
        el._onWaiting = null;
        el._onCanPlay = null;
    }

    function _html5GaplessSwap() {
        var oldActive = _audio;
        var newActive = _preloadAudio;
        var track = _nextPreparedTrack;
        var idx = _nextPreparedIndex;

        // Detach listeners from old active before swap so nothing fires on it
        _detachHtml5Listeners(oldActive);

        // Swap refs
        _audio = newActive;
        _preloadAudio = oldActive;

        // Clear pre-prepared state (track is being consumed)
        _nextPreparedUrl = null;
        _nextPreparedTrack = null;
        _nextPreparedIndex = -1;
        _preloadReady = false;
        _cancelSeekReload();
        _loadIsSeekReload = false;
        _stream = { transcoded: _isTranscoded(track), offset: 0 };

        // Reset old active (now preload slot) so it stops and releases its src
        try {
            oldActive.pause();
            oldActive.removeAttribute('src');
            oldActive.load();
        } catch (e) { /* ignore */ }

        // Update player state to the new track
        state.queueIndex = idx;
        state.currentTrack = track;
        state.currentTime = 0;
        state.duration = _stream.transcoded ? _engineDuration(_audio.duration)
            : (_audio.duration || (track.duration || 0));
        _scrobbled = false;
        _scrobbleTrackId = track.id;

        // Attach listeners to the new active element
        _attachHtml5Listeners(_audio);

        // Play the pre-loaded audio immediately
        try {
            _audio.volume = state.volume;
            var p = _audio.play();
            if (p && typeof p.then === 'function') {
                p.catch(function(err) {
                    error('Player', 'Gapless play failed: ' + err.message);
                });
            }
        } catch (e) {
            error('Player', 'Gapless swap play threw: ' + e.message);
        }
        state.isPlaying = true;
        _suppressScreenSaver(true);

        // CRITICAL: notify listeners (lyrics, stars, NP screen) of new track.
        // Don't manually emit 'play' — the HTML5 <audio> 'play' DOM event will
        // fire via _onPlay once .play() dispatches it, avoiding a double emit.
        _lastProgressEmit = 0;
        _emit('trackchange', track);
        _emit('queuechange');
        _emitProgress(true);

        log('Player', 'Gapless swap to: ' + (track.title || '?'));
    }

    // =========================================
    //  Gapless — Determine next track & reset
    // =========================================

    function _determineNextTrack() {
        if (!state.queue || !state.queue.length) return null;

        if (state.repeat === 'one') {
            return { track: state.currentTrack, index: state.queueIndex };
        }

        var nextIndex = state.queueIndex + 1;

        if (nextIndex >= state.queue.length) {
            if (state.repeat === 'all') {
                nextIndex = 0;
            } else {
                return null;
            }
        }

        return { track: state.queue[nextIndex], index: nextIndex };
    }

    function _resetPreparedTrack() {
        _nextPreparedUrl = null;
        _nextPreparedTrack = null;
        _nextPreparedIndex = -1;
        _preloadReady = false;
        if (_preloadAudio) {
            try {
                _preloadAudio.pause();
                _preloadAudio.removeAttribute('src');
                _preloadAudio.load();
            } catch (e) { /* ignore */ }
        }
    }

    // =========================================
    //  Screen Saver Suppression (Tizen)
    // =========================================

    function _suppressScreenSaver(suppress) {
        if (typeof window.webapis === 'undefined' || !window.webapis.appcommon) return;
        try {
            var ss = window.webapis.appcommon.AppCommonScreenSaverState;
            var target = suppress ? ss.SCREEN_SAVER_OFF : ss.SCREEN_SAVER_ON;
            window.webapis.appcommon.setScreenSaver(target, function() {}, function() {});
        } catch (e) {
            warn('Player', 'Screen saver toggle failed: ' + e.message);
        }
    }

    // =========================================
    //  AVPlay Backend (Tizen)
    // =========================================

    function _avplayLoadAndPlay(streamUrl) {
        // V3.9 S4 T2: claim a generation BEFORE any teardown, so every callback
        // registered below can tell whether it still owns the player.
        var gen = ++_loadGeneration;
        try {
            var avplay = window.webapis.avplay;
            var currentState = avplay.getState();

            // Stop and close if currently active
            if (currentState !== 'NONE' && currentState !== 'IDLE') {
                try { avplay.stop(); } catch (e) { /* ignore */ }
            }
            if (currentState !== 'NONE') {
                try { avplay.close(); } catch (e) { /* ignore */ }
            }

            avplay.open(streamUrl);
            avplay.setDisplayRect(0, 0, 1, 1); // 1x1 off-screen for audio-only

            avplay.setListener({
                oncurrentplaytime: function(ms) {
                    if (gen !== _loadGeneration) return;
                    // v3.12 R1: while a seek's reload waits, the old
                    // stream's position must not show, nor drive prepare-next.
                    if (_seekTarget !== null) return;
                    state.currentTime = ms / 1000 + _stream.offset;

                    // Pre-prepare next track 5 seconds before end — runs BEFORE
                    // the progress throttle so the boundary frame is never skipped.
                    if (state.duration > 10 &&
                        state.currentTime > state.duration - 5 &&
                        !_nextPreparedUrl) {
                        var nextInfo = _determineNextTrack();
                        if (nextInfo) {
                            var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
                            if (api) {
                                _nextPreparedUrl = _streamUrlFor(api, nextInfo.track, 0);
                                _nextPreparedTrack = nextInfo.track;
                                _nextPreparedIndex = nextInfo.index;
                                log('Player', 'Pre-prepared next: ' + (nextInfo.track.title || '?'));
                            }
                        }
                    }

                    _emitProgress(false);
                    _checkScrobble();
                },
                onstreamcompleted: function() {
                    if (gen !== _loadGeneration) return;
                    log('Player', 'Stream completed');
                    if (_stopAtTrackEnd) {
                        _stopAtEnd();
                    } else if (_nextPreparedUrl && _nextPreparedTrack) {
                        var url = _nextPreparedUrl;
                        var track = _nextPreparedTrack;
                        var idx = _nextPreparedIndex;

                        // Clear pre-prepared state BEFORE loading (prevents re-trigger)
                        _nextPreparedUrl = null;
                        _nextPreparedTrack = null;
                        _nextPreparedIndex = -1;

                        state.queueIndex = idx;
                        _loadAndPlay(track, url);
                        _emit('queuechange');
                        log('Player', 'Gapless AVPlay advance to: ' + (track.title || '?'));
                    } else {
                        _onTrackEnded();
                    }
                },
                onbufferingstart: function() {
                    if (gen !== _loadGeneration) return;
                    state.buffering = true;
                    _emit('buffering', true);
                },
                onbufferingcomplete: function() {
                    if (gen !== _loadGeneration) return;
                    state.buffering = false;
                    _emit('buffering', false);
                },
                onerror: function(err) {
                    if (gen !== _loadGeneration) return;
                    error('Player', 'AVPlay error: ' + err);
                    _onLoadFailure('avplay onerror', _avplayCause(err));
                },
                onevent: function(eventType, eventData) {
                    log('Player', 'AVPlay event: ' + eventType);
                },
                onsubtitlechange: function() {}
            });

            avplay.prepareAsync(
                function() {
                    // Success. Superseded by a later load — do NOT play(): the
                    // player now holds a different stream (V3.9 S4 T2).
                    if (gen !== _loadGeneration) {
                        log('Player', 'Discarding stale prepare success (gen ' +
                            gen + ' != ' + _loadGeneration + ')');
                        return;
                    }
                    try {
                        state.duration = _engineDuration(avplay.getDuration() / 1000);
                    } catch (e) {
                        state.duration = state.currentTrack ? (state.currentTrack.duration || 0) : 0;
                    }
                    // v3.10 A8: a resumed track starts where it was saved.
                    // Seeking in READY, before play(), is the AVPlay
                    // sequence the TV checklist confirms on the device.
                    if (_pendingSeek && state.currentTrack && _pendingSeek.trackId === state.currentTrack.id) {
                        var atMs = Math.round(_pendingSeek.sec * 1000);
                        _pendingSeek = null;
                        try { avplay.seekTo(atMs); } catch (eSeek) {
                            warn('Player', 'AVPlay resume seek failed: ' + eSeek.message);
                        }
                        state.currentTime = atMs / 1000;
                    }
                    avplay.play();
                    state.isPlaying = true;
                    _onLoadSuccess();
                    _suppressScreenSaver(true);
                    _emit('play');
                    _emitProgress(true);
                    log('Player', 'AVPlay playing');
                },
                function(err) {
                    if (gen !== _loadGeneration) {
                        log('Player', 'Discarding stale prepare failure (gen ' +
                            gen + ' != ' + _loadGeneration + ')');
                        return;
                    }
                    error('Player', 'AVPlay prepare failed: ' + err);
                    _onLoadFailure('avplay prepareAsync', _avplayCause(err));
                }
            );
        } catch (e) {
            if (gen !== _loadGeneration) return;
            error('Player', 'AVPlay exception: ' + e.message);
            _onLoadFailure('avplay exception', _avplayCause(e));
        }
    }

    // =========================================
    //  Internal Playback Control
    // =========================================

    function _loadAndPlay(track, precomputedUrl) {
        if (!track || !track.id) {
            warn('Player', 'No track to play');
            return;
        }

        // v3.12 R1: a resumed transcode (A8) starts at its position through
        // its URL (timeOffset), not by a seek once loaded: it has no ranges.
        var transcoded = _isTranscoded(track);
        var offset = 0;
        if (transcoded && !precomputedUrl && _pendingSeek && _pendingSeek.trackId === track.id) {
            offset = Math.floor(_pendingSeek.sec);
            _pendingSeek = null;
        }

        var streamUrl = precomputedUrl;
        if (!streamUrl) {
            var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
            if (!api) {
                error('Player', 'No API instance available');
                return;
            }
            streamUrl = _streamUrlFor(api, track, offset);
        }

        log('Player', 'Loading: ' + (track.title || 'Unknown') + ' by ' + (track.artist || 'Unknown'));

        // v3.10 A8/A7: any load ends a cue, and a resume seek belongs to
        // its own track only (a Next pressed before the resumed track's
        // metadata arrived must not start the next one part-way through).
        _cuedAtSec = null;
        if (_pendingSeek && _pendingSeek.trackId !== track.id) _pendingSeek = null;
        // v3.12 R1: and a seek waiting to reload the previous stream.
        _cancelSeekReload();
        _loadIsSeekReload = false;
        _stream = { transcoded: transcoded, offset: offset };

        // Reset scrobble state
        _scrobbled = false;
        _scrobbleTrackId = track.id;

        // Update state
        state.currentTrack = track;
        state.currentTime = 0;
        state.duration = track.duration || 0;
        _lastProgressEmit = 0;

        _emit('trackchange', track);

        if (_userInitiated) {
            _userInitiated = false;
            _emit('userplay', track);
        }

        if (IS_TIZEN) {
            _avplayLoadAndPlay(streamUrl);
        } else {
            _html5LoadAndPlay(streamUrl);
        }
    }

    function _html5LoadAndPlay(streamUrl) {
        if (!_audio) return;
        _audio.src = streamUrl;
        _audio.volume = state.volume;
        var playPromise = _audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.catch(function(err) {
                error('Player', 'HTML5 play failed: ' + err.message);
            });
        }
    }

    // v3.12 R6 (D171): why a track did not load, for its toast: 'format' when
    // the engine could not read the media, 'load' otherwise. AVPlay's
    // onerror passes an AVPlayError (PLAYER_ERROR_NOT_SUPPORTED_FILE /
    // _FORMAT); prepareAsync's error callback and a thrown exception a
    // WebAPIException, whose type for this is NotSupportedError (Samsung's
    // AVPlay API reference).
    function _avplayCause(err) {
        var s = (err && typeof err === 'object') ? String(err.name || err.message || '') : String(err);
        return /NOT_SUPPORTED|NotSupported/.test(s) ? 'format' : 'load';
    }

    // v3.12 R6 (D172): the browser fallback. Chromium reports MediaError 4
    // (MEDIA_ERR_SRC_NOT_SUPPORTED) for an undecodable body and for a 404 or
    // a refused request alike; for the latter its message is
    // "MEDIA_ELEMENT_ERROR: Format error", for the former it names the media
    // pipeline (DEMUXER_ERROR_...). Measured in Playwright's Chromium.
    function _html5Cause(mediaError) {
        if (!mediaError || mediaError.code !== 4) return 'load';
        return /MEDIA_ELEMENT_ERROR/.test(mediaError.message || '') ? 'load' : 'format';
    }

    // V3.9 S4 T3: single funnel for "this track would not load". Both backends
    // and all four failure paths route through it so the cap cannot be
    // bypassed by adding another one. v3.12 R6: each failure names the track
    // and its cause in a toast; the stop toast after the cap comes after it,
    // so it is the one left on screen.
    function _onLoadFailure(label, cause) {
        // v3.12 R1 (D176): a seek's reload of a track that was playing is
        // not another track failing in a row.
        if (!_loadIsSeekReload) _consecutiveLoadFailures++;
        _loadIsSeekReload = false;
        var failed = state.currentTrack;
        if (failed && typeof App !== 'undefined' && App.showToast) {
            App.showToast((failed.title || 'Unknown track') + ' — ' +
                (cause === 'format' ? 'format not supported' : 'couldn\'t be loaded'));
        }
        if (_consecutiveLoadFailures < MAX_CONSECUTIVE_LOAD_FAILURES) {
            log('Player', 'Load failed (' + label + ') ' + _consecutiveLoadFailures +
                '/' + MAX_CONSECUTIVE_LOAD_FAILURES + ' — advancing');
            next();
            return;
        }
        warn('Player', 'Stopped advancing after ' + _consecutiveLoadFailures +
            ' consecutive load failures (' + label + ')');
        _resetPreparedTrack();
        state.isPlaying = false;
        state.buffering = false;
        _suppressScreenSaver(false);
        _emit('buffering', false);
        _emit('pause');
        if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('Playback stopped — tracks could not be played');
        }
    }

    // Any load that actually reaches a playable state clears the count.
    function _onLoadSuccess() {
        _consecutiveLoadFailures = 0;
    }

    // v3.10 A7: "End of track" — pause here and cue what Next would have
    // played (the same track with repeat one, or this one at its start at
    // the end of the queue), so Play continues the queue. Nothing is loaded
    // until then.
    function _stopAtEnd() {
        log('Player', 'Stopped at the end of the track (sleep timer)');
        _stopAtTrackEnd = false;
        _resetPreparedTrack();
        _cancelSeekReload();
        var nextInfo = _determineNextTrack();
        state.isPlaying = false;
        _suppressScreenSaver(false);
        state.currentTime = 0;
        _cuedAtSec = 0;
        _lastProgressEmit = 0;
        if (nextInfo && nextInfo.index !== state.queueIndex) {
            state.queueIndex = nextInfo.index;
            state.currentTrack = nextInfo.track;
            state.duration = nextInfo.track.duration || 0;
            _scrobbled = false;
            _scrobbleTrackId = nextInfo.track.id;
            _emit('trackchange', state.currentTrack);
            _emit('queuechange');
        }
        _emitProgress(true);
        _emit('pause');
        _emit('trackendstop');
    }

    function _onTrackEnded() {
        if (_stopAtTrackEnd) {
            _stopAtEnd();
            return;
        }
        log('Player', 'Track ended');
        if (state.repeat === 'one') {
            // Repeat single track
            _loadAndPlay(state.currentTrack);
        } else {
            _advanceQueue();
        }
    }

    function _advanceQueue() {
        if (state.queue.length === 0) return;

        var nextIdx = state.queueIndex + 1;

        if (nextIdx >= state.queue.length) {
            if (state.repeat === 'all') {
                nextIdx = 0;
            } else {
                // End of queue, no repeat
                state.isPlaying = false;
                _suppressScreenSaver(false);
                _emit('pause');
                log('Player', 'Queue ended');
                return;
            }
        }

        state.queueIndex = nextIdx;
        state.currentTrack = state.queue[nextIdx];
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
    }

    // =========================================
    //  Scrobble
    // =========================================

    function _checkScrobble() {
        if (_scrobbled) return;
        if (!state.currentTrack) return;
        if (state.duration <= 0) return;

        var threshold = Math.min(state.duration * 0.5, 240);
        if (state.currentTime >= threshold) {
            _scrobbled = true;
            var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
            if (api && _scrobbleTrackId) {
                api.scrobble(_scrobbleTrackId).then(function() {
                    log('Player', 'Scrobbled: ' + (state.currentTrack ? state.currentTrack.title : _scrobbleTrackId));
                }).catch(function(err) {
                    warn('Player', 'Scrobble failed: ' + err.message);
                });
            }
        }
    }

    // =========================================
    //  Public Methods
    // =========================================

    function playAlbum(tracks, startIndex) {
        if (!tracks || tracks.length === 0) return;
        startIndex = startIndex || 0;

        _resetPreparedTrack();
        _consecutiveLoadFailures = 0;   // V3.9 S4 T3: fresh user decision

        state.originalQueue = tracks.slice();
        state.queue = tracks.slice();
        state.queueIndex = startIndex;
        state.currentTrack = state.queue[startIndex];

        if (state.shuffle) {
            _applyShuffle();
        }

        _userInitiated = true;
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
        log('Player', 'Play album: ' + state.queue.length + ' tracks, starting at ' + startIndex);
    }

    function playTrack(track) {
        if (!track) return;
        _resetPreparedTrack();
        _consecutiveLoadFailures = 0;   // V3.9 S4 T3: fresh user decision
        // Insert after current and play it
        var insertIdx = state.queueIndex + 1;
        state.queue.splice(insertIdx, 0, track);
        state.originalQueue.push(track);
        state.queueIndex = insertIdx;
        state.currentTrack = track;
        _userInitiated = true;
        _loadAndPlay(track);
        _emit('queuechange');
    }

    function addToQueue(track) {
        if (!track) return;
        state.queue.push(track);
        state.originalQueue.push(track);
        _resetPreparedTrack();
        _emit('queuechange');
        log('Player', 'Added to queue: ' + (track.title || 'Unknown'));
    }

    function addToQueueNext(track) {
        if (!track) return;
        var insertIdx = state.queueIndex + 1;
        state.queue.splice(insertIdx, 0, track);
        state.originalQueue.splice(insertIdx, 0, track);
        _resetPreparedTrack();
        _emit('queuechange');
        log('Player', 'Added next in queue: ' + (track.title || 'Unknown'));
    }

    function play() {
        if (!state.currentTrack) return;

        // v3.10 A8/A7: a cued track is loaded only now, and starts at its
        // position (seeked as soon as the backend can: loadedmetadata, or
        // AVPlay's prepare in READY).
        if (_cuedAtSec !== null) {
            var at = _cuedAtSec;
            _pendingSeek = at > 0 ? { trackId: state.currentTrack.id, sec: at } : null;
            _consecutiveLoadFailures = 0;
            _loadAndPlay(state.currentTrack);
            state.currentTime = at;
            _emitProgress(true);
            return;
        }

        // v3.12 R1: a transcode seeked while paused is reloaded from there.
        if (_seekTarget !== null) {
            _seekReload();
            return;
        }

        if (IS_TIZEN) {
            try {
                var avplay = window.webapis.avplay;
                var avState = avplay.getState();
                if (avState === 'PAUSED') {
                    avplay.play();
                } else if (avState === 'IDLE' || avState === 'NONE') {
                    _loadAndPlay(state.currentTrack);
                    return;
                }
            } catch (e) {
                error('Player', 'AVPlay resume error: ' + e.message);
            }
        } else {
            if (_audio) {
                var p = _audio.play();
                if (p && typeof p.then === 'function') {
                    p.catch(function(err) {
                        error('Player', 'HTML5 resume failed: ' + err.message);
                    });
                }
            }
        }

        state.isPlaying = true;
        _suppressScreenSaver(true);
        _emit('play');
    }

    function pause() {
        if (IS_TIZEN) {
            try { window.webapis.avplay.pause(); } catch (e) { /* ignore */ }
        } else {
            if (_audio) _audio.pause();
        }
        state.isPlaying = false;
        _suppressScreenSaver(false);
        _emit('pause');
    }

    // V3.8: stop playback and release backend resources without touching the
    // queue. Used by App.applyLibraryChange before the queue is cleared so
    // AVPlay isn't holding a stream from the previous library.
    function stop() {
        // V3.9 S4 T2: invalidate any in-flight prepareAsync so its success
        // callback cannot restart playback on the session being torn down.
        _loadGeneration++;
        _resetPreparedTrack();
        _cuedAtSec = null;
        _pendingSeek = null;
        _cancelSeekReload();
        if (IS_TIZEN) {
            try {
                var avplay = window.webapis.avplay;
                var s = avplay.getState();
                if (s !== 'NONE' && s !== 'IDLE') {
                    try { avplay.stop(); } catch (e) { /* ignore */ }
                }
                if (s !== 'NONE') {
                    try { avplay.close(); } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        } else {
            if (_audio) {
                try { _audio.pause(); } catch (e) { /* ignore */ }
                try { _audio.removeAttribute('src'); _audio.load(); } catch (e) { /* ignore */ }
            }
            if (_preloadAudio) {
                try { _preloadAudio.pause(); } catch (e) { /* ignore */ }
                try { _preloadAudio.removeAttribute('src'); _preloadAudio.load(); } catch (e) { /* ignore */ }
                _preloadReady = false;
            }
        }
        state.isPlaying = false;
        state.currentTime = 0;
        state.duration = 0;
        state.buffering = false;
        _suppressScreenSaver(false);
        _emit('pause');
    }

    // V3.8: zero out the queue + current track and notify listeners. Used by
    // App.applyLibraryChange after stop(). The Queue screen redraws on the
    // queuechange event.
    function clearQueue() {
        state.queue = [];
        state.originalQueue = [];
        state.queueIndex = 0;
        state.currentTrack = null;
        _cuedAtSec = null;
        _pendingSeek = null;
        _cancelSeekReload();
        _scrobbled = false;
        _scrobbleTrackId = null;
        _emit('queuechange');
        _emit('trackchange', null);
    }

    function togglePlayPause() {
        if (state.isPlaying) {
            pause();
        } else {
            play();
        }
    }

    function next() {
        if (state.queue.length === 0) return;
        _resetPreparedTrack();

        if (state.repeat === 'one') {
            // Even in repeat-one, manual next goes to next track
            var nextIdx = state.queueIndex + 1;
            if (nextIdx >= state.queue.length) {
                if (state.repeat === 'one') {
                    // Wrap in repeat-one if it was at end
                    nextIdx = 0;
                } else {
                    return;
                }
            }
            state.queueIndex = nextIdx;
        } else {
            var ni = state.queueIndex + 1;
            if (ni >= state.queue.length) {
                if (state.repeat === 'all') {
                    ni = 0;
                } else {
                    return;
                }
            }
            state.queueIndex = ni;
        }

        state.currentTrack = state.queue[state.queueIndex];
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
    }

    function previous() {
        if (state.queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (state.currentTime > 3) {
            seekTo(0);
            return;
        }

        _resetPreparedTrack();
        var prevIdx = state.queueIndex - 1;
        if (prevIdx < 0) {
            if (state.repeat === 'all') {
                prevIdx = state.queue.length - 1;
            } else {
                seekTo(0);
                return;
            }
        }

        state.queueIndex = prevIdx;
        state.currentTrack = state.queue[prevIdx];
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
    }

    function seekTo(seconds) {
        seconds = Math.max(0, Math.min(seconds, state.duration || 0));
        // v3.10 A8: a cued track has nothing loaded to seek; its start
        // position moves instead, and Play starts there.
        if (_cuedAtSec !== null) {
            _cuedAtSec = seconds;
            state.currentTime = seconds;
            _emitProgress(true);
            _emit('seeked', state.currentTime);
            return;
        }
        // If we've pre-prepared the next track, a seek may move us out of the
        // trigger window — reset so the logic can re-decide when the new
        // playhead crosses the threshold.
        if (_nextPreparedUrl || _preloadReady) {
            _resetPreparedTrack();
        }
        // v3.12 R1 (D175): a transcode has no byte ranges; it is reloaded from
        // the target once the presses stop (playing) or at Play (paused). The
        // position shows the target meanwhile.
        if (_stream.transcoded) {
            _seekTarget = seconds;
            if (_seekTimer !== null) clearTimeout(_seekTimer);
            _seekTimer = null;
            if (state.isPlaying) {
                _seekTimer = setTimeout(function() {
                    _seekTimer = null;
                    if (state.isPlaying) _seekReload();
                }, SEEK_RELOAD_DELAY_MS);
            }
            state.currentTime = seconds;
            _emitProgress(true);
            _emit('seeked', state.currentTime);
            return;
        }
        if (IS_TIZEN) {
            try {
                window.webapis.avplay.seekTo(seconds * 1000);
            } catch (e) {
                warn('Player', 'AVPlay seek error: ' + e.message);
            }
        } else {
            if (_audio) {
                _audio.currentTime = seconds;
            }
        }
        state.currentTime = seconds;
        _emitProgress(true);
        _emit('seeked', state.currentTime);
    }

    function seekPercent(percent) {
        if (state.duration <= 0) return;
        var seconds = (percent / 100) * state.duration;
        seekTo(seconds);
    }

    function setVolume(vol) {
        vol = Math.max(0, Math.min(1, vol));
        state.volume = vol;
        _safeLocalSet('sonance_volume', String(vol));

        if (IS_TIZEN) {
            // Tizen volume is controlled via system API
            try {
                if (window.tizen && window.tizen.tvaudiocontrol) {
                    var tvVol = Math.round(vol * 100);
                    window.tizen.tvaudiocontrol.setVolume(tvVol);
                }
            } catch (e) {
                warn('Player', 'Tizen volume error: ' + e.message);
            }
        } else {
            if (_audio) _audio.volume = vol;
            if (_preloadAudio) _preloadAudio.volume = vol;
        }

        _emit('volumechange', vol);
    }

    function toggleShuffle() {
        state.shuffle = !state.shuffle;
        _safeLocalSet('sonance_shuffle', String(state.shuffle));
        _resetPreparedTrack();

        if (state.shuffle) {
            _applyShuffle();
        } else {
            _restoreOriginalOrder();
        }

        _emit('shufflechange', state.shuffle);
        _emit('queuechange');
        log('Player', 'Shuffle: ' + state.shuffle);
    }

    function _applyShuffle() {
        if (state.queue.length === 0) return;
        var current = state.currentTrack;
        // Save original order if not already saved
        if (state.originalQueue.length === 0) {
            state.originalQueue = state.queue.slice();
        }
        // Fisher-Yates shuffle, keeping current track at position 0
        var shuffled = state.queue.slice();
        // Remove current track from shuffle pool
        var currentIdx = -1;
        for (var i = 0; i < shuffled.length; i++) {
            if (current && shuffled[i].id === current.id) {
                currentIdx = i;
                break;
            }
        }
        if (currentIdx >= 0) {
            shuffled.splice(currentIdx, 1);
        }
        // Shuffle remaining
        for (var j = shuffled.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var temp = shuffled[j];
            shuffled[j] = shuffled[k];
            shuffled[k] = temp;
        }
        // Put current track at position 0
        if (current) {
            shuffled.unshift(current);
        }
        state.queue = shuffled;
        state.queueIndex = 0;
    }

    function _restoreOriginalOrder() {
        if (state.originalQueue.length === 0) return;
        var current = state.currentTrack;
        state.queue = state.originalQueue.slice();
        // Find current track in restored order
        state.queueIndex = 0;
        if (current) {
            for (var i = 0; i < state.queue.length; i++) {
                if (state.queue[i].id === current.id) {
                    state.queueIndex = i;
                    break;
                }
            }
        }
    }

    function toggleRepeat() {
        if (state.repeat === 'none') {
            state.repeat = 'all';
        } else if (state.repeat === 'all') {
            state.repeat = 'one';
        } else {
            state.repeat = 'none';
        }
        _safeLocalSet('sonance_repeat', state.repeat);
        _resetPreparedTrack();
        _emit('repeatchange', state.repeat);
        log('Player', 'Repeat: ' + state.repeat);
    }

    function getState() {
        return {
            currentTrack: state.currentTrack,
            queue: state.queue,
            originalQueue: state.originalQueue,
            queueIndex: state.queueIndex,
            isPlaying: state.isPlaying,
            currentTime: state.currentTime,
            duration: state.duration,
            volume: state.volume,
            shuffle: state.shuffle,
            repeat: state.repeat,
            buffering: state.buffering
        };
    }

    function getActiveAudioElement() {
        if (!IS_TIZEN && _audio) return _audio;
        return null;
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= state.queue.length) return;

        // Don't remove currently playing track
        if (index === state.queueIndex) return;

        state.queue.splice(index, 1);

        // Adjust queueIndex if needed
        if (index < state.queueIndex) {
            state.queueIndex--;
        }

        _resetPreparedTrack();
        _emit('queuechange');
    }

    function jumpToQueueIndex(index) {
        if (index < 0 || index >= state.queue.length) return;
        _resetPreparedTrack();
        _consecutiveLoadFailures = 0;   // V3.9 S4 T3: fresh user decision
        state.queueIndex = index;
        state.currentTrack = state.queue[index];
        _userInitiated = true;
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
    }

    /**
     * v3.10 A8: put a saved queue back without playing it. The queue, the
     * current track and its position are restored and announced
     * (trackchange, queuechange, progress, pause), so the NP bar shows the
     * track paused; nothing is opened on the backend (no AVPlay open) and
     * Now Playing is not opened ('userplay' is not emitted). The first play()
     * loads the track and seeks to the position.
     * `tracks` is the saved play order — the shuffled order if shuffle was on;
     * the order before shuffling was not saved, so it doubles as the
     * original order.
     */
    function restoreQueue(tracks, index, positionMs) {
        if (!tracks || !tracks.length) return;
        index = Math.max(0, Math.min(index || 0, tracks.length - 1));
        _resetPreparedTrack();
        _pendingSeek = null;
        _cancelSeekReload();
        state.queue = tracks.slice();
        state.originalQueue = tracks.slice();
        state.queueIndex = index;
        state.currentTrack = state.queue[index];
        state.isPlaying = false;
        state.buffering = false;
        state.duration = state.currentTrack.duration || 0;
        var at = Math.max(0, (positionMs || 0) / 1000);
        if (state.duration > 0) at = Math.min(at, state.duration);
        state.currentTime = at;
        _cuedAtSec = at;
        // Past the scrobble threshold it was scrobbled when it was saved.
        _scrobbleTrackId = state.currentTrack.id;
        _scrobbled = state.duration > 0 && at >= Math.min(state.duration * 0.5, 240);
        _lastProgressEmit = 0;
        _emit('trackchange', state.currentTrack);
        _emit('queuechange');
        _emitProgress(true);
        _emit('pause');
        log('Player', 'Restored queue: ' + state.queue.length + ' tracks, at ' + index + ', ' + Math.round(at) + ' s');
    }

    // v3.10 A7: the sleep timer's "End of track" (see _stopAtEnd).
    function setStopAtTrackEnd(on) {
        _stopAtTrackEnd = !!on;
    }

    // Legacy API compatibility (from S4)
    function setQueue(tracks, startIndex) {
        playAlbum(tracks, startIndex);
    }

    function shuffleQueue(tracks) {
        if (!tracks || tracks.length === 0) return;
        _resetPreparedTrack();
        state.originalQueue = tracks.slice();
        var shuffled = tracks.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }
        state.shuffle = true;
        _safeLocalSet('sonance_shuffle', 'true');
        state.queue = shuffled;
        state.queueIndex = 0;
        state.currentTrack = shuffled[0];
        _userInitiated = true;
        _loadAndPlay(state.currentTrack);
        _emit('shufflechange', true);
        _emit('queuechange');
        log('Player', 'Shuffle play: ' + shuffled.length + ' tracks');
    }

    return {
        init: init,
        getState: getState,
        getActiveAudioElement: getActiveAudioElement,
        IS_TIZEN: IS_TIZEN,
        // Event system
        on: on,
        off: off,
        listenerCount: listenerCount,
        // Playback control
        playAlbum: playAlbum,
        playTrack: playTrack,
        play: play,
        pause: pause,
        stop: stop,
        togglePlayPause: togglePlayPause,
        next: next,
        previous: previous,
        seekTo: seekTo,
        seekPercent: seekPercent,
        setVolume: setVolume,
        // Queue management
        addToQueue: addToQueue,
        addToQueueNext: addToQueueNext,
        removeFromQueue: removeFromQueue,
        clearQueue: clearQueue,
        jumpToQueueIndex: jumpToQueueIndex,
        restoreQueue: restoreQueue,
        setStopAtTrackEnd: setStopAtTrackEnd,
        // Modes
        toggleShuffle: toggleShuffle,
        toggleRepeat: toggleRepeat,
        // Legacy API (S4 compatibility)
        setQueue: setQueue,
        shuffleQueue: shuffleQueue
    };
})();

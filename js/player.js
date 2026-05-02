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

    console.log('[Sonance][Player] Platform: ' + (IS_TIZEN ? 'Tizen (AVPlay)' : 'Browser (HTML5 Audio)'));

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

    // --- Pre-prepared next track (gapless) ---
    var _nextPreparedUrl = null;
    var _nextPreparedTrack = null;
    var _nextPreparedIndex = -1;

    // User-initiated playback flag — set true by public methods that represent
    // the user starting a fresh play (album, track, queue jump, shuffle).
    // Consumed by _loadAndPlay to emit 'userplay' for auto-navigation. Not set
    // on next/previous, resume, or gapless auto-advance.
    var _userInitiated = false;

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
            state.currentTime = el.currentTime;
            state.duration = el.duration || 0;

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
                        _nextPreparedUrl = api.getStreamUrl(nextInfo.track.id);
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
            state.duration = el.duration || 0;
            _emitProgress(true);
        };

        el._onEnded = function() {
            if (_preloadReady && _preloadAudio && _nextPreparedTrack) {
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
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Playback error: format not supported');
            }
            next();
        };

        el._onWaiting = function() {
            state.buffering = true;
            _emit('buffering', true);
        };

        el._onCanPlay = function() {
            state.buffering = false;
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
        state.duration = _audio.duration || (track.duration || 0);
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
                    state.currentTime = ms / 1000;

                    // Pre-prepare next track 5 seconds before end — runs BEFORE
                    // the progress throttle so the boundary frame is never skipped.
                    if (state.duration > 10 &&
                        state.currentTime > state.duration - 5 &&
                        !_nextPreparedUrl) {
                        var nextInfo = _determineNextTrack();
                        if (nextInfo) {
                            var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
                            if (api) {
                                _nextPreparedUrl = api.getStreamUrl(nextInfo.track.id);
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
                    log('Player', 'Stream completed');
                    if (_nextPreparedUrl && _nextPreparedTrack) {
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
                    state.buffering = true;
                    _emit('buffering', true);
                },
                onbufferingcomplete: function() {
                    state.buffering = false;
                    _emit('buffering', false);
                },
                onerror: function(err) {
                    error('Player', 'AVPlay error: ' + err);
                    if (typeof App !== 'undefined' && App.showToast) {
                        App.showToast('Playback error: format not supported');
                    }
                    next();
                },
                onevent: function(eventType, eventData) {
                    log('Player', 'AVPlay event: ' + eventType);
                },
                onsubtitlechange: function() {}
            });

            avplay.prepareAsync(
                function() {
                    // Success
                    try {
                        state.duration = avplay.getDuration() / 1000;
                    } catch (e) {
                        state.duration = state.currentTrack ? (state.currentTrack.duration || 0) : 0;
                    }
                    avplay.play();
                    state.isPlaying = true;
                    _suppressScreenSaver(true);
                    _emit('play');
                    _emitProgress(true);
                    log('Player', 'AVPlay playing');
                },
                function(err) {
                    error('Player', 'AVPlay prepare failed: ' + err);
                    next();
                }
            );
        } catch (e) {
            error('Player', 'AVPlay exception: ' + e.message);
            next();
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

        var streamUrl = precomputedUrl;
        if (!streamUrl) {
            var api = (typeof AuthManager !== 'undefined') ? AuthManager.getApi() : null;
            if (!api) {
                error('Player', 'No API instance available');
                return;
            }
            var streamParams = null;
            if (track.suffix === 'opus' || (track.contentType && track.contentType.indexOf('opus') !== -1)) {
                streamParams = { format: 'mp3' };
                log('Player', 'Opus detected, requesting MP3 transcode');
            }
            streamUrl = api.getStreamUrl(track.id, streamParams);
        }

        log('Player', 'Loading: ' + (track.title || 'Unknown') + ' by ' + (track.artist || 'Unknown'));

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

    function _onTrackEnded() {
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
        _resetPreparedTrack();
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
        // If we've pre-prepared the next track, a seek may move us out of the
        // trigger window — reset so the logic can re-decide when the new
        // playhead crosses the threshold.
        if (_nextPreparedUrl || _preloadReady) {
            _resetPreparedTrack();
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
        state.queueIndex = index;
        state.currentTrack = state.queue[index];
        _userInitiated = true;
        _loadAndPlay(state.currentTrack);
        _emit('queuechange');
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
        // Modes
        toggleShuffle: toggleShuffle,
        toggleRepeat: toggleRepeat,
        // Legacy API (S4 compatibility)
        setQueue: setQueue,
        shuffleQueue: shuffleQueue
    };
})();

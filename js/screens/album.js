/* ============================================
   Sonance — Album Detail Screen
   Split-pane: fixed left (art/metadata/buttons)
                scrollable right (tracklist)
   ============================================ */

var AlbumScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var rem = SonanceUtils.rem;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _albumData = null;
    var _albumId = null;
    var _active = false;
    // V3.7-fix3: ref to the row currently flagged as playing, so trackchange
    // can mutate just two rows instead of rebuilding the whole tracklist.
    var _currentPlayingRow = null;

    // Refresh a single star button (album or track) to match current cache state.
    function _refreshStar(btn, filled) {
        if (!btn) return;
        btn.textContent = '';
        var icon = createStarSvg(filled);
        var size = parseFloat(btn.getAttribute('data-star-size') || '20');
        icon.style.width = rem(size);
        icon.style.height = rem(size);
        btn.appendChild(icon);
        if (filled) {
            btn.classList.add('is-starred');
        } else {
            btn.classList.remove('is-starred');
        }
    }

    // =========================================
    //  Manual scroll-into-view (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
        if (!container || !element) return;
        var trackTop = element.offsetTop;
        var trackBottom = trackTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (trackBottom > viewBottom) {
            container.scrollTop = trackBottom - container.clientHeight + SonanceUtils.px(20);
        } else if (trackTop < viewTop) {
            container.scrollTop = trackTop - SonanceUtils.px(20);
        }
    }

    // =========================================
    //  Render (loading skeleton)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'album-detail' });

        // Body
        var body = el('div', { className: 'album-detail-body' });

        // Left panel skeleton
        var left = el('div', { className: 'album-detail-left' });
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: rem(180), height: rem(180), borderRadius: rem(10), marginBottom: rem(20)
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: rem(180), height: rem(26), borderRadius: rem(6), marginBottom: rem(8)
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: rem(140), height: rem(18), borderRadius: rem(6), marginBottom: rem(8)
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: rem(180), height: rem(14), borderRadius: rem(6), marginBottom: rem(24)
        }}));
        body.appendChild(left);

        // Right panel skeleton
        var right = el('div', { className: 'album-detail-right' });
        right.appendChild(el('div', { className: 'skeleton', style: {
            width: rem(120), height: rem(14), borderRadius: rem(6), marginBottom: rem(16)
        }}));
        for (var i = 0; i < 8; i++) {
            right.appendChild(el('div', { className: 'skeleton', style: {
                width: '100%', height: rem(48), borderRadius: rem(8), marginBottom: rem(4)
            }}));
        }
        body.appendChild(right);

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        log('Album', 'Album detail rendered (loading)');
    }

    // =========================================
    //  Activate (fetch data)
    // =========================================

    // V3.7-fix3: incremental playing-indicator update.
    // Removes the indicator from the previously-playing row (if any) and
    // applies it to the row that matches songId. Rows not on this album
    // simply leave _currentPlayingRow null after the clear step.
    function _updatePlayingIndicator(songId) {
        if (!_container) return;

        if (_currentPlayingRow) {
            _currentPlayingRow.classList.remove('track-playing');
            var oldEq = _currentPlayingRow.querySelector('.track-row-eq');
            if (oldEq) {
                var idxAttr = _currentPlayingRow.getAttribute('data-track-index');
                var oldIdx = parseInt(idxAttr, 10);
                if (isNaN(oldIdx)) oldIdx = 0;
                var oldSong = (_albumData && _albumData.song) ? _albumData.song[oldIdx] : null;
                var trackNum = String((oldSong && oldSong.track) || (oldIdx + 1));
                var numEl = el('div', { className: 'track-row-number' }, trackNum);
                _currentPlayingRow.replaceChild(numEl, oldEq);
            }
            var oldTitle = _currentPlayingRow.querySelector('.track-row-title');
            if (oldTitle) oldTitle.classList.remove('track-title-playing');
            _currentPlayingRow = null;
        }

        if (!songId) return;

        var newRow = _container.querySelector(
            '#album-tracklist .track-row[data-song-id="' + songId + '"]'
        );
        if (!newRow) return; // playing track is not on this album

        newRow.classList.add('track-playing');
        var oldNum = newRow.querySelector('.track-row-number');
        if (oldNum) {
            var eqWrap = el('div', { className: 'track-row-eq' });
            for (var b = 0; b < 4; b++) {
                eqWrap.appendChild(el('div', { className: 'eq-bar' }));
            }
            newRow.replaceChild(eqWrap, oldNum);
        }
        var newTitle = newRow.querySelector('.track-row-title');
        if (newTitle) newTitle.classList.add('track-title-playing');
        _currentPlayingRow = newRow;
    }

    function _onTrackChange() {
        if (!_active || !_albumData) return;
        var current = Player.getState().currentTrack;
        _updatePlayingIndicator(current ? current.id : null);
    }

    function activate(params) {
        _active = true;
        _albumId = params && params.id;

        // Add album-active class to content area to prevent outer scroll
        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.add('album-active');

        if (!_albumId) {
            log('Album', 'No album ID provided');
            _renderError('No album specified.');
            return;
        }

        var api = App.getApi();
        if (!api) {
            _renderError('Not connected to server.');
            return;
        }

        // Listen for track changes to update playing indicator
        Player.on('trackchange', _onTrackChange);

        // v3.10 D88: Back can now arrive before the album does (no input
        // lock, D52). A response for an activation that has since ended
        // must not render or register zones under the next screen.
        var albumId = _albumId;
        api.getAlbum(_albumId).then(function(album) {
            if (!_active || _albumId !== albumId) return;
            if (!album) {
                _renderError('Album not found.');
                return;
            }
            _albumData = album;
            _renderAlbum(album, api);
            _registerFocusZones();
            log('Album', 'Album loaded: ' + (album.name || album.title) +
                ' (' + ((album.song && album.song.length) || 0) + ' tracks)');
        }).catch(function(err) {
            if (!_active || _albumId !== albumId) return;
            log('Album', 'Error loading album: ' + err.message);
            _renderError('Unable to load album.');
        });
    }

    // =========================================
    //  Render Album Detail (Split-Pane)
    // =========================================

    function _renderAlbum(album, api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'album-detail' });

        // --- BODY (split pane) ---
        var body = el('div', { className: 'album-detail-body' });

        // --- LEFT PANEL (fixed, no scroll) ---
        var leftPanel = el('div', { className: 'album-detail-left' });

        // Album art (180px)
        var artWrap = el('div', { className: 'album-detail-art' });
        artWrap.appendChild(SonanceComponents.renderAlbumArt(album, 180, api));
        leftPanel.appendChild(artWrap);

        // Title + star (star is focusable)
        var titleRow = el('div', { className: 'album-detail-title-row' });
        titleRow.appendChild(el('div', { className: 'album-detail-title' },
            album.name || album.title || 'Unknown Album'));

        var albumStarBtn = el('button', {
            className: 'album-star-btn focusable',
            'data-star-size': '20',
            'aria-label': 'Toggle favourite'
        });
        var albumStarred = StarredCache.isAlbumStarred(album.id);
        _refreshStar(albumStarBtn, albumStarred);
        albumStarBtn.addEventListener('click', function() {
            var api = App.getApi();
            if (!api) return;
            var nowStarred = StarredCache.toggleAlbum(album.id, api);
            _refreshStar(albumStarBtn, nowStarred);
            App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
        });
        titleRow.appendChild(albumStarBtn);
        leftPanel.appendChild(titleRow);

        // Artist (focusable when artistId is known — navigates to artist detail)
        var artistId = album.artistId || null;
        var artistEl;
        if (artistId) {
            artistEl = el('button', {
                className: 'album-detail-artist focusable',
                'data-artist-id': artistId
            }, album.artist || 'Unknown Artist');
            artistEl.addEventListener('click', function() {
                App.navigateTo('artist', { id: artistId }, 'zoom-in');
            });
        } else {
            artistEl = el('div', { className: 'album-detail-artist' },
                album.artist || 'Unknown Artist');
        }
        leftPanel.appendChild(artistEl);

        // Metadata: year · track count · genre
        var metaParts = [];
        if (album.year) metaParts.push(String(album.year));
        var songCount = (album.song && album.song.length) || album.songCount || 0;
        metaParts.push(songCount + ' track' + (songCount !== 1 ? 's' : ''));
        if (album.genre) metaParts.push(album.genre);
        leftPanel.appendChild(el('div', { className: 'album-detail-meta' },
            metaParts.join(' \u00B7 ')));

        // Play button
        var playBtn = el('button', { className: 'album-play-btn focusable' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = rem(16);
        playIcon.style.height = rem(16);
        playIcon.style.fill = 'white';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play'));
        playBtn.addEventListener('click', function() {
            var tracks = album.song || [];
            if (tracks.length > 0) {
                Player.setQueue(tracks, 0);
                log('Album', 'Play: queued ' + tracks.length + ' tracks');
            }
        });
        leftPanel.appendChild(playBtn);

        // Shuffle button
        var shuffleBtn = el('button', { className: 'album-shuffle-btn focusable' });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = rem(16);
        shuffleIcon.style.height = rem(16);
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle'));
        shuffleBtn.addEventListener('click', function() {
            var tracks = album.song || [];
            if (tracks.length > 0) {
                Player.shuffleQueue(tracks);
                log('Album', 'Shuffle: queued ' + tracks.length + ' tracks (shuffled)');
            }
        });
        leftPanel.appendChild(shuffleBtn);

        body.appendChild(leftPanel);

        // --- RIGHT PANEL (scrollable tracklist) ---
        var rightPanel = el('div', { className: 'album-detail-right' });

        // TRACKLIST label
        rightPanel.appendChild(el('div', { className: 'album-tracklist-label' }, 'TRACKLIST'));

        // Total duration + track count summary
        var songs = album.song || [];
        var totalSeconds = 0;
        songs.forEach(function(s) { totalSeconds += (s.duration || 0); });
        if (totalSeconds > 0) {
            var totalMins = Math.floor(totalSeconds / 60);
            var durationText = songs.length + ' tracks \u00B7 ' + totalMins + ' min';
            rightPanel.appendChild(el('div', { className: 'album-tracklist-duration' }, durationText));
        }

        // Track list
        var trackList = el('div', { className: 'album-tracklist', id: 'album-tracklist' });
        var currentTrack = Player.getState().currentTrack;
        _currentPlayingRow = null;

        songs.forEach(function(song, index) {
            var isPlaying = currentTrack && currentTrack.id === song.id;

            var row = el('div', {
                className: 'track-row focusable' + (isPlaying ? ' track-playing' : ''),
                'data-track-index': String(index),
                'data-song-id': song.id
            });

            // Track number or equaliser bars
            if (isPlaying) {
                var eqWrap = el('div', { className: 'track-row-eq' });
                for (var b = 0; b < 4; b++) {
                    eqWrap.appendChild(el('div', { className: 'eq-bar' }));
                }
                row.appendChild(eqWrap);
            } else {
                row.appendChild(el('div', { className: 'track-row-number' },
                    String(song.track || (index + 1))));
            }

            // Title, with the track artist under it (v3.10 R5, D57)
            var info = el('div', { className: 'track-row-info' });
            info.appendChild(el('div', {
                className: 'track-row-title' + (isPlaying ? ' track-title-playing' : '')
            }, song.title || 'Unknown'));
            info.appendChild(el('div', { className: 'track-row-artist' },
                song.artist || 'Unknown artist'));
            row.appendChild(info);

            // Track star (visual only — toggled via Green button)
            var trackStar = el('div', {
                className: 'track-row-star',
                'data-star-size': '14',
                'data-song-id': song.id
            });
            _refreshStar(trackStar, StarredCache.isSongStarred(song.id));
            row.appendChild(trackStar);

            // Duration
            row.appendChild(el('div', { className: 'track-row-duration' },
                (song._formattedDuration || formatDuration(song.duration))));

            if (isPlaying) _currentPlayingRow = row;
            trackList.appendChild(row);
        });

        // V3.7-fix10: one delegated click handler for the whole tracklist.
        // Plays from the clicked track's index. V3.7-fix3 — Player.trackchange
        // fires _onTrackChange → _updatePlayingIndicator, so no full re-render
        // and no focus-zone re-registration is needed.
        trackList.addEventListener('click', function(ev) {
            var r = ev.target.closest('.track-row');
            if (!r) return;
            var idxStr = r.getAttribute('data-track-index');
            if (idxStr === null) return;
            var idx = parseInt(idxStr, 10);
            if (isNaN(idx) || !songs[idx]) return;
            Player.setQueue(songs, idx);
            log('Album', 'Play track ' + (idx + 1) + ': ' + songs[idx].title);
        });

        rightPanel.appendChild(trackList);
        body.appendChild(rightPanel);
        wrapper.appendChild(body);

        _container.appendChild(wrapper);
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var trackElements = document.querySelectorAll('#album-tracklist .focusable');
        var hasTracks = trackElements.length > 0;

        // Left panel: play, shuffle (vertical list)
        FocusManager.registerZone('content', {
            selector: '.album-detail-left .focusable',
            columns: 1,
            onActivate: function(idx, element) {
                // v3.10 D149: the artist link, Play and Shuffle lead to
                // another screen (Play and Shuffle through Auto Now Playing),
                // so record the focus first, as the track rows do (V3-6-fix
                // NAV-1): Back returns to the button, not the top nav. The
                // star stays on the page.
                if (!element.classList.contains('album-star-btn') &&
                        typeof App !== 'undefined' && App.saveCurrentFocus) {
                    App.saveCurrentFocus();
                }
                element.click();
            },
            // v3.10 D84 (D108): at 175-200 % the column is taller than the
            // page; it scrolls so the focused button is on screen.
            onFocus: function(idx, element) {
                SonanceUtils.revealInScroller(element, element.closest('.album-detail-left'), SonanceUtils.px(24));
            },
            onColourButton: function(colour, idx, element) {
                // Only play/shuffle buttons trigger album-level queue actions
                if (!element) return;
                var isPlayBtn = element.classList.contains('album-play-btn');
                var isShuffleBtn = element.classList.contains('album-shuffle-btn');
                if ((isPlayBtn || isShuffleBtn) && _albumData && _albumData.song) {
                    var tracks = _albumData.song;
                    if (tracks.length === 0) return;
                    if (colour === 'yellow') {
                        tracks.forEach(function(t) { Player.addToQueue(t); });
                        App.showToast('Album added to queue');
                    } else if (colour === 'blue') {
                        for (var i = tracks.length - 1; i >= 0; i--) {
                            Player.addToQueueNext(tracks[i]);
                        }
                        App.showToast('Album playing next');
                    }
                }
            },
            neighbors: {
                left: 'topnav',
                right: hasTracks ? 'album-tracks' : null,
                down: hasTracks ? 'album-tracks' : 'nowplaying-bar'
            }
        });

        // Track list with scroll-into-view
        if (hasTracks) {
            FocusManager.registerZone('album-tracks', {
                selector: '#album-tracklist .focusable',
                columns: 1,
                onActivate: function(idx, element) {
                    // V3-6-fix NAV-1: snapshot album-tracks focus before the
                    // track-click triggers playback / auto-NP, so Back from
                    // NP restores the focused row.
                    if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                        App.saveCurrentFocus();
                    }
                    element.click();
                },
                onFocus: function(idx, element) {
                    // Scroll focused track into view within the right panel
                    var container = document.querySelector('.album-detail-right');
                    _scrollToFocused(container, element);
                },
                // v3.10 A5: hold OK for the options sheet; its Favourite
                // updates this row's star as the green button does.
                onLongPress: function(idx) {
                    var track = _albumData && _albumData.song && _albumData.song[idx];
                    if (!track) return;
                    OptionsSheet.open({
                        song: track,
                        onStar: function(nowStarred) {
                            _refreshStar(document.querySelector(
                                '#album-tracklist .track-row[data-song-id="' + track.id + '"] .track-row-star'), nowStarred);
                        }
                    });
                },
                onColourButton: function(colour, idx) {
                    if (!_albumData || !_albumData.song) return;
                    var track = _albumData.song[idx];
                    if (!track) return;
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    } else if (colour === 'green') {
                        var api = App.getApi();
                        if (!api) return;
                        var nowStarred = StarredCache.toggleSong(track.id, api);
                        // Update the star icon inline without a full re-render
                        var rowEl = document.querySelector(
                            '#album-tracklist .track-row[data-song-id="' + track.id + '"] .track-row-star');
                        _refreshStar(rowEl, nowStarred);
                        App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
                    }
                },
                neighbors: {
                    left: 'content',
                    up: 'topnav',
                    down: 'nowplaying-bar'
                }
            });
        }

        // NP bar
        App.registerNowPlayingBarZone(hasTracks ? 'album-tracks' : 'content');

        // Show colour button hints
        App.showColourHints([
            { colour: 'green', label: '★ Favourite' },
            { colour: 'yellow', label: 'Add to queue' },
            { colour: 'blue', label: 'Play next' }
        ]);

        // V3-6-fix3 NAV-3: focus the first track row, not the left action panel.
        // Falls back to 'content' (Play button) when the album has no tracks.
        FocusManager.setActiveZone(hasTracks ? 'album-tracks' : 'content', 0);
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError(message) {
        if (!_container) return;
        _container.textContent = '';
        var wrapper = el('div', { className: 'album-detail' });

        // Error message
        var errorDiv = el('div', { className: 'album-detail-error' });
        errorDiv.appendChild(el('div', { className: 'home-empty' }, message || 'Unable to load album.'));
        wrapper.appendChild(errorDiv);

        _container.appendChild(wrapper);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;
        Player.off('trackchange', _onTrackChange);

        // Remove album-active class from content area
        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.remove('album-active');

        _container = null;
        _albumData = null;
        _albumId = null;
        _currentPlayingRow = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();

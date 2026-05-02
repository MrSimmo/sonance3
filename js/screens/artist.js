/* ============================================
   Sonance — Artist Detail Screen
   Split-pane: fixed left (photo/name/buttons)
                scrollable right (discography,
                biography, similar artists)
   ============================================ */

var ArtistScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var MAX_PLAY_ALL_ALBUMS = 10;

    var _container = null;
    var _artistId = null;
    var _artistData = null;
    var _artistInfo = null;
    var _active = false;
    var _loadingPlayAll = false;
    var _stage3Raf = null; // V3-6-fix2 PERF-6: rAF id for deferred discography
    var _topSongs = null;

    // =========================================
    //  Manual scroll-into-view (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
        if (!container || !element) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + 20;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 20;
        }
    }

    // =========================================
    //  Render (loading skeleton)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'artist-detail' });

        // Body
        var body = el('div', { className: 'artist-detail-body' });

        // Left skeleton
        var left = el('div', { className: 'artist-detail-left' });
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '200px', height: '200px', borderRadius: '50%', marginBottom: '20px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '180px', height: '26px', borderRadius: '6px', marginBottom: '8px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '120px', height: '16px', borderRadius: '6px', marginBottom: '24px'
        }}));
        body.appendChild(left);

        // Right skeleton
        var right = el('div', { className: 'artist-detail-right' });
        right.appendChild(el('div', { className: 'skeleton', style: {
            width: '120px', height: '14px', borderRadius: '6px', marginBottom: '16px'
        }}));
        for (var i = 0; i < 6; i++) {
            right.appendChild(el('div', { className: 'skeleton', style: {
                width: '100%', height: '80px', borderRadius: '8px', marginBottom: '12px'
            }}));
        }
        body.appendChild(right);

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        log('Artist', 'Artist detail rendered (loading)');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;
        _artistId = params && params.id;

        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.add('album-active');

        if (!_artistId) {
            log('Artist', 'No artist ID provided');
            _renderError('No artist specified.');
            return;
        }

        var api = App.getApi();
        if (!api) {
            _renderError('Not connected to server.');
            return;
        }

        // V3-6-fix2 PERF-6: progressive render. Kick off both fetches in
        // parallel; render in stages as data arrives so the user sees the
        // hero + Play button before the full discography is built.
        var infoPromise = api.getArtistInfo2(_artistId).catch(function(err) {
            log('Artist', 'getArtistInfo2 failed: ' + err.message);
            return null;
        });

        api.getArtist(_artistId).then(function(artist) {
            if (!_active) return;
            if (!artist) { _renderError('Artist not found.'); return; }
            _artistData = artist;

            // V3.9: fetch top songs in parallel with info
            var topSongsPromise = api.getTopSongs(artist.name, 10).catch(function(err) {
                log('Artist', 'getTopSongs failed: ' + err.message);
                return [];
            });

            // STAGE 1 — hero + name + action buttons + stub containers.
            _renderStage1(artist, api);
            _registerLeftPanelZone(true);

            // STAGE 3 — discography deferred to next frame so the hero
            // paints first. Once mounted we re-register zones (without
            // stealing focus) so artist-albums becomes navigable.
            if (_stage3Raf !== null) cancelAnimationFrame(_stage3Raf);
            _stage3Raf = requestAnimationFrame(function() {
                _stage3Raf = null;
                if (!_active) return;
                _renderStage3Discography(artist, api);
                _registerArtistContentZones(false);
                // V3-6-fix3 NAV-3: focus the top of the discography list
                // instead of the left action panel. NAV-1 snapshot restore
                // (async poll @50ms) still overrides to the saved index when
                // the user is backing in from album detail.
                var firstAlbum = _container && _container.querySelector('#artist-albums-list .focusable');
                if (firstAlbum && FocusManager.getActiveZone() !== 'artist-albums') {
                    FocusManager.setActiveZone('artist-albums', 0, true);
                }
            });

            // STAGE 2 — bio + similar. Fills in once getArtistInfo2
            // resolves; never steals focus.
            infoPromise.then(function(info) {
                if (!_active) return;
                _artistInfo = info;
                _renderStage2BioAndSimilar(artist, info, api);
                _registerArtistContentZones(false);
            });

            // STAGE 4 — popular songs (V3.9). Renders once getTopSongs
            // resolves; appends below discography.
            topSongsPromise.then(function(songs) {
                if (!_active) return;
                _topSongs = songs;
                _renderStage4TopSongs(artist, api);
                _registerArtistContentZones(false);
            });

            log('Artist', 'Stage 1 rendered: ' + (artist.name || 'Unknown') +
                ' (' + ((artist.album && artist.album.length) || 0) + ' albums)');
        }).catch(function(err) {
            log('Artist', 'Error loading artist: ' + err.message);
            _renderError('Unable to load artist.');
        });
    }

    // =========================================
    //  Render Artist Detail
    // =========================================

    // V3-6-fix2 PERF-6: STAGE 1 — hero, name, count, action buttons, and
    // stub containers for the right-panel sections (discography / bio /
    // similar). The stubs keep the page layout stable so subsequent stages
    // can fill them in place without reflowing the focused button.
    function _renderStage1(artist, api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'artist-detail' });
        var body = el('div', { className: 'artist-detail-body' });

        // --- LEFT PANEL ---
        var leftPanel = el('div', { className: 'artist-detail-left' });

        // Artist photo (Last.fm hero — Stage 1 already has artist with no
        // info yet, so this falls back to the Subsonic avatar. When
        // info arrives in Stage 2 we swap the photo in place).
        var photoWrap = _renderArtistPhoto(artist, null, api);
        photoWrap.id = 'artist-photo-wrap';
        leftPanel.appendChild(photoWrap);

        leftPanel.appendChild(el('div', { className: 'artist-detail-name' },
            artist.name || 'Unknown Artist'));

        var albumCount = (artist.album && artist.album.length) || artist.albumCount || 0;
        leftPanel.appendChild(el('div', { className: 'artist-detail-count' },
            albumCount + ' album' + (albumCount !== 1 ? 's' : '')));

        var playBtn = el('button', {
            className: 'artist-play-btn focusable',
            id: 'artist-play-all-btn'
        });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '16px';
        playIcon.style.height = '16px';
        playIcon.style.fill = 'white';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play All'));
        playBtn.addEventListener('click', function() {
            _playAllAlbums(artist, api, false);
        });
        leftPanel.appendChild(playBtn);

        var shuffleBtn = el('button', {
            className: 'artist-shuffle-btn focusable',
            id: 'artist-shuffle-all-btn'
        });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = '16px';
        shuffleIcon.style.height = '16px';
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle All'));
        shuffleBtn.addEventListener('click', function() {
            _playAllAlbums(artist, api, true);
        });
        leftPanel.appendChild(shuffleBtn);

        body.appendChild(leftPanel);

        // --- RIGHT PANEL — stubs for stages 2 & 3 ---
        var rightPanel = el('div', { className: 'artist-detail-right' });
        rightPanel.appendChild(el('div', { id: 'artist-discography-stub' }));
        rightPanel.appendChild(el('div', { id: 'artist-top-songs-stub' }));
        rightPanel.appendChild(el('div', { id: 'artist-bio-stub' }));
        rightPanel.appendChild(el('div', { id: 'artist-similar-stub' }));

        body.appendChild(rightPanel);
        wrapper.appendChild(body);

        _container.appendChild(wrapper);
    }

    function _renderStage2BioAndSimilar(artist, info, api) {
        if (!_container) return;

        // Re-render hero photo if Last.fm provided one (swap in place).
        if (info) {
            var imageUrl = info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl || null;
            if (imageUrl) {
                var oldWrap = _container.querySelector('#artist-photo-wrap');
                if (oldWrap && oldWrap.parentNode) {
                    var newWrap = _renderArtistPhoto(artist, info, api);
                    newWrap.id = 'artist-photo-wrap';
                    oldWrap.parentNode.replaceChild(newWrap, oldWrap);
                }
            }
        }

        var bioStub = _container.querySelector('#artist-bio-stub');
        if (bioStub) {
            bioStub.textContent = '';
            var bio = _renderBiography(info);
            if (bio) bioStub.appendChild(bio);
        }

        var similarStub = _container.querySelector('#artist-similar-stub');
        if (similarStub) {
            similarStub.textContent = '';
            var similar = _renderSimilarArtists(info, api);
            if (similar) similarStub.appendChild(similar);
        }
    }

    function _renderStage3Discography(artist, api) {
        if (!_container) return;
        var stub = _container.querySelector('#artist-discography-stub');
        if (!stub) return;
        stub.textContent = '';
        stub.appendChild(_renderDiscography(artist, api));
    }

    function _renderStage4TopSongs(artist, api) {
        if (!_container || !_topSongs || !_topSongs.length) return;
        var stub = _container.querySelector('#artist-top-songs-stub');
        if (!stub) return;
        stub.textContent = '';
        stub.appendChild(_renderPopularSongs(artist, api));
    }

    // --- Artist photo (200px circle) ---
    function _renderArtistPhoto(artist, info, api) {
        var photo = el('div', { className: 'artist-detail-photo' });

        var imageUrl = null;
        if (info) {
            imageUrl = info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl || null;
        }

        if (imageUrl) {
            var img = document.createElement('img');
            img.setAttribute('alt', (artist.name || 'Artist') + ' photo');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.style.display = 'block';
            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
                photo.appendChild(SonanceComponents.renderArtistAvatar(artist, 200, api));
            };
            // V3-6-fix2 PERF-5: route through ImageCache.getByUrl so
            // returning to a previously-viewed artist hits the cache and the
            // hero photo paints immediately (no re-fetch).
            var cached = (typeof ImageCache !== 'undefined' && ImageCache.getByUrl)
                ? ImageCache.getByUrl(imageUrl, function(url) {
                    if (img && img.parentNode) img.src = url;
                })
                : null;
            if (cached) {
                img.src = cached;
            } else if (typeof ImageCache === 'undefined' || !ImageCache.getByUrl) {
                img.src = imageUrl;
            }
            photo.appendChild(img);
        } else {
            // Fallback to Subsonic cover-art avatar (same as Library artists tab)
            photo.appendChild(SonanceComponents.renderArtistAvatar(artist, 200, api));
        }

        return photo;
    }

    // --- Discography section ---
    function _renderDiscography(artist, api) {
        var section = el('div', { className: 'artist-section' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'DISCOGRAPHY'));

        var albums = (artist.album || []);

        if (albums.length === 0) {
            section.appendChild(el('div', { className: 'artist-section-empty' },
                'No albums available.'));
            return section;
        }

        var list = el('div', { className: 'artist-albums-list', id: 'artist-albums-list' });

        albums.forEach(function(album) {
            var row = el('div', {
                className: 'artist-album-row focusable',
                'data-album-id': album.id
            });

            // Album art (80px)
            var artWrap = el('div', { className: 'artist-album-art' });
            artWrap.appendChild(SonanceComponents.renderAlbumArt(album, 80, api));
            row.appendChild(artWrap);

            // Info
            var info = el('div', { className: 'artist-album-info' });
            info.appendChild(el('div', { className: 'artist-album-title' },
                album.name || album.title || 'Unknown Album'));

            var metaParts = [];
            if (album.year) metaParts.push(String(album.year));
            var songCount = album.songCount || 0;
            if (songCount) metaParts.push(songCount + ' track' + (songCount !== 1 ? 's' : ''));
            info.appendChild(el('div', { className: 'artist-album-meta' },
                metaParts.join(' · ')));

            row.appendChild(info);

            row.addEventListener('click', function() {
                App.navigateTo('album', { id: album.id, title: album.name || album.title }, 'zoom-in');
            });

            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    function _renderPopularSongs(artist, api) {
        var songs = _topSongs || [];
        if (!songs.length) return null;

        var section = el('div', { className: 'artist-section' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'POPULAR'));

        var list = el('div', { className: 'artist-top-songs-list', id: 'artist-top-songs-list' });

        songs.forEach(function(song, index) {
            var row = el('div', {
                className: 'track-row focusable',
                'data-song-index': String(index),
                'data-song-id': song.id
            });

            row.appendChild(el('div', { className: 'track-row-number' },
                String(index + 1)));

            row.appendChild(el('div', { className: 'track-row-title' },
                song.title || 'Unknown'));

            var trackStar = el('div', {
                className: 'track-row-star',
                'data-star-size': '14',
                'data-song-id': song.id
            });
            var isStarred = (typeof StarredCache !== 'undefined' &&
                StarredCache.isSongStarred && StarredCache.isSongStarred(song.id));
            var starIcon = createStarSvg(isStarred);
            starIcon.style.width = '14px';
            starIcon.style.height = '14px';
            trackStar.appendChild(starIcon);
            if (isStarred) trackStar.classList.add('is-starred');
            row.appendChild(trackStar);

            row.appendChild(el('div', { className: 'track-row-duration' },
                (song._formattedDuration || SonanceUtils.formatDuration(song.duration))));

            list.appendChild(row);
        });

        // Delegated click handler for the whole list
        list.addEventListener('click', function(ev) {
            var r = ev.target.closest('.track-row');
            if (!r) return;
            var idxStr = r.getAttribute('data-song-index');
            if (idxStr === null) return;
            var idx = parseInt(idxStr, 10);
            if (isNaN(idx) || !songs[idx]) return;
            Player.setQueue(songs, idx);
            log('Artist', 'Play popular track ' + (idx + 1) + ': ' + songs[idx].title);
        });

        section.appendChild(list);
        return section;
    }

    // --- Biography section ---
    function _renderBiography(info) {
        if (!info) return null;
        var bio = info.biography;
        if (!bio || typeof bio !== 'string') return null;
        // Strip any HTML tags the Subsonic server may include
        bio = bio.replace(/<[^>]*>/g, '').trim();
        if (!bio) return null;

        var section = el('div', { className: 'artist-section artist-section-bio' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'BIOGRAPHY'));

        var text = bio;
        if (text.length > 500) {
            text = text.slice(0, 500).replace(/\s+\S*$/, '') + '…';
        }
        section.appendChild(el('div', { className: 'artist-bio-text' }, text));
        return section;
    }

    // --- Similar Artists section ---
    function _renderSimilarArtists(info, api) {
        if (!info) return null;
        var similar = info.similarArtist || [];
        if (!similar.length) return null;

        var section = el('div', { className: 'artist-section artist-section-similar' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'SIMILAR ARTISTS'));

        var row = el('div', { className: 'artist-similar-row', id: 'artist-similar-row' });

        similar.forEach(function(sim) {
            // Some entries from Last.fm may have no id (unknown to the library) — skip those.
            if (!sim || !sim.id) return;

            var card = el('div', {
                className: 'artist-similar-card focusable',
                'data-artist-id': sim.id
            });

            var avatarWrap = el('div', { className: 'artist-similar-avatar' });
            avatarWrap.appendChild(SonanceComponents.renderArtistAvatar(sim, 80, api));
            card.appendChild(avatarWrap);

            card.appendChild(el('div', { className: 'artist-similar-name' },
                sim.name || 'Unknown'));

            card.addEventListener('click', function() {
                App.navigateTo('artist', { id: sim.id }, 'zoom-in');
            });

            row.appendChild(card);
        });

        if (!row.childNodes.length) return null;

        section.appendChild(row);
        return section;
    }

    // =========================================
    //  Play All / Shuffle All
    // =========================================

    function _setPlayAllLoading(isLoading) {
        var playBtn = _container && _container.querySelector('#artist-play-all-btn');
        var shuffleBtn = _container && _container.querySelector('#artist-shuffle-all-btn');
        if (isLoading) {
            if (playBtn) { playBtn.textContent = 'Loading...'; playBtn.disabled = true; }
            if (shuffleBtn) { shuffleBtn.textContent = 'Loading...'; shuffleBtn.disabled = true; }
        } else {
            // Restore labels by re-rendering the left panel buttons in place
            if (playBtn) {
                playBtn.disabled = false;
                playBtn.textContent = '';
                var pi = createSvg(SVG_PATHS.play);
                pi.style.width = '16px'; pi.style.height = '16px';
                pi.style.fill = 'white'; pi.style.flexShrink = '0';
                playBtn.appendChild(pi);
                playBtn.appendChild(document.createTextNode(' Play All'));
            }
            if (shuffleBtn) {
                shuffleBtn.disabled = false;
                shuffleBtn.textContent = '';
                var si = createSvg(SVG_PATHS.shuffle);
                si.style.width = '16px'; si.style.height = '16px';
                si.style.fill = 'currentColor'; si.style.flexShrink = '0';
                shuffleBtn.appendChild(si);
                shuffleBtn.appendChild(document.createTextNode(' Shuffle All'));
            }
        }
    }

    function _playAllAlbums(artist, api, shuffle) {
        if (_loadingPlayAll) return;
        var albums = (artist.album || []);
        if (albums.length === 0) {
            App.showToast('No albums to play');
            return;
        }

        var totalAlbums = albums.length;
        var toFetch = albums.slice(0, MAX_PLAY_ALL_ALBUMS);
        if (totalAlbums > MAX_PLAY_ALL_ALBUMS) {
            App.showToast('Playing first ' + MAX_PLAY_ALL_ALBUMS + ' albums');
        }

        _loadingPlayAll = true;
        _setPlayAllLoading(true);

        var promises = toFetch.map(function(album) {
            return api.getAlbum(album.id).catch(function(err) {
                log('Artist', 'getAlbum failed for ' + album.id + ': ' + err.message);
                return null;
            });
        });

        Promise.all(promises).then(function(fullAlbums) {
            _loadingPlayAll = false;
            _setPlayAllLoading(false);

            var allTracks = [];
            fullAlbums.forEach(function(a) {
                if (a && a.song && a.song.length) {
                    for (var i = 0; i < a.song.length; i++) {
                        allTracks.push(a.song[i]);
                    }
                }
            });

            if (allTracks.length === 0) {
                App.showToast('No tracks available');
                return;
            }

            if (shuffle) {
                Player.shuffleQueue(allTracks);
                log('Artist', 'Shuffle All: queued ' + allTracks.length + ' tracks');
            } else {
                Player.playAlbum(allTracks, 0);
                log('Artist', 'Play All: queued ' + allTracks.length + ' tracks');
            }
        }).catch(function(err) {
            _loadingPlayAll = false;
            _setPlayAllLoading(false);
            log('Artist', 'Play All failed: ' + err.message);
            App.showToast('Unable to load tracks');
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    // V3-6-fix2 PERF-6: focus-zone registration is split so Stage 1 can
    // hand focus to Play immediately, and later stages can register the
    // additional zones (discography, similar) without stealing focus.

    function _registerLeftPanelZone(setInitialFocus) {
        // Stage 1 — left panel only. Right-panel neighbours dangle: when
        // a stage 2/3 zone arrives we re-register with the correct
        // pointers, but we never reset focus.
        FocusManager.registerZone('content', {
            selector: '.artist-detail-left .focusable',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'topnav',
                right: null,  // filled in by _registerArtistContentZones once stage 3 mounts
                down: 'nowplaying-bar'
            }
        });

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'content',
                left: 'topnav'
            }
        });

        App.hideColourHints();

        if (setInitialFocus) {
            // Land focus on Play All as soon as Stage 1 paints. Subsequent
            // stages MUST NOT steal it, so they pass setInitialFocus=false.
            FocusManager.setActiveZone('content', 0);
        }
    }

    function _registerArtistContentZones(setInitialFocus) {
        var albumElements = _container ? _container.querySelectorAll('#artist-albums-list .focusable') : [];
        var topTrackElements = _container ? _container.querySelectorAll('#artist-top-songs-list .focusable') : [];
        var similarElements = _container ? _container.querySelectorAll('#artist-similar-row .focusable') : [];
        var hasAlbums = albumElements.length > 0;
        var hasTopSongs = topTrackElements.length > 0;
        var hasSimilar = similarElements.length > 0;

        // Re-register left panel with correct neighbours now that we know
        // which right-panel zones exist.
        FocusManager.registerZone('content', {
            selector: '.artist-detail-left .focusable',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'topnav',
                right: hasAlbums ? 'artist-albums' : (hasTopSongs ? 'artist-top-tracks' : (hasSimilar ? 'artist-similar' : null)),
                down: hasAlbums ? 'artist-albums' : (hasTopSongs ? 'artist-top-tracks' : (hasSimilar ? 'artist-similar' : 'nowplaying-bar'))
            }
        });

        if (hasAlbums) {
            FocusManager.registerZone('artist-albums', {
                selector: '#artist-albums-list .focusable',
                columns: 1,
                onActivate: function(idx, element) {
                    if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                        App.saveCurrentFocus();
                    }
                    element.click();
                },
                onFocus: function(idx, element) {
                    var container = _container && _container.querySelector('.artist-detail-right');
                    _scrollToFocused(container, element);
                },
                neighbors: {
                    left: 'content',
                    up: 'topnav',
                    down: hasTopSongs ? 'artist-top-tracks' : (hasSimilar ? 'artist-similar' : 'nowplaying-bar')
                }
            });
        }

        if (hasTopSongs) {
            FocusManager.registerZone('artist-top-tracks', {
                selector: '#artist-top-songs-list .focusable',
                columns: 1,
                onActivate: function(idx, element) {
                    if (typeof App !== 'undefined' && App.saveCurrentFocus) {
                        App.saveCurrentFocus();
                    }
                    element.click();
                },
                onFocus: function(idx, element) {
                    var container = _container && _container.querySelector('.artist-detail-right');
                    _scrollToFocused(container, element);
                },
                neighbors: {
                    left: 'content',
                    up: hasAlbums ? 'artist-albums' : 'topnav',
                    down: hasSimilar ? 'artist-similar' : 'nowplaying-bar'
                }
            });
        }

        if (hasSimilar) {
            FocusManager.registerZone('artist-similar', {
                selector: '#artist-similar-row .focusable',
                columns: similarElements.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) {
                    var container = _container && _container.querySelector('.artist-detail-right');
                    _scrollToFocused(container, element);
                },
                neighbors: {
                    left: hasAlbums || hasTopSongs ? null : 'content',
                    up: hasTopSongs ? 'artist-top-tracks' : (hasAlbums ? 'artist-albums' : 'topnav'),
                    down: 'nowplaying-bar'
                }
            });
        }

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: hasSimilar ? 'artist-similar' : (hasTopSongs ? 'artist-top-tracks' : (hasAlbums ? 'artist-albums' : 'content')),
                left: 'topnav'
            }
        });

        App.hideColourHints();

        if (setInitialFocus) {
            FocusManager.setActiveZone('content', 0);
        }
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError(message) {
        if (!_container) return;
        _container.textContent = '';
        var wrapper = el('div', { className: 'artist-detail' });

        var errorDiv = el('div', { className: 'artist-detail-error' });
        errorDiv.appendChild(el('div', { className: 'home-empty' }, message || 'Unable to load artist.'));
        wrapper.appendChild(errorDiv);

        _container.appendChild(wrapper);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.remove('album-active');

        if (_stage3Raf !== null) {
            cancelAnimationFrame(_stage3Raf);
            _stage3Raf = null;
        }

        _container = null;
        _artistId = null;
        _artistData = null;
        _artistInfo = null;
        _topSongs = null;
        _loadingPlayAll = false;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();

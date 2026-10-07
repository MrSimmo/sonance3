/* ============================================
   Sonance — Reusable UI Components
   Album art, artist avatars, loading skeletons
   ============================================ */

var SonanceComponents = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var rem = SonanceUtils.rem;
    var NS = 'http://www.w3.org/2000/svg';

    // =========================================
    //  Colour Generation
    // =========================================

    /**
     * Generate a consistent HSL colour from a string.
     * Returns { hue, base, light, dark } for gradient use.
     */
    function hashColor(str) {
        if (!str) str = 'unknown';
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        var hue = Math.abs(hash % 360);
        return {
            hue: hue,
            base: 'hsl(' + hue + ', 45%, 30%)',
            light: 'hsl(' + hue + ', 50%, 40%)',
            dark: 'hsl(' + ((hue + 40) % 360) + ', 40%, 18%)'
        };
    }

    // =========================================
    //  SVG Placeholders
    // =========================================

    /** Person silhouette icon for artist placeholder */
    function _createPersonSvg() {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.style.width = '45%';
        svg.style.height = '45%';
        svg.style.opacity = '0.3';
        svg.style.fill = 'white';

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z');
        svg.appendChild(path);

        return svg;
    }

    // =========================================
    //  Album Art Component
    // =========================================

    /**
     * Render album art with lazy loading and error fallback.
     * @param {Object} album  - Album object with coverArt, name, artist fields
     * @param {number} size   - Pixel size (0 = fill parent via CSS)
     * @param {Object} api    - SubsonicAPI instance (used as a "has API" check)
     */
    function renderAlbumArt(album, size, api) {
        var fillMode = (size === 0);
        var container = el('div', { className: fillMode ? 'album-art album-art-fill' : 'album-art' });

        if (!fillMode) {
            container.style.width = rem(size);
            container.style.height = rem(size);
            container.style.flexShrink = '0';
        }
        container.style.borderRadius = (size > 100 || fillMode) ? rem(10) : rem(6);
        container.style.overflow = 'hidden';
        container.style.position = 'relative';

        // V3.9 T1: request roughly the displayed size plus headroom for the
        // scale(1.08) focus transform. Device pixel ratio on the Q90R is 1, so
        // displayed CSS px == device px and anything larger is a straight
        // over-fetch: the pre-v3.9 buckets pulled 300 px for a 153 px grid card
        // (2.0x) and 500 px for a 200 px panel (2.5x).
        //
        // The buckets stay discrete and shared between surfaces on purpose. The
        // S1 T2 disk-cache win is keyed on URL stability, so an arbitrary
        // per-call size would fragment it; 180 in particular is shared by the
        // album grid card, the home cards and the album detail panel, so
        // drilling into an album from the grid still hits a warm URL.
        // - grid cards (fillMode):  180  (153 displayed, 165 focused)
        // - small thumbs (<=80):    100  (queue 44, search 52, library album 80)
        // - home cards (<=180):     180  (home album cards 162, 175 focused)
        // - home hero (<=220):      200  (200 displayed)
        // - NP + queue art (>220):  320  (280 displayed)
        // v3.10 D70: the buckets are 100 % sizes; SonanceUtils.artSize
        // scales them with the interface size.
        var requestSize;
        if (fillMode) requestSize = 180;
        else if (size <= 80) requestSize = 100;
        else if (size <= 180) requestSize = 180;
        else if (size <= 220) requestSize = 200;
        else requestSize = 320;
        requestSize = SonanceUtils.artSize(requestSize);

        var coverArtId = album && album.coverArt;

        // Always render the placeholder underneath. Once the image loads it
        // fades in over the placeholder via CSS opacity transition.
        var ph = _albumPlaceholder(album);
        if (fillMode) {
            ph.style.position = 'absolute';
            ph.style.top = '0';
            ph.style.left = '0';
        }
        container.appendChild(ph);

        if (coverArtId && api) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('alt', (album.name || album.title || 'Album') + ' cover');
            img.setAttribute('data-coverart', coverArtId);
            img.setAttribute('data-size', String(requestSize));
            img.style.position = 'absolute';
            img.style.top = '0';
            img.style.left = '0';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.display = 'block';

            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };

            container.appendChild(img);

            // Hand off to LazyLoader. It will set src + 'loaded' class
            // when the image enters the viewport (or immediately if already
            // cached / no IntersectionObserver).
            if (typeof LazyLoader !== 'undefined') {
                LazyLoader.observe(img);
            } else {
                img.src = ImageCache.getUrl(coverArtId, requestSize);
                img.classList.add('loaded');
            }
        }

        return container;
    }

    function _albumPlaceholder(album) {
        var name = (album && (album.name || album.title || album.artist)) || 'Unknown';
        var colors = hashColor(name);

        // V3.9 T5: the vinyl rings used to be an <svg> plus five <circle>,
        // 6 element creations and 28 setAttribute calls per album card, for a
        // mark that is hidden the moment the cover loads — and since V3.9 T1
        // virtualised the Albums grid, rebuilt ~56 times per recycle. They
        // are now the .art-placeholder-vinyl ::after gradient (css/styles.css),
        // which reproduces the same ring radii with no DOM at all.
        var div = el('div', { className: 'art-placeholder art-placeholder-vinyl' });
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.background = 'linear-gradient(135deg, ' + colors.base + ', ' + colors.dark + ')';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.borderRadius = 'inherit';

        return div;
    }

    // =========================================
    //  Artist Avatar Component
    // =========================================

    /**
     * Render artist avatar (circular) with lazy loading and fallback.
     * @param {Object} artist - Artist object with id, name, coverArt fields
     * @param {number} size   - Pixel diameter
     * @param {Object} api    - SubsonicAPI instance
     */
    function renderArtistAvatar(artist, size, api) {
        var container = el('div', { className: 'artist-avatar' });
        container.style.width = rem(size);
        container.style.height = rem(size);
        container.style.borderRadius = '50%';
        container.style.overflow = 'hidden';
        container.style.flexShrink = '0';
        container.style.position = 'relative';

        // V3.9 T1: as renderAlbumArt above - displayed px plus focus headroom,
        // at DPR 1. The library grid avatar was the worst offender in the app
        // (300 px for a 100 px circle, 3.0x).
        // - search / similar thumbs (<=80): 100  (52 / 80 displayed)
        // - grid avatar (<=120):            120  (100 displayed, 108 focused)
        // - detail (>120):                  200  (200 displayed)
        var requestSize;
        if (size <= 80) requestSize = 100;
        else if (size <= 120) requestSize = 120;
        else requestSize = 200;
        requestSize = SonanceUtils.artSize(requestSize);   // v3.10 D70

        // Placeholder underneath
        var ph = _artistPlaceholder(artist);
        ph.style.position = 'absolute';
        ph.style.top = '0';
        ph.style.left = '0';
        container.appendChild(ph);

        if (api && artist && artist.id) {
            var artId = artist.coverArt || ('ar-' + artist.id);
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('alt', (artist.name || 'Artist'));
            img.setAttribute('data-coverart', artId);
            img.setAttribute('data-size', String(requestSize));
            img.style.position = 'absolute';
            img.style.top = '0';
            img.style.left = '0';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.style.display = 'block';

            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };

            container.appendChild(img);

            if (typeof LazyLoader !== 'undefined') {
                LazyLoader.observe(img);
            } else {
                img.src = ImageCache.getUrl(artId, requestSize);
                img.classList.add('loaded');
            }
        }

        return container;
    }

    function _artistPlaceholder(artist) {
        var name = (artist && artist.name) || 'Unknown';
        var colors = hashColor(name);

        var div = el('div', { className: 'art-placeholder' });
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.background = 'linear-gradient(135deg, ' + colors.base + ', ' + colors.dark + ')';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.borderRadius = '50%';

        div.appendChild(_createPersonSvg());
        return div;
    }

    // =========================================
    //  Loading Skeletons
    // =========================================

    /**
     * Render a row of pulsing skeleton placeholder cards.
     */
    function renderSkeletonCards(count, width, height, extraClass) {
        var fragment = document.createDocumentFragment();
        for (var i = 0; i < count; i++) {
            var card = el('div', { className: 'skeleton' + (extraClass ? ' ' + extraClass : '') });
            card.style.width = rem(width);
            card.style.height = rem(height);
            card.style.flexShrink = '0';
            card.style.borderRadius = rem(10);
            fragment.appendChild(card);
        }
        return fragment;
    }

    // =========================================
    //  Public API
    // =========================================

    // =========================================
    //  Playlist cards (v3.10 A3, mockup 15)
    // =========================================

    /**
     * An art + label card for a playlist: the Playlists grid and Home's
     * "Your Playlists" row. The art is the playlist's `coverArt` (Navidrome
     * builds a collage of its albums), lazy, over today's gradient with the
     * playlist glyph, which is all there is without `coverArt` or if the
     * cover fails. `requestSize` is the getCoverArt size. Uses only what
     * getPlaylists returned: no getPlaylist per card (A3).
     */
    function renderPlaylistCard(playlist, requestSize, api) {
        var card = el('div', {
            className: 'playlist-card focusable',
            'data-playlist-id': playlist.id
        });
        var colors = playlist._gradient || hashColor(playlist.name || '');
        var art = el('div', { className: 'playlist-card-art' });
        art.style.background = 'linear-gradient(135deg, ' + colors.base + ' 0%, var(--bg-card) 100%)';
        var glyph = SonanceUtils.createSvg(SonanceUtils.SVG_PATHS.playlist);
        glyph.setAttribute('class', 'playlist-card-glyph');
        art.appendChild(glyph);
        if (playlist.coverArt && api) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('alt', '');
            img.setAttribute('data-coverart', playlist.coverArt);
            img.setAttribute('data-size', String(requestSize));
            img.onerror = _dropBrokenThumb;
            art.appendChild(img);
            if (typeof LazyLoader !== 'undefined') {
                LazyLoader.observe(img);
            } else {
                img.src = ImageCache.getUrl(playlist.coverArt, requestSize);
                img.classList.add('loaded');
            }
        }
        card.appendChild(art);
        card.appendChild(el('div', { className: 'playlist-card-name' }, playlist.name || 'Untitled'));
        var n = playlist.songCount || 0;
        var meta = SonanceUtils.formatCount(n) + (n === 1 ? ' song' : ' songs');
        if (playlist.duration) meta += ' \u00B7 ' + SonanceUtils.formatTotalDuration(playlist.duration);
        card.appendChild(el('div', { className: 'playlist-card-count' }, meta));
        return card;
    }

    // A failed cover leaves the thumbnail's dark box.
    function _dropBrokenThumb() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }

    /**
     * v3.10 R5/A1: the cover thumbnail of a list row (playlist detail, the
     * Songs tab): a box styled by `className` holding a lazy <img>, dark
     * until the cover loads. Not renderAlbumArt: its gradient placeholder and
     * inline styles made a long playlist's first paint 2.6x slower (D83).
     * The img is not observed here: VirtualGrid observes the lazy images of
     * the rows it mounts. `item` may be undefined (a row still loading).
     */
    function renderRowThumb(item, className) {
        var thumb = el('div', { className: className });
        var coverId = item && (item.coverArt || item.albumId);
        if (coverId) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('data-coverart', coverId);
            // The small-thumb bucket Queue and Search share (v3.9 T1),
            // scaled with the interface size (D70).
            img.setAttribute('data-size', String(SonanceUtils.artSize(100)));
            img.onerror = _dropBrokenThumb;
            thumb.appendChild(img);
        }
        return thumb;
    }

    // =========================================
    //  Credits (v3.10 R7)
    // =========================================

    // Contributor roles shown under "Writing & production", in this order,
    // with the mockup-10 wording. Navidrome 0.64.1 also sends `performer`
    // (Performance, below) and nothing else on the test library; any other
    // role is left out rather than shown under a raw tag name.
    var CREDIT_ROLES = [
        ['composer', 'Written by'],
        ['lyricist', 'Lyrics by'],
        ['producer', 'Produced by'],
        ['mixer', 'Mixed by'],
        ['engineer', 'Engineered by'],
        ['arranger', 'Arranged by'],
        ['remixer', 'Remixed by'],
        ['djmixer', 'DJ-mixed by'],
        ['conductor', 'Conducted by']
    ];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function _list(v) {
        if (!v) return [];
        return Array.isArray(v) ? v : [v];
    }

    // " · "-joined distinct non-empty strings, or '' (a row with '' is dropped).
    function _joinNames(names) {
        var seen = {}, out = [];
        for (var i = 0; i < names.length; i++) {
            var n = names[i] && String(names[i]).trim();
            if (!n || seen[n.toLowerCase()]) continue;
            seen[n.toLowerCase()] = true;
            out.push(n);
        }
        return out.join(' · ');
    }

    function _artistNames(list) {
        return _list(list).map(function(a) { return a && (a.name || (typeof a === 'string' ? a : '')); });
    }

    function _contributors(song, role) {
        return _list(song.contributors).filter(function(c) { return c && c.role === role; });
    }

    function _formatDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    /**
     * v3.10 R7: the credits of one song, as sections of [label, value] rows.
     * `song` is the queue's track overlaid with `getSong` (either alone is
     * enough); `album` is the `getAlbum` result or null (label, original
     * date, the disc's track count). A row is kept only when it has a value,
     * and a section only when it has a row ("sections with no data are
     * absent"). Pure data: Now Playing's panel and the options sheet's
     * "Show credits" (A5) both draw it with renderCreditSections.
     */
    function creditSections(song, album) {
        song = song || {};
        album = album || null;
        var sections = [];
        function section(title, rows) {
            rows = rows.filter(function(r) { return r[1] !== '' && r[1] !== null && r[1] !== undefined; });
            if (rows.length) sections.push({ title: title, rows: rows });
        }

        // Performance: the artist(s), then one row per performer sub-role
        // ("Vocals", "Guitar"…), in the order the server lists them.
        var perf = [['Artist', _joinNames(_artistNames(song.artists).length
            ? _artistNames(song.artists) : [song.displayArtist || song.artist])]];
        var bySub = {}, subOrder = [];
        _contributors(song, 'performer').forEach(function(c) {
            var label = c.subRole || 'Performer';
            if (!bySub[label]) { bySub[label] = []; subOrder.push(label); }
            bySub[label].push(c.artist && c.artist.name);
        });
        subOrder.forEach(function(label) { perf.push([label, _joinNames(bySub[label])]); });
        section('Performance', perf);

        // Writing & production. displayComposer stands in for "Written by"
        // when no composer contributor came with the song.
        var wp = [];
        CREDIT_ROLES.forEach(function(pair) {
            var names = _contributors(song, pair[0]).map(function(c) { return c.artist && c.artist.name; });
            if (pair[0] === 'composer' && !names.length && song.displayComposer) {
                names = String(song.displayComposer).split(/\s*[•·;]\s*/);
            }
            wp.push([pair[1], _joinNames(names)]);
        });
        section('Writing & production', wp);

        // Release.
        var albumArtist = song.displayAlbumArtist || _joinNames(_artistNames(song.albumArtists)) ||
            (album && (album.displayArtist || album.artist)) || '';
        // "[no label]" is MusicBrainz's placeholder for a release without a
        // label; Navidrome passes it through (seen on live, S6). No row.
        var labels = album ? _joinNames(_list(album.recordLabels).map(function(l) {
            return (l && l.name && !/^\[no label\]$/i.test(l.name)) ? l.name : '';
        })) : '';
        var released = (album && album.releaseDate && album.releaseDate.year) || song.year || (album && album.year) || '';
        var original = album && album.originalReleaseDate && album.originalReleaseDate.year;
        var releasedText = released ? String(released) : '';
        if (original && released && original !== released) releasedText += ' · originally ' + original;
        else if (original && !released) releasedText = String(original);
        var trackText = '';
        if (song.track) {
            var disc = song.discNumber || 1;
            var onDisc = 0, discs = 0;
            _list(album && album.song).forEach(function(s) {
                var d = s.discNumber || 1;
                if (d === disc) onDisc++;
                if (d > discs) discs = d;
            });
            trackText = String(song.track) + (onDisc ? ' of ' + onDisc : '');
            if (discs > 1) trackText += ' · Disc ' + disc + ' of ' + discs;
            else if (song.discNumber > 1) trackText += ' · Disc ' + song.discNumber;
        }
        var genres = _joinNames(_list(song.genres).map(function(g) { return g && g.name; })) || song.genre || '';
        section('Release', [
            ['Album', song.album || (album && album.name) || ''],
            ['Album artist', albumArtist],
            ['Label', labels],
            ['Released', releasedText],
            ['Track', trackText],
            ['Genres', genres]
        ]);

        // File.
        var sr = song.samplingRate ? (Math.round(song.samplingRate / 100) / 10) + ' kHz' : '';
        if (sr && song.bitDepth) sr += ' · ' + song.bitDepth + '-bit';
        var ch = song.channelCount === 1 ? 'Mono' : song.channelCount === 2 ? 'Stereo'
            : (song.channelCount > 2 ? song.channelCount + ' channels' : '');
        section('File', [
            ['Format', song.suffix ? String(song.suffix).toUpperCase() : (song.contentType || '')],
            ['Bit rate', song.bitRate ? SonanceUtils.formatCount(song.bitRate) + ' kbps' : ''],
            ['Sample rate', sr],
            ['Channels', ch]
        ]);

        // Listening.
        section('Listening', [
            ['Plays', song.playCount > 0 ? SonanceUtils.formatCount(song.playCount) : ''],
            ['Last played', song.played ? _formatDate(song.played) : ''],
            ['BPM', song.bpm > 0 ? String(song.bpm) : '']
        ]);

        return sections;
    }

    /**
     * Draws creditSections() output into `container` (titles and rows) and
     * returns the row elements, in order. Since v3.10-fix2 F3 the rows are
     * never focus stops: the views scroll (createScrollView).
     */
    function renderCreditSections(container, sections) {
        var rows = [];
        var frag = document.createDocumentFragment();
        sections.forEach(function(s) {
            frag.appendChild(el('div', { className: 'credits-section' }, s.title));
            s.rows.forEach(function(r) {
                var row = el('div', { className: 'credit-row' });
                row.appendChild(el('div', { className: 'credit-label' }, r[0]));
                row.appendChild(el('div', { className: 'credit-value' }, r[1]));
                frag.appendChild(row);
                rows.push(row);
            });
        });
        container.appendChild(frag);
        return rows;
    }

    /**
     * v3.10-fix2 F3 (D154, D155): a body that Up/Down scroll, with no focus
     * stops inside it. Wraps `scroller` (the overflow box) in a positioned
     * `.scroll-view` with the scroll indicator on its right edge, shown by
     * css while the scroller holds the focus (docs/UI-MOCKUP-REFERENCE.md
     * "Scroll indicator"). The caller puts `root` where the scroller would
     * have gone and makes the scroller its zone's one element.
     * Returns { root, measure(), step(direction) }:
     * - measure(): call after the content changes (one layout read);
     * - step('up' | 'down'): scrolls by a third of the visible height and
     *   returns whether it moved, so Up at the top can leave the zone.
     * A plain scrollTop write: instant, or animated when Smooth scrolling
     * (R1.8) gives every scroller `scroll-behavior: smooth`.
     */
    function createScrollView(scroller) {
        var root = el('div', { className: 'scroll-view' });
        var indicator = el('div', { className: 'scroll-indicator' });
        var thumb = el('div', { className: 'scroll-indicator-thumb' });
        indicator.appendChild(thumb);
        root.appendChild(scroller);
        root.appendChild(indicator);
        var visible = 0, max = 0, thumbH = 0;

        function place() {
            if (max <= 0) return;
            var y = Math.round((visible - thumbH) * Math.min(1, scroller.scrollTop / max));
            thumb.style.transform = 'translateY(' + y + 'px)';
        }

        function measure() {
            visible = scroller.clientHeight;
            max = scroller.scrollHeight - visible;
            if (max <= 1 || !visible) {
                max = 0;
                indicator.classList.remove('is-scrollable');
                return;
            }
            indicator.classList.add('is-scrollable');
            thumbH = Math.max(SonanceUtils.px(32), Math.round(visible * visible / (visible + max)));
            thumb.style.height = thumbH + 'px';
            place();
        }

        function step(direction) {
            var top = scroller.scrollTop;
            var by = Math.round(scroller.clientHeight / 3);
            if (direction === 'down' && max > 0 && top < max - 0.5) {
                scroller.scrollTop = Math.min(max, top + by);
                return true;
            }
            if (direction === 'up' && top > 0.5) {
                scroller.scrollTop = Math.max(0, top - by);
                return true;
            }
            return false;
        }

        scroller.addEventListener('scroll', place);
        return { root: root, measure: measure, step: step };
    }

    return {
        hashColor: hashColor,
        renderAlbumArt: renderAlbumArt,
        renderRowThumb: renderRowThumb,
        renderPlaylistCard: renderPlaylistCard,
        creditSections: creditSections,
        renderCreditSections: renderCreditSections,
        createScrollView: createScrollView,
        renderArtistAvatar: renderArtistAvatar,
        renderSkeletonCards: renderSkeletonCards
    };
})();

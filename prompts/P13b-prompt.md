You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P13b: Artist Detail Page.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints
2. Read PROGRESS.md
3. Read js/screens/album.js — reference for split-pane pattern
4. Read js/api.js — check if getArtist/getArtistInfo2 are implemented

## FEATURE: Artist Detail Page

### API (js/api.js)
Implement if not already present:
- `getArtist(id)` → returns `{ name, albumCount, album: [{ id, name, year, coverArt, songCount }] }`
- `getArtistInfo2(id)` → returns `{ biography, smallImageUrl, mediumImageUrl, largeImageUrl, similarArtist: [{ id, name }] }`

Response paths:
- `response['subsonic-response'].artist`
- `response['subsonic-response'].artistInfo2`

### New Screen: js/screens/artist.js

**Split-pane layout** (same pattern as album detail — fixed left, scrollable right):

```
.artist-detail (flex column, height: 100%, overflow: hidden)
    .artist-detail-back (flex-shrink: 0)
        [← Back button — rounded rect, pink fill on focus]
    .artist-detail-body (display: flex, flex: 1, min-height: 0)
        .artist-detail-left (width: 220px, flex-shrink: 0, no scroll)
            Artist photo (200px, border-radius 50%)
            Artist name (22px, weight 700)
            "{X} albums" (14px, --text-secondary)
            margin-top: 24px
            [▶ Play All] button
            margin-top: 12px
            [⤮ Shuffle All] button
        .artist-detail-right (flex: 1, overflow-y: auto, margin-left: 48px)
            DISCOGRAPHY section
            BIOGRAPHY section (if available)
            SIMILAR ARTISTS section (if available)
```

Use `margin-left: 48px` on the right panel — NOT flex gap (Chromium 63).
Use `margin-top` / `margin-bottom` between all elements — NOT flex gap.

### Left Panel (fixed, never scrolls)

**Artist photo:**
- 200px circle: `width: 200px; height: 200px; border-radius: 50%; object-fit: cover;`
- Source: `getArtistInfo2.largeImageUrl` or `mediumImageUrl`
- Fallback: gradient circle with person silhouette SVG (same as Library artists tab)
- Lazy load with `onerror` fallback

**Artist name:** 22px, weight 700, --text-primary. Max 2 lines: `overflow: hidden; max-height: 56px;`

**Album count:** 14px, --text-secondary, margin-top: 4px

**Play All button:**
- Same pill style as album detail Play button
- Click: fetch tracks from ALL albums (`getAlbum(id)` for each), concatenate, play via `Player.playAlbum(allTracks, 0)`
- Limit to first 10 albums to avoid excessive API calls — show toast "Playing first 10 albums" if more exist
- Loading state while fetching: "Loading..." text on button

**Shuffle All button:**
- Same as Play All but shuffled

### Right Panel (scrollable)

**DISCOGRAPHY section:**
- "DISCOGRAPHY" label (14px, uppercase, --text-muted, letter-spacing 1px)
- margin-bottom: 16px after label
- Album rows, each with:
  - Album art (80px, border-radius 8px) — use getCoverArtUrl or placeholder
  - margin-left: 16px (between art and text — NOT gap)
  - Album title (15px, weight 600, --text-primary)
  - Year + track count (13px, --text-secondary)
  - Display as flex row (art + text side by side)
  - margin-bottom: 12px between rows
- Clicking an album → `navigateTo('album', { id: albumId })`
- Focus zone: `artist-albums` (1 column vertical list)

**BIOGRAPHY section:** (only if getArtistInfo2 returns biography text)
- margin-top: 32px
- "BIOGRAPHY" label (same uppercase style)
- margin-bottom: 12px after label
- Biography text: 14px, --text-secondary, line-height 1.6
- If text > 500 chars, truncate with "..." — no "show more" button (keep it simple for d-pad)
- If no biography available from the API, hide this entire section

**SIMILAR ARTISTS section:** (only if getArtistInfo2 returns similarArtist array with items)
- margin-top: 32px
- "SIMILAR ARTISTS" label
- margin-bottom: 12px after label
- Horizontal row of artist cards:
  - Circular photo (80px, border-radius 50%) + name below (13px, centred)
  - margin-right: 20px between cards (NOT gap)
  - Use artist avatar placeholder if no image
  - Clicking → `navigateTo('artist', { id: artistId })` (recursive — adds to nav history, Back returns)
  - Focus zone: `artist-similar` (horizontal row)

### Navigation Wiring

**From Library → Artists tab:**
When clicking an artist card: `navigateTo('artist', { id: artistId })`
Find where artist cards are rendered in `js/screens/library.js` and add the `onActivate` handler.

**From Search results:**
When clicking an artist result: `navigateTo('artist', { id: artistId })`
Find where search results render artists in `js/screens/search.js`.

**From Album Detail:**
Make the artist name text in the album detail left panel focusable and clickable.
The artist ID should be available from the album data (`album.artistId` or `album.artist`).
Click → `navigateTo('artist', { id: artistId })`

**Register Screen:**
- Add `'artist'` to the router's screen map in `js/app.js`
- Add `<script src="js/screens/artist.js"></script>` to `index.html` (before app.js)
- Artist detail is a SUB-PAGE (not a sidebar nav item) — uses Back button to return

### Scroll-into-view
Use manual scroll function for the right panel when focus moves below visible area:
```javascript
function scrollToFocused(container, element) {
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
```

### Content area overflow
When artist detail is active: add class to `#content-area` that sets `overflow: hidden`.
When leaving: remove the class.

### Loading State
Both `getArtist(id)` and `getArtistInfo2(id)` can run in parallel:
```javascript
Promise.all([api.getArtist(id), api.getArtistInfo2(id)]).then(function(results) {
    var artist = results[0];
    var artistInfo = results[1];
    // render with both
});
```
`Promise.all` is ES6 (Chrome 32+) — works on Chromium 63.

Show a loading skeleton while fetching.

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`. Margin for flex child spacing.
- No `aspect-ratio` CSS — padding-bottom trick.
- No `scrollIntoView` with options — manual scroll function.
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
- Navigate to artist from Library → Artists tab
- Artist photo, name, album count display correctly
- Discography lists albums, clicking navigates to Album Detail
- Biography displays (if available — depends on Navidrome's Last.fm config)
- Similar artists display and clicking navigates to their page
- Play All / Shuffle All queue tracks and start playback
- Back button returns to previous screen
- Left panel stays fixed while right panel scrolls
- Navigate to artist from Search results
- Navigate to artist from Album Detail (click artist name)
- No regressions

Update PROGRESS.md.

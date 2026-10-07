You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P11d: Artist Detail Page.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints
2. Read tickets/P11-v1.4-features.md — do task P11.4 only
3. Read PROGRESS.md
4. Read js/screens/album.js as reference for the split-pane pattern
5. Read js/api.js — check if getArtist/getArtistInfo2 are implemented

## FEATURE: Artist Detail Page

### API Endpoints (js/api.js)
Implement if not already:
- `getArtist(id)` → returns `{ name, albumCount, album: [{ id, name, year, coverArt, songCount }] }`
- `getArtistInfo2(id, count)` → returns `{ biography, smallImageUrl, mediumImageUrl, largeImageUrl, similarArtist: [{ id, name }] }`

Subsonic response paths:
- `getArtist`: `response['subsonic-response'].artist`
- `getArtistInfo2`: `response['subsonic-response'].artistInfo2`

### New Screen: js/screens/artist.js

**Split-pane layout** (same pattern as album detail):

```
.artist-detail (flex column, height: 100%, overflow: hidden)
    .artist-detail-back (flex-shrink: 0)
        [← Back button]
    .artist-detail-body (display: flex, flex: 1, min-height: 0)
        .artist-detail-left (width: 220px, flex-shrink: 0, no scroll)
            Artist photo (200px, border-radius: 50%)
            Artist name (22px, weight 700)
            "{X} albums" (14px, --text-secondary)
            [▶ Play All] button
            [⤮ Shuffle All] button
        .artist-detail-right (flex: 1, overflow-y: auto, margin-left: 48px)
            DISCOGRAPHY section
            BIOGRAPHY section (if available)
            SIMILAR ARTISTS section (if available)
```

Use `margin-left: 48px` on the right panel (NOT flex gap).

### Left Panel (fixed)
- **Artist photo:** 200px circle. Use `getArtistInfo2.largeImageUrl` or `mediumImageUrl`. If no image, show the standard artist placeholder (gradient circle with person SVG).
  - CSS: `width: 200px; height: 200px; border-radius: 50%; object-fit: cover;`
  - Lazy load with error fallback
- **Artist name:** 22px, weight 700, --text-primary. Allow 2 lines max with overflow hidden.
- **Album count:** 14px, --text-secondary
- **Play All button:** same pill style as album detail. Plays all tracks from all albums sequentially.
  - To get all tracks: fetch each album's tracks via `getAlbum(albumId)` for all albums, concatenate
  - This could be slow for artists with many albums. Limit to first 10 albums or show a loading toast.
- **Shuffle All button:** same but shuffled

### Right Panel (scrollable)

**DISCOGRAPHY section:**
- "DISCOGRAPHY" label (14px, uppercase, --text-muted, letter-spacing 1px)
- List of albums, each as a row:
  - Album art (80px, border-radius 8px) + album title (15px, weight 600) + year (14px, --text-secondary) + track count
  - Use margin-bottom: 12px between rows (NOT flex gap)
  - Clicking an album navigates to Album Detail
  - Focus zone: `artist-albums` (1 column, vertical list)

**BIOGRAPHY section:** (only if getArtistInfo2 returns biography text)
- "BIOGRAPHY" label (same style as above)
- margin-top: 32px before this section
- Biography text: 14px, --text-secondary, line-height 1.6
- If text is very long (>500 chars), truncate with "..." and a "Show more" button
  - Show more: expands to full text
  - Show less: collapses back
  - These are focusable elements
- If no biography: hide this entire section

**SIMILAR ARTISTS section:** (only if getArtistInfo2 returns similarArtist array)
- "SIMILAR ARTISTS" label
- margin-top: 32px before this section
- Horizontal row of artist cards:
  - Circular photo (80px) + name below (13px)
  - Use artist avatar placeholder if no image
  - Clicking navigates to THAT artist's detail page (recursive navigation — add to nav history)
  - Focus zone: `artist-similar` (horizontal row)
  - Use margin-right: 20px between cards (NOT flex gap)

### Navigation Wiring
- **Library → Artists tab:** clicking an artist card calls `navigateTo('artist', { id: artistId })`
- **Search results:** clicking an artist result calls `navigateTo('artist', { id: artistId })`
- **Album Detail:** clicking the artist name (make it focusable and clickable) calls `navigateTo('artist', { id: artistId })`
  - The artist ID should be available from the album data (`album.artistId`)
- **Similar Artists:** clicking navigates to `navigateTo('artist', { id: similarArtistId })`

### Register Screen
- Add `'artist'` to the router's screen map
- Import/load `screens/artist.js`
- Add the script tag to `index.html` (before app.js)
- Artist detail is a sub-page (not a sidebar nav item) — uses Back button to return

### Loading States
- Show a loading skeleton while getArtist and getArtistInfo2 are fetching
- Both API calls can run in parallel: `Promise.all([api.getArtist(id), api.getArtistInfo2(id)])`
- Wait, Chromium 63... check if `Promise.all` is supported. YES — Promise.all is ES6 (Chrome 32+), so it's fine.

### Scroll-into-view
Use the manual scroll function for the right panel when focus moves to items below the fold.

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap` for grids. Use margin for flex children spacing.
- No `aspect-ratio` CSS. No `backdrop-filter`. No `scrollIntoView` with options.
- Run autonomously. Rebuild Sonance.wgt when done.

Test in browser:
- Navigate to an artist from Library → Artists tab
- Artist photo, name, album count display correctly
- Discography lists all albums, clicking navigates to album detail
- Biography displays (if available from Navidrome/Last.fm)
- Similar artists display (if available), clicking navigates to their page
- Play All / Shuffle All queue tracks correctly
- Back button returns to previous screen
- Split-pane: left panel fixed, right scrolls

Update PROGRESS.md.

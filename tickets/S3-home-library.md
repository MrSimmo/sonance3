# S3 — Home & Library Screens with API Integration

## Overview
Build the Home screen (hero banner, recently played, playlists) and Library screen (Albums/Artists/Songs/Genres tabs) with live data from Navidrome's Subsonic API.

## Prerequisites
- Phase S2 complete (shell, routing, focus manager working)
- Read `docs/UI-MOCKUP-REFERENCE.md` — Home and Library screen specs
- Navidrome instance accessible with test data

## Tasks

### S3.1 — Implement Subsonic API Endpoints
Flesh out the stub methods in `api.js`:
- `getAlbumList2(type, size, offset)` — types: `recent`, `frequent`, `newest`, `random`. Returns album list.
- `getArtists()` — returns all artists (ID3 tag based)
- `getGenres()` — returns genre list
- `getPlaylists()` — returns user's playlists
- `getStarred2()` — returns starred/favourite items
- `getCoverArtUrl(id, size)` — must already be implemented from S1, verify it works
- Add response data mapping: extract the nested Subsonic response objects into clean arrays (e.g. `response['subsonic-response'].albumList2.album`)

### S3.2 — Album Art Component
- Create reusable `renderAlbumArt(album, size)` function in utils or a new `components.js`:
  - If album has `coverArt` field, render `<img>` with `getCoverArtUrl(album.coverArt, size)` as `src`
  - If no cover art, render the gradient placeholder (gradient from hashed colour, vinyl SVG overlay) matching the mockup
  - Lazy loading: set `loading="lazy"` on images
  - Error fallback: `onerror` handler switches to placeholder
  - Border-radius: 10px for size > 100, 6px for smaller

### S3.3 — Artist Avatar Component
- Create reusable `renderArtistAvatar(artist, size)`:
  - If artist has `artistImageUrl`, render `<img>` with border-radius 50%
  - Otherwise, gradient circle with person silhouette SVG
  - Same lazy loading and error fallback pattern

### S3.4 — Home Screen (screens/home.js)
Build exactly per mockup:

**Hero Banner (260px):**
- Fetch currently playing track from Player state (or most recently played album via `getAlbumList2('recent', 1)`)
- Album art (188px) on left
- "Now Playing" label, album title (34px), artist + year (18px)
- Play button (accent pill) and Shuffle button (glass pill)
- Background: gradient from album's dominant colour (use cover art average or hash-based colour)
- Focus items: Play button (index 0), Shuffle button (index 1)

**Recently Played Section:**
- Heading: "Recently Played"
- Fetch: `getAlbumList2('recent', 6)`
- 6 album cards in horizontal row (gap 18px)
- Each: album art (162px) + title (14px bold) + artist (13px)
- Clicking an album navigates to Album Detail screen
- Focus items: index 2–7

**Your Playlists Section:**
- Heading: "Your Playlists"
- Fetch: `getPlaylists()`
- Playlist cards: 230px wide, gradient background, name + track count
- Clicking a playlist navigates to Playlists screen (or a playlist detail view)
- Focus items: index 8+

**Loading State:**
- Show subtle loading skeleton/shimmer while API calls are in-flight
- Placeholder cards with pulsing `--bg-card` background

**Focus Map:**
- Register zone `home-hero` for Play/Shuffle buttons
- Register zone `home-recent` for album cards (6 columns)
- Register zone `home-playlists` for playlist cards
- Configure vertical zone transitions between them

### S3.5 — Library Screen (screens/library.js)
Build with four sub-tabs:

**Tab Bar:**
- Albums, Artists, Songs, Genres tabs
- Tab pills with active/inactive states per mockup
- Focus zone: `library-tabs` (horizontal, 4 items)
- Pressing Enter on a tab switches content below
- Left/Right arrows move between tabs when tab zone is focused

**Albums Tab:**
- Fetch: `getAlbumList2('alphabeticalByName', 50)` (paginate if needed)
- 6-column grid, gap 22px
- Album art (fills column) + title + artist/year
- Clicking navigates to Album Detail
- Focus zone: `library-albums` (6 columns)

**Artists Tab:**
- Fetch: `getArtists()`
- 6-column grid, gap 28px
- Circular avatar (130px) + name (centred) + album count
- Clicking navigates to Artist detail (for now, navigates to Library with a filtered view or placeholder)
- Focus zone: `library-artists` (6 columns)

**Songs Tab:**
- Fetch: `getAlbumList2('newest', 5)` then get tracks from each (or use search3 with empty query — check what works)
- Alternative: fetch a few albums and concatenate their tracks for display
- Vertical list: track number, title, artist/album, duration
- Focused row highlighted
- Clicking plays the track
- Focus zone: `library-songs` (1 column)

**Genres Tab:**
- Fetch: `getGenres()`
- 4-column grid, gap 16px
- Gradient cards with genre name (20px bold)
- Clicking could filter library (future enhancement — for now, placeholder action)
- Focus zone: `library-genres` (4 columns)

**Tab Switching:**
- When switching tabs, replace content and re-register focus zones
- Preserve scroll position per tab if possible

### S3.6 — Data Caching
- Simple in-memory cache for API responses to avoid re-fetching on every screen visit
- Cache key: endpoint + params string
- Cache TTL: 5 minutes (configurable)
- Clear cache on app restart

### S3.7 — Browser Testing
- Home screen loads and displays live data from Navidrome
- Album art images load (or graceful fallback to placeholder)
- Recently played shows correct albums
- Playlists section shows user's playlists
- Library tabs switch correctly
- Album grid, artist grid, songs list, genres grid all populate
- Keyboard navigation works through all sections
- Clicking album navigates (even if Album Detail is still placeholder from S2)
- Loading states appear while data fetches

## Acceptance Criteria
- [ ] Home screen matches mockup with live Navidrome data
- [ ] Hero banner shows most recent album with Play/Shuffle buttons
- [ ] Recently Played row shows 6 albums from Navidrome
- [ ] Playlists section shows user's playlists
- [ ] Library screen has working tab switching (Albums/Artists/Songs/Genres)
- [ ] Albums tab shows album grid with artwork
- [ ] Artists tab shows artist grid with avatars
- [ ] Songs tab shows track list
- [ ] Genres tab shows genre cards
- [ ] Album art loads from Navidrome or falls back to placeholder
- [ ] D-pad navigation works through all sections (focus zones, zone transitions)
- [ ] Loading states shown while fetching data
- [ ] API response caching working (no redundant fetches within 5 min)

## Update PROGRESS.md

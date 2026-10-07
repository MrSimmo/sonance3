# S4 — Album Detail, Search Screen & Browsing

## Overview
Build the Album Detail screen (artwork, metadata, tracklist) and the Search screen (on-screen keyboard, live results). Wire up navigation from Library/Home to Album Detail.

## Prerequisites
- Phase S3 complete (Home and Library screens working with live data)
- Read `docs/UI-MOCKUP-REFERENCE.md` — Album Detail and Search screen specs

## Tasks

### S4.1 — Implement Remaining API Endpoints
- `getAlbum(id)` — returns album detail with embedded song list
- `getArtist(id)` — returns artist detail with album list
- `search3(query, artistCount, albumCount, songCount)` — full-text search
- `getSongsByGenre(genre, count, offset)` — songs filtered by genre

### S4.2 — Album Detail Screen (screens/album.js)
Build exactly per mockup:

**Split Layout:**
- Left panel (300px, fixed):
  - Back button: "← Back" text, focus index 0, pressing Enter or Back key returns to previous screen
  - Album art (300px wide)
  - Album title (26px, weight 700)
  - Artist name (17px, `--accent`, weight 600) — clicking could navigate to artist (future)
  - Metadata: year · track count · genre (14px, `--text-secondary`)
  - Play button (accent pill, full width of half panel)
  - Shuffle button (glass pill, full width of half panel)
  - Play: replaces queue with this album's tracks and starts playing track 1
  - Shuffle: replaces queue with shuffled album tracks and starts playing

- Right panel (flex: 1, padding-top 48px):
  - "TRACKLIST" label (14px, uppercase, `--text-muted`, letter-spacing 1px)
  - Track list:
    - Each row: track number (28px wide, right-aligned, muted) + title (15px) + duration (14px, muted, tabular-nums)
    - Currently playing track (if from this album): title in `--accent`, animated equaliser bars
    - Focused row: `rgba(255,255,255,0.04)` background, show kebab menu icon (three dots)
    - Clicking a track: starts playing from that track (replaces queue with album, starts at clicked track)
    - Focus zone: `album-tracks` (1 column, starts at index 3)

**Focus Map:**
- Zone `album-nav`: Back button (index 0)
- Zone `album-actions`: Play (index 1), Shuffle (index 2)
- Zone `album-tracks`: track list items (index 3+)
- Transitions: Down from nav → actions → tracks; Left from tracks → actions/nav

**Data Flow:**
- Screen receives album ID as param from router
- Calls `getAlbum(id)` on activate
- Renders with fetched data
- Show loading skeleton while fetching

### S4.3 — Search Screen (screens/search.js)
Build exactly per mockup:

**Split Layout:**
- Left panel (380px):
  - "Search" heading (20px bold)
  - Search input display:
    - `--bg-card` background, `--border` border, border-radius 12px
    - Magnifier icon (SVG) + query text (or placeholder "Search artists, albums, songs...")
    - Clear button (appears when query non-empty, focus index 0)
  - On-screen keyboard:
    - 9-column grid of A-Z (26 keys) + 0-9 (10 keys) = 36 keys
    - SPACE key spanning 4 columns
    - DEL key spanning 3 columns (with ⌫ icon)
    - Keys: `--bg-card` background, border-radius 8px, 16px font, weight 600
    - Focused key: `rgba(255,255,255,0.08)` background, `--text-primary` text
    - Pressing Enter on a key appends that character to the search query
    - Pressing Enter on DEL removes last character
    - Pressing Enter on SPACE adds a space
    - Focus zone: `search-keyboard` (9 columns, wrapping)

- Right panel (flex: 1):
  - If query is non-empty and has results:
    - "Results" label
    - Result items: album art (52px) + title (15px bold) + artist/type/year (13px secondary)
    - Clicking a result navigates to Album Detail (or plays a song if it's a song result)
    - Focus zone: `search-results` (1 column)
  - If query is non-empty and no results:
    - "No results for '{query}'" (centred, muted)
  - If query is empty:
    - "Quick Access" label
    - 3×2 grid of category cards: "Rock", "Jazz", "Electronic", "Recently Added", "Most Played", "Favourites"
    - Cards: `--bg-card`, `--border`, padding 20px, border-radius 12px
    - Focus zone: `search-quickaccess` (3 columns)

**Search Debounce:**
- After each character, debounce 300ms before calling `search3(query, 5, 10, 10)`
- Show loading spinner/skeleton in results area during fetch
- Clear results immediately when query changes

**Focus Transitions:**
- Left panel (keyboard) ↔ Right panel (results): Left/Right
- Clear button is first focusable in keyboard zone

### S4.4 — Genre Browsing (Enhancement to Library)
- When a genre card is clicked in Library → Genres tab:
  - Navigate to a filtered view showing songs in that genre
  - Use `getSongsByGenre(genre, 50)` API call
  - Display as a song list (same format as Library → Songs tab)
  - Back button returns to Library

### S4.5 — Browser Testing
- Navigate to Album Detail from Home (click recently played album)
- Navigate to Album Detail from Library (click album in grid)
- Album detail shows correct metadata, artwork, and track list
- Back button returns to previous screen
- Play and Shuffle buttons work (even if audio doesn't play yet — verify queue is populated in console)
- Search: type characters on keyboard, see live results
- Search: clear button works
- Search: click result navigates to Album Detail
- Search: empty state shows Quick Access cards
- Genre cards in Library trigger genre browsing
- D-pad navigation works throughout all new screens

## Acceptance Criteria
- [ ] Album Detail screen matches mockup exactly
- [ ] Album detail shows live data from Navidrome (artwork, metadata, tracks)
- [ ] Back navigation works from Album Detail
- [ ] Play/Shuffle buttons populate the queue (verified in console)
- [ ] Search screen matches mockup (keyboard, input, results)
- [ ] On-screen keyboard inputs characters correctly
- [ ] Search queries Navidrome and shows results with debounce
- [ ] Search results are clickable and navigate to Album Detail
- [ ] Empty search state shows Quick Access cards
- [ ] Genre browsing shows songs filtered by genre
- [ ] D-pad navigation works across all new screens and zones
- [ ] Loading states shown during data fetches

## Update PROGRESS.md

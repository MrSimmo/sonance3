You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P11b: Star/Unstar Favourites System.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints
2. Read tickets/P11-v1.4-features.md — do task P11.2 only
3. Read PROGRESS.md
4. Read js/api.js — check if star/unstar/getStarred2 methods are stubbed

## FEATURE: Star/Unstar (Favourites)

### API (js/api.js)
Implement these Subsonic API endpoints:
- `star(id, type)` — POST to `star.view` with param `id={id}` for songs, `albumId={id}` for albums, `artistId={id}` for artists
- `unstar(id, type)` — POST to `unstar.view` with same param mapping
- `getStarred2()` — GET `getStarred2.view` → returns `{ song: [], album: [], artist: [] }`

### Starred State Cache
Create a starred items manager (can be in `js/utils.js` or a new `js/starred.js`):
```javascript
var StarredCache = {
    _songs: {},    // id → true
    _albums: {},   // id → true
    _artists: {},  // id → true
    
    load: function(api) {
        return api.getStarred2().then(function(data) {
            // data has song[], album[], artist[] arrays
            // Build lookup objects from IDs
        });
    },
    
    isSongStarred: function(id) { return !!this._songs[id]; },
    isAlbumStarred: function(id) { return !!this._albums[id]; },
    
    toggleSong: function(id, api) {
        var starred = this.isSongStarred(id);
        // Optimistic update
        if (starred) { delete this._songs[id]; } else { this._songs[id] = true; }
        // API call
        var call = starred ? api.unstar(id, 'song') : api.star(id, 'song');
        var self = this;
        call.catch(function() {
            // Revert on failure
            if (starred) { self._songs[id] = true; } else { delete self._songs[id]; }
        });
        return !starred; // return new state
    }
    // Same for toggleAlbum, toggleArtist
};
```

Load the cache after login: `StarredCache.load(api)`.

### UI — Album Detail Screen (js/screens/album.js)

**Album star** — next to the album title in the left panel:
- SVG star icon (20px)
- States:
  - Not starred, not focused: white outline star (stroke: --text-secondary, fill: none)
  - Not starred, focused: pink outline star (stroke: --accent, fill: none)
  - Starred, not focused: white filled star (stroke: white, fill: white)
  - Starred, focused: pink filled star (stroke: --accent, fill: --accent)
- Focusable element in the left panel zone
- Enter toggles star → calls `StarredCache.toggleAlbum(albumId, api)` → shows toast

**Per-track star** — in each track row:
- Small star icon (14px) on the right side, before the duration
- Same visual states but smaller
- Do NOT toggle on Enter (Enter plays the track)
- Toggle with **Green button (404 / G key)** when the track row is focused
- Update colour button hint bar: add "G ★ Favourite" alongside existing hints

### UI — Now Playing Screen (js/screens/nowplaying.js)
- Star icon next to the track title or below the artist—album text
- Same visual states (20px)
- Add to the transport controls focus zone as the LAST item (after repeat): shuffle, prev, play, next, repeat, star
- Enter toggles star for the current track
- When track changes, update the star icon to reflect the new track's starred state

### Star SVG paths
```
// Outline star (not starred):
<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" 
      stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>

// Filled star (starred):
<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" 
      fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
```
Use `color` / CSS `currentColor` so the colour inherits from the parent's text colour, then set `color: var(--accent)` when focused and `color: white` or `color: var(--text-secondary)` otherwise.

### Testing
- Star an album in Album Detail → check Navidrome web UI confirms it's starred
- Unstar it → check Navidrome confirms
- Star a song via Green button → verify in Navidrome
- Navigate to Now Playing → star icon reflects correct state
- Change track → star icon updates
- Reload app → starred state persists (refetched from server)
- Toast notifications show on star/unstar

RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap`. Use `grid-gap`.
- Run autonomously. Rebuild Sonance.wgt when done.

Update PROGRESS.md.

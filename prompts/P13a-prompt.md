You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P13a: Star/Unstar Favourites System.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md — especially Tizen 5.0 constraints (NO flex gap, use grid-gap, NO ?. or ??, etc.)
2. Read PROGRESS.md for current state
3. Read js/api.js — check if star/unstar/getStarred2 methods exist (they may be stubs)
4. Read js/screens/album.js and js/screens/nowplaying.js — you'll add star UI here

## FEATURE: Star/Unstar (Favourites)

### API (js/api.js)
Implement these Subsonic API endpoints:
- `star(id, type)` — call `star.view` with param `id={id}` for songs, `albumId={id}` for albums, `artistId={id}` for artists
- `unstar(id, type)` — call `unstar.view` with same param mapping
- `getStarred2()` — call `getStarred2.view` → returns `{ song: [], album: [], artist: [] }`

### Starred State Cache
Create a simple in-memory cache (add to js/utils.js or a new js/starred.js):

```javascript
var StarredCache = {
    _songs: {},
    _albums: {},
    _artists: {},

    load: function(api) {
        return api.getStarred2().then(function(data) {
            var self = StarredCache;
            self._songs = {};
            self._albums = {};
            self._artists = {};
            if (data.song) {
                data.song.forEach(function(s) { self._songs[s.id] = true; });
            }
            if (data.album) {
                data.album.forEach(function(a) { self._albums[a.id] = true; });
            }
            if (data.artist) {
                data.artist.forEach(function(a) { self._artists[a.id] = true; });
            }
            console.log('[Sonance][Starred] Loaded: ' + Object.keys(self._songs).length + ' songs, ' + Object.keys(self._albums).length + ' albums');
        });
    },

    isSongStarred: function(id) { return !!this._songs[id]; },
    isAlbumStarred: function(id) { return !!this._albums[id]; },

    toggleSong: function(id, api) {
        var wasStarred = this.isSongStarred(id);
        if (wasStarred) { delete this._songs[id]; } else { this._songs[id] = true; }
        var call = wasStarred ? api.unstar(id, 'song') : api.star(id, 'song');
        var self = this;
        call.catch(function() {
            if (wasStarred) { self._songs[id] = true; } else { delete self._songs[id]; }
        });
        return !wasStarred;
    },

    toggleAlbum: function(id, api) {
        var wasStarred = this.isAlbumStarred(id);
        if (wasStarred) { delete this._albums[id]; } else { this._albums[id] = true; }
        var call = wasStarred ? api.unstar(id, 'album') : api.star(id, 'album');
        var self = this;
        call.catch(function() {
            if (wasStarred) { self._albums[id] = true; } else { delete self._albums[id]; }
        });
        return !wasStarred;
    }
};
```

Load after login: `StarredCache.load(api)` — call this when the app shell initialises after successful login.

### Star SVG Paths
```
Outline (not starred):
M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z
stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"

Filled (starred):
M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z
fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"
```

Use CSS `color` / `currentColor` inheritance. Set `color: var(--accent)` when focused, `color: white` or `color: var(--text-secondary)` otherwise.

### UI — Album Detail Screen (js/screens/album.js)

**Album star** — next to the album title in the left panel:
- 20px star icon
- Not starred + not focused: white outline star (stroke --text-secondary)
- Not starred + focused: pink outline star (stroke --accent)
- Starred + not focused: white filled star (fill white)
- Starred + focused: pink filled star (fill --accent)
- Focusable element in the left panel zone (add after the album title)
- Enter toggles → calls `StarredCache.toggleAlbum(albumId, api)` → shows toast "Added to favourites" / "Removed from favourites"

**Per-track star** — in each track row:
- Small 14px star icon, right side before duration
- Same 4 visual states but smaller
- Do NOT toggle on Enter (Enter plays the track)
- Toggle with **Green button (404 / G key)** on the focused track
- Update colour button hint bar: add "G ★ Favourite"

### UI — Now Playing Screen (js/screens/nowplaying.js)
- 20px star icon next to track title or below artist text
- Same 4 visual states
- Add as LAST item in transport controls focus zone (after repeat): shuffle, prev, play, next, repeat, star
- Enter toggles star for the current track
- When track changes (Player `trackchange` event), update star icon for new track's starred state

### Toast Notifications
If a toast system already exists (from P4b colour buttons), reuse it. If not, create a simple one:
```javascript
function showToast(message) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,0.85);color:white;font-size:14px;padding:10px 24px;' +
        'border-radius:20px;z-index:9999;opacity:0;transition:opacity 0.3s ease;';
    toast.textContent = message;
    document.getElementById('app').appendChild(toast);
    setTimeout(function() { toast.style.opacity = '1'; }, 10);
    setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
    }, 2000);
}
```

### Script Loading
If creating a new `js/starred.js`, add `<script src="js/starred.js"></script>` to index.html before screens and app.js.

## RULES:
- Vanilla JS, ES2017. No ?., ??. No flex `gap` — use margin. Use `grid-gap` for grids.
- Run autonomously. Rebuild Sonance.wgt when done.

## TESTING
- Star an album in Album Detail → verify toast, check Navidrome web UI confirms starred
- Unstar it → verify in Navidrome
- Star a song via Green button on track row → verify in Navidrome
- Now Playing: star icon reflects current track's state
- Change track → star icon updates for new track
- Reload app → starred state refetched from server
- No regressions on playback or navigation

Update PROGRESS.md.

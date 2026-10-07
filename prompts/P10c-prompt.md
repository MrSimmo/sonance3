You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P10c: Fix Library Screen Scroll Containment.

## Test Configuration
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md
2. Read PROGRESS.md

## THE PROBLEM
The Library Albums page is taller than the viewport, creating a scrollbar on the right of the entire page. The album grid extends beyond the screen height. The grid needs to scroll WITHIN its own container, not push the whole page.

## THE FIX
The Library screen must use a flex column layout that constrains the grid to the available height:

```
.library-screen (display: flex, flex-direction: column, height: 100%, overflow: hidden)
    .library-tabs (flex-shrink: 0)
        [Albums] [Artists] [Songs] [Genres]
    .library-content (flex: 1, min-height: 0, overflow-y: auto, overflow-x: hidden)
        [album grid / artist grid / song list / genre grid]
```

Key CSS:
```css
.library-screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.library-tabs {
    flex-shrink: 0;
    padding: 0 0 16px 0;  /* space below tabs */
}

.library-content {
    flex: 1;
    min-height: 0;  /* CRITICAL — allows flex child to shrink and scroll */
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 20px;
}
```

**`min-height: 0` is the key.** Without it, the flex child's minimum height defaults to its content height, preventing it from shrinking below the grid's natural size. With `min-height: 0`, it shrinks to the available space and the overflow creates internal scrolling.

Additionally:
- When Library screen is active, set `#content-area` to `overflow: hidden` so only the inner `.library-content` scrolls
- When leaving Library, restore `#content-area` to normal overflow
- This is the same pattern used for the album detail split-pane (P10b)

**Scroll-into-view for focused items:**
When focus moves to an album card that's below the visible area, scroll it into view using the manual scroll function (NOT scrollIntoView with options — Chromium 63):
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
Call this whenever focus changes within the library grid zones.

**Apply to ALL library tabs** — Albums, Artists, Songs, and Genres should all scroll within `.library-content`. The tabs row stays pinned at the top.

## ALSO APPLY TO:
- **Home screen** — if the home screen content (hero + recently added + recently played + playlists) is taller than the viewport, the same pattern applies. The home screen root should be `height: 100%; overflow-y: auto` with the content scrolling internally.
- **Search screen** — the results list on the right panel should scroll independently if there are many results. The keyboard panel stays fixed.
- **Queue screen** — the queue list (right panel) should scroll independently. The now playing card (left panel) stays fixed.

Essentially: **every screen should manage its own scrolling internally. The `#content-area` itself should never scroll — each screen's content container handles it.**

Set `#content-area` to `overflow: hidden` globally (not per-screen), and let each screen's root element manage its own scroll behaviour.

RULES:
- Vanilla JS, ES2017. No ?., ??
- NO flex `gap` — use margin on children
- Use `grid-gap` not `gap` for grids
- `min-height: 0` on all flex children that need to scroll
- Run autonomously
- Rebuild Sonance.wgt when done

Test at 1920×1080:
- Library Albums: tabs pinned at top, grid scrolls below, no page-level scrollbar
- Library Artists/Songs/Genres: same scroll behaviour
- Focus auto-scrolls grid to keep focused item visible
- Home screen scrolls internally if content exceeds viewport
- No double scrollbars anywhere

Update PROGRESS.md.

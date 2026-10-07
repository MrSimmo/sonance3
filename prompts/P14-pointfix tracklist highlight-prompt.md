You are patching Sonance — a music player app for Samsung Tizen TVs. This is a tiny point fix.

BEFORE WRITING ANY CODE:
1. Read js/screens/album.js — find where the artist name is rendered in the album detail left panel
2. Read css/styles.css — find any styles for the artist name element

## THE PROBLEM
On the Album Detail screen, the artist name (e.g. "Guns N' Roses") has a white/light background behind it when NOT focused. It should have a transparent background. When focused, the pink highlight is fine — only the unfocused state is wrong.

## THE FIX
Find the artist name element in the album detail left panel. It was made focusable/clickable (to navigate to Artist Detail) which likely gave it a default background.

Set its unfocused state:
```css
background: transparent;
```

Check both CSS and inline JS styles. The issue could be:
- A `.focusable` class that sets a default background
- An inline `style.background` set in JS
- A generic rule like `.focusable { background: rgba(255,255,255,...) }` that applies too broadly

The fix should ONLY affect the artist name on the album detail screen — don't break other focusable elements.

If it's an inline style in JS: `artistEl.style.background = 'transparent';`
If it's CSS: add a specific rule like `.album-artist-link { background: transparent; }` and `.album-artist-link.focused { background: var(--accent); }`

Rebuild Sonance.wgt. Update PROGRESS.md.

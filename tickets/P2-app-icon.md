# P2 — Generate Sonance App Icon

## Overview
Replace the placeholder `icon.png` with a proper 256×256 app icon. The icon is a stylised "S" made from sound wave arcs on a pink-to-purple gradient background with rounded corners.

## Prerequisites
- Read CLAUDE.md for project rules
- This is a targeted asset replacement — only `icon.png` is modified

## Design Specification

**Canvas:** 256×256 pixels, rounded corners (radius ~50px for Tizen app grid)

**Background:** Linear gradient from top-left to bottom-right:
- Top-left: `#e44d8a` (app accent pink)
- Centre: `#a84ddd`
- Bottom-right: `#8a4dff` (purple)

**Foreground (centred on canvas):**

1. **Stylised "S" shape** made from two thick arcs, white, stroke width ~8-10px scaled to 256px:
   - Top arc: curves from right to left, forming the top half of an S
   - Bottom arc: curves from left to right, forming the bottom half of an S
   - A faded third arc at the bottom (opacity ~0.2) to give depth

2. **Sound emanation lines** — small curved arcs radiating outward:
   - Two arcs on the right side of the top curve (opacity 0.5 and 0.3)
   - Two arcs on the left side of the bottom curve (opacity 0.5 and 0.3)
   - Stroke width ~3-4px, white, round line caps

**All elements are white on the gradient background. No text on the icon.**

## Implementation

### P2.1 — Generate icon.png using Python

Use Python with Pillow (PIL) to generate the icon. If Pillow is not installed, ask the user for permission to install it (`pip install Pillow --break-system-packages`).

If Pillow's drawing primitives are too limited for smooth arcs, an alternative approach is:
1. Generate the icon as an SVG string
2. Use `cairosvg` to convert SVG to PNG (`pip install cairosvg --break-system-packages` — ask first)
3. Or use Pillow's `ImageDraw.arc()` and `ImageDraw.ellipse()` methods

The SVG approach will produce cleaner curves. Here is the SVG design to convert:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e44d8a"/>
      <stop offset="50%" stop-color="#a84ddd"/>
      <stop offset="100%" stop-color="#8a4dff"/>
    </linearGradient>
    <clipPath id="rounded">
      <rect width="256" height="256" rx="50"/>
    </clipPath>
  </defs>
  <rect width="256" height="256" rx="50" fill="url(#bg)"/>
  <g clip-path="url(#rounded)">
    <g transform="translate(128, 128)">
      <!-- S shape from arcs -->
      <path d="M36,-51 A45,45 0 0,0 -36,-13" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.95"/>
      <path d="M-36,-13 A45,45 0 0,1 36,26" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.95"/>
      <path d="M36,26 A45,45 0 0,0 -36,64" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.2"/>
      <!-- Sound emanation - right side -->
      <path d="M52,-42 Q72,-26 52,-10" stroke="white" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.5"/>
      <path d="M64,-47 Q92,-26 64,-5" stroke="white" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.3"/>
      <!-- Sound emanation - left side -->
      <path d="M-52,15 Q-72,31 -52,47" stroke="white" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.5"/>
      <path d="M-64,10 Q-92,31 -64,52" stroke="white" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.3"/>
    </g>
  </g>
</svg>
```

### P2.2 — Replace icon.png
- Save the generated PNG as `icon.png` in the project root (overwriting the placeholder)
- Verify the file is exactly 256×256 pixels
- Verify the file size is reasonable (should be under 50KB)

### P2.3 — Rebuild .wgt
- Run `bash build.sh` to rebuild `Sonance.wgt` with the new icon
- Verify the new icon is included in the `.wgt`

## Acceptance Criteria
- [ ] `icon.png` is 256×256 pixels
- [ ] Gradient background renders correctly (pink top-left to purple bottom-right)
- [ ] S-shaped arcs and sound emanation lines are visible and clean
- [ ] Rounded corners on the icon (~50px radius)
- [ ] No text on the icon
- [ ] `Sonance.wgt` rebuilt with new icon
- [ ] No other files modified except icon.png and PROGRESS.md

## Update PROGRESS.md
Add to the Patches section.

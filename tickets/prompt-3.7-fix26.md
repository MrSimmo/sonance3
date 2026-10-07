# Prompt 3.7-fix26 — Item 3.6: NP background blur — pre-blurred image swap

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the live `filter: blur(60px) saturate(1.3)` on the NP background with a pre-blurred image source painted directly to the element. Activate this swap only after measuring on TV, since the live filter may be acceptable.

## Context

- `css/styles.css:3379` — current rule applies `filter: blur(60px) saturate(1.3)` to `.np-bg-image` on the Now Playing screen.
- A previous note in PROGRESS.md (PERF-7 reserved) flagged this as a candidate for swap-out if TV measurements show jank.
- `js/screens/nowplaying.js:856` — there is already a JS path that prepares an image-based fallback. Confirm and finish wiring.

## Task

1. **Measure first.** On TV, profile the NP screen open and a track change. If the live blur does not show as a frame-rate drop, document the measurement in PROGRESS.md and stop. Do not change the CSS or JS in that case.
2. **If a measurable cost is confirmed:**
   - Add a server-side or client-side pre-blur path. Options (pick simplest):
     - **a)** Use a downscaled cover-art URL (e.g. Subsonic `getCoverArt.view?id=…&size=64`), upscale via CSS `transform: scale(…)` and use solid `background-image` — the upscale plus low-res naturally produces a blurred look without runtime filter.
     - **b)** Pre-process the cover off the main thread once on track change using a 2D canvas blur, then set `.np-bg-image` `style.backgroundImage = 'url(' + dataUrl + ')'`.
   - Remove the `filter: blur(60px) saturate(1.3)` from `css/styles.css:3379` (or keep it commented as a fallback).
3. Update `js/screens/nowplaying.js:856` to set the `.np-bg-image` background to the pre-blurred source on track change.

## Constraints

- The visible result must be visually similar (subtle saturated blur behind the cover). A small palette shift is acceptable.
- Do not introduce any new external dependency.
- Do not introduce any cross-origin requests beyond the configured Navidrome server.

## Acceptance criteria

- TV measurement documented in PROGRESS.md (either "no swap needed" or "swapped to image path with X ms gain").
- If swapped: NP screen still has a coloured blur background that updates on track change.
- Browser Smoke Test passes.

## Out of scope

- Album / artist screens (their backgrounds are different).
- Any animation between blurs.

## Verification

1. (TV) Profile NP open before and after; note the difference in PROGRESS.md.
2. (Browser) Visual side-by-side: check the look matches V3-6-fix5 closely.
3. Browser Smoke Test from ticket-3.7.md.

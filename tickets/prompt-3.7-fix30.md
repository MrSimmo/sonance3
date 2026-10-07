# Prompt 3.7-fix30 — NP progress scrubber: larger focused thumb with accent fill

**Parent ticket:** `tickets/ticket-3.7.md` — read it first. Inherit all V3.7 constraints (Tizen 5.0 / Chromium ~63 ES2017, no `gap` on flex, transform/opacity-only animations, no `transition: all`, AVPlay only on TV, no external network, etc.).

## Objective

On the Now Playing screen, when the progress/seek scrubber is focused (user is scrubbing), make the circular thumb twice the diameter of its resting size and fill it with the accent colour. Leave the unfocused state untouched.

## Context

The NP-screen progress bar's thumb is a real DOM `<div class="np-screen-progress-scrubber">` styled in `css/styles.css`:

- Resting (`.np-screen-progress-scrubber`, lines 815-828): 13×13 white circle, anchored via `transform: translateX(var(--scrub-x, 0px))`, with a soft accent halo (`box-shadow: 0 0 6px rgba(var(--accent-rgb), 0.4)`) and `will-change: transform`.
- Focused (`.np-screen-progress.focused .np-screen-progress-scrubber`, lines 780-785): currently scales to `scale(1.35)` (~17.6px) and switches to a stronger accent halo (`box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.6)`). Background remains white.

The accent CSS variables already exist at the top of `styles.css`:
```css
--accent: #e44d8a;
--accent-rgb: 228, 77, 138;
```

User feedback: the current focused enlargement is too subtle and the white fill doesn't read as "active." We want the focused thumb to be exactly **twice the resting diameter** (scale 2 → 26px, not the current ~17.6px) and **filled with the accent colour** while focused. Everything else stays identical.

## Task

Edit only the focused-state block in `css/styles.css` (lines 780-785). Change two things and add one line:

1. Update the `transform` to use `scale(2)` (preserve `translateX(var(--scrub-x, 0px))`).
2. Add `background: var(--accent);` so the focused thumb is filled in the accent colour.
3. Leave the existing focused `box-shadow` exactly as it is.

Final block should read:

```css
/* Focused scrubber: scale it up via transform only — height stays fixed
   so no layout-triggering transition. */
.np-screen-progress.focused .np-screen-progress-scrubber {
    transform: translateX(var(--scrub-x, 0px)) scale(2);
    background: var(--accent);
    box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.6);
}
```

That is the entire change. Do **not** touch:

- `.np-screen-progress-scrubber` (resting state, lines 815-828) — must stay 13×13 white with the existing halo.
- `.np-screen-progress-track`, `.np-screen-progress-fill`, `.np-screen-progress`, or any focus styles on the parent.
- Any JavaScript file. The CSS toggling is already wired via the `.focused` class on `.np-screen-progress`.

## Constraints

- ES2017 / Chromium ~63 / Tizen 5.0 (inherited from `ticket-3.7.md`).
- Do **not** add a transition on `background`, `width`, `height`, `box-shadow`, or any other property — `background` should snap instantly when focus is gained/lost (per the v3 Animation Rules in `CLAUDE.md`).
- Do **not** introduce a `transition: all`.
- The existing `transform: translateX(...)` on the scrubber and its `will-change: transform` are GPU-safe and must remain. The added `scale(2)` is composed into the same `transform` — still GPU-safe.
- Do not change any other selector, file, or behaviour.
- Do not alter the resting-state appearance in any way.
- Do not change the `.focused` class toggle logic in JS.

## Acceptance criteria

1. **Resting state unchanged.** When the NP progress bar is **not** focused, the thumb is still a 13×13 white circle with the same soft accent halo as before. Visually identical to V3.7-fix29.
2. **Focused thumb size doubles.** When the user focuses the progress bar to scrub (e.g. from NP, press Up to focus the bar, or however the existing UX puts it into the focused state), the thumb is exactly 26×26 effective (i.e. `scale(2)` of the 13px base).
3. **Focused thumb fill is accent.** The focused thumb's background colour is `var(--accent)` (currently `#e44d8a`). The white fill must not appear in the focused state.
4. **Halo unchanged.** The focused-state halo (`box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.6)`) remains exactly as it was.
5. **No transition added on `background`.** Focus gain/loss flips the colour instantly — no fade.
6. **No layout transition.** No new transition on width/height/border/etc. The existing `transform` transition on the scrubber is the only animation that runs at focus change.
7. Browser Smoke Test from `ticket-3.7.md` passes with no console errors and no visual regression on any other screen.

## Out of scope

- Any change to the resting-state scrubber.
- Any change to the progress fill bar, track, or surrounding NP layout.
- Any change to NP-bar (mini-player) progress UI elsewhere in the app.
- Any change to focus-management JS or to the `.focused` class toggling.
- Adding/altering transitions, halos, or hover states.

## Verification

1. Start dev server: `python3 -m http.server 8080` from project root.
2. Open Chrome at `http://localhost:8080/` and log in to the test Navidrome at `http://192.168.0.2:4534` (credentials in user memory).
3. Play any track and open Now Playing.
4. With the progress bar **unfocused**, confirm the thumb is the same small white circle as before fix30. (Side-by-side comparison vs. fix29 screenshot is fine.)
5. Move focus onto the progress bar (per the existing scrub UX). Confirm:
   - The thumb roughly doubles in diameter (compared with the resting state in step 4).
   - The fill is the pink/accent colour, not white.
   - The accent halo around the thumb is still visible at the same intensity as before.
   - The transition feels instantaneous on the colour and uses only the existing transform animation for the size change.
6. Move focus off the progress bar. Confirm the thumb returns instantly to the small white resting state.
7. Scrub left/right while focused; confirm the thumb still moves smoothly along the bar (the existing `--scrub-x` translateX still works alongside the new `scale(2)`).
8. Run the full Browser Smoke Test from `ticket-3.7.md`. Console should have zero errors. No visual regression on any other screen.
9. Update `PROGRESS.md` with what was completed, what was tested, and any deferred follow-ups.

# Ticket 3.7 — Performance Hardening

## Version & scope

V3.7 is a performance-only initiative across the Sonance app. It adds no features, changes no UI, alters no animations, and adjusts no functionality. Each prompt under this version is a single isolated optimisation, executed one prompt per Claude Code session in the order listed below. The work is sourced from a comprehensive performance review of the codebase performed on 2026-04-27 against V3-6-fix5.

## Background

The codebase has already been heavily perf-tuned through V3-6 fix1–fix5: virtual grid for >80 artists, deferred lyrics fetch + DOM build, dynamic `will-change` toggle in `js/focus.js`, focus-scroll rAF coalescing, image LRU cache (`js/image-cache.js`), staged artist-detail render. The 2026-04-27 review catalogued 28 remaining wins reachable without touching UI, layout, behaviour, or animation feel:

- Tier 1 (7 items) — high-impact, low-risk
- Tier 2 (13 items) — medium-impact
- Tier 3 (8 items) — hygiene / low-impact

Items appear in execution order in the prompt index below; the order interleaves Tier 1 ROI-first per the review's "Suggested Order".

## Goals

- Reduce cold-boot time on the Q90R TV
- Reduce d-pad input → focus-update latency
- Reduce per-screen render and re-render cost
- Cut redundant network round-trips on cold launch
- Hold zero visual regressions; pixel-identical at rest

## Non-goals

- No UI changes, no design changes, no new features
- No new screens, no animation timing changes
- No CSS layout-property transitions added (transform/opacity only — current rule)
- No `transition: all` cleanup of legacy V2 styles (deferred per PROGRESS)
- No `will-change` re-architecture (already tuned in V3-6-fix2/4)
- No replacement of `grid-gap` with `gap` shorthand (mandated as legacy by CLAUDE.md)

## Constraints (apply to every V3.7 prompt)

- **Tizen 5.0 / Chromium ~63.** ES2017 only. No optional chaining (`?.`), no nullish coalescing (`??`), no `Object.fromEntries`, no `Array.flat`, no top-level `await`, no `BigInt`.
- **CSS:** No `backdrop-filter`. No `gap` on flex (use child margins). `grid-gap` (legacy) on grid, never the new `gap` shorthand. Animate only `transform` + `opacity`. Never `transition: all`. Avoid transitioning `width`, `height`, `margin`, `padding`, `left`, `right`, `font-size`, `border`.
- **Audio:** AVPlay is the only TV playback path. HTML5 `<audio>` is the browser-fallback only. Do not change AVPlay lifecycle except where a specific prompt explicitly calls for it.
- **Network:** App may only contact the configured `sonance_server_url`. No CDNs, no externals.
- **Workflow:** One prompt per session. Always run the verification block in each prompt. Update PROGRESS.md at the end of each session with what was completed, what was tested, and any deferred follow-ups.

## Acceptance criteria (whole version)

Each individual prompt sets its own specific acceptance criteria. Across V3.7:

- All 28 prompts land without UI regression in the Browser Smoke Test
- Cold-boot time on TV measurably improves after `prompt-3.7.md` (bundle/minify) lands
- D-pad responsiveness feels at least as good as before each landed prompt
- Track-end → next-track gap (gapless) is preserved
- All AVPlay states (open, prepare, play, pause, seek, stop) work as before

## Open questions

- **Terser dependency** — `prompt-3.7.md` introduces a build-time minifier. This is a build-time tool only; the runtime widget still has zero npm deps. Confirm with the user before installing.
- **AVPlay setDisplayRect** — `prompt-3.7-fix27.md` (3.7 in the review) verifies whether `setDisplayRect` genuinely needs to be re-set per `open`. Tizen-doc check is part of that prompt's task.

## Browser Smoke Test (canonical, referenced by all prompts)

1. Start dev server: `python3 -m http.server 8080` from project root.
2. Open Chrome at `http://localhost:8080/`.
3. Log in to the test Navidrome (credentials in user memory; server `http://192.168.0.2:4534`).
4. Exercise this flow with no console errors:
   - Home → focus a recent album → Enter
   - Album detail → Play → Now Playing opens
   - Lyrics: open and close
   - Back to Home → top-nav Right → Library
   - Library tabs: Albums → Artists → Songs → Genres (all four render)
   - Artists: scroll the virtual grid to row ~50, focus an artist, Enter, Back, focus restored
   - Top-nav → Search → type "the", results render, focus into them
   - Top-nav → Queue → playlist visible, focus a row
   - Top-nav → Now Playing
   - Pause, seek, resume; then skip to next track
5. No console errors. No visual regression vs. V3-6-fix5.

## Prompt index (execution order)

| File | Item | Title |
|------|------|-------|
| `prompt-3.7.md` | 1.6 | Bundle and minify JS for the widget build |
| `prompt-3.7-fix2.md` | 1.1 | Throttle progress event emissions in Player |
| `prompt-3.7-fix3.md` | 1.5 | Album detail: stop full re-render on track change |
| `prompt-3.7-fix4.md` | 1.3 | Cache focus-zone elements |
| `prompt-3.7-fix5.md` | 1.4 | Bound `_willChangeElements` tracking |
| `prompt-3.7-fix6.md` | 1.7 | localStorage TTL for static metadata |
| `prompt-3.7-fix7.md` | 1.2 | Eliminate full-page `cloneNode` ghosts |
| `prompt-3.7-fix8.md` | 2.1 | Cache top-nav pill rects |
| `prompt-3.7-fix9.md` | 2.2 | Stop re-registering artists zone per chunk |
| `prompt-3.7-fix10.md` | 2.3 | Event delegation for grid card clicks |
| `prompt-3.7-fix11.md` | 2.4 | Memoise per-item formatted strings |
| `prompt-3.7-fix12.md` | 2.5 | Virtualise long search result lists |
| `prompt-3.7-fix13.md` | 2.6 | Queue: append-only / diffed updates |
| `prompt-3.7-fix14.md` | 2.7 | Cache localStorage settings reads |
| `prompt-3.7-fix15.md` | 2.8 | Cache album-detail progress-bar rect |
| `prompt-3.7-fix16.md` | 2.9 | Binary-search the active lyrics line |
| `prompt-3.7-fix17.md` | 2.10 | Replace focus-restore polling with observer |
| `prompt-3.7-fix18.md` | 2.11 | Coordinate image-preload response cache |
| `prompt-3.7-fix19.md` | 2.12 | NP cover: mutate `<img src>` |
| `prompt-3.7-fix20.md` | 2.13 | Top-nav idempotent re-registration |
| `prompt-3.7-fix21.md` | 3.1 | Toast: rAF instead of forced reflow |
| `prompt-3.7-fix22.md` | 3.2 | Pill initial paint: rAF over `setTimeout(0)` |
| `prompt-3.7-fix23.md` | 3.3 | Hint-bar shallow-equal early-out |
| `prompt-3.7-fix24.md` | 3.4 | MD5 helper: array-join in `rhex` |
| `prompt-3.7-fix25.md` | 3.5 | Audit paint-only `transition: background/color` |
| `prompt-3.7-fix26.md` | 3.6 | NP background blur: pre-blurred image swap |
| `prompt-3.7-fix27.md` | 3.7 | Verify AVPlay `setDisplayRect` re-set need |
| `prompt-3.7-fix28.md` | 3.8 | `--progress` CSS-var write batching |

## Source review

Full performance review at `~/.claude/plans/please-review-the-sonance-zany-frog.md`.

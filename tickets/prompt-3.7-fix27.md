# Prompt 3.7-fix27 — Item 3.7: Verify AVPlay `setDisplayRect` re-set need

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Determine whether `webapis.avplay.setDisplayRect(0, 0, 1, 1)` genuinely needs to be set on every track open, or only once per AVPlay-instance lifetime. If safe to skip per-open, do so.

## Context

- `js/player.js:359` — `setDisplayRect(0, 0, 1, 1)` is called inside `_avplayLoadAndPlay` on every track open.
- AVPlay state machine: `open → setDisplayRect → prepareAsync → play`.
- For audio-only playback, the rect is a 1×1 off-screen surface required by AVPlay (it expects video output dims even for audio).

## Task

1. **Read Tizen 5.0 AVPlay docs** (use Context7 or Samsung developer site) to confirm whether `setDisplayRect` state survives `close()` + `open()` calls. Search for the AVPlay state-machine spec.
2. If state survives across `close → open`:
   - Move the `setDisplayRect` call to a one-time init (e.g. when the AVPlay instance is first created) rather than per-track.
   - Add a guard `if (!_displayRectSet) { setDisplayRect(...); _displayRectSet = true; }`.
   - Reset `_displayRectSet = false` if the AVPlay instance is recreated.
3. If state does NOT survive: leave the per-open call but add a comment citing the doc reference.
4. Document findings in PROGRESS.md with a source link.

## Constraints

- Do not break TV playback. If in doubt, leave the per-open call and document.
- This change is browser-untestable; verification requires a TV.

## Acceptance criteria

- Documented decision in PROGRESS.md with source link.
- Either the per-open call is removed (safe per docs) or the existing call is preserved with a doc-cited comment.
- TV playback still works (audio plays, seek works, track-end fires).
- Browser Smoke Test passes (no regression in the HTML5 fallback path).

## Out of scope

- Other AVPlay lifecycle changes.
- Switching between AVPlay and HTML5 paths at runtime.

## Verification

1. (TV) Build, sideload, play 3 tracks back-to-back; confirm audio works.
2. Pause, seek, resume mid-track; confirm normal behaviour.
3. (Browser) Run the HTML5 path; Browser Smoke Test from ticket-3.7.md still passes.

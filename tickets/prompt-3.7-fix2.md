# Prompt 3.7-fix2 — Item 1.1: Throttle progress event emissions in Player

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Throttle the `progress` event emitted by the Player to a maximum cadence of ~10 Hz (≥100 ms between emissions), so downstream listeners (NP-bar, NP-screen scrubber, Album track row, Lyrics scroller, scrobble) update at most that often.

## Context

- `js/player.js:122-126` — HTML5 `timeupdate` handler: `_emit('progress', { currentTime, duration })`. Native `timeupdate` rate is ~4 Hz in HTML5 audio.
- `js/player.js:362-365` — AVPlay `oncurrentplaytime` callback emits the same `progress` event. AVPlay can fire this every ~250 ms.
- `js/player.js` `_emit(name, data)` — the dispatcher used by both backends.
- Current listeners include the NP-bar update, the NP-screen `--progress` CSS var write, the lyrics scroller's active-line update, and the scrobble check.
- The pre-load gating logic (`state.currentTime > state.duration - 5`) sits inside the HTML5 handler; throttling must not skip the boundary frame where this turns true.

## Task

1. In `js/player.js`, add a module-level `_lastProgressEmit = 0` timestamp.
2. Wrap the `_emit('progress', …)` calls (both backends) so they only emit when `Date.now() - _lastProgressEmit >= 100`. Update the timestamp on emit.
3. Move the pre-load gating block (HTML5 path) to run **before** the throttle check, so pre-load is never delayed by throttling. Same for the AVPlay path's pre-load logic if any.
4. Always emit on track-end / `onstreamcompleted` / explicit `Player.seek()` so the UI snaps to the new position immediately. Implement by passing a `force` flag to a small internal `_emitProgress(force)` helper, and using `force: true` from those callsites.
5. Reset `_lastProgressEmit = 0` whenever the Player loads a new track.

## Constraints

- Do not modify listener code in any screen. The throttle is internal to `js/player.js`.
- Do not change the shape of the `progress` event payload.
- Do not change AVPlay or HTML5 lifecycle calls.

## Acceptance criteria

- Progress event emission rate measured ≤ 10 Hz during playback (verify by adding a temporary `console.count` and removing it before commit).
- Pre-load of the next track still triggers within 5–6 s of end-of-track (no regression in gapless playback).
- Seek and track-end snap the UI immediately (no missing final or initial position frame).
- Lyrics scroller, NP scrubber, and album-row playing indicator continue to update visibly during playback.
- Browser Smoke Test passes.

## Out of scope

- Changing the rendering side of any progress listener.
- Changing scrobble timing logic beyond reading the now-throttled events.

## Verification

1. Start dev server, log in, play a track.
2. In DevTools console: `var n=0; Player.on('progress', () => n++); setTimeout(() => console.log(n), 1000);` — expect ≤ 10.
3. Seek mid-track via the NP screen; verify the scrubber jumps to the new position immediately.
4. Let a 30 s track play to its end; verify the next track auto-loads with no audible gap > 250 ms.
5. Run the full Browser Smoke Test from ticket-3.7.md.

# Prompt 3.7-fix17 — Item 2.10: Replace focus-restore polling with observer

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Replace the 50 ms × 20 polling loop in `js/app.js` (used to wait for a focus zone to register before restoring focus) with a one-shot observer registered on `FocusManager`.

## Context

- `js/app.js:1112-1126` — focus-restore polls `FocusManager.restore(snap)` every 50 ms, up to 20 attempts.
- `FocusManager.registerZone(name, …)` is the moment a zone becomes available for focus.
- Polling can add up to 1 second of delay even when the zone registers quickly, because polls run on a fixed cadence.

## Task

1. In `js/focus.js`, add a one-shot observer queue:
   - Module-level `_zoneObservers = {}` (map of `zoneName → array<callback>`).
   - Public `FocusManager.onceZoneRegistered(name, cb)`:
     - If `_zones[name]` already exists, call `cb` synchronously on a microtask (`Promise.resolve().then(cb)`).
     - Otherwise, push `cb` into `_zoneObservers[name]`.
   - In `registerZone(name, …)`, after the zone is ready, fire and clear all observers in `_zoneObservers[name]`.
2. In `js/app.js:1112-1126`, replace the polling block with a single call:
   ```js
   FocusManager.onceZoneRegistered(snap.zone, function() {
       FocusManager.restore(snap);
   });
   ```
3. Add a safety timeout of 2 s — if the zone never registers (unexpected), drop the snapshot quietly and log a warn. Implement via `setTimeout` cleared on observer fire.

## Constraints

- Do not change `FocusManager.restore` semantics.
- Do not break any other callsite that relies on `FocusManager.registerZone` (delegated zones, virtual zones).
- Microtask-on-already-registered is important so the calling code's flow remains effectively synchronous.

## Acceptance criteria

- Returning from Album / Artist detail to Library restores grid focus within 50 ms (subjective).
- Snapshots that target a never-registering zone fall through silently after 2 s.
- Browser Smoke Test passes.

## Out of scope

- Other polling loops in the codebase.
- Snapshot serialisation / persistence.

## Verification

1. Add `console.time('focusRestore')` immediately before the call in `app.js`, and `console.timeEnd('focusRestore')` inside the observer callback.
2. Navigate Library → Album → back; observe the timing in console; should be tens of ms, not hundreds.
3. Force a stale snapshot pointing at a fake zone name; confirm the warn fires after 2 s with no crash.
4. Browser Smoke Test from ticket-3.7.md.

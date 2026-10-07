# Prompt 3.7-fix20 — Item 2.13: Top-nav idempotent re-registration

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Make `FocusManager.registerZone('topnav', …)` safe against being called twice (e.g. logout → login). A second register with the same selector should no-op (or replace cleanly), not stack.

## Context

- `js/app.js:904-918` — top-nav zone registered when the app shell mounts.
- `js/focus.js:59-78` — `clearContentZones()` explicitly skips the topnav zone, so on logout/login the zone may be re-registered without being cleared first.
- After `prompt-3.7-fix4.md`, `registerZone` has element caching. A duplicate registration should not double-cache or duplicate listeners.

## Task

1. In `js/focus.js` `registerZone(name, config)`:
   - If `_zones[name]` already exists with the same `config.selector` (and same `config.virtual` flag), refresh the element cache (`prompt-3.7-fix4.md` integration) and return without re-installing any internal listeners.
   - If the selector differs, fully replace.
2. Verify the topnav-specific code in `js/app.js:904-918`:
   - Calling `registerZone('topnav', ...)` after a logout/login round trip should produce one zone entry, not two.
3. Add a small `console.warn` (`[FocusManager] Re-register of zone "{name}"`) when a duplicate registration happens — useful diagnostic, can be silenced after stabilisation.

## Constraints

- Do not change observable focus behaviour.
- Don't break any virtual-zone registration paths.

## Acceptance criteria

- Logout then login leaves exactly one topnav zone entry (verify with `console.log(Object.keys(FocusManager.__zonesForDebug))` if such a debug hook exists, or expose one for the verification step).
- D-pad still navigates the top nav after re-login.
- Browser Smoke Test passes.

## Out of scope

- Visual logout/login flow.

## Verification

1. Add a temporary `FocusManager._debugZones = function(){ return Object.keys(_zones); };` and log it after login, after logout, after re-login.
2. Confirm 'topnav' appears exactly once at each stable state.
3. Browser Smoke Test from ticket-3.7.md.

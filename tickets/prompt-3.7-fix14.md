# Prompt 3.7-fix14 — Item 2.7: Cache localStorage settings reads

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Read user settings (`sonance_volume`, `sonance_shuffle`, `sonance_repeat`, etc.) from `localStorage` once at module init and keep an in-memory mirror. Provide write-through setters so persistence is preserved without the read cost.

## Context

- `js/auth.js:20-29` — credential read paths touch `localStorage.getItem` repeatedly.
- `js/player.js:88-95` — volume / shuffle / repeat are read on each access.
- Tizen `localStorage` is synchronous and not free; repeated `getItem` calls show up in profiles.

## Task

1. In each module that reads settings from `localStorage`:
   - On module init, populate module-locals from `localStorage.getItem(...)`.
   - Provide `getX()` / `setX(v)` wrappers. `setX` updates the local AND `localStorage.setItem`.
   - Replace direct `localStorage.getItem(...)` reads at hot callsites with the local accessor.
2. Specifically:
   - `js/player.js`: `volume`, `shuffle`, `repeat` — module-level `_volume`, `_shuffle`, `_repeat`.
   - `js/auth.js`: `sonance_session` and similar — already cached in some places; ensure all reads route through the cache.
3. Wrap `localStorage.setItem` in `try/catch` to swallow quota errors silently.
4. Do not cache anything that can be modified by another tab/process (server URL is stable per session; user must logout to change it).

## Constraints

- Do not change the keys used in `localStorage`.
- Persistence semantics unchanged: a `setVolume(0.7)` followed by an app reload still restores 0.7.
- Do not break `prompt-3.7-fix6.md` (localStorage TTL cache for API metadata) — that uses different keys.

## Acceptance criteria

- After app warm-up, a 60-second playback session shows zero `localStorage.getItem('sonance_volume')` calls (verify by stubbing `localStorage.getItem`).
- Setting volume / shuffle / repeat still persists across reloads.
- Browser Smoke Test passes.

## Out of scope

- Settings UI changes.
- Cross-tab sync (the app does not run in multiple tabs).

## Verification

1. In DevTools console: `var origGet = localStorage.getItem; var n = 0; localStorage.getItem = function(k) { if (k.startsWith('sonance_')) n++; return origGet.apply(localStorage, arguments); };` — log `n` after navigating around for a minute. Should be near-zero post-init.
2. Set volume to 0.5, reload; volume restored.
3. Browser Smoke Test from ticket-3.7.md.

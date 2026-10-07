# Prompt 3.7-fix9 — Item 2.2: Stop re-registering Library Artists zone per chunk

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

When chunked-rendering the Artists tab (the ≤80 case in `js/screens/library.js`), register the focus zone once after the final chunk completes, not after every chunk.

## Context

- `js/screens/library.js:573-600` — chunked render path: 50 artists per `requestAnimationFrame`. Each chunk calls a function that includes `_registerGridZone()` so newly-appended cards become focusable.
- `_registerGridZone()` ultimately calls `FocusManager.registerZone(...)` which (after `prompt-3.7-fix4.md`) caches a `querySelectorAll`. Re-registering per chunk wastes that cache.
- Virtual grid path (>80 artists) is unaffected — it has its own zone setup.

## Task

1. In the chunked-render closure, introduce a `_chunkedZoneRegistered` flag.
2. Skip `_registerGridZone()` calls inside `appendChunk()`.
3. After the loop completes (final chunk has been appended), call `_registerGridZone()` exactly once.
4. If the user navigates away mid-chunk (screen `deactivate()` fires), reset `_chunkedZoneRegistered = false` so a re-entry re-registers correctly.
5. Confirm focus behaviour: while chunks are still appending, the user cannot navigate to a not-yet-rendered card. This is current behaviour (the zone hasn't been updated yet), so pre-fix and post-fix users see identical interaction during the chunked load — only the cost changes.

## Constraints

- Do not change the chunk size, chunk pacing (rAF), or chunk content.
- Do not affect the virtual-grid path.
- The flag must reset if the user leaves the tab and re-enters.

## Acceptance criteria

- During a chunked render of 80 artists (~2 chunks), `FocusManager.registerZone` is called exactly once for that grid (verify with a temporary `console.count` inside `registerZone`).
- D-pad navigation works once the final chunk lands.
- Browser Smoke Test passes.

## Out of scope

- The virtual-grid path.
- Chunk pacing changes.

## Verification

1. Add `console.count('registerZone:artists')` inside the artists `_registerGridZone` callsite (or generic `console.count('registerZone')` in `FocusManager.registerZone` filtered by name).
2. Visit Library → Artists with a library that has between 30 and 80 artists.
3. Confirm exactly one `registerZone:artists` log per visit (not per chunk).
4. Navigate to another tab and back; confirm one fresh registration on re-entry.
5. Browser Smoke Test from ticket-3.7.md.

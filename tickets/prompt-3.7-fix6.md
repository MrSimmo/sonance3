# Prompt 3.7-fix6 — Item 1.7: localStorage TTL for static metadata

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Add a localStorage-backed second tier to `SubsonicAPI._cachedRequest`, so artists / genres / playlists / music-folders survive across cold app launches and act as an offline fallback.

## Context

- `js/api.js:92-104` — `_cachedRequest(endpoint, params)` is the existing in-memory LRU keyed `endpoint + '|' + JSON.stringify(params)`, with `CACHE_TTL` (5 min). Survives the app session but is wiped on cold boot.
- Endpoints that should benefit (rarely change): `getArtists.view`, `getGenres.view`, `getPlaylists.view`, `getMusicFolders.view`, and the alphabetical first page of `getAlbumList2.view`.
- Auth context is per-user; localStorage scope must include the username + server URL to avoid cross-account leak.
- Storage budget on Tizen WebView is ample for these JSON blobs.

## Task

1. Add module-level constants in `js/api.js`:
   - `LS_PREFIX = 'sonance_apicache_v1__'`
   - `LS_TTL = 24 * 60 * 60 * 1000` (24 h)
   - `LS_ALLOWLIST = ['getArtists.view', 'getGenres.view', 'getPlaylists.view', 'getMusicFolders.view']` plus a special-case for `getAlbumList2.view` only when `params.type === 'alphabeticalByName'` and `(params.offset||0) === 0`.
2. Helper `_lsKey(endpoint, params)` returns `LS_PREFIX + this.username + '|' + this.serverUrl + '|' + endpoint + '|' + JSON.stringify(params || {})`.
3. Helper `_lsRead(key)` returns `{ data, time }` parsed from `localStorage.getItem(key)`, or `null` if missing or unparseable.
4. Helper `_lsWrite(key, data)` calls `localStorage.setItem(key, JSON.stringify({ data: data, time: Date.now() }))`. Wrap in try/catch — quota errors must not crash the app.
5. Modify `_cachedRequest`:
   - On entry, check in-memory cache (existing behaviour).
   - On in-memory miss, if `endpoint` (and params) match `LS_ALLOWLIST`, check localStorage. If a valid (≤24 h) entry exists, populate the in-memory cache from it and resolve.
   - On network success, both update the in-memory cache (existing) and call `_lsWrite` if endpoint is allowlisted.
   - On network failure, if a stale (>24 h) localStorage entry exists, return it with a console warn (`[Sonance][API] Stale cache served for <endpoint>`) — this is the offline fallback.
6. On logout (find the existing logout flow in `js/auth.js`), clear all keys with prefix `LS_PREFIX` for the current user (use `localStorage.removeItem` after gathering matching keys).

## Constraints

- Do not cache responses that include personal mutable state (e.g. `getStarred`, search results, scrobble responses). Only the listed allowlist.
- Do not store stream URLs or auth tokens.
- Bust the cache on credential change: include username + serverUrl in the key.
- Catch JSON parse errors and quota errors silently.

## Acceptance criteria

- Cold app launch on a previously-warmed cache shows Library tabs (Artists, Genres) populated synchronously, before any network round-trip completes.
- Disconnect Wi-Fi mid-session and re-launch the app; tabs still render from stale cache with a console warn.
- Logging out and back in as a different user does not show the previous user's data.
- No regression in fresh data — when network is healthy, in-memory cache TTL still controls within-session refresh.
- Browser Smoke Test passes.

## Out of scope

- Caching the per-album track list.
- Caching cover-art binaries (keep `ImageCache` in `js/image-cache.js` unchanged).
- Background refresh / stale-while-revalidate.

## Verification

1. Run the app, navigate to Library → Artists, confirm population.
2. Hard-reload (Cmd-R). Confirm Artists tab paints instantly without a network call (DevTools Network tab).
3. Open DevTools `localStorage` and verify keys with `sonance_apicache_v1__` prefix.
4. Log out, log in as a different test user (if available) or change `localStorage.clear()` and confirm fresh fetch.
5. Browser Smoke Test from ticket-3.7.md.

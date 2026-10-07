# Prompt 3.7 — Item 1.6: Bundle and minify JS for the widget build

**Parent ticket:** `tickets/ticket-3.7.md` — read it first for the full V3.7 scope, constraints, and Browser Smoke Test definition.

## Objective

Replace the 11 separate `<script>` tags in `index.html` with one (or two) concatenated, minified JS bundles produced by an updated `build.sh`, cutting cold-boot parse time on the Tizen TV.

## Context

- `index.html:23-41` — 11 sequential `<script src=…>` tags with `?v=v3-6-fix5` cache-bust querystrings.
- Files load in this dependency order: `utils.js`, `api.js`, `auth.js`, `focus.js`, `player.js`, `starred.js`, `image-cache.js`, `components.js`, then `screens/login.js`, `home.js`, `library.js`, `album.js`, `artist.js`, `search.js`, `nowplaying.js`, `queue.js`, `playlists.js`, `settings.js`, then `app.js`.
- `build.sh` currently zips the project root into `Sonance.wgt`.
- All JS is ES2017, plain `var`, no modules.

## Task

1. Add a build step to `build.sh` that concatenates JS in dependency order into two files:
   - `js/sonance-core.min.js` — `utils.js`, `api.js`, `auth.js`, `focus.js`, `player.js`, `starred.js`, `image-cache.js`, `components.js`
   - `js/sonance-screens.min.js` — every `screens/*.js` then `app.js` last
2. Minify each with `terser --ecma 2017 --compress --mangle` (no ES2020+ output). If `terser` is not installed locally, the build script should `npm install --no-save terser` (or use `npx terser`) only as a build-time helper. Confirm with the user before installing.
3. Update `index.html` to load only the two `.min.js` files (in core → screens order) plus the AVPlay `webapis.js` script that already loads. Remove the 11 individual tags. Bump cache-bust querystring to `?v=v3-7`.
4. Add a small `dev` mode hatch: if `build.sh` is invoked with `--dev`, it should restore the unbundled `<script>` tags so browser testing keeps source-mapped breakpoints. Implement this with two `index.html` template variants or a sed-based swap; do not break the default build.
5. Verify the produced `.wgt` still includes only the bundled JS files plus the `screens/` and other JS sources (sources can stay in the zip or be excluded — your choice; document in PROGRESS.md).

## Constraints

- No optional chaining (`?.`) or nullish coalescing (`??`) in *output*. Verify by `grep -n '\?\.\|??' js/sonance-*.min.js`.
- Source files keep their current ES2017 form; only the bundle is minified.
- No runtime npm dependencies introduced. Terser is build-time only.
- Do not modify any `.js` source file in this prompt. Only `build.sh` and `index.html`.

## Acceptance criteria

- `build.sh` produces `js/sonance-core.min.js` and `js/sonance-screens.min.js` and a fresh `Sonance.wgt`.
- `index.html` has at most 3 `<script>` tags total: AVPlay `webapis.js`, `sonance-core.min.js`, `sonance-screens.min.js`.
- App loads and runs the full Browser Smoke Test (see ticket-3.7.md) with no console errors and no visual regressions.
- Output minified bundle size is reported in PROGRESS.md (gzipped if possible).
- `build.sh --dev` round-trips back to unbundled mode and restores the 11 script tags.

## Out of scope

- CSS minification.
- Service-worker / cache-API changes.
- Source-map publishing in the `.wgt` (keep maps local-only).

## Verification

1. Run `./build.sh`; confirm bundles appear in `js/`.
2. Run `python3 -m http.server 8080` and complete the Browser Smoke Test from ticket-3.7.md.
3. `grep -nE '\?\.|\?\?' js/sonance-core.min.js js/sonance-screens.min.js` must return zero hits.
4. Inspect `Sonance.wgt` contents: `unzip -l Sonance.wgt | head`.
5. (TV) Sideload via Jellyfin2Samsung, confirm cold launch is at least as fast as V3-6-fix5 (subjective). Note timing in PROGRESS.md.

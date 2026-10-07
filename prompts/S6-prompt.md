You are building Sonance — a music player app for Samsung Tizen TVs that connects to Navidrome via the Subsonic REST API. This is Phase S6: Polish, Browser Testing & .wgt Packaging.

## Test Configuration (use these values, do not prompt for them)
- Test Navidrome server: http://192.168.0.2:4534
- Dev server: `python3 -m http.server 8080`
- Browser testing at: http://localhost:8080

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read docs/UI-MOCKUP-REFERENCE.md for pixel-perfect comparison
3. Read tickets/S6-polish-packaging.md for the detailed task list
4. Read PROGRESS.md to see current state and any known bugs from S1-S5

THIS PHASE IS ABOUT:
1. Visual polish — comparing every screen against the mockup spec and fixing discrepancies
2. Focus navigation audit — testing every screen keyboard-only, finding and fixing focus traps
3. Playback robustness — edge cases, error handling, long playback sessions
4. Building the browser test harness
5. Building the Settings screen properly
6. Packaging as .wgt for TV deployment

IMPORTANT RULES:
- Vanilla JS only. Target ES2017 (no ?., ??, top-level await, Array.flat(), Object.fromEntries()).
- CSS: Do NOT use `backdrop-filter` anywhere — it is not supported on Tizen 5.0. Replace any instances with solid semi-transparent backgrounds.
- No external network requests — verify no CDN links, external fonts, or third-party URLs exist anywhere in the codebase.
- Do NOT refactor or restructure working code unless fixing a specific bug.
- Do NOT add new features not specified in the tickets.
- Focus on quality, not quantity. Every pixel matters for a TV app.
- The build.sh script must exclude docs/, tests/, tickets/, prompts/, PROGRESS.md, CLAUDE.md from the .wgt.
- The .wgt is just a zip file renamed. It must contain: config.xml, icon.png, index.html, css/, js/ — nothing else.
- config.xml must include privileges: internet, tv.audio, volume.set.
- Create docs/DEPLOYMENT.md with step-by-step instructions for deploying to the Q90R via Jellyfin2Samsung.
- Run autonomously — do not stop to ask questions. Make pragmatic choices and document in PROGRESS.md.

START BY reading all documents, then do a visual audit of every screen against the mockup. Fix issues before moving to testing.

When complete:
- Every screen matches the UI mockup spec
- D-pad navigation works flawlessly (no traps, no dead zones)
- Full album playback works end-to-end
- Browser test harness passes all tests
- build.sh produces valid Sonance.wgt
- DEPLOYMENT.md has complete instructions
- PROGRESS.md fully updated

Update PROGRESS.md with final status.

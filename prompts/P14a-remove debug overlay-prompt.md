You are patching Sonance — a music player app for Samsung Tizen TVs. This is a quick cleanup: remove the P13c debug overlay.

BEFORE WRITING ANY CODE:
1. Read js/app.js — find the debug overlay code

## THE TASK
Remove the persistent debug overlay that was added in P13c. Find and delete:
- The `playerDebug` div creation (element with id `player-debug`)
- The `setInterval` that updates it every 500ms
- Any related variables

This is in `js/app.js`, added after the app shell renders.

That's it. Nothing else changes. Rebuild Sonance.wgt when done. Update PROGRESS.md.

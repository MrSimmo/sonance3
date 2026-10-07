You are patching Sonance — a music player app for Samsung Tizen TVs. This is Patch P2: Generate the app icon.

## Test Configuration (use these values, do not prompt for them)
- Dev server: `python3 -m http.server 8080`

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md for project rules
2. Read tickets/P2-app-icon.md for the full design spec and SVG source
3. Read PROGRESS.md for current state

THIS IS A TARGETED ASSET FIX. Only replace `icon.png`. Do not modify any other source files.

THE TASK:
Generate a 256×256 PNG app icon and replace the placeholder `icon.png`. The design is a stylised "S" made from sound wave arcs on a pink-to-purple gradient background with rounded corners. The exact SVG source is provided in the ticket — convert it to PNG.

APPROACH:
1. Check if `cairosvg` is available. If not, ask the user for permission to install it (`pip install cairosvg --break-system-packages`). Also check for Pillow (`pip install Pillow --break-system-packages`).
2. Write the SVG from the ticket to a temp file
3. Convert to 256×256 PNG using cairosvg
4. Save as `icon.png` in the project root, overwriting the placeholder
5. Verify dimensions and file size
6. Run `bash build.sh` to rebuild Sonance.wgt with the new icon

Run autonomously except for the package installation step — ask for confirmation before installing cairosvg/Pillow.

Update PROGRESS.md when done.

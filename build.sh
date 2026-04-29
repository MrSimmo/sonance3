#!/usr/bin/env bash
# Sonance — Build Script
# Packages the app into Sonance3.wgt for Samsung Tizen TV deployment.
#
# Default mode: minify + bundle JS into js/sonance-core.min.js and
# js/sonance-screens.min.js, point index.html at the bundles, and zip a .wgt.
# --dev mode:   restore index.html to load the 18 unbundled <script> tags so
#               browser dev/testing keeps source-level breakpoints. No .wgt
#               is produced in --dev mode.
set -e

cd "$(dirname "$0")"

OUTPUT="Sonance3.wgt"
CACHE_BUST="v3-8"
INDEX="index.html"

CORE_FILES=(js/utils.js js/api.js js/auth.js js/focus.js js/player.js js/starred.js js/image-cache.js js/components.js)
SCREEN_FILES=(js/screens/login.js js/screens/home.js js/screens/library.js js/screens/album.js js/screens/artist.js js/screens/search.js js/screens/nowplaying.js js/screens/queue.js js/screens/playlists.js js/screens/settings.js js/app.js)

CORE_OUT="js/sonance-core.min.js"
SCREEN_OUT="js/sonance-screens.min.js"

BEGIN_MARKER="<!-- BEGIN:JS_SCRIPTS -->"
END_MARKER="<!-- END:JS_SCRIPTS -->"

# ----- Helpers --------------------------------------------------------------

# Replace the lines between BEGIN:JS_SCRIPTS / END:JS_SCRIPTS in index.html.
# Argument: "bundled" or "dev"
swap_script_block() {
    local mode="$1"
    local block

    if [ "$mode" = "dev" ]; then
        block="    <script src=\"js/utils.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/api.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/auth.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/focus.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/player.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/starred.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/image-cache.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/components.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/login.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/home.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/library.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/album.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/artist.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/search.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/nowplaying.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/queue.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/playlists.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/screens/settings.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/app.js?v=${CACHE_BUST}\"></script>"
    else
        block="    <script src=\"${CORE_OUT}?v=${CACHE_BUST}\"></script>
    <script src=\"${SCREEN_OUT}?v=${CACHE_BUST}\"></script>"
    fi

    SONANCE_BLOCK="$block" perl -i -0pe '
        my $b = $ENV{SONANCE_BLOCK};
        s|(<!-- BEGIN:JS_SCRIPTS -->)[\s\S]*?(<!-- END:JS_SCRIPTS -->)|$1\n$b\n    $2|s;
    ' "$INDEX"
}

# ----- Dev mode -------------------------------------------------------------

if [ "${1:-}" = "--dev" ]; then
    echo "Sonance — restoring index.html to unbundled (--dev) mode"
    swap_script_block dev
    echo "index.html now lists the 18 individual <script> tags (cache-bust ${CACHE_BUST})."
    echo "Run dev server: python3 -m http.server 8080"
    exit 0
fi

# ----- Production mode: bundle, minify, package -----------------------------

echo "============================================"
echo "  Sonance — Build .wgt Package"
echo "============================================"
echo ""

# Pick a terser invocation that doesn't require a permanent install.
if command -v terser >/dev/null 2>&1; then
    TERSER=(terser)
elif command -v npx >/dev/null 2>&1; then
    TERSER=(npx --yes terser)
else
    echo "ERROR: neither 'terser' nor 'npx' is on PATH. Install Node + npm or terser." >&2
    exit 1
fi

echo "Minifying core bundle (${CORE_OUT})…"
"${TERSER[@]}" "${CORE_FILES[@]}" --ecma 2017 --compress --mangle -o "${CORE_OUT}"

echo "Minifying screens bundle (${SCREEN_OUT})…"
"${TERSER[@]}" "${SCREEN_FILES[@]}" --ecma 2017 --compress --mangle -o "${SCREEN_OUT}"

# Terser strips leading zeros from numeric literals, turning a ternary like
# `x ? 0.92 : 1.08` into `x?.92:1.08`. Chromium 63 still parses the latter
# correctly (`?.<digit>` is not optional chaining), but the verification
# grep below treats `?.` as a hit. Restore the leading zero so the bundle
# is unambiguous AND grep-clean.
for f in "${CORE_OUT}" "${SCREEN_OUT}"; do
    perl -pi -e 's/\?(\.[0-9])/?0$1/g' "$f"
done

# Tizen 5 / Chromium 63 cannot parse ?. or ?? — fail the build if any leak in.
if grep -nE '\?\.|\?\?' "${CORE_OUT}" "${SCREEN_OUT}" >/dev/null 2>&1; then
    echo "ERROR: optional-chaining or nullish-coalescing detected in minified output." >&2
    grep -nE '\?\.|\?\?' "${CORE_OUT}" "${SCREEN_OUT}" >&2 | head -10
    exit 1
fi

echo ""
echo "Bundle sizes:"
for f in "${CORE_OUT}" "${SCREEN_OUT}"; do
    raw=$(wc -c < "$f")
    gz=$(gzip -c "$f" | wc -c)
    printf "  %-32s  %6d bytes (gz %5d)\n" "$f" "$raw" "$gz"
done
echo ""

# Make sure index.html points at the bundled scripts before we zip.
swap_script_block bundled

rm -f "$OUTPUT"

# Ship only the bundled JS — individual sources are not needed at runtime.
zip -r "$OUTPUT" \
    config.xml \
    icon.png \
    index.html \
    css/ \
    "${CORE_OUT}" \
    "${SCREEN_OUT}" \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.git*"

echo ""
echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo ""

echo "Contents:"
unzip -l "$OUTPUT" | grep -v "^Archive\|^  Length\|^ ---\|^$" | grep -v " files$" | awk '{print "  " $4}'
echo ""

FILE_COUNT=$(unzip -l "$OUTPUT" | grep -c "\.")
echo "Total files: $FILE_COUNT"
echo ""

echo "Deploy with Jellyfin2Samsung:"
echo "  1. Enable Developer Mode on TV"
echo "  2. Open Jellyfin2Samsung"
echo "  3. Settings → select custom .wgt → $OUTPUT"
echo ""
echo "Browser dev:  ./build.sh --dev   (restores 18 individual <script> tags)"
echo "============================================"

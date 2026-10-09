#!/usr/bin/env bash
# Sonance — Build Script
# Packages the app into Sonance3.wgt (square launcher icon) and
# Sonance3-Oblong.wgt (wide home-row tile) for Samsung Tizen TV deployment.
#
# Default mode: minify + bundle JS into js/sonance-core.min.js and
# js/sonance-screens.min.js, point index.html at the bundles, and zip a .wgt.
# --dev mode:   restore index.html to load the 21 unbundled <script> tags so
#               browser dev/testing keeps source-level breakpoints. No .wgt
#               is produced in --dev mode.
set -e

cd "$(dirname "$0")"

OUTPUT="Sonance3.wgt"
OUTPUT_OBLONG="Sonance3-Oblong.wgt"
OBLONG_ICON="icon-oblong-1920.png"
CACHE_BUST="v3-12"
INDEX="index.html"

# D59 (v3.10 R12, supersedes D46): the oblong home-row tile is a second
# package, identical to the square one except that the icon.png INSIDE it is
# icon-oblong-1920.png — a 1920 x 1080, opaque, full-bleed 16:9 image.
# config.xml is the same file in both (a bare <icon src="icon.png"/>, no
# width/height, the same tizen:application id), so installing either package
# replaces the other. Evidence: Litefin (github.com/MoazSalem/litefin, branch
# development) builds its normal-oblong variant exactly this way — its
# webpack config copies assets/icon_oblong.png (1920 x 1080, opaque) over
# assets/icon.png and nothing else changes. D46 was right that v3.9's
# 512 x 423 rounded, transparent icon-oblong.png is a Seller Office store
# asset, and wrong that no wide launcher tile is possible. That file is not
# used here and is kept for a future store listing. The variant is staged in
# a temp directory: icon.png and icon-oblong.png in the working tree are
# never modified or swapped.
#
# D163 (v3.11): confirmed on the user's Q90R — this oblong package gives a
# wide home-row tile (the first V3.10-fix1 install had shown a square one).
# The v3.10-fix2 diagnostic package (D161: a new app id and the tv-samsung
# profile) was not needed and is no longer built.

CORE_FILES=(js/utils.js js/api.js js/auth.js js/focus.js js/player.js js/starred.js js/image-cache.js js/components.js js/options-sheet.js js/perf-hud.js)
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
    <script src=\"js/options-sheet.js?v=${CACHE_BUST}\"></script>
    <script src=\"js/perf-hud.js?v=${CACHE_BUST}\"></script>
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
    echo "index.html now lists the 21 individual <script> tags (cache-bust ${CACHE_BUST})."
    echo "Run dev server: node tests/dev-server.js 8091"
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

# V3.9 T11: minify the CSS into the package only. css/styles.css itself is
# left untouched, the same way the JS bundles are separate files from their
# sources — dev/browser testing keeps readable CSS and source line numbers.
# clean-css is run through npx like terser, so nothing is installed into the
# project and no package.json is created.
ROOT="$(pwd)"
CSS_STAGE="$(mktemp -d)"
mkdir -p "$CSS_STAGE/css"

CLEANCSS_CMD=""
if command -v cleancss >/dev/null 2>&1; then
    CLEANCSS_CMD="cleancss"
elif command -v npx >/dev/null 2>&1; then
    CLEANCSS_CMD="npx --yes clean-css-cli"
fi

echo "Minifying CSS into the package…"
for f in css/*.css; do
    base="$(basename "$f")"
    out="$CSS_STAGE/css/$base"
    minified=0
    if [ -n "$CLEANCSS_CMD" ]; then
        if $CLEANCSS_CMD -o "$out" "$f" >/dev/null 2>&1 && [ -s "$out" ]; then
            minified=1
        fi
    fi
    if [ "$minified" -eq 0 ]; then
        echo "  NOTE: CSS minifier unavailable or failed — shipping $f as-is."
        cp "$f" "$out"
    fi
    raw=$(wc -c < "$f")
    min=$(wc -c < "$out")
    rgz=$(gzip -c "$f" | wc -c)
    mgz=$(gzip -c "$out" | wc -c)
    printf "  %-24s %6d -> %6d bytes (gz %5d -> %5d)\n" "$base" "$raw" "$min" "$rgz" "$mgz"
done

# Tizen 5 / Chromium 63 cannot use these, and prior sessions removed them
# deliberately — fail the build if the minifier reintroduced any.
if grep -nE 'backdrop-filter|transition: *all|(^|[^-a-z])gap:' "$CSS_STAGE"/css/*.css >/dev/null 2>&1; then
    echo "ERROR: minified CSS contains backdrop-filter, transition:all or a bare gap:." >&2
    grep -nE 'backdrop-filter|transition: *all|(^|[^-a-z])gap:' "$CSS_STAGE"/css/*.css >&2 | head -10
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

# zip only warns ("name not matched") on a missing file and would ship a
# package with no launcher icon, so check both icons first (v3.10 S1 found
# icon.png swept out of the project root).
for f in icon.png "$OBLONG_ICON"; do
    if [ ! -s "$f" ]; then
        echo "ERROR: $f is missing from the project root." >&2
        exit 1
    fi
done

rm -f "$OUTPUT"

# Ship only the bundled JS — individual sources are not needed at runtime.
zip -r "$OUTPUT" \
    config.xml \
    icon.png \
    index.html \
    "${CORE_OUT}" \
    "${SCREEN_OUT}" \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.git*"

# css/ comes from the minify staging directory, not the working tree.
( cd "$CSS_STAGE" && zip -r -q "$ROOT/$OUTPUT" css -x "*.DS_Store" )

# D59: the oblong variant. Same members, same bytes, except icon.png, which is
# icon-oblong-1920.png. Staged in its own temp directory — never by swapping
# files in the working tree.
OBLONG_STAGE="$(mktemp -d)"
mkdir -p "$OBLONG_STAGE/js"
cp config.xml index.html "$OBLONG_STAGE/"
cp "$OBLONG_ICON" "$OBLONG_STAGE/icon.png"
cp "${CORE_OUT}" "${SCREEN_OUT}" "$OBLONG_STAGE/js/"
cp -R "$CSS_STAGE/css" "$OBLONG_STAGE/css"
rm -f "$OUTPUT_OBLONG"
( cd "$OBLONG_STAGE" && zip -r -q "$ROOT/$OUTPUT_OBLONG" config.xml icon.png index.html "${CORE_OUT}" "${SCREEN_OUT}" css -x "*.DS_Store" )
rm -rf "$OBLONG_STAGE"

echo ""
echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo "Built: $OUTPUT_OBLONG ($(du -h "$OUTPUT_OBLONG" | cut -f1)) — same app, 1920x1080 home-row icon"
echo ""

echo "Contents:"
unzip -l "$OUTPUT" | grep -v "^Archive\|^  Length\|^ ---\|^$" | grep -v " files$" | awk '{print "  " $4}'
echo ""

FILE_COUNT=$(unzip -l "$OUTPUT" | grep -c "\.")
echo "Total files: $FILE_COUNT"
echo ""

echo "Deploy with Jellyfin2Samsung — install ONE of the two packages:"
echo "  $OUTPUT         square launcher icon (default)"
echo "  $OUTPUT_OBLONG  wide 16:9 home-row tile; same app id, so it replaces the other"
echo "  1. Enable Developer Mode on TV"
echo "  2. Open Jellyfin2Samsung"
echo "  3. Settings → select custom .wgt → $OUTPUT (or $OUTPUT_OBLONG)"
echo ""
rm -rf "$CSS_STAGE"

echo "Browser dev:  ./build.sh --dev   (restores 21 individual <script> tags)"
echo "============================================"

// Sonance R4 geometry checks (v3.10 Session 2, ticket-3.10 §7 R4).
//
// Plain CommonJS like sonance.js: e2e/ui-scale.spec.ts and
// tests/tools/visual-baseline.js (--geometry) both use it. `measure(page)`
// reads the live page and returns every R4 check that applies to the current
// screen, plus a `problems` list; an empty list means the state passes.
//
// Checks (all in px, at the applied root size):
// - no horizontal overflow: #page-current scrollWidth <= clientWidth; no
//   clipping container (overflow-x not visible) whose content is wider than
//   it, except text truncated by design (text-overflow: ellipsis) and the
//   Home carousels (.home-row, overflow-x: auto since V3-4, D68), for which
//   the focused card must instead be fully inside the row and the viewport;
//   no rendered element past the viewport's left or right edge;
// - the focused element is inside the viewport;
// - top-nav pill rect = the selected item's rect, +-1 px (left, width);
// - Library sub-nav pill = its selected item, +-1 px (top, height);
// - Albums grid: VirtualGrid columns = CSS-resolved grid-template-columns
//   count (and the same reported for Artists);
// - lyrics open: .np-left left edge 6-10 rem from the viewport's left;
// - NP bar height 7.6 rem; #page-container top 8 rem / bottom 7.6 rem (0
//   when .no-nav / .no-np-bar), +-1 px.

'use strict';

/**
 * Record every VirtualGrid instance as it initialises (window.__vgs). The
 * grids are module-private in the screens (prompt-3.10 A4 trap), so this is
 * the only way to read the column count a grid is actually using.
 */
function installProbes(page) {
    return page.addInitScript(function() {
        window.__vgs = [];
        document.addEventListener('DOMContentLoaded', function() {
            if (typeof SonanceUtils === 'undefined' || !SonanceUtils.VirtualGrid) return;
            var proto = SonanceUtils.VirtualGrid.prototype;
            var orig = proto.init;
            proto.init = function() {
                window.__vgs.push(this);
                return orig.apply(this, arguments);
            };
        });
    });
}

/**
 * Wait for a settled frame: no transition ghost on screen and no CSS
 * transition running (the nav pill animates for 0.25 s after boot and after
 * every move; zoom ghosts live for 280 ms). The geometry checks describe the
 * layout at rest, so they must not sample a frame mid-animation.
 * CSS animations (the equaliser's infinite keyframes) are not waited for.
 */
async function settled(page, timeout) {
    await page.waitForFunction(function() {
        if (document.querySelector('.page-ghost')) return false;
        if (!document.getAnimations) return true;
        return document.getAnimations().every(function(a) {
            return a.constructor.name !== 'CSSTransition' || a.playState !== 'running';
        });
    }, null, { timeout: timeout || 3000, polling: 50 });
}

function measure(page) {
    return page.evaluate(function() {
        var W = window.innerWidth, VH = window.innerHeight;
        var remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
        var out = {
            screen: typeof App !== 'undefined' ? App.getCurrentScreen() : null,
            rootPx: remPx,
            problems: []
        };
        function desc(el) {
            var s = el.tagName.toLowerCase();
            if (el.id) s += '#' + el.id;
            if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).join('.');
            return s;
        }
        function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1 : tol); }
        function rendered(el) { return el.getClientRects().length > 0; }

        // 1. Horizontal overflow. R4 asks whether the layout fits at the
        // larger sizes, so the focused element's own focus transform (cards
        // scale 1.08, rows 1.02-1.03 from the left edge, swatches 1.15) is
        // neutralised for the layout reads below. What that transform does to
        // the focused element is reported separately as `focusClip`: px of
        // the focused element's settled, transformed box (plus nothing else)
        // cut off by each clipping ancestor, per side. Informational: it
        // belongs to the focus styles (S3, R6), and most of it is identical
        // in proportion at 100 %.
        var fEl = typeof FocusManager !== 'undefined' ? FocusManager.getCurrentFocused() : null;
        var saved = null;
        out.focusClip = [];
        if (fEl && fEl.style && fEl.isConnected && rendered(fEl)) {
            var tr = fEl.getBoundingClientRect();
            for (var a = fEl.parentElement; a && a !== document.body; a = a.parentElement) {
                var acs = getComputedStyle(a);
                var ar = a.getBoundingClientRect();
                var sides = [];
                if (acs.overflowX !== 'visible') {
                    if (ar.left - tr.left > 0.5) sides.push('left ' + (ar.left - tr.left).toFixed(1));
                    if (tr.right - ar.right > 0.5) sides.push('right ' + (tr.right - ar.right).toFixed(1));
                }
                if (acs.overflowY !== 'visible') {
                    if (ar.top - tr.top > 0.5) sides.push('top ' + (ar.top - tr.top).toFixed(1));
                    if (tr.bottom - ar.bottom > 0.5) sides.push('bottom ' + (tr.bottom - ar.bottom).toFixed(1));
                }
                if (sides.length) out.focusClip.push(desc(a) + ' clips the focused ' + desc(fEl) + ': ' + sides.join(', ') + ' px');
            }
            saved = { transition: fEl.style.transition, transform: fEl.style.transform };
            fEl.style.transition = 'none';
            fEl.style.transform = 'none';
        }
        var pc = document.getElementById('page-current');
        if (pc) {
            out.pageLayer = { scrollWidth: pc.scrollWidth, clientWidth: pc.clientWidth };
            if (pc.scrollWidth > pc.clientWidth) {
                out.problems.push('page-current scrollWidth ' + pc.scrollWidth + ' > clientWidth ' + pc.clientWidth);
            }
        }
        out.carousels = [];
        var all = document.querySelectorAll('#app *');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (!rendered(el)) continue;
            if (el.closest('.page-ghost')) continue;
            var cs = getComputedStyle(el);
            if (cs.visibility === 'hidden') continue;
            // .np-screen is exempt from the scrollWidth test only: its
            // content is wider than the viewport by design (the D47 150 %
            // backdrop overscan and the closed lyrics panel). Every other
            // descendant still goes through the off-viewport test below,
            // which is what would catch a real overflow on that full-bleed
            // screen.
            if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('np-screen')) {
                if (el.classList.contains('home-row')) {
                    out.carousels.push({ id: el.id, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
                } else if (cs.textOverflow !== 'ellipsis') {
                    out.problems.push('clips ' + desc(el) + ' scrollWidth ' + el.scrollWidth + ' > ' + el.clientWidth);
                }
            }
            if (el.closest('.home-row')) continue;
            var r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.right > W + 1 || r.left < -1) {
                // Intentionally off-screen: the closed lyrics panel sits at
                // translateX(100%) until opened, and the NP backdrop is a
                // 150 % overscan box at -25 % (D47). v3.10 S6 (R7): the
                // closed credits panel too.
                if (el.closest('.np-lyrics-panel') && !el.closest('.lyrics-active')) continue;
                if (el.closest('.np-credits-panel') && !el.closest('.credits-active')) continue;
                if (el.classList.contains('np-bg-image')) continue;
                out.problems.push('off-viewport ' + desc(el) + ' left ' + Math.round(r.left) + ' right ' + Math.round(r.right));
            }
        }

        // 2. The focused element is on screen (and, in a carousel, inside it),
        // judged on its layout box: its focus transform is still neutralised.
        var f = typeof FocusManager !== 'undefined' ? FocusManager.getCurrentFocused() : null;
        if (f && f.isConnected && rendered(f)) {
            var fr = f.getBoundingClientRect();
            out.focused = { el: desc(f), left: Math.round(fr.left), right: Math.round(fr.right), top: Math.round(fr.top), bottom: Math.round(fr.bottom) };
            if (fr.left < -1 || fr.right > W + 1 || fr.top < -1 || fr.bottom > VH + 1) {
                out.problems.push('focused element off screen: ' + desc(f) + ' ' + JSON.stringify(out.focused));
            }
            // Inside every clipping ancestor, so not cut off by a scroll
            // container or a carousel even when it is inside the viewport.
            for (var anc = f.parentElement; anc && anc !== document.body; anc = anc.parentElement) {
                var ancs = getComputedStyle(anc);
                if (ancs.overflowX === 'visible' && ancs.overflowY === 'visible') continue;
                var arr = anc.getBoundingClientRect();
                var cutX = ancs.overflowX !== 'visible' && (fr.left < arr.left - 1 || fr.right > arr.right + 1);
                var cutY = ancs.overflowY !== 'visible' && (fr.top < arr.top - 1 || fr.bottom > arr.bottom + 1);
                if (cutX || cutY) {
                    out.problems.push('focused element clipped by ' + desc(anc) + ': [' + [fr.left, fr.top, fr.right, fr.bottom].map(Math.round) +
                        '] in [' + [arr.left, arr.top, arr.right, arr.bottom].map(Math.round) + ']');
                    break;
                }
            }
        }

        if (saved) {
            fEl.style.transform = saved.transform;
            void fEl.offsetWidth;
            fEl.style.transition = saved.transition;
        }

        // 3. Top-nav pill against the item it marks.
        var nav = document.getElementById('top-nav');
        var pill = document.getElementById('top-nav-pill');
        var item = document.querySelector('.top-nav-item.focused') || document.querySelector('.top-nav-item.selected');
        if (nav && pill && item && getComputedStyle(nav).display !== 'none') {
            var pr = pill.getBoundingClientRect(), ir = item.getBoundingClientRect();
            out.navPill = { pill: [pr.left, pr.width].map(Math.round), item: [ir.left, ir.width].map(Math.round) };
            if (!near(pr.left, ir.left) || !near(pr.width, ir.width)) {
                out.problems.push('top-nav pill [' + pr.left.toFixed(1) + ', w ' + pr.width.toFixed(1) + '] vs item [' +
                    ir.left.toFixed(1) + ', w ' + ir.width.toFixed(1) + ']');
            }
        }

        // 4. Library sub-nav pill against its selected tab.
        var sp = document.getElementById('library-subnav-pill');
        var si = document.querySelector('.library-subnav-item.selected');
        if (sp && si && rendered(sp)) {
            var spr = sp.getBoundingClientRect(), sir = si.getBoundingClientRect();
            out.subnavPill = { pill: [spr.top, spr.height].map(Math.round), item: [sir.top, sir.height].map(Math.round) };
            if (!near(spr.top, sir.top) || !near(spr.height, sir.height)) {
                out.problems.push('sub-nav pill [' + spr.top.toFixed(1) + ', h ' + spr.height.toFixed(1) + '] vs item [' +
                    sir.top.toFixed(1) + ', h ' + sir.height.toFixed(1) + ']');
            }
        }

        // 5. Virtual grid columns against the CSS grid.
        (window.__vgs || []).forEach(function(vg) {
            var g = vg.getGridElement && vg.getGridElement();
            if (!g || !g.isConnected) return;
            var css = getComputedStyle(g).gridTemplateColumns.split(' ').length;
            var name = /library-albums-grid/.test(vg.gridClassName) ? 'albums'
                : /library-artists-grid/.test(vg.gridClassName) ? 'artists' : vg.gridClassName;
            out.grids = out.grids || {};
            out.grids[name] = { columns: vg.getColumns(), cssColumns: css, itemHeight: vg.itemHeight };
            if ((name === 'albums' || name === 'artists') && vg.getColumns() !== css) {
                out.problems.push(name + ' grid columns ' + vg.getColumns() + ' vs CSS ' + css);
            }
        });

        // 6. Lyrics (or, since S6, credits) open: the left column's left edge.
        var layout = document.querySelector('.np-layout.lyrics-active, .np-layout.credits-active');
        if (layout) {
            var left = layout.querySelector('.np-left');
            if (left) {
                var lr = left.getBoundingClientRect();
                out.lyricsLeftRem = +(lr.left / remPx).toFixed(2);
                if (out.lyricsLeftRem < 6 || out.lyricsLeftRem > 10) {
                    out.problems.push('lyrics .np-left left edge ' + out.lyricsLeftRem + ' rem (want 6-10)');
                }
            }
        }

        // 7. NP bar and page-container offsets.
        var bar = document.querySelector('.now-playing-bar');
        if (bar) {
            out.npBarHeight = bar.getBoundingClientRect().height;
            if (!near(out.npBarHeight, 7.6 * remPx)) out.problems.push('NP bar height ' + out.npBarHeight + ' vs ' + 7.6 * remPx);
        }
        var cont = document.getElementById('page-container');
        if (cont) {
            var cr = cont.getBoundingClientRect();
            var wantTop = cont.classList.contains('no-nav') ? 0 : 8 * remPx;
            var wantBottom = cont.classList.contains('no-np-bar') ? 0 : 7.6 * remPx;
            out.pageContainer = { top: cr.top, bottomGap: VH - cr.bottom };
            if (!near(cr.top, wantTop) || !near(VH - cr.bottom, wantBottom)) {
                out.problems.push('page-container top ' + cr.top + ' bottomGap ' + (VH - cr.bottom) + ' want ' + wantTop + ' / ' + wantBottom);
            }
        }
        return out;
    });
}

module.exports = { installProbes: installProbes, settled: settled, measure: measure };

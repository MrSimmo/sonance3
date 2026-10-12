import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';
import * as G from './helpers/geometry';

// 3.14 L1–L4 (ticket-3.14 §6, §7.1 L): a long lyric line wraps at whole
// words and shows completely at every interface size, the active line (all of
// its rows) is highlighted in the unfaded band, and lyrics and credits clear
// the left column. The fixture is `?mockLyricsLong=1` (tests/mock-boot.js,
// both backends): long synced lines, or unsynced with `mockLyricsUnsynced=1`;
// its lines and start times are in window.__MOCK__.longLyrics.
//
// Sizes are computed from the root font size, never from 150 % constants.

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-14');
const SCALES = [1, 1.25, 1.5, 1.75, 2];
const ACTIVE_SCALE = 1.15;      // .lyrics-line.lyrics-active (css/styles.css)
const LONG_WORD = 25;           // a word this long may break (L1's one exception)

type Rect = { left: number; right: number; top: number; bottom: number };
type Line = {
  cls: string; color: string; opacity: string; hyphens: string; padTop: number; len: number;
  box: Rect; rows: Rect[]; split: string[];
};
type Snap = { rem: number; wrap: Rect & { height: number }; lines: Line[]; colRight: number; panel: Rect; layout: Rect };

async function openLyrics(page: Page, scale: number, backend: string, unsynced = false) {
  await H.bootMock(page, {
    scale, backend: backend === 'jellyfin' ? 'jellyfin' : undefined,
    extra: 'mockLyricsLong=1' + (unsynced ? '&mockLyricsUnsynced=1' : '')
  });
  await H.startTrack(page, 3, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 150);
  await H.press(page, 'ArrowRight', 4);                    // Lyrics (Play + 4)
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#page-current .np-lyrics-lines .lyrics-line').length > 0);
  await page.waitForTimeout(400);
  await G.settled(page);
}

// The right edge of every visible .np-left descendant, the lyric lines (box,
// rows, words split across rows) and the panel boxes.
function snapshot(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const rect = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const col = document.querySelector('#page-current .np-left')!;
    const opacity = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n && n !== col.parentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
      return o;
    };
    let colRight = -Infinity;
    col.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden' || opacity(el) < 0.01) return;
      if (r.right > colRight) colRight = r.right;
    });
    const wrapEl = document.querySelector('#page-current .np-lyrics-scroll-wrapper')!;
    const w = wrapEl.getBoundingClientRect();
    const rowsOf = (rects: DOMRectList | DOMRect[]) => {
      const rows: { left: number; right: number; top: number; bottom: number }[] = [];
      Array.prototype.forEach.call(rects, (r: DOMRect) => {
        if (r.width < 0.5) return;
        const row = rows.find((x) => Math.abs(x.top - r.top) < 2);
        if (!row) rows.push(rect(r));
        else {
          row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right);
          row.bottom = Math.max(row.bottom, r.bottom);
        }
      });
      return rows.sort((a, b) => a.top - b.top);
    };
    const lines = Array.prototype.map.call(document.querySelectorAll('#page-current .np-lyrics-lines .lyrics-line'), (el: HTMLElement) => {
      const cs = getComputedStyle(el) as any;
      const node = el.firstChild as Text | null;
      const all = document.createRange();
      all.selectNodeContents(el);
      const split: string[] = [];
      const s = node ? node.data : '';
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const rg = document.createRange();
        rg.setStart(node!, m.index);
        rg.setEnd(node!, m.index + m[0].length);
        if (rowsOf(rg.getClientRects()).length > 1) split.push(m[0]);
      }
      return {
        cls: el.className, color: cs.color, opacity: cs.opacity, hyphens: cs.hyphens || cs.webkitHyphens || '',
        padTop: parseFloat(cs.paddingTop), len: s.length,
        box: rect(el.getBoundingClientRect()), rows: rowsOf(all.getClientRects()), split
      };
    });
    const panel = document.querySelector('#page-current .np-lyrics-panel')!.getBoundingClientRect();
    const layout = document.querySelector('#page-current .np-layout')!.getBoundingClientRect();
    return {
      rem, wrap: Object.assign(rect(w), { height: w.height }), lines, colRight,
      panel: rect(panel), layout: rect(layout)
    } as any;
  });
}

const starts = (page: Page) => page.evaluate(() => (window as any).__MOCK__.longLyrics.map((l: any) => l.start));

// Every line, active or not, is inside the wrapper's left and right edges
// (box with its scale, and every row), never hyphenated, and broken only
// between words except the over-long word.
function expectFits(s: Snap, label: string) {
  s.lines.forEach((l, i) => {
    const at = `${label} line ${i} (${l.cls})`;
    expect(l.box.left, at + ' box left').toBeGreaterThanOrEqual(s.wrap.left - 1);
    expect(l.box.right, at + ' box right').toBeLessThanOrEqual(s.wrap.right + 1);
    l.rows.forEach((r, k) => {
      expect(r.left, at + ' row ' + k + ' left').toBeGreaterThanOrEqual(s.wrap.left - 1);
      expect(r.right, at + ' row ' + k + ' right').toBeLessThanOrEqual(s.wrap.right + 1);
    });
    expect(l.hyphens, at + ' hyphens').not.toBe('auto');
    expect(l.split.filter((wd) => wd.length < LONG_WORD), at + ' words split across rows').toEqual([]);
  });
}

// L1's wrapping: every long line takes 2 rows or more; the line that just
// fills one row (45–54 characters) may stay on one row at 100 %. Unsynced
// lines never scale and keep the panel's full width (D206), so there only the
// lines of 60 characters or more must wrap.
function expectWrapped(s: Snap, scale: number, label: string, unsynced = false) {
  s.lines.forEach((l, i) => {
    if (l.len >= 60 || (l.len >= 45 && scale > 1 && !unsynced)) {
      expect(l.rows.length, `${label} line ${i} (${l.len} chars) rows`).toBeGreaterThanOrEqual(2);
    }
  });
}

// L2: lyric (or credit) text starts at least 2rem right of the column; at
// 100–150 % the panel's box is 3.13's (right-aligned, 55 % of the layout).
function expectClear(textLeft: number, s: Snap, panel: Rect, scale: number, label: string) {
  expect(textLeft - s.colRight, label + ': gap to the column (px)').toBeGreaterThanOrEqual(2 * s.rem - 1);
  if (scale <= 1.5) {
    const width = 0.55 * (s.layout.right - s.layout.left);
    expect(Math.abs(panel.right - s.layout.right), label + ': panel right').toBeLessThanOrEqual(1);
    expect(Math.abs((panel.right - panel.left) - width), label + ': panel width').toBeLessThanOrEqual(1);
  }
}

for (const backend of ['subsonic', 'jellyfin']) {
  for (const scale of SCALES) {
    const pct = Math.round(scale * 100);
    test(`L1–L3 ${backend} ${pct}%: every line fits and wraps at words; each active line is whole, highlighted and in the band; the column is clear`, async ({ page }) => {
      test.setTimeout(90000);
      await openLyrics(page, scale, backend);
      const t = await starts(page);
      const first = await snapshot(page);
      expectFits(first, 'before any line');
      const textLeft = Math.min(...first.lines.map((l) => l.box.left));
      expectClear(textLeft, first, first.panel, scale, 'lyrics');
      const longest = first.lines.reduce((b, l, i) => (l.len > first.lines[b].len ? i : b), 0);

      for (let i = 0; i < t.length; i++) {
        await page.evaluate((sec) => Player.seekTo(sec), t[i] / 1000 + 0.05);
        await page.waitForFunction((n) => {
          const el = document.querySelectorAll('#page-current .np-lyrics-lines .lyrics-line')[n];
          return !!el && el.classList.contains('lyrics-active');
        }, i);
        await H.settle(page, 0);
        await G.settled(page);
        const s = await snapshot(page);
        const label = `${backend} ${pct}% active ${i}`;
        expectFits(s, label);
        expectWrapped(s, scale, label);

        // Highlight: the active line in the active style; the others unchanged.
        s.lines.forEach((l, j) => {
          const want = j < i ? ['lyrics-past', 'rgba(255, 255, 255, 0.25)', '0.25']
            : j > i ? ['lyrics-upcoming', 'rgba(255, 255, 255, 0.5)', '0.5']
              : ['lyrics-active', 'rgb(255, 255, 255)', '1'];
          expect([l.cls.replace('lyrics-line ', ''), l.color, l.opacity], `${label}: line ${j}`).toEqual(want);
        });

        // Placement: inside the unfaded band (18–82 % of the wrapper), or a
        // line too tall for it with its text top at the band's top.
        const a = s.lines[i];
        const bandTop = s.wrap.top + 0.18 * s.wrap.height;
        const bandBottom = s.wrap.top + 0.82 * s.wrap.height;
        const top = a.rows[0].top;
        const bottom = a.rows[a.rows.length - 1].bottom;
        if (bottom - top <= bandBottom - bandTop) {
          expect(top, label + ': top in the band').toBeGreaterThanOrEqual(bandTop - 1);
          expect(bottom, label + ': bottom in the band').toBeLessThanOrEqual(bandBottom + 1);
        } else {
          const textTop = a.box.top + a.padTop * ACTIVE_SCALE;
          expect(Math.abs(textTop - bandTop), label + ': a tall line starts at the band top').toBeLessThanOrEqual(2);
          expect(top, label + ': first row in the band').toBeGreaterThanOrEqual(bandTop - 1);
        }
        // Neighbours: no row of the active line meets a row of the next lines.
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= s.lines.length) continue;
          for (const r of a.rows) {
            for (const n of s.lines[j].rows) {
              const apart = r.bottom <= n.top + 0.5 || n.bottom <= r.top + 0.5;
              expect(apart, `${label}: a row overlaps line ${j}`).toBe(true);
            }
          }
        }
        if (i === longest && (scale === 1 || scale === 1.5 || scale === 2) && backend === 'subsonic') {
          await page.screenshot({ path: path.join(SHOTS, `lyrics-long-${pct}.png`) });
        }
      }

      // The credits panel takes the same box (D115/D116).
      await H.press(page, 'ArrowRight');                     // ⓘ
      await H.press(page, 'Enter');
      await page.waitForFunction(() => !!document.querySelector('#page-current .np-layout.credits-active'));
      await page.waitForTimeout(400);
      await G.settled(page);
      const c = await snapshot(page);
      const credits = await page.evaluate(() => {
        const p = document.querySelector('#page-current .np-credits-panel')!.getBoundingClientRect();
        let left = Infinity;
        document.querySelectorAll('#page-current .np-credits-panel .np-credits-title, #page-current .np-credits-panel .np-credits-subtitle, #page-current .np-credits-panel .credit-row')
          .forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.left < left) left = r.left; });
        return { panel: { left: p.left, right: p.right, top: p.top, bottom: p.bottom }, textLeft: left };
      });
      expectClear(credits.textLeft, c, credits.panel, scale, 'credits');
      if (scale === 2 && backend === 'subsonic') await page.screenshot({ path: path.join(SHOTS, 'credits-200.png') });
    });
  }
}

for (const backend of ['subsonic', 'jellyfin']) {
  for (const scale of SCALES) {
    const pct = Math.round(scale * 100);
    test(`L1 ${backend} ${pct}%: long unsynced lines are not cut and wrap at whole words`, async ({ page }) => {
      await openLyrics(page, scale, backend, true);
      const s = await snapshot(page);
      expect(s.lines.length).toBeGreaterThan(10);
      s.lines.forEach((l) => expect(l.cls).toBe('lyrics-line lyrics-unsynced'));
      expectFits(s, `${backend} ${pct}% unsynced`);
      expectWrapped(s, scale, `${backend} ${pct}% unsynced`, true);
    });
  }
}

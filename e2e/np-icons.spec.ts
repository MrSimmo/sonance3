import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10-fix2 F4 (D153): every Now Playing control's icon is centred in its
// button, so the round focus platter sits evenly around it. TV report,
// 2026-10-05: "lyrics button icon is not centred in the pill when
// highlighted" (its four lines were drawn in x 2-18, y 4-18 of a 24-unit
// box: ~3 px left and 1.5 px up at 150 %).
//
// The drawn content is the union of the icon's paths' boxes in screen
// pixels, each widened by half its stroke when it is stroked. One reading
// (D153): the play triangle is placed by its centroid, the optical centre
// Material's play glyph is drawn around (its box centre is 1.5 units right of
// it by design); every other icon by its box.

async function iconOffsets(page: Page) {
  return page.evaluate(() => {
    const out: any[] = [];
    const btn = FocusManager.getCurrentFocused() as HTMLElement;
    const svg = btn.querySelector('svg') as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const pt = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let centroid: { x: number; y: number } | null = null;
    Array.prototype.forEach.call(svg.querySelectorAll('path'), (p: SVGPathElement) => {
      const b = p.getBBox();
      const cs = getComputedStyle(p);
      const half = cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) / 2 : 0;
      const a = pt(b.x - half, b.y - half), c = pt(b.x + b.width + half, b.y + b.height + half);
      x0 = Math.min(x0, a.x, c.x); y0 = Math.min(y0, a.y, c.y);
      x1 = Math.max(x1, a.x, c.x); y1 = Math.max(y1, a.y, c.y);
      if (p.getAttribute('d') === SonanceUtils.SVG_PATHS.play) centroid = pt((8 + 8 + 19) / 3, (5 + 19 + 12) / 3);
    });
    const r = btn.getBoundingClientRect();
    const bc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const ic = centroid || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    out.push({ id: btn.id, dx: +(ic.x - bc.x).toFixed(2), dy: +(ic.y - bc.y).toFixed(2), by: centroid ? 'centroid' : 'box' });
    return out[0];
  });
}

for (const scale of [1, 1.5, 2]) {
  test(`F4 every focused Now Playing control's icon is centred within 1 px (${scale * 100} %)`, async ({ page }) => {
    await H.bootMock(page, { scale });
    await H.startTrack(page, 6, { paused: true });
    await H.navTo(page, 'nowplaying');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 300);
    expect((await H.focus(page)).id).toBe('np-play');
    await H.press(page, 'ArrowLeft', 2, 40);
    await H.settle(page, 100);
    const n = await page.evaluate(() => document.querySelectorAll('.np-screen-controls .focusable').length);
    const rows: any[] = [];
    for (let i = 0; i < n; i++) {
      if (i) await H.press(page, 'ArrowRight');
      await H.settle(page, 160);   // past the 0.12-0.15 s focus transitions
      const f = await H.focus(page);
      expect(f.zone).toBe('np-controls');
      expect(f.index).toBe(i);
      rows.push(await iconOffsets(page));
    }
    test.info().annotations.push({ type: 'offsets px', description: JSON.stringify(rows) });
    const off = rows.filter((r) => Math.abs(r.dx) > 1 || Math.abs(r.dy) > 1);
    expect(off, JSON.stringify(rows)).toEqual([]);
  });
}

import { test, expect } from '@playwright/test';
import * as H from './helpers/sonance';

// R8 (ticket-3.10 §6.5, S6): twice the backdrop blur, on the same element,
// with no transform (D47). The edge-luminance check (square, portrait and
// landscape covers) needs one dev server per cover shape, so it runs as a
// measurement (docs/perf-baseline.md "v3.10 S6"), not here.

for (const scale of [1, 1.5, 2]) {
  test(`R8 at ${scale * 100}%: .np-bg-image is blur(120px) saturate(1.3), px at every size, with no transform`, async ({ page }) => {
    await H.bootMock(page, { scale });
    await H.startTrack(page, 2, { paused: true });
    await H.navTo(page, 'nowplaying');
    await H.settle(page, 300);
    const bg = await page.evaluate(() => {
      const el = document.querySelector('.np-bg-image') as HTMLElement;
      const cs = getComputedStyle(el);
      const page = document.getElementById('page-current')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        filter: cs.filter, transform: cs.transform, opacity: cs.opacity, willChange: cs.willChange,
        // The 150 % overscan box: a quarter of the page past every edge.
        box: [r.left - page.left, r.top - page.top, r.width / page.width, r.height / page.height].map((v) => Math.round(v * 100) / 100),
        w: page.width, h: page.height,
        image: el.style.backgroundImage.indexOf('getCoverArt') > -1,
      };
    });
    expect(bg.filter).toBe('blur(120px) saturate(1.3)');
    expect(bg.transform).toBe('none');
    expect(bg.willChange).toBe('auto');
    expect(bg.opacity).toBe('0.6');
    expect(bg.box).toEqual([Math.round(-0.25 * bg.w * 100) / 100, Math.round(-0.25 * bg.h * 100) / 100, 1.5, 1.5]);
    expect(bg.image).toBe(true);
  });
}

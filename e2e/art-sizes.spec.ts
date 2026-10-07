import { test, expect } from '@playwright/test';
import * as H from './helpers/sonance';

// D70 (S5): getCoverArt request sizes follow the interface size. Each
// surface keeps its v3.9 100 % bucket (cards 180, thumbnails 100, Now
// Playing 320, avatars 100/120/200) and SonanceUtils.artSize scales it. The
// preloads ask through the same call, so a preloaded cover is the URL the
// screen then uses (v3.9 T6 cache-key rule): one size per cover per
// surface. At 100 % nothing changes.
//
// S7 (A3, D139): the one size that does not scale is the Playlists grid's
// cover, 400 at every size: its cell is set by the grid's four columns over
// a capped width (318-396 px), not by the interface size. A navTo along the
// top nav passes Playlists and its dwell renders the grid, so it shows here.

const BUCKETS = [100, 120, 180, 200, 320];
const UNSCALED = [400];

for (const scale of [1, 1.5, 2]) {
  test(`D70 art requests at ${scale * 100}%: scaled buckets, preload = display`, async ({ page }) => {
    const sizes: Record<string, Set<number>> = {};
    page.on('request', (r) => {
      const m = /getCoverArt\.view\?(.*)$/.exec(r.url());
      if (!m) return;
      const q = new URLSearchParams(m[1]);
      const id = q.get('id')!;
      (sizes[id] = sizes[id] || new Set()).add(parseInt(q.get('size')!, 10));
    });
    const want = (b: number) => Math.round(b * scale);
    await H.bootMock(page, { scale, albums: 60 });
    await H.startTrack(page, 3, { paused: true });
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 600);
    const grid = await page.evaluate(() => Array.from(document.querySelectorAll('.album-grid-card img.lazy-art'))
      .map((i) => parseInt(i.getAttribute('data-size')!, 10)));
    const bar = await page.evaluate(() => {
      const img = document.querySelector('.now-playing-bar-art img') as HTMLImageElement | null;
      return img ? new URLSearchParams(img.src.split('?')[1]).get('size') : null;
    });
    expect(grid.length).toBeGreaterThan(0);
    expect(new Set(grid)).toEqual(new Set([want(180)]));
    expect(bar).toBe(String(want(100)));
    await H.navTo(page, 'queue');
    await H.settle(page, 300);
    const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('.queue-row img.lazy-art'))
      .map((i) => parseInt(i.getAttribute('data-size')!, 10)));
    expect(new Set(thumbs)).toEqual(new Set([want(100)]));
    await H.navTo(page, 'nowplaying');
    await H.settle(page, 400);
    const np = await page.evaluate(() => {
      const art = document.querySelector('.np-screen-art-inner img') as HTMLImageElement | null;
      return art && art.src ? new URLSearchParams(art.src.split('?')[1]).get('size') : null;
    });
    expect(np).toBe(String(want(320)));
    // Every size asked for is a scaled bucket, and the Albums grid's covers
    // were each fetched at one size only (the Library preload's size).
    const allowed = new Set(BUCKETS.map(want).concat(UNSCALED));
    const asked = new Set<number>();
    Object.keys(sizes).forEach((id) => sizes[id].forEach((s) => asked.add(s)));
    test.info().annotations.push({ type: 'sizes', description: JSON.stringify(Array.from(asked).sort((a, b) => a - b)) });
    asked.forEach((s) => expect(allowed.has(s), 'size ' + s).toBe(true));
    // A grid cover is fetched at the card size (the preload's and the
    // card's), and at the bar and Now Playing sizes only if it is the
    // playing album: an unscaled preload would show up here as 180.
    const gridIds = await page.evaluate(() => (window as any).__MOCK__.albums.slice(0, 12).map((a: any) => a.coverArt));
    const surface = new Set([want(180), want(100), want(320)]);
    let checked = 0;
    for (const id of gridIds) {
      if (!sizes[id]) continue;
      checked++;
      expect(sizes[id].has(want(180)), id).toBe(true);
      sizes[id].forEach((s) => expect(surface.has(s), id + ' at ' + s).toBe(true));
    }
    expect(checked).toBeGreaterThan(0);
  });
}

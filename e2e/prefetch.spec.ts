import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R1.5 (ticket-3.10 §7, D97): an Albums-grid card focused for 400 ms
// prefetches its album through SubsonicAPI._cachedRequest, so Enter opens it
// with no getAlbum request of its own. Passing over cards prefetches nothing.

// Log every getAlbum request the app makes (the API calls the global fetch).
async function logGetAlbum(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__ga = [];
    const orig = window.fetch;
    window.fetch = function(u: any, o: any) {
      const m = /getAlbum\.view.*[?&]id=([^&]*)/.exec(String(u));
      if (m) w.__ga.push({ id: decodeURIComponent(m[1]), t: performance.now() });
      return orig(u, o);
    } as any;
  });
  return {
    read: () => page.evaluate(() => (window as any).__ga as { id: string; t: number }[]),
    mark: () => page.evaluate(() => performance.now())
  };
}

async function onAlbumsGrid(page: Page) {
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: 0 });
}

test('R1.5 dwell 400 ms on a card, then Enter: 0 getAlbum requests on Enter', async ({ page }) => {
  await onAlbumsGrid(page);
  const log = await logGetAlbum(page);
  await H.press(page, 'ArrowRight');
  await page.waitForTimeout(550);
  const enterAt = await log.mark();
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 300);
  const all = await log.read();
  test.info().annotations.push({ type: 'getAlbum', description: JSON.stringify(all) });
  const card = await page.evaluate(() => (window as any).__MOCK__.albums[1].id);
  expect(all.filter((r) => r.t < enterAt).map((r) => r.id)).toEqual([card]);
  expect(all.filter((r) => r.t >= enterAt)).toEqual([]);
  // The album shows its tracks: the prefetched response is the one used.
  expect(await page.evaluate(() => document.querySelectorAll('#album-tracklist .track-row').length)).toBeGreaterThan(0);
});

test('R1.5 moving across cards in under 400 ms each, then leaving: 0 prefetches', async ({ page }) => {
  await onAlbumsGrid(page);
  const log = await logGetAlbum(page);
  // Three moves: the grid has 4 columns at 200 %, and a press at a row's
  // end does not move focus (that card would rightly be dwelt on).
  for (let i = 1; i <= 3; i++) {
    await H.press(page, 'ArrowRight');
    expect((await H.focus(page)).index).toBe(i);
    await page.waitForTimeout(250);
  }
  // Up leaves the grid 250 ms after the last card: since S5 (A2) to the
  // Albums header above it (it went to the top nav).
  await H.press(page, 'ArrowUp');
  expect((await H.focus(page)).zone).toBe('library-header');
  await page.waitForTimeout(800);
  expect(await log.read()).toEqual([]);
});

test('R1.5 without the dwell, Enter fetches the album itself (control)', async ({ page }) => {
  await onAlbumsGrid(page);
  const log = await logGetAlbum(page);
  await H.press(page, 'ArrowRight');
  await page.waitForTimeout(150);
  const enterAt = await log.mark();
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForTimeout(600);
  const all = await log.read();
  expect(all.filter((r) => r.t < enterAt)).toEqual([]);
  expect(all.filter((r) => r.t >= enterAt).length).toBe(1);
});

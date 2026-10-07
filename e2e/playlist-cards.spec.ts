import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.10 A3 (ticket §7 A3, mockup 15): playlist cards show the playlist's
// cover (Navidrome's collage, `coverArt`) over today's gradient, in the
// Playlists grid and Home's "Your Playlists" row. The mock's first four
// playlists carry `coverArt`, the fifth does not (the fallback).

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-10');

async function toGrid(page: Page) {
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect(await H.focus(page)).toMatchObject({ zone: 'content', index: 0 });
}

const cards = (page: Page, root: string) => page.evaluate((sel) => Array.prototype.map.call(
  document.querySelectorAll(sel + ' .playlist-card'), (c: HTMLElement) => {
    const img = c.querySelector('.playlist-card-art img') as HTMLImageElement | null;
    return {
      id: c.getAttribute('data-playlist-id'),
      name: c.querySelector('.playlist-card-name')!.textContent,
      meta: c.querySelector('.playlist-card-count')!.textContent,
      cover: img ? img.getAttribute('data-coverart') : null,
      size: img ? img.getAttribute('data-size') : null,
      glyph: !!c.querySelector('.playlist-card-glyph')
    };
  }), root);

test('A3 the grid and the Home row show the covers, the gradient fallback, and the labels, with no getPlaylist per card', async ({ page }) => {
  const errors = H.watchErrors(page);
  await H.bootMock(page);
  const scale = await page.evaluate(() => SonanceUtils.uiScale());
  const homeSize = String(Math.round(180 * scale));
  const home = await cards(page, '#home-playlists-row');
  expect(home.map((c) => [c.id, c.cover, c.size])).toEqual([
    ['pl-0', 'pl-0', homeSize], ['pl-1', 'pl-1', homeSize], ['pl-2', 'pl-2', homeSize],
    ['pl-3', 'pl-3', homeSize], ['pl-4', null, null]
  ]);
  await toGrid(page);
  const grid = await cards(page, '#playlists-grid');
  expect(grid).toEqual([0, 1, 2, 3, 4].map((i) => ({
    id: 'pl-' + i, name: 'Playlist ' + (i + 1), meta: '20 songs · 1 h 7 min',
    cover: i < 4 ? 'pl-' + i : null, size: i < 4 ? '400' : null, glyph: true
  })));
  // The covers load (lazily), square, four to a row.
  await page.waitForFunction(() => Array.prototype.every.call(
    document.querySelectorAll('#playlists-grid .playlist-card-art img'),
    (i: HTMLImageElement) => i.classList.contains('loaded') && i.complete && i.naturalWidth > 0));
  const geom = await page.evaluate(() => {
    // Layout boxes (offset*), not rects: the focused first card is scaled.
    const arts = Array.prototype.slice.call(document.querySelectorAll('#playlists-grid .playlist-card-art'));
    return { w: arts[0].offsetWidth, h: arts[0].offsetHeight,
      rowTops: arts.map((a: HTMLElement) => (a.parentNode as HTMLElement).offsetTop) };
  });
  expect(geom.w).toBeCloseTo(geom.h, 0);
  expect(geom.rowTops.slice(0, 4).every((t: number) => t === geom.rowTops[0])).toBe(true);
  expect(geom.rowTops[4]).toBeGreaterThan(geom.rowTops[0]);
  // Opening the grid and the Home row cost getPlaylists only.
  const hits = await page.evaluate(() => (window as any).__MOCK__.hits);
  expect(hits.getPlaylist || 0).toBe(0);
  await page.screenshot({ path: path.join(SHOTS, 's7-playlists-' + Math.round(scale * 100) + '.png') });
  expect(errors.pageErrors).toEqual([]);
});

test('A3 focus is the card rule (R6): scale 1.12, the ring and shadow on the art, the label white and bold', async ({ page }) => {
  await H.bootMock(page);
  await toGrid(page);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 300);
  const r = await page.evaluate(() => {
    const cs = (el: Element) => getComputedStyle(el);
    const all = document.querySelectorAll('#playlists-grid .playlist-card');
    const f = all[1] as HTMLElement, rest = all[2] as HTMLElement;
    return {
      focused: f.classList.contains('focused'),
      transform: cs(f).transform,
      cardShadow: cs(f).boxShadow,
      artShadow: cs(f.querySelector('.playlist-card-art')!).boxShadow,
      name: [cs(f.querySelector('.playlist-card-name')!).color, cs(f.querySelector('.playlist-card-name')!).fontWeight],
      restName: [cs(rest.querySelector('.playlist-card-name')!).color, cs(rest.querySelector('.playlist-card-name')!).fontWeight],
      fill: cs(document.documentElement).getPropertyValue('--focus-fill').trim(),
      ring: 0.4 * parseFloat(cs(document.documentElement).fontSize)
    };
  });
  expect(r.focused).toBe(true);
  expect(r.transform).toBe('matrix(1.12, 0, 0, 1.12, 0, 0)');
  expect(r.cardShadow).toBe('none');
  // rgb(228, 77, 138) 0px 0px 0px 6px, rgba(0, 0, 0, 0.7) 0px 33px 66px 0px (150 %)
  expect(r.artShadow).toContain('rgb(228, 77, 138) 0px 0px 0px ' + r.ring + 'px');
  expect(r.artShadow).toContain('rgba(0, 0, 0, 0.7)');
  expect(r.name).toEqual(['rgb(255, 255, 255)', '700']);
  expect(r.restName).toEqual(['rgba(240, 240, 245, 0.72)', '500']);
});

test('A3 the grid is four columns to the d-pad, and Enter still opens the playlist', async ({ page }) => {
  await H.bootMock(page);
  await toGrid(page);
  await H.press(page, 'ArrowRight', 3, 60);
  expect((await H.focus(page)).index).toBe(3);
  await H.press(page, 'ArrowLeft', 3, 60);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'content', index: 4 });
  await H.press(page, 'Enter');
  await page.waitForSelector('.playlist-detail-name');
  expect(await page.textContent('.playlist-detail-name')).toBe('Playlist 5');
});

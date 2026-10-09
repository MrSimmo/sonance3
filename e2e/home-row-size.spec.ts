import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';
import * as G from './helpers/geometry';

// v3.12 R4 (ticket-3.12 §6): Settings → Appearance → "Albums per Home row":
// Standard (6, the default) / 9 / 12, stored in sonance-home-row-size (`9` or
// `12`; absent is Standard). Home's five album rows and the two rows'
// skeletons take it; Your Playlists does not. The default must not change:
// with no key, Home's requests are byte-identical to 3.11's.

const BOOT = { albums: 120, artists: 80, songs: 400 };
const KEY = 'sonance-home-row-size';
const ALBUM_ROWS = ['home-newest', 'home-recent', 'home-favourites', 'home-frequent', 'home-rediscover'];

// Home's getAlbumList2 requests on 3.11 at the default, recorded at T0 of the
// v3.12 session (auth values cut: the token and salt differ per session).
const URLS_311 = ['frequent', 'newest', 'random', 'recent', 'starred'].map((t) =>
  '/rest/getAlbumList2.view?u=REDACTED&t=REDACTED&s=REDACTED&v=1.16.1&c=Sonance&f=json&type=' + t + '&size=6');

async function recordAlbumLists(page: Page) {
  await page.addInitScript(() => {
    (window as any).__urls = [];
    document.addEventListener('DOMContentLoaded', () => {
      const f = window.fetch;
      window.fetch = function(u: any) {
        const s = typeof u === 'string' ? u : u.url;
        if (/getAlbumList2/.test(s)) {
          (window as any).__urls.push(s.replace(/([?&])(u|t|s|p)=[^&]*/g, '$1$2=REDACTED').replace(/^https?:\/\/[^/]+/, ''));
        }
        return f.apply(this, arguments as any);
      } as any;
    });
  });
}
const urls = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__urls.slice().sort());

const cardCounts = (page: Page) => page.evaluate((zones) => {
  const out: Record<string, number> = {};
  (zones as string[]).concat(['home-playlists']).forEach((z) => {
    out[z] = document.querySelectorAll('#' + z + '-row .focusable').length;
  });
  return out;
}, ALBUM_ROWS);

const skeletons = (page: Page) => page.evaluate(() => ({
  newest: document.querySelectorAll('#home-newest-row .skeleton-card').length,
  recent: document.querySelectorAll('#home-recent-row .skeleton-card').length,
  playlists: document.querySelectorAll('#home-playlists-row .skeleton-card').length,
}));

test('R4 guard (passes on 3.11 too): default (no key), Home asks for 6 per row, byte-identical to 3.11; 6 skeletons', async ({ page }) => {
  await recordAlbumLists(page);
  await H.bootMock(page, Object.assign({ extra: 'mockDelayTypes=newest,recent&mockDelayMs=1500', waitFor: false }, BOOT));
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getCurrentScreen() === 'home' && !document.getElementById('splash'));
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(null);
  expect(await skeletons(page)).toEqual({ newest: 6, recent: 6, playlists: 4 });
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => document.querySelectorAll('#home-newest-row .album-card').length > 0);
  await page.waitForTimeout(300);
  expect(await urls(page)).toEqual(URLS_311);
  expect(await cardCounts(page)).toEqual({
    'home-newest': 6, 'home-recent': 6, 'home-favourites': 6, 'home-frequent': 6, 'home-rediscover': 6, 'home-playlists': 5,
  });
});

test('R4 the Settings row: after Background; Right and Enter step forward, Left back, all wrapping; stored; survives a reload', async ({ page }) => {
  await H.bootMock(page, BOOT);
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');                   // the swatches
  let prev = '';
  for (let i = 0; i < 12; i++) {
    const f = await H.focus(page);
    if (f.id === 'settings-home-row-size-row') break;
    prev = f.id || '';
    await H.press(page, 'ArrowDown');
    await H.settle(page, 40);
  }
  expect((await H.focus(page)).id).toBe('settings-home-row-size-row');
  expect(prev).toBe('settings-backdrop-row');
  const value = () => page.evaluate(() => document.getElementById('settings-home-row-size-value')!.textContent);
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  expect(await value()).toBe('Standard');
  const steps: [string, string, string | null][] = [
    ['ArrowRight', '9', '9'], ['ArrowRight', '12', '12'], ['ArrowRight', 'Standard', null],
    ['ArrowLeft', '12', '12'], ['ArrowLeft', '9', '9'], ['ArrowLeft', 'Standard', null],
    ['Enter', '9', '9'], ['Enter', '12', '12'], ['Enter', 'Standard', null], ['Enter', '9', '9'],
  ];
  for (const [key, label, want] of steps) {
    await H.press(page, key);
    expect(await value(), key).toBe(label);
    expect(await stored(), key).toBe(want);
    expect((await H.focus(page)).id).toBe('settings-home-row-size-row');
  }
  // Survives a reload: Home builds rows of 9, and Settings reads 9.
  await page.reload();
  await H.waitForScreen(page, 'home');
  expect(await cardCounts(page)).toMatchObject({ 'home-newest': 9, 'home-recent': 9, 'home-playlists': 5 });
  await H.navTo(page, 'settings');
  expect(await value()).toBe('9');
});

test('R4 with 9: rows of 9 and 9 skeletons; the playlists row unchanged', async ({ page }) => {
  await recordAlbumLists(page);
  await H.bootMock(page, Object.assign({ storage: { [KEY]: '9' }, extra: 'mockDelayTypes=newest,recent&mockDelayMs=1500', waitFor: false }, BOOT));
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getCurrentScreen() === 'home' && !document.getElementById('splash'));
  expect(await skeletons(page)).toEqual({ newest: 9, recent: 9, playlists: 4 });
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => document.querySelectorAll('#home-newest-row .album-card').length > 0);
  await page.waitForTimeout(300);
  expect(await cardCounts(page)).toEqual({
    'home-newest': 9, 'home-recent': 9, 'home-favourites': 9, 'home-frequent': 9, 'home-rediscover': 9, 'home-playlists': 5,
  });
  expect(await urls(page)).toEqual(URLS_311.map((u) => u.replace('size=6', 'size=9')));
});

test('R4 with 12: rows of 12; Right walks to the 12th, the row scrolls, the focus is not clipped', async ({ page }) => {
  await H.bootMock(page, Object.assign({ storage: { [KEY]: '12' } }, BOOT));
  expect(await cardCounts(page)).toEqual({
    'home-newest': 12, 'home-recent': 12, 'home-favourites': 12, 'home-frequent': 12, 'home-rediscover': 12, 'home-playlists': 5,
  });
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  await H.press(page, 'ArrowDown');                   // the hero
  await H.press(page, 'ArrowDown');                   // Recently Added
  expect(await H.focus(page)).toMatchObject({ zone: 'home-newest', index: 0 });
  const scrollLeft = () => page.evaluate(() => document.getElementById('home-newest-row')!.scrollLeft);
  expect(await scrollLeft()).toBe(0);
  const clips: string[] = [];
  for (let i = 1; i < 12; i++) {
    await H.press(page, 'ArrowRight');
    await H.settle(page, 40);
    await G.settled(page).catch(() => {});
    const m = await G.measure(page);
    if (m.focusClip.length) clips.push(i + ': ' + m.focusClip.join('; '));
  }
  expect(await H.focus(page)).toMatchObject({ zone: 'home-newest', index: 11 });
  expect(await scrollLeft()).toBeGreaterThan(0);
  // The 12th card is inside the row's box.
  const inView = await page.evaluate(() => {
    const row = document.getElementById('home-newest-row')!.getBoundingClientRect();
    const card = FocusManager.getCurrentFocused()!.getBoundingClientRect();
    return card.left >= row.left - 0.5 && card.right <= row.right + 0.5;
  });
  expect(inView).toBe(true);
  expect(clips).toEqual([]);
});

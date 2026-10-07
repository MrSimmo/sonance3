import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.10 A4 (ticket §7 A4, mockup 18): Home's "Your favourites" (starred),
// "Most played" (frequent) and "Rediscover" (random) rows, each shown only
// when its list is non-empty, loaded after the first paint, in the focus
// chain down to the NP bar.

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-10');
const EXTRA = ['home-favourites', 'home-frequent', 'home-rediscover'];

const visibleHeadings = (page: Page) => page.evaluate(() => Array.prototype.filter.call(
  document.querySelectorAll('.home-section'), (s: HTMLElement) => getComputedStyle(s).display !== 'none')
  .map((s: HTMLElement) => s.querySelector('.home-section-heading')!.textContent));

const rowIds = (page: Page, key: string) => page.evaluate((k) => Array.prototype.map.call(
  document.querySelectorAll('#home-' + k + '-row .album-card'), (c: HTMLElement) => c.getAttribute('data-album-id')), key);

// What the mock server answers for a getAlbumList2 type (through the mocked fetch).
const serverList = (page: Page, type: string) => page.evaluate(async (t) => {
  const r = await fetch('/rest/getAlbumList2.view?type=' + t + '&size=6&f=json');
  const j = await r.json();
  return j['subsonic-response'].albumList2.album.map((a: any) => a.id);
}, type);

test('A4 the three rows, in place, each holding its list', async ({ page }) => {
  const errors = H.watchErrors(page);
  await H.bootMock(page);
  expect(await visibleHeadings(page)).toEqual([
    'Recently Added', 'Recently Played', 'Your favourites', 'Most played', 'Your Playlists', 'Rediscover'
  ]);
  for (const [key, type] of [['favourites', 'starred'], ['frequent', 'frequent'], ['rediscover', 'random']]) {
    const want = await serverList(page, type);
    expect(want.length).toBeGreaterThan(0);
    expect(await rowIds(page, key), key).toEqual(want);
  }
  // Enter on a card opens its album, as on the other rows.
  await page.evaluate(() => FocusManager.setActiveZone('home-frequent', 1, true));
  await H.settle(page, 200);
  const id = await page.evaluate(() => FocusManager.getCurrentFocused().getAttribute('data-album-id'));
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  expect(await page.evaluate(() => document.querySelector('#page-current .album-detail') !== null)).toBe(true);
  expect(id).toBeTruthy();
  expect(errors.pageErrors).toEqual([]);
});

test('A4 a row whose list is empty is not shown and the chain skips it', async ({ page }) => {
  await H.bootMock(page, { extra: 'mockEmptyLists=starred,frequent' });
  await H.startTrack(page, 3, { paused: true });
  expect(await visibleHeadings(page)).toEqual(['Recently Added', 'Recently Played', 'Your Playlists', 'Rediscover']);
  expect(await page.evaluate(() => FocusManager._debugZones().filter((z: string) => /^home-/.test(z)).sort()))
    .toEqual(['home-newest', 'home-playlists', 'home-recent', 'home-rediscover']);
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  const walk = await H.downWalk(page, 40);
  expect(walk.zones).toEqual(['topnav', 'content', 'home-newest', 'home-recent', 'home-playlists', 'home-rediscover', 'nowplaying-bar']);
});

test('A4 the rows are asked for after the first frame, not in Home\'s render', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__frames = [];
    new MutationObserver(function(this: MutationObserver) {
      if (!document.querySelector('.home-screen')) return;
      this.disconnect();
      const t0 = performance.now();
      (window as any).__homeRendered = t0;
      requestAnimationFrame(() => { (window as any).__frames.push(performance.now()); });
    }).observe(document, { childList: true, subtree: true });
  });
  await H.bootMock(page);
  const r = await page.evaluate(() => {
    const calls = (window as any).__MOCK__.calls.filter((c: any) => c.endpoint === 'getAlbumList2' && /^(starred|frequent|random)$/.test(c.type));
    const main = (window as any).__MOCK__.calls.filter((c: any) => c.endpoint === 'getAlbumList2' && /^(newest|recent)$/.test(c.type));
    return { extra: calls.map((c: any) => c.t), main: main.map((c: any) => c.t), rendered: (window as any).__homeRendered, frame: (window as any).__frames[0] };
  });
  test.info().annotations.push({ type: 'times', description: JSON.stringify(r) });
  expect(r.extra.length).toBe(3);
  for (const t of r.main) expect(t).toBeLessThan(r.frame);   // Home's own data: in activate
  for (const t of r.extra) expect(t).toBeGreaterThan(r.frame); // the extra rows: after a frame
});

test('A4 the chain runs down through every row to the bar and back up', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 3, { paused: true });
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  const down = await H.downWalk(page, 40);
  expect(down.zones).toEqual(['topnav', 'content', 'home-newest', 'home-recent', 'home-favourites',
    'home-frequent', 'home-playlists', 'home-rediscover', 'nowplaying-bar']);
  const up: string[] = [];
  for (let i = 0; i < 10; i++) {
    await H.press(page, 'ArrowUp');
    await H.settle(page, 40);
    const f = await H.focus(page);
    if (up[up.length - 1] !== f.zone) up.push(f.zone as string);
    expect(f.visible).toBe(true);
    if (f.zone === 'topnav') break;
  }
  expect(up).toEqual(['home-rediscover', 'home-playlists', 'home-frequent', 'home-favourites',
    'home-recent', 'home-newest', 'content', 'topnav']);
  // Mockup 18: the favourites row in view, its first card focused.
  await page.evaluate(() => FocusManager.setActiveZone('home-favourites', 0, true));
  await H.settle(page, 400);
  await page.screenshot({ path: path.join(SHOTS, 's7-home-rows-' + Math.round(await page.evaluate(() => SonanceUtils.uiScale()) * 100) + '.png') });
});

test('A4 a row that lands above the focused card keeps the card where it was', async ({ page }) => {
  await H.bootMock(page, { extra: 'mockDelayTypes=starred,frequent&mockDelayMs=900', waitFor: false });
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getCurrentScreen() === 'home' &&
    !document.getElementById('splash') && FocusManager.hasZone('home-playlists'));
  await page.evaluate(() => FocusManager.setActiveZone('home-playlists', 1, true));
  await H.settle(page, 200);
  const before = await page.evaluate(() => FocusManager.getCurrentFocused().getBoundingClientRect().top);
  expect(await page.evaluate(() => HomeScreen.extraRowsPending())).toBe(2);
  await page.waitForFunction(() => HomeScreen.extraRowsPending() === 0);
  await H.settle(page, 100);
  const after = await page.evaluate(() => ({
    top: FocusManager.getCurrentFocused().getBoundingClientRect().top,
    snap: FocusManager.snapshot()
  }));
  expect(Math.abs(after.top - before)).toBeLessThanOrEqual(1);
  expect(after.snap).toEqual({ zone: 'home-playlists', index: 1 });
  // Re-chained: Up from Your Playlists is Most played now.
  await H.press(page, 'ArrowUp');
  await H.settle(page, 60);
  expect((await H.focus(page)).zone).toBe('home-frequent');
});

test('A4 a row that lands after Home was left does not touch the next screen (D88)', async ({ page }) => {
  const errors = H.watchErrors(page);
  await H.bootMock(page, { extra: 'mockDelayTypes=starred,frequent,random&mockDelayMs=700', waitFor: false });
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getCurrentScreen() === 'home' &&
    !document.getElementById('splash') && FocusManager.hasZone('content'));
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  await H.press(page, 'ArrowRight');
  await H.waitForScreen(page, 'library');
  await page.waitForTimeout(900);             // the rows' answers arrive now
  const r = await page.evaluate(() => ({
    screen: App.getCurrentScreen(),
    homeZones: FocusManager._debugZones().filter((z: string) => /^home-/.test(z)),
    homeDom: document.querySelectorAll('#page-current .home-section').length,
    bar: (App as any).isNowPlayingBarAvailable()
  }));
  expect(r).toEqual({ screen: 'library', homeZones: [], homeDom: 0, bar: false });
  expect(errors.pageErrors).toEqual([]);
});

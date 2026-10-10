import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.13 R9 (user decision 7): on Jellyfin, "Resume last queue" is saved on
// the TV, in localStorage under a key per server and user that survives
// logout, and restored paused at the saved entry and position. Nothing is
// written to the server. js/app.js is unchanged: it calls the adapter's
// savePlayQueue / getPlayQueue as it calls api.js's.

const KEY = (page: Page) => page.evaluate(() =>
  'sonance_jf_queue__' + window.location.origin + '|' + (window as any).__MOCK__.jf.userId);

const saved = async (page: Page) => {
  const k = await KEY(page);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), k);
};

const writes = (page: Page) => page.evaluate(() => (window as any).__MOCK__.calls
  .filter((c: any) => c.backend === 'jellyfin' && c.method !== 'GET').map((c: any) => c.method + ' ' + c.path));

// Song lookups by id (the restore's), not the Home rows' album lookups.
const songLookups = (page: Page) => page.evaluate(() => (window as any).__MOCK__.calls
  .filter((c: any) => c.path === '/Items' && c.query.Ids && /^song-/.test(c.query.Ids))
  .map((c: any) => c.query.Ids.split(',').length));

// A saved queue, written before the app starts (once per test).
async function seedQueue(page: Page, value: any) {
  await page.addInitScript((v) => {
    if (sessionStorage.getItem('__qseeded__')) return;
    localStorage.setItem('sonance_jf_queue__' + window.location.origin + '|f00dfeed0000000000000000000000a1', JSON.stringify(v));
    sessionStorage.setItem('__qseeded__', '1');
  }, value);
}

const state = (page: Page) => page.evaluate(() => {
  const s = Player.getState();
  return { ids: s.queue.map((t: any) => t.id), index: s.queueIndex, time: Math.round(s.currentTime), playing: s.isPlaying,
    current: s.currentTrack && s.currentTrack.id };
});

test('R9 save on the TV, relaunch, and the queue is back, paused at the entry and position', async ({ page }) => {
  await H.bootJellyfin(page);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 5), 2));
  await page.waitForFunction(() => Player.getState().isPlaying);
  await page.evaluate(() => { Player.seekTo(8); Player.pause(); });
  await expect.poll(async () => { const v = await saved(page); return v && v.index === 2 && Math.round(v.positionMs / 1000); },
    { timeout: 5000 }).toBe(8);
  const v = await saved(page);
  expect(v.ids).toEqual(['song-0', 'song-1', 'song-2', 'song-3', 'song-4']);
  expect(await writes(page)).toEqual([]);

  await page.reload();
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  expect(await state(page)).toEqual({ ids: ['song-0', 'song-1', 'song-2', 'song-3', 'song-4'], index: 2, time: 8,
    playing: false, current: 'song-2' });
  expect(await writes(page)).toEqual([]);
});

test('R9 order and duplicates kept; an id the server no longer has is dropped and the index follows', async ({ page }) => {
  await seedQueue(page, { ids: ['song-1', 'gone-1', 'song-1', 'song-3'], index: 2, positionMs: 15000 });
  await H.bootJellyfin(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  expect(await state(page)).toEqual({ ids: ['song-1', 'song-1', 'song-3'], index: 1, time: 15, playing: false, current: 'song-1' });
});

test('R9 the saved entry itself is gone: the next one, from its start', async ({ page }) => {
  await seedQueue(page, { ids: ['song-1', 'gone-1', 'song-2'], index: 1, positionMs: 30000 });
  await H.bootJellyfin(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  expect(await state(page)).toEqual({ ids: ['song-1', 'song-2'], index: 1, time: 0, playing: false, current: 'song-2' });
});

test('R9 a long queue is fetched by Ids in chunks', async ({ page }) => {
  const ids = Array.from({ length: 150 }, (_, i) => 'song-' + i);
  await seedQueue(page, { ids, index: 120, positionMs: 0 });
  await H.bootJellyfin(page, { songs: 200 });
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  const s = await state(page);
  expect(s.ids.length).toBe(150);
  expect(s.current).toBe('song-120');
  expect(await songLookups(page)).toEqual([100, 50]);
});

test('R9 the saved queue survives logout (not a session key)', async ({ page }) => {
  await seedQueue(page, { ids: ['song-1'], index: 0, positionMs: 0 });
  await H.bootJellyfin(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await page.evaluate(() => (window as any).AuthManager.logout());
  expect((await saved(page)).ids).toEqual(['song-1']);
});

test('R9 with the setting off nothing is saved and nothing restored', async ({ page }) => {
  await seedQueue(page, { ids: ['song-1'], index: 0, positionMs: 0 });
  await H.bootJellyfin(page, { storage: { 'sonance-resume-queue': 'off' } });
  await H.settle(page, 500);
  expect((await state(page)).current).toBe(null);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(5, 7), 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  await page.evaluate(() => Player.pause());
  await page.waitForTimeout(1500);
  expect((await saved(page)).ids).toEqual(['song-1']);     // the seeded value, untouched
  expect(await songLookups(page)).toEqual([]);
});

import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.12 R5 (ticket-3.12 §6): a POPULAR section on the Artist screen, after
// the discography and before the biography, only when getTopSongs (by
// artist name, count 10) returns a song. Up to 10 v4 track rows (number,
// title, album, star, duration). Enter plays the ten from that row; hold OK
// opens the options sheet. Focus: albums <-> Popular <-> similar artists <->
// the NP bar; Left to the left panel. An empty answer or an error shows
// nothing. The mock: even-indexed artists that own an album get its tracks,
// odd ones none; mockTopSongsFail=1 answers with an error.

// Hold-OK as the platform sends it (e2e/options-sheet.spec.ts): CDP key
// events, a keyDown, auto-repeats, a keyUp.
async function holdOk(page: Page, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat,
  } as any);
  await send('keyDown');
  const t0 = Date.now();
  while (Date.now() - t0 < ms - 40) { await page.waitForTimeout(40); await send('keyDown', true); }
  await send('keyUp');
}

async function recordTopSongs(page: Page) {
  await page.addInitScript(() => {
    (window as any).__top = [];
    document.addEventListener('DOMContentLoaded', () => {
      const f = window.fetch;
      window.fetch = function(u: any) {
        const s = typeof u === 'string' ? u : u.url;
        if (/getTopSongs/.test(s)) {
          const q = new URL(s, location.href).searchParams;
          (window as any).__top.push({ artist: q.get('artist'), count: q.get('count') });
        }
        return f.apply(this, arguments as any);
      } as any;
    });
  });
}

// Library -> Artists -> the artist at `index` (in the grid's first row).
async function openArtist(page: Page, index: number) {
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown'); await H.settle(page, 250);
  await H.press(page, 'ArrowLeft'); await H.settle(page, 100);
  await H.press(page, 'ArrowDown'); await page.waitForTimeout(400);
  await H.press(page, 'ArrowRight'); await H.settle(page, 200);
  if (index) await H.press(page, 'ArrowRight', index, 60);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-albums-list'));
  await page.waitForFunction(() => !document.querySelector('.page-ghost'));
  await H.settle(page, 300);
}

const sections = (page: Page) => page.evaluate(() => Array.prototype.map.call(
  document.querySelectorAll('#page-current .artist-section-label'), (l: Element) => l.textContent));

const popularRows = (page: Page) => page.evaluate(() => Array.prototype.map.call(
  document.querySelectorAll('#page-current #artist-popular-list .track-row'), (r: HTMLElement) => ({
    id: r.getAttribute('data-song-id'),
    n: r.querySelector('.track-row-number')!.textContent,
    title: r.querySelector('.track-row-title')!.textContent,
    album: r.querySelector('.track-row-album')!.textContent,
    duration: r.querySelector('.track-row-duration')!.textContent,
    star: !!r.querySelector('.track-row-star'),
  })));

test('R5 Popular: ten rows between Discography and Biography; the down-walk passes through them in order', async ({ page }) => {
  const errors = H.watchErrors(page);
  await recordTopSongs(page);
  await H.bootMock(page, { extra: 'mockArtistInfo=1' });
  await H.startTrack(page, 1, { paused: true });
  await openArtist(page, 0);
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-popular-list'));
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-similar-row'));
  expect(await page.evaluate(() => (window as any).__top)).toEqual([{ artist: 'A Artist 01', count: '10' }]);
  expect(await sections(page)).toEqual(['DISCOGRAPHY', 'POPULAR', 'BIOGRAPHY', 'SIMILAR ARTISTS']);
  const rows = await popularRows(page);
  const want = await page.evaluate(() => Array.from({ length: 10 }, (_, t) => 'song-album-0-' + t));
  expect(rows.map((r) => r.id)).toEqual(want);
  expect(rows[0]).toEqual({ id: 'song-album-0-0', n: '1', title: 'Track 01', album: 'Album 01', duration: rows[0].duration, star: true });
  expect(rows[9].n).toBe('10');
  expect(rows[0].duration).toMatch(/^\d+:\d\d$/);

  // From the first album, Down all the way: albums, the ten Popular rows in
  // order, the similar artists, the NP bar.
  expect((await H.focus(page)).zone).toBe('artist-albums');
  const walk = await H.downWalk(page, 40);
  expect(walk.zones).toEqual(['artist-albums', 'artist-popular', 'artist-similar', 'nowplaying-bar']);
  const popIdx = walk.steps.filter((s) => s.zone === 'artist-popular').map((s) => s.index);
  expect(popIdx).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Up from the similar artists returns to Popular's last row; Left goes to
  // the left panel.
  await page.evaluate(() => FocusManager.setActiveZone('artist-similar', 0, true));
  await H.press(page, 'ArrowUp');
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 9 });
  await H.press(page, 'ArrowLeft');
  expect((await H.focus(page)).zone).toBe('content');
  expect(errors.pageErrors).toEqual([]);
});

test('R5 Enter plays the ten from that row; hold OK opens the options sheet, Back returns to the row', async ({ page }) => {
  await H.bootMock(page);
  await openArtist(page, 0);
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-popular-list'));
  // Down from the albums into Popular, then to its fourth row.
  for (let i = 0; i < 6 && (await H.focus(page)).zone !== 'artist-popular'; i++) await H.press(page, 'ArrowDown', 1, 60);
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 0 });
  await H.press(page, 'ArrowDown', 3, 60);
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 3 });
  const ids = (await popularRows(page)).map((r) => r.id);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  const s = await page.evaluate(() => ({ queue: Player.getState().queue.map((t: any) => t.id), index: Player.getState().queueIndex, id: Player.getState().currentTrack.id }));
  expect(s).toEqual({ queue: ids, index: 3, id: ids[3] });
  await page.evaluate(() => Player.pause());
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 3 });
  // Hold OK on row 5.
  await H.press(page, 'ArrowDown');
  await holdOk(page, 900);
  await page.waitForFunction(() => !!document.getElementById('options-sheet'));
  expect(await page.evaluate(() => document.querySelector('#options-sheet .options-sheet-title')!.textContent)).toBe('Track 05');
  expect(await page.evaluate(() => Player.getState().currentTrack.id)).toBe(ids[3]);   // the hold did not play it
  await H.press(page, 'Escape');
  await page.waitForFunction(() => !document.getElementById('options-sheet'));
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 4 });
});

test('R5 guard (passes on 3.11 too): no top songs, or an error: no section, no zone, no error shown', async ({ page }) => {
  const errors = H.watchErrors(page);
  await H.bootMock(page);
  await H.startTrack(page, 1, { paused: true });
  await openArtist(page, 1);                       // artist-1: the mock has none
  await page.waitForTimeout(300);
  expect(await sections(page)).toEqual(['DISCOGRAPHY']);
  expect(await page.evaluate(() => FocusManager.hasZone('artist-popular'))).toBe(false);
  const walk = await H.downWalk(page, 20);
  expect(walk.zones).toEqual(['artist-albums', 'nowplaying-bar']);

  await page.goto('about:blank');
  await H.bootMock(page, { extra: 'mockTopSongsFail=1' });
  await openArtist(page, 0);                       // artist-0 would have ten
  await page.waitForTimeout(300);
  expect(await sections(page)).toEqual(['DISCOGRAPHY']);
  expect(await page.evaluate(() => FocusManager.hasZone('artist-popular'))).toBe(false);
  expect(await page.evaluate(() => !!document.querySelector('.sonance-toast'))).toBe(false);
  expect(errors.pageErrors).toEqual([]);
});

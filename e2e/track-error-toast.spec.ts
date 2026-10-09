import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.12 R6 (ticket-3.12 §6): a track that does not load says why, in a toast
// naming it: "format not supported" when the engine could not read the
// media, "couldn't be loaded" otherwise. The stop toast after three failures
// in a row is unchanged and is the last one shown.
//
// HTML5 (the browser fallback): Chromium reports MediaError code 4 for an
// undecodable body and for a 404 or a refused request alike; only its
// message tells them apart (probed 2026-10-09, ticket-3.12 §9).
// AVPlay: onerror's AVPlayError (PLAYER_ERROR_NOT_SUPPORTED_FILE /
// _FORMAT), prepareAsync's WebAPIException type (NotSupportedError).

const AVPLAY_STUB = path.resolve(__dirname, '..', 'tests', 'avplay-stub.js');
const STOP = 'Playback stopped — tracks could not be played';

async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__toasts = [];
    const orig = App.showToast;
    (App as any).showToast = function(msg: string) { w.__toasts.push(msg); return orig.apply(this, arguments as any); };
  });
}
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts.slice());

// stream.view answers by song id: 'format' = a body no demuxer can open,
// 'missing' = HTTP 404; anything else goes to the dev server's WAV.
async function failStreams(page: Page, ids: Record<string, 'format' | 'missing'>) {
  await page.route(/\/rest\/stream\.view/, (route) => {
    const kind = ids[new URL(route.request().url()).searchParams.get('id') || ''];
    if (kind === 'format') return route.fulfill({ status: 200, contentType: 'audio/ogg', body: Buffer.from('not audio at all '.repeat(200)) });
    if (kind === 'missing') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    return route.continue();
  });
}

const play = (page: Page, from: number, n: number) => page.evaluate(([a, b]) =>
  Player.setQueue((window as any).__MOCK__.songs.slice(a, a + b), 0), [from, n]);

test('R6 HTML5: an unreadable track shows "<title> — format not supported" and the next one plays', async ({ page }) => {
  await failStreams(page, { 'song-0': 'format' });
  await H.bootMock(page);
  await recordToasts(page);
  await play(page, 0, 3);
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-1' && Player.getState().isPlaying);
  expect(await toasts(page)).toEqual(['Track 01 — format not supported']);
  await page.evaluate(() => Player.pause());
});

test('R6 HTML5: a track whose request fails shows "<title> — couldn\'t be loaded"', async ({ page }) => {
  await failStreams(page, { 'song-0': 'missing' });
  await H.bootMock(page);
  await recordToasts(page);
  await play(page, 0, 3);
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-1' && Player.getState().isPlaying);
  expect(await toasts(page)).toEqual(['Track 01 — couldn\'t be loaded']);
  // The toast on screen names the track.
  expect(await page.evaluate(() => document.querySelector('.sonance-toast')!.textContent)).toBe('Track 01 — couldn\'t be loaded');
  await page.evaluate(() => Player.pause());
});

test('R6 HTML5: three failures in a row end on the stop toast', async ({ page }) => {
  await failStreams(page, { 'song-0': 'format', 'song-1': 'missing', 'song-2': 'format' });
  await H.bootMock(page);
  await recordToasts(page);
  await play(page, 0, 4);
  await expect.poll(() => toasts(page)).toContain(STOP);
  await page.waitForTimeout(500);
  expect(await toasts(page)).toEqual([
    'Track 01 — format not supported',
    'Track 02 — couldn\'t be loaded',
    'Track 03 — format not supported',
    STOP,
  ]);
  expect(await page.evaluate(() => document.querySelector('.sonance-toast')!.textContent)).toBe(STOP);
  expect(await page.evaluate(() => ({ id: Player.getState().currentTrack.id, playing: Player.getState().isPlaying })))
    .toEqual({ id: 'song-2', playing: false });
});

test('R6 AVPlay (stub): the cause comes from the AVPlay error (onerror and prepareAsync)', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await H.bootMock(page);
  expect(await page.evaluate(() => Player.IS_TIZEN)).toBe(true);
  await recordToasts(page);
  const stub = (fn: string) => page.evaluate(fn);
  // 1. onerror with PLAYER_ERROR_NOT_SUPPORTED_FILE, after a good prepare.
  await page.evaluate(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await play(page, 0, 8);
  await page.waitForFunction(() => Player.getState().isPlaying);
  await stub("window.__avstub.emit('onerror', 'PLAYER_ERROR_NOT_SUPPORTED_FILE')");
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-1' && Player.getState().isPlaying);
  // 2. onerror with a connection failure.
  await stub("window.__avstub.emit('onerror', 'PLAYER_ERROR_CONNECTION_FAILED')");
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-2' && Player.getState().isPlaying);
  // 3. onerror with PLAYER_ERROR_NOT_SUPPORTED_FORMAT.
  await stub("window.__avstub.emit('onerror', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT')");
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-3' && Player.getState().isPlaying);
  // 4. prepareAsync failing with a NotSupportedError, then one with another
  // type: the queue moves on to song-6, which prepares.
  await page.evaluate(() => {
    const s = (window as any).__avstub;
    s.prepareErrors = [{ name: 'NotSupportedError', message: 'unsupported' }, { name: 'UnknownError', message: 'x' }];
    s.setScript(['err', 'err', 'ok']);
    Player.next();
  });
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-6' && Player.getState().isPlaying);
  expect(await toasts(page)).toEqual([
    'Track 01 — format not supported',
    'Track 02 — couldn\'t be loaded',
    'Track 03 — format not supported',
    'Track 05 — format not supported',
    'Track 06 — couldn\'t be loaded',
  ]);
});

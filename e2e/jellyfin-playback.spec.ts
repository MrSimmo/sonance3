import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.13 R6 (ticket-3.xx-jellyfin): playback on a Jellyfin session, the twin
// of e2e/opus.spec.ts. A plain track streams from /Audio/{id}/stream with
// static=true (byte ranges); an Opus track from stream.mp3 with
// audioCodec=mp3&audioBitRate=320000, and a seek reloads it with
// startTimeTicks (seconds x 10^7), never an engine seek. Stream URLs carry
// ApiKey; the session's token. tests/dev-server.js serves both routes.
// R7 in the app: a track played past its scrobble point sends one
// POST /UserPlayedItems/{id}.

const AVPLAY_STUB = path.resolve(__dirname, '..', 'tests', 'avplay-stub.js');

function streamRequests(page: Page) {
  const out: string[] = [];
  page.on('request', (r) => { if (/\/Audio\/[^/]+\/stream/.test(r.url())) out.push(r.url()); });
  return out;
}

const q = (u: string) => {
  const url = new URL(u);
  const s = url.searchParams;
  return { path: url.pathname, static: s.get('static'), audioCodec: s.get('audioCodec'), audioBitRate: s.get('audioBitRate'),
    startTimeTicks: s.get('startTimeTicks'), apiKey: s.get('ApiKey') };
};

const token = (page: Page) => page.evaluate(() => localStorage.getItem('sonance_jf_token'));

test('R6 a plain track streams static with ApiKey; an Opus track as MP3 at 320; both play (HTML5)', async ({ page }) => {
  const reqs = streamRequests(page);
  await H.bootJellyfin(page);
  const key = await token(page);
  for (const [n, opus] of [[0, false], [4, true]] as [number, boolean][]) {
    reqs.length = 0;
    await page.evaluate((i) => Player.setQueue([(window as any).__MOCK__.songs[i]], 0), n);
    await expect.poll(() => reqs.length).toBeGreaterThan(0);
    expect(q(reqs[0])).toEqual(opus
      ? { path: '/Audio/song-' + n + '/stream.mp3', static: null, audioCodec: 'mp3', audioBitRate: '320000', startTimeTicks: null, apiKey: key }
      : { path: '/Audio/song-' + n + '/stream', static: 'true', audioCodec: null, audioBitRate: null, startTimeTicks: null, apiKey: key });
    await page.waitForFunction((id) => {
      const a = Player.getActiveAudioElement();
      return Player.getState().currentTrack.id === id && !!a && a.currentTime > 0.2;
    }, 'song-' + n, { timeout: 5000 });
  }
  await page.evaluate(() => Player.pause());
});

test('R6 seeking an Opus track to 90 s reloads it at startTimeTicks=900000000; the time reads 1:30 and advances', async ({ page }) => {
  const reqs = streamRequests(page);
  await H.bootJellyfin(page);
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[4]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(await page.evaluate(() => Player.getState().duration)).toBe(184);
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 150);
  await H.press(page, 'ArrowUp');
  expect((await H.focus(page)).zone).toBe('np-progress');
  reqs.length = 0;
  await H.press(page, 'ArrowLeft', 1, 100);
  await H.press(page, 'ArrowRight', 9, 100);
  await expect.poll(() => reqs.filter((u) => q(u).startTimeTicks !== null).length, { timeout: 5000 }).toBe(1);
  const reload = reqs.filter((u) => q(u).startTimeTicks !== null);
  expect(q(reload[0])).toMatchObject({ path: '/Audio/song-4/stream.mp3', audioCodec: 'mp3', startTimeTicks: '900000000' });
  await page.waitForFunction(() => Player.getState().isPlaying);
  const label = () => page.evaluate(() => document.querySelector('.np-screen-time')!.textContent);
  const secs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
  await page.waitForTimeout(400);
  const t1 = secs(await label());
  expect(Math.abs(t1 - 90)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(2200);
  expect(secs(await label())).toBeGreaterThan(t1);
  await page.evaluate(() => Player.pause());
});

test('R6 AVPlay (stub): open carries ApiKey and the transcode; a seek reopens at startTimeTicks, no seekTo; next is transcoded', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await H.bootJellyfin(page);
  expect(await page.evaluate(() => Player.IS_TIZEN)).toBe(true);
  const key = await token(page);
  const opens = () => page.evaluate(() => (window as any).__avstub.log.filter((e: any) => e.call === 'open').map((e: any) => e.arg));
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[4], (window as any).__MOCK__.songs[9]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(q((await opens())[0])).toMatchObject({ path: '/Audio/song-4/stream.mp3', audioBitRate: '320000', startTimeTicks: null, apiKey: key });
  expect(await page.evaluate(() => Player.getState().duration)).toBe(184);
  await page.evaluate(() => { (window as any).__avstub.reset(); Player.seekTo(90.6); });
  await page.waitForFunction(() => (window as any).__avstub.calls('open') === 1, null, { timeout: 3000 });
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(await page.evaluate(() => (window as any).__avstub.calls('seekTo'))).toBe(0);
  expect(q((await opens())[0])).toMatchObject({ path: '/Audio/song-4/stream.mp3', startTimeTicks: '900000000' });
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', 2000));
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(92);
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', (184 - 90 - 3) * 1000));
  await page.evaluate(() => { (window as any).__avstub.reset(); (window as any).__avstub.emit('onstreamcompleted'); });
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-9');
  expect(q((await opens())[0])).toMatchObject({ path: '/Audio/song-9/stream.mp3', startTimeTicks: null, apiKey: key });
});

test('R6 AVPlay (stub): a plain track opens static with ApiKey and seeks in place', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await H.bootJellyfin(page);
  const key = await token(page);
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[1]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  const open = await page.evaluate(() => (window as any).__avstub.log.filter((e: any) => e.call === 'open')[0].arg);
  expect(q(open)).toEqual({ path: '/Audio/song-1/stream', static: 'true', audioCodec: null, audioBitRate: null, startTimeTicks: null, apiKey: key });
  await page.evaluate(() => { (window as any).__avstub.reset(); Player.seekTo(30); });
  await page.waitForFunction(() => (window as any).__avstub.calls('seekTo') === 1);
  expect(await page.evaluate(() => (window as any).__avstub.calls('open'))).toBe(0);
});

test('R7 in the app: past the scrobble point, one POST /UserPlayedItems for the track (AVPlay stub)', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await H.bootJellyfin(page);
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[2]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  const dur = await page.evaluate(() => Player.getState().duration);
  await page.evaluate((ms) => (window as any).__avstub.emit('oncurrentplaytime', ms), Math.ceil(dur * 0.5 + 1) * 1000);
  await page.waitForFunction(() => (window as any).__MOCK__.jf.scrobbles.length === 1);
  await page.evaluate((ms) => (window as any).__avstub.emit('oncurrentplaytime', ms), Math.ceil(dur * 0.5 + 5) * 1000);
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => (window as any).__MOCK__.jf.scrobbles);
  expect(s.map((x: any) => x.id)).toEqual(['song-2']);
  const writes = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.backend === 'jellyfin' && c.method !== 'GET')
    .map((c: any) => c.method + ' ' + c.path));
  expect(writes).toEqual(['POST /UserPlayedItems/song-2']);
  await page.evaluate(() => Player.pause());
});

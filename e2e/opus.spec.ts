import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.12 R1 (ticket-3.12 §6): Opus through a server transcode. A track whose
// suffix is opus (any case), or whose contentType names opus, streams from
// stream.view with format=mp3&maxBitRate=320; every other track's URL is
// byte-identical to 3.11's. A transcode has no byte ranges, so a seek
// reloads it with timeOffset (whole seconds) and the player adds the offset
// to the engine's position; the duration comes from the track's metadata.
//
// The mock models a transcoding server: songs 4, 9, 14 and 19 are .opus
// (tests/mock-boot.js), and the dev server answers format=mp3 with MP3
// frames, chunked, with no byte ranges (tests/dev-server.js).

const AVPLAY_STUB = path.resolve(__dirname, '..', 'tests', 'avplay-stub.js');

// Every stream.view request the page makes (the <audio> elements' media
// requests included).
function streamRequests(page: Page) {
  const out: string[] = [];
  page.on('request', (r) => { if (/\/rest\/stream\.view/.test(r.url())) out.push(r.url()); });
  return out;
}

const q = (u: string) => {
  const s = new URL(u).searchParams;
  return { id: s.get('id'), format: s.get('format'), maxBitRate: s.get('maxBitRate'), timeOffset: s.get('timeOffset') };
};

// 3.11's stream URL for an id, built here from its parts, as 3.11's
// getStreamUrl(id) built it: the auth block, then id and nothing else.
const url311 = (page: Page, id: string) => page.evaluate((songId) => {
  const api = AuthManager.getApi();
  return api.serverUrl + '/rest/stream.view?u=' + encodeURIComponent(api.username) + '&t=' + api.token +
    '&s=' + api.salt + '&v=1.16.1&c=Sonance&f=json&id=' + encodeURIComponent(songId);
}, id);

async function seedSavedQueue(page: Page, ids: string[], index: number, position: number) {
  await page.addInitScript((sq) => {
    if (!sessionStorage.getItem('__seeded__')) {
      localStorage.setItem('__mock_playqueue__', JSON.stringify(sq));
      sessionStorage.setItem('__seeded__', '1');
    }
  }, { ids, index, position, byIndex: true });
}

test('R1 an Opus track streams as MP3 at 320; WAV, FLAC and MP3 URLs are 3.11\'s', async ({ page }) => {
  const reqs = streamRequests(page);
  await H.bootMock(page);
  // One song per case (an identical URL would be answered from the cache
  // without a request), its suffix and contentType set by the case.
  const cases: [number, string, string, boolean][] = [
    [0, 'wav', 'audio/wav', false], [1, 'flac', 'audio/flac', false], [2, 'mp3', 'audio/mpeg', false],
    [3, 'opus', 'audio/ogg', true], [5, 'OPUS', 'audio/ogg', true], [6, 'ogg', 'audio/ogg; codecs=opus', true],
  ];
  for (const [n, suffix, type, transcode] of cases) {
    reqs.length = 0;
    await page.evaluate(([i, s, t]) => {
      const song = Object.assign({}, (window as any).__MOCK__.songs[i as number], { suffix: s, contentType: t });
      Player.setQueue([song], 0);
    }, [n, suffix, type]);
    await expect.poll(() => reqs.length, { message: suffix }).toBeGreaterThan(0);
    const base = await url311(page, 'song-' + n);
    expect(reqs[0], suffix + ' ' + type).toBe(transcode ? base + '&format=mp3&maxBitRate=320' : base);
    // It plays: the WAV, or the dev server's MP3 for a transcode.
    await page.waitForFunction((id) => {
      const a = Player.getActiveAudioElement();
      return Player.getState().currentTrack.id === id && !!a && a.currentTime > 0.2;
    }, 'song-' + n, { timeout: 5000 });
  }
  await page.evaluate(() => Player.pause());
});

test('R1 the prepared next track carries the transcode (HTML5 preload)', async ({ page }) => {
  const reqs = streamRequests(page);
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(3, 5), 0));   // wav, then opus
  await page.waitForFunction(() => Player.getState().isPlaying && Player.getState().duration > 10);
  expect(await page.evaluate(() => (window as any).__MOCK__.songs[4].suffix)).toBe('opus');
  reqs.length = 0;
  await page.evaluate(() => Player.seekTo(Player.getState().duration - 4));   // inside the last 5 s
  await expect.poll(() => reqs.filter((u) => q(u).id === 'song-4').length).toBeGreaterThan(0);
  expect(q(reqs.filter((u) => q(u).id === 'song-4')[0])).toMatchObject({ format: 'mp3', maxBitRate: '320', timeOffset: null });
  await page.evaluate(() => Player.pause());
});

test('R1 seeking an Opus track to 90 s (Right x9 on the progress bar) reloads it at timeOffset=90; the time reads 1:30 and advances', async ({ page }) => {
  const reqs = streamRequests(page);
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[4]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  // The duration is the track's (184 s), not the stream's.
  expect(await page.evaluate(() => Player.getState().duration)).toBe(184);
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');            // np-controls (Play)
  await H.settle(page, 150);
  await H.press(page, 'ArrowUp');              // the progress bar
  expect((await H.focus(page)).zone).toBe('np-progress');
  reqs.length = 0;
  // Left first: back to 0 s (the track has played about a second), then
  // +10 s nine times, 100 ms apart: one reload, when the presses stop.
  await H.press(page, 'ArrowLeft', 1, 100);
  await H.press(page, 'ArrowRight', 9, 100);
  await expect.poll(() => reqs.filter((u) => q(u).timeOffset !== null).length, { timeout: 5000 }).toBe(1);
  const reload = reqs.filter((u) => q(u).timeOffset !== null);
  test.info().annotations.push({ type: 'seek requests', description: JSON.stringify(reqs.map(q)) });
  expect(q(reload[0])).toMatchObject({ id: 'song-4', format: 'mp3', maxBitRate: '320', timeOffset: '90' });
  await page.waitForFunction(() => Player.getState().isPlaying);
  const label = () => page.evaluate(() => document.querySelector('.np-screen-time')!.textContent);
  const secs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
  await page.waitForTimeout(400);
  const t1 = secs(await label());
  expect(Math.abs(t1 - 90)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(2200);
  const t2 = secs(await label());
  expect(t2).toBeGreaterThan(t1);
  expect(await page.evaluate(() => Player.getState().currentTime)).toBeGreaterThan(91);
  await page.evaluate(() => Player.pause());
});

test('R1 resuming the saved queue into an Opus track at 42 s loads it with timeOffset=42 (HTML5)', async ({ page }) => {
  const reqs = streamRequests(page);
  await seedSavedQueue(page, ['song-4', 'song-5'], 0, 42000);
  await H.bootMock(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await H.settle(page, 200);
  expect(reqs.length).toBe(0);
  await page.keyboard.press('Space');          // Play/Pause (the browser stand-in for 10252)
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(q(reqs[0])).toMatchObject({ id: 'song-4', format: 'mp3', maxBitRate: '320', timeOffset: '42' });
  await page.waitForTimeout(1200);
  const t = await page.evaluate(() => Player.getState().currentTime);
  expect(t).toBeGreaterThanOrEqual(42);
  expect(t).toBeLessThan(46);
  await page.evaluate(() => Player.pause());
});

// The TV path (js/player.js's AVPlay branch, against tests/avplay-stub.js).
test('R1 AVPlay (stub): open carries the transcode; a seek reopens at the offset; position = offset + engine; gapless next is transcoded', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await H.bootMock(page);
  expect(await page.evaluate(() => Player.IS_TIZEN)).toBe(true);
  const opens = () => page.evaluate(() => (window as any).__avstub.log.filter((e: any) => e.call === 'open').map((e: any) => e.arg));
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[4], (window as any).__MOCK__.songs[9]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(q((await opens())[0])).toMatchObject({ id: 'song-4', format: 'mp3', maxBitRate: '320', timeOffset: null });
  // The stub's getDuration is 214 s; the track's metadata says 184 s.
  expect(await page.evaluate(() => Player.getState().duration)).toBe(184);
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', 3000));
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(3);
  // A seek: no AVPlay seekTo (no ranges); one reopen at the whole second.
  await page.evaluate(() => { (window as any).__avstub.reset(); Player.seekTo(90.6); });
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(90.6);
  await page.waitForFunction(() => (window as any).__avstub.calls('open') === 1, null, { timeout: 3000 });
  await page.waitForFunction(() => Player.getState().isPlaying);
  expect(await page.evaluate(() => (window as any).__avstub.calls('seekTo'))).toBe(0);
  expect(q((await opens())[0])).toMatchObject({ id: 'song-4', format: 'mp3', timeOffset: '90' });
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', 2000));
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(92);
  // Into the last 5 s of the track (absolute): the next track is prepared
  // with its transcode, and opened from there when the stream completes.
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', (184 - 90 - 3) * 1000));
  await page.evaluate(() => { (window as any).__avstub.reset(); (window as any).__avstub.emit('onstreamcompleted'); });
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-9');
  expect(q((await opens())[0])).toMatchObject({ id: 'song-9', format: 'mp3', maxBitRate: '320', timeOffset: null });
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(0);
});

test('R1 AVPlay (stub): a resume at 42 s opens the transcode at timeOffset=42 and does not seek', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await seedSavedQueue(page, ['song-4', 'song-5'], 0, 42000);
  await H.bootMock(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await H.settle(page, 200);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => Player.getState().isPlaying);
  const trace = await page.evaluate(() => (window as any).__avstub.log
    .filter((e: any) => /^(open|prepareAsync|prepare:ok|seekTo|play)$/.test(e.call))
    .map((e: any) => e.call + (e.call === 'open' ? ':' + new URL(e.arg).searchParams.get('timeOffset') : '')));
  expect(trace).toEqual(['open:42', 'prepareAsync', 'prepare:ok', 'play']);
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(42);
  await page.evaluate(() => (window as any).__avstub.emit('oncurrentplaytime', 1000));
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(43);
});

// Paused, a seek in a transcode moves the position and reopens nothing;
// Play reopens at the new offset (the A8 cue is not used for this).
test('R1 AVPlay (stub): a seek while paused waits for Play, then opens at the offset', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue([(window as any).__MOCK__.songs[4]], 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  await page.evaluate(() => { Player.pause(); (window as any).__avstub.reset(); Player.seekTo(60); });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__avstub.calls('open'))).toBe(0);
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(60);
  await page.evaluate(() => Player.play());
  await page.waitForFunction(() => (window as any).__avstub.calls('open') === 1);
  await page.waitForFunction(() => Player.getState().isPlaying);
  const open = await page.evaluate(() => (window as any).__avstub.log.filter((e: any) => e.call === 'open')[0].arg);
  expect(q(open)).toMatchObject({ id: 'song-4', timeOffset: '60' });
});

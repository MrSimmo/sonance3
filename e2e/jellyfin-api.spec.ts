import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.13 (ticket-3.xx-jellyfin): the Jellyfin adapter, in-page on the
// Jellyfin mock (tests/mock-boot.js ?mockBackend=jellyfin). R4 is the
// transport; R5/R8/R10 the translators (one test each); R6 the media URLs;
// R7 the writes. Each drives a JellyfinAPI the test builds, so it reads
// exactly what the adapter sent (window.__MOCK__.calls) and returned.

const ROOT = path.resolve(__dirname, '..');

// A no-session page on the Jellyfin mock: the app sits on Login, and the
// test owns the API instance.
async function page0(page: Page, extra?: string) {
  await H.bootJellyfin(page, { waitFor: false, extra: 'mockNoSession=1' + (extra ? '&' + extra : '') });
  await page.waitForSelector('.login-screen');
}

// Builds `window.__jf`, signed in with the mock's seeded token.
async function api(page: Page, opts?: any) {
  await page.evaluate((o) => {
    const w = window as any;
    w.__jf = new (w as any).JellyfinAPI(Object.assign({
      serverUrl: window.location.origin, username: 'mockuser', password: 'mockpass',
      token: w.__MOCK__.jf.seedToken, userId: w.__MOCK__.jf.userId, deviceId: 'dev-test-0001'
    }, o || {}));
  }, opts || {});
}

const lastCall = (page: Page, re?: string) => page.evaluate((r) => {
  const calls = (window as any).__MOCK__.calls.filter((c: any) => c.backend === 'jellyfin' && (!r || new RegExp(r).test(c.path)));
  return calls[calls.length - 1] || null;
}, re || null);

// --- R4: the transport ----------------------------------------------------

test.describe('R4 transport', () => {
  test('the header is MediaBrowser with the five quoted values, and nothing else carries auth', async ({ page }) => {
    await page0(page);
    await api(page);
    await page.evaluate(() => (window as any).__jf.getMusicFolders());
    const call = await lastCall(page, '^/UserViews$');
    expect(call.auth).toBe('MediaBrowser Client="Sonance", Device="Browser", DeviceId="dev-test-0001", ' +
      'Version="3.13.0", Token="mock-jf-token-seed"');
    expect(call.query).toEqual({ includeHidden: 'true' });
  });

  test('values are URL-encoded inside the quotes', async ({ page }) => {
    await page0(page);
    await api(page, { deviceId: 'a "b",c' });
    await page.evaluate(() => (window as any).__jf.getMusicFolders());
    expect((await lastCall(page, '^/UserViews$')).auth).toContain('DeviceId="a%20%22b%22%2Cc"');
  });

  test('SubsonicAPI.abortAll() cancels an in-flight Jellyfin request', async ({ page }) => {
    await page0(page, 'mockPingDelay=3000');
    await api(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const t0 = performance.now();
      const p = w.__jf.ping().then(() => 'resolved', (e: any) => 'rejected: ' + e.name);
      await new Promise((res) => setTimeout(res, 100));
      const n = w.SubsonicAPI.abortAll();
      const outcome = await p;
      return { n, outcome, ms: Math.round(performance.now() - t0) };
    });
    expect(r.n).toBe(1);
    expect(r.outcome).toBe('rejected: AbortError');
    expect(r.ms).toBeLessThan(1500);
  });

  test('a timeout rejects with api.js\'s message (login matches "timed out")', async ({ page }) => {
    await page0(page, 'mockPingDelay=2000');
    await api(page);
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      const msg = await (window as any).__jf._send('GET', '/System/Info', null, null, { timeout: 200 })
        .then(() => 'resolved', (e: any) => e.message);
      return { msg, ms: Math.round(performance.now() - t0) };
    });
    expect(r.msg).toBe('Request timed out. Check your server connection.');
    expect(r.ms).toBeLessThan(1000);
    expect(await page.evaluate(() => (window as any).SubsonicAPI.abortAll())).toBe(0);
  });

  test('an HTTP error rejects "Server returned HTTP <n>"', async ({ page }) => {
    await page0(page, 'mockJfFavFail=1');
    await api(page);
    const msg = await page.evaluate(() => (window as any).__jf.star('song-1', 'song').then(() => 'ok', (e: any) => e.message));
    expect(msg).toBe('Server returned HTTP 500');
  });

  test('an unknown endpoint rejects clearly, and no Subsonic URL can be built', async ({ page }) => {
    await page0(page);
    await api(page);
    const r = await page.evaluate(async () => {
      const a = (window as any).__jf;
      const unknown = await a._request('getNowPlaying.view').then(() => 'resolved', (e: any) => e.message);
      let built = 'no throw';
      try { a._buildUrl('ping.view'); } catch (e: any) { built = e.message; }
      return { unknown, built };
    });
    expect(r.unknown).toBe('Not available on Jellyfin: getNowPlaying.view');
    expect(r.built).toBe('Jellyfin adapter: no Subsonic URL for ping.view');
  });

  test('no legacy auth anywhere in js/ (api_key, X-Emby, X-MediaBrowser)', async () => {
    const hits: string[] = [];
    const files = fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f)
      .concat(fs.readdirSync(path.join(ROOT, 'js', 'screens')).map((f) => 'js/screens/' + f))
      .filter((f) => /\.js$/.test(f) && !/\.min\.js$/.test(f));
    files.forEach((f) => {
      fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (/api_key|X-Emby|X-MediaBrowser/.test(line)) hits.push(f + ':' + (i + 1));
      });
    });
    expect(files).toContain('js/jellyfin-api.js');
    expect(hits).toEqual([]);
  });
});

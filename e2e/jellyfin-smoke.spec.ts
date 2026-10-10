import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.13 R12.5 (ticket-3.xx-jellyfin): on a Jellyfin session every screen
// renders with 0 page errors and no response of 400 or above (the
// Tizen-only webapis 404 aside), on the unbundled mock rig and on the
// bundled build the .wgt ships. Plus: an artist image Jellyfin does not
// have (a 404) leaves the card as a failed image does on Navidrome, and
// R12.6, watchErrors redacts the Jellyfin token parameters.

async function visitEverything(page: Page) {
  const seen: string[] = [];
  for (const screen of H.NAV.slice(1)) {
    await H.navTo(page, screen);
    seen.push(await page.evaluate(() => App.getCurrentScreen()));
  }
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  seen.push('album');
  await page.waitForTimeout(350);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await H.settle(page, 400);
  await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => LibraryScreen.getActiveTab() === 'artists');
  await H.settle(page, 400);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  seen.push('artist');
  // Songs and Genres -> a genre.
  await page.waitForTimeout(350);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await H.settle(page, 400);
  await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => LibraryScreen.getActiveTab() === 'songs');
  await H.settle(page, 500);
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => LibraryScreen.getActiveTab() === 'genres');
  await H.settle(page, 500);
  await H.press(page, 'ArrowRight');
  await page.waitForFunction(() => !!document.querySelector('.genre-card.focused'));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 10000 });
  seen.push('genre');
  return seen;
}

for (const bundled of [false, true]) {
  test((bundled ? 'bundled build' : 'mock rig') + ': every screen on Jellyfin renders with 0 page errors', async ({ page }) => {
    const errs = H.watchErrors(page);
    await H.bootJellyfin(page, { bundled, extra: 'mockLyrics=1&mockArtistInfo=1' });
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).getAttribute('src') || ''));
    expect(scripts.some((s) => /sonance-core\.min\.js/.test(s))).toBe(bundled);
    expect(scripts.some((s) => /jellyfin-api\.js/.test(s))).toBe(!bundled);
    expect(await page.evaluate(() => (window as any).AuthManager.getBackend())).toBe('jellyfin');
    await H.startTrack(page, 3, { paused: true });
    const seen = await visitEverything(page);
    expect(seen).toEqual(['library', 'playlists', 'queue', 'nowplaying', 'search', 'settings', 'album', 'artist', 'genre']);
    expect(errs.pageErrors).toEqual([]);
    expect(errs.badResponses).toEqual([]);
    // Nothing was sent to a Subsonic endpoint.
    expect(await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => /\/rest\//.test(c.path || '')).length)).toBe(0);
  });
}

test('an artist image Jellyfin lacks (404) leaves the card as a failed image does on Navidrome', async ({ browser, baseURL }) => {
  const card = async (backend: string) => {
    const p: Page = await browser.newPage({ baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const consoleErrors: string[] = [];
    const errs = H.watchErrors(p);
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    if (backend === 'subsonic') {
      await p.route(/\/rest\/getCoverArt\.view\?.*id=artist-0(&|$)/, (r) => r.fulfill({ status: 404, body: '' }));
      await H.bootMock(p);
    } else {
      await p.request.get('/__jf-missing-images?ids=artist-0');
      await H.bootJellyfin(p);
    }
    await H.navTo(p, 'library');
    await H.press(p, 'ArrowDown');
    await H.settle(p, 250);
    await H.press(p, 'ArrowLeft');
    await H.press(p, 'ArrowDown');
    await p.waitForFunction(() => LibraryScreen.getActiveTab() === 'artists');
    await H.settle(p, 1200);
    const el = p.locator('#page-current .artist-grid-card').first();
    // ImageCache never hands a failed URL to the card, so its <img> stays
    // without a source and the placeholder under it shows.
    expect(await el.locator('img.loaded').count()).toBe(0);
    expect(await el.locator('.art-placeholder').count()).toBe(1);
    const shot = await el.screenshot({ animations: 'disabled' });
    if (backend === 'jellyfin') await p.request.get('/__jf-missing-images?ids=');
    await p.close();
    return { shot, consoleErrors, errs };
  };
  const sub = await card('subsonic');
  const jf = await card('jellyfin');
  const page = await browser.newPage({ baseURL });
  await page.goto('/tests/mock-index.html?mockNoSession=1');
  expect(await H.pngDiff(page, sub.shot, jf.shot)).toEqual({ n: 0, max: 0 });
  await page.close();
  expect(jf.errs.pageErrors).toEqual([]);
  expect(jf.errs.badResponses.length).toBe(1);
  expect(jf.errs.badResponses[0]).toMatch(/^404 .*\/Items\/artist-0\/Images\/Primary\?/);
  expect(jf.consoleErrors.every((m) => /Failed to load resource: the server responded with a status of 404/.test(m))).toBe(true);
});

test('R12.6 watchErrors redacts ApiKey, api_key and Token as it does u, t, s, p', async ({ page }) => {
  const errs = H.watchErrors(page);
  await page.goto('/no-such-file?ApiKey=SECRET1&api_key=SECRET2&Token=SECRET3&u=SECRET4&id=keep');
  expect(errs.badResponses.length).toBe(1);
  expect(errs.badResponses[0]).not.toMatch(/SECRET/);
  expect(errs.badResponses[0]).toMatch(/ApiKey=REDACTED&api_key=REDACTED&Token=REDACTED&u=REDACTED&id=keep$/);
});

import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// Every primary screen, plus the album and artist sub-screens, renders with 0
// page errors — on the unbundled mock rig and on the bundled build the .wgt
// ships. The only non-2xx response allowed is the Tizen-only
// `$WEBAPIS/webapis/webapis.js` 404 (H.watchErrors filters it).

async function visitEverything(page: Page) {
  const seen: string[] = [];
  for (const screen of H.NAV.slice(1)) {
    await H.navTo(page, screen);
    seen.push(await page.evaluate(() => App.getCurrentScreen()));
  }
  // Back along the nav to Library, then drill into an album and an artist.
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  seen.push('album');
  // Wait out js/app.js TRANSITION_LOCK_MS (300 ms): a Back inside it is
  // dropped. That drop is the R1.2 bug, characterised in transitions.spec.ts;
  // this walk is about rendering, so it does not race it. S4 removes the lock.
  await page.waitForTimeout(350);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await H.settle(page, 400);
  // Library grid → sub-nav → Artists tab → into the grid → Enter.
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
  return seen;
}

test('mock rig: every screen renders with 0 page errors', async ({ page }) => {
  const errs = H.watchErrors(page);
  await H.bootMock(page);
  const seen = await visitEverything(page);
  expect(seen).toEqual(['library', 'playlists', 'queue', 'nowplaying', 'search', 'settings', 'album', 'artist']);
  expect(errs.pageErrors).toEqual([]);
  expect(errs.badResponses).toEqual([]);
});

test('bundled build: every screen renders with 0 page errors', async ({ page }) => {
  const errs = H.watchErrors(page);
  await H.bootBundled(page);
  // Proves this is the bundle, not the unbundled sources.
  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).getAttribute('src')));
  expect(scripts.some((s) => /sonance-core\.min\.js/.test(s || ''))).toBe(true);
  const seen = await visitEverything(page);
  expect(seen).toEqual(['library', 'playlists', 'queue', 'nowplaying', 'search', 'settings', 'album', 'artist']);
  expect(errs.pageErrors).toEqual([]);
  expect(errs.badResponses).toEqual([]);
});

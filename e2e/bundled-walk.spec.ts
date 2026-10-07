import { test, expect } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10 S8 T3: on the bundles the .wgt ships (/index.html with
// tests/mock-boot.js injected), the surfaces e2e/smoke.spec.ts's walk does not
// reach — the splash on its real timeline (R11), Home's extra rows (A4),
// playlist detail (A3, R1.7), the options sheet and its credits view (A5), a
// genre's songs (A1) and Login — render with 0 page errors and no response
// >= 400 other than the Tizen-only webapis 404 (H.watchErrors filters it).
// OK is held through CDP, as a TV sends it (keydown, auto-repeats, keyup);
// Playwright's keyboard always pairs keydown and keyup.

test('bundled build: splash, Home rows, playlist detail, options sheet and credits, genre detail and Login with 0 page errors', async ({ page }) => {
  const errs = H.watchErrors(page);
  await H.bootBundled(page, { splash: 'real', waitFor: false, waitUntil: 'commit' });
  await page.waitForSelector('#splash', { state: 'attached' });
  await H.waitForScreen(page, 'home');
  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).getAttribute('src')));
  expect(scripts.some((s) => /sonance-screens\.min\.js/.test(s || ''))).toBe(true);
  const headings = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('.home-section'),
    (s: HTMLElement) => getComputedStyle(s).display !== 'none')
    .map((s: HTMLElement) => s.querySelector('.home-section-heading')!.textContent));
  expect(headings).toEqual(expect.arrayContaining(['Your favourites', 'Most played', 'Rediscover']));

  // Playlists grid -> the first playlist's songs.
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'content' &&
    !!document.querySelector('#playlist-songs .song-row.focused'), null, { timeout: 10000 });
  await H.settle(page, 300);

  // Hold OK on the first song: the sheet opens and nothing plays.
  const cdp = await page.context().newCDPSession(page);
  const ok = (type: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat
  } as any);
  await ok('keyDown');
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(40); await ok('keyDown', true); }
  await ok('keyUp');
  await page.waitForFunction(() => OptionsSheet.isOpen());
  expect(await page.evaluate(() => Player.getState().currentTrack)).toBe(null);

  // Its credits view, then Back twice: actions, then the row.
  const items: string[] = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('#options-sheet .options-sheet-item'), (e: HTMLElement) => e.getAttribute('data-action')));
  expect(items).toContain('credits');
  for (let i = 0; i < items.indexOf('credits'); i++) { await H.press(page, 'ArrowDown'); await H.settle(page, 20); }
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#options-sheet .credits-section').length > 0);
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  await H.press(page, 'Escape');
  await H.settle(page, 200);
  expect(await page.evaluate(() => OptionsSheet.isOpen())).toBe(false);
  expect(await H.focus(page)).toMatchObject({ zone: 'content', index: 0 });

  // Back to the grid, up to the top nav, then Library -> Genres -> the first genre.
  await H.press(page, 'Escape');
  await H.settle(page, 400);
  await H.press(page, 'Escape');
  await H.settle(page, 200);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');
  await H.press(page, 'ArrowDown', 3, 90);
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');
  await page.waitForFunction(() => !!document.querySelector('.genre-card.focused'));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 10000 });

  // No stored session: the splash gives way to Login.
  await page.goto('/index.html?mockNoSession=1');
  await page.waitForSelector('.login-screen');
  await H.splashGone(page);

  expect(errs.pageErrors).toEqual([]);
  expect(errs.badResponses).toEqual([]);
});

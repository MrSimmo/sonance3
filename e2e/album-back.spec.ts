import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10 S8 follow-up (ticket §11, D149): the album page's left column — the
// artist link, Play and Shuffle — records the focus before it navigates, as
// the track rows do (V3-6-fix NAV-1), so Back returns to that button instead
// of the top nav. Play and Shuffle navigate only through Auto Now Playing.

async function albumLeftColumn(page: Page) {
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid');
  await H.settle(page, 300);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');                        // the left column, on the star
  await H.settle(page, 120);
}

const focusedClass = (page: Page) => page.evaluate(() => {
  const e = FocusManager.getCurrentFocused();
  return e ? String(e.className).split(' ')[0] : null;
});

test('D149 Back from the artist page returns to the album\'s artist link', async ({ page }) => {
  await H.bootMock(page);
  await albumLeftColumn(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 120);
  expect(await focusedClass(page)).toBe('album-detail-artist');
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await H.settle(page, 300);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 300);
  expect(await H.focus(page)).toMatchObject({ zone: 'content', index: 1 });
  expect(await focusedClass(page)).toBe('album-detail-artist');
});

for (const c of [{ name: 'Play', downs: 2, cls: 'album-play-btn' }, { name: 'Shuffle', downs: 3, cls: 'album-shuffle-btn' }]) {
  test(`D149 with Auto Now Playing on, Back from Now Playing returns to the album's ${c.name}`, async ({ page }) => {
    await H.bootMock(page, { autoNp: true });
    await albumLeftColumn(page);
    await H.press(page, 'ArrowDown', c.downs, 60);
    await H.settle(page, 120);
    expect(await focusedClass(page)).toBe(c.cls);
    await H.press(page, 'Enter');
    await H.waitForScreen(page, 'nowplaying');
    await H.settle(page, 300);
    await H.press(page, 'Escape');
    await H.waitForScreen(page, 'album');
    await H.settle(page, 300);
    expect(await H.focus(page)).toMatchObject({ zone: 'content', index: c.downs });
    expect(await focusedClass(page)).toBe(c.cls);
  });
}

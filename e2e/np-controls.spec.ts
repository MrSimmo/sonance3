import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R3 (ticket-3.10 §7, D54/D55): the Now Playing controls row is always
// entered on Play/Pause (the np-controls zone's entryIndex), and focus never
// lands on an invisible element (the unavailable lyrics button is dimmed, not
// display:none). S1 wrote these as `test.fail` targets next to `[today]`
// tests; S3 landed R3, flipped the targets and deleted the `[today]` tests.

// Cold open from content: Library → album → Enter on a track with auto Now
// Playing on, which is how a user normally arrives on Now Playing.
async function coldOpenNowPlaying(page: Page) {
  await H.bootMock(page, { autoNp: true });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 300);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
  await H.settle(page, 400);
}

// Arrive by the top nav with a paused track, focus still on the nav.
async function navToNowPlaying(page: Page) {
  await H.bootMock(page);
  await H.startTrack(page, 5, { paused: true });
  await H.navTo(page, 'nowplaying');
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 4, true));
  await H.settle(page, 200);
}

test('R3 cold open lands on Play', async ({ page }) => {
  await coldOpenNowPlaying(page);
  const f = await H.focus(page);
  expect(f.zone).toBe('np-controls');
  expect(f.id).toBe('np-play');
});

test('R3 Up then Down from Play lands on Play', async ({ page }) => {
  await coldOpenNowPlaying(page);
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect((await H.focus(page)).zone).toBe('np-progress');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

test('R3 Down from the progress bar lands on Play', async ({ page }) => {
  await coldOpenNowPlaying(page);
  await page.evaluate(() => FocusManager.setActiveZone('np-progress', 0, true));
  await H.settle(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

test('R3 Down from the top nav on Now Playing lands on Play', async ({ page }) => {
  await navToNowPlaying(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

test('R3 Right x3, Up, Down lands on Play', async ({ page }) => {
  await coldOpenNowPlaying(page);
  await H.press(page, 'ArrowRight', 3);
  await H.settle(page);
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

// The sweep runs from Play to both ends of the row and back, with no lyrics
// (the dimmed button) and with lyrics (`mockLyrics=1`), and records every
// element it passes.
for (const lyrics of [false, true]) {
  test(`R3 a full Left/Right sweep ${lyrics ? 'with' : 'without'} lyrics never focuses an invisible element`, async ({ page }) => {
    await H.bootMock(page, lyrics ? { extra: 'mockLyrics=1' } : {});
    await H.startTrack(page, 5, { paused: true });
    await H.navTo(page, 'nowplaying');
    await page.evaluate(() => FocusManager.setActiveZone('topnav', 4, true));
    await H.settle(page, 200);
    await H.press(page, 'ArrowDown');
    await H.settle(page);
    // The lyrics fetch is async: wait until the button reflects it.
    await page.waitForFunction((want) => {
      const b = document.getElementById('np-lyrics');
      return !!b && b.classList.contains('is-unavailable') === !want;
    }, lyrics);
    const seen: string[] = [];
    const invisible: string[] = [];
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight',
      'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) {
      await H.press(page, key);
      await H.settle(page, 20);
      const f = await H.focus(page);
      seen.push(f.id || '?');
      if (!f.visible) invisible.push(f.id || f.cls || '?');
    }
    test.info().annotations.push({ type: 'sweep', description: seen.join(' ') });
    expect(seen).toContain('np-lyrics');
    expect(seen).toContain('np-shuffle');
    expect(invisible).toEqual([]);
  });
}

test('D55 the unavailable lyrics button is dimmed, focusable, and Enter does nothing', async ({ page }) => {
  await navToNowPlaying(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  await H.press(page, 'ArrowRight', 4);
  await H.settle(page, 200);
  const f = await H.focus(page);
  expect(f.id).toBe('np-lyrics');
  const style = await page.evaluate(() => {
    const b = document.getElementById('np-lyrics')!;
    const cs = getComputedStyle(b);
    return { unavailable: b.classList.contains('is-unavailable'), display: cs.display, opacity: parseFloat(cs.opacity) };
  });
  expect(style.unavailable).toBe(true);
  expect(style.display).not.toBe('none');
  expect(style.opacity).toBeGreaterThan(0);
  // Unfocused it is <= 0.4 (ticket R3); focused it is brighter so the
  // platter is seen. Check the resting value by moving off it.
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 50);
  const rest = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('np-lyrics')!).opacity));
  expect(rest).toBeLessThanOrEqual(0.4);
  await H.press(page, 'ArrowRight');
  await H.press(page, 'Enter');
  await H.settle(page, 300);
  expect(await page.evaluate(() => !!document.querySelector('.np-layout.lyrics-active'))).toBe(false);
  expect((await H.focus(page)).id).toBe('np-lyrics');
});

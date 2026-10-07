import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R1.8 (S5, D58): Settings -> Advanced -> "Smooth scrolling (experimental)",
// stored in sonance-exp-smooth-scroll, default Off. On, the focus-follow
// scroll animates. Whether that is good on the TV is item 14 of the TV
// checklist; the focus-integrity specs are also run with it on
// (SONANCE_SMOOTH=1, see PROGRESS.md v3.10 S5).

// Distinct #library-content scrollTop values seen frame by frame for 600 ms
// after one Down press that scrolls the Albums grid.
async function scrollTrace(page: Page) {
  await page.evaluate(() => {
    (window as any).__trace = [];
    const sc = document.getElementById('library-content')!;
    const t0 = performance.now();
    const tick = () => {
      (window as any).__trace.push(sc.scrollTop);
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(700);
  const trace: number[] = await page.evaluate(() => (window as any).__trace);
  return Array.from(new Set(trace));
}

async function intoAlbums(page: Page, storage?: Record<string, string>) {
  await H.bootMock(page, { albums: 300, storage });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid');
  await H.settle(page, 300);
  // Two rows down, so the next Down has to scroll.
  await H.press(page, 'ArrowDown', 2, 300);
  await H.scrollIdle(page);
}

test('R1.8 off by default: no class, scroll-behavior auto, the scroll jumps', async ({ page }) => {
  test.skip(!!process.env.SONANCE_SMOOTH, 'checks the default; this run seeds the flag on');
  await intoAlbums(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('smooth-scroll'))).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('library-content')!).scrollBehavior)).toBe('auto');
  const values = await scrollTrace(page);
  test.info().annotations.push({ type: 'trace', description: JSON.stringify(values) });
  expect(values.length).toBe(2);     // before and after, nothing between
});

test('R1.8 on: the focus-follow scroll animates through intermediate positions', async ({ page }) => {
  await intoAlbums(page, { 'sonance-exp-smooth-scroll': 'on' });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('library-content')!).scrollBehavior)).toBe('smooth');
  const values = await scrollTrace(page);
  test.info().annotations.push({ type: 'trace', description: JSON.stringify(values) });
  expect(values.length).toBeGreaterThan(3);
  // And focus is intact once it settles.
  const f = await H.focus(page);
  expect(f.zone).toBe('library-grid');
  expect(f.visible).toBe(true);
});

test('R1.8 the Settings row toggles it live (Enter, Left/Right) and it persists', async ({ page }) => {
  test.skip(!!process.env.SONANCE_SMOOTH, 'starts from the default');
  await H.bootMock(page);
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  let found = false;
  for (let i = 0; i < 20; i++) {
    const f = await H.focus(page);
    if (f.id === 'settings-smooth-scroll-row') { found = true; break; }
    await H.press(page, 'ArrowDown');
    await H.settle(page, 60);
  }
  expect(found).toBe(true);
  const state = () => page.evaluate(() => ({
    cls: document.documentElement.classList.contains('smooth-scroll'),
    value: document.getElementById('settings-smooth-scroll-value')!.textContent,
    stored: localStorage.getItem('sonance-exp-smooth-scroll'),
  }));
  expect(await state()).toEqual({ cls: false, value: 'Off', stored: null });
  await H.press(page, 'Enter');
  expect(await state()).toEqual({ cls: true, value: 'On', stored: 'on' });
  await H.press(page, 'ArrowRight');
  expect(await state()).toEqual({ cls: false, value: 'Off', stored: 'off' });
  await H.press(page, 'ArrowLeft');
  expect(await state()).toEqual({ cls: true, value: 'On', stored: 'on' });
  // A fresh page reads the stored value (bootMock's seed leaves this key alone).
  await page.reload();
  await H.waitForScreen(page, 'home');
  expect(await page.evaluate(() => document.documentElement.classList.contains('smooth-scroll'))).toBe(true);
});

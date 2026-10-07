import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10-fix2 F3 (D154, D155): both credits views (Now Playing's ⓘ panel and
// the options sheet's "Show credits") scroll with Up/Down and highlight no
// row. TV report, 2026-10-05: "don't highlight each row, it makes the user
// think they are menu options. Just have Up/Down to scroll." The view's zone
// has one element, the scroller; Up/Down move it by a third of its visible
// height (D154); a slim indicator on its right edge shows the position while
// the view is active (D155, docs/UI-MOCKUP-REFERENCE.md "Scroll indicator").

async function scrollState(page: Page, sel: string) {
  return page.evaluate((s) => {
    const sc = document.querySelector(s) as HTMLElement;
    const rows = Array.prototype.slice.call(sc.querySelectorAll('.credit-row')) as HTMLElement[];
    const ind = sc.parentNode!.querySelector('.scroll-indicator') as HTMLElement | null;
    return {
      top: sc.scrollTop,
      max: sc.scrollHeight - sc.clientHeight,
      client: sc.clientHeight,
      focusedIsScroller: FocusManager.getCurrentFocused() === sc,
      focusedRows: sc.querySelectorAll('.credit-row.focused').length,
      rowBgs: Array.from(new Set(rows.map((r) => getComputedStyle(r).backgroundColor))),
      indicator: ind ? parseFloat(getComputedStyle(ind).opacity) : null,
    };
  }, sel);
}

// Down until scrollTop stops changing, then Up until it is 0, recording
// scrollTop after each press. Every press but the last of each run moves
// by the step.
async function walkScroll(page: Page, sel: string) {
  const downs: number[] = [], ups: number[] = [];
  const first = await scrollState(page, sel);
  const step = Math.round(first.client / 3);
  let prev = first.top;
  for (let i = 0; i < 40; i++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
    await H.scrollIdle(page);
    const s = await scrollState(page, sel);
    expect(s.focusedIsScroller).toBe(true);
    expect(s.focusedRows).toBe(0);
    if (s.top === prev) break;
    downs.push(s.top - prev);
    prev = s.top;
  }
  const atEnd = await scrollState(page, sel);
  for (let i = 0; i < 40 && prev > 0; i++) {
    await H.press(page, 'ArrowUp');
    await H.settle(page, 30);
    await H.scrollIdle(page);
    const s = await scrollState(page, sel);
    ups.push(prev - s.top);
    prev = s.top;
  }
  return { step, downs, ups, atEnd, first };
}

// Size-independent: ceil(max / step) presses reach the end, each a full
// step but the last, which takes what is left (at 100 % the mock's credits
// overflow by less than one step; at 150 % by several).
function expectSteps(deltas: number[], step: number, max: number) {
  const n = Math.ceil(max / step);
  const info = JSON.stringify({ deltas, step, max });
  expect(deltas.length, info).toBe(n);
  for (let i = 0; i < n - 1; i++) expect(Math.abs(deltas[i] - step), info).toBeLessThanOrEqual(1);
  expect(Math.abs(deltas[n - 1] - (max - step * (n - 1))), info).toBeLessThanOrEqual(1);
}

async function openNowPlayingCredits(page: Page, opts: Record<string, unknown> = {}) {
  await H.bootMock(page, opts);
  await H.startTrack(page, 6, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
  await H.press(page, 'ArrowRight', 5, 40);
  await H.settle(page, 100);
  expect((await H.focus(page)).id).toBe('np-credits');
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('.np-layout.credits-active .credit-row'));
  await H.settle(page, 350);
}

test('F3 Now Playing credits: Down from ⓘ enters the scroller, no row is highlighted, Up/Down scroll by a third', async ({ page }) => {
  await openNowPlayingCredits(page);
  const before = await scrollState(page, '.np-credits-scroll');
  expect(before.max).toBeGreaterThan(0);                 // song-0 overflows at 150 %
  expect(before.indicator).toBe(0);                      // not active yet: hidden
  await H.press(page, 'ArrowDown');
  await H.settle(page, 250);
  const entered = await scrollState(page, '.np-credits-scroll');
  expect((await H.focus(page)).zone).toBe('np-credits');
  expect(entered.focusedIsScroller).toBe(true);
  expect(entered.focusedRows).toBe(0);
  expect(entered.top).toBe(0);                           // entering does not scroll
  expect(entered.rowBgs).toEqual(['rgba(0, 0, 0, 0)']);
  // The indicator fades over 0.15 s; read at the very end of that fade, its
  // opacity can be a float hair off 0 or 1 (2.1e-10 on a CI runner, run
  // 37633446833), so shown is > 0.99 and hidden is < 0.01.
  expect(entered.indicator).toBeGreaterThan(0.99);
  const w = await walkScroll(page, '.np-credits-scroll');
  test.info().annotations.push({ type: 'steps', description: JSON.stringify(w) });
  expectSteps(w.downs, w.step, w.first.max);
  expect(w.atEnd.top).toBe(w.atEnd.max);
  expectSteps(w.ups, w.step, w.first.max);
  // Down at the bottom does nothing; Up at the top returns to ⓘ.
  expect(await scrollState(page, '.np-credits-scroll')).toMatchObject({ top: 0, rowBgs: ['rgba(0, 0, 0, 0)'] });
  await H.press(page, 'ArrowUp');
  await H.settle(page, 250);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', index: 7, id: 'np-credits' });
  expect((await scrollState(page, '.np-credits-scroll')).indicator).toBeLessThan(0.01);
});

test('F3 Now Playing credits: Down at the bottom does nothing and keeps the focus in the panel', async ({ page }) => {
  await openNowPlayingCredits(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  for (let i = 0; i < 30; i++) await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  const end = await scrollState(page, '.np-credits-scroll');
  expect(end.top).toBe(end.max);
  expect((await H.focus(page)).zone).toBe('np-credits');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect((await scrollState(page, '.np-credits-scroll')).top).toBe(end.max);
  expect((await H.focus(page)).zone).toBe('np-credits');
});

test('F3 Now Playing credits that fit: Down from ⓘ does nothing (100 %)', async ({ page }) => {
  await H.bootMock(page, { scale: 1 });
  await H.startTrack(page, 6, { paused: true });
  await page.evaluate(() => { Player.next(); Player.pause(); });   // song-1: the short credits
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowRight', 5, 40);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('.np-layout.credits-active .credit-row'));
  await H.settle(page, 350);
  expect((await scrollState(page, '.np-credits-scroll')).max).toBeLessThanOrEqual(1);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', id: 'np-credits' });
});

async function openSheetCredits(page: Page, opts: Record<string, unknown> = {}) {
  await H.bootMock(page, opts);
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#playlist-songs .song-row.focused'));
  await H.settle(page, 300);
  // Hold OK on song-0 (full credits on the mock) through CDP: keydown, two
  // auto-repeats, keyup (the A5 hold).
  const cdp = await page.context().newCDPSession(page);
  const key = (type: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat
  } as any);
  await key('keyDown');
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(40); await key('keyDown', true); }
  await key('keyUp');
  await page.waitForFunction(() => !!document.querySelector('#options-sheet [data-action="credits"]'));
  await H.settle(page, 250);
  const items: string[] = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('#options-sheet .options-sheet-item'), (e: Element) => e.getAttribute('data-action')));
  const target = items.indexOf('credits');
  const cur = await page.evaluate(() => (FocusManager.snapshot() || { index: 0 }).index);
  await H.press(page, 'ArrowDown', target - cur, 40);
  await H.settle(page, 100);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-action'))).toBe('credits');
  await H.press(page, 'Enter');
  await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#options-sheet .credits-section'),
    (e: HTMLElement) => e.textContent === 'Writing & production'));
  await H.settle(page, 250);
}

test('F3 options sheet credits: the body is the stop, no row is highlighted, Up/Down scroll; Back to "Show credits", then the row', async ({ page }) => {
  await openSheetCredits(page);
  const s0 = await scrollState(page, '#options-sheet .options-sheet-body');
  expect(await page.evaluate(() => FocusManager.getActiveZone())).toBe('options-sheet');
  expect(s0.focusedIsScroller).toBe(true);
  expect(s0.focusedRows).toBe(0);
  expect(s0.rowBgs).toEqual(['rgba(0, 0, 0, 0)']);
  expect(s0.top).toBe(0);
  expect(s0.max).toBeGreaterThan(0);                     // the full credits overflow the panel at 150 %
  expect(s0.indicator).toBeGreaterThan(0.99);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-sheet-credits-top-150.png' });
  const w = await walkScroll(page, '#options-sheet .options-sheet-body');
  test.info().annotations.push({ type: 'steps', description: JSON.stringify(w) });
  expectSteps(w.downs, w.step, w.first.max);
  expectSteps(w.ups, w.step, w.first.max);
  // Up at the top stays in the sheet (it is isolated).
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect(await page.evaluate(() => FocusManager.getActiveZone())).toBe('options-sheet');
  await H.press(page, 'Escape');
  await H.settle(page, 250);           // past the indicator's 0.15 s fade-out
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-action'))).toBe('credits');
  expect(await page.evaluate(() => document.querySelector('#options-sheet .scroll-indicator') ?
    parseFloat(getComputedStyle(document.querySelector('#options-sheet .scroll-indicator')!).opacity) : 0)).toBeLessThan(0.01);
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await page.evaluate(() => ({ open: OptionsSheet.isOpen(), zone: FocusManager.getActiveZone(),
    index: (FocusManager.snapshot() || {}).index }))).toMatchObject({ open: false, zone: 'content', index: 0 });
});

test('F3 screenshots: both credits views mid-scroll at 150 %', async ({ page }) => {
  await openNowPlayingCredits(page, { scale: 1.5 });
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowDown', 2, 60);
  await H.settle(page, 300);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-np-credits-mid-150.png' });
  await openSheetCredits(page, { scale: 1.5 });
  await H.press(page, 'ArrowDown', 2, 60);
  await H.settle(page, 300);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-sheet-credits-mid-150.png' });
});

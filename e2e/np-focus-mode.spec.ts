import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10-fix2 F7 (D158, D159): Focus mode, a 9th Now Playing control that
// dims the screen by 50 % "so the user can focus on the music" (user
// request, 2026-10-05). #np-focus after ⓘ; Enter toggles .np-focus-dim, an
// overlay inside the Now Playing screen (over the backdrop, cover, text,
// controls and Up Next; the top nav is not dimmed); remembered in
// localStorage['sonance-np-focus'] (on/off, default off).

const ROW = ['np-shuffle', 'np-prev', 'np-play', 'np-next', 'np-repeat', 'np-star', 'np-lyrics', 'np-credits', 'np-focus'];

async function openNowPlaying(page: Page, opts: Record<string, unknown> = {}, track = true) {
  await H.bootMock(page, opts);
  if (track) await H.startTrack(page, 6, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
}

const dim = (page: Page) => page.evaluate(() => {
  const d = document.querySelector('.np-screen .np-focus-dim') as HTMLElement | null;
  const b = document.getElementById('np-focus');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  return {
    opacity: parseFloat(cs.opacity), bg: cs.backgroundColor, events: cs.pointerEvents, display: cs.display,
    rect: { l: r.left, t: r.top, r: r.right, b: r.bottom },
    active: !!b && b.classList.contains('is-active'),
    unavailable: !!b && b.classList.contains('is-unavailable'),
    stored: localStorage.getItem('sonance-np-focus'),
  };
});

test('F7 the controls row is 9 wide, Focus after ⓘ; Down from the progress bar and from the top nav lands on Play', async ({ page }) => {
  await openNowPlaying(page);
  expect(await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('.np-screen-controls .focusable'), (b: Element) => b.id))).toEqual(ROW);
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect((await H.focus(page)).zone).toBe('np-progress');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
  // Up from the progress bar to the top nav, then Down: Play (R3).
  await H.press(page, 'ArrowUp', 2, 60);
  await H.settle(page, 100);
  expect((await H.focus(page)).zone).toBe('topnav');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
  // Right x6 from Play: the Focus button, the row's last.
  await H.press(page, 'ArrowRight', 6, 30);
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', index: 8, id: 'np-focus', visible: true });
});

test('F7 Enter toggles the 50 % dim: it fades to 0.5 over the viewport, the button shows on, Enter again clears it (D159)', async ({ page }) => {
  await openNowPlaying(page);
  const off = await dim(page);
  // Off, the overlay is not rendered at all (D159): Now Playing as before.
  expect(off).toMatchObject({ opacity: 0, active: false, events: 'none', bg: 'rgb(0, 0, 0)', display: 'none' });
  await H.press(page, 'ArrowRight', 6, 30);
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-focus');
  await H.press(page, 'Enter');
  // Mid-fade (0.25 s, opacity only), then settled.
  await page.waitForTimeout(90);
  const mid = await dim(page);
  expect(mid!.opacity).toBeGreaterThan(0);
  expect(mid!.opacity).toBeLessThan(0.5);
  await page.waitForTimeout(300);
  const on = await dim(page);
  expect(on).toMatchObject({ opacity: 0.5, active: true, stored: 'on', display: 'block' });
  expect(on!.rect).toEqual({ l: 0, t: 0, r: 1920, b: 1080 });
  // The button's on state follows the open-panel pattern: ink while focused.
  const ink = await page.evaluate(() => {
    const b = document.getElementById('np-focus')!;
    return { color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
  });
  expect(ink.color).not.toBe(ink.bg);
  await H.press(page, 'Enter');
  // Mid-fade out it is still drawn; once faded it is gone again.
  await page.waitForTimeout(90);
  const out = await dim(page);
  expect(out!.display).toBe('block');
  expect(out!.opacity).toBeGreaterThan(0);
  expect(out!.opacity).toBeLessThan(0.5);
  await page.waitForTimeout(350);
  expect(await dim(page)).toMatchObject({ opacity: 0, active: false, stored: 'off', display: 'none' });
});

test('F7 the dim is remembered across a fresh page, and the button works with no track (not D55-dimmed)', async ({ page }) => {
  await openNowPlaying(page, {}, false);
  await H.press(page, 'ArrowRight', 6, 30);
  await H.settle(page);
  const f = await H.focus(page);
  expect(f).toMatchObject({ id: 'np-focus', visible: true });
  expect((await dim(page))!.unavailable).toBe(false);
  await H.press(page, 'Enter');
  await page.waitForTimeout(350);
  expect(await dim(page)).toMatchObject({ opacity: 0.5, active: true, stored: 'on' });
  // A fresh page (no seed for the key): Now Playing renders dimmed, at once.
  await page.goto('about:blank');
  await openNowPlaying(page);
  expect(await dim(page)).toMatchObject({ opacity: 0.5, active: true, stored: 'on' });
});

test('F7 the dim covers Now Playing but not the top nav; keys still work through it', async ({ page }) => {
  await openNowPlaying(page, { storage: { 'sonance-np-focus': 'on' } });
  await page.waitForTimeout(300);
  // Stacking: the overlay is the last layer of the Now Playing screen, over
  // the layout and Up Next; the top nav is outside the page, above it.
  const order = await page.evaluate(() => {
    const d = document.querySelector('.np-screen .np-focus-dim') as HTMLElement;
    const z = (sel: string) => getComputedStyle(document.querySelector(sel)!).zIndex;
    return {
      last: d.parentNode!.lastElementChild === d,
      dimZ: getComputedStyle(d).zIndex, layoutZ: z('.np-layout'), upnextZ: z('.np-upnext'), navZ: z('#top-nav'),
      bgImageTransform: getComputedStyle(document.querySelector('.np-bg-image')!).transform,
      bgImageTransition: getComputedStyle(document.querySelector('.np-bg-image')!).transitionProperty,
    };
  });
  expect(order.last).toBe(true);
  expect(Number(order.dimZ)).toBeGreaterThan(Number(order.layoutZ));
  expect(Number(order.dimZ)).toBeGreaterThan(Number(order.upnextZ));
  expect(Number(order.navZ)).toBeGreaterThan(Number(order.dimZ));
  expect(order.bgImageTransform).toBe('none');              // D47 untouched
  // The nav, shown: the focused pill's solid fill is the same colour dimmed or not.
  await H.press(page, 'ArrowUp', 2, 80);
  await H.settle(page, 400);
  expect((await H.focus(page)).zone).toBe('topnav');
  const pillPt = await page.evaluate(() => {
    const r = document.getElementById('top-nav-pill')!.getBoundingClientRect();
    return [Math.round(r.left + 6), Math.round(r.top + r.height / 2)];
  });
  const onShot = await page.screenshot();
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  // Keys work through the dim: Right x6 to Focus, Enter turns it off.
  await H.press(page, 'ArrowRight', 6, 30);
  await H.press(page, 'Enter');
  await page.waitForTimeout(350);
  expect((await dim(page))!.opacity).toBe(0);
  await H.press(page, 'ArrowUp', 2, 80);
  await H.settle(page, 400);
  const offShot = await page.screenshot();
  const [a] = await H.pngPixels(page, onShot, [pillPt]);
  const [b] = await H.pngPixels(page, offShot, [pillPt]);
  expect(a, JSON.stringify({ a, b, pillPt })).toEqual(b);
});

for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`F7 the 9-button row fits the column at ${scale * 100} % (D158)`, async ({ page }) => {
    await openNowPlaying(page, { scale });
    const g = await page.evaluate(() => {
      const row = document.querySelector('.np-screen-controls') as HTMLElement;
      const btns = row.querySelectorAll('.focusable');
      const first = btns[0].getBoundingClientRect(), last = btns[btns.length - 1].getBoundingClientRect();
      const col = document.querySelector('.np-left')!.getBoundingClientRect();
      return { rowW: last.right - first.left, colW: col.width, colL: col.left, colR: col.right, l: first.left, r: last.right };
    });
    test.info().annotations.push({ type: 'row', description: JSON.stringify(g) });
    expect(g.rowW).toBeLessThanOrEqual(g.colW);
    expect(g.l).toBeGreaterThanOrEqual(g.colL - 0.5);
    expect(g.r).toBeLessThanOrEqual(g.colR + 0.5);
  });
}

test('F7 screenshots at 150 %: Focus off and on', async ({ page }) => {
  await openNowPlaying(page, { scale: 1.5 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-np-focus-off-150.png' });
  await H.press(page, 'ArrowRight', 6, 30);
  await H.press(page, 'Enter');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-np-focus-on-150.png' });
});

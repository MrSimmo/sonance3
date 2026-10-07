import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10-fix2 F2 (D156, D157): Settings -> Appearance -> "Up next on Now
// Playing ◄ Show / Hide ►", stored in localStorage['sonance-np-upnext']
// (show/hide, default Show). Hidden: no Up Next tiles or label and no strip
// build; the column is centred with the pre-S6 cover (no .upnext-on /
// .upnext-tight); the sleep-timer chip (A7) stays reachable, alone and
// centred under the controls, as the np-upnext zone's only element.

const HIDE = { 'sonance-np-upnext': 'hide' };

async function toUpNextRow(page: Page) {
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  for (let i = 0; i < 20; i++) {
    const f = await H.focus(page);
    if (f.id === 'settings-np-upnext-row') return;
    await H.press(page, 'ArrowDown');
    await H.settle(page, 60);
  }
  throw new Error('no settings-np-upnext-row on the Down walk');
}

const rowValue = (page: Page) => page.evaluate(() => ({
  text: document.getElementById('settings-np-upnext-value')!.textContent,
  stored: localStorage.getItem('sonance-np-upnext'),
}));

async function openNowPlaying(page: Page, opts: Record<string, unknown> = {}) {
  await H.bootMock(page, opts);
  await H.startTrack(page, 6, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
}

const layout = (page: Page) => page.evaluate(() => {
  const l = document.querySelector('.np-layout')!;
  const r = (sel: string) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
  };
  const chip = document.getElementById('np-sleep-chip');
  return {
    on: l.classList.contains('upnext-on'),
    tight: l.classList.contains('upnext-tight'),
    tiles: document.querySelectorAll('.np-upnext-item').length,
    labels: document.querySelectorAll('.np-upnext-label').length,
    strip: document.querySelectorAll('.np-upnext').length,
    art: r('.np-screen-art-inner'),
    controls: r('.np-screen-controls'),
    chip: r('#np-sleep-chip'),
    chipOpacity: chip ? parseFloat(getComputedStyle(chip.parentNode as Element).opacity) : null,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    vh: window.innerHeight,
  };
});

test('F2 the Settings row: default Show, Left/Right/Enter switch it, it persists across a fresh page', async ({ page }) => {
  await H.bootMock(page);
  await toUpNextRow(page);
  expect(await rowValue(page)).toEqual({ text: 'Show', stored: null });
  await H.press(page, 'ArrowRight');
  await H.settle(page, 60);
  expect(await rowValue(page)).toEqual({ text: 'Hide', stored: 'hide' });
  expect((await H.focus(page)).id).toBe('settings-np-upnext-row');
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 60);
  expect(await rowValue(page)).toEqual({ text: 'Show', stored: 'show' });
  await H.press(page, 'Enter');
  await H.settle(page, 60);
  expect(await rowValue(page)).toEqual({ text: 'Hide', stored: 'hide' });
  await page.goto('about:blank');
  await H.bootMock(page);
  await toUpNextRow(page);
  expect(await rowValue(page)).toEqual({ text: 'Hide', stored: 'hide' });
});

test('F2 hidden: no tiles, no label, no strip; the chip alone is np-upnext: Down -> chip, Enter cycles, Up -> Play', async ({ page }) => {
  await openNowPlaying(page, { storage: HIDE });
  await H.settle(page, 200);           // past the strip's two-rAF build, had it run
  const l = await layout(page);
  expect(l).toMatchObject({ on: false, tight: false, tiles: 0, labels: 0, strip: 0, chipOpacity: 1 });
  expect(await page.evaluate(() => {
    const c = document.getElementById('np-sleep-chip');
    return !!c && c.classList.contains('focusable');
  })).toBe(true);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 150);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-upnext', index: 0, id: 'np-sleep-chip', visible: true });
  // The zone holds only the chip: Left/Right stay on it.
  await H.press(page, 'ArrowRight');
  await H.press(page, 'ArrowLeft');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-upnext', index: 0, id: 'np-sleep-chip' });
  const label = () => page.evaluate(() => document.querySelector('#np-sleep-chip .np-sleep-chip-label')!.textContent);
  expect(await label()).toBe('Sleep timer');
  await H.press(page, 'Enter');
  await H.settle(page);
  expect(await label()).toBe('Sleep in 15 min');
  // Back to Off (the timer is module-level; leave it as found).
  for (let i = 0; i < 5; i++) await H.press(page, 'Enter');
  await H.settle(page);
  expect(await label()).toBe('Sleep timer');
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`F2 hidden layout at ${scale * 100} %: no Up Next classes, the uncapped cover, the chip on screen under the controls`, async ({ page }) => {
    await openNowPlaying(page, { storage: HIDE, scale });
    await H.settle(page, 300);
    const l = await layout(page);
    test.info().annotations.push({ type: 'layout', description: JSON.stringify(l) });
    expect(l.on).toBe(false);
    expect(l.tight).toBe(false);
    // The pre-S6 cover: 28rem square, no D122 cap.
    expect(Math.abs(l.art!.w - 28 * l.rem)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(l.art!.h - 28 * l.rem)).toBeLessThanOrEqual(0.5);
    // The chip: below the controls (no overlap), centred under them, on screen.
    expect(l.chip!.t).toBeGreaterThanOrEqual(l.controls!.b);
    expect(Math.abs((l.chip!.l + l.chip!.r) / 2 - (l.controls!.l + l.controls!.r) / 2)).toBeLessThanOrEqual(1);
    expect(l.chip!.b).toBeLessThanOrEqual(l.vh);
    expect(l.chip!.t).toBeGreaterThanOrEqual(0);
  });
}

test('F2 hidden: with lyrics or credits open the chip is not a focus stop', async ({ page }) => {
  await openNowPlaying(page, { storage: HIDE, extra: 'mockLyrics=1', scale: 1 });
  await page.waitForFunction(() => !document.getElementById('np-lyrics')!.classList.contains('is-unavailable'));
  await H.press(page, 'ArrowRight', 4, 40);
  await H.press(page, 'Enter');
  await H.settle(page, 350);
  expect(await page.evaluate(() => document.querySelector('.np-layout')!.classList.contains('lyrics-active'))).toBe(true);
  expect((await layout(page)).chipOpacity).toBe(0);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', id: 'np-lyrics' });
  // Credits (song-0's overflow at 100 %? whichever: Down never reaches the chip).
  await H.press(page, 'ArrowRight');
  await H.press(page, 'Enter');
  await H.settle(page, 350);
  expect(await page.evaluate(() => document.querySelector('.np-layout')!.classList.contains('credits-active'))).toBe(true);
  expect((await layout(page)).chipOpacity).toBe(0);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).not.toBe('np-sleep-chip');
  expect((await H.focus(page)).zone).not.toBe('np-upnext');
  // Closed again: Down reaches the chip.
  await H.press(page, 'Escape');
  await H.settle(page, 350);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', id: 'np-credits' });
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-sleep-chip');
});

test('F2 screenshots at 150 %: Up Next hidden and shown', async ({ page }) => {
  await openNowPlaying(page, { storage: HIDE, scale: 1.5 });
  await H.press(page, 'ArrowDown');
  await H.settle(page, 400);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-np-upnext-hidden-150.png' });
  await page.goto('about:blank');
  // The first boot's init script (Hide) runs on every navigation of this
  // page, so the second one seeds Show after it.
  await openNowPlaying(page, { scale: 1.5, storage: { 'sonance-np-upnext': 'show' } });
  expect(await page.evaluate(() => document.querySelectorAll('.np-upnext-item').length)).toBeGreaterThan(0);
  await H.settle(page, 400);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-np-upnext-shown-150.png' });
});

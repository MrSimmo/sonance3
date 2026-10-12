import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// 3.14 H4 (ticket-3.14 §6 H4, §7.1 H4): the Performance overlay also lists
// the last 12 key events, newest last (down/up, keyCode, key, the repeat flag,
// ms since the previous event from event.timeStamp), from capture-phase
// listeners, so a photo of the TV shows what a remote sends while OK is held
// (§8 Q1). Off, the overlay attaches nothing (v3.10 R1.1).

const SHOT = path.resolve(__dirname, '..', 'screenshots', 'v3-14', 'perf-hud-keys.png');
const LINE = /^(down|up) {2}(\d+) {2}(\S+)( {2}rep)? {2}(\+(\d+) ms|-)$/;

// Every addEventListener call made from js/perf-hud.js, before any app script
// runs (the unbundled mock rig keeps per-file script URLs).
async function listenerProbe(page: Page) {
  await page.addInitScript(() => {
    const seen: any[] = [];
    (window as any).__hudListeners = seen;
    const fromHud = () => /perf-hud\.js/.test(new Error().stack || '');
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(this: EventTarget, type: string, fn: any, opts: any) {
      if (fromHud()) {
        seen.push({ type, capture: opts === true || !!(opts && opts.capture), on: this === document ? 'document' : String(this) });
      }
      return (add as any).apply(this, arguments as any);
    };
  });
}

async function cdpKeys(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const KEYS: Record<string, [string, number]> = { Enter: ['Enter', 13], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38] };
  return (type: 'keyDown' | 'keyUp', name: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: KEYS[name][0], code: KEYS[name][0], windowsVirtualKeyCode: KEYS[name][1], nativeVirtualKeyCode: KEYS[name][1], autoRepeat
  } as any);
}

// The trace's event lines (after its heading), as refreshed at 2 Hz.
async function traceLines(page: Page) {
  await page.waitForTimeout(700);
  const text = await page.locator('#perf-hud-keys').textContent({ timeout: 2000 });
  return (text || '').split('\n').slice(1);
}

test('H4 off: the overlay adds no listener at all, keydown and keyup included, and no trace panel', async ({ page }) => {
  await listenerProbe(page);
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.press(page, 'Enter');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__hudListeners)).toEqual([]);
  expect(await page.locator('#perf-hud-keys').count()).toBe(0);
});

test('H4 on: one keydown and one keyup listener, capture phase, on the document; Off removes the panel', async ({ page }) => {
  await listenerProbe(page);
  await H.bootMock(page, { storage: { 'sonance-perf-hud': 'true' } });
  expect(await page.evaluate(() => (window as any).__hudListeners)).toEqual([
    { type: 'keydown', capture: true, on: 'document' },
    { type: 'keyup', capture: true, on: 'document' }
  ]);
  expect(await page.locator('#perf-hud-keys').count()).toBe(1);
  await page.evaluate(() => PerfHud.disable());
  expect(await page.locator('#perf-hud-keys').count()).toBe(0);
  expect(await page.locator('#perf-hud').count()).toBe(0);
});

test('H4 the trace shows a scripted sequence in order, with keyCode, key, repeat flag and gaps; 12 lines, newest last', async ({ page }) => {
  await H.bootMock(page, { storage: { 'sonance-perf-hud': 'true' } });
  await H.navTo(page, 'settings');                         // Enter / Down here only move focus or toggle
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  const send = await cdpKeys(page);
  // OK held with one flagged repeat, released, then Down.
  const script: [number, 'keyDown' | 'keyUp', string, boolean][] = [
    [0, 'keyDown', 'ArrowUp', false], [80, 'keyUp', 'ArrowUp', false],
    [400, 'keyDown', 'Enter', false], [500, 'keyDown', 'Enter', true], [600, 'keyUp', 'Enter', false],
    [750, 'keyDown', 'ArrowDown', false], [800, 'keyUp', 'ArrowDown', false]
  ];
  const t0 = Date.now();
  for (const [at, type, name, rep] of script) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await send(type, name, rep);
  }
  const lines = await traceLines(page);
  test.info().annotations.push({ type: 'trace', description: lines.join(' | ') });
  expect(lines.length).toBeLessThanOrEqual(12);
  const last = lines.slice(-7).map((l) => {
    const m = LINE.exec(l);
    expect(m, 'line format: ' + l).not.toBe(null);
    return { dir: m![1], code: +m![2], key: m![3], rep: !!m![4], gap: m![6] === undefined ? null : +m![6] };
  });
  expect(last.map((e) => [e.dir, e.code, e.key, e.rep])).toEqual([
    ['down', 38, 'ArrowUp', false], ['up', 38, 'ArrowUp', false],
    ['down', 13, 'Enter', false], ['down', 13, 'Enter', true], ['up', 13, 'Enter', false],
    ['down', 40, 'ArrowDown', false], ['up', 40, 'ArrowDown', false]
  ]);
  // Gaps from event.timeStamp: the script's spacing, give or take the CDP hop.
  const want = [null, 80, 320, 100, 100, 150, 50];
  last.forEach((e, i) => {
    if (want[i] === null) return;
    expect(e.gap, 'gap before event ' + i).not.toBe(null);
    expect(Math.abs(e.gap! - want[i]!), 'gap before event ' + i + ': ' + e.gap).toBeLessThanOrEqual(45);
  });
  await page.screenshot({ path: SHOT });

  // Fifteen more events: still 12 lines, the newest last.
  for (let i = 0; i < 7; i++) { await send('keyDown', 'ArrowUp'); await send('keyUp', 'ArrowUp'); }
  await send('keyDown', 'ArrowDown');
  const after = await traceLines(page);
  expect(after.length).toBe(12);
  expect(LINE.exec(after[11])!.slice(1, 4)).toEqual(['down', '40', 'ArrowDown']);
});

for (const scale of [1, 2]) {
  test(`H4 at ${scale * 100}%: the trace is on screen below the readout, in its type, and survives navigation`, async ({ page }) => {
    await H.bootMock(page, { scale, storage: { 'sonance-perf-hud': 'true' } });
    for (const screen of ['library', 'nowplaying', 'settings']) {
      await H.navTo(page, screen);
      await page.waitForTimeout(300);
    }
    await H.press(page, 'ArrowDown', 6, 40);                // fill the trace
    const lines = await traceLines(page);
    expect(lines.length).toBe(12);
    lines.forEach((l) => expect(l).toMatch(LINE));
    const g = await page.evaluate(() => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const hud = document.getElementById('perf-hud')!.getBoundingClientRect();
      const el = document.getElementById('perf-hud-keys')!;
      const k = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        rem, hudBottom: hud.bottom, top: k.top, bottom: k.bottom, right: k.right, left: k.left,
        font: parseFloat(cs.fontSize), position: cs.position, pe: cs.pointerEvents, inApp: !!el.closest('#app'),
        count: document.querySelectorAll('#perf-hud-keys').length
      };
    });
    expect(g).toMatchObject({ position: 'fixed', pe: 'none', inApp: false, count: 1 });
    expect(g.font).toBeCloseTo(1.4 * g.rem, 1);
    expect(g.top).toBeGreaterThan(g.hudBottom);           // below the readout, not over it
    expect(g.left).toBeCloseTo(0.8 * g.rem, 0);
    expect(g.bottom).toBeLessThanOrEqual(1080);
    expect(g.right).toBeLessThanOrEqual(1920);
  });
}

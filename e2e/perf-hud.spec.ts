import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R1.1 (S1): the on-device performance overlay, Settings → Advanced.

const SHOT = 'screenshots/v3-10/s1-perf-hud.png';

// Counts, before any app script runs, the rAF calls and addEventListener
// calls made from js/perf-hud.js (by stack frame — the unbundled mock rig
// keeps per-file URLs), and every PerformanceObserver constructed by anyone.
// The app itself constructs none.
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { raf: 0, listeners: 0, observers: 0 };
    (window as any).__hudProbe = probe;
    const fromHud = () => /perf-hud\.js/.test(new Error().stack || '');
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb: FrameRequestCallback) {
      if (fromHud()) probe.raf++;
      return raf.call(window, cb);
    };
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(this: EventTarget, ...args: any[]) {
      if (fromHud()) probe.listeners++;
      return (add as any).apply(this, args);
    };
    const PO = (window as any).PerformanceObserver;
    if (PO) {
      const Wrapped = function(cb: any) { probe.observers++; return new PO(cb); } as any;
      Wrapped.supportedEntryTypes = PO.supportedEntryTypes;
      (window as any).PerformanceObserver = Wrapped;
    }
  });
}

async function exercise(page: Page) {
  // Two screens and some keys, so a listener or loop would have had its chance.
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 2, 50);
  await page.waitForTimeout(1500);
}

test('off by default', async ({ page }) => {
  await H.bootMock(page);
  expect(await page.evaluate(() => PerfHud.isEnabled())).toBe(false);
  expect(await page.locator('#perf-hud').count()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('sonance-perf-hud'))).toBeNull();
});

test('off: 0 rAF calls, 0 listeners and 0 observers from the overlay', async ({ page }) => {
  await installProbe(page);
  await H.bootMock(page);
  await exercise(page);
  const p = await page.evaluate(() => (window as any).__hudProbe);
  test.info().annotations.push({ type: 'probe(off)', description: JSON.stringify(p) });
  expect(p).toEqual({ raf: 0, listeners: 0, observers: 0 });
});

test('on (positive control): the probe does see the overlay', async ({ page }) => {
  await installProbe(page);
  await H.bootMock(page, { storage: { 'sonance-perf-hud': 'true' } });
  await exercise(page);
  const p = await page.evaluate(() => (window as any).__hudProbe);
  test.info().annotations.push({ type: 'probe(on)', description: JSON.stringify(p) });
  expect(p.raf).toBeGreaterThan(30);
  expect(p.listeners).toBe(1);
  expect(p.observers).toBe(1);
});

async function focusPerfRow(page: Page) {
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  for (let i = 0; i < 10; i++) {
    if ((await H.focus(page)).id === 'settings-perf-hud-row') return;
    await H.press(page, 'ArrowDown');
    await H.settle(page, 40);
  }
  throw new Error('Performance overlay row not reachable by Down');
}

const NUMERIC = /^FPS \d+ {2}worst \d+ ms\nkey (-|\d+ ms) {2}long (\d+|n\/a)\nels \d+ {2}[a-z]+$/;

test('d-pad toggle on Settings shows numeric fields within 1 s, Left/Right toggles it', async ({ page }) => {
  await H.bootMock(page);
  await focusPerfRow(page);
  expect(await page.locator('#settings-perf-hud-value').textContent()).toBe('Off');
  await H.press(page, 'Enter');
  const t0 = Date.now();
  await page.waitForFunction((re) => {
    const el = document.getElementById('perf-hud');
    return !!el && new RegExp(re).test(el.textContent || '');
  }, NUMERIC.source, { timeout: 1000 });
  test.info().annotations.push({ type: 'numeric after', description: (Date.now() - t0) + ' ms' });
  expect(await page.locator('#settings-perf-hud-value').textContent()).toBe('On');
  expect(await page.evaluate(() => localStorage.getItem('sonance-perf-hud'))).toBe('true');
  // Focus stays on the row; the overlay is click-through and above the app.
  expect((await H.focus(page)).id).toBe('settings-perf-hud-row');
  // v3.10 S2: the corner inset is 0.8rem, so 8px only at interface size 100%.
  const style = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('perf-hud')!);
    const inset = 0.8 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 'px';
    return { position: cs.position, pe: cs.pointerEvents, z: cs.zIndex, left: cs.left, top: cs.top, inset: inset };
  });
  expect(style).toEqual({ position: 'fixed', pe: 'none', z: '10000', left: style.inset, top: style.inset, inset: style.inset });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT });

  await H.press(page, 'ArrowRight');
  await H.settle(page);
  expect(await page.locator('#perf-hud').count()).toBe(0);
  expect(await page.locator('#settings-perf-hud-value').textContent()).toBe('Off');
  expect(await page.evaluate(() => localStorage.getItem('sonance-perf-hud'))).toBe('false');
  await H.press(page, 'ArrowLeft');
  await H.settle(page);
  expect(await page.locator('#perf-hud').count()).toBe(1);
  expect((await H.focus(page)).id).toBe('settings-perf-hud-row');
});

test('survives navigation across all 7 screens and reports each', async ({ page }) => {
  await H.bootMock(page, { storage: { 'sonance-perf-hud': 'true' } });
  for (const screen of H.NAV) {
    if (screen !== 'home') await H.navTo(page, screen);
    await page.waitForTimeout(700);
    const text = await page.locator('#perf-hud').textContent();
    expect(text).toMatch(NUMERIC);
    expect(text!.split('\n')[2].endsWith(' ' + screen)).toBe(true);
  }
  expect(await page.locator('#perf-hud').count()).toBe(1);
});

async function idleScriptMs(page: Page, hud: boolean) {
  await page.addInitScript(() => {
    (window as any).__frames = 0;
    const tick = () => { (window as any).__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await H.bootMock(page, hud ? { storage: { 'sonance-perf-hud': 'true' } } : {});
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const read = async () => {
    const m = await cdp.send('Performance.getMetrics');
    return (m.metrics.find((x: any) => x.name === 'ScriptDuration') as any).value * 1000;
  };
  const f0 = await page.evaluate(() => (window as any).__frames);
  const s0 = await read();
  await page.waitForTimeout(5000);
  const s1 = await read();
  const f1 = await page.evaluate(() => (window as any).__frames);
  return { scriptMs: s1 - s0, frames: f1 - f0 };
}

test('own scripting cost <= 0.5 ms per frame at CPU 1x (5 s idle, on vs off)', async ({ browser }) => {
  test.setTimeout(60000);
  const offCtx = await browser.newContext({ baseURL: 'http://localhost:8091', viewport: { width: 1920, height: 1080 } });
  const off = await idleScriptMs(await offCtx.newPage(), false);
  await offCtx.close();
  const onCtx = await browser.newContext({ baseURL: 'http://localhost:8091', viewport: { width: 1920, height: 1080 } });
  const on = await idleScriptMs(await onCtx.newPage(), true);
  await onCtx.close();
  const perFrame = (on.scriptMs - off.scriptMs) / on.frames;
  test.info().annotations.push({
    type: 'cost',
    description: `off ${off.scriptMs.toFixed(1)} ms / ${off.frames} frames; on ${on.scriptMs.toFixed(1)} ms / ${on.frames} frames; ` +
      `overlay ${perFrame.toFixed(4)} ms per frame`,
  });
  console.log('[perf-hud cost] ' + test.info().annotations[test.info().annotations.length - 1].description);
  expect(on.frames).toBeGreaterThan(200);
  expect(perFrame).toBeLessThanOrEqual(0.5);
});

import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.10 R11 (ticket §6.7, §7 R11): the launch splash, on the bundled build
// (/index.html, the .wgt's markup) with tests/mock-boot.js injected. Every
// test here runs the splash's real animations (`splash: 'real'`); the rest of
// the suite fast-forwards them (e2e/helpers/sonance.js _seedInit).

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-10');

// Records, from before any page script: when the first screen is in the DOM,
// when splash-in ends, when the exit class lands, when the splash is gone,
// and how many keydowns reached the document's bubble phase (where
// FocusManager listens).
async function recorder(page: Page) {
  await page.addInitScript(() => {
    const sp: any = { ready: null, inStart: null, inEnd: null, exitStart: null, gone: null, seen: false, keys: 0 };
    (window as any).__sp = sp;
    new MutationObserver(() => {
      const t = performance.now();
      const splash = document.getElementById('splash');
      if (splash) sp.seen = true;
      if (sp.ready === null && document.querySelector('#app .login-screen, #page-current > *')) sp.ready = t;
      if (sp.exitStart === null && splash && splash.className === 'splash-exit') sp.exitStart = t;
      if (sp.gone === null && sp.seen && !splash) sp.gone = t;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('animationstart', (e: any) => { if (e.animationName === 'splash-in') sp.inStart = performance.now(); }, true);
    document.addEventListener('animationend', (e: any) => { if (e.animationName === 'splash-in') sp.inEnd = performance.now(); }, true);
    document.addEventListener('keydown', () => { sp.keys++; });
  });
}

async function bootReal(page: Page, opts: any = {}) {
  await recorder(page);
  await H.bootBundled(page, Object.assign({ splash: 'real', waitFor: false, waitUntil: 'commit' }, opts));
  await page.waitForSelector('#splash', { state: 'attached' });
}

const sp = (page: Page) => page.evaluate(() => (window as any).__sp);

// cubic-bezier(x1, y1, x2, y2) at progress x (Newton on x, then y).
function bezier(x1: number, y1: number, x2: number, y2: number, x: number) {
  const f = (a: number, b: number, t: number) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  let t = x;
  for (let i = 0; i < 20; i++) {
    const d = (f(x1, x2, t + 1e-6) - f(x1, x2, t)) / 1e-6;
    if (!d) break;
    t -= (f(x1, x2, t) - x) / d;
    t = Math.max(0, Math.min(1, t));
  }
  return f(y1, y2, t);
}

test('R11 the splash is painted before the bundles run, and covers the screen', async ({ page }) => {
  const errors = H.watchErrors(page);
  // Hold both bundles back 1.5 s: whatever is on screen meanwhile is static
  // index.html alone.
  await page.route(/sonance-(core|screens)\.min\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await bootReal(page);
  await page.screenshot({ path: path.join(SHOTS, 's7-splash-first.png') });
  const first = await page.evaluate(() => ({
    app: typeof (window as any).App,
    splash: !!document.getElementById('splash'),
    top: (document.elementFromPoint(20, 20) as HTMLElement).id,
    rect: (() => { const r = document.getElementById('splash')!.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()
  }));
  expect(first).toEqual({ app: 'undefined', splash: true, top: 'splash', rect: [0, 0, 1920, 1080] });
  // After the grow, still with no app: the logo is at full size and opaque.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, 's7-splash-hold-150.png') });
  const hold = await page.evaluate(() => ({
    app: typeof (window as any).App,
    opacity: getComputedStyle(document.querySelector('.splash-logo')!).opacity,
    tile: document.querySelector('.splash-tile')!.getBoundingClientRect().width,
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    title: document.querySelector('.splash-title')!.textContent,
    text: (document.querySelector('.splash-logo')!.textContent || '').trim()
  }));
  expect(hold.app).toBe('undefined');
  expect(hold.opacity).toBe('1');
  // 26.4rem at the stored size (396 px at the 150 % default; SONANCE_SCALE
  // runs seed another).
  expect(hold.tile).toBeCloseTo(26.4 * hold.root, 0);
  expect(hold.title).toBe('Sonance');
  // The wordmark alone: no "BY SIMMO" line under it (2026-10-09, D182).
  expect(hold.text).toBe('Sonance');
  await H.waitForScreen(page, 'home');
  expect(errors.pageErrors).toEqual([]);
});

test('R11 the splash is drawn at the stored interface size', async ({ page }) => {
  await bootReal(page, { scale: 1 });
  await page.evaluate(() => document.getAnimations().forEach((a: any) => { if (a.animationName === 'splash-in') { a.pause(); a.currentTime = 600; } }));
  const tile = await page.evaluate(() => document.querySelector('.splash-tile')!.getBoundingClientRect().width);
  expect(tile).toBeCloseTo(264, 0);               // 26.4rem at 100 %
});

test('R11 keyframes, durations and easings match §6.7, sampled through the Web Animations API', async ({ page }) => {
  const errors = H.watchErrors(page);
  await bootReal(page);
  // The grow + hold, as declared.
  const decl = await page.evaluate(() => document.getAnimations()
    .filter((a: any) => /^splash/.test(a.animationName))
    .map((a: any) => ({
      name: a.animationName,
      target: (a.effect.target as HTMLElement).className,
      duration: a.effect.getTiming().duration,
      frames: a.effect.getKeyframes().map((k: any) => ({ offset: k.offset, transform: k.transform, opacity: k.opacity, easing: k.easing }))
    })));
  expect(decl).toEqual([{
    name: 'splash-in', target: 'splash-logo', duration: 900,
    frames: [
      { offset: 0, transform: 'scale(0)', opacity: '0', easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.15)' },
      { offset: 0.5, transform: 'scale(1)', opacity: '1', easing: 'ease' },
      { offset: 1, transform: 'scale(1)', opacity: '1', easing: 'ease' }
    ]
  }]);
  // Sampled: pause it and seek. Grow 0 → 450 ms on the bezier, then still.
  const samples = await page.evaluate((times: number[]) => {
    const a: any = document.getAnimations().find((x: any) => x.animationName === 'splash-in');
    a.pause();
    const logo = document.querySelector('.splash-logo')!;
    return times.map((t) => {
      a.currentTime = t;
      const cs = getComputedStyle(logo);
      const m = /matrix\(([^,]+),/.exec(cs.transform);
      return { t, scale: m ? parseFloat(m[1]) : (cs.transform === 'none' ? 1 : NaN), opacity: parseFloat(cs.opacity) };
    });
  }, [0, 90, 180, 270, 360, 450, 675, 899]);
  for (const s of samples) {
    const y = s.t >= 450 ? 1 : bezier(0.2, 0.9, 0.25, 1.15, s.t / 450);
    expect(s.scale, 'scale at ' + s.t + ' ms').toBeCloseTo(y, 2);
    expect(s.opacity, 'opacity at ' + s.t + ' ms').toBeCloseTo(Math.min(1, Math.max(0, y)), 2);
  }
  // The overshoot of cubic-bezier(.2,.9,.25,1.15) is real: above 1 before 450 ms.
  expect(Math.max.apply(null, samples.map((s) => s.scale))).toBeGreaterThan(1.02);
  // End the hold; with Home in the DOM the exit starts.
  await page.waitForFunction(() => !!document.querySelector('#page-current > *'));
  await page.evaluate(() => (document.getAnimations().find((x: any) => x.animationName === 'splash-in') as any).finish());
  await page.waitForFunction(() => document.getAnimations().some((x: any) => x.animationName === 'splash-fade'));
  const exitDecl = await page.evaluate(() => document.getAnimations()
    .filter((a: any) => /^splash/.test(a.animationName))
    .map((a: any) => ({ name: a.animationName, duration: a.effect.getTiming().duration, easing: a.effect.getKeyframes()[0].easing }))
    .sort((x: any, y: any) => (x.name < y.name ? -1 : 1)));
  expect(exitDecl).toEqual([
    { name: 'splash-fade', duration: 500, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    { name: 'splash-out', duration: 500, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  ]);
  const exitSamples = await page.evaluate((times: number[]) => {
    const anims: any[] = document.getAnimations().filter((x: any) => /^splash-(out|fade)$/.test(x.animationName));
    anims.forEach((a) => a.pause());
    const logo = document.querySelector('.splash-logo')!, root = document.getElementById('splash')!;
    return times.map((t) => {
      anims.forEach((a) => { a.currentTime = t; });
      const m = /matrix\(([^,]+),/.exec(getComputedStyle(logo).transform);
      return { t, scale: m ? parseFloat(m[1]) : 1, opacity: parseFloat(getComputedStyle(logo).opacity), rootOpacity: parseFloat(getComputedStyle(root).opacity) };
    });
  }, [0, 100, 250, 400, 499]);
  // v3.10-fix2 F6 (D160): the exit grows to 1.4 (§6.7 said 2.2): at 2.2 the
  // logo and its glow re-rastered at 2.2x as the exit started (~72 ms of
  // raster at CPU 6x, browser); at 1.4 nothing re-rasters.
  for (const s of exitSamples) {
    const y = bezier(0.2, 0.8, 0.2, 1, s.t / 500);
    expect(s.scale, 'exit scale at ' + s.t).toBeCloseTo(1 + 0.4 * y, 2);
    expect(s.opacity, 'exit opacity at ' + s.t).toBeCloseTo(1 - y, 2);
    expect(s.rootOpacity, 'backdrop opacity at ' + s.t).toBeCloseTo(1 - y, 2);
  }
  await page.evaluate(() => document.getAnimations().forEach((a: any) => { if (/^splash/.test(a.animationName)) a.finish(); }));
  await H.splashGone(page);
  expect(errors.pageErrors).toEqual([]);
});

test('R11 the exit waits for the hold and the first screen; the node is gone within 600 ms of both', async ({ page }) => {
  const errors = H.watchErrors(page);
  await bootReal(page);
  await H.waitForScreen(page, 'home');
  const t = await sp(page);
  test.info().annotations.push({ type: 'timeline', description: JSON.stringify(t) });
  expect(t.ready).toBeLessThan(t.inEnd);          // the mock's first screen beats the hold
  expect(t.inEnd - t.inStart).toBeGreaterThan(880);
  expect(t.exitStart).toBeGreaterThanOrEqual(t.inEnd);
  expect(t.gone - Math.max(t.ready, t.inEnd)).toBeLessThanOrEqual(600);
  expect(t.gone - t.exitStart).toBeGreaterThan(450);   // the 500 ms exit ran
  expect(errors.pageErrors).toEqual([]);
});

test('R11 a slow first screen holds the splash until it is in the DOM', async ({ page }) => {
  const errors = H.watchErrors(page);
  await bootReal(page, { extra: 'mockPingDelay=2000' });
  await H.waitForScreen(page, 'home');
  const t = await sp(page);
  test.info().annotations.push({ type: 'timeline', description: JSON.stringify(t) });
  expect(t.ready).toBeGreaterThan(t.inEnd + 500);
  expect(t.exitStart).toBeGreaterThanOrEqual(t.ready);
  expect(t.gone - t.ready).toBeLessThanOrEqual(600);
  expect(t.gone - t.ready).toBeGreaterThan(450);
  expect(errors.pageErrors).toEqual([]);
});

test('R11 with no session the splash gives way to Login', async ({ page }) => {
  const errors = H.watchErrors(page);
  await bootReal(page, { extra: 'mockNoSession=1' });
  await page.waitForSelector('.login-screen');
  await H.splashGone(page);
  const t = await sp(page);
  expect(t.gone - Math.max(t.ready, t.inEnd)).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe(null);
  expect(await page.locator('.login-screen').count()).toBe(1);
  expect(errors.pageErrors).toEqual([]);
});

test('R11 the 6 s cap clears the splash when no screen ever comes', async ({ page }) => {
  test.setTimeout(30000);
  const errors = H.watchErrors(page);
  await bootReal(page, { extra: 'mockPingDelay=30000' });
  await H.splashGone(page, 9000);
  const t = await sp(page);
  test.info().annotations.push({ type: 'timeline', description: JSON.stringify(t) });
  expect(t.ready).toBe(null);
  expect(t.exitStart).toBeGreaterThan(5900);
  expect(t.exitStart).toBeLessThan(6400);
  expect(t.gone - t.exitStart).toBeLessThanOrEqual(600);
  expect(errors.pageErrors).toEqual([]);
});

test('R11 keys pressed during the splash have no effect, even with a resumed queue in the bar', async ({ page }) => {
  const errors = H.watchErrors(page);
  // A saved server queue (A8): the shell restores it, paused, while the
  // splash is still up, so the NP bar is there to be reached.
  await page.addInitScript(() => {
    localStorage.setItem('__mock_playqueue__', JSON.stringify({ ids: ['song-0', 'song-1', 'song-2'], index: 1, position: 12000, byIndex: true }));
  });
  await bootReal(page);
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getCurrentScreen() === 'home' &&
    !!Player.getState().currentTrack && App.isNowPlayingBarAvailable() && !!document.getElementById('splash'));
  const before = await page.evaluate(() => ({ zone: FocusManager.getActiveZone(), index: FocusManager.snapshot().index }));
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowRight', 'Escape', ' ']) {
    await page.keyboard.press(key);
  }
  const during = await page.evaluate(() => ({ splash: !!document.getElementById('splash'), keys: (window as any).__sp.keys }));
  expect(during).toEqual({ splash: true, keys: 0 });
  await H.splashGone(page);
  await H.settle(page, 400);                      // past the 180 ms nav dwell a Right would start
  const after = await page.evaluate(() => ({
    screen: App.getCurrentScreen(),
    zone: FocusManager.getActiveZone(),
    index: FocusManager.snapshot().index,
    exitDialog: !!document.querySelector('.exit-overlay'),
    playing: Player.getState().isPlaying,
    track: Player.getState().currentTrack.id
  }));
  expect(before).toEqual({ zone: 'topnav', index: 0 });
  expect(after).toEqual({ screen: 'home', zone: 'topnav', index: 0, exitDialog: false, playing: false, track: 'song-1' });
  // Once it is gone, keys arrive.
  await page.keyboard.press('ArrowDown');
  await H.settle(page);
  expect((await sp(page)).keys).toBe(1);
  expect((await H.focus(page)).zone).not.toBe('topnav');
  expect(errors.pageErrors).toEqual([]);
});

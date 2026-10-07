import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.10 R10 (ticket §6.6, §7 R10): Settings -> Appearance -> Background,
// Solid (default) or Gradient: one fixed layer behind #page-container.

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-10');
const GRADIENT = { 'sonance-backdrop': 'gradient' };

async function toBackdropRow(page: Page) {
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  for (let i = 0; i < 20; i++) {
    if ((await H.focus(page)).id === 'settings-backdrop-row') break;
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
  }
  expect((await H.focus(page)).id).toBe('settings-backdrop-row');
}

const state = (page: Page) => page.evaluate(() => ({
  value: (document.getElementById('settings-backdrop-value') || {} as any).textContent,
  stored: localStorage.getItem('sonance-backdrop'),
  cls: document.documentElement.classList.contains('backdrop-gradient'),
  drawn: getComputedStyle(document.getElementById('app-backdrop')!).display
}));

test('R10 Background is Solid by default; Left, Right and Enter switch it live; it is stored and comes back at the next start', async ({ page }) => {
  await H.bootMock(page);
  await toBackdropRow(page);
  expect(await state(page)).toEqual({ value: 'Solid', stored: null, cls: false, drawn: 'none' });
  await H.press(page, 'ArrowRight');
  expect(await state(page)).toEqual({ value: 'Gradient', stored: 'gradient', cls: true, drawn: 'block' });
  await H.press(page, 'ArrowLeft');
  expect(await state(page)).toEqual({ value: 'Solid', stored: 'solid', cls: false, drawn: 'none' });
  await H.press(page, 'Enter');
  expect(await state(page)).toEqual({ value: 'Gradient', stored: 'gradient', cls: true, drawn: 'block' });
  // The row is Appearance's, right after Interface size (mockup 13).
  expect(await page.evaluate(() => {
    const row = document.getElementById('settings-backdrop-row')!;
    return row.previousElementSibling!.id;
  })).toBe('settings-ui-scale-row');
  // A fresh start: the class is on <html> before the shell is built.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as any).__clsAtLoad = document.documentElement.classList.contains('backdrop-gradient');
    });
  });
  await page.reload();
  await H.waitForScreen(page, 'home');
  expect(await page.evaluate(() => (window as any).__clsAtLoad)).toBe(true);
  expect((await state(page)).drawn).toBe('block');
});

test('R10 every menu screen with Gradient on (screenshots read back), with no animation and no extra layer', async ({ page }) => {
  await H.bootMock(page, { storage: GRADIENT });
  await H.startTrack(page, 3, { paused: true });
  const screens = ['home', 'library', 'playlists', 'queue', 'search', 'settings'];
  for (const s of screens) {
    if (s !== 'home') await H.navTo(page, s);
    await H.settle(page, 500);
    const shot = await page.screenshot({ path: path.join(SHOTS, 's7-gradient-' + s + '.png') });
    // Left edge, just under the nav, inside the page padding: the gradient's
    // accent glow (pink), not --bg-main's #1a1a24.
    const [px] = await H.pngPixels(page, shot, [[12, 140]]);
    expect(px[0], s + ' red at the top left').toBeGreaterThan(60);
    expect(px[0] - px[2], s + ' warmer than blue at the top left').toBeGreaterThan(5);
    expect(await page.evaluate(() => document.getElementById('app-backdrop')!.getAnimations().length)).toBe(0);
  }
  // Album detail (a sub-screen) too.
  await H.navTo(page, 'home');
  await page.evaluate(() => FocusManager.setActiveZone('home-newest', 0, true));
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 500);
  await page.screenshot({ path: path.join(SHOTS, 's7-gradient-album.png') });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('app-backdrop')!).willChange)).toBe('auto');
});

test('R10 at rest the gradient adds no composited layer (CDP LayerTree, within 1) and no animation', async ({ page }) => {
  async function measure(storage: any) {
    await H.bootMock(page, { storage });
    await H.settle(page, 800);
    const cdp = await page.context().newCDPSession(page);
    let layers: any[] = [];
    cdp.on('LayerTree.layerTreeDidChange', (e: any) => { if (e.layers) layers = e.layers; });
    await cdp.send('LayerTree.enable');
    // A frame so the tree is reported (a no-op style change on <body>).
    await page.evaluate(() => new Promise<void>((r) => { document.body.style.outline = '0px solid transparent'; requestAnimationFrame(() => requestAnimationFrame(() => r())); }));
    await H.settle(page, 300);
    await cdp.send('LayerTree.disable');
    await cdp.detach();
    const anims = await page.evaluate(() => document.getAnimations().length);
    return { layers: layers.length, drawing: layers.filter((l: any) => l.drawsContent).length, anims };
  }
  const solid = await measure({ 'sonance-backdrop': 'solid' });
  const gradient = await measure(GRADIENT);
  test.info().annotations.push({ type: 'layers', description: 'solid ' + JSON.stringify(solid) + ' gradient ' + JSON.stringify(gradient) });
  expect(Math.abs(gradient.layers - solid.layers)).toBeLessThanOrEqual(1);
  expect(Math.abs(gradient.drawing - solid.drawing)).toBeLessThanOrEqual(1);
  expect(gradient.anims).toBe(solid.anims);
});

// Resolves once every <img> is loaded and no animation or transition has run
// for three frames in a row, then decodes the images and Now Playing's
// backdrop (a CSS background, not in document.images). Now Playing arrives
// with five transitions (the nav pill, .np-left, Up Next's fade and slide,
// the bar's fade); on a slow CI runner one shot caught them after the fixed
// settle and differed from the other by 119/255 (run 37633446833).
async function quiet(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const t0 = performance.now();
    let calm = 0;
    (function tick() {
      const busy = Array.from(document.images).some((i) => !i.complete) ||
        document.getAnimations().some((a) => a.playState === 'running');
      calm = busy ? 0 : calm + 1;
      if (calm >= 3) return resolve();
      if (performance.now() - t0 > 10000) return reject(new Error('still loading or animating after 10 s'));
      requestAnimationFrame(tick);
    })();
  }));
  await page.evaluate(() => {
    const urls = Array.from(document.images).filter((i) => i.src).map((i) => i.src);
    const bg = document.querySelector('.np-bg-image');
    const m = bg ? /url\("?([^")]*)"?\)/.exec(getComputedStyle(bg).backgroundImage) : null;
    if (m) urls.push(m[1]);
    return Promise.all(urls.map((u) => { const i = new Image(); i.src = u; return i.decode().catch(() => {}); }));
  });
  await H.settle(page, 50);
}

test('R10 not visible on Now Playing (within 2/255 of Solid everywhere) or on Login (no layer)', async ({ page }) => {
  async function npShot(storage: any) {
    await H.bootMock(page, { storage });
    await H.startTrack(page, 3, { paused: true });
    await page.evaluate(() => App.navigateTo('nowplaying'));
    await H.waitForScreen(page, 'nowplaying');
    await H.settle(page, 900);
    await quiet(page);
    return page.screenshot();
  }
  const solid = await npShot({ 'sonance-backdrop': 'solid' });
  const gradient = await npShot(GRADIENT);
  // With the gradient on, Now Playing's opaque base (D132) blends the
  // blurred backdrop up to 2/255 differently from Solid's; the gradient
  // itself would differ by tens of levels (its accent glow at the top left).
  const d = await H.pngDiff(page, solid, gradient);
  test.info().annotations.push({ type: 'diff', description: JSON.stringify(d) });
  expect(d.max).toBeLessThanOrEqual(2);
  const [tl] = await H.pngPixels(page, gradient, [[12, 12]]);
  const [tlSolid] = await H.pngPixels(page, solid, [[12, 12]]);
  expect(Math.abs(tl[0] - tlSolid[0])).toBeLessThanOrEqual(2);
  // Login: logging out tears the shell (and its layer) down.
  await page.evaluate(() => { AuthManager.logout(); App.showLogin(); });
  await page.waitForSelector('.login-screen');
  expect(await page.evaluate(() => ({
    layer: !!document.getElementById('app-backdrop'),
    cls: document.documentElement.classList.contains('backdrop-gradient')
  }))).toEqual({ layer: false, cls: true });
});

test('R10 the gradient follows the accent live, and the focus fill and its ink hold over it (D50)', async ({ page }) => {
  await H.bootMock(page, { storage: GRADIENT });
  const presets = await page.evaluate(() => [
    ['#e44d8a', '228, 77, 138'], ['#f97316', '249, 115, 22'], ['#f59e0b', '245, 158, 11'],
    ['#22c55e', '34, 197, 94'], ['#14b8a6', '20, 184, 166']
  ]);
  // The hero Play button: a button fill, over the hero card; the first
  // Recently Added card: the card ring, straight over the gradient.
  await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
  await H.settle(page, 200);
  for (const [hex, rgb] of presets) {
    await page.evaluate(([h, r]) => App.saveAccentColor(h, r), [hex, rgb]);
    await H.settle(page, 100);
    const r = await page.evaluate(() => {
      const btn = FocusManager.getCurrentFocused();
      const cs = getComputedStyle(btn);
      const lum = (c: string) => {
        const p = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
          v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      };
      const a = lum(cs.backgroundColor), b = lum(cs.color);
      return {
        bg: cs.backgroundColor, ink: cs.color,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        layer: getComputedStyle(document.getElementById('app-backdrop')!).backgroundImage
      };
    });
    const parts = rgb.split(',').map((x) => x.trim()).join(', ');
    expect(r.bg).toBe('rgb(' + parts + ')');
    expect(r.contrast, hex + ' ink on fill').toBeGreaterThanOrEqual(3);
    expect(r.layer).toContain('rgba(' + parts + ', 0.42)');
    if (hex === '#f59e0b') {
      expect(r.ink).toBe('rgb(21, 21, 28)');      // dark ink on Amber (D50)
      await page.screenshot({ path: path.join(SHOTS, 's7-gradient-amber-hero.png') });
      await page.evaluate(() => FocusManager.setActiveZone('home-newest', 0, true));
      await H.settle(page, 300);
      await page.screenshot({ path: path.join(SHOTS, 's7-gradient-amber-card.png') });
      await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
      await H.settle(page, 200);
    }
  }
});

test('R10 a top-nav slide moves the page and its ghost over the still gradient (D98), read mid-transition', async ({ page }) => {
  await H.bootMock(page, { storage: GRADIENT });
  await H.settle(page, 400);
  const before = await page.evaluate(() => JSON.stringify(document.getElementById('app-backdrop')!.getBoundingClientRect()));
  await H.press(page, 'ArrowRight');                // dwell 180 ms, then the 220 ms slide
  await page.waitForFunction(() => !!document.querySelector('#page-container > .page-ghost'));
  await page.waitForTimeout(90);
  const mid = await page.evaluate(() => {
    const ghost = document.querySelector('#page-container > .page-ghost') as HTMLElement;
    const cur = document.getElementById('page-current')!;
    return {
      ghost: !!ghost,
      ghostBg: ghost ? getComputedStyle(ghost).backgroundColor : null,
      curBg: getComputedStyle(cur).backgroundColor,
      rect: JSON.stringify(document.getElementById('app-backdrop')!.getBoundingClientRect())
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 's7-gradient-slide-mid.png') });
  expect(mid).toEqual({ ghost: true, ghostBg: 'rgba(0, 0, 0, 0)', curBg: 'rgba(0, 0, 0, 0)', rect: before });
  await H.waitForScreen(page, 'library');
});

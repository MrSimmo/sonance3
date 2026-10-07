import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10 Session 4 (ticket-3.10 §7):
// - R1.2 interruptible transitions (D52, D87), and D88: a response that lands
//   after its navigation was interrupted does nothing;
// - R1.3 dwell auto-navigation on the top nav and the Library sub-nav (D51,
//   D89, D90);
// - R2 page transitions (§6.4): zoom origin (D53, D92), rise and sink (D93),
//   transform/opacity only, at most 0.25 s, and the ghost staying where it
//   was drawn (D98).
// S1 encoded R1.2 and R1.3 as `[today]` tests plus `test.fail` targets; S4
// deleted the twins and flipped the targets.

type XY = { x: number; y: number };

async function focusLibraryCard(page: Page, index: number, opts?: object) {
  await H.bootMock(page, opts);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  if (index) await H.press(page, 'ArrowRight', index, 60);
  await H.settle(page, 100);
  const origin = await H.focus(page);
  expect(origin).toMatchObject({ zone: 'library-grid', index });
  return origin;
}

// The centre of the focused element as drawn, in `layerSel`'s coordinates.
async function focusedCentreIn(page: Page, layerSel: string): Promise<XY> {
  return page.evaluate((sel) => {
    const el = FocusManager.getCurrentFocused() as HTMLElement;
    const layer = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    return { x: r.left + r.width / 2 - l.left, y: r.top + r.height / 2 - l.top };
  }, layerSel);
}

function parseOrigin(s: string): XY {
  const m = /^(-?[\d.]+)px (-?[\d.]+)px/.exec(s);
  if (!m) throw new Error('not a px transform-origin: ' + s);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

function expectNear(a: XY, b: XY, tol: number) {
  expect(Math.abs(a.x - b.x), JSON.stringify({ a, b })).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y), JSON.stringify({ a, b })).toBeLessThanOrEqual(tol);
}

// Inline transition state of the live layer and of any ghost, read straight
// after a key press (the navigation runs inside the keydown handler).
async function layers(page: Page) {
  return page.evaluate(() => {
    const cur = document.getElementById('page-current') as HTMLElement;
    const ghosts = Array.prototype.slice.call(document.querySelectorAll('.page-ghost')) as HTMLElement[];
    const pick = (n: HTMLElement) => ({
      transform: n.style.transform, opacity: n.style.opacity, zIndex: n.style.zIndex,
      origin: n.style.transformOrigin, transition: n.style.transition
    });
    return { cur: pick(cur), ghosts: ghosts.map(pick) };
  });
}

// Every transitionstart in the page: what, which property, its duration and
// easing, and the target's transform-origin at that moment.
async function recordTransitions(page: Page) {
  await page.evaluate(() => {
    (window as any).__ts = [];
    document.addEventListener('transitionstart', (e: any) => {
      const t = e.target as HTMLElement;
      const cs = getComputedStyle(t);
      const props = cs.transitionProperty.split(',').map((s) => s.trim());
      const durs = cs.transitionDuration.split(',').map((s) => parseFloat(s));
      const eases = cs.transitionTimingFunction.split(/,(?![^(]*\))/).map((s) => s.trim());
      const i = props.indexOf(e.propertyName);
      (window as any).__ts.push({
        target: t.id ? '#' + t.id : String(t.className),
        page: t.id === 'page-current' || t.classList.contains('page-ghost') || t.id === 'library-content',
        prop: e.propertyName,
        dur: i > -1 ? durs[i] : durs[0],
        ease: i > -1 ? eases[i] : eases[0],
        origin: cs.transformOrigin
      });
    }, true);
  });
  return {
    read: () => page.evaluate(() => (window as any).__ts as any[]),
    clear: () => page.evaluate(() => { (window as any).__ts = []; })
  };
}

async function settledLayers(page: Page) {
  return page.evaluate(() => {
    const cur = document.getElementById('page-current') as HTMLElement;
    return {
      ghosts: document.querySelectorAll('.page-ghost').length,
      transform: cur.style.transform,
      opacity: cur.style.opacity,
      origin: cur.style.transformOrigin,
      willChange: cur.style.willChange
    };
  });
}

// ---------------------------------------------------------------- R1.2

test('[R1.2] Enter then Back @120 ms returns to Library and the originating card', async ({ page }) => {
  await focusLibraryCard(page, 1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: 1 });
});

test('[R1.2] 10 alternating Enter/Back @80 ms: no press ignored, final screen matches the last, no leftovers', async ({ page }) => {
  await focusLibraryCard(page, 1);
  const renders = await H.countRenders(page);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 === 0 ? 'Enter' : 'Escape');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  const r = await renders.read();
  test.info().annotations.push({ type: 'renders', description: JSON.stringify(r) });
  // Every Enter opened the album and every Back re-rendered Library.
  expect(r.album).toBe(5);
  expect(r.library).toBe(5);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: 1 });
  expect(await settledLayers(page)).toEqual({ ghosts: 0, transform: '', opacity: '', origin: '', willChange: '' });
});

test('[R1.2] a key pressed during a slide is acted on (Down lands in the new screen)', async ({ page }) => {
  await H.bootMock(page);
  await H.press(page, 'ArrowRight');
  // Inside the dwell plus the 220 ms slide that follows it.
  await page.waitForTimeout(260);
  expect(await page.evaluate(() => document.querySelectorAll('.page-ghost').length)).toBe(1);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect((await H.focus(page)).zone).toBe('library-grid');
});

// D88: Back now arrives before a slow server's data. The late response
// belongs to an activation that ended and must not touch the next screen.
async function delay(page: Page, pattern: string, ms: number) {
  await page.evaluate(([p, d]) => {
    const orig = window.fetch;
    const re = new RegExp(p as string);
    window.fetch = function(u: any, o: any) {
      if (re.test(String(u))) {
        return new Promise((res) => setTimeout(res, d as number)).then(() => orig(u, o));
      }
      return orig(u, o);
    } as any;
  }, [pattern, ms]);
}

test('[D88] Back before the album arrives: the late album does not take focus or zones', async ({ page }) => {
  await focusLibraryCard(page, 1);
  await delay(page, 'getAlbum\\.view', 400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: 1 });
  const zones = await page.evaluate(() => (FocusManager as any)._debugZones());
  expect(zones).not.toContain('album-tracks');
});

test('[D88] Back before a playlist arrives: the grid stays, no detail zooms in late', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await delay(page, 'getPlaylist\\.view', 400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => ({
    rows: document.querySelectorAll('#page-current .song-row').length,
    cards: document.querySelectorAll('#page-current .playlist-card').length
  }));
  expect(s.rows).toBe(0);
  expect(s.cards).toBeGreaterThan(0);
  expect((await H.focus(page)).cls).toContain('playlist-card');
});

// ---------------------------------------------------------------- R1.3

test('[R1.3] 4x Right @90 ms renders exactly 1 screen, the destination', async ({ page }) => {
  await H.bootMock(page);
  const renders = await H.countRenders(page);
  await H.press(page, 'ArrowRight', 4, 90);
  await page.waitForTimeout(900);
  const r = await renders.read();
  test.info().annotations.push({ type: 'renders', description: JSON.stringify(r) });
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  expect(Object.values(r).reduce((a: number, b: number) => a + b, 0)).toBe(1);
  expect(r.nowplaying).toBe(1);
});

test('[R1.3] one press: the pill moves at once, the render starts 150-220 ms after keydown', async ({ page }) => {
  await H.bootMock(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__t = {};
    document.addEventListener('keydown', () => { w.__t.key = performance.now(); }, true);
    const orig = LibraryScreen.render;
    (LibraryScreen as any).render = function() {
      w.__t.render = performance.now();
      return orig.apply(this, arguments as any);
    };
  });
  await H.press(page, 'ArrowRight');
  const atOnce = await page.evaluate(() => ({
    selected: (document.querySelector('.top-nav-item.selected') as HTMLElement).getAttribute('data-screen'),
    screen: App.getCurrentScreen()
  }));
  expect(atOnce).toEqual({ selected: 'library', screen: 'home' });
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => (window as any).__t);
  const ms = t.render - t.key;
  test.info().annotations.push({ type: 'render start after keydown (ms)', description: String(Math.round(ms)) });
  expect(ms).toBeGreaterThanOrEqual(150);
  expect(ms).toBeLessThanOrEqual(220);
});

for (const key of ['ArrowDown', 'Enter']) {
  test(`[R1.3] ${key} within the dwell navigates at once and focus lands in content`, async ({ page }) => {
    await H.bootMock(page);
    const renders = await H.countRenders(page);
    await H.press(page, 'ArrowRight');
    await page.waitForTimeout(60);
    await H.press(page, key);
    // Sooner than the 180 ms dwell would have fired.
    expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
    await H.settle(page, 300);
    expect((await renders.read()).library).toBe(1);
    const f = await H.focus(page);
    expect(f.zone).toBe('library-grid');
    expect(f.visible).toBe(true);
  });
}

test('[R1.3] Back within the dwell goes where the pill is, then acts (exit dialog on the nav)', async ({ page }) => {
  await H.bootMock(page);
  await H.press(page, 'ArrowRight');
  await page.waitForTimeout(60);
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect((await H.focus(page)).zone).toBe('exit-dialog');
});

async function onSubnavAlbums(page: Page) {
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-subnav', index: 0 });
  await page.evaluate(() => {
    const w = window as any;
    w.__builds = [];
    new MutationObserver((recs) => {
      recs.forEach((r) => r.addedNodes.forEach((n: any) => {
        if (n.nodeType === 1 && n.classList.contains('library-loading')) w.__builds.push(LibraryScreen.getActiveTab());
      }));
    }).observe(document.getElementById('app') as HTMLElement, { childList: true, subtree: true });
  });
}

test('[R1.3] sub-nav Down x3 @90 ms builds exactly 1 tab, the last', async ({ page }) => {
  await onSubnavAlbums(page);
  await H.press(page, 'ArrowDown', 3, 90);
  // The pill and the selected label are already on Genres.
  expect(await page.evaluate(() => (document.querySelector('.library-subnav-item.selected') as HTMLElement).getAttribute('data-tab'))).toBe('genres');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__builds)).toEqual(['genres']);
  expect(await page.evaluate(() => LibraryScreen.getActiveTab())).toBe('genres');
  expect(await page.evaluate(() => document.querySelectorAll('#library-content .genre-card').length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (document.getElementById('library-content') as HTMLElement).style.opacity)).toBe('1');
});

test('[R1.3] sub-nav Down then Up within the dwell builds nothing and fades back in', async ({ page }) => {
  await onSubnavAlbums(page);
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(90);
  await H.press(page, 'ArrowUp');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).__builds)).toEqual([]);
  expect(await page.evaluate(() => LibraryScreen.getActiveTab())).toBe('albums');
  expect(await page.evaluate(() => (document.getElementById('library-content') as HTMLElement).style.opacity)).toBe('1');
  expect(await page.evaluate(() => document.querySelectorAll('#library-content .album-grid-card').length)).toBeGreaterThan(0);
});

test('[R1.3] sub-nav Right within the dwell builds the tab now and enters its grid', async ({ page }) => {
  await onSubnavAlbums(page);
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(60);
  await H.press(page, 'ArrowRight');
  expect(await page.evaluate(() => (window as any).__builds)).toEqual(['artists']);
  await H.settle(page, 300);
  const f = await H.focus(page);
  expect(f).toMatchObject({ zone: 'library-grid', index: 0 });
  expect(f.cls).toContain('artist-grid-card');
});

// ---------------------------------------------------------------- R2

test('[R2] zoom in starts at the focused card; Back zooms out into the same origin', async ({ page }) => {
  await focusLibraryCard(page, 2);
  const centre = await focusedCentreIn(page, '#page-current');
  const rec = await recordTransitions(page);
  await page.keyboard.press('Enter');
  const zin = await layers(page);
  expect(zin.ghosts.length).toBe(1);
  expectNear(parseOrigin(zin.cur.origin), centre, 2);
  expectNear(parseOrigin(zin.ghosts[0].origin), centre, 2);
  expect(zin.cur.transform).toBe('scale(1)');
  expect(zin.ghosts[0].transform).toBe('scale(1.08)');
  await page.waitForTimeout(400);
  expect(await settledLayers(page)).toEqual({ ghosts: 0, transform: '', opacity: '', origin: '', willChange: '' });

  await page.keyboard.press('Escape');
  const zout = await layers(page);
  expectNear(parseOrigin(zout.cur.origin), centre, 0.1);
  expectNear(parseOrigin(zout.ghosts[0].origin), centre, 0.1);
  expect(zout.ghosts[0].transform).toBe('scale(0.86)');
  await page.waitForTimeout(400);

  const ts = (await rec.read()).filter((e) => e.page);
  test.info().annotations.push({ type: 'page transitions', description: JSON.stringify(ts) });
  // In: incoming 0.25 s, ghost 0.2 s; out the same; one easing.
  expect(ts.length).toBeGreaterThanOrEqual(8);
  for (const e of ts) {
    expect(['transform', 'opacity']).toContain(e.prop);
    expect(e.dur).toBeLessThanOrEqual(0.25);
    expect(e.ease).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  }
});

test('[R2] the zoom is mid-flight at 110 ms: incoming between 0.86 and 1, ghost between 1 and 1.08', async ({ page }) => {
  await focusLibraryCard(page, 1);
  await page.keyboard.press('Enter');
  const mid = await page.evaluate(() => {
    document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 110; });
    const scaleOf = (n: Element) => new DOMMatrix(getComputedStyle(n).transform).a;
    const cur = document.getElementById('page-current') as HTMLElement;
    const ghost = document.querySelector('.page-ghost') as HTMLElement;
    const out = { cur: scaleOf(cur), curOpacity: parseFloat(getComputedStyle(cur).opacity), ghost: scaleOf(ghost), ghostOpacity: parseFloat(getComputedStyle(ghost).opacity) };
    document.getAnimations().forEach((a) => a.play());
    return out;
  });
  test.info().annotations.push({ type: 'at 110 ms', description: JSON.stringify(mid) });
  expect(mid.cur).toBeGreaterThan(0.86);
  expect(mid.cur).toBeLessThan(1);
  expect(mid.ghost).toBeGreaterThan(1);
  expect(mid.ghost).toBeLessThan(1.08);
  expect(mid.curOpacity).toBeGreaterThan(0);
  expect(mid.curOpacity).toBeLessThan(1);
});

test('[R2] in-screen detail (genre) zooms from the card and back into it', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown', 3, 90);
  await page.waitForTimeout(600);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 300);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 200);
  expect((await H.focus(page)).cls).toContain('genre-card');
  const centre = await focusedCentreIn(page, '#library-content');
  await page.keyboard.press('Enter');
  const zin = await page.evaluate(() => ({
    cur: (document.getElementById('library-content') as HTMLElement).style.transformOrigin,
    ghost: (document.querySelector('.page-ghost') as HTMLElement).style.transformOrigin
  }));
  expectNear(parseOrigin(zin.cur), centre, 2);
  expectNear(parseOrigin(zin.ghost), centre, 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  const zout = await page.evaluate(() => (document.getElementById('library-content') as HTMLElement).style.transformOrigin);
  expectNear(parseOrigin(zout), centre, 0.1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.querySelectorAll('.page-ghost').length)).toBe(0);
  expect((await H.focus(page)).cls).toContain('genre-card');
});

test('[R2] in-screen detail (playlist) zooms from the card', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 200);
  const centre = await focusedCentreIn(page, '#page-current');
  const rec = await recordTransitions(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const ts = (await rec.read()).filter((e) => e.target === '#page-current' && e.prop === 'transform');
  expect(ts.length).toBe(1);
  expectNear(parseOrigin(ts[0].origin), centre, 2);
  expect(await page.evaluate(() => document.querySelectorAll('#page-current .song-row').length)).toBeGreaterThan(0);
});

test('[R2] Now Playing rises from the bar and sinks on Back', async ({ page }) => {
  await focusLibraryCard(page, 0);
  await H.startTrack(page, 3, { paused: true });
  const walk = await H.downWalk(page, 20);
  expect(walk.zones[walk.zones.length - 1]).toBe('nowplaying-bar');
  await page.keyboard.press('Enter');
  const rise = await layers(page);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  expect(rise.cur.transform).toBe('translateY(0px)');
  expect(rise.ghosts.length).toBe(1);
  // The page stays still under the rising Now Playing and, since
  // v3.10-fix2 F1 (D152), fades out under it over the rise.
  expect(rise.ghosts[0]).toMatchObject({ transform: '', zIndex: '0', opacity: '0' });
  expect(rise.ghosts[0].transition).toContain('opacity 250ms');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelectorAll('.page-ghost').length)).toBe(0);

  await page.keyboard.press('Escape');
  const sink = await layers(page);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  // F1 (D152): the page fades in where it is as Now Playing sinks.
  expect(sink.cur.transform).toBe('');
  expect(sink.cur.opacity).toBe('1');
  expect(sink.cur.transition).toBe('opacity 250ms cubic-bezier(0.2, 0.8, 0.2, 1)');
  expect(sink.ghosts[0].transform).toBe('translateY(6rem)');
  expect(sink.ghosts[0].opacity).toBe('0');
  await page.waitForTimeout(400);
  expect(await settledLayers(page)).toEqual({ ghosts: 0, transform: '', opacity: '', origin: '', willChange: '' });
});

test('[R2] Auto Now Playing rises; Now Playing reached by the nav slides back', async ({ page }) => {
  await H.bootMock(page, { autoNp: true });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 400);
  await H.press(page, 'ArrowDown', 2, 80);
  await H.settle(page, 100);
  await page.keyboard.press('Enter');
  const rise = await layers(page);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  expect(rise.cur.transform).toBe('translateY(0px)');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  const sink = await layers(page);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('album');
  expect(sink.ghosts[0].transform).toBe('translateY(6rem)');
  await page.waitForTimeout(500);
  // D95 (pre-existing restore, fixed in S4): Back lands on the row that was played.
  expect(await H.focus(page)).toMatchObject({ zone: 'album-tracks', index: 2 });

  // Now Playing through the top nav: Back reverses the slide.
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await page.waitForTimeout(400);
  await H.navTo(page, 'queue');
  await H.press(page, 'ArrowRight');
  await H.waitForScreen(page, 'nowplaying');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  const back = await layers(page);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('queue');
  expect(back.cur.transform).toBe('translateX(0px)');
});

test('[R2] only transform and opacity transition, page transitions at most 0.25 s', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 3, { paused: true });
  const rec = await recordTransitions(page);
  // slide
  await H.navTo(page, 'library');
  // zoom in, zoom out
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await page.waitForTimeout(400);
  // rise, sink
  await H.downWalk(page, 20);
  await H.press(page, 'Enter');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await page.waitForTimeout(400);
  const all = await rec.read();
  const kinds = new Set(all.map((e) => e.prop));
  test.info().annotations.push({ type: 'properties', description: JSON.stringify(Array.from(kinds)) });
  for (const e of all) expect(['transform', 'opacity'], JSON.stringify(e)).toContain(e.prop);
  const pageTs = all.filter((e) => e.page);
  expect(pageTs.length).toBeGreaterThanOrEqual(10);
  for (const e of pageTs) expect(e.dur, JSON.stringify(e)).toBeLessThanOrEqual(0.25);
  // The slide is 0.22 s on the new curve.
  expect(pageTs.some((e) => e.dur === 0.22)).toBe(true);
});

// D98: the ghost keeps the box and layout it had as the live layer.
test('[R2/D98] a ghost does not move at the first frame (slide, zoom, rise, sink)', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 3, { paused: true });
  await page.evaluate(() => {
    const w = window as any;
    w.__key = (code: number) => {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => code });
      document.dispatchEvent(ev);
    };
    // Fire `code`, return how far a node of the live page moved as the page became the ghost.
    w.__jump = (sel: string, code: number) => {
      const n = document.querySelector('#page-current ' + sel) as HTMLElement;
      const a = n.getBoundingClientRect();
      w.__key(code);
      const b = n.getBoundingClientRect();
      return { inGhost: !!n.closest('.page-ghost'), dx: b.left - a.left, dy: b.top - a.top, dw: b.width - a.width };
    };
  });
  const jumps: any = {};
  await H.press(page, 'ArrowRight');
  jumps.slide = await page.evaluate(() => (window as any).__jump('.home-screen > *', 40));
  await H.settle(page, 400);
  jumps.zoomIn = await page.evaluate(() => (window as any).__jump('.library-subnav', 13));
  await page.waitForTimeout(400);
  jumps.zoomOut = await page.evaluate(() => (window as any).__jump('.album-detail', 27));
  await page.waitForTimeout(400);
  await H.downWalk(page, 20);
  jumps.rise = await page.evaluate(() => (window as any).__jump('.library-subnav', 13));
  await page.waitForTimeout(400);
  jumps.sink = await page.evaluate(() => (window as any).__jump('.np-layout, .np-left', 27));
  await page.waitForTimeout(400);
  test.info().annotations.push({ type: 'jumps', description: JSON.stringify(jumps) });
  for (const k of Object.keys(jumps)) {
    expect(jumps[k].inGhost, k).toBe(true);
    expect(Math.abs(jumps[k].dx), k).toBeLessThanOrEqual(0.5);
    expect(Math.abs(jumps[k].dy), k).toBeLessThanOrEqual(0.5);
    expect(Math.abs(jumps[k].dw), k).toBeLessThanOrEqual(0.5);
  }
});

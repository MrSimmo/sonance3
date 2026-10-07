import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as H from './helpers/sonance';
import * as G from './helpers/geometry';

// R4 (S2): Interface size. ticket-3.10 §6.1 / §7 R4, D49, D63-D69.
//
// Most tests pin their own size (`scale:`) so they mean the same thing in
// every SONANCE_SCALE run; `scale: false` seeds nothing, for the tests about
// the stored value itself.

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots', 'v3-10');

async function rootPx(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
}

async function focusRow(page: Page, id: string) {
  await H.press(page, 'ArrowDown');           // top nav -> accent swatches
  await H.settle(page, 100);
  for (let i = 0; i < 10; i++) {
    if ((await H.focus(page)).id === id) return;
    await H.press(page, 'ArrowDown');
    await H.settle(page, 40);
  }
  throw new Error(id + ' not reachable by Down');
}

async function sizeLabel(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('settings-ui-scale-value')!.textContent!);
}

async function expectGeometryOk(page: Page, where: string) {
  await G.settled(page);
  const g = await G.measure(page);
  test.info().annotations.push({ type: 'geometry ' + where, description: JSON.stringify(g) });
  expect(g.problems, where + ' @ ' + g.rootPx + 'px root').toEqual([]);
  return g;
}

test('boots at 150% when nothing is stored', async ({ page }) => {
  await H.bootMock(page, { scale: false });
  expect(await page.evaluate(() => localStorage.getItem('sonance-ui-scale'))).toBeNull();
  expect(await rootPx(page)).toBe(15);
  expect(await page.evaluate(() => SonanceUtils.uiScale())).toBe(1.5);
  await H.navTo(page, 'settings');
  await focusRow(page, 'settings-ui-scale-row');
  expect(await sizeLabel(page)).toBe('150%');
});

test('an invalid stored value falls back to 150%', async ({ page }) => {
  await H.bootMock(page, { scale: false, storage: { 'sonance-ui-scale': '1.3' } });
  expect(await rootPx(page)).toBe(15);
});

test('the bundled build applies the stored size too (head script survives build.sh)', async ({ page }) => {
  await H.bootBundled(page, { scale: false, storage: { 'sonance-ui-scale': '1.25' } });
  expect(await rootPx(page)).toBe(12.5);
  expect(await page.evaluate(() => typeof App.applyUiScale)).toBe('function');
});

test('no small-to-large flash: every frame with the app in it is at the stored size', async ({ page }) => {
  // Sampled on every rAF from the first frame that has #app (the body has
  // been parsed, so anything at all could paint) until Home has rendered.
  await page.addInitScript(() => {
    const w = window as any;
    w.__frames = [];
    const tick = () => {
      const app = document.getElementById('app');
      if (app) {
        const bar = document.getElementById('top-nav-bar');
        w.__frames.push({
          root: getComputedStyle(document.documentElement).fontSize,
          bar: bar ? bar.getBoundingClientRect().height : null,
        });
      }
      if (w.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await H.bootMock(page, { scale: false, storage: { 'sonance-ui-scale': '1.75' }, waitFor: false });
  await page.waitForSelector('#top-nav-bar', { state: 'attached' });
  await page.screenshot({ path: path.join(SHOTS, 's2-first-frame-175.png') });
  await H.waitForScreen(page, 'home');
  const frames = await page.evaluate(() => (window as any).__frames);
  const settledBar = await page.evaluate(() => document.getElementById('top-nav-bar')!.getBoundingClientRect().height);
  test.info().annotations.push({ type: 'frames', description: frames.length + ' sampled; first ' + JSON.stringify(frames[0]) });
  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) {
    expect(f.root).toBe('17.5px');
    if (f.bar !== null) expect(f.bar).toBe(settledBar);
  }
});

test('the size persists across a fresh page', async ({ page, context }) => {
  await H.bootMock(page, { scale: false });
  await H.navTo(page, 'settings');
  await focusRow(page, 'settings-ui-scale-row');
  await H.press(page, 'ArrowRight');
  await H.settle(page, 200);
  expect(await rootPx(page)).toBe(17.5);
  const fresh = await context.newPage();
  await H.bootMock(fresh, { scale: false });
  expect(await rootPx(fresh)).toBe(17.5);
  expect(await fresh.evaluate(() => localStorage.getItem('sonance-ui-scale'))).toBe('1.75');
});

test('D64: Left/Right step and stop at the ends, Enter wraps; focus stays on the row', async ({ page }) => {
  await H.bootMock(page, { scale: 1.5 });
  await H.navTo(page, 'settings');
  await focusRow(page, 'settings-ui-scale-row');
  const start = await H.focus(page);
  const seen: string[] = [];
  const step = async (key: string) => {
    await H.press(page, key);
    await H.settle(page, 150);
    const f = await H.focus(page);
    expect(f.zone).toBe(start.zone);
    expect(f.index).toBe(start.index);
    expect(f.id).toBe('settings-ui-scale-row');
    expect(f.visible).toBe(true);
    seen.push((await sizeLabel(page)) + '@' + (await rootPx(page)));
  };
  await step('ArrowRight');   // 175
  await step('ArrowRight');   // 200
  await step('ArrowRight');   // stays 200
  await step('Enter');        // wraps to 100
  await step('ArrowLeft');    // stays 100
  await step('Enter');        // 125
  await step('ArrowRight');   // 150
  expect(seen).toEqual(['175%@17.5', '200%@20', '200%@20', '100%@10', '100%@10', '125%@12.5', '150%@15']);
});

test('changing the size during playback leaves it playing and advancing', async ({ page }) => {
  await H.bootMock(page, { scale: 1.5 });
  await H.startTrack(page, 5);               // the dev server's WAV stream
  await page.waitForFunction(() => Player.getState().currentTime > 0.3);
  await H.navTo(page, 'settings');
  await focusRow(page, 'settings-ui-scale-row');
  const before = await page.evaluate(() => ({
    s: Player.getState(),
    src: (document.getElementById('sonance-audio') as HTMLAudioElement).currentSrc,
  }));
  await H.press(page, 'ArrowRight');
  await H.settle(page, 150);
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 150);
  await H.press(page, 'ArrowLeft');
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({
    s: Player.getState(),
    src: (document.getElementById('sonance-audio') as HTMLAudioElement).currentSrc,
  }));
  test.info().annotations.push({ type: 'playback', description: before.s.currentTime + ' -> ' + after.s.currentTime });
  expect(await rootPx(page)).toBe(12.5);
  expect(after.s.isPlaying).toBe(true);
  expect(after.s.currentTrack.id).toBe(before.s.currentTrack.id);
  expect(after.src).toBe(before.src);
  expect(after.s.currentTime).toBeGreaterThan(before.s.currentTime + 0.8);
});

test('live apply: nav pill re-measured, NP bar and page container in scale, icons in rem', async ({ page }) => {
  await H.bootMock(page, { scale: 1 });
  await H.startTrack(page, 5, { paused: true });
  await H.navTo(page, 'settings');
  await focusRow(page, 'settings-ui-scale-row');
  for (const want of [12.5, 15, 17.5, 20]) {
    await H.press(page, 'ArrowRight');
    await H.settle(page, 350);                // let the pill settle
    expect(await rootPx(page)).toBe(want);
    await expectGeometryOk(page, 'settings after live apply');
    const icon = await page.evaluate(() => {
      const svg = document.querySelector('#now-playing-bar .np-bar-btn svg')!;
      return svg.getBoundingClientRect().width;
    });
    expect(icon).toBeCloseTo(2 * want, 0);   // rem(20)
  }
});

// Every primary screen plus the sub-screens, at each larger size. The full
// 19-state sweep at every size is `tests/tools/visual-baseline.js --geometry`
// (evidence in PROGRESS.md); this is its regression subset.
for (const scale of [1.25, 1.5, 1.75, 2]) {
  test(`geometry at ${scale * 100}%: primary screens`, async ({ page }) => {
    await G.installProbes(page);
    await H.bootMock(page, { scale, albums: 120, artists: 80, songs: 400, extra: 'mockLyrics=1' });
    await H.startTrack(page, 20, { paused: true });
    expect(await rootPx(page)).toBe(10 * scale);
    await H.press(page, 'ArrowDown');
    await expectGeometryOk(page, 'home');

    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 250);
    const albums = await expectGeometryOk(page, 'library albums');
    expect(albums.grids.albums.columns).toBe(albums.grids.albums.cssColumns);
    await H.press(page, 'ArrowLeft');          // sub-nav
    await H.settle(page, 100);
    await H.press(page, 'ArrowDown');          // Artists
    await page.waitForTimeout(400);
    await expectGeometryOk(page, 'library artists');
    for (const tab of ['songs', 'genres']) {
      await H.press(page, 'ArrowDown');
      await page.waitForTimeout(400);
      await expectGeometryOk(page, 'library ' + tab);
    }

    await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
    for (const screen of ['playlists', 'queue', 'nowplaying', 'search', 'settings']) {
      await H.navTo(page, screen);
      await H.press(page, 'ArrowDown');
      await H.settle(page, 300);
      await expectGeometryOk(page, screen);
      if (screen === 'nowplaying') {
        await H.press(page, 'ArrowRight', 4);  // lyrics button (Play + 4; S6 added ⓘ after it)
        await H.press(page, 'Enter');
        await page.waitForTimeout(700);
        const g = await expectGeometryOk(page, 'nowplaying lyrics');
        expect(g.lyricsLeftRem).toBeGreaterThanOrEqual(6);
        expect(g.lyricsLeftRem).toBeLessThanOrEqual(10);
        // v3.10 R7: the credits panel has the same geometry.
        await H.press(page, 'ArrowRight');     // ⓘ
        await H.press(page, 'Enter');          // opens credits, closes lyrics
        await page.waitForTimeout(700);
        const c = await expectGeometryOk(page, 'nowplaying credits');
        expect(c.lyricsLeftRem).toBeGreaterThanOrEqual(6);
        expect(c.lyricsLeftRem).toBeLessThanOrEqual(10);
        await H.press(page, 'Enter');          // close credits
        await page.waitForTimeout(400);
      }
      await page.evaluate((i) => FocusManager.setActiveZone('topnav', i, true), H.NAV.indexOf(screen));
      await H.settle(page, 100);
    }
  });

  test(`geometry at ${scale * 100}%: album, artist, playlist detail`, async ({ page }) => {
    await G.installProbes(page);
    await H.bootMock(page, { scale, albums: 120, artists: 80, songs: 400 });
    await H.startTrack(page, 20, { paused: true });
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 250);
    await H.press(page, 'Enter');
    await H.waitForScreen(page, 'album');
    await expectGeometryOk(page, 'album');
    // The v3.9 300 ms input lock (R1.2, removed in S4) drops a Back that
    // lands inside it; the transition can look settled at 280 ms.
    await page.waitForTimeout(350);
    await H.press(page, 'Escape');
    await H.waitForScreen(page, 'library');
    await page.waitForTimeout(350);
    await H.press(page, 'ArrowLeft');
    await H.settle(page, 100);
    await H.press(page, 'ArrowDown');           // Artists
    await page.waitForTimeout(400);
    await H.press(page, 'ArrowRight');
    await H.settle(page, 150);
    await H.press(page, 'Enter');
    await H.waitForScreen(page, 'artist');
    const g = await expectGeometryOk(page, 'artist');
    // The discography row's focus scale(1.03) overruns the panel at every
    // size including 100 % (pre-existing, owned by S3/R6) - recorded, not
    // failed: see PROGRESS.md S2 and next_prompt.md S3.
    test.info().annotations.push({ type: 'artist focusClip', description: JSON.stringify(g.focusClip) });
    await page.waitForTimeout(350);             // the R1.2 input lock, as above
    await H.press(page, 'Escape');              // back to Library
    await H.waitForScreen(page, 'library');
    await page.waitForTimeout(350);
    await H.navTo(page, 'playlists');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 150);
    await H.press(page, 'Enter');
    await page.waitForTimeout(400);
    await expectGeometryOk(page, 'playlist detail');
  });
}

test('D68: at 200% the Home carousels keep every focused card fully in view', async ({ page }) => {
  await G.installProbes(page);
  await H.bootMock(page, { scale: 2, albums: 120, artists: 80, songs: 400 });
  await H.press(page, 'ArrowDown');           // hero
  await H.settle(page, 100);
  let overflowing = 0, rowsWalked = 0, prevZone = '';
  // Down through whichever rows the fixture fills, until focus leaves them.
  // v3.10 S3 (R9): with no track the hidden NP bar is no longer a target, so
  // Down from the last row stays on it; a repeated zone also ends the walk.
  // v3.10 S7 (A4): the favourites, most played and Rediscover rows too.
  for (let r = 0; r < 8; r++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 120);
    let f = await H.focus(page);
    if (!/^home-(newest|recent|favourites|frequent|playlists|rediscover)$/.test(f.zone) || f.zone === prevZone) break;
    const zone = f.zone;
    prevZone = zone;
    rowsWalked++;
    const info = await page.evaluate((z) => {
      const row = document.querySelector('#' + z + '-row')!;
      return { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, count: row.querySelectorAll('.focusable').length };
    }, zone);
    if (info.scrollWidth > info.clientWidth) overflowing++;
    for (let i = 0; i < info.count; i++) {
      await G.settled(page);
      const g = await G.measure(page);
      expect(g.problems, zone + '[' + i + ']').toEqual([]);
      if (i < info.count - 1) {
        await H.press(page, 'ArrowRight');
        await H.settle(page, 80);
      }
    }
    // Walk back to the first card (count - 1 presses: one more would leave
    // the row for the top nav), checking the follow scrolls back too.
    for (let i = 0; i < info.count - 1; i++) await H.press(page, 'ArrowLeft', 1, 30);
    await H.settle(page, 80);
    f = await H.focus(page);
    expect(f.zone).toBe(zone);
    expect(f.index).toBe(0);
    await G.settled(page);
    expect((await G.measure(page)).problems).toEqual([]);
  }
  // The fixture must actually exercise the follow, or this proves nothing.
  test.info().annotations.push({ type: 'rows', description: rowsWalked + ' walked, ' + overflowing + ' overflowing' });
  expect(rowsWalked).toBe(6);                 // newest, recent, favourites, most played, playlists, rediscover
  expect(overflowing).toBeGreaterThan(0);
});

test('at 100% the Home carousels never scroll (identity with v3.9 layout)', async ({ page }) => {
  await H.bootMock(page, { scale: 1, albums: 120, artists: 80, songs: 400 });
  await H.press(page, 'ArrowDown', 2, 100);
  await H.press(page, 'ArrowRight', 8, 60);
  await H.settle(page, 100);
  const lefts = await page.evaluate(() => Array.from(document.querySelectorAll('.home-row')).map((r) => r.scrollLeft));
  expect(lefts.every((l) => l === 0)).toBe(true);
});

test('Albums traversal at 150%: 0 focus-integrity failures (v3.9 method)', async ({ page }) => {
  test.setTimeout(180000);
  await G.installProbes(page);
  await H.bootMock(page, { scale: 1.5, albums: 1200, artists: 80, songs: 400 });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  // Checked after every press: a focused node exists, is connected, sits in
  // #library-grid, carries the data-vg-index FocusManager thinks it has,
  // and is vertically inside the scroll viewport.
  const check = () => page.evaluate(() => {
    const f = FocusManager.getCurrentFocused();
    const snap = FocusManager.snapshot();
    const sc = document.getElementById('library-content')!;
    if (snap.zone !== 'library-grid') return { zone: snap.zone, ok: true, escape: true, index: snap.index };
    const ok = !!f && f.isConnected && !!f.closest('#library-grid') &&
      f.getAttribute('data-vg-index') === String(snap.index);
    // Layout box, not the transformed rect: the card scales 1.08 about its
    // centre and is mid-transition here, so its rect overhangs by up to
    // 4 %; the centre does not move, and offsetHeight is the layout height.
    let inView = false;
    if (f) {
      const r = f.getBoundingClientRect(), s = sc.getBoundingClientRect();
      const cy = (r.top + r.bottom) / 2, half = (f as HTMLElement).offsetHeight / 2;
      inView = cy - half >= s.top - 1 && cy + half <= s.bottom + 1;
    }
    return { zone: snap.zone, ok: ok && inView, escape: false, index: snap.index };
  });
  const geom = await G.measure(page);
  const cols = geom.grids.albums.columns;
  expect(cols).toBe(geom.grids.albums.cssColumns);
  let checks = 0, failures = 0, escapes = 0, maxIndex = 0;
  const fails: any[] = [];
  for (let i = 0; i < 260 && maxIndex < 1200 - cols; i++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
    if (process.env.SONANCE_SMOOTH) await H.scrollIdle(page);   // R1.8
    const c = await check();
    if (c.escape) { escapes++; await H.press(page, 'ArrowUp'); await H.settle(page, 60); continue; }
    checks++;
    if (!c.ok) { failures++; fails.push(c); }
    maxIndex = Math.max(maxIndex, c.index);
  }
  for (let i = 0; i < 260; i++) {
    const before = await page.evaluate(() => FocusManager.snapshot().index);
    if (before < cols) break;
    await H.press(page, 'ArrowUp');
    await H.settle(page, 30);
    if (process.env.SONANCE_SMOOTH) await H.scrollIdle(page);
    const c = await check();
    checks++;
    if (!c.ok || c.escape) { failures++; fails.push(c); }
  }
  test.info().annotations.push({ type: 'traversal', description: JSON.stringify({ cols, checks, failures, escapes, maxIndex, fails: fails.slice(0, 5) }) });
  expect(maxIndex).toBeGreaterThanOrEqual(1200 - cols);
  expect(failures).toBe(0);
});

test('R1.1: the performance overlay scales and stays on screen at 200%', async ({ page }) => {
  await H.bootMock(page, { scale: 2, storage: { 'sonance-perf-hud': 'true' } });
  await H.navTo(page, 'library');
  await page.waitForTimeout(1500);
  const hud = await page.evaluate(() => {
    const el = document.getElementById('perf-hud')!;
    const r = el.getBoundingClientRect();
    return { font: getComputedStyle(el).fontSize, left: r.left, top: r.top, right: r.right, bottom: r.bottom, text: el.textContent };
  });
  test.info().annotations.push({ type: 'hud', description: JSON.stringify(hud) });
  expect(hud.font).toBe('28px');              // 1.4rem at a 20px root
  expect(hud.right).toBeLessThan(1920);
  expect(hud.bottom).toBeLessThan(1080);
  expect(hud.text).toMatch(/FPS \d+/);
  await page.screenshot({ path: path.join(SHOTS, 's2-perf-hud-200.png'), clip: { x: 0, y: 0, width: 700, height: 240 } });
});

test('D49: no CSS zoom anywhere', async ({ page }) => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css).not.toMatch(/(^|[;{\s])zoom\s*:/);
  const jsDir = path.join(ROOT, 'js');
  const files = fs.readdirSync(jsDir).map((f) => path.join(jsDir, f))
    .concat(fs.readdirSync(path.join(jsDir, 'screens')).map((f) => path.join(jsDir, 'screens', f)))
    .filter((f) => /\.js$/.test(f));
  for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/style\.zoom/);
  await H.bootMock(page, { scale: 2 });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1');
});

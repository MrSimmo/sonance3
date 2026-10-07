import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R9 (ticket-3.10 §7, D56): Down reaches the bottom bar, the bar's first
// target opens Now Playing, the bar is unreachable while hidden, Up returns
// to the zone and item focus came from, and the Library sub-nav's last tab
// reaches the bar. One helper, App.registerNowPlayingBarZone, registers the
// zone everywhere. S1 wrote the first three as `test.fail` targets next to
// `[today]` tests; S3 landed R9, flipped them and deleted the `[today]` ones.

const SKIP_ZONES = ['topnav', 'nowplaying-bar', 'exit-dialog', 'confirm-dialog'];

async function onBarOpen(page: Page) {
  return page.evaluate(() => {
    const el = FocusManager.getCurrentFocused();
    return !!el && el.classList.contains('np-bar-open');
  });
}

/**
 * From index 0 of every content zone the current screen has registered,
 * press Down until focus stops moving; report where each walk ended.
 * `library-subnav` is left out: focusing it switches the Library tab, so its
 * walk has its own test.
 */
async function walkEveryZone(page: Page, label: string) {
  const zones: string[] = await page.evaluate((skip) =>
    FocusManager._debugZones().filter((z) => skip.indexOf(z) < 0 && z !== 'library-subnav'), SKIP_ZONES);
  const out: { state: string; zone: string; end: string | null; index: number; open: boolean; visible: boolean }[] = [];
  for (const z of zones) {
    await page.evaluate((zone) => FocusManager.setActiveZone(zone, 0, true), z);
    await H.settle(page, 30);
    const walk = await H.downWalk(page, 80, 15);
    const last = walk.steps[walk.steps.length - 1];
    out.push({ state: label, zone: z, end: last.zone, index: last.index, open: await onBarOpen(page), visible: last.visible });
  }
  return out;
}

function failures(results: { end: string | null; index: number; open: boolean; visible: boolean }[]) {
  return results.filter((r) => !(r.end === 'nowplaying-bar' && r.index === 0 && r.open && r.visible));
}

async function bootWithTrack(page: Page, opts: Record<string, unknown> = {}) {
  await H.bootMock(page, Object.assign({ albums: 30, artists: 100, songs: 40, libraries: 3 }, opts));
  await H.startTrack(page, 20, { paused: true });
}

test('R9 no track: Down never makes the bar zone active', async ({ page }) => {
  await H.bootMock(page);
  const walk = await H.downWalk(page, 40);
  expect(walk.zones).not.toContain('nowplaying-bar');
});

test('R9 Enter on the bar\'s first target opens Now Playing', async ({ page }) => {
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 5), 2));
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await page.evaluate(() => Player.pause());
  const walk = await H.downWalk(page, 40);
  expect(walk.steps[walk.steps.length - 1]).toMatchObject({ zone: 'nowplaying-bar', index: 0 });
  expect(await onBarOpen(page)).toBe(true);
  await H.press(page, 'Enter');
  await H.settle(page, 400);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  expect(await page.evaluate(() => Player.getState().currentTrack.id)).toBe('song-2');
  // On Now Playing the bar is hidden, so its zone is not a target.
  expect((await H.focus(page)).zone).toBe('np-controls');
});

test('R9 the bar\'s other targets are Previous, Play/Pause and Next', async ({ page }) => {
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 5), 2));
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await page.evaluate(() => Player.pause());
  await H.downWalk(page, 40);
  await H.press(page, 'ArrowRight');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'nowplaying-bar', index: 1 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-1');
  await H.press(page, 'ArrowRight', 2);
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'nowplaying-bar', index: 3 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => Player.getState().currentTrack.id === 'song-2');
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('home');
});

async function toLastLibraryTab(page: Page, withTrack = true) {
  await H.bootMock(page);
  if (withTrack) await H.startTrack(page, 5, { paused: true });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  for (let i = 0; i < 3; i++) {
    await H.press(page, 'ArrowDown');
    await page.waitForTimeout(350);
  }
  expect(await page.evaluate(() => LibraryScreen.getActiveTab())).toBe('genres');
}

test('R9 Library sub-nav: Down on the last tab goes to the bar, and Up comes back', async ({ page }) => {
  await toLastLibraryTab(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect(await H.focus(page)).toMatchObject({ zone: 'nowplaying-bar', index: 0 });
  expect(await onBarOpen(page)).toBe(true);
  // The pill and its label agree: the sub-nav is no longer focused.
  expect(await page.evaluate(() => document.getElementById('library-subnav-pill')!.className)).toContain('selected');
  await H.press(page, 'ArrowUp');
  await H.settle(page, 100);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-subnav', index: 3 });
  expect(await page.evaluate(() => document.getElementById('library-subnav-pill')!.className)).toContain('focused');
});

test('R9 Library sub-nav: with no track, Down on the last tab stays put (no wrap)', async ({ page }) => {
  await toLastLibraryTab(page, false);
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(350);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-subnav', index: 3 });
});

test('R9 Library sub-nav: a fast Down x4 from Albums still reaches the bar', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 5, { paused: true });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  // 90 ms apart: inside the 160 ms tab cross-fade, so the sub-nav's tab
  // state lags the focus. The last-tab test reads the focused index.
  await H.press(page, 'ArrowDown', 4, 90);
  await H.settle(page, 400);
  expect((await H.focus(page)).zone).toBe('nowplaying-bar');
});

// "From every zone on every screen" (R9): each test boots once with a track
// and walks Down from index 0 of every registered content zone.
test('R9 every zone reaches the bar: Home, Playlists grid and detail, Queue, Settings', async ({ page }) => {
  test.setTimeout(120000);
  await bootWithTrack(page);
  const results = await walkEveryZone(page, 'home');
  await H.navTo(page, 'playlists');
  results.push(...await walkEveryZone(page, 'playlists'));
  await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
  await H.press(page, 'Enter');
  await page.waitForTimeout(700);
  results.push(...await walkEveryZone(page, 'playlist-detail'));
  await H.press(page, 'Escape');
  await page.waitForTimeout(700);
  await H.navTo(page, 'queue');
  results.push(...await walkEveryZone(page, 'queue'));
  await H.navTo(page, 'settings');
  results.push(...await walkEveryZone(page, 'settings'));
  test.info().annotations.push({ type: 'walks', description: results.map((r) => r.state + ':' + r.zone + '>' + r.end + '[' + r.index + ']').join(' ') });
  expect(results.length).toBeGreaterThanOrEqual(9);
  expect(failures(results)).toEqual([]);
  // Enter on the target shows Now Playing.
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
});

test('R9 every zone reaches the bar: every Library tab, the sub-nav and genre detail', async ({ page }) => {
  test.setTimeout(120000);
  await bootWithTrack(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  const results = await walkEveryZone(page, 'library-albums');
  for (const tab of ['artists', 'songs', 'genres']) {
    await page.evaluate(() => FocusManager.setActiveZone('library-subnav', undefined, true));
    await H.settle(page, 100);
    await H.press(page, 'ArrowDown');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => LibraryScreen.getActiveTab())).toBe(tab);
    results.push(...await walkEveryZone(page, 'library-' + tab));
  }
  // The sub-nav itself: Down from the first tab walks every tab to the bar.
  await page.evaluate(() => FocusManager.setActiveZone('library-subnav', 0, true));
  await page.waitForTimeout(600);
  const sub = await H.downWalk(page, 10, 400);
  const subLast = sub.steps[sub.steps.length - 1];
  results.push({ state: 'library-subnav', zone: 'library-subnav', end: subLast.zone, index: subLast.index, open: await onBarOpen(page), visible: subLast.visible });
  // Genre detail: Enter on the first genre.
  await page.evaluate(() => FocusManager.setActiveZone('library-subnav', 3, true));
  await page.waitForTimeout(600);
  await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
  await H.press(page, 'Enter');
  await page.waitForTimeout(700);
  results.push(...await walkEveryZone(page, 'genre-detail'));
  test.info().annotations.push({ type: 'walks', description: results.map((r) => r.state + ':' + r.zone + '>' + r.end + '[' + r.index + ']').join(' ') });
  expect(results.length).toBeGreaterThanOrEqual(6);
  expect(failures(results)).toEqual([]);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
});

test('R9 every zone reaches the bar: album, artist, search keyboard and results', async ({ page }) => {
  test.setTimeout(120000);
  await bootWithTrack(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForTimeout(500);
  const results = await walkEveryZone(page, 'album');
  // The artist link in the album's left panel opens the artist.
  await page.evaluate(() => {
    const els = document.querySelectorAll('.album-detail-left .focusable');
    const i = Array.prototype.indexOf.call(els, document.querySelector('.album-detail-artist.focusable'));
    FocusManager.setActiveZone('content', i, true);
  });
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await page.waitForTimeout(900);
  results.push(...await walkEveryZone(page, 'artist'));
  // Back to Library by keyboard (wait out the 300 ms input lock), then Search.
  await H.press(page, 'Escape');
  await page.waitForTimeout(450);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await page.waitForTimeout(450);
  await H.navTo(page, 'search');
  results.push(...await walkEveryZone(page, 'search'));
  // Type "A" (Enter on the first key), then walk the results too.
  await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#search-results-list .focusable').length > 0);
  results.push(...await walkEveryZone(page, 'search-results'));
  test.info().annotations.push({ type: 'walks', description: results.map((r) => r.state + ':' + r.zone + '>' + r.end + '[' + r.index + ']').join(' ') });
  expect(results.map((r) => r.state + ':' + r.zone)).toEqual(expect.arrayContaining([
    'album:content', 'album:album-tracks', 'artist:content', 'artist:artist-albums',
    'search:content', 'search:search-special', 'search-results:search-results']));
  expect(failures(results)).toEqual([]);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
});

// A6 (S6): Now Playing hides the bar, and its Up Next strip is the bottom of
// the screen: from every Now Playing zone a repeated Down ends on Up Next,
// never on the hidden bar, and Up from there is Play (R3).
test('A6 on Now Playing every zone\'s Down walk ends in Up Next, and Up from it is Play', async ({ page }) => {
  await bootWithTrack(page);
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  const zones: string[] = await page.evaluate((skip) =>
    FocusManager._debugZones().filter((z) => skip.indexOf(z) < 0), SKIP_ZONES);
  expect(zones).toEqual(expect.arrayContaining(['np-progress', 'np-controls', 'np-upnext', 'np-credits']));
  const ends: string[] = [];
  for (const z of zones) {
    // np-credits is empty while its panel is closed (its walk is in
    // np-credits.spec.ts).
    if (z === 'np-credits') continue;
    await page.evaluate((zone) => FocusManager.setActiveZone(zone, 0, true), z);
    await H.settle(page, 30);
    const walk = await H.downWalk(page, 20, 15);
    const last = walk.steps[walk.steps.length - 1];
    ends.push(z + '>' + last.zone + '[' + last.index + ']' + (last.visible ? '' : ' INVISIBLE'));
  }
  test.info().annotations.push({ type: 'walks', description: ends.join(' ') });
  expect(ends.length).toBeGreaterThanOrEqual(3);
  for (const e of ends) expect(e).toMatch(/>np-upnext\[\d\]$/);
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

test('R9 Up from the bar returns to the zone and item focus came from', async ({ page }) => {
  await bootWithTrack(page);
  const cases: { label: string; zone: string; index: number }[] = [];
  async function roundTrip(label: string, zone: string, index: number) {
    await page.evaluate(([z, i]) => FocusManager.setActiveZone(z as string, i as number, true), [zone, index]);
    await H.settle(page, 30);
    const from = await H.focus(page);
    const walk = await H.downWalk(page, 80, 15);
    const origin = walk.steps[walk.steps.length - 2];
    expect(walk.steps[walk.steps.length - 1].zone).toBe('nowplaying-bar');
    await H.press(page, 'ArrowRight');   // move along the bar: Up still goes home
    await H.press(page, 'ArrowUp');
    await H.settle(page, 30);
    const back = await H.focus(page);
    cases.push({ label, zone: back.zone || '', index: back.index });
    expect(back.zone, label).toBe(origin.zone);
    expect(back.index, label).toBe(origin.index);
    return from;
  }
  // Home: the second playlist card (an upNeighbour fallback would land on
  // the last card).
  await roundTrip('home-playlists[1]', 'home-playlists', 1);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  const cols = await page.evaluate(() => (window as any).document.querySelectorAll('#library-grid .focusable').length);
  expect(cols).toBeGreaterThan(0);
  await roundTrip('library-grid[2]', 'library-grid', 2);
  await H.navTo(page, 'search');
  await roundTrip('search-special[1]', 'search-special', 1);
  await H.navTo(page, 'settings');
  await roundTrip('settings-actions[0]', 'settings-actions', 0);
  test.info().annotations.push({ type: 'returns', description: JSON.stringify(cases) });
});

test('D78 the bar going away under the focus sends it back up', async ({ page }) => {
  await bootWithTrack(page);
  // S7 (A4): Home's last row is Rediscover now (it was Recently Played's
  // next-but-one, Your Playlists).
  await page.evaluate(() => FocusManager.setActiveZone('home-rediscover', 1, true));
  await H.settle(page, 30);
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 30);
  expect((await H.focus(page)).zone).toBe('nowplaying-bar');
  await page.evaluate(() => Player.clearQueue());
  await H.settle(page, 100);
  const f = await H.focus(page);
  expect(f.zone).not.toBe('nowplaying-bar');
  expect(f.visible).toBe(true);
});

test('D86 the bar appearing under a focused row scrolls the row back into view', async ({ page }) => {
  // Auto Now Playing off (the helper's default), so Enter plays in place and
  // the bar appears under the focus, shrinking the page by its height.
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 300);
  const rows = await page.evaluate(() => document.querySelectorAll('.track-row').length);
  await H.press(page, 'ArrowDown', rows, 60);
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'album-tracks', index: rows - 1 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await page.evaluate(() => Player.pause());
  await H.settle(page, 300);
  const fit = await page.evaluate(() => {
    const row = FocusManager.getCurrentFocused().getBoundingClientRect();
    const pane = document.querySelector('.album-detail-right')!.getBoundingClientRect();
    const bar = document.getElementById('now-playing-bar')!.getBoundingClientRect();
    return { rowBottom: row.bottom, paneBottom: pane.bottom, barTop: bar.top, rowTop: row.top, paneTop: pane.top };
  });
  test.info().annotations.push({ type: 'fit', description: JSON.stringify(fit) });
  expect(fit.rowBottom).toBeLessThanOrEqual(fit.paneBottom + 0.5);
  expect(fit.rowBottom).toBeLessThanOrEqual(fit.barTop);
  expect(fit.rowTop).toBeGreaterThanOrEqual(fit.paneTop - 0.5);
});

// v3.10 S4 (D94, was S3's D85): Back with the bar focused behaves as Back
// from content. Before S4 `goBack` step 4 skipped the bar and fell through to
// the exit dialog.
test('D94 Back on the bar goes to the top nav, not the exit dialog', async ({ page }) => {
  await bootWithTrack(page);
  for (const screen of ['home', 'library']) {
    if (screen !== 'home') {
      await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
      await H.navTo(page, screen);
      await H.press(page, 'ArrowDown');
      await H.settle(page, 300);
    }
    await H.downWalk(page, 80, 15);
    expect(await onBarOpen(page)).toBe(true);
    await H.press(page, 'Escape');
    await H.settle(page, 100);
    const f = await H.focus(page);
    expect(f.zone, screen).toBe('topnav');
    expect(await page.evaluate(() => document.querySelectorAll('.exit-overlay').length), screen).toBe(0);
    expect(await page.evaluate(() => App.getCurrentScreen())).toBe(screen);
  }
});

// D95: Back from a Now Playing opened from the bar returns to the item focus
// went down to the bar from (the bar's D79 origin), as Back from a detail
// returns to its card. Before S4 it landed on the top nav.
test('D95 Back from a Now Playing opened by the bar returns to the item above the bar', async ({ page }) => {
  await bootWithTrack(page);
  const cases: Record<string, unknown> = {};
  // Library: a card two rows down; the walk to the bar passes the last row.
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowRight', 2, 60);
  const walk = await H.downWalk(page, 80, 15);
  const origin = walk.steps[walk.steps.length - 2];
  expect(origin.zone).toBe('library-grid');
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await H.settle(page, 400);
  cases.library = { origin: origin.index, after: await H.focus(page) };
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: origin.index });

  // Home: from its last row (Home's initial focus used to override it).
  // S7 (A4): Rediscover, below Your Playlists, is the last row now.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
  await H.navTo(page, 'home');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await page.evaluate(() => FocusManager.setActiveZone('home-rediscover', 1, true));
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect(await onBarOpen(page)).toBe(true);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'home');
  await H.settle(page, 400);
  cases.home = await H.focus(page);
  test.info().annotations.push({ type: 'returns', description: JSON.stringify(cases) });
  expect(await H.focus(page)).toMatchObject({ zone: 'home-rediscover', index: 1 });
});

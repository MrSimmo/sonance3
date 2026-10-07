import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// A2 (S5): the Albums header (mockup 20): "Albums", an exact count, a Sort
// chip (Name / Artist / Recently added / Year / Most played) and a Filter chip
// (a genre picker, type=byGenre). Every sort pages through the same path as
// Name: with 2+ libraries in scope, an AlbumListCursor whose comparator
// matches the type (name/artist normalised, D24; year numeric; timestamps
// and counts raw, D25), so the merged list is the unscoped order.

const SORTS = ['Name', 'Artist', 'Recently added', 'Year', 'Most played'];

async function openAlbums(page: Page, opts: any) {
  await H.bootMock(page, opts);
  // _albumsAll is module-private (prompt A4 trap): keep the grid instance.
  // The Albums grid is built on the way into Library, after this.
  await page.evaluate(() => {
    const U = (window as any).SonanceUtils;
    const init = U.VirtualGrid.prototype.init;
    U.VirtualGrid.prototype.init = function() {
      if (this.gridClassName && this.gridClassName.indexOf('library-albums-grid') > -1) (window as any).__albumsVG = this;
      return init.apply(this, arguments);
    };
  });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid');
  await H.settle(page, 300);
}

// Page the grid to the end: focus the last loaded card until the loader
// stops growing the list (the band-end and focus triggers, D99), then
// return the ids in grid order.
async function loadAll(page: Page) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => (window as any).__albumsVG.getCount());
    if (n === last) break;
    last = n;
    await page.evaluate((k) => FocusManager.setActiveZone('library-grid', k - 1, true), n);
    await H.settle(page, 120);
  }
  return page.evaluate(() => (window as any).__albumsVG.items.map((a: any) => a.id));
}

// The order the mock serves the unscoped list in (tests/mock-boot.js
// _orderAlbums), over the libraries in scope.
async function expectedIds(page: Page, sort: string, libs: string[]) {
  return page.evaluate(([s, l]) => {
    const all = (window as any).__MOCK__.albums.filter((a: any) => (l as string[]).indexOf(a.musicFolderId) > -1);
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    let out = all.slice();
    if (s === 'Artist') out.sort((a: any, b: any) => cmp(a.artist, b.artist) || cmp(a.name, b.name));
    if (s === 'Recently added') out.reverse();
    if (s === 'Year') out.sort((a: any, b: any) => -((a.year - b.year) || cmp(a.name, b.name)));
    if (s === 'Most played') out = out.filter((a: any) => a.playCount > 0).sort((a: any, b: any) => (b.playCount - a.playCount) || cmp(a.name, b.name));
    return out.map((a: any) => a.id);
  }, [sort, libs] as [string, string[]]);
}

const label = (page: Page, id: string) => page.evaluate((i) => document.querySelector('#' + i + ' .library-chip-label')!.textContent, id);
const countLine = (page: Page) => page.evaluate(() => document.getElementById('library-header-count')!.textContent);

test('A2 header: title, exact count, chips; focus path header <-> grid <-> sub-nav <-> nav', async ({ page }) => {
  await openAlbums(page, { albums: 300 });
  await page.waitForFunction(() => /albums/.test(document.getElementById('library-header-count')!.textContent || ''));
  expect(await countLine(page)).toBe('300 albums');
  expect(await label(page, 'library-chip-sort')).toBe('Sort: Name');
  expect(await label(page, 'library-chip-filter')).toBe('Filter: All genres');
  // Grid row 0 -> Up -> the Sort chip; Right -> Filter; Left x2 -> sub-nav.
  await H.press(page, 'ArrowUp');
  expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-sort' });
  expect(await page.evaluate(() => document.getElementById('library-content')!.scrollTop)).toBe(0);
  await H.press(page, 'ArrowRight');
  expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-filter' });
  await H.press(page, 'ArrowDown');
  expect((await H.focus(page)).zone).toBe('library-grid');
  await H.press(page, 'ArrowUp');
  await H.press(page, 'ArrowLeft');
  await H.press(page, 'ArrowLeft');
  expect((await H.focus(page)).zone).toBe('library-subnav');
  await H.press(page, 'ArrowRight');           // back into the grid
  await H.settle(page, 200);
  expect((await H.focus(page)).zone).toBe('library-grid');
  await H.press(page, 'ArrowUp');
  await H.press(page, 'ArrowUp');              // header -> top nav
  expect((await H.focus(page)).zone).toBe('topnav');
  // With a track, Down from the header goes through the grid to the bar.
  await H.startTrack(page, 1, { paused: true });
  await page.evaluate(() => FocusManager.setActiveZone('library-header', 0, true));
  await H.settle(page, 100);
  const walk = await H.downWalk(page, 120, 20);
  expect(walk.zones[0]).toBe('library-header');
  expect(walk.zones).toContain('library-grid');
  expect(walk.zones[walk.zones.length - 1]).toBe('nowplaying-bar');
});

test('A2: with 3 of 4 libraries each sort reaches the full set, 0 duplicates, in fixture order', async ({ page }) => {
  test.setTimeout(180000);
  const libs = ['1', '2', '3'];
  await openAlbums(page, {
    albums: 1200, libraries: 4,
    storage: { sonance_selected_libraries: JSON.stringify(libs) },
  });
  await H.press(page, 'ArrowUp');              // the Sort chip
  const results: any[] = [];
  for (let s = 0; s < SORTS.length; s++) {
    if (s > 0) {
      await page.evaluate(() => FocusManager.setActiveZone('library-header', 0, true));
      await H.press(page, 'Enter');            // next sort
      await page.waitForFunction(() => FocusManager.hasZone('library-grid'));
      await H.settle(page, 200);
    }
    expect(await label(page, 'library-chip-sort')).toBe('Sort: ' + SORTS[s]);
    const got = await loadAll(page);
    const want = await expectedIds(page, SORTS[s], libs);
    await page.waitForFunction((n) => (document.getElementById('library-header-count')!.textContent || '').indexOf(n) === 0,
      want.length.toLocaleString('en-US'));
    const dup = got.length - new Set(got).size;
    results.push({ sort: SORTS[s], got: got.length, want: want.length, dup, sameOrder: JSON.stringify(got) === JSON.stringify(want) });
  }
  test.info().annotations.push({ type: 'sorts', description: JSON.stringify(results) });
  for (const r of results) {
    expect(r.dup, r.sort).toBe(0);
    expect(r.got, r.sort).toBe(r.want);
    expect(r.sameOrder, r.sort).toBe(true);
  }
  // Wrapped back round to Name on the next press.
  await page.evaluate(() => FocusManager.setActiveZone('library-header', 0, true));
  await H.press(page, 'Enter');
  expect(await label(page, 'library-chip-sort')).toBe('Sort: Name');
});

test('A2 filter: the genre picker, byGenre, the Sort chip dimmed, Back closes the picker, persists for the session', async ({ page }) => {
  await openAlbums(page, { albums: 240 });
  await H.press(page, 'ArrowUp');
  await H.press(page, 'ArrowRight');           // Filter
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-genre-picker');
  await H.settle(page, 100);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.textContent)).toContain('All genres');
  // Up on the first row stays in the picker.
  await H.press(page, 'ArrowUp');
  expect((await H.focus(page)).zone).toBe('library-genre-picker');
  // Back closes it and returns to the Filter chip, still on Library.
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-filter' });
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  expect(await page.evaluate(() => !!document.getElementById('library-genre-picker'))).toBe(false);
  // Pick Rock (the genres are listed by name).
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-genre-picker');
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.genre-pick-name')).map((n) => n.textContent));
  const rockAt = names.indexOf('Rock');
  expect(rockAt).toBeGreaterThan(0);
  for (let i = 0; i < rockAt; i++) await H.press(page, 'ArrowDown', 1, 40);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.textContent)).toContain('Rock');
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.hasZone('library-grid'));
  await H.settle(page, 200);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-filter' });
  expect(await label(page, 'library-chip-filter')).toBe('Filter: Rock');
  expect(await page.evaluate(() => document.getElementById('library-chip-sort')!.classList.contains('is-unavailable'))).toBe(true);
  const rock = await page.evaluate(() => (window as any).__MOCK__.albums.filter((a: any) => a.genre === 'Rock').map((a: any) => a.id));
  await page.waitForFunction(() => /Rock/.test(document.getElementById('library-header-count')!.textContent || ''));
  expect(await countLine(page)).toBe(rock.length + ' albums · Rock');
  expect(await loadAll(page)).toEqual(rock);
  // Sort does nothing under a filter.
  await page.evaluate(() => FocusManager.setActiveZone('library-header', 0, true));
  await H.press(page, 'Enter');
  await H.settle(page, 200);
  expect(await label(page, 'library-chip-sort')).toBe('Sort: Name');
  // Leave Library and come back: the filter is kept for the session.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
  await H.navTo(page, 'home');
  await H.navTo(page, 'library');
  await page.waitForFunction(() => !!document.getElementById('library-chip-filter'));
  expect(await label(page, 'library-chip-filter')).toBe('Filter: Rock');
});

// S5 (found in S4): Back from a playlist's detail returns to that playlist's
// card in the grid (it went to the first card).
test('Back from playlist detail lands on the card that was opened', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'ArrowRight', 2, 80);   // the third playlist
  const opened = await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-playlist-id'));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#playlist-songs .song-row.focused'));
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await page.waitForFunction(() => !!document.querySelector('#playlists-grid .focused'));
  await page.waitForTimeout(400);
  const f = await H.focus(page);
  expect(f.zone).toBe('content');
  expect(f.index).toBe(2);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-playlist-id'))).toBe(opened);
});


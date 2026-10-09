import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.12 R3 (ticket-3.12 §6): the Artists tab gets the Albums header: a title,
// the count, and a Sort chip cycling Name (the server's order) → Most albums
// (album count descending, ties in the server's order) → Random (shuffled
// once, re-rolled each time it is chosen). Kept for the session; both
// render paths (chunked up to 80 artists, virtual above) honour it.
// mockArtistAlbumCounts=1 gives the fixtures album counts 1-9.

async function openArtists(page: Page, opts: any) {
  await H.bootMock(page, Object.assign({ extra: 'mockArtistAlbumCounts=1' }, opts));
  await page.evaluate(() => {
    const U = (window as any).SonanceUtils;
    const init = U.VirtualGrid.prototype.init;
    U.VirtualGrid.prototype.init = function() {
      if (this.gridClassName && this.gridClassName.indexOf('library-artists-grid') > -1) (window as any).__artistsVG = this;
      return init.apply(this, arguments);
    };
  });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown'); await H.settle(page, 250);      // the Albums grid
  await H.press(page, 'ArrowLeft'); await H.settle(page, 100);      // the sub-nav
  await H.press(page, 'ArrowDown'); await page.waitForTimeout(400); // Artists
  await page.waitForFunction(() => FocusManager.hasZone('library-grid'));
  await H.press(page, 'ArrowRight'); await H.settle(page, 200);     // the first artist
  expect((await H.focus(page)).zone).toBe('library-grid');
}

// The grid's artists in order: the VirtualGrid's items, or the cards.
const gridIds = (page: Page): Promise<string[]> => page.evaluate(() => {
  if (document.querySelector('.library-artists-virtual-mount')) return (window as any).__artistsVG.items.map((a: any) => a.id);
  return Array.prototype.map.call(document.querySelectorAll('#library-grid .artist-grid-card'),
    (c: HTMLElement) => c.getAttribute('data-artist-id'));
});
const sortLabel = (page: Page) => page.evaluate(() => {
  const l = document.querySelector('#library-chip-artist-sort .library-chip-label');
  return l ? l.textContent : null;
});
const header = (page: Page) => page.evaluate(() => {
  const h = document.getElementById('library-header');
  return h ? { title: h.querySelector('.library-header-title')!.textContent, count: h.querySelector('.library-header-count')!.textContent } : null;
});

// The orders, from the fixtures: Name is the server's (fixture) order.
const orders = (page: Page) => page.evaluate(() => {
  const A = (window as any).__MOCK__.artists.map((a: any, i: number) => ({ id: a.id, n: a.albumCount, i }));
  return {
    name: A.map((a: any) => a.id),
    albums: A.slice().sort((x: any, y: any) => (y.n - x.n) || (x.i - y.i)).map((a: any) => a.id),
  };
});

// Enter on the chip (focus on it), waiting for the grid to be rebuilt.
async function nextSort(page: Page) {
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.hasZone('library-grid'));
  await H.settle(page, 200);
}

for (const [path, n] of [['chunked', 40], ['virtual', 120]] as [string, number][]) {
  test(`R3 Artists (${path}, ${n}): header, the three orders, focus paths`, async ({ page }) => {
    const errors = H.watchErrors(page);
    await openArtists(page, { artists: n });
    expect(await header(page)).toEqual({ title: 'Artists', count: n + ' artists' });
    expect(await sortLabel(page)).toBe('Sort: Name');
    const want = await orders(page);
    expect(await gridIds(page)).toEqual(want.name);

    // Focus: Up from the first row reaches the chip; Down returns to the
    // grid; Left from the chip goes to the sub-nav; Up from it to the top nav.
    await H.press(page, 'ArrowUp');
    expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-artist-sort' });
    await H.press(page, 'ArrowDown');
    expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: 0 });
    await H.press(page, 'ArrowUp');
    await H.press(page, 'ArrowLeft');
    expect((await H.focus(page)).zone).toBe('library-subnav');
    await H.press(page, 'ArrowRight');
    await H.settle(page, 200);
    expect((await H.focus(page)).zone).toBe('library-grid');
    await H.press(page, 'ArrowUp');
    await H.press(page, 'ArrowUp');
    expect((await H.focus(page)).zone).toBe('topnav');
    await H.press(page, 'ArrowDown');                  // back into Library's content
    await page.evaluate(() => FocusManager.setActiveZone('library-header', 0, true));
    await H.settle(page, 100);

    await nextSort(page);
    expect(await sortLabel(page)).toBe('Sort: Most albums');
    expect(await H.focus(page)).toMatchObject({ zone: 'library-header', id: 'library-chip-artist-sort' });
    expect(await gridIds(page)).toEqual(want.albums);

    await nextSort(page);
    expect(await sortLabel(page)).toBe('Sort: Random');
    const r1 = await gridIds(page);
    expect(r1.slice().sort()).toEqual(want.name.slice().sort());
    expect(r1).not.toEqual(want.name);
    expect(await header(page)).toEqual({ title: 'Artists', count: n + ' artists' });

    await nextSort(page);
    expect(await sortLabel(page)).toBe('Sort: Name');
    expect(await gridIds(page)).toEqual(want.name);

    // Random chosen again: a new shuffle.
    await nextSort(page);
    await nextSort(page);
    expect(await sortLabel(page)).toBe('Sort: Random');
    const r2 = await gridIds(page);
    expect(r2.slice().sort()).toEqual(want.name.slice().sort());
    expect(r2).not.toEqual(r1);
    expect(errors.pageErrors).toEqual([]);
  });
}

test('R3 Artists: Back from an artist restores the same artist under Random; the order holds for the session', async ({ page }) => {
  await openArtists(page, { artists: 120 });
  await H.press(page, 'ArrowUp');
  await nextSort(page);
  await nextSort(page);
  expect(await sortLabel(page)).toBe('Sort: Random');
  const order = await gridIds(page);
  await H.press(page, 'ArrowDown');                    // the grid
  await H.press(page, 'ArrowRight', 2, 60);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  const at = await H.focus(page);
  const id = await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-artist-id'));
  expect(at.zone).toBe('library-grid');
  expect(id).toBe(order[at.index]);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid' &&
    !!FocusManager.getCurrentFocused() && !!FocusManager.getCurrentFocused()!.getAttribute('data-artist-id'));
  await H.settle(page, 300);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: at.index });
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-artist-id'))).toBe(id);
  expect(await sortLabel(page)).toBe('Sort: Random');
  expect(await gridIds(page)).toEqual(order);
  // Leave Library and come back: still Random, the same order.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
  await H.navTo(page, 'home');
  await H.navTo(page, 'library');
  await page.waitForFunction(() => FocusManager.hasZone('library-grid') && !!document.getElementById('library-chip-artist-sort'));
  await H.settle(page, 200);
  expect(await sortLabel(page)).toBe('Sort: Random');
  expect(await gridIds(page)).toEqual(order);
});

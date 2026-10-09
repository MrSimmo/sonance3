import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.12 R2 (ticket-3.12 §6): Random on the Albums Sort chip. One
// getAlbumList2 type=random&size=500 (the server's maximum) per library in
// scope, merged, shuffled and capped at 500. It is a sample, not a paged
// list: no AlbumListCursor, no offset, no offset-search count (D23 is about
// paging; D177). The sample stays the list until Random is chosen again.

async function openAlbums(page: Page, opts: any) {
  await H.bootMock(page, opts);
  // _albumsAll is module-private: keep the Albums grid's VirtualGrid.
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

const sortLabel = (page: Page) => page.evaluate(() => document.querySelector('#library-chip-sort .library-chip-label')!.textContent);
const countLine = (page: Page) => page.evaluate(() => document.getElementById('library-header-count')!.textContent);
const gridIds = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__albumsVG.items.map((a: any) => a.id));
const listCalls = (page: Page): Promise<any[]> => page.evaluate(() =>
  (window as any).__MOCK__.calls.filter((c: any) => c.endpoint === 'getAlbumList2').map((c: any) => ({ type: c.type, size: c.size, offset: c.offset, folder: c.folder })));

// Enter on the Sort chip (focus is on it) until it reads `want`, waiting for
// each list to be built.
async function sortTo(page: Page, want: string) {
  for (let i = 0; i < 8 && (await sortLabel(page)) !== 'Sort: ' + want; i++) {
    await H.press(page, 'Enter');
    await page.waitForFunction(() => FocusManager.hasZone('library-grid'));
    await H.settle(page, 150);
  }
  expect(await sortLabel(page)).toBe('Sort: ' + want);
}

// The mock's answer to one getAlbumList2 type=random request (deterministic).
// It goes through the mock like the app's own requests, so it is counted.
let probes = 0;
const mockRandom = (page: Page, folder: string | null) => (probes++, page.evaluate(async (f) => {
  const r = await fetch('/rest/getAlbumList2.view?type=random&size=500&f=json' + (f ? '&musicFolderId=' + f : ''));
  return (await r.json())['subsonic-response'].albumList2.album.map((a: any) => a.id);
}, folder));
// The app's random samples so far (the probes left out).
const appSamples = async (page: Page) =>
  (await listCalls(page)).filter((c) => c.type === 'random' && c.size === '500').length - probes;

test.beforeEach(() => { probes = 0; });

test('R2 Random: one type=random&size=500 request, no paging; the grid shows the sample; Back and leaving keep it; choosing it again re-rolls', async ({ page }) => {
  const errors = H.watchErrors(page);
  await openAlbums(page, { albums: 300 });
  await H.press(page, 'ArrowUp');                    // the Sort chip
  expect((await H.focus(page)).id).toBe('library-chip-sort');
  await sortTo(page, 'Most played');
  const before = (await listCalls(page)).length;
  await sortTo(page, 'Random');
  await page.waitForFunction(() => /Random sample/.test(document.getElementById('library-header-count')!.textContent || ''));
  const calls = (await listCalls(page)).slice(before);
  test.info().annotations.push({ type: 'requests for Random', description: JSON.stringify(calls) });
  expect(calls).toEqual([{ type: 'random', size: '500', offset: null, folder: null }]);
  expect(await countLine(page)).toBe('Random sample of 300 albums');
  const sample = await mockRandom(page, null);
  expect(await gridIds(page)).toEqual(sample);

  // Into the grid, to the card at row 1, column 3, and Back from its album.
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 3, 60);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  const at = await H.focus(page);
  const id = await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-album-id'));
  expect(at.zone).toBe('library-grid');
  expect(at.index).toBeGreaterThan(3);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForTimeout(400);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid' &&
    !!FocusManager.getCurrentFocused() && !!FocusManager.getCurrentFocused()!.getAttribute('data-album-id'));
  await H.settle(page, 300);
  expect(await H.focus(page)).toMatchObject({ zone: 'library-grid', index: at.index });
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-album-id'))).toBe(id);
  expect(await sortLabel(page)).toBe('Sort: Random');
  expect(await gridIds(page)).toEqual(sample);

  // Leave Library and come back: the same sample, no new request.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
  await H.navTo(page, 'home');
  await H.navTo(page, 'library');
  await page.waitForFunction(() => /Random sample/.test(document.getElementById('library-header-count')!.textContent || ''));
  expect(await gridIds(page)).toEqual(sample);
  expect(await appSamples(page)).toBe(1);

  // Random chosen again (round the cycle): a new request.
  await H.press(page, 'ArrowDown');                  // into the grid
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid');
  await H.press(page, 'ArrowUp');                    // the Sort chip
  await sortTo(page, 'Name');
  await sortTo(page, 'Random');
  await page.waitForFunction(() => /Random sample/.test(document.getElementById('library-header-count')!.textContent || ''));
  expect(await appSamples(page)).toBe(2);
  // Never an offset past the first page while on Random.
  expect((await listCalls(page)).filter((c) => c.type === 'random' && c.offset !== null)).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('R2 Random with two of three libraries: one sample each, merged, capped at 500, no duplicates', async ({ page }) => {
  await openAlbums(page, {
    albums: 1200, libraries: 3,
    storage: { sonance_selected_libraries: JSON.stringify(['1', '2']) },
  });
  await H.press(page, 'ArrowUp');
  const before = (await listCalls(page)).length;
  await sortTo(page, 'Random');
  await page.waitForFunction(() => /Random sample/.test(document.getElementById('library-header-count')!.textContent || ''));
  const random = (await listCalls(page)).slice(before).filter((c) => c.type === 'random');
  expect(random.sort((a, b) => (a.folder < b.folder ? -1 : 1))).toEqual([
    { type: 'random', size: '500', offset: null, folder: '1' },
    { type: 'random', size: '500', offset: null, folder: '2' },
  ]);
  const ids = await gridIds(page);
  expect(ids.length).toBe(500);
  expect(new Set(ids).size).toBe(500);
  const inScope = new Set(await page.evaluate(() => (window as any).__MOCK__.albums
    .filter((a: any) => a.musicFolderId === '1' || a.musicFolderId === '2').map((a: any) => a.id)));
  expect(ids.filter((i) => !inScope.has(i))).toEqual([]);
  // Both libraries are in the sample.
  const lib1 = new Set(await mockRandom(page, '1'));
  expect(ids.some((i) => lib1.has(i))).toBe(true);
  expect(ids.some((i) => !lib1.has(i))).toBe(true);
  expect(await countLine(page)).toBe('Random sample of 500 albums');
});

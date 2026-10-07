import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R5 (D57): every track list shows the artist. Album-detail rows carry it
// under the title as `.track-row-artist` (S1 encoded that as a `test.fail`
// target, flipped in S3); playlist-detail rows add a lazy cover thumbnail;
// the other four lists already showed it in their meta line.

async function openFirstAlbum(page: Page) {
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await H.settle(page, 300);
}

// For every row matched by `rowSel`: the artist-bearing element's text and
// rendered height, plus whether the text contains the expected artist.
async function artistCells(page: Page, rowSel: string, cellSel: string) {
  return page.evaluate(([r, c]) =>
    Array.from(document.querySelectorAll(r)).map((row) => {
      const cell = row.querySelector(c) as HTMLElement | null;
      return cell ? { text: (cell.textContent || '').trim(), h: cell.offsetHeight } : null;
    }), [rowSel, cellSel]);
}

function expectArtists(rows: ({ text: string; h: number } | null)[], label: string) {
  expect(rows.length, label + ': rows').toBeGreaterThan(0);
  for (const r of rows) {
    expect(r, label).not.toBeNull();
    expect(r!.text.length, label + ': artist text').toBeGreaterThan(0);
    expect(r!.h, label + ': artist visible').toBeGreaterThan(0);
  }
}

test('R5 every album row shows a visible, non-empty artist under the title', async ({ page }) => {
  await openFirstAlbum(page);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.track-row')).map((r) => {
      const t = r.querySelector('.track-row-title') as HTMLElement;
      const a = r.querySelector('.track-row-artist') as HTMLElement | null;
      return a ? { text: a.textContent!.trim(), h: a.offsetHeight, below: a.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1 } : null;
    }));
  expect(rows.length).toBe(10);
  for (const r of rows) {
    expect(r).not.toBeNull();
    expect(r!.text.length).toBeGreaterThan(0);
    expect(r!.h).toBeGreaterThan(0);
    expect(r!.below).toBe(true);
  }
  // The artist is the track's own (mock: the album artist).
  const first = await page.evaluate(() => document.querySelector('.track-row .track-row-artist')!.textContent);
  expect(first).toMatch(/Artist/);
});

test('R5 all six track lists show the artist', async ({ page }) => {
  test.setTimeout(90000);
  await H.bootMock(page, { songs: 40 });
  await H.startTrack(page, 12, { paused: true });
  const audit: Record<string, number> = {};

  // Queue
  await H.navTo(page, 'queue');
  await page.waitForFunction(() => document.querySelectorAll('.queue-row').length > 0);
  const queue = await artistCells(page, '.queue-row', '.queue-row-artist');
  expectArtists(queue, 'queue'); audit.queue = queue.length;

  // Playlist detail: thumbnail + "artist · album"
  await H.navTo(page, 'playlists');
  const observedOnGrid = await page.evaluate(() => LazyLoader.observedCount());
  await page.evaluate(() => FocusManager.setActiveZone('content', 0, true));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#playlist-songs .song-row').length > 0);
  await page.waitForTimeout(400);
  const pl = await artistCells(page, '#playlist-songs .song-row', '.song-row-meta');
  expectArtists(pl, 'playlist'); audit.playlist = pl.length;
  const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('#playlist-songs .song-row')).map((r) => {
    const art = r.querySelector('.song-row-thumb') as HTMLElement | null;
    const img = art && art.querySelector('img.lazy-art');
    return { art: !!art && art.offsetHeight > 0, lazy: !!img && img.hasAttribute('data-coverart') };
  }));
  expect(thumbs.every((t) => t.art)).toBe(true);
  expect(thumbs.filter((t) => t.lazy).length).toBeGreaterThan(0);
  const observedInDetail = await page.evaluate(() => LazyLoader.observedCount());

  // Back to the grid: the detail's lazy images are released with the
  // zoomContent ghost (D17 teardown), so nothing detached stays observed.
  await H.press(page, 'Escape');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelectorAll('#playlist-songs').length)).toBe(0);
  const observedAfter = await page.evaluate(() => LazyLoader.observedCount());
  test.info().annotations.push({ type: 'observed', description: observedOnGrid + ' -> ' + observedInDetail + ' -> ' + observedAfter });
  expect(observedAfter).toBeLessThanOrEqual(observedOnGrid);

  // Library -> Songs
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'ArrowLeft');
  await H.press(page, 'ArrowDown', 2, 350);
  await page.waitForFunction(() => document.querySelectorAll('.library-song-list .song-row').length > 0);
  // v3.10 A1: the Songs tab row (mockup 16) has the artist in its own
  // column, `.song-row-artist`, not in a meta line.
  const songs = await artistCells(page, '.library-song-list .song-row', '.song-row-meta, .song-row-artist');
  expectArtists(songs, 'songs'); audit.songs = songs.length;

  // Genre songs
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(500);
  await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.library-song-list .song-row').length > 0);
  const genre = await artistCells(page, '.library-song-list .song-row', '.song-row-meta');
  expectArtists(genre, 'genre'); audit.genre = genre.length;

  // Search song results: type "T" on the keyboard (key 19)
  await H.navTo(page, 'search');
  await page.evaluate(() => FocusManager.setActiveZone('content', 19, true));
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.search-result-item[data-type="song"]').length > 0);
  const search = await artistCells(page, '.search-result-item[data-type="song"]', '.search-result-meta');
  expectArtists(search, 'search'); audit.search = search.length;
  const songIds = await page.evaluate(() => Array.from(document.querySelectorAll('.search-result-item[data-type="song"]')).map((r) => r.getAttribute('data-id')));
  const expected = await page.evaluate((ids) => ids.map((id) => {
    const s = (window as any).__MOCK__.songs.find((x: any) => x.id === id);
    return s ? s.artist : null;
  }), songIds);
  for (let i = 0; i < search.length; i++) {
    if (expected[i]) expect(search[i]!.text).toContain(expected[i]);
  }

  test.info().annotations.push({ type: 'rows', description: JSON.stringify(audit) });
});

import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R1.7 (S5): Playlist detail, Queue, Genre songs and Library -> Songs are
// one-column VirtualGrids, so 14,000 rows cost a band of rows, not 14,000.
// A1 (S5): Library -> Songs is the whole library, paged through search3 with
// an empty query (the mock pages it like the server), and a genre's songs
// page through getSongsByGenre offsets. Timings (first paint, ms per press at
// CPU 6x) are measured by tests/tools/perf-baseline.js --only lists and
// recorded in docs/perf-baseline.md "v3.10 S5"; this file checks structure,
// integrity and actions.

const N = 14000;

// Which song FocusManager's index i must show, from the fixtures.
//   songs / playlist: every song in fixture order;
//   queue: the up-next list after starting song 0 (song i + 1);
//   genre:Rock: the songs whose genre is Rock (every 12th, from 0).
type Kind = 'songs' | 'playlist' | 'queue' | 'genre:Rock';

// Walk the whole list Down then Up with keydown events dispatched to
// document, the listener FocusManager uses (keyCode is set the way the
// remote's arrives). Checked after every press, synchronously: the zone and
// index advance by one, the focused node is connected, inside the list,
// carries data-vg-index = index, and shows the expected song unless its page
// has not arrived (a .song-row-pending row, allowed here because a held key
// outruns the network). Every 100 presses the walk waits two frames (the
// scroll-follow runs in a rAF) and also requires the node to be inside the
// scroller and, after its page lands, to show the expected song.
async function fullTraversal(page: Page, zone: string, containerSel: string, scrollerSel: string, kind: Kind, count: number) {
  return page.evaluate(async (o) => {
    const songs = (window as any).__MOCK__.songs;
    const expected = (i: number) => {
      if (o.kind === 'queue') return songs[i + 1].id;
      if (o.kind === 'genre:Rock') return songs[i * 12].id;
      return songs[i].id;
    };
    const key = (code: number) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'keyCode', { get: () => code });
      document.dispatchEvent(e);
    };
    const frames = (n: number) => new Promise<void>((r) => {
      const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
    // R1.8: with smooth scrolling on, wait for the scroll animation to end
    // (no scroll event for three frames, at most 1 s).
    const scrollQuiet = () => new Promise<void>((r) => {
      let quiet = 0;
      const t0 = performance.now();
      const onScroll = () => { quiet = 0; };
      document.addEventListener('scroll', onScroll, true);
      const tick = () => {
        if (++quiet >= 3 || performance.now() - t0 > 1000) {
          document.removeEventListener('scroll', onScroll, true);
          r();
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const fails: any[] = [];
    let pendingSeen = 0, viewChecks = 0, maxEls = 0;
    const check = async (i: number, deep: boolean) => {
      const snap = FocusManager.snapshot();
      let f = FocusManager.getCurrentFocused() as HTMLElement | null;
      if (snap.zone !== o.zone || snap.index !== i) { fails.push({ i, why: 'index', snap }); return; }
      if (!f || !f.isConnected || !f.closest(o.containerSel)) { fails.push({ i, why: 'node' }); return; }
      if (f.getAttribute('data-vg-index') !== String(i)) { fails.push({ i, why: 'vg-index', got: f.getAttribute('data-vg-index') }); return; }
      if (deep) {
        await frames(2);
        await scrollQuiet();
        for (let w = 0; w < 50 && f && f.classList.contains('song-row-pending'); w++) {
          await new Promise((r) => setTimeout(r, 20));
          f = FocusManager.getCurrentFocused() as HTMLElement | null;
        }
        if (!f) { fails.push({ i, why: 'lost' }); return; }
        const r = f.getBoundingClientRect(), s = document.querySelector(o.scrollerSel)!.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2, half = f.offsetHeight / 2;
        viewChecks++;
        if (cy - half < s.top - 1 || cy + half > s.bottom + 1) fails.push({ i, why: 'view' });
        maxEls = Math.max(maxEls, document.querySelectorAll('#app *').length);
      }
      if (f.classList.contains('song-row-pending')) { pendingSeen++; return; }
      if (f.getAttribute('data-song-id') !== expected(i)) fails.push({ i, why: 'song', got: f.getAttribute('data-song-id'), want: expected(i) });
    };
    for (let i = 0; i < o.count - 1; i++) {
      key(40);
      await check(i + 1, (i + 1) % 100 === 0 || i + 1 === o.count - 1);
    }
    for (let i = o.count - 1; i > 0; i--) {
      key(38);
      await check(i - 1, (i - 1) % 100 === 0 || i - 1 === 0);
    }
    return { fails: fails.length, firstFails: fails.slice(0, 5), pendingSeen, viewChecks, maxEls };
  }, { zone, containerSel, scrollerSel, kind, count });
}

const els = (page: Page) => page.evaluate(() => document.querySelectorAll('#app *').length);

async function openSongs(page: Page, songs: number) {
  await H.bootMock(page, { songs, albums: 60 });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');            // sub-nav
  await H.press(page, 'ArrowDown', 2, 90);     // Songs
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');           // into the list
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid' &&
    !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 10000 });
  await H.settle(page, 100);
}

async function openPlaylist(page: Page, songs: number) {
  await H.bootMock(page, { songs, albums: 60 });
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'content' &&
    !!document.querySelector('#playlist-songs .song-row.focused'), null, { timeout: 10000 });
  await H.settle(page, 300);
}

async function openQueue(page: Page, songs: number) {
  await H.bootMock(page, { songs, albums: 60 });
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs, 0); Player.pause(); });
  await H.navTo(page, 'queue');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'queue-list', null, { timeout: 10000 });
  await H.settle(page, 200);
}

test.describe('R1.7 virtual lists at 14,000 rows', () => {
  test.setTimeout(240000);

  test('Library Songs (A1): reports 14,000, <= 1,500 elements, full traversal clean', async ({ page }) => {
    await openSongs(page, N);
    const head = await page.evaluate(() => document.getElementById('library-header-count')!.textContent);
    expect(head).toBe('14,000 songs');
    expect(await els(page)).toBeLessThanOrEqual(1500);
    const t = await fullTraversal(page, 'library-grid', '#library-grid', '#library-content', 'songs', N);
    test.info().annotations.push({ type: 'traversal', description: JSON.stringify(t) });
    expect(t.fails).toBe(0);
    expect(t.maxEls).toBeLessThanOrEqual(1500);
  });

  test('Playlist detail: <= 1,500 elements, full traversal clean, Enter and Yellow hit the focused track', async ({ page }) => {
    await openPlaylist(page, N);
    expect(await els(page)).toBeLessThanOrEqual(1500);
    const t = await fullTraversal(page, 'content', '#playlist-songs', '.playlist-detail-screen', 'playlist', N);
    test.info().annotations.push({ type: 'traversal', description: JSON.stringify(t) });
    expect(t.fails).toBe(0);
    expect(t.maxEls).toBeLessThanOrEqual(1500);
    // Deep in the list: real presses, then Yellow (add to queue) and Enter.
    await page.evaluate(() => FocusManager.setActiveZone('content', 9000, true));
    await H.settle(page, 200);
    await H.press(page, 'ArrowDown', 3, 60);
    await H.settle(page, 200);
    const want = await page.evaluate(() => (window as any).__MOCK__.songs[9003].id);
    expect((await H.focus(page)).index).toBe(9003);
    await H.press(page, 'y');
    await H.settle(page, 100);
    const queued = await page.evaluate(() => { const q = Player.getState().queue; return q.length ? q[q.length - 1].id : null; });
    expect(queued).toBe(want);
    await H.press(page, 'Enter');
    await page.waitForFunction(() => !!Player.getState().currentTrack);
    const st = await page.evaluate(() => ({ id: Player.getState().currentTrack.id, idx: Player.getState().queueIndex }));
    expect(st).toEqual({ id: want, idx: 9003 });
  });

  test('Queue: <= 1,500 elements, full traversal clean, Enter jumps and Red removes the focused track', async ({ page }) => {
    await openQueue(page, N);
    expect(await els(page)).toBeLessThanOrEqual(1500);
    const t = await fullTraversal(page, 'queue-list', '#queue-list', '.queue-right', 'queue', N - 1);
    test.info().annotations.push({ type: 'traversal', description: JSON.stringify(t) });
    expect(t.fails).toBe(0);
    expect(t.maxEls).toBeLessThanOrEqual(1500);
    await page.evaluate(() => FocusManager.setActiveZone('queue-list', 12000, true));
    await H.settle(page, 200);
    await H.press(page, 'ArrowDown', 2, 60);
    await H.settle(page, 200);
    // Red removes the focused row's track (song 12003: up-next index 12002).
    const removed = await page.evaluate(() => (window as any).__MOCK__.songs[12003].id);
    await H.press(page, 'r');
    await H.settle(page, 200);
    const after = await page.evaluate((id) => ({
      len: Player.getState().queue.length,
      still: Player.getState().queue.some((s: any) => s.id === id),
    }), removed);
    expect(after).toEqual({ len: N - 1, still: false });
    // Enter on up-next index 12002 now plays song 12004.
    const f = await H.focus(page);
    expect(f.zone).toBe('queue-list');
    expect(f.index).toBe(12002);
    await H.press(page, 'Enter');
    await H.settle(page, 200);
    const cur = await page.evaluate(() => Player.getState().currentTrack.id);
    expect(cur).toBe(await page.evaluate(() => (window as any).__MOCK__.songs[12004].id));
  });
});

test.describe('A1 complete Songs list', () => {
  test.setTimeout(120000);

  test('a walk across 3 page boundaries: 0 duplicates, 0 gaps', async ({ page }) => {
    await openSongs(page, N);
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 90, true));
    await H.settle(page, 300);
    const seen: string[] = [];
    let gaps = 0;
    for (let i = 0; i < 230; i++) {                    // 90 -> 320: pages 1, 2, 3 start at 100, 200, 300
      await H.press(page, 'ArrowDown');
      await H.settle(page, 0);
      await page.waitForFunction(() => {
        const f = FocusManager.getCurrentFocused();
        return !!f && !f.classList.contains('song-row-pending');
      }, null, { timeout: 5000 });
      const r = await page.evaluate(() => ({
        idx: FocusManager.snapshot().index,
        id: FocusManager.getCurrentFocused()!.getAttribute('data-song-id'),
      }));
      const want = await page.evaluate((i) => (window as any).__MOCK__.songs[i].id, r.idx);
      if (r.idx !== 91 + i || r.id !== want) gaps++;
      seen.push(r.id!);
    }
    expect(gaps).toBe(0);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test('index 13,990 then Down to the end shows the last 10 songs; Enter plays from there', async ({ page }) => {
    await openSongs(page, N);
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 13990, true));
    await H.settle(page, 300);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForFunction(() => !FocusManager.getCurrentFocused()!.classList.contains('song-row-pending'));
      ids.push((await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-song-id')))!);
      await H.press(page, 'ArrowDown');
      await H.settle(page, 0);
    }
    const last10 = await page.evaluate(() => (window as any).__MOCK__.songs.slice(13990).map((s: any) => s.id));
    expect(ids).toEqual(last10);
    // Down from the last row stays (no track: the bar is not a target).
    expect((await H.focus(page)).index).toBe(13999);
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 13990, true));
    await H.settle(page, 200);
    await H.press(page, 'Enter');
    await page.waitForFunction(() => !!Player.getState().currentTrack);
    const q = await page.evaluate(() => ({ cur: Player.getState().currentTrack.id, len: Player.getState().queue.length }));
    expect(q).toEqual({ cur: last10[0], len: 10 });
  });

  test('Up from the first row reaches the header; Shuffle all queues 200 random songs', async ({ page }) => {
    await openSongs(page, 600);
    await H.press(page, 'ArrowUp');
    const f = await H.focus(page);
    expect(f.zone).toBe('library-header');
    expect(f.id).toBe('library-chip-shuffle');
    await H.press(page, 'ArrowDown');
    expect((await H.focus(page)).zone).toBe('library-grid');
    await H.press(page, 'ArrowUp');
    await H.press(page, 'Enter');
    await page.waitForFunction(() => Player.getState().queue.length > 0);
    expect(await page.evaluate(() => Player.getState().queue.length)).toBe(200);
  });

  test('genre detail pages by offset: every Rock song, Enter opens the right album', async ({ page }) => {
    await H.bootMock(page, { songs: N, albums: 60 });
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown');
    await H.settle(page, 300);
    await H.press(page, 'ArrowLeft');
    await H.press(page, 'ArrowDown', 3, 90);     // Genres
    await page.waitForTimeout(450);
    await H.press(page, 'ArrowRight');           // Rock is the first card
    await page.waitForFunction(() => !!document.querySelector('.genre-card.focused'));
    await H.press(page, 'Enter');
    await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 10000 });
    await H.settle(page, 400);
    const rock = Math.ceil(N / 12);              // songs 0, 12, 24, ...
    const head = await page.evaluate(() => document.querySelector('.genre-songs-header .library-header-count')!.textContent);
    expect(head).toBe(rock.toLocaleString('en-US') + ' songs');
    const t = await fullTraversal(page, 'library-grid', '#library-grid', '#library-content', 'genre:Rock', rock);
    test.info().annotations.push({ type: 'traversal', description: JSON.stringify(t) });
    expect(t.fails).toBe(0);
    await page.evaluate(() => FocusManager.setActiveZone('library-grid', 500, true));
    await H.settle(page, 400);
    const albumId = await page.evaluate(() => (window as any).__MOCK__.songs[500 * 12].albumId);
    await H.press(page, 'Enter');
    await H.waitForScreen(page, 'album');
    // The album screen shows the album the song belongs to.
    const got = await page.evaluate(() => document.querySelector('.album-detail-title')!.textContent);
    const want = await page.evaluate((id) => (window as any).__MOCK__.albums.filter((a: any) => a.id === id)[0].name, albumId);
    expect(got).toBe(want);
  });
});

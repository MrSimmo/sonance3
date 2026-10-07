import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.10 A5 (ticket §7 A5, mockup 17): hold OK on a track row for the options
// sheet. Key sequences go through CDP Input.dispatchKeyEvent, so a test can
// send a keydown with no keyup, or auto-repeats, as a TV platform would
// (Playwright's keyboard always pairs them).

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'v3-10');

async function keys(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat
  } as any);
  return {
    down: () => send('keyDown'),
    repeat: () => send('keyDown', true),
    up: () => send('keyUp'),
    // Holds OK for `ms`, auto-repeating every `every` ms (0 = no repeats).
    async hold(ms: number, every: number) {
      await send('keyDown');
      const t0 = Date.now();
      while (every && Date.now() - t0 < ms - every) {
        await page.waitForTimeout(every);
        await send('keyDown', true);
      }
      const left = ms - (Date.now() - t0);
      if (left > 0) await page.waitForTimeout(left);
      await send('keyUp');
    }
  };
}

// When the sheet appears and when OK went down, on the page's clock.
async function sheetClock(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__downAt = null; w.__sheetAt = null;
    if (!w.__sheetClock) {
      w.__sheetClock = true;
      document.addEventListener('keydown', (e: KeyboardEvent) => { if (e.keyCode === 13 && !e.repeat && w.__downAt === null) w.__downAt = performance.now(); }, true);
      new MutationObserver(() => {
        if (w.__sheetAt === null && document.getElementById('options-sheet')) w.__sheetAt = performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    }
  });
}
const openedAfter = (page: Page) => page.evaluate(() => {
  const w = window as any;
  return w.__sheetAt === null ? null : Math.round(w.__sheetAt - w.__downAt);
});

const sheetItems = (page: Page) => page.evaluate(() => Array.prototype.map.call(
  document.querySelectorAll('#options-sheet .options-sheet-item'), (e: HTMLElement) => e.getAttribute('data-action')));

const state = (page: Page) => page.evaluate(() => {
  const s = Player.getState();
  return {
    open: OptionsSheet.isOpen(),
    zone: FocusManager.getActiveZone(),
    index: (FocusManager.snapshot() || {}).index,
    track: s.currentTrack ? s.currentTrack.id : null,
    queue: s.queue.map((t: any) => t.id)
  };
});

// Home -> Recently Added card `card` -> its album; focus on the first track.
// Newest first: card 0 is album-13 (artist-3: 3 similar songs, no radio),
// card 3 is album-10 (artist-0: 12 similar songs, radio).
async function openAlbum(page: Page, card: number) {
  await page.evaluate((i) => FocusManager.setActiveZone('home-newest', i, true), card);
  await H.settle(page, 100);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
  await H.settle(page, 300);
}

async function choose(page: Page, action: string) {
  const items = await sheetItems(page);
  const target = items.indexOf(action);
  expect(target, action + ' in ' + items.join(',')).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < target; i++) { await H.press(page, 'ArrowDown'); await H.settle(page, 20); }
  expect(await page.evaluate(() => FocusManager.getCurrentFocused().getAttribute('data-action'))).toBe(action);
  await H.press(page, 'Enter');
  await H.settle(page, 150);
}

test('A5 a short press plays, on keyup rather than keydown', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  const k = await keys(page);
  await k.down();
  await page.waitForTimeout(150);
  expect((await state(page)).track).toBe(null);           // nothing yet
  await k.up();
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  const s = await state(page);
  expect(s.track).toBe('song-album-13-0');
  expect(s.open).toBe(false);
});

test('A5 a hold with auto-repeat opens the sheet at 500 ms; its repeats and keyup are swallowed', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  await sheetClock(page);
  const k = await keys(page);
  await k.hold(1100, 40);                                  // repeats from the first 40 ms
  await H.settle(page, 100);
  const after = await openedAfter(page);
  test.info().annotations.push({ type: 'opened after', description: after + ' ms' });
  expect(after).toBeGreaterThanOrEqual(490);
  expect(after).toBeLessThan(650);
  const s = await state(page);
  expect(s).toMatchObject({ open: true, zone: 'options-sheet', index: 0, track: null });
  // The repeats after it opened did not run "Play next" (the first action).
  expect(s.queue).toEqual([]);
  expect(await sheetItems(page)).toEqual(['play-next', 'add-to-queue', 'favourite', 'album', 'artist', 'credits']);
  await page.screenshot({ path: path.join(SHOTS, 's7-options-sheet-150.png') });
});

test('A5 a hold with no repeats opens on release, after 500 ms', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  await sheetClock(page);
  const k = await keys(page);
  await k.down();
  await page.waitForTimeout(800);
  expect(await openedAfter(page)).toBe(null);              // not before the release
  await k.up();
  await H.settle(page, 100);
  expect(await openedAfter(page)).toBeGreaterThanOrEqual(780);
  expect(await state(page)).toMatchObject({ open: true, track: null });
});

test('A5 no keyup and no repeats by 1,200 ms is a normal activation; the late keyup does nothing', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  await sheetClock(page);
  const k = await keys(page);
  await k.down();
  await page.waitForTimeout(1050);
  expect((await state(page)).track).toBe(null);
  await page.waitForFunction(() => !!Player.getState().currentTrack, null, { timeout: 2000 });
  expect(await state(page)).toMatchObject({ open: false, track: 'song-album-13-0' });
  await k.up();                                            // the platform's keyup comes after all
  await H.settle(page, 200);
  expect(await state(page)).toMatchObject({ open: false, track: 'song-album-13-0' });
  expect(await openedAfter(page)).toBe(null);
});

test('A5 a repeating hold with no keyup still opens at 500 ms; a fresh press afterwards is a press', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  const k = await keys(page);
  await k.down();
  for (let i = 0; i < 14; i++) { await page.waitForTimeout(40); await k.repeat(); }
  await H.settle(page, 100);
  expect(await state(page)).toMatchObject({ open: true, track: null, queue: [] });
  // A new press (no repeat flag, after a gap) on the sheet runs its action.
  await page.waitForTimeout(300);
  await k.down();
  await k.up();
  await H.settle(page, 200);
  expect(await state(page)).toMatchObject({ open: false, zone: 'album-tracks', index: 0 });
});

test('A5 zones without onLongPress keep OK on keydown (a Home card, a Settings row, the top nav)', async ({ page }) => {
  await H.bootMock(page);
  const k = await keys(page);
  await page.evaluate(() => FocusManager.setActiveZone('home-newest', 0, true));
  await H.settle(page, 100);
  await k.down();                                          // no keyup
  await page.waitForFunction(() => App.getCurrentScreen() === 'album', null, { timeout: 300 });
  await k.up();
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'home');
  await H.settle(page, 300);
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  for (let i = 0; i < 20 && (await H.focus(page)).id !== 'settings-backdrop-row'; i++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
  }
  await k.down();
  await H.settle(page, 50);
  expect(await page.evaluate(() => document.getElementById('settings-backdrop-value')!.textContent)).toBe('Gradient');
  await k.up();
});

test('A5 Play next, Add to queue, and Back returning to the row', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 3, { paused: true });           // song-0 .. song-2, at song-0
  await openAlbum(page, 0);
  await H.press(page, 'ArrowDown', 2, 40);                 // track 3
  const k = await keys(page);
  await k.hold(700, 40);
  await H.settle(page, 100);
  expect(await page.evaluate(() => !!document.querySelector('#album-tracklist .is-options-origin'))).toBe(true);
  await choose(page, 'play-next');
  let s = await state(page);
  expect(s.queue).toEqual(['song-0', 'song-album-13-2', 'song-1', 'song-2']);
  expect(s).toMatchObject({ open: false, zone: 'album-tracks', index: 2 });
  await k.hold(700, 40);
  await choose(page, 'add-to-queue');
  s = await state(page);
  expect(s.queue[s.queue.length - 1]).toBe('song-album-13-2');
  // Back closes and returns to the row; nothing is left behind.
  await k.hold(700, 40);
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await state(page)).toMatchObject({ open: false, zone: 'album-tracks', index: 2 });
  expect(await page.evaluate(() => ({
    sheet: !!document.getElementById('options-sheet'),
    origin: document.querySelectorAll('.is-options-origin').length,
    zone: FocusManager.hasZone('options-sheet')
  }))).toEqual({ sheet: false, origin: 0, zone: false });
  // Colour buttons on the row still work (yellow: add to queue).
  await H.press(page, 'y');
  await H.settle(page, 100);
  s = await state(page);
  expect(s.queue.filter((id: string) => id === 'song-album-13-2').length).toBe(3);
});

test('A5 Favourite and Unfavourite (mock only, D134): star/unstar, the label and the row star follow', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);
  const k = await keys(page);
  await k.hold(700, 40);
  await choose(page, 'favourite');
  const starIcon = () => page.evaluate(() => document.querySelector('#album-tracklist .track-row[data-song-id="song-album-13-0"] .track-row-star')!.classList.contains('is-starred'));
  expect(await page.evaluate(() => (window as any).__MOCK__.starCalls)).toEqual([{ op: 'star', id: 'song-album-13-0' }]);
  expect(await page.evaluate(() => StarredCache.isSongStarred('song-album-13-0'))).toBe(true);
  expect(await starIcon()).toBe(true);
  await k.hold(700, 40);
  expect(await page.evaluate(() => document.querySelector('[data-action="favourite"]')!.textContent)).toBe('Remove from favourites');
  await choose(page, 'favourite');
  expect(await page.evaluate(() => (window as any).__MOCK__.starCalls)).toEqual([
    { op: 'star', id: 'song-album-13-0' }, { op: 'unstar', id: 'song-album-13-0' }]);
  expect(await page.evaluate(() => StarredCache.isSongStarred('song-album-13-0'))).toBe(false);
  expect(await starIcon()).toBe(false);
});

// Back from the album or artist returns to the row on screens that are
// history entries (Album, Queue). A playlist opened from the Playlists grid is
// an in-screen mode, not one, so Back from an album reached from its rows
// returns to the grid: true of every navigation out of it since v3, reported
// in S7, not changed.
test('A5 Go to artist (from an album) and Go to album (from the Queue); Back returns to the row', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);                                // album-13, artist-3
  await H.press(page, 'ArrowDown', 2, 40);                 // track 3
  const k = await keys(page);
  await k.hold(700, 40);
  await choose(page, 'artist');
  await H.waitForScreen(page, 'artist');
  await page.waitForSelector('#page-current .artist-detail-name');
  expect(await page.evaluate(() => document.querySelector('#page-current .artist-detail-name')!.textContent))
    .toBe(await page.evaluate(() => (window as any).__MOCK__.artists[3].name));
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks' && (FocusManager.snapshot() || {}).index === 2, null, { timeout: 5000 });
  // The Queue: song-3's album is album-3, "Album 04".
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 6), 0); Player.pause(); });
  await H.press(page, 'Escape');                           // album -> Home
  await H.waitForScreen(page, 'home');
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  await H.navTo(page, 'queue');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'queue-list');
  await H.press(page, 'ArrowDown', 2, 40);                 // song-3
  await H.settle(page, 100);
  await k.hold(700, 40);
  await choose(page, 'album');
  await H.waitForScreen(page, 'album');
  expect(await page.evaluate(() => document.querySelector('#page-current .album-detail-title')!.textContent)).toBe('Album 04');
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'queue');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'queue-list' && (FocusManager.snapshot() || {}).index === 2, null, { timeout: 5000 });
});

test('A5 Show credits reuses R7\'s sections; Back goes to the actions, then to the row', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#playlist-songs .song-row.focused'));
  await H.settle(page, 300);
  const k = await keys(page);
  await k.hold(700, 40);                                   // song-0: even, full credits on the mock
  await choose(page, 'credits');
  await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#options-sheet .credits-section'),
    (e: HTMLElement) => e.textContent === 'Writing & production'));
  const view = await page.evaluate(() => ({
    sections: Array.prototype.map.call(document.querySelectorAll('#options-sheet .credits-section'), (e: HTMLElement) => e.textContent),
    zone: FocusManager.getActiveZone(),
    focused: FocusManager.getCurrentFocused().className
  }));
  expect(view.sections).toEqual(['Performance', 'Writing & production', 'Release', 'File', 'Listening']);
  expect(view.zone).toBe('options-sheet');
  // v3.10-fix2 F3 (D154): the body is the view's one stop (it was each
  // credit row, D140); e2e/credits-scroll.spec.ts scrolls it.
  expect(view.focused).toContain('options-sheet-body');
  expect(await page.evaluate(() => document.querySelectorAll('#options-sheet .credit-row.focused').length)).toBe(0);
  await page.screenshot({ path: path.join(SHOTS, 's7-options-credits-150.png') });
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused().getAttribute('data-action'))).toBe('credits');
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await state(page)).toMatchObject({ open: false, zone: 'content', index: 0 });
});

test('A5 Start radio appears only with at least 5 similar songs, and plays the song then them', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page, 0);                                // artist-3: 3 similar songs
  const k = await keys(page);
  await k.hold(700, 40);
  await H.settle(page, 200);
  expect(await sheetItems(page)).not.toContain('radio');
  await H.press(page, 'Escape');
  await H.press(page, 'Escape');                           // back to Home
  await H.waitForScreen(page, 'home');
  await H.settle(page, 300);
  await openAlbum(page, 3);                                // album-10, artist-0: 12 similar songs
  await k.hold(700, 40);
  await page.waitForFunction(() => !!document.querySelector('[data-action="radio"]'));
  expect(await sheetItems(page)).toEqual(['play-next', 'add-to-queue', 'favourite', 'album', 'artist', 'radio', 'credits']);
  await choose(page, 'radio');
  const s = await state(page);
  expect(s.track).toBe('song-album-10-0');
  expect(s.queue.length).toBe(13);
  expect(s.queue[0]).toBe('song-album-10-0');
});

test('A5 a late similar-songs answer adds Start radio without moving the focus; a failed one is asked again', async ({ page }) => {
  await H.bootMock(page, { extra: 'mockSimilarDelay=900&mockSimilarFail=1' });
  await openAlbum(page, 3);                                // album-10, artist-0
  const k = await keys(page);
  // First sheet: the answer fails; no radio, and nothing is remembered.
  await k.hold(700, 40);
  await H.settle(page, 300);
  expect(await sheetItems(page)).not.toContain('radio');
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  // Second sheet: asked again; it answers 900 ms later, with focus moved.
  await k.hold(700, 40);
  await H.press(page, 'ArrowDown', 2, 40);                 // on "favourite"
  expect(await sheetItems(page)).not.toContain('radio');
  await page.waitForFunction(() => !!document.querySelector('[data-action="radio"]'), null, { timeout: 3000 });
  expect(await page.evaluate(() => FocusManager.getCurrentFocused().getAttribute('data-action'))).toBe('favourite');
  expect(await page.evaluate(() => (window as any).__MOCK__.hits.getSimilarSongs2)).toBe(2);
});

// v3.10 S8 follow-up (ticket §11, D150): live, Navidrome once took 26.8 s to
// answer getSimilarSongs2 for an artist it had not seen; at the API's 10 s
// timeout Start radio never appeared. That one call now waits up to 45 s.
test('D150 a similar-songs answer 12 s late still adds Start radio, without moving the focus', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page, { extra: 'mockSimilarDelay=12000' });
  await openAlbum(page, 3);                                // album-10, artist-0: 12 similar songs
  const k = await keys(page);
  await k.hold(700, 40);
  await H.press(page, 'ArrowDown', 2, 40);                 // on "favourite"
  expect(await sheetItems(page)).not.toContain('radio');
  await page.waitForFunction(() => !!document.querySelector('[data-action="radio"]'), null, { timeout: 16000 });
  expect(await page.evaluate(() => FocusManager.getCurrentFocused().getAttribute('data-action'))).toBe('favourite');
});

// The guard for D150's scope: any other request still gives up at 10 s.
// `byYear` is a getAlbumList2 type the app does not ask for at boot.
test('D150 other requests keep the 10 s timeout', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page, { extra: 'mockDelayTypes=byYear&mockDelayMs=11000' });
  const r = await page.evaluate(async () => {
    const t0 = performance.now();
    try {
      await App.getApi()._request('getAlbumList2.view', { type: 'byYear', fromYear: 3000, toYear: 0, size: 1 });
      return { ok: true, ms: performance.now() - t0, msg: '' };
    } catch (e: any) {
      return { ok: false, ms: performance.now() - t0, msg: String(e && e.message) };
    }
  });
  expect(r.ok).toBe(false);
  expect(r.msg).toMatch(/timed out/);
  expect(r.ms).toBeGreaterThan(9500);
  expect(r.ms).toBeLessThan(10900);
});

test('A5 on Queue rows: Play now and Remove from queue', async ({ page }) => {
  await H.bootMock(page);
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 6), 0); Player.pause(); });
  await H.navTo(page, 'queue');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'queue-list');
  await H.settle(page, 200);
  await H.press(page, 'ArrowDown');                        // song-2 (queue index 2)
  await H.settle(page, 100);
  const k = await keys(page);
  await k.hold(700, 40);
  expect(await sheetItems(page)).toEqual(['play-now', 'play-next', 'add-to-queue', 'favourite', 'album', 'artist', 'radio', 'credits', 'remove']);
  await choose(page, 'remove');
  let s = await state(page);
  expect(s.queue).toEqual(['song-0', 'song-1', 'song-3', 'song-4', 'song-5']);
  expect(s).toMatchObject({ open: false, zone: 'queue-list' });
  await k.hold(700, 40);
  await choose(page, 'play-now');
  s = await state(page);
  const playing = await page.evaluate(() => Player.getState().queueIndex);
  expect(s.track).toBe(s.queue[playing]);
  expect(playing).toBeGreaterThan(0);
});

test('A5 every long-press zone opens the sheet: playlist, Songs (a pending row once its page lands), genre songs, Search songs only, Up Next tiles only', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page, { songs: 3000, albums: 60 });
  const k = await keys(page);
  async function holdAndClose(label: string) {
    await k.hold(700, 40);
    await page.waitForFunction(() => OptionsSheet.isOpen(), null, { timeout: 3000 });
    const title = await page.evaluate(() => document.querySelector('#options-sheet .options-sheet-title')!.textContent);
    await H.press(page, 'Escape');
    await H.settle(page, 100);
    expect(await page.evaluate(() => OptionsSheet.isOpen()), label).toBe(false);
    return title;
  }
  // Library -> Songs.
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowLeft');
  await H.press(page, 'ArrowDown', 2, 90);
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');
  await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'));
  await H.settle(page, 100);
  expect(await holdAndClose('songs')).toBe('Track 0001');
  // A row far down whose page is held back 1.2 s: the sheet waits for it.
  await page.evaluate(() => {
    const f = window.fetch;
    (window as any).__mockFetch = f;
    (window as any).fetch = function(u: any, o: any) {
      const p = f.apply(this, arguments as any);
      return /search3/.test(String(u)) ? p.then((r: any) => new Promise((res) => setTimeout(() => res(r), 1200))) : p;
    };
    SubsonicAPI.clearCache();
    FocusManager.setActiveZone('library-grid', 2500, true);
  });
  await H.settle(page, 100);
  expect(await page.evaluate(() => !!document.querySelector('#library-grid .song-row.focused.song-row-pending'))).toBe(true);
  await k.hold(700, 40);
  expect(await page.evaluate(() => OptionsSheet.isOpen())).toBe(false);
  await page.waitForFunction(() => OptionsSheet.isOpen(), null, { timeout: 4000 });
  expect(await page.evaluate(() => document.querySelector('#options-sheet .options-sheet-title')!.textContent)).toBe('Track 2501');
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  // Genres -> Rock's songs: Left to the sub-nav (on Songs), Down to Genres.
  await page.evaluate(() => { (window as any).fetch = (window as any).__mockFetch; });
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');
  await page.waitForFunction(() => !!document.querySelector('.genre-card.focused'), null, { timeout: 5000 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 8000 });
  await H.settle(page, 200);
  expect(await holdAndClose('genre')).toBe('Track 0001');
  // Search: an artist result keeps keydown activation; a song result opens.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 1, true));
  await H.navTo(page, 'search');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown', 2, 80);                 // S
  await H.press(page, 'ArrowRight', 1, 80);                // T
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#search-results-list .focusable').length > 0, null, { timeout: 5000 });
  await H.settle(page, 300);
  const firstSong = await page.evaluate(() => {
    const items = document.querySelectorAll('#search-results-list .search-result-item');
    for (let i = 0; i < items.length; i++) if (items[i].getAttribute('data-type') === 'song') return i;
    return -1;
  });
  expect(firstSong).toBeGreaterThan(0);
  await page.evaluate((i) => FocusManager.setActiveZone('search-results', i, true), firstSong);
  await H.settle(page, 200);
  expect(await holdAndClose('search song')).toBe('Track 0001');
  await page.evaluate(() => FocusManager.setActiveZone('search-results', 0, true));
  await H.settle(page, 200);
  await k.down();                                          // an artist: opens on keydown
  await page.waitForFunction(() => App.getCurrentScreen() === 'artist', null, { timeout: 500 });
  await k.up();
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'search');
  // Now Playing's Up Next: a tile opens it, the sleep chip does not.
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 8), 0); Player.pause(); App.navigateTo('nowplaying'); });
  await H.waitForScreen(page, 'nowplaying');
  await page.waitForFunction(() => FocusManager.hasZone('np-upnext') && document.querySelectorAll('.np-upnext-item').length > 0);
  await page.evaluate(() => FocusManager.setActiveZone('np-upnext', 1, true));
  await H.settle(page, 200);
  expect(await holdAndClose('up next')).toBe('Track 0003');
  await page.evaluate(() => FocusManager.setActiveZone('np-upnext', 5, true));   // the chip
  await H.settle(page, 100);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused().id)).toBe('np-sleep-chip');
  await k.down();
  await H.settle(page, 50);
  expect(await page.evaluate(() => document.getElementById('np-sleep-chip')!.textContent)).toContain('15');
  await k.up();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => OptionsSheet.isOpen())).toBe(false);
});

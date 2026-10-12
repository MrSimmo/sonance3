import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// 3.14 H1–H3 (ticket-3.14 §6, §7.1 H): hold OK must open the options sheet
// whatever key sequence the remote sends while OK is held. The Samsung silver
// remote (BN59-01312, no colour buttons) played the song instead: its hold is
// most likely a keydown followed by release/press pairs (§2.4). Keys go through
// CDP Input.dispatchKeyEvent, so a test can send pairs, a keydown with no keyup
// or flagged auto-repeats (Playwright's keyboard always pairs a down with an up).
//
// Tests marked RED fail on 3.13; the others are guards.

// RELEASE_GRACE_MS in js/focus.js (H1, D207): how long a keyup stays
// provisional on a long-press zone.
const G_MS = 100;

type Kind = 'down' | 'rep' | 'up';
type Ev = [number, Kind];

async function keys(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat
  } as any);
  const one = (k: Kind) => (k === 'down' ? send('keyDown') : k === 'rep' ? send('keyDown', true) : send('keyUp'));
  return {
    down: () => one('down'),
    up: () => one('up'),
    // Sends `events` at their times (ms after the first) on the wall clock.
    async play(events: Ev[]) {
      const t0 = Date.now();
      for (const [at, kind] of events) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
        await one(kind);
      }
    }
  };
}

// An IR-style hold: a keydown, flagged repeats every 40 ms, a keyup at 1.1 s.
function irHold(): Ev[] {
  const ev: Ev[] = [[0, 'down']];
  for (let t = 40; t < 1100; t += 40) ev.push([t, 'rep']);
  ev.push([1100, 'up']);
  return ev;
}

// A keydown, then from `from` every 50 ms a keyup followed 0–10 ms later by a
// keydown (neither flagged), then a final keyup at 1.5 s (§7.1 H).
function pairs(from: number): Ev[] {
  const ev: Ev[] = [[0, 'down']];
  const lag = [0, 5, 10];
  let n = 0;
  for (let t = from; t < 1500; t += 50) {
    ev.push([t, 'up']);
    ev.push([t + lag[n++ % lag.length], 'down']);
  }
  ev.push([1500, 'up']);
  return ev;
}

// Page-side clock: the first Enter keydown, every Enter keyup, the sheet's
// arrival, and every call that plays or queues a song.
async function instrument(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__h = { downAt: null, ups: [], sheetAt: null, calls: [] };
    if (w.__hInstalled) return;
    w.__hInstalled = true;
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.keyCode === 13 && w.__h.downAt === null) w.__h.downAt = performance.now();
    }, true);
    document.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.keyCode === 13) w.__h.ups.push(performance.now());
    }, true);
    new MutationObserver(() => {
      if (w.__h.sheetAt === null && document.getElementById('options-sheet')) w.__h.sheetAt = performance.now();
    }).observe(document.body, { childList: true, subtree: true });
    ['setQueue', 'jumpToQueueIndex', 'addToQueueNext', 'addToQueue'].forEach((name) => {
      const orig = (Player as any)[name];
      (Player as any)[name] = function() {
        w.__h.calls.push({ fn: name, at: performance.now() });
        return orig.apply(this, arguments as any);
      };
    });
  });
}

const clock = (page: Page) => page.evaluate(() => {
  const h = (window as any).__h;
  return {
    openedAfter: h.sheetAt === null ? null : Math.round(h.sheetAt - h.downAt),
    ups: h.ups.map((t: number) => Math.round(t - h.downAt)),
    calls: h.calls.map((c: any) => ({ fn: c.fn, after: Math.round(c.at - h.downAt) }))
  };
});

const state = (page: Page) => page.evaluate(() => ({
  open: OptionsSheet.isOpen(),
  zone: FocusManager.getActiveZone(),
  index: (FocusManager.snapshot() || {}).index,
  action: OptionsSheet.isOpen() ? FocusManager.getCurrentFocused().getAttribute('data-action') : null,
  track: Player.getState().currentTrack ? Player.getState().currentTrack.id : null
}));

// Home -> Recently Added card 0 (album-13) by Enter -> its first track. The
// Enter press (down + up) is the "Enter keyup seen earlier in the session".
async function openAlbum(page: Page) {
  await page.evaluate(() => FocusManager.setActiveZone('home-newest', 0, true));
  await H.settle(page, 100);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
  await H.settle(page, 300);
}

function expectOpenedAtHalfASecond(c: { openedAfter: number | null }) {
  expect(c.openedAfter, 'sheet opened after (ms)').not.toBe(null);
  expect(c.openedAfter!).toBeGreaterThanOrEqual(490);
  expect(c.openedAfter!).toBeLessThan(650);
}

test('H guard: an IR-style hold (flagged repeats every 40 ms, keyup at 1.1 s) opens at ~500 ms and nothing plays', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);
  await instrument(page);
  const k = await keys(page);
  await k.play(irHold());
  await page.waitForTimeout(G_MS + 150);
  const c = await clock(page);
  test.info().annotations.push({ type: 'opened after', description: c.openedAfter + ' ms' });
  expectOpenedAtHalfASecond(c);
  expect(c.calls).toEqual([]);
  expect(await state(page)).toMatchObject({ open: true, zone: 'options-sheet', index: 0, action: 'play-next', track: null });
});

for (const from of [300, 100]) {
  test(`H1 RED: release/press pairs every 50 ms from ${from} ms, keyup at 1.5 s: opens at ~500 ms; nothing plays, no action runs, focus on the first action`, async ({ page }) => {
    await H.bootMock(page);
    await openAlbum(page);
    await instrument(page);
    const k = await keys(page);
    await k.play(pairs(from));
    await page.waitForTimeout(G_MS + 200);
    const c = await clock(page);
    test.info().annotations.push({ type: 'opened after', description: c.openedAfter + ' ms; calls ' + JSON.stringify(c.calls) });
    expectOpenedAtHalfASecond(c);
    expect(c.calls).toEqual([]);
    expect(await state(page)).toMatchObject({ open: true, zone: 'options-sheet', index: 0, action: 'play-next', track: null });
  });
}

test('H2 RED: no repeats and a late keyup (1.5 s), an Enter keyup seen earlier: opens at ~500 ms; the late keyup does nothing', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);                                   // its Enter press delivered a keyup
  await instrument(page);
  const k = await keys(page);
  await k.down();
  await page.waitForTimeout(800);
  const mid = await clock(page);
  expectOpenedAtHalfASecond(mid);
  await page.waitForTimeout(700);
  await k.up();                                            // at ~1.5 s
  await page.waitForTimeout(G_MS + 200);
  const c = await clock(page);
  expect(c.calls).toEqual([]);
  expect(await state(page)).toMatchObject({ open: true, zone: 'options-sheet', index: 0, track: null });
});

test('H2 guard: no Enter keyup ever seen, no repeats, no keyup: the row activates at 1,200 ms', async ({ page }) => {
  await H.bootMock(page);                                  // bootMock presses no key
  const k = await keys(page);
  // To the album with no Enter keyup at all: a Home card opens on keydown.
  await page.evaluate(() => FocusManager.setActiveZone('home-newest', 0, true));
  await H.settle(page, 100);
  await k.down();
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
  await H.settle(page, 300);
  await instrument(page);
  await k.down();                                          // and never a keyup
  await page.waitForTimeout(1050);
  expect((await clock(page)).calls).toEqual([]);
  await page.waitForFunction(() => (window as any).__h.calls.length > 0, null, { timeout: 2000 });
  await page.waitForTimeout(300);
  const c = await clock(page);
  test.info().annotations.push({ type: 'activated after', description: JSON.stringify(c.calls) });
  expect(c.calls.map((x) => x.fn)).toEqual(['setQueue']);
  expect(c.calls[0].after).toBeGreaterThanOrEqual(1190);
  expect(c.calls[0].after).toBeLessThan(1400);
  expect(c.openedAfter).toBe(null);
  expect(await state(page)).toMatchObject({ open: false, track: 'song-album-13-0' });
});

test(`H1 guard and latency: a short press (keyup at 120 ms) activates once, within G + 50 ms of the keyup`, async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);
  await instrument(page);
  const k = await keys(page);
  await k.play([[0, 'down'], [120, 'up']]);
  await page.waitForTimeout(1500);
  const c = await clock(page);
  test.info().annotations.push({ type: 'keyup / activation', description: c.ups.join(',') + ' / ' + JSON.stringify(c.calls) });
  expect(c.calls.map((x) => x.fn)).toEqual(['setQueue']);
  expect(c.calls[0].after - c.ups[0]).toBeLessThanOrEqual(G_MS + 50);
  expect(c.openedAfter).toBe(null);
  expect(await state(page)).toMatchObject({ open: false, track: 'song-album-13-0' });
});

test('H1 guard (documents §8 Q1): a keyup 20 ms after the keydown, then nothing for 1.5 s, is one activation', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);
  await instrument(page);
  const k = await keys(page);
  await k.play([[0, 'down'], [20, 'up']]);
  await page.waitForTimeout(1500);
  const c = await clock(page);
  expect(c.calls.map((x) => x.fn)).toEqual(['setQueue']);
  expect(c.openedAfter).toBe(null);
});

test('H1 guard: a press that starts more than G ms after a keyup is a new press', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);
  await instrument(page);
  const k = await keys(page);
  await k.play([[0, 'down'], [100, 'up'], [100 + G_MS + 60, 'down'], [100 + G_MS + 180, 'up']]);
  await page.waitForTimeout(1500);
  const c = await clock(page);
  test.info().annotations.push({ type: 'calls', description: JSON.stringify(c.calls) });
  expect(c.calls.map((x) => x.fn)).toEqual(['setQueue', 'setQueue']);
  expect(c.openedAfter).toBe(null);
});

test('H3 RED: after a pair-driven open and its release, one fresh press runs the focused action once', async ({ page }) => {
  await H.bootMock(page);
  await openAlbum(page);
  await instrument(page);
  const k = await keys(page);
  await k.play(pairs(300));
  await page.waitForTimeout(G_MS + 200);
  expect(await state(page)).toMatchObject({ open: true, zone: 'options-sheet', index: 0, action: 'play-next' });
  expect((await clock(page)).calls).toEqual([]);
  await k.play([[0, 'down'], [90, 'up']]);                 // a fresh short press on "Play next"
  await page.waitForTimeout(G_MS + 300);
  const c = await clock(page);
  test.info().annotations.push({ type: 'calls', description: JSON.stringify(c.calls) });
  expect(c.calls.map((x) => x.fn)).toEqual(['addToQueueNext']);
  expect(await state(page)).toMatchObject({ open: false, zone: 'album-tracks', index: 0, track: null });
});

test('H guard: zones without onLongPress keep OK on keydown (a Home card, a Settings row)', async ({ page }) => {
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

// The pair sequence on the focused row: the sheet opens and nothing plays or
// queues; Escape closes it. Returns the sheet's title.
async function pairsOpen(page: Page, label: string) {
  await instrument(page);
  const k = await keys(page);
  await k.play(pairs(300));
  await page.waitForTimeout(G_MS + 200);
  const c = await clock(page);
  const s = await state(page);
  expect(s.open, label + ': sheet open').toBe(true);
  expect(s.zone, label).toBe('options-sheet');
  expect(c.calls, label + ': nothing played or queued').toEqual([]);
  const title = await page.evaluate(() => document.querySelector('#options-sheet .options-sheet-title')!.textContent);
  await H.press(page, 'Escape');
  await H.settle(page, 150);
  expect(await page.evaluate(() => OptionsSheet.isOpen()), label + ': closed').toBe(false);
  return title;
}

test('H1 RED: the pair sequence opens the sheet on album, playlist, Queue, Up Next and artist Popular rows', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page);
  // Album.
  await openAlbum(page);
  expect(await pairsOpen(page, 'album')).toBeTruthy();
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'home');
  await H.settle(page, 300);
  // Playlist.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 0, true));
  await H.navTo(page, 'playlists');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#playlist-songs .song-row.focused'));
  await H.settle(page, 300);
  expect(await pairsOpen(page, 'playlist')).toBeTruthy();
  // Queue (paused, so nothing starts on its own).
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 8), 0); Player.pause(); });
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 2, true));
  await H.navTo(page, 'queue');
  await H.press(page, 'ArrowDown');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'queue-list');
  await H.settle(page, 200);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect(await pairsOpen(page, 'queue')).toBeTruthy();
  // Up Next.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 3, true));
  await H.navTo(page, 'nowplaying');
  await page.waitForFunction(() => FocusManager.hasZone('np-upnext') && document.querySelectorAll('.np-upnext-item').length > 0);
  await page.evaluate(() => FocusManager.setActiveZone('np-upnext', 1, true));
  await H.settle(page, 200);
  expect(await pairsOpen(page, 'up next')).toBe('Track 03');
  // Artist Popular: Library -> Artists -> the first artist -> Down to Popular.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 4, true));
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown'); await H.settle(page, 250);
  await H.press(page, 'ArrowLeft'); await H.settle(page, 100);
  await H.press(page, 'ArrowDown'); await page.waitForTimeout(400);
  await H.press(page, 'ArrowRight'); await H.settle(page, 200);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-popular-list'));
  await page.waitForFunction(() => !document.querySelector('.page-ghost'));
  await H.settle(page, 300);
  for (let i = 0; i < 6 && (await H.focus(page)).zone !== 'artist-popular'; i++) await H.press(page, 'ArrowDown', 1, 60);
  expect(await H.focus(page)).toMatchObject({ zone: 'artist-popular', index: 0 });
  expect(await pairsOpen(page, 'artist popular')).toBeTruthy();
});

test('H1 RED: the pair sequence opens the sheet on Songs, genre songs and Search songs rows', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page, { songs: 400, albums: 60 });
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
  expect(await pairsOpen(page, 'songs')).toBe('Track 001');
  // Genres -> the first genre's songs.
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown');
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');
  await page.waitForFunction(() => !!document.querySelector('.genre-card.focused'), null, { timeout: 5000 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => !!document.querySelector('#library-grid .song-row.focused'), null, { timeout: 8000 });
  await H.settle(page, 200);
  expect(await pairsOpen(page, 'genre songs')).toBe('Track 001');
  // Search "ST" -> the first song result.
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
  expect(await pairsOpen(page, 'search song')).toBe('Track 001');
});

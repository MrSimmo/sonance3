import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as H from './helpers/sonance';

// A8 (ticket-3.10 §7, S6): Settings → Playback → "Resume last queue". The
// queue is saved to the server (the mock keeps it in localStorage, so it
// survives a reload as the server's would) and restored, paused, at start.

const AVPLAY_STUB = path.resolve(__dirname, '..', 'tests', 'avplay-stub.js');

function saves(page: Page) {
  return page.evaluate(() => (window as any).__MOCK__.queueSaves.slice());
}

// A saved queue for the next boot: the ids, the current index, ms.
async function seedSavedQueue(page: Page, ids: string[], index: number, position: number) {
  await page.addInitScript((q) => {
    if (!sessionStorage.getItem('__seeded__')) {
      localStorage.setItem('__mock_playqueue__', JSON.stringify(q));
      sessionStorage.setItem('__seeded__', '1');
    }
  }, { ids, index, position, byIndex: true });
}

function barState(page: Page) {
  return page.evaluate(() => {
    const bar = document.getElementById('now-playing-bar')!;
    const s = Player.getState();
    return {
      shown: getComputedStyle(bar).opacity === '1',
      title: document.querySelector('.now-playing-bar-title')!.textContent,
      playing: s.isPlaying,
      index: s.queueIndex,
      t: s.currentTime,
      ids: s.queue.map((x: any) => x.id),
      screen: App.getCurrentScreen(),
    };
  });
}

test('A8 Settings: "Resume last queue" is On by default, Left/Right/Enter toggle it, and it is stored', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  // Walk the settings-actions zone down to the row (keyboard only).
  for (let i = 0; i < 20; i++) {
    const f = await H.focus(page);
    if (f.id === 'settings-resume-queue-row') break;
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
  }
  expect((await H.focus(page)).id).toBe('settings-resume-queue-row');
  const state = () => page.evaluate(() => ({
    value: document.getElementById('settings-resume-queue-value')!.textContent,
    stored: localStorage.getItem('sonance-resume-queue'),
    flag: SonanceSettings.resumeQueue,
  }));
  expect(await state()).toEqual({ value: 'On', stored: null, flag: true });
  await H.press(page, 'Enter');
  expect(await state()).toEqual({ value: 'Off', stored: 'off', flag: false });
  await H.press(page, 'ArrowRight');
  expect(await state()).toEqual({ value: 'On', stored: 'on', flag: true });
  await H.press(page, 'ArrowLeft');
  expect(await state()).toEqual({ value: 'Off', stored: 'off', flag: false });
  // The row sits in Playback, after Auto Now Playing.
  expect(await page.evaluate(() => {
    const row = document.getElementById('settings-resume-queue-row')!;
    const prev = document.getElementById('settings-auto-np-row')!;
    return row.parentElement === prev.parentElement &&
      !!(prev.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
});

test('A8 save: a track change saves once (debounced), by index; 1,000 ids around the current one go as a POST', async ({ page }) => {
  await H.bootMock(page, { songs: 3000 });
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 5), 1));
  await page.waitForFunction(() => (window as any).__MOCK__.queueSaves.length === 1);
  let s = await saves(page);
  expect(s[0]).toMatchObject({ n: 5, index: 1, byIndex: true, post: false });
  // The pause saves too, unless the playhead is still in the same second
  // as the last save (identical saves are skipped): count from here.
  await page.evaluate(() => Player.pause());
  await page.waitForTimeout(1300);
  const base = (await saves(page)).length;
  // A run of Next presses and a pause: one save, a second after the last.
  await page.evaluate(() => { Player.next(); Player.next(); Player.next(); Player.pause(); });
  await page.waitForTimeout(1400);
  s = await saves(page);
  expect(s.length).toBe(base + 1);
  expect(s[base]).toMatchObject({ n: 5, index: 4 });
  // 3,000 songs at index 1,500: the 1,000 nearest, by POST (> 6,000 chars).
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs, 1500); Player.pause(); });
  await page.waitForFunction((n) => (window as any).__MOCK__.queueSaves.length === n, base + 2);
  s = await saves(page);
  expect(s[base + 1]).toMatchObject({ n: 1000, index: 500, byIndex: true, post: true });
  expect(s[base + 1].urlLength).toBeGreaterThan(6000);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('__mock_playqueue__')!));
  expect(stored.ids[0]).toBe('song-1000');
  expect(stored.ids[999]).toBe('song-1999');
  // Near the end of the queue the window shifts back to stay 1,000 long.
  await page.evaluate(() => { Player.jumpToQueueIndex(2990); Player.pause(); });
  await page.waitForFunction((n) => (window as any).__MOCK__.queueSaves.length === n, base + 3);
  s = await saves(page);
  expect(s[base + 2]).toMatchObject({ n: 1000, index: 990 });
});

test('A8 save triggers: 30 s of playback and the page going hidden (fake clock)', async ({ page }) => {
  await page.clock.install();
  await H.bootMock(page);
  await page.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 5), 0));
  await page.waitForFunction(() => Player.getState().isPlaying);
  await page.clock.fastForward(1200);
  await page.waitForFunction(() => (window as any).__MOCK__.queueSaves.length === 1);
  // Playing on: no save before 30 s, one at the first progress after it.
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  expect((await saves(page)).length).toBe(1);
  await page.clock.fastForward(21000);
  await page.waitForFunction(() => (window as any).__MOCK__.queueSaves.length === 2, null, { timeout: 3000 });
  // Hidden: saves at once (position to the second, so the playhead must
  // have moved since the last save).
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => (window as any).__MOCK__.queueSaves.length === 3, null, { timeout: 2000 });
});

test('A8 restore: a fresh page shows the saved track paused in the bar; Play starts within 2 s of the position; same order; no Now Playing', async ({ page }) => {
  // Auto Now Playing on, to show the restore does not open it.
  await H.bootMock(page, { autoNp: true });
  await page.evaluate(() => {
    Player.setQueue((window as any).__MOCK__.songs.slice(0, 8), 3);
  });
  await page.waitForFunction(() => Player.getState().isPlaying && Player.getState().duration > 10);
  await page.evaluate(() => Player.seekTo(12));
  await page.waitForTimeout(300);
  await page.evaluate(() => Player.pause());
  await page.waitForFunction(() => {
    const q = (window as any).__MOCK__.queueSaves;
    return q.length && q[q.length - 1].position >= 11000;
  });
  const before = await page.evaluate(() => Player.getState().queue.map((x: any) => x.id));
  const streams: string[] = [];
  page.on('request', (r) => { if (/stream\.view/.test(r.url())) streams.push(r.url()); });
  await page.reload();
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await H.settle(page, 300);
  const b = await barState(page);
  expect(b).toMatchObject({ shown: true, title: 'Track 04', playing: false, index: 3, screen: 'home' });
  expect(b.ids).toEqual(before);
  expect(b.t).toBeGreaterThanOrEqual(11);
  expect(b.t).toBeLessThanOrEqual(13);
  expect(await page.evaluate(() => document.querySelector('.play-btn-main svg path')!.getAttribute('d'))).toBe(
    await page.evaluate(() => SonanceUtils.SVG_PATHS.play));
  expect(streams).toEqual([]);   // nothing loaded until Play
  // Play from the bar, by keyboard: Down to it, Right twice, Enter.
  await H.downWalk(page, 40);
  expect(await H.focus(page)).toMatchObject({ zone: 'nowplaying-bar', index: 0 });
  await H.press(page, 'ArrowRight', 2, 40);
  await H.press(page, 'Enter');
  await page.waitForFunction(() => Player.getState().isPlaying);
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => Player.getState().currentTime);
  expect(t).toBeGreaterThanOrEqual(10);
  expect(t).toBeLessThanOrEqual(14);
  expect(streams.length).toBe(1);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('home');
});

test('A8 classic path (no indexBasedQueue): savePlayQueue with the current id, and the restore finds it', async ({ page }) => {
  await H.bootMock(page, { extra: 'mockClassicQueue=1' });
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 6), 2); Player.pause(); });
  await page.waitForFunction(() => (window as any).__MOCK__.queueSaves.length >= 1);
  expect((await saves(page))[0]).toMatchObject({ n: 6, index: 2, byIndex: false });
  await page.reload();
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  expect(await barState(page)).toMatchObject({ title: 'Track 03', index: 2, playing: false });
});

test('A8 AVPlay (stub): nothing is opened until Play; Play opens, prepares, seeks to the saved position, then plays', async ({ page }) => {
  await page.addInitScript({ path: AVPLAY_STUB });
  await page.addInitScript(() => { (window as any).__avstub.mode = 'auto-ok'; });
  await seedSavedQueue(page, ['song-0', 'song-1', 'song-2', 'song-3'], 2, 42000);
  await H.bootMock(page);
  await page.waitForFunction(() => !!Player.getState().currentTrack);
  await H.settle(page, 200);
  expect(await page.evaluate(() => Player.IS_TIZEN)).toBe(true);
  expect(await barState(page)).toMatchObject({ title: 'Track 03', playing: false, index: 2 });
  expect(await page.evaluate(() => (window as any).__avstub.calls('open'))).toBe(0);
  await page.keyboard.press('Space');   // Play/Pause (the browser stand-in for 10252)
  await page.waitForFunction(() => Player.getState().isPlaying);
  const trace = await page.evaluate(() => (window as any).__avstub.log
    .filter((e: any) => /^(open|prepareAsync|prepare:ok|seekTo|play)$/.test(e.call))
    .map((e: any) => e.call + (e.call === 'seekTo' ? ':' + e.arg : '')));
  expect(trace).toEqual(['open', 'prepareAsync', 'prepare:ok', 'seekTo:42000', 'play']);
  expect(await page.evaluate(() => Player.getState().currentTime)).toBe(42);
});

test('A8 a restore that lands while the Queue screen is open fills its list', async ({ page }) => {
  await seedSavedQueue(page, ['song-4', 'song-5', 'song-6', 'song-7', 'song-8', 'song-9'], 1, 5000);
  await H.bootMock(page, { extra: 'mockPlayQueueDelay=2500' });
  await H.navTo(page, 'queue');
  expect(await page.evaluate(() => !!Player.getState().currentTrack)).toBe(false);
  await page.waitForFunction(() => !!Player.getState().currentTrack, null, { timeout: 5000 });
  await H.settle(page, 300);
  const q = await page.evaluate(() => ({
    rows: Array.prototype.map.call(document.querySelectorAll('.queue-row .queue-row-title'), (e: Element) => e.textContent),
    card: document.querySelector('.queue-np-title') ? document.querySelector('.queue-np-title')!.textContent : null,
  }));
  expect(q.card).toBe('Track 06');
  expect(q.rows.slice(0, 4)).toEqual(['Track 07', 'Track 08', 'Track 09', 'Track 10']);
});

test('A8 Off: no saves and no restore', async ({ page }) => {
  await seedSavedQueue(page, ['song-0', 'song-1'], 0, 3000);
  await H.bootMock(page, { storage: { 'sonance-resume-queue': 'off' } });
  await H.settle(page, 500);
  expect(await page.evaluate(() => !!Player.getState().currentTrack)).toBe(false);
  await page.evaluate(() => { Player.setQueue((window as any).__MOCK__.songs.slice(0, 3), 0); Player.pause(); });
  await page.waitForTimeout(1500);
  expect((await saves(page)).length).toBe(0);
});

import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// A6 (Up Next strip) and A7 (sleep timer) on Now Playing, S6.

async function openNowPlaying(page: Page, opts: Record<string, unknown> = {}, songs = 12) {
  await H.bootMock(page, opts);
  await H.startTrack(page, songs, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
}

// What the strip shows, and what the queue says should be next.
function strip(page: Page) {
  return page.evaluate(() => {
    const tiles = Array.prototype.filter.call(document.querySelectorAll('.np-upnext-item'),
      (t: HTMLElement) => t.style.display !== 'none') as HTMLElement[];
    const s = Player.getState();
    return {
      on: document.querySelector('.np-layout')!.classList.contains('upnext-on'),
      opacity: getComputedStyle(document.querySelector('.np-upnext')!).opacity,
      label: document.querySelector('.np-upnext-label')!.textContent,
      titles: tiles.map((t) => t.querySelector('.np-upnext-title')!.textContent),
      queue: s.queue.map((t: any) => t.title),
      index: s.queueIndex,
      empty: getComputedStyle(document.querySelector('.np-upnext-empty')!).display !== 'none',
    };
  });
}

test('A6 the next five in play order, then the shuffled order once shuffle is on', async ({ page }) => {
  await openNowPlaying(page);
  let s = await strip(page);
  expect(s.on).toBe(true);
  expect(s.opacity).toBe('1');
  expect(s.label).toBe('Up next · 11 songs');
  expect(s.titles).toEqual(s.queue.slice(1, 6));
  expect(s.titles).toEqual(['Track 02', 'Track 03', 'Track 04', 'Track 05', 'Track 06']);
  // Shuffle on: the queue is re-ordered with the current track first.
  await H.press(page, 'ArrowLeft', 2, 40);
  expect((await H.focus(page)).id).toBe('np-shuffle');
  await H.press(page, 'Enter');
  await H.settle(page, 100);
  s = await strip(page);
  expect(await page.evaluate(() => Player.getState().shuffle)).toBe(true);
  expect(s.titles).toEqual(s.queue.slice(s.index + 1, s.index + 6));
  expect(s.titles).not.toEqual(['Track 02', 'Track 03', 'Track 04', 'Track 05', 'Track 06']);
});

test('A6 focus: Down enters on the first tile, Right past the last reaches the chip, Up returns to Play', async ({ page }) => {
  await openNowPlaying(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-upnext', index: 0 });
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    await H.press(page, 'ArrowRight');
    await H.settle(page, 20);
    const f = await H.focus(page);
    expect(f.visible).toBe(true);
    seen.push(f.id || String(f.index));
  }
  expect(seen).toEqual(['1', '2', '3', '4', 'np-sleep-chip', 'np-sleep-chip']);
  // Down from the strip goes nowhere (the bar is hidden on Now Playing).
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-sleep-chip');
  for (const from of [5, 2]) {
    await page.evaluate((i) => FocusManager.setActiveZone('np-upnext', i, true), from);
    await H.press(page, 'ArrowUp');
    await H.settle(page);
    expect((await H.focus(page)).id).toBe('np-play');
  }
  // A focused tile is a row: fill, ink, soft ink, 1.02 from the left
  // (read after its 0.12 s transform).
  await H.press(page, 'ArrowDown');
  await H.settle(page, 250);
  const st = await page.evaluate(() => {
    const el = FocusManager.getCurrentFocused()!;
    return {
      bg: getComputedStyle(el).backgroundColor,
      title: getComputedStyle(el.querySelector('.np-upnext-title')!).color,
      artist: getComputedStyle(el.querySelector('.np-upnext-artist')!).color,
      transform: getComputedStyle(el).transform,
      origin: getComputedStyle(el).transformOrigin,
    };
  });
  expect(st).toMatchObject({ bg: 'rgb(228, 77, 138)', title: 'rgb(255, 255, 255)', artist: 'rgba(255, 255, 255, 0.86)' });
  expect(st.transform).toBe('matrix(1.02, 0, 0, 1.02, 0, 0)');
  expect(st.origin.split(' ')[0]).toBe('0px');
});

test('A6 Enter on a tile plays that track; the strip moves on and focus stays in it', async ({ page }) => {
  await openNowPlaying(page);
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 2, 30);
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-upnext', index: 2 });
  await H.press(page, 'Enter');
  await page.waitForFunction(() => Player.getState().queueIndex === 3);
  await page.evaluate(() => Player.pause());
  await H.settle(page, 100);
  expect(await page.evaluate(() => Player.getState().currentTrack.title)).toBe('Track 04');
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  const s = await strip(page);
  expect(s.titles).toEqual(['Track 05', 'Track 06', 'Track 07', 'Track 08', 'Track 09']);
  expect(s.label).toBe('Up next · 8 songs');
  const f = await H.focus(page);
  expect(f).toMatchObject({ zone: 'np-upnext', index: 2 });
  expect(f.visible).toBe(true);
});

test('A6 the strip follows track and queue changes; repeat all wraps; the end of the queue', async ({ page }) => {
  await openNowPlaying(page, {}, 4);
  expect((await strip(page)).titles).toEqual(['Track 02', 'Track 03', 'Track 04']);
  await page.evaluate(() => { Player.next(); Player.pause(); });
  await H.settle(page, 60);
  expect((await strip(page)).titles).toEqual(['Track 03', 'Track 04']);
  await page.evaluate(() => Player.addToQueueNext((window as any).__MOCK__.songs[9]));
  await H.settle(page, 60);
  expect((await strip(page)).titles).toEqual(['Track 10', 'Track 03', 'Track 04']);
  // Repeat all: after the last track comes the first.
  await page.evaluate(() => { Player.toggleRepeat(); });
  expect(await page.evaluate(() => Player.getState().repeat)).toBe('all');
  await page.evaluate(() => Player.next());   // the repeat change itself emits no queuechange
  await page.evaluate(() => Player.pause());
  await H.settle(page, 60);
  let s = await strip(page);
  expect(s.titles).toEqual(['Track 03', 'Track 04', 'Track 01', 'Track 02']);
  expect(s.label).toBe('Up next · 4 songs');
  // Repeat off, last track: the row says so and only the chip is a stop.
  await page.evaluate(() => { Player.toggleRepeat(); Player.toggleRepeat(); });   // all -> one -> none
  await page.evaluate(() => { Player.jumpToQueueIndex(Player.getState().queue.length - 1); Player.pause(); });
  await H.settle(page, 60);
  s = await strip(page);
  expect(s.titles).toEqual([]);
  expect(s.empty).toBe(true);
  expect(s.label).toBe('Up next');
  await page.evaluate(() => FocusManager.setActiveZone('np-controls', 2, true));
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-sleep-chip');
});

test('A6 hidden while lyrics are open (Down does nothing), back when they close', async ({ page }) => {
  await openNowPlaying(page, { extra: 'mockLyrics=1' });
  await page.waitForFunction(() => !document.getElementById('np-lyrics')!.classList.contains('is-unavailable'));
  await H.press(page, 'ArrowRight', 4, 40);
  await H.press(page, 'Enter');
  await H.settle(page, 400);
  let s = await strip(page);
  expect(s.on).toBe(false);
  expect(s.opacity).toBe('0');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-lyrics');
  await H.press(page, 'Enter');
  await H.settle(page, 400);
  s = await strip(page);
  expect(s.on).toBe(true);
  expect(s.opacity).toBe('1');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).zone).toBe('np-upnext');
});

for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`A6 layout at ${scale * 100}%: the column clears the strip; up to 150 % it clears the top nav too`, async ({ page }) => {
    await openNowPlaying(page, { scale });
    await page.waitForTimeout(350);   // the column's 0.25 s move
    const g = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const tiles = Array.prototype.map.call(document.querySelectorAll('.np-upnext-item'),
        (t: Element) => t.getBoundingClientRect());
      return {
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        art: r('.np-screen-art'),
        controls: r('.np-screen-controls'),
        strip: r('.np-upnext-header'),
        row: r('.np-upnext-row'),
        nav: r('#top-nav-bar'),
        lastTile: tiles[tiles.length - 1],
        tight: document.querySelector('.np-layout')!.classList.contains('upnext-tight'),
      };
    });
    test.info().annotations.push({ type: 'geometry', description: JSON.stringify({ art: Math.round(g.art.width), artTop: Math.round(g.art.top), controlsBottom: Math.round(g.controls.bottom), stripTop: Math.round(g.strip.top), tight: g.tight }) });
    expect(g.controls.bottom).toBeLessThanOrEqual(g.strip.top);
    expect(g.art.top).toBeGreaterThanOrEqual(0);
    expect(g.row.bottom).toBeLessThanOrEqual(1080);
    expect(g.lastTile.right).toBeLessThanOrEqual(1920);
    expect(g.tight).toBe(scale > 1.5);
    if (scale <= 1.5) expect(g.art.top).toBeGreaterThanOrEqual(g.nav.bottom);
    // The art shrinks only where it has to (28rem up to 125 %).
    if (scale <= 1.25) expect(Math.round(g.art.width / g.rem)).toBe(28);
  });
}

// A7: the chip's labels; the countdown and its expiry with fake timers.

async function chip(page: Page) {
  return page.evaluate(() => document.getElementById('np-sleep-chip')!.textContent);
}

test('A7 the sleep chip cycles Off → 15 → 30 → 45 → 60 min → End of track → Off', async ({ page }) => {
  await openNowPlaying(page);
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 5, 30);
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-sleep-chip');
  const labels = [await chip(page)];
  for (let i = 0; i < 6; i++) {
    await H.press(page, 'Enter');
    await H.settle(page, 20);
    labels.push(await chip(page));
  }
  expect(labels).toEqual(['Sleep timer', 'Sleep in 15 min', 'Sleep in 30 min', 'Sleep in 45 min',
    'Sleep in 60 min', 'Sleep: end of track', 'Sleep timer']);
});

test('A7 15 min (fake clock): the label counts down on minute boundaries; expiry pauses and toasts; it outlives the screen', async ({ page }) => {
  await page.clock.install();
  await openNowPlaying(page);
  await page.evaluate(() => Player.play());
  await page.waitForFunction(() => Player.getState().isPlaying);
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 5, 30);
  await H.press(page, 'Enter');
  await H.settle(page, 20);
  expect(await chip(page)).toBe('Sleep in 15 min');
  await page.clock.fastForward(59000);
  expect(await chip(page)).toBe('Sleep in 15 min');
  await page.clock.fastForward(2000);
  expect(await chip(page)).toBe('Sleep in 14 min');
  await page.clock.fastForward('12:00');
  expect(await chip(page)).toBe('Sleep in 2 min');
  // Leave Now Playing: the countdown goes on without the screen.
  await page.evaluate(() => FocusManager.setActiveZone('topnav', 4, true));
  await H.press(page, 'ArrowLeft');
  await H.waitForScreen(page, 'queue');
  expect(await page.evaluate(() => Player.getState().isPlaying)).toBe(true);
  await page.clock.fastForward('02:00');
  await page.waitForFunction(() => !Player.getState().isPlaying);
  expect(await page.evaluate(() => document.querySelector('.sonance-toast')!.textContent)).toBe('Sleep timer: playback paused');
  // Back on Now Playing the chip reads Off again.
  await H.press(page, 'ArrowRight');
  await H.waitForScreen(page, 'nowplaying');
  expect(await chip(page)).toBe('Sleep timer');
});

test('A7 End of track: playback pauses when the track ends and the next one is cued, paused', async ({ page }) => {
  await openNowPlaying(page, {}, 3);
  await page.evaluate(() => Player.play());
  await page.waitForFunction(() => Player.getState().isPlaying && Player.getState().duration > 10);
  await H.press(page, 'ArrowDown');
  await H.press(page, 'ArrowRight', 5, 30);
  await H.press(page, 'Enter', 5, 30);
  await H.settle(page, 20);
  expect(await chip(page)).toBe('Sleep: end of track');
  // The mock stream is 20 s long: jump to its last second.
  await page.evaluate(() => Player.seekTo(Player.getState().duration - 1));
  await page.waitForFunction(() => !Player.getState().isPlaying, null, { timeout: 8000 });
  const s = await page.evaluate(() => ({ title: Player.getState().currentTrack.title, t: Player.getState().currentTime }));
  expect(s).toEqual({ title: 'Track 02', t: 0 });
  expect(await page.evaluate(() => document.querySelector('.sonance-toast')!.textContent)).toBe('Sleep timer: paused at the end of the track');
  expect(await chip(page)).toBe('Sleep timer');
  // Play continues the queue from the start of the cued track.
  await page.evaluate(() => Player.play());
  await page.waitForFunction(() => Player.getState().isPlaying && Player.getState().currentTime > 0.2);
  expect(await page.evaluate(() => Player.getState().currentTrack.title)).toBe('Track 02');
  expect(await page.evaluate(() => Player.getState().currentTime)).toBeLessThan(3);
});

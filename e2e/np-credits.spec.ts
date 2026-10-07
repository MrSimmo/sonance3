import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R7 (ticket-3.10 §7, S6): Now Playing's ⓘ button and credits panel. The
// mock's getSong carries the OpenSubsonic fields Navidrome 0.64.1 sends
// (tests/mock-boot.js `_songWithCredits`): even-numbered songs have full
// credits, odd-numbered ones have no contributors, plays or BPM.

// v3.10-fix2 F7 (D158): Focus mode is the ninth button, after ⓘ.
const ROW = ['np-shuffle', 'np-prev', 'np-play', 'np-next', 'np-repeat', 'np-star', 'np-lyrics', 'np-credits', 'np-focus'];

// Now Playing by the top nav with a paused queue, focus dropped onto Play.
async function openNowPlaying(page: Page, opts: Record<string, unknown> = {}, songs = 6) {
  await H.bootMock(page, opts);
  await H.startTrack(page, songs, { paused: true });
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  expect((await H.focus(page)).id).toBe('np-play');
}

async function openCredits(page: Page) {
  await H.press(page, 'ArrowRight', 5, 40);
  await H.settle(page, 100);
  expect((await H.focus(page)).id).toBe('np-credits');
  await H.press(page, 'Enter');
  // getSong and getAlbum answer on the mock's next microtasks; one frame
  // later the panel holds their content.
  await page.waitForFunction(() => !!document.querySelector('.np-layout.credits-active .credit-row'));
  await H.settle(page, 350);
}

function sections(page: Page) {
  return page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.np-credits-panel .credits-section'),
    (e: Element) => e.textContent));
}

function rows(page: Page) {
  return page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.np-credits-panel .credit-row'),
    (e: Element) => e.firstChild!.textContent + '=' + e.lastChild!.textContent));
}

test('R7 the controls row is 9 wide (fix2 F7), ⓘ after Lyrics, and every Up/Down entry still lands on Play', async ({ page }) => {
  await openNowPlaying(page);
  expect(await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('.np-screen-controls .focusable'), (b: Element) => b.id))).toEqual(ROW);
  // The icon is inline SVG sized in rem: 2.4rem at any interface size.
  const svg = await page.evaluate(() => {
    const s = document.querySelector('#np-credits svg') as SVGElement;
    return {
      w: s.style.width,
      rect: s.getBoundingClientRect().width,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
  expect(svg.w).toBe('2.4rem');
  expect(svg.rect).toBeCloseTo(2.4 * svg.rem, 0);
  // Up, then Down: Play. Right x5 from Play ends on ⓘ (index 7); since
  // fix2 F7 one more Right is Focus mode, the row's last item.
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect((await H.focus(page)).zone).toBe('np-progress');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
  await H.press(page, 'ArrowRight', 5, 30);
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', index: 7, id: 'np-credits' });
  await H.press(page, 'ArrowRight', 2, 30);
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', index: 8, id: 'np-focus' });
  await H.press(page, 'ArrowUp');
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).id).toBe('np-play');
});

test('R7 Enter opens the panel with the lyrics geometry; sections with no data are absent; it follows the track', async ({ page }) => {
  await openNowPlaying(page);
  await openCredits(page);
  const geo = await page.evaluate(() => {
    const layout = document.querySelector('.np-layout')!;
    const left = document.querySelector('.np-left') as HTMLElement;
    const panel = document.querySelector('.np-credits-panel') as HTMLElement;
    return {
      credits: layout.classList.contains('credits-active'),
      lyrics: layout.classList.contains('lyrics-active'),
      leftEdge: left.getBoundingClientRect().left,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      art: (document.querySelector('.np-screen-art') as HTMLElement).getBoundingClientRect().width,
      panelTransform: getComputedStyle(panel).transform,
      panelOpacity: getComputedStyle(panel).opacity,
      title: document.querySelector('.np-credits-title')!.textContent,
      subtitle: document.querySelector('.np-credits-subtitle')!.textContent,
    };
  });
  expect(geo.credits).toBe(true);
  expect(geo.lyrics).toBe(false);
  // The lyrics position: the column's left edge 6-10 rem from the screen's
  // (R4's check for lyrics), and the 22rem art.
  expect(geo.leftEdge / geo.rem).toBeGreaterThanOrEqual(6);
  expect(geo.leftEdge / geo.rem).toBeLessThanOrEqual(10);
  expect(Math.round(geo.art / geo.rem)).toBe(22);
  expect(geo.panelTransform).toBe('matrix(1, 0, 0, 1, 0, 0)');
  expect(geo.panelOpacity).toBe('1');
  expect(geo.title).toBe('Credits');
  expect(geo.subtitle).toBe('Track 01 — A Artist 01');
  // song-0 is even: every section.
  expect(await sections(page)).toEqual(['Performance', 'Writing & production', 'Release', 'File', 'Listening']);
  const r0 = await rows(page);
  expect(r0).toContain('Artist=A Artist 01');
  expect(r0).toContain('Vocals=Kyla');
  expect(r0).toContain('Written by=B. Von Trax · K. Paris');
  expect(r0).toContain('Label=Mock Records');
  expect(r0).toContain('Track=1 of 10');
  expect(r0).toContain('Sample rate=44.1 kHz · 16-bit');
  expect(r0).toContain('Channels=Stereo');
  expect(r0).toContain('BPM=124');
  // Next track with the panel open: it stays open and shows song-1, which
  // has no contributors, plays or BPM — those two sections are absent.
  await page.evaluate(() => { Player.next(); Player.pause(); });
  await page.waitForFunction(() => document.querySelector('.np-credits-subtitle')!.textContent!.indexOf('Track 02') === 0);
  await page.waitForFunction(() => document.querySelectorAll('.np-credits-panel .credits-section').length === 3);
  expect(await page.evaluate(() => document.querySelector('.np-layout')!.classList.contains('credits-active'))).toBe(true);
  expect(await sections(page)).toEqual(['Performance', 'Release', 'File']);
  const r1 = await rows(page);
  expect(r1.filter((r) => /^(Written by|BPM|Plays)=/.test(r))).toEqual([]);
  // album-1 is odd in the mock: an original date 20 years earlier.
  expect(r1).toContain('Released=2021 · originally 2001');
});

test('R7 one getSong request per song per session, the 5-minute response cache cleared or not', async ({ page }) => {
  await openNowPlaying(page);
  await page.evaluate(() => {
    (window as any).__songReqs = {};
    const orig = SubsonicAPI.prototype._request;
    SubsonicAPI.prototype._request = function(endpoint: string, params: any) {
      if (endpoint === 'getSong.view') {
        const m = (window as any).__songReqs;
        m[params.id] = (m[params.id] || 0) + 1;
      }
      return orig.apply(this, arguments as any);
    };
  });
  await openCredits(page);
  await H.press(page, 'Enter');           // close (focus is still on ⓘ)
  await H.settle(page, 300);
  // Clearing the API's response cache proves the session cache, not the
  // 5-minute TTL, is what saves the second request.
  await page.evaluate(() => SubsonicAPI.clearCache());
  await H.press(page, 'Enter');           // open again
  await H.settle(page, 300);
  await page.evaluate(() => { Player.next(); Player.pause(); });
  await page.waitForFunction(() => (window as any).__songReqs['song-1'] === 1);
  await page.evaluate(() => SubsonicAPI.clearCache());
  await page.evaluate(() => { Player.previous(); Player.pause(); });
  await page.waitForFunction(() => document.querySelector('.np-credits-subtitle')!.textContent!.indexOf('Track 01') === 0);
  await H.settle(page, 300);
  expect(await page.evaluate(() => (window as any).__songReqs)).toEqual({ 'song-0': 1, 'song-1': 1 });
});

test('R7 Back closes the panel first and returns focus to ⓘ; the next Back leaves Now Playing (it sinks)', async ({ page }) => {
  await H.bootMock(page);
  await H.startTrack(page, 6, { paused: true });
  // Down to the bar's "open Now Playing", Enter: Now Playing rises (D93).
  await H.downWalk(page, 40);
  expect(await H.focus(page)).toMatchObject({ zone: 'nowplaying-bar', index: 0 });
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'nowplaying');
  await H.settle(page, 400);
  await openCredits(page);
  // Down into the rows first, so Back has to bring focus out of the panel.
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect((await H.focus(page)).zone).toBe('np-credits');
  await H.press(page, 'Escape');
  await H.settle(page, 100);
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  expect(await page.evaluate(() => document.querySelector('.np-layout')!.classList.contains('credits-active'))).toBe(false);
  expect(await page.evaluate(() => document.querySelectorAll('.page-ghost').length)).toBe(0);
  expect((await H.focus(page)).id).toBe('np-credits');
  // The second Back is the sink: the ghost (Now Playing) drops under nothing.
  await H.press(page, 'Escape');
  await H.settle(page, 30);
  const sink = await page.evaluate(() => {
    const g = document.querySelector('.page-ghost') as HTMLElement | null;
    return { screen: App.getCurrentScreen(), ghostTransform: g ? g.style.transform : null };
  });
  expect(sink.screen).toBe('home');
  expect(sink.ghostTransform).toContain('translateY');
});

test('R7 opening credits closes lyrics, and opening lyrics closes credits', async ({ page }) => {
  await openNowPlaying(page, { extra: 'mockLyrics=1' });
  await page.waitForFunction(() => !document.getElementById('np-lyrics')!.classList.contains('is-unavailable'));
  const state = () => page.evaluate(() => {
    const l = document.querySelector('.np-layout')!;
    return (l.classList.contains('lyrics-active') ? 'L' : '-') + (l.classList.contains('credits-active') ? 'C' : '-');
  });
  await H.press(page, 'ArrowRight', 4, 40);
  await H.press(page, 'Enter');
  await H.settle(page, 300);
  expect(await state()).toBe('L-');
  await H.press(page, 'ArrowRight');
  await H.press(page, 'Enter');
  await H.settle(page, 300);
  expect(await state()).toBe('-C');
  await H.press(page, 'ArrowLeft');
  await H.press(page, 'Enter');
  await H.settle(page, 300);
  expect(await state()).toBe('L-');
  // The focused button of an open panel keeps its ink on the accent platter
  // (the lyrics icon used to vanish there).
  const ink = await page.evaluate(() => {
    const b = document.getElementById('np-lyrics')!;
    return { focused: b.classList.contains('focused'), color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
  });
  expect(ink.focused).toBe(true);
  expect(ink.color).not.toBe(ink.bg);
});

// Rewritten in v3.10-fix2 F3 (D154): the rows were one focus stop each
// (D118) and the focused row took the row fill; now the body is the one
// stop and Up/Down scroll it. The step sizes are in e2e/credits-scroll.spec.ts.
test('R7 overflowing credits: Down enters np-credits on the body (no row stop), it scrolls to the end, Up at the top returns to ⓘ', async ({ page }) => {
  await openNowPlaying(page);
  await openCredits(page);
  const n = await page.evaluate(() => document.querySelectorAll('.np-credits-panel .credit-row').length);
  expect(n).toBeGreaterThan(15);
  expect(await page.evaluate(() => {
    const s = document.querySelector('.np-credits-scroll') as HTMLElement;
    return s.scrollHeight > s.clientHeight;
  })).toBe(true);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-credits', index: 0 });
  const body = () => page.evaluate(() => {
    const s = document.querySelector('.np-credits-scroll') as HTMLElement;
    return {
      isFocus: FocusManager.getCurrentFocused() === s,
      top: s.scrollTop, max: s.scrollHeight - s.clientHeight,
      focusedRows: document.querySelectorAll('.credit-row.focused').length,
    };
  });
  expect(await body()).toMatchObject({ isFocus: true, top: 0, focusedRows: 0 });
  // To the end: the last row is fully inside the body.
  await H.press(page, 'ArrowDown', 12, 20);
  await H.settle(page, 20);
  await H.scrollIdle(page);
  const end = await body();
  expect(end.top).toBe(end.max);
  expect(await page.evaluate(() => {
    const rows = document.querySelectorAll('.np-credits-panel .credit-row');
    const r = rows[rows.length - 1].getBoundingClientRect();
    const s = document.querySelector('.np-credits-scroll')!.getBoundingClientRect();
    return r.bottom <= s.bottom + 0.5;
  })).toBe(true);
  expect((await H.focus(page)).zone).toBe('np-credits');
  // Up until the top (the body keeps the focus all the way), then once more.
  for (let i = 0; i < 12 && (await body()).top > 0; i++) {
    await H.press(page, 'ArrowUp');
    await H.settle(page, 20);
    await H.scrollIdle(page);
  }
  expect(await body()).toMatchObject({ isFocus: true, top: 0 });
  await H.press(page, 'ArrowUp');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', id: 'np-credits' });
});

test('R7 credits that fit: the panel is not entered and Down does nothing (100 %)', async ({ page }) => {
  await openNowPlaying(page, { scale: 1 });
  await page.evaluate(() => { Player.next(); Player.pause(); });   // song-1: the short credits
  await H.settle(page, 200);
  await openCredits(page);
  expect(await page.evaluate(() => {
    const s = document.querySelector('.np-credits-scroll') as HTMLElement;
    return s.scrollHeight <= s.clientHeight + 1;
  })).toBe(true);
  await H.press(page, 'ArrowDown');
  await H.settle(page);
  expect(await H.focus(page)).toMatchObject({ zone: 'np-controls', id: 'np-credits' });
});

test('R7 with no track ⓘ is dimmed, focusable, and Enter does nothing (D55)', async ({ page }) => {
  await H.bootMock(page);
  await H.navTo(page, 'nowplaying');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await H.press(page, 'ArrowRight', 5, 30);
  await H.settle(page, 100);
  const f = await H.focus(page);
  expect(f.id).toBe('np-credits');
  expect(f.visible).toBe(true);
  expect(await page.evaluate(() => document.getElementById('np-credits')!.classList.contains('is-unavailable'))).toBe(true);
  await H.press(page, 'Enter');
  await H.settle(page, 300);
  expect(await page.evaluate(() => document.querySelector('.np-layout')!.classList.contains('credits-active'))).toBe(false);
});

test('R7 screenshot: the credits panel at 150 % (mockup 10)', async ({ page }) => {
  await openNowPlaying(page, { scale: 1.5 });
  await openCredits(page);
  await page.screenshot({ path: 'screenshots/v3-10/s6-150-credits.png' });
});

test('R7 creditSections (pure): "[no label]" is no label, displayComposer stands in, a multi-disc track count', async ({ page }) => {
  await H.bootMock(page);
  const out = await page.evaluate(() => {
    const album = {
      recordLabels: [{ name: '[no label]' }],
      song: [{ discNumber: 1 }, { discNumber: 1 }, { discNumber: 2 }, { discNumber: 2 }, { discNumber: 2 }],
      releaseDate: { year: 2006 }, originalReleaseDate: { year: 1994 },
    };
    const song = { title: 'T', artist: 'A', album: 'Al', track: 2, discNumber: 2, displayComposer: 'X • Y', suffix: 'mp3', bitRate: 320, channelCount: 1 };
    return SonanceComponents.creditSections(song, album).map((s: any) => s.title + ': ' + s.rows.map((r: any) => r[0] + '=' + r[1]).join(', '));
  });
  expect(out).toEqual([
    'Performance: Artist=A',
    'Writing & production: Written by=X · Y',
    'Release: Album=Al, Released=2006 · originally 1994, Track=2 of 3 · Disc 2 of 2',
    'File: Format=MP3, Bit rate=320 kbps, Channels=Mono',
  ]);
});

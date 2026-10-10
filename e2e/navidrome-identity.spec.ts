import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.13 R12.3 (D186): the Navidrome identity guard. A GUARD, not a new
// behaviour: it passes on 3.12's code and must keep passing after the
// Jellyfin backend lands, because a Navidrome session has to send exactly
// the requests the previous release sends.
//
// A fixed keyboard walk on the Subsonic mock (every screen, the options
// sheet and its credits, Now Playing's lyrics, logout and login through the
// form, then a relaunch that resumes the saved queue) records:
//   api    the multiset of the app's own fetches: path plus sorted params,
//          minus the u/t/s auth (and `position`, the one timing value);
//   media  every distinct cover and stream URL the browser requested;
//   other  every other non-static request (a Jellyfin probe would land here).
// It is compared with e2e/fixtures/navidrome-identity.json, recorded on 3.12
// (3 identical runs before it was committed). SONANCE_IDENTITY_RECORD=<file>
// writes the observation there instead of comparing.
//
// Scale is pinned at 150 % (cover sizes follow the interface size), so the
// fixture holds at any SONANCE_SCALE.

const FIXTURE = path.resolve(__dirname, 'fixtures', 'navidrome-identity.json');
const STATIC = /^\/(js|css|tests)\/|^\/(index\.html|favicon\.ico)?$|\.(js|css|html|png|svg|ico|woff2?)$/;

function norm(url: string, body?: string | null): string {
  const u = new URL(url, 'http://x');
  const pairs: string[] = [];
  const add = (v: string, k: string) => {
    if (k === 'u' || k === 't' || k === 's') return;
    pairs.push(k + '=' + (k === 'position' ? 'N' : v));
  };
  u.searchParams.forEach(add);
  if (body) new URLSearchParams(body).forEach(add);
  pairs.sort();
  return u.pathname + (pairs.length ? '?' + pairs.join('&') : '');
}

// Wraps whatever tests/mock-boot.js installs as window.fetch, so the app's
// own calls are seen (the mock answers /rest/ in-page; they never reach the
// network). Also counts calls in flight, for quiet().
async function trapFetch(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__ID_LOG__ = [];
    w.__ID_PENDING__ = 0;
    let current = window.fetch;
    const wrap = (fn: any) => function(this: any, input: any, init: any) {
      w.__ID_LOG__.push({ url: typeof input === 'string' ? input : input.url,
        method: (init && init.method) || 'GET',
        body: init && typeof init.body === 'string' ? init.body : null });
      w.__ID_PENDING__++;
      const done = () => { w.__ID_PENDING__--; };
      const p = fn.apply(this, arguments);
      p.then(done, done);
      return p;
    };
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get() { return current; },
      set(v) { current = wrap(v); }
    });
  });
}

// Lets a focus rest past the 0.4 s prefetch, then waits for the app's
// fetches to finish, twice over.
async function quiet(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(600);
    await page.waitForFunction(() => (window as any).__ID_PENDING__ === 0, null, { timeout: 10000 });
  }
  await H.settle(page, 100);
}

async function holdOk(page: Page, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, key) as any);
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, key) as any);
}

async function libraryTab(page: Page, downs: number) {
  // Focus on the Library sub-nav pill for the tab above, then down.
  await H.press(page, 'ArrowLeft');
  await H.settle(page, 100);
  for (let i = 0; i < downs; i++) await H.press(page, 'ArrowDown', 1, 90);
  await quiet(page);
}

async function focusId(page: Page) {
  return (await H.focus(page)).id;
}

async function walk(page: Page) {
  await H.bootMock(page, { scale: 1.5, extra: 'mockLyrics=1' });
  await quiet(page);
  await H.startTrack(page, 20, { paused: true });
  await quiet(page);

  // Home: into the content, two cards along.
  await H.press(page, 'ArrowDown');
  await quiet(page);
  await H.press(page, 'ArrowRight');
  await quiet(page);
  await H.press(page, 'ArrowRight');
  await quiet(page);

  // Library -> Albums -> the first album -> hold OK on a track -> credits.
  await H.navTo(page, 'library');
  await quiet(page);
  await H.press(page, 'ArrowDown');
  await quiet(page);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'album');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
  await quiet(page);
  await holdOk(page, 900);
  await page.waitForFunction(() => OptionsSheet.isOpen());
  await quiet(page);
  const items: string[] = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('#options-sheet .options-sheet-item'), (e: HTMLElement) => e.getAttribute('data-action')));
  for (let i = 0; i < items.indexOf('credits'); i++) await H.press(page, 'ArrowDown', 1, 40);
  await H.press(page, 'Enter');
  await quiet(page);
  await H.press(page, 'Escape');       // credits -> actions
  await H.settle(page, 150);
  await H.press(page, 'Escape');       // close the sheet
  await quiet(page);
  await H.press(page, 'Escape');       // album -> Library
  await H.waitForScreen(page, 'library');
  await quiet(page);

  // Artists -> an artist page -> back; Songs; Genres -> a genre.
  await libraryTab(page, 1);
  await H.press(page, 'ArrowRight');
  await quiet(page);
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await quiet(page);
  await H.press(page, 'Escape');
  await H.waitForScreen(page, 'library');
  await quiet(page);
  await libraryTab(page, 1);           // Songs
  await H.press(page, 'ArrowRight');
  await quiet(page);
  await libraryTab(page, 1);           // Genres
  await H.press(page, 'ArrowRight');
  await quiet(page);
  await H.press(page, 'Enter');
  await quiet(page);
  await H.press(page, 'Escape');
  await quiet(page);

  // Playlists -> the first playlist; Queue.
  await H.navTo(page, 'playlists');
  await quiet(page);
  await H.press(page, 'ArrowDown');
  await quiet(page);
  await H.press(page, 'Enter');
  await quiet(page);
  await H.press(page, 'Escape');
  await quiet(page);
  await H.navTo(page, 'queue');
  await quiet(page);

  // Now Playing -> lyrics.
  await H.navTo(page, 'nowplaying');
  await quiet(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 150);
  await H.press(page, 'ArrowRight', 4);
  await H.press(page, 'Enter');
  await quiet(page);

  // Search "TR" on the on-screen keyboard.
  await H.navTo(page, 'search');
  await quiet(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown', 2, 80);
  await H.press(page, 'ArrowRight', 1, 80);
  await H.press(page, 'Enter');
  await quiet(page);
  await H.press(page, 'ArrowUp', 1, 80);
  await H.press(page, 'ArrowRight', 7, 80);
  await H.press(page, 'Enter');
  await quiet(page);

  // Settings -> Logout -> confirm.
  await H.navTo(page, 'settings');
  await quiet(page);
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  for (let i = 0; i < 14 && (await focusId(page)) !== 'settings-logout-btn'; i++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 40);
  }
  expect(await focusId(page)).toBe('settings-logout-btn');
  await H.press(page, 'Enter');
  await page.waitForSelector('#logout-confirm');
  await H.settle(page, 150);
  for (let i = 0; i < 2 && (await page.evaluate(() => document.activeElement && document.activeElement.id)) !== 'confirm-logout' &&
      (await focusId(page)) !== 'confirm-logout'; i++) {
    await H.press(page, 'ArrowRight');
    await H.settle(page, 60);
  }
  await H.press(page, 'Enter');
  await page.waitForSelector('.login-screen');
  await quiet(page);

  // Login through the form: server (focused), port (empty), user, password.
  const origin = await page.evaluate(() => window.location.origin);
  await page.keyboard.type(origin);
  await H.press(page, 'Enter');
  await H.press(page, 'Enter');
  await page.keyboard.type('mockuser');
  await H.press(page, 'Enter');
  await page.keyboard.type('mockpass');
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'home');
  await quiet(page);
}

// Relaunch: the saved queue comes back, paused (resume, v3.10 A8). The
// init scripts run again on reload, so the log so far is returned first.
async function relaunch(page: Page) {
  const before = await page.evaluate(() => (window as any).__ID_LOG__);
  await page.reload();
  await H.waitForScreen(page, 'home');
  await page.waitForFunction(() => !!Player.getState().currentTrack, null, { timeout: 10000 });
  await quiet(page);
  return before;
}

test('R12.3 guard: a Navidrome session sends the previous release\'s requests', async ({ page }) => {
  test.setTimeout(240000);
  await trapFetch(page);
  const media = new Set<string>();
  const other = new Set<string>();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^\/rest\/(getCoverArt|stream)/.test(u.pathname)) media.add(norm(r.url()));
    else if (!/\$WEBAPIS/.test(decodeURIComponent(u.pathname)) && !STATIC.test(u.pathname) && u.protocol !== 'data:') other.add(norm(r.url()));
  });
  await walk(page);
  const first = await relaunch(page);
  const log: { url: string; method: string; body: string | null }[] =
    first.concat(await page.evaluate(() => (window as any).__ID_LOG__));
  const seen = {
    api: log.map((e) => e.method + ' ' + norm(e.url, e.body)).sort(),
    media: Array.from(media).sort(),
    other: Array.from(other).sort()
  };
  const out = process.env.SONANCE_IDENTITY_RECORD;
  if (out) {
    fs.writeFileSync(out, JSON.stringify(seen, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  expect(seen.other).toEqual(want.other);
  expect(seen.media).toEqual(want.media);
  expect(seen.api).toEqual(want.api);
});

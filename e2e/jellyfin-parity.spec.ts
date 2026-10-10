import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.13 (ticket-3.xx-jellyfin): the two backends side by side.
//
// R11, the two UI changes the user approved (user decision 1): on a
// Jellyfin session Settings -> Server's "API Version" reads
// "Jellyfin <version>" and the empty Playlists message names Jellyfin;
// Navidrome's strings are byte-identical to 3.12's (guards).

// Answers the playlist list as empty, in front of either mock.
async function noPlaylists(page: Page) {
  await page.addInitScript(() => {
    let current = window.fetch;
    const empty = (body: any) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const wrap = (fn: any) => function(this: any, input: any, init: any) {
      const url = typeof input === 'string' ? input : input.url;
      if (/\/rest\/getPlaylists\.view/.test(url)) return empty({ 'subsonic-response': { status: 'ok', version: '1.16.1', playlists: {} } });
      if (/\/Items\?.*IncludeItemTypes=Playlist/.test(url)) return empty({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
      return fn.apply(this, arguments);
    };
    Object.defineProperty(window, 'fetch', { configurable: true, get() { return current; }, set(v) { current = wrap(v); } });
  });
}

const apiVersion = (page: Page) => page.evaluate(() => {
  const rows = Array.prototype.slice.call(document.querySelectorAll('#page-current .settings-info-row'));
  const row = rows.filter((r: HTMLElement) => /API Version/.test((r.querySelector('.settings-info-label') as HTMLElement).textContent || ''))[0];
  return row ? (row.querySelector('.settings-info-value') as HTMLElement).textContent : null;
});

const pageText = (page: Page) => page.evaluate(() => (document.getElementById('page-current') as HTMLElement).innerText);

test.describe('R11 the sanctioned changes', () => {
  test('Settings API Version reads "Jellyfin <version>" on Jellyfin', async ({ page }) => {
    await H.bootJellyfin(page);
    await H.navTo(page, 'settings');
    expect(await apiVersion(page)).toBe('Jellyfin 12.2.0');
  });

  test('guard: Settings API Version reads "Subsonic 1.16.1" on Navidrome', async ({ page }) => {
    await H.bootMock(page);
    await H.navTo(page, 'settings');
    expect(await apiVersion(page)).toBe('Subsonic 1.16.1');
  });

  test('the empty Playlists message names Jellyfin on Jellyfin', async ({ page }) => {
    await noPlaylists(page);
    await H.bootJellyfin(page);
    await H.navTo(page, 'playlists');
    expect(await pageText(page)).toContain('No playlists found. Create playlists in your Jellyfin server.');
  });

  test('guard: the empty Playlists message names Navidrome on Navidrome', async ({ page }) => {
    await noPlaylists(page);
    await H.bootMock(page);
    await H.navTo(page, 'playlists');
    expect(await pageText(page)).toContain('No playlists found. Create playlists in your Navidrome server.');
  });
});

// --- R12.4: parity, screen by screen ------------------------------------------
//
// The visual baseline's states (tests/tools/visual-baseline.js), plus the
// options sheet's credits, each booted on both mocks with the same fixtures
// and driven by the same keys. Per state: the text of #page-current, the NP
// bar and any open overlay; a pixel diff of the viewport; and the Down-walk
// focus path from the state's focus. Differences are allowed only where a
// state says so, each one a sanctioned change (R11) or a data gap the
// capability matrix documents (ticket §9).

const FIX = { albums: 120, artists: 80, songs: 400 };

type Snap = { shot: Buffer; text: string; walk: string[]; errors: string[]; boxes: Record<string, number[]> };
type State = {
  name: string;
  extra?: string;
  noSession?: boolean;
  go: (p: Page) => Promise<void>;
  // Text normalisation for a documented difference, applied to both sides.
  norm?: (t: string) => string;
  // Selectors whose boxes may hold differing pixels (measured on Jellyfin).
  allow?: string[];
  // Extra assertions on the two raw texts.
  check?: (sub: string, jf: string) => void;
};

// P9: Home's "Your favourites" row is newest-starred-first on Navidrome and
// A-Z on Jellyfin (no favourited date). With more favourites than the row
// holds, the two rows show different ones: the row is compared by its card
// count, and Jellyfin's is checked to be the favourites (every fourth fixture
// album, album-1, -5 ...) in A-Z order. The row's cards, as text pairs.
function favourites(t: string) {
  const lines = t.split('\n');
  const i = lines.map((l) => l.trim().toLowerCase()).indexOf('your favourites');
  const pairs: string[] = [];
  let j = i + 1;
  while (i > -1 && j + 1 < lines.length && /^Album \d+$/.test(lines[j]) && /^[A-Z] Artist \d+$/.test(lines[j + 1])) {
    pairs.push(lines[j] + '\n' + lines[j + 1]);
    j += 2;
  }
  return { i, j, lines, pairs };
}
const favouritesSorted = (t: string) => {
  const f = favourites(t);
  if (f.i < 0) return t;
  return f.lines.slice(0, f.i + 1).concat(['<' + f.pairs.length + ' favourites>'], f.lines.slice(f.j)).join('\n');
};
// D198: a playlist card's total duration is not in Jellyfin's playlist list.
const noCardDuration = (t: string) => t.replace(/ · [0-9][^\n]*(hr|min)[^\n]*/g, '');
const homeNorm = (t: string) => noCardDuration(favouritesSorted(t));
const favouritesAZ = (sub: string, jf: string) => {
  const p = favourites(jf).pairs;
  expect(p.length).toBeGreaterThan(0);
  expect(p.length).toBe(favourites(sub).pairs.length);
  expect(p).toEqual(p.slice().sort());
  const index = (pair: string) => parseInt(pair.split('\n')[0].replace('Album ', ''), 10) - 1;
  expect(p.every((pair) => index(pair) % 4 === 1)).toBe(true);
  expect(index(p[0])).toBe(1);
};

async function bootState(p: Page, backend: string, s: State) {
  const opts: any = Object.assign({}, FIX, { extra: [s.extra, s.noSession ? 'mockNoSession=1' : ''].filter(Boolean).join('&') || undefined });
  if (s.noSession) opts.waitFor = false;
  if (backend === 'jellyfin') await H.bootJellyfin(p, opts); else await H.bootMock(p, opts);
  if (s.noSession) return;
  await p.evaluate(() => Player.setQueue((window as any).__MOCK__.songs.slice(0, 20), 0));
  await p.waitForFunction(() => !!Player.getState().currentTrack);
  await p.evaluate(() => { Player.pause(); Player.seekTo(0); });
  await H.settle(p, 250);
}

async function libraryTab(p: Page, downs: number) {
  await H.navTo(p, 'library');
  await H.press(p, 'ArrowDown');
  await H.settle(p, 250);
  if (!downs) return;
  await H.press(p, 'ArrowLeft');
  await H.settle(p, 100);
  for (let i = 0; i < downs; i++) { await H.press(p, 'ArrowDown'); await p.waitForTimeout(400); }
}

const lock = (p: Page) => p.waitForTimeout(350);

const STATES: State[] = [
  { name: 'home', go: async (p) => { await H.press(p, 'ArrowDown'); }, norm: homeNorm, check: favouritesAZ },
  { name: 'library-albums', go: (p) => libraryTab(p, 0) },
  { name: 'library-artists', go: (p) => libraryTab(p, 1) },
  { name: 'library-songs', go: (p) => libraryTab(p, 2) },
  { name: 'library-genres', go: (p) => libraryTab(p, 3) },
  { name: 'genre-detail', go: async (p) => { await libraryTab(p, 3); await H.press(p, 'ArrowRight'); await H.settle(p, 150); await H.press(p, 'Enter'); await lock(p); } },
  { name: 'album-detail', go: async (p) => { await libraryTab(p, 0); await H.press(p, 'Enter'); await H.waitForScreen(p, 'album'); } },
  { name: 'artist-detail', go: async (p) => { await libraryTab(p, 1); await H.press(p, 'ArrowRight'); await H.settle(p, 150); await H.press(p, 'Enter'); await H.waitForScreen(p, 'artist'); } },
  {
    name: 'playlists-grid',
    go: async (p) => { await H.navTo(p, 'playlists'); await H.press(p, 'ArrowDown'); },
    // D198: a playlist card's duration is not in Jellyfin's playlist list.
    norm: noCardDuration,
    allow: ['#page-current .playlist-card-count']
  },
  { name: 'playlist-detail', go: async (p) => { await H.navTo(p, 'playlists'); await H.press(p, 'ArrowDown'); await H.settle(p, 150); await H.press(p, 'Enter'); await lock(p); } },
  { name: 'queue', go: async (p) => { await H.navTo(p, 'queue'); await H.press(p, 'ArrowDown'); } },
  { name: 'search-empty', go: async (p) => { await H.navTo(p, 'search'); await H.press(p, 'ArrowDown'); } },
  {
    name: 'search-query',
    go: async (p) => {
      await H.navTo(p, 'search'); await H.press(p, 'ArrowDown'); await H.settle(p, 100);
      await H.press(p, 'ArrowDown', 2, 80); await H.press(p, 'ArrowRight', 1, 80); await H.press(p, 'Enter');
      await p.waitForTimeout(700);
      await H.press(p, 'ArrowUp', 1, 80); await H.press(p, 'ArrowRight', 7, 80); await H.press(p, 'Enter');
      await p.waitForTimeout(900);
    }
  },
  {
    name: 'settings-top',
    go: async (p) => { await H.navTo(p, 'settings'); await H.press(p, 'ArrowDown'); },
    // R11: the API Version row.
    norm: (t) => t.replace('Jellyfin 12.2.0', 'Subsonic 1.16.1'),
    allow: ['#page-current .settings-info-row.api-version-row']
  },
  { name: 'nowplaying', go: async (p) => { await H.navTo(p, 'nowplaying'); await H.press(p, 'ArrowDown'); } },
  {
    name: 'nowplaying-lyrics', extra: 'mockLyrics=1',
    go: async (p) => { await H.navTo(p, 'nowplaying'); await H.press(p, 'ArrowDown'); await H.settle(p, 150); await H.press(p, 'ArrowRight', 4); await H.press(p, 'Enter'); await p.waitForTimeout(700); }
  },
  { name: 'exit-dialog', go: async (p) => { await H.press(p, 'Escape'); }, norm: homeNorm, check: favouritesAZ },
  { name: 'login', noSession: true, go: async (p) => { await p.waitForSelector('.login-screen'); await H.splashGone(p); await p.waitForTimeout(500); } }
];

async function snap(browser: any, backend: string, s: State): Promise<Snap> {
  const p: Page = await browser.newPage({ baseURL: test.info().project.use.baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errs = H.watchErrors(p);
  await bootState(p, backend, s);
  await s.go(p);
  await H.settle(p, 1000);
  await p.waitForFunction(() => Array.prototype.every.call(document.images, (i: HTMLImageElement) => i.complete), null, { timeout: 10000 });
  await H.settle(p, 200);
  // The API Version row has no class of its own; mark it for the box.
  await p.evaluate(() => {
    Array.prototype.forEach.call(document.querySelectorAll('#page-current .settings-info-row'), (r: HTMLElement) => {
      if (/API Version/.test(r.textContent || '')) r.classList.add('api-version-row');
    });
  });
  // A capture once two in a row are identical: after a transition Chromium
  // re-rasters the NP bar's cover once more, and under the full suite's load
  // that landed inside a single capture (62 px in the art's box, once).
  let shot = await p.screenshot({ animations: 'disabled', caret: 'hide' });
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(250);
    const next = await p.screenshot({ animations: 'disabled', caret: 'hide' });
    if (next.equals(shot)) break;
    shot = next;
  }
  const text = await p.evaluate(() => ['#page-current', '#now-playing-bar', '#options-sheet', '#exit-dialog', '.login-screen']
    .map((sel) => { const e = document.querySelector(sel) as HTMLElement; return e ? sel + '\n' + e.innerText : ''; }).join('\n'));
  const boxes = await p.evaluate((sels: string[]) => {
    const out: Record<string, number[]> = {};
    sels.forEach((sel) => {
      Array.prototype.forEach.call(document.querySelectorAll(sel), (e: HTMLElement, i: number) => {
        const r = e.getBoundingClientRect();
        out[sel + '#' + i] = [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.right), Math.ceil(r.bottom)];
      });
    });
    return out;
  }, s.allow || []);
  const walk = (await H.downWalk(p, 40)).steps.map((f: any) => f.zone + '[' + f.index + ']' + (f.id ? '#' + f.id : ''));
  await p.close();
  return { shot, text, walk, errors: errs.pageErrors.concat(errs.badResponses), boxes };
}

// Differing pixels and their bounding box, decoded by Chromium.
async function diffPixels(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(async (x: { a: string; b: string }) => {
    async function decode(b64: string) {
      const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
    }
    const A = await decode(x.a);
    const B = await decode(x.b);
    if (A.w !== B.w || A.h !== B.h) return { n: -1, box: null, pts: [] as number[][] };
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const pts: number[][] = [];
    for (let i = 0; i < A.d.length; i += 4) {
      if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2]) {
        n++;
        const px = (i / 4) % A.w, py = Math.floor(i / 4 / A.w);
        if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py;
        if (pts.length < 20000) pts.push([px, py]);
      }
    }
    return { n, box: n ? [x0, y0, x1, y1] : null, pts };
  }, { a: a.toString('base64'), b: b.toString('base64') });
}

test.describe('R12.4 parity, screen by screen', () => {
  for (const s of STATES) {
    test(s.name, async ({ browser, page }) => {
      test.setTimeout(240000);
      await page.goto('/tests/mock-index.html?mockNoSession=1');
      // Text and focus paths are deterministic and checked on every capture.
      // Pixels: the login screen rasterises in one of two variants on either
      // backend at random (its card's left edge, 34 px; measured: 1 of 6
      // Navidrome loads and 2 of 6 Jellyfin loads in the other one; the 3.12
      // report saw it too). So the backends match when ANY Navidrome capture
      // is clean against ANY Jellyfin capture, up to 5 fresh captures a side.
      // A real difference matches no pair; every other state matches at once.
      const subs: Snap[] = [];
      const jfs: Snap[] = [];
      const tries: string[] = [];
      let found: { n: number; outside: number } | null = null;
      for (let attempt = 1; attempt <= 5 && !found; attempt++) {
        const sub = await snap(browser, 'subsonic', s);
        const jf = await snap(browser, 'jellyfin', s);
        expect(sub.errors, 'subsonic errors').toEqual([]);
        expect(jf.errors, 'jellyfin errors').toEqual([]);
        const norm = s.norm || ((t: string) => t);
        expect(norm(jf.text)).toBe(norm(sub.text));
        if (s.check) s.check(sub.text, jf.text);
        expect(jf.walk).toEqual(sub.walk);
        subs.push(sub);
        jfs.push(jf);
        // The pairs this attempt adds: the new captures against every earlier one.
        const pairs: [Snap, Snap][] = [[sub, jf]];
        subs.slice(0, -1).forEach((x) => pairs.push([x, jf]));
        jfs.slice(0, -1).forEach((y) => pairs.push([sub, y]));
        for (const [a, b] of pairs) {
          const d = await diffPixels(page, a.shot, b.shot);
          const boxes = Object.keys(b.boxes).map((k) => b.boxes[k]);
          const outside = d.pts.filter((pt) => !boxes.some((bx) => pt[0] >= bx[0] && pt[0] <= bx[2] && pt[1] >= bx[1] && pt[1] <= bx[3]));
          tries.push(d.n + ' px, box ' + JSON.stringify(d.box) + ', outside ' + outside.length);
          if (outside.length === 0 && (!!s.allow || d.n === 0)) { found = { n: d.n, outside: 0 }; break; }
        }
      }
      test.info().annotations.push({ type: 'pixel diff', description: s.name + ': ' + tries.join(' | ') });
      expect(found, s.name + ' no clean pair of captures: ' + tries.join(' | ')).not.toBe(null);
    });
  }

  test('the options sheet\'s credits: equal but for the documented gaps', async ({ browser }) => {
    const open = async (backend: string) => {
      const p: Page = await browser.newPage({ baseURL: test.info().project.use.baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      if (backend === 'jellyfin') await H.bootJellyfin(p); else await H.bootMock(p);
      // Home -> Recently Added, the fourth card (album-10, not a favourite).
      await p.evaluate(() => FocusManager.setActiveZone('home-newest', 3, true));
      await H.settle(p, 100);
      await H.press(p, 'Enter');
      await H.waitForScreen(p, 'album');
      await p.waitForFunction(() => FocusManager.getActiveZone() === 'album-tracks');
      await H.settle(p, 300);
      const cdp = await p.context().newCDPSession(p);
      const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, key) as any);
      await p.waitForTimeout(900);
      await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, key) as any);
      await p.waitForSelector('#options-sheet');
      const items: string[] = await p.evaluate(() => Array.prototype.map.call(
        document.querySelectorAll('#options-sheet .options-sheet-item'), (e: HTMLElement) => e.getAttribute('data-action')));
      for (let i = 0; i < items.indexOf('credits'); i++) await H.press(p, 'ArrowDown', 1, 40);
      await H.press(p, 'Enter');
      await p.waitForTimeout(800);
      const t = await p.evaluate(() => (document.getElementById('options-sheet') as HTMLElement).innerText);
      await p.close();
      return t;
    };
    const sub = await open('subsonic');
    const jf = await open('jellyfin');
    // Jellyfin has no performer sub-roles, no BPM and no original release
    // year (capability matrix, "Credits panel: partial").
    const gaps = (t: string) => {
      const lines = t.split('\n');
      const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^(vocals|guitar|bpm)$/i.test(lines[i].trim())) { i++; continue; }   // the label and its value
        out.push(lines[i]);
      }
      return out.join('\n').replace(/ · originally \d{4}/, '');
    };
    expect(gaps(jf)).toBe(gaps(sub));
    expect(jf.toLowerCase()).toContain('written by');
  });
});

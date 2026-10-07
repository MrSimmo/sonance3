import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// R1.6 (S5): when a virtual grid's visible range moves one row, only the
// nodes that left are removed and only those that entered are created.
// Measured with a MutationObserver over #app: per Down step, how many of the
// previously mounted items are still connected ("kept"), how many elements
// were added ("created"), how many of them were <img>. S1-S4 encoded the
// target as a test.fail with a [today] twin (a whole-band rebuild per row
// step: kept 0, 252-631 elements created at 150 %); S5 flipped it.

type Step = { mountedBefore: number; kept: number; mounted: number; created: number; imgs: number; index: number };

async function watchCreated(page: Page) {
  await page.evaluate(() => {
    (window as any).__created = { els: 0, imgs: 0 };
    new MutationObserver((recs) => {
      for (const r of recs) {
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const e = n as Element;
          (window as any).__created.els += 1 + e.querySelectorAll('*').length;
          (window as any).__created.imgs += (e.tagName === 'IMG' ? 1 : 0) + e.querySelectorAll('img').length;
        });
      }
    }).observe(document.getElementById('app')!, { childList: true, subtree: true });
  });
}

async function measureSteps(page: Page, n: number, itemSel: string) {
  await watchCreated(page);
  const steps: Step[] = [];
  for (let s = 0; s < n; s++) {
    const before = await page.evaluate((sel) => {
      (window as any).__before = Array.from(document.querySelectorAll(sel));
      (window as any).__created = { els: 0, imgs: 0 };
      return (window as any).__before.length;
    }, itemSel);
    await H.press(page, 'ArrowDown');
    await H.settle(page, 120);
    const r = await page.evaluate((sel) => ({
      kept: (window as any).__before.filter((x: Element) => x.isConnected).length,
      mounted: document.querySelectorAll(sel).length,
      created: (window as any).__created.els,
      imgs: (window as any).__created.imgs,
      index: FocusManager.snapshot().index,
    }), itemSel);
    steps.push(Object.assign({ mountedBefore: before }, r));
  }
  test.info().annotations.push({ type: 'steps', description: JSON.stringify(steps) });
  return steps;
}

// One column count and one item's element count, read from the rendered grid.
async function geometry(page: Page, itemSel: string) {
  return page.evaluate((sel) => {
    const card = document.querySelector(sel)!;
    const grid = card.parentElement!;
    const tpl = getComputedStyle(grid).gridTemplateColumns;
    return {
      cols: tpl && tpl !== 'none' ? tpl.split(' ').length : 1,
      perCard: 1 + card.querySelectorAll('*').length,
    };
  }, itemSel);
}

function expectIncremental(steps: Step[], cols: number, perCard: number) {
  const moved = steps.filter((s) => s.created > 0);
  // The band must actually move during the walk, or nothing is measured.
  expect(moved.length).toBeGreaterThan(0);
  for (const s of steps) {
    expect(s.kept).toBeGreaterThanOrEqual(s.mountedBefore - 2 * cols);
    expect(s.created).toBeLessThanOrEqual(2 * cols * perCard);
    expect(s.imgs).toBeLessThanOrEqual(2 * cols);
  }
}

// Down to the last row, then Up to the first, checking after every press
// that the focused node exists, is connected, sits in `containerSel`, is the
// item FocusManager thinks it is, and is inside the scroll viewport (layout
// box, not the transformed rect: the focus scale is mid-transition). Items
// are identified by `idAttr`; every index must show one id, the same on the
// way down and back up, and no id may appear at two indices. Also samples
// LazyLoader.observedCount() against the lazy images actually mounted:
// recycled images must be released (D17), so only mounted ones can be
// observed.
async function traverse(page: Page, zone: string, containerSel: string, scrollerSel: string, idAttr: string, maxPresses: number) {
  const check = () => page.evaluate((a) => {
    const f = FocusManager.getCurrentFocused() as HTMLElement | null;
    const snap = FocusManager.snapshot();
    const sc = document.querySelector(a.scrollerSel)!;
    let inView = false;
    if (f) {
      const r = f.getBoundingClientRect(), s = sc.getBoundingClientRect();
      const cy = (r.top + r.bottom) / 2, half = f.offsetHeight / 2;
      inView = cy - half >= s.top - 1 && cy + half <= s.bottom + 1;
    }
    return {
      zone: snap.zone, index: snap.index,
      ok: !!f && f.isConnected && !!f.closest(a.containerSel) && inView,
      id: f ? f.getAttribute(a.idAttr) : null,
      observed: LazyLoader.observedCount(),
      mountedLazy: document.querySelectorAll(a.containerSel + ' img.lazy-art').length,
    };
  }, { containerSel, scrollerSel, idAttr });
  const idAt: Record<number, string> = {};
  const fails: any[] = [];
  let checks = 0, maxIndex = 0, maxObserved = 0, maxMountedLazy = 0, overObserved = 0;
  const record = (c: any, dir: string) => {
    checks++;
    maxObserved = Math.max(maxObserved, c.observed);
    maxMountedLazy = Math.max(maxMountedLazy, c.mountedLazy);
    if (c.observed > c.mountedLazy) overObserved++;
    let ok = c.ok && c.zone === zone;
    if (ok && c.id !== null) {
      if (idAt[c.index] === undefined) idAt[c.index] = c.id;
      else if (idAt[c.index] !== c.id) ok = false;
    }
    if (!ok) fails.push(Object.assign({ dir }, c));
  };
  record(await check(), 'start');
  for (let i = 0; i < maxPresses; i++) {
    const before = await page.evaluate(() => FocusManager.snapshot());
    await H.press(page, 'ArrowDown');
    await H.settle(page, 30);
    await H.scrollIdle(page);    // R1.8: a smooth scroll must finish first
    let c = await check();
    if (c.zone !== zone) { await H.press(page, 'ArrowUp'); await H.settle(page, 60); break; }
    if (c.index === before.index) {
      // The last loaded row of a paged grid: the next page may still be on
      // its way. One more try before calling it the end.
      await page.waitForTimeout(300);
      await H.press(page, 'ArrowDown');
      await H.settle(page, 30);
      await H.scrollIdle(page);
      c = await check();
      if (c.zone !== zone || c.index === before.index) break;
    }
    record(c, 'down');
    maxIndex = Math.max(maxIndex, c.index);
  }
  for (let i = 0; i < maxPresses; i++) {
    const before = await page.evaluate(() => FocusManager.snapshot());
    await H.press(page, 'ArrowUp');
    await H.settle(page, 30);
    await H.scrollIdle(page);
    const c = await check();
    if (c.zone !== zone) break;
    if (c.index === before.index) break;
    record(c, 'up');
  }
  const ids = Object.keys(idAt).map((k) => idAt[+k]);
  const dupIds = ids.length - new Set(ids).size;
  const out = { checks, failures: fails.length, maxIndex, dupIds, maxObserved, maxMountedLazy, overObserved, fails: fails.slice(0, 5) };
  test.info().annotations.push({ type: 'traversal', description: JSON.stringify(out) });
  return out;
}

async function enterAlbums(page: Page) {
  await H.bootMock(page, { albums: 1200, artists: 80, songs: 400 });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 400);
}

async function enterArtists(page: Page) {
  await H.bootMock(page, { albums: 60, artists: 300, songs: 100 });
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');          // into the Albums grid
  await H.settle(page, 400);
  await H.press(page, 'ArrowLeft');          // to the sub-nav
  await H.press(page, 'ArrowDown');          // Artists, after the dwell
  await page.waitForTimeout(450);
  await H.press(page, 'ArrowRight');         // into the grid
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid' &&
    !!document.querySelector('.artist-grid-card.focused'));
  await H.settle(page, 200);
}

// Search: with 5 of 6 libraries in scope the song section has 5 x 10 = 50
// results, above SEARCH_VIRTUAL_THRESHOLD (30), so it is a VirtualGrid (the
// D40 branch). Typed on the on-screen keyboard: "T" matches every artist
// ("X Artist n") and every song ("Track n").
async function enterSearch(page: Page) {
  await H.bootMock(page, {
    albums: 60, artists: 60, songs: 600, libraries: 6,
    storage: { sonance_selected_libraries: JSON.stringify(['1', '2', '3', '4', '5']) },
  });
  await H.navTo(page, 'search');
  await H.press(page, 'ArrowDown');          // keyboard, on A
  await H.settle(page, 100);
  await H.press(page, 'ArrowDown', 2, 80);   // S
  await H.press(page, 'ArrowRight', 1, 80);  // T
  await H.press(page, 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.search-section-virtual-mount').length > 0,
    null, { timeout: 5000 });
  await H.settle(page, 200);
  // Right from the keyboard's last column enters the results.
  for (let i = 0; i < 9; i++) {
    if ((await H.focus(page)).zone === 'search-results') break;
    await H.press(page, 'ArrowRight', 1, 60);
  }
  expect((await H.focus(page)).zone).toBe('search-results');
}

test('[R1.6] Albums: each one-row step keeps >= mounted - 2*cols and creates <= 2*cols cards', async ({ page }) => {
  await enterAlbums(page);
  const geom = await geometry(page, '.album-grid-card');
  test.info().annotations.push({ type: 'geometry', description: JSON.stringify(geom) });
  const steps = await measureSteps(page, 12, '.album-grid-card');
  expectIncremental(steps, geom.cols, geom.perCard);
  // Focus integrity while paging: one row per press. v3.10 S2: one row is
  // the CSS-resolved column count (8 at 100 %, 6 at 150 %), not a literal 8.
  steps.forEach((s, i) => expect(s.index).toBe(geom.cols * (i + 1)));
});

test('[R1.6] Albums: full traversal both ways, 0 integrity failures, LazyLoader bounded', async ({ page }) => {
  test.setTimeout(240000);
  await enterAlbums(page);
  const t = await traverse(page, 'library-grid', '#library-grid', '#library-content', 'data-vg-index', 400);
  expect(t.maxIndex).toBeGreaterThanOrEqual(1200 - 8);
  expect(t.failures).toBe(0);
  expect(t.dupIds).toBe(0);
  expect(t.overObserved).toBe(0);
});

test('[R1.6] Artists (virtual above 80): incremental steps and a clean traversal', async ({ page }) => {
  test.setTimeout(180000);
  await enterArtists(page);
  const geom = await geometry(page, '.artist-grid-card');
  test.info().annotations.push({ type: 'geometry', description: JSON.stringify(geom) });
  const steps = await measureSteps(page, 10, '.artist-grid-card');
  expectIncremental(steps, geom.cols, geom.perCard);
  steps.forEach((s, i) => expect(s.index).toBe(geom.cols * (i + 1)));
  await page.evaluate(() => FocusManager.setActiveZone('library-grid', 0, true));
  await H.settle(page, 200);
  const t = await traverse(page, 'library-grid', '#library-grid', '#library-content', 'data-vg-index', 200);
  expect(t.maxIndex).toBeGreaterThanOrEqual(300 - geom.cols);
  expect(t.failures).toBe(0);
  expect(t.dupIds).toBe(0);
  expect(t.overObserved).toBe(0);
});

test('[R1.6] Search virtual branch (D40): incremental steps and a clean traversal', async ({ page }) => {
  test.setTimeout(120000);
  await enterSearch(page);
  const counts = await page.evaluate(() => ({
    rows: document.querySelectorAll('#search-results-list .search-result-item').length,
    label: document.querySelector('.search-section-label')!.textContent,
  }));
  test.info().annotations.push({ type: 'search', description: JSON.stringify(counts) });
  const t = await traverse(page, 'search-results', '#search-results-list', '.search-right', 'data-id', 120);
  // 25 artists + 50 songs: every result reached, each once.
  expect(t.maxIndex).toBe(74);
  expect(t.failures).toBe(0);
  expect(t.dupIds).toBe(0);
  // Then the per-step cost inside the virtual section (rows 30-45).
  await page.evaluate(() => FocusManager.setActiveZone('search-results', 30, true));
  await H.settle(page, 200);
  const geom = await geometry(page, '.search-section-virtual-mount .search-result-item');
  const steps = await measureSteps(page, 15, '.search-section-virtual-mount .search-result-item');
  expectIncremental(steps, 1, geom.perCard);
});

// D11 (S5, found in S2): the Artists grid's columns and row pitch come from
// the rendered grid, as the Albums grid's always did. It used the px(180)
// estimate (the real pitch is 186 px at 100 %, 277 at 150 %, 368 at 200 %),
// so deep rows drifted away from where the band's translateY put them.
test('[D11] Artists grid: a deep row is where the band arithmetic says', async ({ page }) => {
  await enterArtists(page);
  for (let i = 0; i < 30; i++) await H.press(page, 'ArrowDown', 1, 40);
  await H.scrollIdle(page);
  const r = await page.evaluate(() => {
    const f = FocusManager.getCurrentFocused() as HTMLElement;
    const band = f.parentElement!;
    const cols = getComputedStyle(band).gridTemplateColumns.split(' ').length;
    const cards = band.children as HTMLCollectionOf<HTMLElement>;
    const pitch = cards[cols].offsetTop - cards[0].offsetTop;
    const idx = parseInt(f.getAttribute('data-vg-index')!, 10);
    const first = parseInt(cards[0].getAttribute('data-vg-index')!, 10);
    // translateY of the band = first row x itemHeight; the focused card's
    // offset inside the band = its row within the band x the real pitch.
    const ty = parseFloat((band.style.transform.match(/translateY\(([-\d.]+)px\)/) || [])[1] || '0');
    return { idx, row: Math.floor(idx / cols), firstRow: Math.floor(first / cols), pitch, ty };
  });
  test.info().annotations.push({ type: 'geometry', description: JSON.stringify(r) });
  expect(r.row).toBeGreaterThanOrEqual(29);
  expect(Math.abs(r.ty - r.firstRow * r.pitch)).toBeLessThanOrEqual(1);
});

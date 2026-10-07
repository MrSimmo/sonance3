import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';
import * as G from './helpers/geometry';

// R6 (ticket-3.10 §6.3, §7 R6, D50): the v4 "stronger pink" focus. Solid
// --focus-fill, a computed --focus-ink, card scale 1.12 with a ring, and
// colour/background that snap. Design spec: docs/UI-MOCKUP-REFERENCE.md
// Part 1 "Focus (v4, R6, D50)".

// --- colour maths (WCAG 2) ---
function parseColour(s: string): number[] {
  s = s.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) return m[1].split(',').slice(0, 3).map((v) => parseFloat(v));
  throw new Error('unparsed colour ' + s);
}
function luminance(rgb: number[]): number {
  const c = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: number[], b: number[]): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function tokens(page: Page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      accent: cs.getPropertyValue('--accent').trim(),
      fill: cs.getPropertyValue('--focus-fill').trim(),
      ink: cs.getPropertyValue('--focus-ink').trim(),
      soft: cs.getPropertyValue('--focus-ink-soft').trim(),
    };
  });
}

test('R6 tokens: the Pink defaults hold from :root before any accent is applied', async ({ page }) => {
  await H.bootMock(page, { storage: { 'sonance-accent-color': null, 'sonance-accent-rgb': null } });
  const t = await tokens(page);
  expect(t.accent).toBe('#e44d8a');
  // --focus-fill is var(--accent) in :root; a custom property's computed
  // value keeps the var() token, so resolve it through a real element.
  const fill = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.background = 'var(--focus-fill)';
    document.body.appendChild(d);
    const v = getComputedStyle(d).backgroundColor;
    d.remove();
    return v;
  });
  expect(fill).toBe('rgb(228, 77, 138)');
  expect(t.ink).toBe('#ffffff');
  expect(t.soft).toBe('rgba(255, 255, 255, 0.86)');
});

test('R6 all 8 accent presets: --focus-ink on --focus-fill is at least 3:1 (chosen through Settings)', async ({ page }) => {
  test.setTimeout(60000);
  await H.bootMock(page);
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  expect((await H.focus(page)).zone).toBe('content');
  const presets = await page.evaluate(() => Array.from(document.querySelectorAll('.accent-swatch')).map((s) =>
    ({ name: s.getAttribute('aria-label'), hex: s.getAttribute('data-hex') })));
  expect(presets.length).toBe(8);
  const rows: string[] = [];
  const darkInk = ['Orange', 'Amber', 'Green', 'Teal'];
  for (let i = 0; i < presets.length; i++) {
    await page.evaluate((idx) => FocusManager.setActiveZone('content', idx, true), i);
    await H.press(page, 'Enter');
    await H.settle(page, 50);
    const t = await tokens(page);
    expect(t.fill.toLowerCase()).toBe(presets[i].hex!.toLowerCase());
    const ratio = contrast(parseColour(t.ink), parseColour(t.fill));
    rows.push(presets[i].name + ' ' + t.fill + ' ink ' + t.ink + ' ' + ratio.toFixed(2) + ':1');
    expect(ratio, presets[i].name!).toBeGreaterThanOrEqual(3);
    // D50's table: white ink on Pink, Red, Blue, Purple; dark on the rest.
    expect(t.ink, presets[i].name!).toBe(darkInk.indexOf(presets[i].name!) >= 0 ? '#15151c' : '#ffffff');
    expect(t.soft, presets[i].name!).toBe(darkInk.indexOf(presets[i].name!) >= 0 ? 'rgba(21, 21, 28, 0.86)' : 'rgba(255, 255, 255, 0.86)');
  }
  // The applied rule, not just the variables: a focused toggle row's fill
  // and label take the last preset's values (Purple).
  await page.evaluate(() => FocusManager.setActiveZone('settings-actions', 1, true));
  await H.settle(page, 50);
  const applied = await page.evaluate(() => {
    const row = FocusManager.getCurrentFocused() as HTMLElement;
    return { bg: getComputedStyle(row).backgroundColor, label: getComputedStyle(row.querySelector('.settings-toggle-label')!).color };
  });
  expect(applied.bg).toBe('rgb(139, 92, 246)');
  expect(applied.label).toBe('rgb(255, 255, 255)');
  test.info().annotations.push({ type: 'contrast', description: rows.join(' | ') });
});

// Every `.focused` rule in the stylesheet, read through the CSSOM.
async function focusedRules(page: Page) {
  return page.evaluate(() => {
    const out: { sel: string; css: string }[] = [];
    const all: { sel: string; css: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of Array.from(rules)) {
        const sr = r as CSSStyleRule;
        if (!sr.selectorText) continue;
        all.push({ sel: sr.selectorText, css: sr.style.cssText });
        if (/\.focused/.test(sr.selectorText)) out.push({ sel: sr.selectorText, css: sr.style.cssText });
      }
    }
    return { focused: out, all };
  });
}

test('R6 CSS audit: every .focused rule uses the v4 tokens; no outline focus, no colour or background transition', async ({ page }) => {
  await H.bootMock(page);
  const { focused, all } = await focusedRules(page);
  test.info().annotations.push({ type: 'focused-rules', description: String(focused.length) });
  expect(focused.length).toBeGreaterThan(60);
  for (const r of focused) {
    // No outline ring: only `outline: none` (UA reset) is allowed.
    const outline = /(?:^|;\s*)outline(?:-[a-z]+)?:\s*([^;]+)/.exec(r.css);
    if (outline) expect(outline[1].trim(), r.sel).toMatch(/^(none|0|medium none)/);
    // A background on focus is the focus fill, or the ink for an icon drawn
    // on it (the checked box, the equaliser bars); the swatch is D74.
    const bg = /(?:^|;\s*)background(?:-color)?:\s*([^;]+)/.exec(r.css);
    if (bg && !/accent-swatch/.test(r.sel)) expect(bg[1], r.sel).toMatch(/var\(--focus-(fill|ink)\)/);
    // Colours on focus are focus tokens, or white for card labels and the
    // nav items (whose on-pill colour comes from D71's sibling rule).
    const colour = /(?:^|;\s*)color:\s*([^;]+)/.exec(r.css);
    if (colour && !/var\(--focus-ink(-soft)?\)/.test(colour[1])) {
      expect(colour[1].trim(), r.sel).toMatch(/^(white|#fff|rgb\(255, 255, 255\))$/);
      expect(r.sel, 'white on focus').toMatch(/top-nav-item|library-subnav-item|card.*title|card.*name|grid-name/);
    }
  }
  // No colour or background transition anywhere (colour snaps, §5.2).
  for (const r of all) {
    const tr = /(?:^|;\s*)transition(?:-property)?:\s*([^;]+)/.exec(r.css);
    if (tr) expect(tr[1], r.sel).not.toMatch(/background|(^|[\s,])color/);
  }
  // The six row types share the row focus.
  const bySel = (s: string) => focused.find((r) => r.sel === s);
  for (const row of ['.track-row', '.song-row', '.queue-row', '.search-result-item', '.artist-album-row', '.settings-library-row']) {
    const r = bySel(row + '.focused');
    expect(r, row).toBeTruthy();
    expect(r!.css, row).toMatch(/background: var\(--focus-fill\)/);
    expect(r!.css, row).toMatch(/transform: scale\(1\.02\)/);
  }
  // D71: the pill labels follow the pills.
  expect(all.some((r) => /#top-nav-pill\.focused ~ \.top-nav-items \.top-nav-item\.selected/.test(r.sel) && /var\(--focus-ink\)/.test(r.css))).toBe(true);
  expect(all.some((r) => /\.library-subnav-pill\.focused ~ \.library-subnav-item\.selected/.test(r.sel) && /var\(--focus-ink\)/.test(r.css))).toBe(true);
});

test('R6 D6: the three card classes keep translateZ(0) at rest and when focused; cards scale 1.12 with a ring', async ({ page }) => {
  await H.bootMock(page, { artists: 100 });
  const { all } = await focusedRules(page);
  for (const card of ['.album-card', '.album-grid-card', '.artist-grid-card']) {
    const rest = all.find((r) => r.sel === card);
    const foc = all.find((r) => r.sel === card + '.focused');
    expect(rest && rest.css, card).toMatch(/transform: translateZ\(0(px)?\)/);
    expect(foc && foc.css, card + '.focused').toMatch(/transform: scale\(1\.12\) translateZ\(0(px)?\)/);
  }
  // Applied: a focused album grid card, its ring and its label.
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 300);
  await G.settled(page);
  const got = await page.evaluate(() => {
    const card = FocusManager.getCurrentFocused() as HTMLElement;
    const art = card.querySelector('.album-art-fill') as HTMLElement;
    const title = card.querySelector('.album-grid-title') as HTMLElement;
    const other = document.querySelectorAll('#library-grid .album-grid-card')[1].querySelector('.album-grid-title') as HTMLElement;
    return {
      transform: getComputedStyle(card).transform,
      ring: getComputedStyle(art).boxShadow,
      title: [getComputedStyle(title).color, getComputedStyle(title).fontWeight],
      rest: [getComputedStyle(other).color, getComputedStyle(other).fontWeight],
    };
  });
  // scale(1.12) translateZ(0) computes to a 3D matrix with 1.12 on the diagonal
  expect(got.transform).toMatch(/^matrix(3d)?\(1\.12, 0, 0, (0, 0, )?1\.12/);
  expect(got.ring).toMatch(/rgb\(228, 77, 138\) 0px 0px 0px \d+(\.\d+)?px/);
  expect(got.title).toEqual(['rgb(255, 255, 255)', '700']);
  expect(got.rest).toEqual(['rgba(240, 240, 245, 0.72)', '500']);
});

test('R6 D71: the nav pills and their labels always agree', async ({ page }) => {
  // Amber's ink is dark, so a label on the focused pill (dark) and a label
  // on the selected pill (white) are distinguishable; with Pink both are white.
  await H.bootMock(page, { storage: { 'sonance-accent-color': '#f59e0b', 'sonance-accent-rgb': '245, 158, 11' } });
  const DARK = 'rgb(21, 21, 28)', WHITE = 'rgb(255, 255, 255)';
  const log: string[] = [];
  const mismatches: string[] = [];
  async function check(step: string) {
    await H.settle(page, 40);
    const r = await page.evaluate(() => {
      function one(pillSel: string, itemSel: string) {
        const pill = document.querySelector(pillSel);
        const item = document.querySelector(itemSel + '.selected');
        if (!pill || !item) return null;
        return { focused: pill.classList.contains('focused'), colour: getComputedStyle(item).color };
      }
      return { top: one('#top-nav-pill', '.top-nav-item'), sub: one('#library-subnav-pill', '.library-subnav-item'),
        zone: FocusManager.getActiveZone() };
    });
    for (const k of ['top', 'sub'] as const) {
      const v = r[k];
      if (!v) continue;
      log.push(step + ':' + k + (v.focused ? '=focused' : '=selected'));
      if (v.colour !== (v.focused ? DARK : WHITE)) mismatches.push(step + ' ' + k + ' ' + JSON.stringify(v));
    }
    // Exactly one pill is in the focused state, and only while its nav has focus.
    if (r.top && r.top.focused !== (r.zone === 'topnav')) mismatches.push(step + ' top pill vs zone ' + r.zone);
    if (r.sub && r.sub.focused !== (r.zone === 'library-subnav')) mismatches.push(step + ' sub pill vs zone ' + r.zone);
  }
  await check('boot');
  await H.navTo(page, 'library');
  await check('nav to library');
  await H.press(page, 'ArrowDown'); await check('down into grid');
  await H.press(page, 'ArrowLeft'); await check('left to sub-nav');
  await H.press(page, 'ArrowDown'); await page.waitForTimeout(350); await check('sub-nav down');
  await H.press(page, 'ArrowRight'); await page.waitForTimeout(200); await check('right into content');
  await H.press(page, 'ArrowLeft'); await check('back to sub-nav');
  await H.press(page, 'ArrowUp'); await page.waitForTimeout(350); await check('sub-nav up');
  await H.press(page, 'ArrowUp'); await check('sub-nav up to top nav');
  await H.press(page, 'ArrowRight'); await page.waitForTimeout(350); await check('top nav right');
  test.info().annotations.push({ type: 'states', description: log.join(' ') });
  expect(log.some((l) => l.endsWith('top=focused'))).toBe(true);
  expect(log.some((l) => l.endsWith('sub=focused'))).toBe(true);
  expect(mismatches).toEqual([]);
});

// The S2 focus-clip inventory (docs/UI-MOCKUP-REFERENCE.md "Known
// discrepancies") plus the scroll-edge card: after S3 nothing a focus
// transform overhangs is cut by a clipping container (D76). v3.10 S5 (D84,
// D108): also at 175 %, and the states that were cut there and at 200 %:
// the Queue's Now Playing card, the keyboard's last keys and row, and the
// album and artist columns' last button.
for (const scale of [1, 1.5, 1.75, 2]) {
  test(`D76 focus transforms are not clipped at ${scale * 100}%`, async ({ page }) => {
    test.setTimeout(90000);
    const clips: string[] = [];
    async function measureAt(label: string) {
      await H.settle(page, 40);
      await H.scrollIdle(page);    // R1.8: a smooth focus-follow must finish
      await G.settled(page).catch(() => {});
      const m = await G.measure(page);
      if (m.focusClip.length) clips.push(label + ': ' + m.focusClip.join('; '));
    }
    await H.bootMock(page, { scale, albums: 60, songs: 30, libraries: 3 });
    await H.startTrack(page, 20, { paused: true });
    // Settings: swatch 0, Logout, a library row
    await H.navTo(page, 'settings');
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true)); await measureAt('swatch 0');
    await page.evaluate(() => FocusManager.setActiveZone('settings-actions', 999, true)); await measureAt('logout');
    await page.evaluate(() => FocusManager.setActiveZone('settings-libraries', 0, true)); await measureAt('library row');
    // Search: key A and the space bar (first column)
    await H.navTo(page, 'search');
    await page.evaluate(() => FocusManager.setActiveZone('content', 0, true)); await measureAt('key A');
    await page.evaluate(() => FocusManager.setActiveZone('content', 9, true)); await measureAt('key J');
    await page.evaluate(() => FocusManager.setActiveZone('content', 35, true)); await measureAt('key 9');
    await page.evaluate(() => FocusManager.setActiveZone('search-special', 0, true)); await measureAt('space');
    await page.evaluate(() => FocusManager.setActiveZone('search-special', 1, true)); await measureAt('del');
    // Queue: a row, and the Now Playing card
    await H.navTo(page, 'queue');
    await page.evaluate(() => FocusManager.setActiveZone('queue-list', 0, true)); await measureAt('queue row');
    await page.evaluate(() => FocusManager.setActiveZone('queue-card', 0, true)); await measureAt('queue card');
    // Albums grid: the scroll edge after Down x3
    await H.navTo(page, 'library');
    await H.press(page, 'ArrowDown'); await H.settle(page, 300);
    await H.press(page, 'ArrowDown', 3, 150); await measureAt('albums Down x3');
    // Artist: a discography row
    await H.press(page, 'Enter'); await H.waitForScreen(page, 'album'); await page.waitForTimeout(400);
    await page.evaluate(() => FocusManager.setActiveZone('content', 999, true)); await measureAt('album Shuffle');
    await page.evaluate(() => {
      const els = document.querySelectorAll('.album-detail-left .focusable');
      FocusManager.setActiveZone('content', Array.prototype.indexOf.call(els, document.querySelector('.album-detail-artist.focusable')), true);
    });
    await H.press(page, 'Enter'); await H.waitForScreen(page, 'artist'); await page.waitForTimeout(800);
    await page.evaluate(() => FocusManager.setActiveZone('artist-albums', 0, true)); await measureAt('artist row');
    await page.evaluate(() => FocusManager.setActiveZone('content', 999, true)); await measureAt('artist Shuffle');
    expect(clips).toEqual([]);
  });
}

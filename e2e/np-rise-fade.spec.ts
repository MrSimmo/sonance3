import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.10-fix2 F1 (D152): Now Playing's rise and sink fade the page under it.
// TV report, 2026-10-05: "Transition into now playing leaves the previous
// screen hanging and then it disappears in an instant". The rise left the
// ghost still at full opacity under a Now Playing that is not opaque (Solid
// background), and cleanup removed it in one step ~280 ms later. Now the
// ghost stays still and fades 1 -> 0 over the rise; on Back the incoming
// page fades 0 -> 1, without moving, as Now Playing sinks.

type Sample = { t: number; op: number | null };

// From the next keydown, sample `sel`'s computed opacity on every frame
// until it leaves the DOM (or 600 ms). t is ms after the keydown.
async function sampleFrom(page: Page, sel: string) {
  await page.evaluate((s) => {
    const w = window as any;
    w.__samples = [];
    w.__sampling = true;
    document.addEventListener('keydown', function start() {
      document.removeEventListener('keydown', start, true);
      const t0 = performance.now();
      function tick() {
        const n = document.querySelector(s) as HTMLElement | null;
        const t = performance.now() - t0;
        w.__samples.push({ t, op: n ? parseFloat(getComputedStyle(n).opacity) : null });
        if ((n || w.__samples.length < 3) && t < 600) requestAnimationFrame(tick);
        else w.__sampling = false;
      }
      tick();
    }, true);
  }, sel);
}

async function samples(page: Page): Promise<Sample[]> {
  await page.waitForFunction(() => !(window as any).__sampling, null, { timeout: 3000 });
  return page.evaluate(() => (window as any).__samples);
}

async function toTheBar(page: Page) {
  await H.bootMock(page);
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 200);
  await H.startTrack(page, 3, { paused: true });
  const walk = await H.downWalk(page, 20);
  expect(walk.zones[walk.zones.length - 1]).toBe('nowplaying-bar');
}

test('F1 the page under a rising Now Playing fades 1 -> 0 and is gone by the end (D152)', async ({ page }) => {
  await toTheBar(page);
  await sampleFrom(page, '.page-ghost');
  await page.keyboard.press('Enter');
  const s = await samples(page);
  test.info().annotations.push({ type: 'rise ghost opacity', description: JSON.stringify(s.map((x) => [Math.round(x.t), x.op])) });
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('nowplaying');
  const live = s.filter((x) => x.op !== null);
  expect(live.length).toBeGreaterThan(3);
  // Mid-rise (100-150 ms after the keydown): strictly between 0 and 1.
  const mid = live.filter((x) => x.t >= 100 && x.t <= 150);
  expect(mid.length, 'a frame between 100 and 150 ms').toBeGreaterThan(0);
  for (const m of mid) {
    expect(m.op!).toBeGreaterThan(0);
    expect(m.op!).toBeLessThan(1);
  }
  // A later sample is lower; the last one before removal is at most 0.1.
  const later = live.filter((x) => x.t > mid[mid.length - 1].t);
  expect(later.length).toBeGreaterThan(0);
  expect(later[later.length - 1].op!).toBeLessThan(mid[0].op!);
  expect(live[live.length - 1].op!).toBeLessThanOrEqual(0.1);
  // The ghost stays still under Now Playing (it never moves).
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelectorAll('.page-ghost').length)).toBe(0);
});

test('F1 the page Now Playing sinks back to fades 0 -> 1 without moving (D152)', async ({ page }) => {
  await toTheBar(page);
  await page.keyboard.press('Enter');
  await H.waitForScreen(page, 'nowplaying');
  await page.waitForTimeout(400);
  await sampleFrom(page, '#page-current');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await page.evaluate(() => { (window as any).__sampling = false; });
  const s: Sample[] = await page.evaluate(() => (window as any).__samples);
  test.info().annotations.push({ type: 'sink incoming opacity', description: JSON.stringify(s.map((x) => [Math.round(x.t), x.op])) });
  expect(await page.evaluate(() => App.getCurrentScreen())).toBe('library');
  const mid = s.filter((x) => x.t >= 60 && x.t <= 180 && x.op !== null);
  expect(mid.length).toBeGreaterThan(0);
  for (const m of mid) {
    expect(m.op!).toBeGreaterThan(0);
    expect(m.op!).toBeLessThan(1);
  }
  // No movement: the incoming page never carries a transform.
  expect(await page.evaluate(() => (document.getElementById('page-current') as HTMLElement).style.transform)).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('page-current')!).opacity)).toBe('1');
});

test('F1 rise and sink: only transform and opacity transition, each at most 0.25 s (D152)', async ({ page }) => {
  await toTheBar(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__ts = [];
    document.addEventListener('transitionstart', (e: any) => {
      const t = e.target as HTMLElement;
      const cs = getComputedStyle(t);
      const props = cs.transitionProperty.split(',').map((x) => x.trim());
      const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x));
      const i = props.indexOf(e.propertyName);
      w.__ts.push({
        page: t.id === 'page-current' || t.classList.contains('page-ghost'),
        ghost: t.classList.contains('page-ghost'),
        prop: e.propertyName, dur: i > -1 ? durs[i] : durs[0]
      });
    }, true);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  const rise: any[] = await page.evaluate(() => (window as any).__ts.splice(0));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  const sink: any[] = await page.evaluate(() => (window as any).__ts.splice(0));
  test.info().annotations.push({ type: 'rise', description: JSON.stringify(rise.filter((e) => e.page)) });
  test.info().annotations.push({ type: 'sink', description: JSON.stringify(sink.filter((e) => e.page)) });
  for (const e of rise.concat(sink)) expect(['transform', 'opacity'], JSON.stringify(e)).toContain(e.prop);
  for (const e of rise.concat(sink).filter((x) => x.page)) expect(e.dur, JSON.stringify(e)).toBeLessThanOrEqual(0.25);
  // The rise's ghost fades and never moves; the sink's incoming page fades
  // and never moves.
  expect(rise.some((e) => e.ghost && e.prop === 'opacity')).toBe(true);
  expect(rise.some((e) => e.ghost && e.prop === 'transform')).toBe(false);
  expect(sink.some((e) => e.page && !e.ghost && e.prop === 'opacity')).toBe(true);
  expect(sink.some((e) => e.page && !e.ghost && e.prop === 'transform')).toBe(false);
});

test('F1 screenshots mid-rise and mid-sink at 150 %', async ({ page }) => {
  await toTheBar(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(110);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-rise-mid-150.png' });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(110);
  await page.screenshot({ path: 'screenshots/v3-10/fix2-sink-mid-150.png' });
});

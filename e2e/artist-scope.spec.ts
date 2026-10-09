import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.12 R7 (ticket-3.12 §6): Artist -> similar Artist. For the zoom
// transition the outgoing Artist page stays in the DOM as a ghost, before
// the new page and with the same ids, so a document-wide lookup
// (getElementById('artist-bio-stub'), querySelectorAll for a zone) finds
// the ghost's node first. The mock answers getArtist and getArtistInfo2 at
// once, inside the transition (mockArtistInfo=1 gives every artist a
// biography and three similar artists, the next three in the fixtures).

async function openFirstArtist(page: Page) {
  await H.navTo(page, 'library');
  await H.press(page, 'ArrowDown'); await H.settle(page, 250);      // the Albums grid
  await H.press(page, 'ArrowLeft'); await H.settle(page, 100);      // the sub-nav
  await H.press(page, 'ArrowDown'); await page.waitForTimeout(400); // Artists
  await H.press(page, 'ArrowRight'); await H.settle(page, 200);     // the first artist
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
}

async function transitionDone(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.page-ghost'));
  await H.settle(page, 150);
}

// What the live page (#page-current) shows, and where the focus is.
const livePage = (page: Page) => page.evaluate(() => {
  const cur = document.getElementById('page-current')!;
  const name = cur.querySelector('.artist-detail-name');
  const bio = cur.querySelector('.artist-bio-text');
  const f = FocusManager.getCurrentFocused();
  return {
    name: name ? name.textContent : null,
    albums: Array.prototype.map.call(cur.querySelectorAll('#artist-albums-list .artist-album-row'),
      (r: HTMLElement) => r.getAttribute('data-album-id')),
    bio: bio ? bio.textContent : null,
    similar: Array.prototype.map.call(cur.querySelectorAll('#artist-similar-row .artist-similar-card'),
      (c: HTMLElement) => c.getAttribute('data-artist-id')),
    // v3.12 R5: the Popular rows (the mock gives even-indexed artists ten).
    popular: cur.querySelectorAll('#artist-popular-list .track-row').length,
    focusZone: FocusManager.getActiveZone(),
    focusOnLivePage: !!(f && cur.contains(f)),
  };
});

// The fixtures' answer for an artist: its albums, biography and the next
// three artists.
const expected = (page: Page, id: string) => page.evaluate((artistId) => {
  const M = (window as any).__MOCK__;
  const k = M.artists.findIndex((a: any) => a.id === artistId);
  const a = M.artists[k];
  return {
    name: a.name,
    albums: M.albums.filter((al: any) => al.artistId === artistId).map((al: any) => al.id),
    bio: 'Biography of ' + a.name + '.',
    similar: [1, 2, 3].map((d) => M.artists[(k + d) % M.artists.length].id),
    popular: k % 2 === 0 ? 10 : 0,
  };
}, id);

test('R7 Artist -> similar Artist: the new page gets its own sections and the focus', async ({ page }) => {
  const errors = H.watchErrors(page);
  await H.bootMock(page, { extra: 'mockArtistInfo=1' });
  await openFirstArtist(page);
  await page.waitForFunction(() => !!document.querySelector('#page-current #artist-similar-row .focusable'));
  await transitionDone(page);
  const first = await livePage(page);
  expect(first).toMatchObject(await expected(page, 'artist-0'));

  // Down from the discography (and Popular, v3.12 R5) to the similar
  // artists, then Enter.
  for (let i = 0; i < 20 && (await H.focus(page)).zone !== 'artist-similar'; i++) await H.press(page, 'ArrowDown', 1, 80);
  expect((await H.focus(page)).zone).toBe('artist-similar');
  const target = await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-artist-id'));
  expect(target).toBe('artist-1');
  await H.press(page, 'Enter');
  // Both answers land while the outgoing page is still a ghost.
  await page.waitForFunction(() => !!document.querySelector('.page-ghost'));
  await transitionDone(page);
  await page.waitForTimeout(200);

  const got = await livePage(page);
  test.info().annotations.push({ type: 'live page after Artist -> Artist', description: JSON.stringify(got) });
  expect(got).toMatchObject(await expected(page, target!));
  expect(got.focusZone).toBe('artist-albums');
  expect(got.focusOnLivePage).toBe(true);
  // The keys still move within the live page.
  await H.press(page, 'ArrowDown');
  expect(await page.evaluate(() => document.getElementById('page-current')!.contains(FocusManager.getCurrentFocused()))).toBe(true);
  expect(errors.pageErrors).toEqual([]);
});

// An answer for an Artist page that has been left must not fill the next
// one: artist-0's biography is held 1.5 s, the user goes back and opens
// artist-1 (answered at once), then artist-0's answer lands.
test('R7 a late answer for a left Artist page does not fill the next Artist page', async ({ page }) => {
  await H.bootMock(page, { extra: 'mockArtistInfo=1&mockArtistInfoDelay=1500&mockArtistInfoDelayId=artist-0' });
  await openFirstArtist(page);
  await transitionDone(page);
  await H.press(page, 'Escape');                     // Back to the Artists grid
  await H.waitForScreen(page, 'library');
  await page.waitForFunction(() => FocusManager.getActiveZone() === 'library-grid');
  await H.settle(page, 200);
  await H.press(page, 'ArrowRight');                 // the second artist
  await H.settle(page, 150);
  expect(await page.evaluate(() => FocusManager.getCurrentFocused()!.getAttribute('data-artist-id'))).toBe('artist-1');
  await H.press(page, 'Enter');
  await H.waitForScreen(page, 'artist');
  await transitionDone(page);
  await page.waitForTimeout(1800);                   // artist-0's answer has landed
  const got = await livePage(page);
  test.info().annotations.push({ type: 'artist-1 page after the late answer', description: JSON.stringify(got) });
  expect(got).toMatchObject(await expected(page, 'artist-1'));
});

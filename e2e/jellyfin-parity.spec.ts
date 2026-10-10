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

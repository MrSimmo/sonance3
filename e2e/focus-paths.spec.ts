import { test, expect } from '@playwright/test';
import * as H from './helpers/sonance';

// Characterisation (prompt-3.10 T2): for each primary screen, the sequence of
// focus zones a repeated Down visits, starting on the top nav. These encode
// TODAY's behaviour, recorded 2026-10-01 on the default mock fixtures, so a
// session that changes a focus path has to change this file on purpose.
//
// S3 (R9, D56): with no track the NP bar is hidden and its zone counts as
// empty, so no walk enters it; with a track every walk ends on it (the bar's
// "open Now Playing" target). Now Playing hides the bar: with no track its
// walk stops on np-controls, entered on Play (R3); S6 (A6) added the Up Next
// strip under the controls, so with a track it ends on the first tile.
// WITH_TRACK is spelled out rather than derived from NO_TRACK: the two
// differ in their last zone on every screen. S7 (A4) added Home's
// favourites, most played and Rediscover rows (default fixtures: all three
// non-empty).

const NO_TRACK: Record<string, string[]> = {
  home: ['topnav', 'content', 'home-newest', 'home-recent', 'home-favourites', 'home-frequent', 'home-playlists', 'home-rediscover'],
  library: ['topnav', 'library-grid'],
  playlists: ['topnav', 'content'],
  queue: ['topnav', 'queue-card'],
  nowplaying: ['topnav', 'np-controls'],
  search: ['topnav', 'content', 'search-special'],
  settings: ['topnav', 'content', 'settings-actions'],
};

const WITH_TRACK: Record<string, string[]> = {
  home: ['topnav', 'content', 'home-newest', 'home-recent', 'home-favourites', 'home-frequent', 'home-playlists', 'home-rediscover', 'nowplaying-bar'],
  library: ['topnav', 'library-grid', 'nowplaying-bar'],
  playlists: ['topnav', 'content', 'nowplaying-bar'],
  queue: ['topnav', 'queue-list', 'nowplaying-bar'],
  nowplaying: ['topnav', 'np-controls', 'np-upnext'],
  search: ['topnav', 'content', 'search-special', 'nowplaying-bar'],
  settings: ['topnav', 'content', 'settings-actions', 'nowplaying-bar'],
};

for (const withTrack of [false, true]) {
  const expected = withTrack ? WITH_TRACK : NO_TRACK;
  for (const screen of H.NAV) {
    test(`${withTrack ? 'with track' : 'no track'}: Down-walk on ${screen}`, async ({ page }) => {
      await H.bootMock(page);
      if (withTrack) await H.startTrack(page, 5, { paused: true });
      if (screen !== 'home') await H.navTo(page, screen);
      await page.evaluate((i) => FocusManager.setActiveZone('topnav', i, true), H.NAV.indexOf(screen));
      await H.settle(page, 300);
      const walk = await H.downWalk(page, 80);
      test.info().annotations.push({ type: 'zones', description: walk.zones.join(' > ') });
      expect(walk.zones).toEqual(expected[screen]);
      const last = walk.steps[walk.steps.length - 1];
      expect(last.visible).toBe(true);
      if (screen === 'nowplaying' && withTrack) expect(last).toMatchObject({ zone: 'np-upnext', index: 0 });
      else if (screen === 'nowplaying') expect(last.id).toBe('np-play');
      else if (withTrack) expect(last).toMatchObject({ zone: 'nowplaying-bar', index: 0 });
    });
  }
}

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as H from './helpers/sonance';

// v3.13 (ticket-3.xx-jellyfin): the Jellyfin adapter, in-page on the
// Jellyfin mock (tests/mock-boot.js ?mockBackend=jellyfin). R4 is the
// transport; R5/R8/R10 the translators (one test each); R6 the media URLs;
// R7 the writes. Each drives a JellyfinAPI the test builds, so it reads
// exactly what the adapter sent (window.__MOCK__.calls) and returned.

const ROOT = path.resolve(__dirname, '..');

// A no-session page on the Jellyfin mock: the app sits on Login, and the
// test owns the API instance.
async function page0(page: Page, extra?: string) {
  await H.bootJellyfin(page, { waitFor: false, extra: 'mockNoSession=1' + (extra ? '&' + extra : '') });
  await page.waitForSelector('.login-screen');
}

// Builds `window.__jf`, signed in with the mock's seeded token.
async function api(page: Page, opts?: any) {
  await page.evaluate((o) => {
    const w = window as any;
    w.__jf = new (w as any).JellyfinAPI(Object.assign({
      serverUrl: window.location.origin, username: 'mockuser', password: 'mockpass',
      token: w.__MOCK__.jf.seedToken, userId: w.__MOCK__.jf.userId, deviceId: 'dev-test-0001'
    }, o || {}));
  }, opts || {});
}

const lastCall = (page: Page, re?: string) => page.evaluate((r) => {
  const calls = (window as any).__MOCK__.calls.filter((c: any) => c.backend === 'jellyfin' && (!r || new RegExp(r).test(c.path)));
  return calls[calls.length - 1] || null;
}, re || null);

// --- R4: the transport ----------------------------------------------------

test.describe('R4 transport', () => {
  test('the header is MediaBrowser with the five quoted values, and nothing else carries auth', async ({ page }) => {
    await page0(page);
    await api(page);
    await page.evaluate(() => (window as any).__jf.getMusicFolders());
    const call = await lastCall(page, '^/UserViews$');
    expect(call.auth).toBe('MediaBrowser Client="Sonance", Device="Browser", DeviceId="dev-test-0001", ' +
      'Version="3.13.0", Token="mock-jf-token-seed"');
    expect(call.query).toEqual({ includeHidden: 'true' });
  });

  test('values are URL-encoded inside the quotes', async ({ page }) => {
    await page0(page);
    await api(page, { deviceId: 'a "b",c' });
    await page.evaluate(() => (window as any).__jf.getMusicFolders());
    expect((await lastCall(page, '^/UserViews$')).auth).toContain('DeviceId="a%20%22b%22%2Cc"');
  });

  test('SubsonicAPI.abortAll() cancels an in-flight Jellyfin request', async ({ page }) => {
    await page0(page, 'mockPingDelay=3000');
    await api(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const t0 = performance.now();
      const p = w.__jf.ping().then(() => 'resolved', (e: any) => 'rejected: ' + e.name);
      await new Promise((res) => setTimeout(res, 100));
      const n = w.SubsonicAPI.abortAll();
      const outcome = await p;
      return { n, outcome, ms: Math.round(performance.now() - t0) };
    });
    expect(r.n).toBe(1);
    expect(r.outcome).toBe('rejected: AbortError');
    expect(r.ms).toBeLessThan(1500);
  });

  test('a timeout rejects with api.js\'s message (login matches "timed out")', async ({ page }) => {
    await page0(page, 'mockPingDelay=2000');
    await api(page);
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      const msg = await (window as any).__jf._send('GET', '/System/Info', null, null, { timeout: 200 })
        .then(() => 'resolved', (e: any) => e.message);
      return { msg, ms: Math.round(performance.now() - t0) };
    });
    expect(r.msg).toBe('Request timed out. Check your server connection.');
    expect(r.ms).toBeLessThan(1000);
    expect(await page.evaluate(() => (window as any).SubsonicAPI.abortAll())).toBe(0);
  });

  test('an HTTP error rejects "Server returned HTTP <n>"', async ({ page }) => {
    await page0(page, 'mockJfFavFail=1');
    await api(page);
    const msg = await page.evaluate(() => (window as any).__jf.star('song-1', 'song').then(() => 'ok', (e: any) => e.message));
    expect(msg).toBe('Server returned HTTP 500');
  });

  test('an unknown endpoint rejects clearly, and no Subsonic URL can be built', async ({ page }) => {
    await page0(page);
    await api(page);
    const r = await page.evaluate(async () => {
      const a = (window as any).__jf;
      const unknown = await a._request('getNowPlaying.view').then(() => 'resolved', (e: any) => e.message);
      let built = 'no throw';
      try { a._buildUrl('ping.view'); } catch (e: any) { built = e.message; }
      return { unknown, built };
    });
    expect(r.unknown).toBe('Not available on Jellyfin: getNowPlaying.view');
    expect(r.built).toBe('Jellyfin adapter: no Subsonic URL for ping.view');
  });

  test('no legacy auth anywhere in js/ (api_key, X-Emby, X-MediaBrowser)', async () => {
    const hits: string[] = [];
    const files = fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f)
      .concat(fs.readdirSync(path.join(ROOT, 'js', 'screens')).map((f) => 'js/screens/' + f))
      .filter((f) => /\.js$/.test(f) && !/\.min\.js$/.test(f));
    files.forEach((f) => {
      fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (/api_key|X-Emby|X-MediaBrowser/.test(line)) hits.push(f + ':' + (i + 1));
      });
    });
    expect(files).toContain('js/jellyfin-api.js');
    expect(hits).toEqual([]);
  });
});

// --- R5 / R8 / R10: the translators, against the Subsonic mock --------------
//
// Each test runs the same public SubsonicAPI method on both mocks (same
// fixtures): a SubsonicAPI on the Subsonic mock, a JellyfinAPI on the
// Jellyfin mock, and compares the fields the screens read (ticket §2.4).
// Ids are the fixture ids on both; a Jellyfin coverArt carries its image
// tag after the id, so covers compare by id. musicFolderId is compared only
// where R10 sets it (an unscoped Jellyfin answer leaves it out, and the
// screens keep untagged songs).

type Both = { sub: Page; jf: Page; close: () => Promise<void> };

async function both(browser: any, extra?: string): Promise<Both> {
  const open = async (backend: string) => {
    const p: Page = await browser.newPage({ baseURL: test.info().project.use.baseURL,
      viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const opts = { waitFor: false, extra: 'mockNoSession=1' + (extra ? '&' + extra : '') };
    if (backend === 'jellyfin') await H.bootJellyfin(p, opts); else await H.bootMock(p, opts);
    await p.waitForSelector('.login-screen');
    await p.evaluate((b) => {
      const w = window as any;
      const cfg: any = { serverUrl: window.location.origin, username: 'mockuser', password: 'mockpass' };
      w.__api = b === 'jellyfin'
        ? new w.JellyfinAPI(Object.assign(cfg, { token: w.__MOCK__.jf.seedToken, userId: w.__MOCK__.jf.userId,
            deviceId: 'dev-test-0001', selectedLibraries: () => w.__sel || null }))
        : new w.SubsonicAPI(cfg);
    }, backend);
    return p;
  };
  const sub = await open('subsonic');
  const jf = await open('jellyfin');
  return { sub, jf, close: async () => { await sub.close(); await jf.close(); } };
}

// Evaluates `expr` (with `api` bound) on a page.
const run = (p: Page, expr: string) =>
  p.evaluate('(async function() { var api = window.__api; return ' + expr + '; })()') as Promise<any>;
const runBoth = async (b: Both, expr: string) => [await run(b.sub, expr), await run(b.jf, expr)];

const cover = (c: any) => (c === undefined || c === null) ? c : String(c).split('~')[0];
const transcoded = (s: any) => /opus/i.test(String(s.suffix || '')) || /opus/i.test(String(s.contentType || ''));
const song = (s: any) => ({ id: s.id, title: s.title, artist: s.artist, artistId: s.artistId, album: s.album,
  albumId: s.albumId, cover: cover(s.coverArt || s.albumId), duration: s.duration, formatted: s._formattedDuration,
  track: s.track, transcoded: transcoded(s) });
const album = (a: any) => ({ id: a.id, name: a.name || a.title, artist: a.artist, artistId: a.artistId,
  cover: cover(a.coverArt), year: a.year, songCount: a.songCount, genre: a.genre, meta: a._metaString });
const artist = (a: any) => ({ id: a.id, name: a.name, albumCount: a.albumCount, cover: cover(a.coverArt) });
const playlist = (p: any) => ({ id: p.id, name: p.name, cover: cover(p.coverArt), songCount: p.songCount,
  duration: p.duration, gradient: p._gradient });
const genre = (g: any) => ({ value: g.value, albumCount: g.albumCount, songCount: g.songCount });

test.describe('R5 translators', () => {
  test('getMusicFolders: music views only, hidden ones included', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2');
    const [s, j] = await runBoth(b, 'api.getMusicFolders()');
    expect(j.map((f: any) => ({ id: String(f.id), name: f.name }))).toEqual(s.map((f: any) => ({ id: String(f.id), name: f.name })));
    expect(j.length).toBe(2);
    expect((await lastCall(b.jf, '^/UserViews$')).query.includeHidden).toBe('true');
    await b.close();
  });

  test('getAlbumList2: every type, two pages, and a library scope', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2');
    const lists: [string, string][] = [
      ['newest', 'null'], ['alphabeticalByName', 'null'], ['alphabeticalByArtist', 'null'],
      ['byYear', '{ fromYear: 3000, toYear: 0 }'], ['byYear', '{ fromYear: 2021, toYear: 2023 }'],
      ['byGenre', '{ genre: "Jazz" }'], ['random', 'null'], ['recent', 'null'], ['frequent', 'null']
    ];
    for (const [type, extra] of lists) {
      for (const page of ['0', '6']) {
        for (const scope of ['null', '["2"]']) {
          const expr = 'api.getAlbumList2("' + type + '", 6, ' + page + ', ' + scope + ', ' + extra + ')';
          const [s, j] = await runBoth(b, expr);
          expect(j.map(album), expr).toEqual(s.map(album));
        }
      }
    }
    await b.close();
  });

  test('getAlbumList2 starred: the same favourites, A-Z (P9: no favourited date)', async ({ browser }) => {
    const b = await both(browser);
    const [s, j] = await runBoth(b, 'api.getAlbumList2("starred", 50, 0, null, null)');
    const byName = s.slice().sort((x: any, y: any) => (x.name < y.name ? -1 : 1));
    expect(j.map((a: any) => a.id)).toEqual(byName.map((a: any) => a.id));
    expect(j.map((a: any) => a.id)).toEqual(['album-1', 'album-5', 'album-9', 'album-13']);
    expect(j.every((a: any) => a.starred === undefined)).toBe(true);
    await b.close();
  });

  test('countAlbums and the Albums cursor run through the translator', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2&mockAlbums=40');
    for (const [type, extra] of [['alphabeticalByName', 'null'], ['newest', 'null'], ['frequent', 'null'],
        ['byYear', '{ fromYear: 3000, toYear: 0 }'], ['byGenre', '{ genre: "Rock" }']]) {
      for (const scope of ['null', '["1", "2"]']) {
        const [s, j] = await runBoth(b, 'api.countAlbums("' + type + '", ' + scope + ', ' + extra + ')');
        expect(j, type + ' ' + scope).toBe(s);
        const page = 'api.createAlbumListCursor("' + type + '", ' + scope + ', 7, ' + extra + ').next(20)';
        const [cs, cj] = await runBoth(b, page);
        expect(cj.map(album), 'cursor ' + type + ' ' + scope).toEqual(cs.map(album));
      }
    }
    await b.close();
  });

  test('counts: one Limit=0 request per library (D197), equal to the Subsonic totals', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2&mockSongs=230&mockAlbums=40');
    const calls = () => b.jf.evaluate(() => (window as any).__MOCK__.calls.length);
    let n = await calls();
    const [as, aj] = await runBoth(b, 'api.countAlbums("newest", ["1", "2"], null)');
    expect(aj).toBe(as);
    expect(await calls() - n).toBe(2);
    n = await calls();
    const [ss, sj] = await runBoth(b, 'api.createSongPager("all", null, null, 50).count()');
    expect(sj).toBe(ss);
    expect(sj).toBe(230);
    expect(await calls() - n).toBe(1);
    const zero = await b.jf.evaluate(() => (window as any).__MOCK__.calls.slice(-1)[0].query.Limit);
    expect(zero).toBe('0');
    await b.close();
  });

  test('getAlbum: the album, its tracks and the credit fields', async ({ browser }) => {
    const b = await both(browser);
    for (const id of ['album-0', 'album-3']) {
      const [s, j] = await runBoth(b, 'api.getAlbum("' + id + '")');
      expect(album(j)).toEqual(album(s));
      expect(j.song.map(song)).toEqual(s.song.map(song));
      expect(j.displayArtist).toBe(s.artist);
      expect(j.recordLabels).toEqual(s.recordLabels);
      expect(j.releaseDate).toEqual(s.releaseDate);
      expect(j.originalReleaseDate).toBeUndefined();   // a documented gap
    }
    await b.close();
  });

  test('getSong: the credits fields (performer roles and BPM are the documented gaps)', async ({ browser }) => {
    const b = await both(browser);
    for (const id of ['song-0', 'song-1', 'song-album-2-3']) {
      const [s, j] = await runBoth(b, 'api.getSong("' + id + '")');
      const credits = (x: any) => ({
        song: song(x), discNumber: x.discNumber, year: x.year, genre: x.genre, genres: x.genres,
        bitRate: x.bitRate, samplingRate: x.samplingRate, bitDepth: x.bitDepth, channelCount: x.channelCount,
        playCount: x.playCount || 0, played: x.played ? new Date(x.played).toISOString() : undefined,
        artists: (x.artists || []).map((a: any) => a.name), displayArtist: x.displayArtist,
        albumArtists: (x.albumArtists || []).map((a: any) => a.name), displayAlbumArtist: x.displayAlbumArtist,
        displayComposer: x.displayComposer || undefined,
        contributors: (x.contributors || []).filter((c: any) => c.role !== 'performer')
          .map((c: any) => c.role + ':' + c.artist.name)
      });
      expect(credits(j), id).toEqual(credits(s));
      expect(j.bpm).toBeUndefined();
      expect(j.starred).toBeUndefined();
    }
    await b.close();
  });

  test('getArtists: the A-Z index, all libraries and one', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2&mockArtistAlbumCounts=1');
    for (const scope of ['null', '["1"]', '["1", "2"]']) {
      const [s, j] = await runBoth(b, 'api.getArtists(' + scope + ')');
      expect(j.map(artist), scope).toEqual(s.map(artist));
    }
    await b.close();
  });

  test('getArtist: the discography by year, and an artist with no albums', async ({ browser }) => {
    const b = await both(browser, 'mockArtists=20');
    for (const id of ['artist-0', 'artist-1', 'artist-15']) {
      const [s, j] = await runBoth(b, 'api.getArtist("' + id + '")');
      expect({ id: j.id, name: j.name, cover: cover(j.coverArt), n: j.albumCount }, id)
        .toEqual({ id: s.id, name: s.name, cover: cover(s.coverArt), n: s.albumCount });
      expect(j.album.map(album), id).toEqual(s.album.map(album));
    }
    // P11: the albums an artist is album artist of; with none, those they
    // appear on (both empty on these fixtures, and a second request).
    const asked = await b.jf.evaluate(() => (window as any).__MOCK__.calls
      .filter((c: any) => c.path === '/Items' && (c.query.AlbumArtistIds === 'artist-15' || c.query.ArtistIds === 'artist-15'))
      .map((c: any) => c.query.AlbumArtistIds ? 'AlbumArtistIds' : 'ArtistIds'));
    expect(asked).toEqual(['AlbumArtistIds', 'ArtistIds']);
    expect((await lastCall(b.jf, '^/Items$')).query.SortBy).toBe('ProductionYear,SortName');
    await b.close();
  });

  test('getArtistInfo2: biography and similar artists, no image URLs (D192)', async ({ browser }) => {
    for (const extra of ['mockArtistInfo=1', '']) {
      const b = await both(browser, extra);
      const [s, j] = await runBoth(b, 'api.getArtistInfo2("artist-2")');
      expect(j.biography).toBe(s.biography);
      const sim = (a: any) => ({ id: a.id, name: a.name, cover: cover(a.coverArt) });
      expect((j.similarArtist || []).map(sim)).toEqual((s.similarArtist || []).map(sim));
      expect(j.largeImageUrl || j.mediumImageUrl || j.smallImageUrl).toBeUndefined();
      await b.close();
    }
  });

  test('getTopSongs: by name, through the getArtist memo or a search', async ({ browser }) => {
    const b = await both(browser);
    const names = await run(b.sub, 'window.__MOCK__.artists.slice(0, 4).map(function(a) { return a.name; })');
    for (const n of names) {
      const [s, j] = await runBoth(b, 'api.getTopSongs(' + JSON.stringify(n) + ', 5)');
      expect(j.map(song), n).toEqual(s.map(song));
    }
    // After getArtist the name is known: no /Artists lookup.
    const before = await b.jf.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Artists').length);
    await run(b.jf, 'api.getArtist("artist-6").then(function(a) { return api.getTopSongs(a.name, 5); })');
    const after = await b.jf.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Artists').length);
    expect(before).toBe(4);
    expect(after).toBe(before);
    await b.close();
  });

  test('getSimilarSongs2: Instant Mix in the song shape', async ({ browser }) => {
    const b = await both(browser);
    for (const id of ['artist-0', 'artist-1']) {
      const [s, j] = await runBoth(b, 'api.getSimilarSongs2("' + id + '", 50)');
      expect(j.map(song), id).toEqual(s.map(song));
    }
    await b.close();
  });

  test('getGenres: one request per music library, counts summed', async ({ browser }) => {
    for (const libs of ['1', '3']) {
      const b = await both(browser, 'mockLibraries=' + libs);
      const [s, j] = await runBoth(b, 'api.getGenres()');
      expect(j.map(genre)).toEqual(s.map(genre));
      expect(await b.jf.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Genres').length))
        .toBe(parseInt(libs, 10));
      await b.close();
    }
  });

  test('getSongsByGenre and the Songs pager: same count, same pages', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2&mockSongs=230');
    for (const [kind, arg] of [['genre', '"Rock"'], ['all', 'null']]) {
      for (const scope of ['null', '["2"]', '["1", "2"]']) {
        const expr = '(function() { var p = api.createSongPager("' + kind + '", ' + arg + ', ' + scope +
          ', 50); return p.count().then(function(n) { return p.range(0, n).then(function(list) { return { n: n, list: list }; }); }); })()';
        const [s, j] = await runBoth(b, expr);
        expect(j.n, kind + ' ' + scope).toBe(s.n);
        expect(j.list.map(song), kind + ' ' + scope).toEqual(s.list.map(song));
      }
    }
    const [s, j] = await runBoth(b, 'api.getSongsByGenre("Jazz", 5, 3, null)');
    expect(j.map(song)).toEqual(s.map(song));
    await b.close();
  });

  test('getRandomSongs', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2');
    for (const scope of ['null', '["1"]']) {
      const [s, j] = await runBoth(b, 'api.getRandomSongs(10, ' + scope + ')');
      expect(j.map(song), scope).toEqual(s.map(song));
    }
    expect((await lastCall(b.jf, '^/Items$')).query.SortBy).toBe('Random');
    await b.close();
  });

  test('search3: each type with its own count and offset; a type asked 0 is not requested', async ({ browser }) => {
    const b = await both(browser);
    for (const q of ['Track 01', 'album 1', 'Artist 0', 'zzz']) {
      const expr = 'api.search3(' + JSON.stringify(q) + ', { artistCount: 5, albumCount: 5, songCount: 5, songOffset: 1 })';
      const [s, j] = await runBoth(b, expr);
      expect(j.artist.map(artist), q).toEqual(s.artist.map(artist));
      expect(j.album.map(album), q).toEqual(s.album.map(album));
      expect(j.song.map(song), q).toEqual(s.song.map(song));
    }
    const n = await b.jf.evaluate(() => (window as any).__MOCK__.calls.length);
    await run(b.jf, 'api.search3("Track", { artistCount: 0, albumCount: 0, songCount: 3 })');
    const paths = await b.jf.evaluate((k) => (window as any).__MOCK__.calls.slice(k).map((c: any) => c.path + ' ' + (c.query.IncludeItemTypes || '')), n);
    expect(paths).toEqual(['/Items Audio']);
    await b.close();
  });

  test('getStarred2: favourite albums A-Z, songs and album artists, in the starred2 shape', async ({ browser }) => {
    const b = await both(browser);
    const j = await run(b.jf, 'api.getStarred2(null)');
    expect(Object.keys(j).sort()).toEqual(['album', 'artist', 'song']);
    expect(j.album.map((a: any) => a.id)).toEqual(['album-1', 'album-5', 'album-9', 'album-13']);
    expect(j.song).toEqual([]);
    expect(j.artist).toEqual([]);
    const fav = await b.jf.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => /IsFavorite/.test(c.query && c.query.Filters || ''))
      .map((c: any) => c.path + ' ' + (c.query.IncludeItemTypes || '')).sort());
    expect(fav).toEqual(['/Artists/AlbumArtists ', '/Items Audio', '/Items MusicAlbum']);
    await b.close();
  });

  test('getPlaylists and getPlaylist (a card has no duration on Jellyfin, D198)', async ({ browser }) => {
    const b = await both(browser);
    const [s, j] = await runBoth(b, 'api.getPlaylists()');
    const card = (p: any) => Object.assign(playlist(p), { duration: undefined });
    expect(j.map(card)).toEqual(s.map(card));
    expect(j.every((p: any) => p.duration === undefined)).toBe(true);
    const [ds, dj] = await runBoth(b, 'api.getPlaylist("pl-2")');
    expect({ id: dj.id, name: dj.name, songCount: dj.songCount, duration: dj.duration })
      .toEqual({ id: ds.id, name: ds.name, songCount: ds.songCount, duration: ds.duration });
    expect(dj.entry.map(song)).toEqual(ds.entry.map(song));
    await b.close();
  });

  test('getOpenSubsonicExtensions: none, and no request', async ({ browser }) => {
    const b = await both(browser);
    const n = await b.jf.evaluate(() => (window as any).__MOCK__.calls.length);
    expect(await run(b.jf, 'api.getOpenSubsonicExtensions()')).toEqual([]);
    expect(await b.jf.evaluate(() => (window as any).__MOCK__.calls.length)).toBe(n);
    await b.close();
  });

  test('an Opus track is marked for transcoding from an album, a search and a playlist', async ({ browser }) => {
    const b = await both(browser, 'mockJfAlbumOpus=1');
    const album0 = await run(b.jf, 'api.getAlbum("album-0")');
    const found = await run(b.jf, 'api.search3("Track 05", { artistCount: 0, albumCount: 0, songCount: 5 })');
    const pl = await run(b.jf, 'api.getPlaylist("pl-0")');
    const pick = (list: any[], id: string) => list.filter((x: any) => x.id === id)[0];
    for (const s of [pick(album0.song, 'song-album-0-4'), pick(found.song, 'song-4'), pick(pl.entry, 'song-4')]) {
      expect(s.suffix).toBe('opus');
      expect(s.contentType).toContain('opus');
    }
    expect(transcoded(pick(album0.song, 'song-album-0-3'))).toBe(false);
    await b.close();
  });
});

test.describe('R8 lyrics', () => {
  for (const [label, extra] of [['synced', 'mockLyrics=1'], ['unsynced', 'mockLyricsUnsynced=1'], ['none', '']]) {
    test('getLyricsBySongId, ' + label, async ({ browser }) => {
      const b = await both(browser, extra);
      const parse = 'api.getLyricsBySongId("song-3").then(function(r) { return SonanceUtils.parseLyricsResponse(r); })';
      const j = await run(b.jf, parse);
      if (label === 'none') {
        expect(j).toBe(null);
        expect((await lastCall(b.jf, '/Lyrics$')).status).toBe(404);
      } else if (label === 'synced') {
        const s = await run(b.sub, parse);
        expect(j.synced).toBe(true);
        expect(j.line).toEqual(s.line);
      } else {
        expect(j.synced).toBe(false);
        expect(j.line.length).toBe(12);
        expect(j.line.every((l: any) => l.start === undefined && /^Lyric line /.test(l.value))).toBe(true);
      }
      await b.close();
    });
  }
});

test.describe('R10 library scope on unscoped results', () => {
  // js/screens/playlists.js and js/options-sheet.js's filter: songs without
  // musicFolderId are kept, the others only when their library is selected.
  const keep = (list: any[], sel: string[]) => list.filter((t: any) =>
    t.musicFolderId === undefined || t.musicFolderId === null || sel.indexOf(String(t.musicFolderId)) > -1).map((t: any) => t.id);

  test('2 libraries, one selected: playlist entries and Instant Mix keep only its songs', async ({ browser }) => {
    const b = await both(browser, 'mockLibraries=2');
    await b.jf.evaluate(() => { (window as any).__sel = ['2']; });
    const [ps, pj] = await runBoth(b, 'api.getPlaylist("pl-1")');
    expect(keep(pj.entry, ['2'])).toEqual(keep(ps.entry, ['2']));
    expect(keep(pj.entry, ['2']).length).toBeLessThan(pj.entry.length);
    const [ms, mj] = await runBoth(b, 'api.getSimilarSongs2("artist-0", 50)');
    expect(keep(mj, ['2'])).toEqual(keep(ms, ['2']));
    await b.close();
  });

  test('nothing selected, or one library: no lookups, songs left untagged', async ({ browser }) => {
    for (const libs of ['2', '1']) {
      const b = await both(browser, 'mockLibraries=' + libs);
      await b.jf.evaluate(() => { (window as any).__sel = (window as any).__MOCK__.libraries.length > 1 ? null : ['1']; });
      const j = await run(b.jf, 'api.getPlaylist("pl-1")');
      expect(j.entry.every((t: any) => t.musicFolderId === undefined)).toBe(true);
      const lookups = await b.jf.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Items' && c.query.Ids).length);
      expect(lookups).toBe(0);
      await b.close();
    }
  });
});

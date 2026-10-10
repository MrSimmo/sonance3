import { test, expect, Page } from '@playwright/test';
import * as H from './helpers/sonance';

// v3.13 R1-R3 (ticket-3.xx-jellyfin): backend selection in AuthManager,
// detection at login (P3), boot validation with a silent re-login, and
// logout. Keyboard only: the login form is typed into, as on the TV.
//
// Navidrome cases are GUARDS (they pass on 3.12 and must keep passing): a
// good login, a wrong password and an unreachable server send what 3.12
// sends and show 3.12's message, with no Jellyfin probe. The Subsonic mock
// accepts any credentials, so those two failures are stubbed in front of
// it (the trap below), never by changing the mock.

// Records the app's fetches (wrapping whatever tests/mock-boot.js installs)
// and, when asked, answers ping.view as a Subsonic auth failure or refuses
// a host as an unreachable server would.
async function trap(page: Page, opts?: { pingFails?: boolean; deadHost?: string }) {
  await page.addInitScript((o: any) => {
    const w = window as any;
    w.__F__ = [];
    let current = window.fetch;
    const wrap = (fn: any) => function(this: any, input: any, init: any) {
      const url = typeof input === 'string' ? input : input.url;
      w.__F__.push(((init && init.method) || 'GET') + ' ' + url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
      if (o.deadHost && url.indexOf(o.deadHost) === 0) return Promise.reject(new TypeError('Failed to fetch'));
      if (o.pingFails && /\/rest\/ping\.view/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ 'subsonic-response': { status: 'failed', version: '1.16.1',
          error: { code: 40, message: 'Wrong username or password' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return fn.apply(this, arguments);
    };
    Object.defineProperty(window, 'fetch', { configurable: true, get() { return current; }, set(v) { current = wrap(v); } });
  }, opts || {});
}

const fetches = (page: Page) => page.evaluate(() => (window as any).__F__.slice());

// Watches the Connect button's labels for the run.
async function watchButton(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__BTN__ = [];
    const btn = document.querySelector('.login-btn') as HTMLElement;
    w.__BTN__.push(btn.textContent);
    new MutationObserver(() => w.__BTN__.push(btn.textContent)).observe(btn, { childList: true, characterData: true, subtree: true });
  });
}

async function loginScreen(page: Page, backend: 'subsonic' | 'jellyfin', extra?: string) {
  const opts = { waitFor: false as const, extra: 'mockNoSession=1' + (extra ? '&' + extra : '') };
  if (backend === 'jellyfin') await H.bootJellyfin(page, opts); else await H.bootMock(page, opts);
  await page.waitForSelector('.login-screen');
  await H.splashGone(page);
  await H.settle(page, 100);
}

// Server (focused when empty), port, username, password; Enter on the
// password field submits.
async function typeLogin(page: Page, server: string, port: string, user: string, pass: string) {
  await page.keyboard.type(server);
  await H.press(page, 'Enter');
  if (port) await page.keyboard.type(port);
  await H.press(page, 'Enter');
  await page.keyboard.type(user);
  await H.press(page, 'Enter');
  if (pass) await page.keyboard.type(pass);
  await H.press(page, 'Enter');
}

const origin = (page: Page) => page.evaluate(() => window.location.origin);
const errorText = (page: Page) => page.evaluate(() => (document.querySelector('.login-error') as HTMLElement).textContent);
const store = (page: Page) => page.evaluate(() => {
  const out: any = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) as string;
    if (/^sonance_(backend|jf_|server_url|username|password|logged_in)/.test(k)) out[k] = localStorage.getItem(k);
  }
  return out;
});
const backendOf = (page: Page) => page.evaluate(() => {
  const w = window as any;
  const api = w.AuthManager.getApi();
  return { jellyfin: typeof w.JellyfinAPI !== 'undefined' && api instanceof w.JellyfinAPI, subsonic: api instanceof w.SubsonicAPI };
});

// --- R1 ---------------------------------------------------------------------

test('R1 guard: a 3.12-shaped session (its keys only) boots to Home as Subsonic', async ({ page }) => {
  await trap(page);
  await H.bootMock(page);
  expect(await backendOf(page)).toEqual({ jellyfin: false, subsonic: true });
  const f = await fetches(page);
  expect(f.filter((x: string) => /^GET \/rest\//.test(x)).length).toBe(f.length);
  expect(f[0]).toBe('GET /rest/ping.view');
});

test('R1 a Jellyfin session boots to Home on the Jellyfin mock', async ({ page }) => {
  await trap(page);
  await H.bootJellyfin(page);
  expect(await backendOf(page)).toEqual({ jellyfin: true, subsonic: true });
  const f = await fetches(page);
  expect(f[0]).toBe('GET /System/Info');
  expect(f.filter((x: string) => /\/rest\//.test(x))).toEqual([]);
  expect(await page.evaluate(() => (window as any).AuthManager.getBackend())).toBe('jellyfin');
});

// --- R2 ---------------------------------------------------------------------

test('R2 Jellyfin with a password: Subsonic first, then the probe, then sign-in', async ({ page }) => {
  await trap(page);
  await loginScreen(page, 'jellyfin');
  await watchButton(page);
  await typeLogin(page, await origin(page), '', 'mockuser', 'mockpass');
  await H.waitForScreen(page, 'home');
  const f = await fetches(page);
  expect(f.slice(0, 3)).toEqual(['GET /rest/ping.view', 'GET /System/Info/Public', 'POST /Users/AuthenticateByName']);
  expect(await page.evaluate(() => (window as any).__BTN__)).toContain('Connecting...');
  const s = await store(page);
  expect(s.sonance_backend).toBe('jellyfin');
  expect(s.sonance_jf_token).toMatch(/^mock-jf-token-\d+$/);
  expect(s.sonance_jf_user_id).toBe('f00dfeed0000000000000000000000a1');
  expect(s.sonance_jf_server_version).toBe('12.2.0');
  expect(s.sonance_password).toBe('mockpass');
  expect(s.sonance_logged_in).toBe('true');
  expect(s.sonance_jf_device_id).toMatch(/^sonance-[0-9a-f]{24}$/);
  const auth = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Users/AuthenticateByName')[0]);
  expect(auth.body).toEqual({ Username: 'mockuser', Pw: 'mockpass' });
  expect(auth.auth).not.toMatch(/Token=/);
});

test('R2 Jellyfin passwordless: the probe first, sign-in with Pw "", no Subsonic request', async ({ page }) => {
  await trap(page);
  await loginScreen(page, 'jellyfin', 'mockJfPassword=');
  await watchButton(page);
  await typeLogin(page, await origin(page), '', 'mockuser', '');
  await H.waitForScreen(page, 'home');
  const f = await fetches(page);
  expect(f.slice(0, 2)).toEqual(['GET /System/Info/Public', 'POST /Users/AuthenticateByName']);
  expect(f.filter((x: string) => /\/rest\//.test(x))).toEqual([]);
  expect(await page.evaluate(() => (window as any).__BTN__)).toContain('Connecting...');
  const auth = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Users/AuthenticateByName')[0]);
  expect(auth.body).toEqual({ Username: 'mockuser', Pw: '' });
  expect((await store(page)).sonance_password).toBe('');
});

test('R2 Jellyfin wrong password: "Wrong username or password.", nothing stored', async ({ page }) => {
  await trap(page);
  await loginScreen(page, 'jellyfin');
  await typeLogin(page, await origin(page), '', 'mockuser', 'nope');
  await page.waitForFunction(() => /visible/.test((document.querySelector('.login-error') as HTMLElement).className));
  expect(await errorText(page)).toBe('Wrong username or password.');
  expect((await fetches(page)).slice(0, 3)).toEqual(['GET /rest/ping.view', 'GET /System/Info/Public', 'POST /Users/AuthenticateByName']);
  const s = await store(page);
  expect(s.sonance_logged_in).toBeUndefined();
  expect(s.sonance_backend).toBeUndefined();
  expect(await page.evaluate(() => (document.querySelector('.login-btn') as HTMLElement).textContent)).toBe('Connect');
});

test('R2 guard: Navidrome good login sends ping.view first and no probe', async ({ page }) => {
  await trap(page);
  await loginScreen(page, 'subsonic');
  await typeLogin(page, await origin(page), '', 'mockuser', 'mockpass');
  await H.waitForScreen(page, 'home');
  const f = await fetches(page);
  expect(f[0]).toBe('GET /rest/ping.view');
  expect(f.filter((x: string) => !/^GET \/rest\//.test(x))).toEqual([]);
  const s = await store(page);
  expect(s.sonance_backend).toBeUndefined();
  expect(s.sonance_logged_in).toBe('true');
});

test('R2 guard: Navidrome wrong password keeps its message and sends no probe', async ({ page }) => {
  await trap(page, { pingFails: true });
  await loginScreen(page, 'subsonic');
  await typeLogin(page, await origin(page), '', 'mockuser', 'nope');
  await page.waitForFunction(() => /visible/.test((document.querySelector('.login-error') as HTMLElement).className));
  expect(await errorText(page)).toBe('Wrong username or password.');
  expect(await fetches(page)).toEqual(['GET /rest/ping.view']);
});

test('R2 Navidrome empty password: the message, the password field, one probe, no Subsonic request', async ({ page }) => {
  await trap(page);
  const probes: string[] = [];
  page.on('request', (r) => { if (/\/System\/Info\/Public/.test(r.url())) probes.push(r.url()); });
  await loginScreen(page, 'subsonic');
  await watchButton(page);
  await typeLogin(page, await origin(page), '', 'mockuser', '');
  await page.waitForFunction(() => /visible/.test((document.querySelector('.login-error') as HTMLElement).className));
  expect(await errorText(page)).toBe('Please enter a password');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('login-password');
  expect(await fetches(page)).toEqual(['GET /System/Info/Public']);
  expect(probes.length).toBe(1);
  expect(await page.evaluate(() => (window as any).__BTN__)).toContain('Connecting...');
  expect(await page.evaluate(() => (document.querySelector('.login-btn') as HTMLElement).textContent)).toBe('Connect');
});

test('R2 guard: an unreachable server keeps its message and sends no probe', async ({ page }) => {
  await trap(page, { deadHost: 'http://127.0.0.1:9' });
  await loginScreen(page, 'subsonic');
  await typeLogin(page, 'http://127.0.0.1', '9', 'mockuser', 'mockpass');
  await page.waitForFunction(() => /visible/.test((document.querySelector('.login-error') as HTMLElement).className));
  expect(await errorText(page)).toBe('Cannot reach server. Check the address and your network connection.');
  expect(await fetches(page)).toEqual(['GET /rest/ping.view']);
});

// --- R3 ---------------------------------------------------------------------

test('R3 a revoked token signs in again silently, once, and boot reaches Home', async ({ page }) => {
  await trap(page);
  await H.bootJellyfin(page, { extra: 'mockJfRevoked=1' });
  const calls = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.backend === 'jellyfin')
    .slice(0, 3).map((c: any) => c.method + ' ' + c.path + ' ' + c.status));
  expect(calls).toEqual(['GET /System/Info 401', 'POST /Users/AuthenticateByName 200', 'GET /System/Info 200']);
  expect(await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Users/AuthenticateByName').length)).toBe(1);
  const s = await store(page);
  expect(s.sonance_jf_token).toMatch(/^mock-jf-token-\d+$/);
  expect(s.sonance_jf_token).not.toBe('mock-jf-token-seed');
});

test('R3 a revoked token with a wrong stored password goes to Login', async ({ page }) => {
  await H.bootJellyfin(page, { extra: 'mockJfRevoked=1&mockJfPassword=changed', waitFor: false });
  await page.waitForSelector('.login-screen');
  const calls = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.backend === 'jellyfin')
    .map((c: any) => c.method + ' ' + c.path + ' ' + c.status));
  expect(calls).toEqual(['GET /System/Info 401', 'POST /Users/AuthenticateByName 401']);
});

test('R3 logout revokes the token once, clears the session keys, keeps the device id', async ({ page }) => {
  await H.bootJellyfin(page);
  const device = (await store(page)).sonance_jf_device_id;
  expect(device).toMatch(/^sonance-[0-9a-f]{24}$/);
  await H.navTo(page, 'settings');
  await H.press(page, 'ArrowDown');
  await H.settle(page, 100);
  for (let i = 0; i < 14 && (await H.focus(page)).id !== 'settings-logout-btn'; i++) {
    await H.press(page, 'ArrowDown');
    await H.settle(page, 40);
  }
  await H.press(page, 'Enter');
  await page.waitForSelector('#logout-confirm');
  await H.settle(page, 150);
  await H.press(page, 'ArrowRight');
  await H.settle(page, 60);
  await H.press(page, 'Enter');
  await page.waitForSelector('.login-screen');
  await page.waitForFunction(() => (window as any).__MOCK__.calls.some((c: any) => c.path === '/Sessions/Logout' && c.status));
  const logouts = await page.evaluate(() => (window as any).__MOCK__.calls.filter((c: any) => c.path === '/Sessions/Logout')
    .map((c: any) => c.method + ' ' + c.status + ' ' + /Token="mock-jf-token-seed"/.test(c.auth)));
  expect(logouts).toEqual(['POST 204 true']);
  expect(await page.evaluate(() => (window as any).__MOCK__.jf.tokens())).toEqual([]);
  expect(await store(page)).toEqual({ sonance_jf_device_id: device });
});

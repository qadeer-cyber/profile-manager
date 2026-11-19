// Chrome Stable cookie writer, with a fake Chrome: which profiles use it, how cookies map to CDP,
// that Chrome's own read-back is required, and that a rejected batch is rolled back. The real
// browser check is test/cookie-import-stable-windows.test.js (Windows native gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCookies } from '../server/cookies.js';
import { OFFLINE_ARGS, toCdpCookie, usesChromeStableCookieStore, writeCookiesWithChromeStable } from '../server/browser-runtime/stable-cookies.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const cookies = () => validateCookies([
  { name: 'host', value: 'v-host', domain: 'a.example', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: future },
  { name: 'dom', value: 'v-dom', domain: '.example.test', path: '/app', secure: false, httpOnly: false, sameSite: 'Unspecified' },
]);

test('only Chromium profiles on the Chrome Stable runtime on Windows use the Chrome writer', () => {
  const stable = { browserEngine: 'chromium', advancedSettings: { runtime: 'stable-chrome' } };
  assert.equal(usesChromeStableCookieStore(stable, { platform: 'win32', env: {} }), true);
  assert.equal(usesChromeStableCookieStore(stable, { platform: 'linux', env: {} }), false);
  assert.equal(usesChromeStableCookieStore({ browserEngine: 'chromium', advancedSettings: { runtime: 'compatibility' } }, { platform: 'win32', env: {} }), false);
  assert.equal(usesChromeStableCookieStore({ advancedSettings: {} }, { platform: 'win32', env: { AZWAH_STABLE_CHROME_EDITION: '1' } }), true);
  assert.equal(usesChromeStableCookieStore({ browserEngine: 'firefox', advancedSettings: { runtime: 'stable-chrome' } }, { platform: 'win32', env: {} }), false);
});

test('host-only cookies map to a url without domain; domain cookies keep their dotted domain', () => {
  const [host, dom] = cookies().map(toCdpCookie);
  assert.deepEqual(host, { name: 'host', value: 'v-host', url: 'https://a.example/', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: future });
  assert.deepEqual(dom, { name: 'dom', value: 'v-dom', url: 'http://example.test/app', path: '/app', secure: false, httpOnly: false, domain: '.example.test' });
});

function fakeChrome({ reject = () => false, preexisting = [] } = {}) {
  const jar = new Map(preexisting.map(c => [`${c.domain}\n${c.name}\n${c.path}`, c]));
  const calls = { launches: [], closed: 0, set: [], deleted: [] };
  const cdp = {
    async send(method, params) {
      if (method === 'Network.getAllCookies') return { cookies: [...jar.values()].map(c => ({ ...c })) };
      if (method === 'Network.setCookie') {
        calls.set.push(params);
        if (reject(params)) throw new Error('Invalid cookie fields');
        const domain = params.domain || new URL(params.url).hostname;
        jar.set(`${domain}\n${params.name}\n${params.path}`, { name: params.name, value: params.value, domain, path: params.path, secure: params.secure, httpOnly: params.httpOnly, session: params.expires == null, expires: params.expires ?? -1 });
        return {};
      }
      if (method === 'Network.deleteCookies') { calls.deleted.push(params); jar.delete(`${params.domain}\n${params.name}\n${params.path}`); return {}; }
      throw new Error('unexpected ' + method);
    },
    async detach() {},
  };
  const ctx = { pages: () => [{}], newPage: async () => ({}), newCDPSession: async () => cdp, close: async () => { calls.closed++; } };
  return { jar, calls, launch: async (dir, options) => { calls.launches.push({ dir, options }); return ctx; } };
}

const deps = (fake, locks) => ({
  resolve: async () => ({ path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', version: '157.0.0.0' }),
  launch: fake.launch, lock: dir => locks.push(['lock', dir]), unlock: dir => locks.push(['unlock', dir]),
});

test('Chrome writes the cookies offline, reads them back and closes; the profile lock is held throughout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stable-cookies-'));
  const fake = fakeChrome(), locks = [];
  assert.deepEqual(await writeCookiesWithChromeStable(dir, cookies(), deps(fake, locks)), { imported: 2, writtenBy: 'chrome-stable' });
  assert.equal(fake.calls.launches.length, 1);
  const { options } = fake.calls.launches[0];
  assert.equal(options.headless, true);
  assert.equal(options.executablePath, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(options.args, OFFLINE_ARGS);
  assert.ok(options.args.includes('--proxy-server=socks5://127.0.0.1:9') && options.args.includes('--proxy-bypass-list=<-loopback>'));
  assert.equal(fake.calls.closed, 1);
  assert.deepEqual(locks, [['lock', dir], ['unlock', dir]]);
  assert.deepEqual([...fake.jar.keys()].sort(), ['.example.test\ndom\n/app', 'a.example\nhost\n/']);
});

test('a cookie Chrome rejects fails the whole request, restores what it replaced, and leaks no value', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stable-cookies-'));
  const old = { name: 'host', value: 'old-value', domain: 'a.example', path: '/', secure: true, httpOnly: true, session: false, expires: future };
  const fake = fakeChrome({ reject: p => p.name === 'dom', preexisting: [old] }), locks = [];
  await assert.rejects(writeCookiesWithChromeStable(dir, cookies(), deps(fake, locks)), error => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'COOKIE_REJECTED_BY_CHROME');
    assert.match(error.message, /cookie 2 \(dom, \.example\.test\)/);
    assert.equal(/v-host|v-dom|old-value/.test(error.message), false);
    return true;
  });
  assert.deepEqual([...fake.jar.values()].map(c => [c.name, c.value]), [['host', 'old-value']], 'replaced cookie restored, new one removed');
  assert.equal(fake.calls.closed, 1);
  assert.deepEqual(locks.map(([what]) => what), ['lock', 'unlock']);
});

test('a cookie Chrome silently changes is not reported as imported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stable-cookies-'));
  const fake = fakeChrome(), locks = [];
  const send = fake.launch;
  fake.launch = async (...args) => {
    const ctx = await send(...args);
    const cdp = await ctx.newCDPSession();
    const original = cdp.send.bind(cdp);
    cdp.send = async (method, params) => method === 'Network.setCookie' && params.name === 'host' ? original(method, { ...params, httpOnly: false }) : original(method, params);
    return ctx;
  };
  await assert.rejects(writeCookiesWithChromeStable(dir, cookies(), { ...deps(fake, locks), launch: fake.launch }), { code: 'COOKIE_REJECTED_BY_CHROME' });
  assert.equal(fake.jar.size, 0);
});

test('Chrome that cannot start fails with 503 and releases the lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stable-cookies-'));
  const locks = [];
  await assert.rejects(writeCookiesWithChromeStable(dir, cookies(), { ...deps(fakeChrome(), locks), launch: async () => { throw new Error('browserType.launchPersistentContext: spawn failed\nmore'); } }),
    { status: 503, code: 'CHROME_STABLE_COOKIE_WRITE_FAILED', message: 'Chrome Stable could not open this profile to import cookies: spawn failed' });
  assert.deepEqual(locks.map(([what]) => what), ['lock', 'unlock']);
});

test('a profile last opened by a newer Chrome is refused before Chrome starts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stable-cookies-'));
  fs.writeFileSync(path.join(dir, 'Last Version'), '999.0.0.0');
  const fake = fakeChrome(), locks = [];
  await assert.rejects(writeCookiesWithChromeStable(dir, cookies(), deps(fake, locks)), { code: 'CHROME_PROFILE_DOWNGRADE' });
  assert.equal(fake.calls.launches.length, 0);
  assert.deepEqual(locks, []);
});

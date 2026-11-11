import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { resolveWindowsChromeStable } from '../server/browser-runtime/chrome-stable.js';

test('visible signed Windows Chrome Stable applies manual location through the private pipe', { timeout: 180000 }, async () => {
  assert.equal(process.platform, 'win32');
  const execute = promisify(execFile);
  const stable = await resolveWindowsChromeStable({ run: async (...args) => {
    try { return await execute(...args); }
    catch (error) {
      console.error('Chrome identity probe failed:', error.code, String(error.stderr || '').slice(0, 1800));
      throw error;
    }
  } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-stable-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'stable-fixture-token';
  const engine = await import('../server/browsers.js');
  const { startServer } = await import('../server/app.js');
  const { db } = await import('../server/db.js');
  const fixture = createServer((req, res) => {
    if (req.url === '/identity') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ua: req.headers['user-agent'], languages: req.headers['accept-language'] }));
    } else if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('self.addEventListener("install", () => self.skipWaiting());');
    } else res.end('<title>Visible Chrome location fixture</title>');
  });
  const rejectedProxy = createServer();
  rejectedProxy.on('connect', (_, socket) => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n'));
  await new Promise(resolve => rejectedProxy.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  let server;
  try {
    server = await startServer({ port: 0, staticDir: null });
    const api = async (method, route, body, expected = 200) => {
      const response = await fetch(server.url + '/api/v1' + route, {
        method, body: body && JSON.stringify(body),
        headers: { Authorization: 'Bearer stable-fixture-token', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    };
    const profile = await api('POST', '/profiles', {
      name: 'Stable fixture', browserSettings: { timezoneId: 'America/Los_Angeles', locale: 'en-US', languages: ['en-US', 'en'] },
      advancedSettings: { runtime: 'stable-chrome', geolocation: { mode: 'manual', permission: 'allow', latitude: 37.4, longitude: -122.1, accuracy: 65000 } },
    }, 201);
    const endpoint = '/profiles/' + profile.id;
    const peer = await api('POST', '/profiles', { name: 'Independent Stable fixture',
      advancedSettings: { runtime: 'stable-chrome' }, browserSettings: { timezoneId: 'Europe/Berlin', locale: 'de-DE', languages: ['de-DE', 'de'] } }, 201);
    const peerEndpoint = '/profiles/' + peer.id;
    const peerRun = await api('POST', peerEndpoint + '/launch', { headless: false, url: origin });
    const peerPage = engine.liveContext(peer.id).pages()[0];
    const third = await api('POST', '/profiles', { name: 'Third independent Stable fixture',
      advancedSettings: { runtime: 'stable-chrome' },
      browserSettings: { timezoneId: 'Asia/Karachi', locale: 'ur-PK', languages: ['ur-PK', 'ur'] } }, 201);
    const thirdEndpoint = '/profiles/' + third.id;
    const thirdRun = await api('POST', thirdEndpoint + '/launch', { headless: false, url: origin });
    assert.notEqual(thirdRun.pid, peerRun.pid);
    const thirdPage = engine.liveContext(third.id).pages()[0];
    const blocked = await api('POST', '/profiles', { name: 'Rejected proxy fixture',
      advancedSettings: { runtime: 'stable-chrome' },
      proxy: { type: 'http', host: '127.0.0.1', port: rejectedProxy.address().port, username: 'fixture', password: 'invalid' } }, 201);
    const failed = await api('POST', '/profiles/' + blocked.id + '/launch', { headless: false }, 503);
    assert.equal(failed.code, 'PROXY_AUTH_REQUIRED');
    assert.equal((await api('GET', '/profiles/' + blocked.id)).running, false);
    async function observeIdentity(page, languages) {
      const observed = await page.evaluate(async () => {
        const http = await fetch('/identity').then(response => response.json());
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1379b1';
        ctx.fillRect(2, 4, 24, 19);
        return { http, userAgent: navigator.userAgent, languages: [...navigator.languages],
          locale: Intl.DateTimeFormat().resolvedOptions().locale, brands: navigator.userAgentData?.brands,
          platform: navigator.userAgentData?.platform, canvas: canvas.toDataURL(),
          hardwareConcurrency: navigator.hardwareConcurrency };
      });
      assert.equal(observed.userAgent, observed.http.ua);
      assert.deepEqual(observed.languages, languages);
      assert.deepEqual(observed.http.languages.split(',').map(item => item.split(';')[0]), languages);
      assert.equal(observed.locale, languages[0]);
      assert.equal(observed.platform, 'Windows');
      assert.ok(observed.brands.some(brand => brand.brand === 'Google Chrome' && brand.version === stable.version.split('.')[0]));
      const { canvas, ...report } = observed;
      return { ...report, canvasSha256: createHash('sha256').update(canvas).digest('hex') };
    }
    const peerIdentity = await observeIdentity(peerPage, ['de-DE', 'de']);
    let priorIdentity;
    for (let run = 0; run < 2; run++) {
      await api('POST', endpoint + '/launch', { headless: false, url: origin });
      const current = await api('GET', endpoint);
      assert.equal(current.cdp, undefined, 'No public debugging port for ordinary browsing');
      assert.ok(Number.isSafeInteger(current.pid) && current.pid > 0);
      assert.notEqual(current.pid, peerRun.pid);
      assert.notEqual(current.pid, thirdRun.pid);
      const actual = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${current.pid}).Path`], { encoding: 'utf8', timeout: 10000 }).trim();
      assert.equal(actual.toLowerCase(), stable.path.toLowerCase());
      console.log(JSON.stringify({ executable: actual, version: stable.version, pid: current.pid, run }));
      const context = engine.liveContext(profile.id);
      const first = context.pages()[0];
      await first.goto(origin);
      const storage = (page) => page.evaluate(async () => ({
        cookie: document.cookie,
        local: localStorage.getItem('azwah'),
        session: sessionStorage.getItem('azwah'),
        databases: (await indexedDB.databases()).map(db => db.name),
        caches: await caches.keys(),
        workers: (await navigator.serviceWorker.getRegistrations()).length,
      }));
      if (run === 0) await first.evaluate(async () => {
        document.cookie = 'azwah=private; Max-Age=86400; Path=/';
        localStorage.setItem('azwah', 'profile-a');
        sessionStorage.setItem('azwah', 'profile-a');
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('azwah-private', 1);
          request.onsuccess = () => { request.result.close(); resolve(); };
          request.onerror = () => reject(request.error);
        });
        await caches.open('azwah-private');
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      });
      const stored = await storage(first);
      assert.deepEqual({ ...stored, session: null }, {
        cookie: 'azwah=private', local: 'profile-a', session: null,
        databases: ['azwah-private'], caches: ['azwah-private'], workers: 1,
      });
      if (run === 0) assert.equal(stored.session, 'profile-a');
      await peerPage.reload();
      assert.deepEqual(await storage(peerPage), { cookie: '', local: null, session: null, databases: [], caches: [], workers: 0 });
      await thirdPage.reload();
      assert.deepEqual(await storage(thirdPage), { cookie: '', local: null, session: null, databases: [], caches: [], workers: 0 });
      assert.equal(await thirdPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Asia/Karachi');
      assert.equal(await peerPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Europe/Berlin');
      assert.deepEqual(await first.evaluate(() => [new Date('2025-01-15T12:00Z').getTimezoneOffset(),
        new Date('2025-07-15T12:00Z').getTimezoneOffset()]), [480, 420]);
      assert.equal(await first.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state), 'prompt');
      await context.grantPermissions(['geolocation'], { origin });
      const second = await context.newPage();
      for (const page of [first, second]) {
        await page.goto(origin + '/location');
        const identity = await observeIdentity(page, ['en-US', 'en']);
        if (priorIdentity) assert.deepEqual(identity, priorIdentity);
        else priorIdentity = identity;
        assert.equal(identity.userAgent, peerIdentity.userAgent);
        const result = await page.evaluate(() => new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(({ coords }) => resolve({
            latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }), error => reject(new Error(error.message)), { timeout: 8000 });
        }));
        assert.deepEqual(result, { latitude: 37.4, longitude: -122.1, accuracy: 65000, timezone: 'America/Los_Angeles' });
        console.log(JSON.stringify(result));
      }
      await api('POST', endpoint + '/stop');
    }
    console.log(JSON.stringify({ identity: 'stock Chrome', version: stable.version, profiles: 3, consistentAcrossTabsAndRelaunch: true,
      checked: ['UA header', 'UA client hints brand/version/platform', 'locale', 'ordered languages', 'canvas sample', 'hardware concurrency'] }));
    await api('POST', peerEndpoint + '/stop');
    await api('POST', thirdEndpoint + '/stop');
  } finally {
    try { await server?.close(); } finally {
      rejectedProxy.close();
      rejectedProxy.closeAllConnections();
      fixture.close();
      fixture.closeAllConnections();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});

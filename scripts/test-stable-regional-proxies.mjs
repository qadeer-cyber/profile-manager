import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProxyLine } from '../server/proxy-line.js';
import { publicIp } from '../server/proxy-location.js';

const origin = 'https://api64.ipify.org';
const address = origin + '/?format=json';
let stage = 'validate input';
let dir, server, db;
const canonical = timeZone => new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
const dates = ['2025-01-15T12:00:00Z', '2025-07-15T12:00:00Z'];
const expectedOffset = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(date));
  return parts.find(part => part.type === 'timeZoneName').value;
};

try {
  assert.equal(process.platform, 'win32');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(input.length < 16000);
  }
  const { account, license, proxies } = JSON.parse(input.trim());
  input = '';
  assert.equal(proxies.length, 2);
  const expected = proxies.map(({ endpoint, ip, timezone }) => {
    assert.match(endpoint, /^(https?|socks5h?):\/\//);
    const proxy = parseProxyLine(endpoint);
    assert.ok(proxy.username);
    assert.ok(publicIp(ip));
    return { proxy, ip: publicIp(ip), zone: canonical(timezone) };
  });
  assert.notEqual(expected[0].ip, expected[1].ip);
  assert.notEqual(expected[0].zone, expected[1].zone);

  stage = 'initialize isolated acceptance store';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-regional-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = randomUUID();
  const engine = await import('../server/browsers.js');
  const { startServer } = await import('../server/app.js');
  ({ db } = await import('../server/db.js'));
  const { saveGeoIpCredentials } = await import('../server/geoip-settings.js');
  saveGeoIpCredentials({ account, license });
  server = await startServer({ port: 0, host: '127.0.0.1', staticDir: null });
  const api = async (method, route, body, status = 200) => {
    const response = await fetch(server.url + '/api/v1' + route, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (response.status !== status) {
      const code = /^[A-Z][A-Z_0-9]+$/.test(data.code ?? '') ? data.code : 'HTTP_' + response.status;
      throw Object.assign(new Error('Acceptance request rejected'), { code });
    }
    return data;
  };

  const ids = [];
  for (const [index, fixture] of expected.entries()) {
    stage = 'create proxy profile ' + (index + 1);
    const p = await api('POST', '/profiles', {
      name: 'Regional acceptance ' + (index + 1),
      proxy: fixture.proxy,
      advancedSettings: { runtime: 'stable-chrome', geolocation: { mode: 'auto', permission: 'ask' } },
    }, 201);
    ids.push(p.id);
  }

  for (const pass of ['initial', 'relaunch']) {
    stage = pass + ': launch both proxy profiles';
    const running = await Promise.all(ids.map(id => api('POST', '/profiles/' + id + '/launch', { headless: false })));
    assert.ok(running.every(profile => profile.pid > 0 && !profile.cdp));
    assert.notEqual(running[0].pid, running[1].pid);
    for (const [index, id] of ids.entries()) {
      stage = pass + ': verify browser profile ' + (index + 1);
      const expectedIdentity = expected[index];
      const diagnostics = (await api('GET', '/profiles/' + id)).lastProxyLocation;
      assert.equal(diagnostics?.ip, expectedIdentity.ip);
      assert.equal(canonical(diagnostics.timezone), expectedIdentity.zone);
      assert.ok(diagnostics.browserVerifiedAt && diagnostics.browserTimezoneVerifiedAt);
      const context = engine.liveContext(id);
      const pages = [context.pages()[0], await context.newPage()];
      for (const page of pages) {
        for (const suffix of ['', '&navigation=2']) {
          const response = await page.goto(address + suffix, { timeout: 15000 });
          assert.ok(response?.ok() && new URL(response.url()).origin === origin);
          assert.equal(publicIp((await response.json()).ip), expectedIdentity.ip);
          const observed = await page.evaluate(instants => ({
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            offsets: instants.map(date => new Intl.DateTimeFormat('en', { timeZoneName: 'longOffset' })
              .formatToParts(new Date(date)).find(part => part.type === 'timeZoneName').value),
          }), dates);
          assert.equal(canonical(observed.zone), expectedIdentity.zone);
          assert.deepEqual(observed.offsets, dates.map(date => expectedOffset(date, expectedIdentity.zone)));
        }
      }
      console.log(JSON.stringify({ pass, profile: index + 1, browserExitMatched: true,
        timezone: expectedIdentity.zone, coordinatesVerifiedAtLaunch: true, dstSamplesMatched: true }));
    }
    stage = pass + ': stop both profiles';
    await Promise.all(ids.map(id => api('POST', '/profiles/' + id + '/stop')));
  }
  console.log('PASS regional proxy identity. Rotation, DNS, WebRTC and IPv6 are separate acceptance gates.');
} catch (error) {
  // Never print a raw assertion, API response, URL, or config containing credentials.
  const code = /^[A-Z][A-Z_0-9]+$/.test(error.code ?? '') ? ' (' + error.code + ')' : '';
  console.error('FAIL ' + stage + code);
  process.exitCode = 1;
} finally {
  try { await server?.close(); }
  catch { process.exitCode = 1; console.error('FAIL close isolated acceptance server'); }
  finally {
    db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

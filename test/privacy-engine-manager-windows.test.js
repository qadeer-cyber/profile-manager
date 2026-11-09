import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('Azwah manager launches five overlapping installed dedicated browser profiles', { timeout: 210000 }, async () => {
  assert.equal(process.platform, 'win32');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-manager-qa-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'local-manager-fixture';
  process.env.PM_PRIVACY_ENGINE_EXE = process.env.AZWAH_ENGINE_EXE;
  process.env.PM_PRIVACY_ENGINE_QA = '1';
  const { startServer } = await import('../server/app.js');
  const { db, setSetting } = await import('../server/db.js');
  setSetting('maxRunningProfiles', 20);
  setSetting('maxConcurrentLaunches', 2);
  const direct = new Map();
  let forwarded = 0;
  const fixture = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!req.headers['x-qa-proxy']) direct.set(url.pathname, (direct.get(url.pathname) || 0) + 1);
    const marker = url.searchParams.get('seed');
    res.setHeader('Content-Type', 'text/html');
    res.end(`<script>window.before = localStorage.getItem('qa');${marker && /^profile_\d+$/.test(marker)
      ? `localStorage.setItem('qa', '${marker}'); document.cookie = 'qa=${marker}; Max-Age=3600; Path=/';` : ''}</script>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  const proxy = createServer((req, res) => {
    if (req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('qa:pass').toString('base64')) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="QA"' }).end();
      return;
    }
    if (!req.url.startsWith(origin + '/')) { res.writeHead(403).end(); return; }
    forwarded++;
    const headers = { ...req.headers, 'x-qa-proxy': '1' };
    delete headers['proxy-authorization'];
    const upstream = request(req.url, { headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    upstream.end();
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  let server;
  const profiles = [];
  const read = id => {
    const root = path.join(dir, 'profiles', id, 'privacy-engine');
    const newest = fs.readdirSync(root).filter(name => name.endsWith('.evidence')).map(name => path.join(root, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    assert.ok(newest);
    return JSON.parse(fs.readFileSync(newest, 'utf8'));
  };
  try {
    server = await startServer({ port: 0, staticDir: null, uiToken: 'qa-ui-token' });
    async function api(method, url, payload, status = 200) {
      const response = await fetch(server.url + '/api' + url, {
        method, signal: AbortSignal.timeout(90000),
        headers: { 'X-UI-Token': 'qa-ui-token', 'Content-Type': 'application/json' },
        body: payload && JSON.stringify(payload),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    }
    const launch = (profile, seed) => api('POST', '/profiles/' + profile.id + '/launch', {
      url: origin + '/profile_' + profile.index + (seed ? '?seed=profile_' + profile.index : ''),
    });
    for (let index = 0; index < 5; index++) {
      const timezone = ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/London', 'Asia/Karachi', 'Europe/Paris'][index];
      const location = { mode: 'manual', permission: 'allow', latitude: 20 + index, longitude: -45 - index, accuracy: 40000 + index };
      const profile = await api('POST', '/profiles', {
        name: 'QA Profile ' + index, folder: 'QA', browserSettings: { timezoneId: timezone },
        advancedSettings: { runtime: 'privacy', geolocation: location },
        ...(index === 0 ? { proxy: { host: '127.0.0.1', port: proxy.address().port, type: 'http', username: 'qa', password: 'pass' } } : {}),
      }, 201);
      profiles.push({ ...profile, timezone, location, index });
    }
    await Promise.all(profiles.map(profile => launch(profile, true)));
    const running = await Promise.all(profiles.map(profile => api('GET', '/profiles/' + profile.id)));
    assert.equal(new Set(running.map(profile => profile.pid)).size, 5);
    for (const [index, profile] of profiles.entries()) {
      const evidence = read(profile.id);
      assert.equal(evidence.pid, running[index].pid);
      assert.ok(running[index].running);
      process.kill(evidence.pid, 0);
      assert.equal(evidence.executable.toLowerCase(), process.env.AZWAH_ENGINE_EXE.toLowerCase());
      assert.equal(evidence.ui.tabs, 2);
      assert.match(evidence.ui.address, new RegExp('/profile_' + index));
      assert.equal(evidence.sandboxed, true);
      assert.equal(evidence.first.previous, null);
      for (const [tab, result] of [evidence.first, evidence.second].entries()) {
        assert.equal(result.timezone, profile.timezone);
        assert.deepEqual(result.position, [profile.location.latitude, profile.location.longitude, profile.location.accuracy], 'Profile ' + index + ', tab ' + tab);
        assert.equal(result.storage, 'profile_' + index);
        assert.equal(result.cookie, 'qa=profile_' + index);
        assert.equal(result.node, 'undefined');
      }
      console.log(JSON.stringify({ pid: evidence.pid, chromium: evidence.chromium, executable: evidence.executable,
        timezone: evidence.first.timezone, position: evidence.first.position, tabs: evidence.ui.tabs }));
    }
    assert.ok(forwarded >= 2);
    assert.equal(direct.get('/profile_0') || 0, 0);
    await launch(profiles[0], true);
    assert.equal((await api('GET', '/profiles/' + profiles[0].id)).pid, running[0].pid);
    const killed = spawnSync('taskkill.exe', ['/PID', String(running[1].pid), '/T', '/F'], { encoding: 'utf8' });
    assert.equal(killed.status, 0, killed.stderr);
    const pathB = '/profiles/' + profiles[1].id;
    for (let i = 0; i < 80 && (await api('GET', pathB)).running; i++) await delay(250);
    assert.equal((await api('GET', pathB)).running, false);
    for (const index of [0, 2, 3, 4]) {
      process.kill(running[index].pid, 0);
      assert.equal((await api('GET', '/profiles/' + profiles[index].id)).pid, running[index].pid);
    }
    await launch(profiles[1], false);
    const recovered = read(profiles[1].id);
    assert.notEqual(recovered.pid, running[1].pid);
    assert.equal(recovered.first.storage, 'profile_1');
    assert.equal(recovered.first.cookie, 'qa=profile_1');
    await api('POST', '/profiles/' + profiles[1].id + '/stop');
    assert.equal((await api('GET', pathB)).running, false);
  } finally {
    try { await server?.close(); } finally {
      for (const listener of [proxy, fixture]) { listener.close(); listener.closeAllConnections(); }
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
    }
  }
});

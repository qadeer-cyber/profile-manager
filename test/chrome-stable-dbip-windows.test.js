import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Server } from 'proxy-chain';
import { publicIp } from '../server/proxy-location.js';

test('signed Chrome launches through an authenticated public-egress proxy without MaxMind', { timeout: 120_000 }, async () => {
  assert.equal(process.platform, 'win32');
  delete process.env.AZWAH_MAXMIND_ACCOUNT_ID;
  delete process.env.AZWAH_MAXMIND_LICENSE_KEY;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-dbip-live-'));
  process.env.PM_DATA_DIR = directory;
  fs.cpSync('build/geoip-dbip', path.join(directory, 'geoip-dbip'), { recursive: true });
  process.env.PM_API_TOKEN = randomUUID();
  const username = randomUUID();
  const password = randomUUID();
  let authenticated = 0;
  const proxy = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
    const allowed = request.username === username && request.password === password &&
      request.hostname === 'api64.ipify.org' && request.port === 443;
    if (allowed) authenticated++;
    return { requestAuthentication: !allowed };
  } });
  const { startServer } = await import('../server/app.js');
  const { getSetting, db } = await import('../server/db.js');
  const engine = await import('../server/browsers.js');
  let server;
  let profile;
  try {
    await proxy.listen();
    server = await startServer({ port: 0, staticDir: null });
    async function api(route, body, status) {
      const response = await fetch(server.url + '/api/v1' + route, {
        method: 'POST', body: JSON.stringify(body),
        headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json();
      assert.equal(response.status, status, data.code || 'Unexpected API status');
      return data;
    }
    profile = await api('/profiles', {
      name: 'Automatic DB-IP acceptance',
      advancedSettings: { runtime: 'stable-chrome' },
      proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username, password },
    }, 201);
    const route = '/profiles/' + profile.id;
    for (let launch = 0; launch < 2; launch++) {
      await api(route + '/launch', { headless: false }, 200);
      const result = getSetting('proxy-location:' + profile.id, null);
      assert.equal(result.source, 'DB-IP City Lite');
      assert.ok(publicIp(result.ip));
      assert.ok(result.browserVerifiedAt);
      const context = engine.liveContext(profile.id);
      const page = context.pages()[0] || await context.newPage();
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), result.timezone);
      await engine.stop(profile.id);
    }
    assert.ok(authenticated >= 3, 'Proxy must receive authenticated outbound traffic');
  } finally {
    if (profile) await engine.stop(profile.id).catch(() => {});
    await server?.close();
    await proxy.close(true);
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

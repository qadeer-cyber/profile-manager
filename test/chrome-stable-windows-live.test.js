import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { resolveWindowsChromeStable } from '../server/browser-runtime/chrome-stable.js';

test('visible signed Windows Chrome Stable applies manual location through the private pipe', { timeout: 120000 }, async () => {
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
  const fixture = createServer((req, res) => res.end('<title>Visible Chrome location fixture</title>'));
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
      name: 'Stable fixture', browserSettings: { timezoneId: 'America/Los_Angeles' },
      advancedSettings: { geolocation: { mode: 'manual', permission: 'allow', latitude: 37.4, longitude: -122.1, accuracy: 65000 } },
    }, 201);
    const endpoint = '/profiles/' + profile.id;
    for (let run = 0; run < 2; run++) {
      await api('POST', endpoint + '/launch', { headless: false, url: origin });
      const current = await api('GET', endpoint);
      assert.equal(current.cdp, undefined, 'No public debugging port for ordinary browsing');
      assert.ok(Number.isSafeInteger(current.pid) && current.pid > 0);
      const actual = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${current.pid}).Path`], { encoding: 'utf8', timeout: 10000 }).trim();
      assert.equal(actual.toLowerCase(), stable.path.toLowerCase());
      console.log(JSON.stringify({ executable: actual, version: stable.version, pid: current.pid, run }));
      const context = engine.liveContext(profile.id);
      const first = context.pages()[0];
      await first.goto(origin);
      assert.equal(await first.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state), 'prompt');
      await context.grantPermissions(['geolocation'], { origin });
      const second = await context.newPage();
      for (const page of [first, second]) {
        await page.goto(origin + '/location');
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
  } finally {
    try { await server?.close(); } finally {
      fixture.close();
      fixture.closeAllConnections();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});

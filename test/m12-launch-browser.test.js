import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { resetLaunchMetricsForTests } from '../server/launch-metrics.js';

test('records cold then warm launch timings from real Chromium', { timeout: 180000 }, async () => {
  resetLaunchMetricsForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m12-launch-'));
  const server = http.createServer((req, res) => { res.end('ok'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm12-launch' };
  const auth = { Authorization: 'Bearer m12-launch', 'Content-Type': 'application/json' };
  let proc;
  try {
    proc = await spawnServer(env);
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });
    const created = await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Timing' }) }).then(r => r.json());
    const id = created.id;
    const launch = async () => {
      const t0 = performance.now();
      const response = await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ headless: true, automation: true, url: pageUrl }),
      });
      assert.equal(response.ok, true);
      const status = await fetch(`${proc.url}/api/v1/profiles/${id}/launch-status`, { headers: auth }).then(r => r.json());
      const wallMs = performance.now() - t0;
      await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth });
      return { status, wallMs };
    };
    const cold = await launch();
    assert.equal(cold.status.metrics.warmStart, false);
    assert.ok(cold.status.metrics.totalLaunchMs > 0);
    assert.ok(cold.wallMs > 0);
    const warm = await launch();
    assert.equal(warm.status.metrics.warmStart, true);
    assert.ok(warm.status.metrics.totalLaunchMs > 0);
    console.log('M12_BENCHMARK cold_totalLaunchMs=' + cold.status.metrics.totalLaunchMs
      + ' warm_totalLaunchMs=' + warm.status.metrics.totalLaunchMs
      + ' cold_wallMs=' + Math.round(cold.wallMs)
      + ' warm_wallMs=' + Math.round(warm.wallMs));
    const resources = await fetch(`${proc.url}/api/v1/resources`, { headers: auth }).then(r => r.json());
    assert.ok(resources.host.totalMemGiB > 0);
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(r => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

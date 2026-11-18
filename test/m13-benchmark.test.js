import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { resetLaunchMetricsForTests } from '../server/launch-metrics.js';

test('M13 benchmark line records cold/warm launch and host specs (Linux agent)', { timeout: 240000 }, async () => {
  resetLaunchMetricsForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m13-bench-'));
  const server = http.createServer((req, res) => { res.end('ok'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm13b' };
  const auth = { Authorization: 'Bearer m13b', 'Content-Type': 'application/json' };
  let proc;
  try {
    proc = await spawnServer(env);
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });
    const created = await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Bench' }) }).then(r => r.json());
    const id = created.id;
    const cycle = async () => {
      await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, { method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: pageUrl }) });
      const mon = await fetch(`${proc.url}/api/v1/monitoring`, { headers: auth }).then(r => r.json());
      await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth });
      return mon;
    };
    const coldMon = await cycle();
    const warmMon = await cycle();
    const coldMetrics = coldMon.profiles.find(row => row.id === id)?.launchMetrics;
    const warmMetrics = warmMon.profiles.find(row => row.id === id)?.launchMetrics;
    assert.equal(coldMetrics.warmStart, false);
    assert.equal(warmMetrics.warmStart, true);
    console.log('M13_BENCHMARK platform=' + coldMon.environment.platform
      + ' cores=' + coldMon.environment.logicalCores
      + ' cold_ms=' + coldMetrics.totalLaunchMs
      + ' warm_ms=' + warmMetrics.totalLaunchMs
      + ' browser_ram_mib=' + (coldMon.totals.totalBrowserMemoryMiB ?? 'n/a'));
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(r => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { resetLaunchMetricsForTests } from '../server/launch-metrics.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m12-'));
const envBase = { PM_DATA_DIR: dir, PM_API_TOKEN: 'm12' };
const auth = { Authorization: 'Bearer m12', 'Content-Type': 'application/json' };

before(() => resetLaunchMetricsForTests());
after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function api(proc, method, url, body) {
  const response = await fetch(proc.url + '/api/v1' + url, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  return { status: response.status, body: value };
}

test('resources and launch-status endpoints expose queue and host memory', async () => {
  const proc = await spawnServer({ ...process.env, ...envBase });
  try {
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });
    const resources = await api(proc, 'GET', '/resources');
    assert.equal(resources.status, 200);
    assert.ok(resources.body.host.totalMemGiB > 0);
    assert.equal(typeof resources.body.queue.maxConcurrentLaunches, 'number');
    const created = await api(proc, 'POST', '/profiles', { name: 'Res' });
    const status = await api(proc, 'GET', `/profiles/${created.body.id}/launch-status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.running, false);
  } finally {
    await stopServer(proc);
  }
});

test('hardware consistency includes interpretation headline', async () => {
  const proc = await spawnServer({ ...process.env, ...envBase });
  try {
    const created = await api(proc, 'POST', '/profiles', { name: 'Interp' });
    const hw = await api(proc, 'GET', `/profiles/${created.body.id}/hardware`);
    assert.equal(hw.status, 200);
    assert.match(hw.body.consistency.interpretation.headline, /No consistency|Partial|match|mismatch/i);
  } finally {
    await stopServer(proc);
  }
});

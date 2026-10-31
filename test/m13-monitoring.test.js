import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m13-mon-'));
const auth = { Authorization: 'Bearer m13', 'Content-Type': 'application/json' };

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('monitoring API returns contract fields from real host observations', async () => {
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm13' });
  try {
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0 }) });
    const response = await fetch(proc.url + '/api/monitoring', { headers: auth });
    const body = await response.json();
    assert.equal(response.ok, true);
    assert.equal(typeof body.generatedAt, 'string');
    assert.ok(body.host.totalMemGiB > 0);
    assert.equal(typeof body.queue.maxConcurrentLaunches, 'number');
    assert.equal(Array.isArray(body.profiles), true);
    assert.equal(typeof body.totals.runningProfiles, 'number');
    assert.equal(typeof body.environment.platform, 'string');
  } finally {
    await stopServer(proc);
  }
});

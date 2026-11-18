import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

test('cancel during startup does not leave last_error set', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m17-cancel-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm17c', PM_PROCESS_SAMPLE_MS: '8000' };
  const auth = { Authorization: 'Bearer m17c', 'Content-Type': 'application/json' };
  const proc = await spawnServer(env);
  try {
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxConcurrentLaunches: 1 }) });
    const created = await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Cancel' }) }).then(r => r.json());
    const id = created.id;
    const launchPromise = fetch(proc.url + '/api/v1/profiles/' + id + '/launch', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ headless: true, automation: true }),
    });
    await new Promise(r => setTimeout(r, 50));
    await fetch(proc.url + '/api/v1/profiles/' + id + '/launch/cancel', { method: 'POST', headers: auth });
    const launchResponse = await launchPromise;
    assert.ok(launchResponse.status === 499 || launchResponse.status >= 400);
    const profile = await fetch(proc.url + '/api/v1/profiles/' + id, { headers: auth }).then(r => r.json());
    assert.ok(!profile.last_error, profile.last_error || '');
    const second = await fetch(proc.url + '/api/v1/profiles/' + id + '/launch', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ headless: true, automation: true, url: 'about:blank' }),
    });
    assert.equal(second.ok, true);
    await fetch(proc.url + '/api/v1/profiles/' + id + '/stop', { method: 'POST', headers: auth });
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

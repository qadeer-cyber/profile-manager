import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-exec-cdp-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'cli-exec-cdp' };
delete env.PM_SECRET;
let proc;

after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('pm-cli exec reads a page title over the profile CDP endpoint', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture();
  t.after(() => fixture.close());
  proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer cli-exec-cdp', 'Content-Type': 'application/json' };
  const created = await fetch(`${proc.url}/api/v1/profiles`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: 'CLI exec', automationEnabled: true }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const launched = await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, {
    method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: fixture.origin }),
  });
  assert.equal(launched.status, 200, await launched.text());
  const result = spawnSync(process.execPath, ['scripts/pm-cli.mjs', '--json', 'exec', 'examples/local-automation/exec-cdp-title.mjs', id], {
    encoding: 'utf8',
    env: { ...env, PM_API_BASE: `${proc.url}/api/v1`, PM_UI_BASE: `${proc.url}/api` },
    timeout: 60000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const wrapped = JSON.parse(result.stdout);
  const inner = JSON.parse(wrapped.stdout);
  assert.equal(inner.ok, true);
  assert.match(inner.title, /pm-fixture/i);
  assert.equal(result.stdout.includes('cli-exec-cdp'), false);
  const still = await fetch(`${proc.url}/api/v1/profiles/${id}/launch-status`, { headers: auth });
  assert.equal(still.status, 200);
  await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth, body: '{}' });
});

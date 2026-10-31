import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cdp-reconnect-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'cdp-reconnect' };
delete env.PM_SECRET;
let proc;

after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('Playwright connectOverCDP reconnects after client disconnect without killing browser', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture();
  t.after(() => fixture.close());
  proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer cdp-reconnect', 'Content-Type': 'application/json' };
  const created = await fetch(`${proc.url}/api/v1/profiles`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: 'CDP reconnect', automationEnabled: true }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const launched = await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, {
    method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: fixture.origin }),
  });
  assert.equal(launched.status, 200);
  const { cdp } = await launched.json();
  const endpoint = cdp.httpEndpoint;

  const first = await chromium.connectOverCDP(endpoint);
  t.after(() => first.close());
  const title1 = await first.contexts()[0].pages()[0].title();
  assert.match(title1, /pm-fixture/i);
  await first.close();

  const second = await chromium.connectOverCDP(endpoint);
  t.after(() => second.close());
  const title2 = await second.contexts()[0].pages()[0].title();
  assert.match(title2, /pm-fixture/i);
  await second.close();

  const stopped = await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(stopped.status, 200);
});

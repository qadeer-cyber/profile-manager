import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAttachDescriptor } from '../server/automation-attach.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-attach-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'attach-api';
const { startServer } = await import('../server/app.js');
let server;

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer attach-api', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('attach descriptor is Chromium-only and does not claim Firefox CDP', () => {
  const chromium = buildAttachDescriptor({ profileId: 'p1', engine: 'chromium', cdpPort: 9222, wsEndpoint: 'ws://127.0.0.1:9222/devtools', running: true });
  assert.equal(chromium.attachable, true);
  assert.equal(chromium.playwright.endpoint, 'http://127.0.0.1:9222');
  assert.equal(chromium.playwright.disconnectClosesBrowser, false);
  assert.equal(chromium.puppeteer.browserURL, 'http://127.0.0.1:9222');
  assert.equal(chromium.firefox.cdpAttach, false);
  const firefox = buildAttachDescriptor({ profileId: 'p2', engine: 'firefox', cdpPort: 2828, wsEndpoint: null, running: true });
  assert.equal(firefox.attachable, false);
  assert.equal(firefox.playwright, null);
  assert.equal(firefox.puppeteer, null);
});

test('automation-attach rejects stopped Chromium and running Firefox', async () => {
  const stopped = await call('POST', '/api/v1/profiles', { name: 'Stopped' });
  const missing = await call('GET', `/api/v1/profiles/${stopped.body.id}/automation-attach`);
  assert.equal(missing.status, 409);
  assert.equal(missing.body.code, 'NOT_RUNNING');
  const firefox = await call('POST', '/api/v1/profiles', { name: 'FF', browserEngine: 'firefox' });
  const { db } = await import('../server/db.js');
  db.prepare('INSERT INTO running (id, pid, cdp_port, ws_endpoint, relay_url, started_at) VALUES (?,?,?,?,?,?)')
    .run(firefox.body.id, 4242, 2828, null, null, new Date().toISOString());
  const blocked = await call('GET', `/api/v1/profiles/${firefox.body.id}/automation-attach`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'FIREFOX_NO_CDP');
  assert.equal(blocked.body.playwright, null);
});

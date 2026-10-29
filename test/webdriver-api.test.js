import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-wd-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'wd-api';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer wd-api', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  delete process.env.PM_DATA_DIR;
});

test('webdriver start rejects profiles without CDP automation port', async () => {
  const created = await call('POST', '/api/v1/profiles', { name: 'No CDP' });
  assert.equal(created.status, 201);
  const blocked = await call('POST', `/api/v1/profiles/${created.body.id}/webdriver/start`, {});
  assert.equal(blocked.status, 409);
  const report = await call('GET', '/api/v1/webdriver');
  assert.equal(report.status, 200);
  assert.equal(report.body.bundled, false);
});

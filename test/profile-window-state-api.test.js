import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-win-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'win-api';

const { startServer } = await import('../server/app.js');
const { writeWindowState } = await import('../server/window-state.js');
let server;

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer win-api', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
};

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('GET /profiles/:id/window-state exposes saved bounds when rememberLastWindow is on', async () => {
  const created = await call('POST', '/api/v1/profiles', {
    name: 'Window state',
    advancedSettings: { preferences: { rememberLastWindow: true }, screen: { preset: 'native' } },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  writeWindowState(id, { width: 1366, height: 768, left: 8, top: 16, maximized: false });
  const row = await call('GET', `/api/v1/profiles/${id}/window-state`);
  assert.equal(row.status, 200);
  assert.equal(row.body.rememberLastWindow, true);
  assert.equal(row.body.saved.width, 1366);
  assert.match(row.body.note, /multi-monitor/i);
});

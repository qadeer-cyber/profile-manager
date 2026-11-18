import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adb-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'adb-api';
process.env.PM_MOCK_ADB = '1';

const { startServer } = await import('../server/app.js');
let server;

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer adb-api', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
});

after(async () => {
  delete process.env.PM_MOCK_ADB;
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('adb API routes on v1', async () => {
  const devices = await call('GET', '/api/v1/adb/devices');
  assert.equal(devices.status, 200);
  assert.equal(devices.body.mockMode, true);
  const diag = await call('GET', '/api/v1/adb/diagnostics');
  assert.ok(diag.body.recoveryHints);
  const info = await call('GET', '/api/v1/adb/devices/mock-usb-001/info');
  assert.equal(info.body.ok, true);
  const sel = await call('PUT', '/api/v1/adb/selection', { serial: 'mock-usb-001' });
  assert.equal(sel.body.selectedSerial, 'mock-usb-001');
  const conn = await call('POST', '/api/v1/adb/connect', { target: '192.168.0.99:5555' });
  assert.equal(conn.body.ok, true);
  const disc = await call('POST', '/api/v1/adb/disconnect', { serial: '192.168.0.99:5555' });
  assert.equal(disc.body.ok, true);
});

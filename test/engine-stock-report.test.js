import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-engine-stock-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'engine-stock';

const { startServer } = await import('../server/app.js');
const { buildEngineStockReport } = await import('../server/engine-stock-report.js');
let server;

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('buildEngineStockReport is honest about stock engines (not Mimic/Stealthfox)', () => {
  const r = buildEngineStockReport();
  assert.equal(r.m2.mimicEquivalent, false);
  assert.equal(r.m3.stealthfoxEquivalent, false);
  assert.match(r.m2.productLabel, /Chromium/i);
  assert.match(r.m3.productLabel, /Firefox/i);
  assert.ok(Array.isArray(r.capabilityMatrix.rows));
});

test('GET /api/browser-engine/stock-report returns cacheable engine facts', async () => {
  const response = await fetch(`${server.url}/api/browser-engine/stock-report`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
  const body = await response.json();
  assert.equal(body.m2.mimicEquivalent, false);
  assert.equal(typeof body.m2.installed, 'boolean');
});

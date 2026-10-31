import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'gecko-api';

const { startServer } = await import('../server/app.js');
let server;

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('GET /api/gecko-extensions lists library and report', async () => {
  const response = await fetch(`${server.url}/api/gecko-extensions`, {
    headers: { Authorization: 'Bearer gecko-api' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.report);
  assert.equal(body.report.signingPolicy, 'Signature and compatibility verification are performed by Firefox on installation, never by this importer.');
});

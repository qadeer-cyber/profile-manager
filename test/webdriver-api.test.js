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

test('webdriver start succeeds when CDP port is recorded and chromedriver stub is configured', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-wd-api-stub-'));
  const script = path.join(tmp, 'fake-chromedriver.mjs');
  const stub = path.join(tmp, process.platform === 'win32' ? 'chromedriver-stub.cmd' : 'chromedriver-stub.sh');
  if (process.platform === 'win32') {
    fs.writeFileSync(stub, `@echo off\r\n"${process.execPath.replace(/"/g, '""')}" "${script.replace(/"/g, '""')}" %*\r\n`);
  } else {
    fs.writeFileSync(stub, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(stub, 0o755);
  }
  fs.writeFileSync(script, `
import http from 'node:http';
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = Number(portArg?.slice(7) || 0);
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: { ready: true } }));
    return;
  }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1');
`);
  process.env.PM_CHROMEDRIVER_PATH = stub;
  const created = await call('POST', '/api/v1/profiles', { name: 'With CDP row', automationEnabled: true });
  const { db } = await import('../server/db.js');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO running (id, pid, cdp_port, ws_endpoint, relay_url, started_at) VALUES (?,?,?,?,?,?)')
    .run(created.body.id, 99999, 59999, 'ws://127.0.0.1:59999/devtools', null, now);
  const started = await call('POST', `/api/v1/profiles/${created.body.id}/webdriver/start`, {});
  assert.equal(started.status, 200);
  assert.match(started.body.webdriverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const stopped = await call('POST', `/api/v1/profiles/${created.body.id}/webdriver/stop`, {});
  assert.equal(stopped.status, 200);
  db.prepare('DELETE FROM running WHERE id=?').run(created.body.id);
  delete process.env.PM_CHROMEDRIVER_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('automation bridges are engine-specific', async () => {
  const gecko = await call('GET', '/api/v1/geckodriver');
  assert.equal(gecko.status, 200);
  assert.equal(typeof gecko.body.requiresGeckodriverOnPath, 'boolean');
  const ff = await call('POST', '/api/v1/profiles', { name: 'FF bridge', browserEngine: 'firefox' });
  const cr = await call('POST', '/api/v1/profiles', { name: 'CR bridge', browserEngine: 'chromium' });
  assert.equal((await call('POST', `/api/v1/profiles/${ff.body.id}/webdriver/start`, {})).status, 409);
  assert.equal((await call('POST', `/api/v1/profiles/${cr.body.id}/geckodriver/start`, {})).status, 409);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startGeckodriverBridge, stopGeckodriverBridge, geckodriverBridgeReport } from '../server/geckodriver-bridge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gd-'));
const script = path.join(tmp, 'fake-geckodriver.mjs');
const stub = path.join(tmp, process.platform === 'win32' ? 'geckodriver-stub.cmd' : 'geckodriver-stub.sh');

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
const sessions = new Map();
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/status') {
      return json(200, { value: { ready: true, message: 'geckodriver stub ready' } });
    }
    if (req.method === 'POST' && req.url === '/session') {
      const id = 'stub-ff-session';
      sessions.set(id, { url: 'about:blank' });
      return json(200, { value: { sessionId: id, capabilities: { browserName: 'firefox' } } });
    }
    const nav = req.url?.match(/^\\/session\\/([^/]+)\\/url$/);
    if (req.method === 'POST' && nav) {
      let target = 'about:blank';
      try { target = JSON.parse(body || '{}').url || target; } catch {}
      sessions.set(nav[1], { url: target });
      return json(200, { value: null });
    }
    const getUrl = req.url?.match(/^\\/session\\/([^/]+)\\/url$/);
    if (req.method === 'GET' && getUrl) {
      return json(200, { value: sessions.get(getUrl[1])?.url || 'about:blank' });
    }
    res.writeHead(404); res.end();
  });
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
`);

test('geckodriverBridgeReport is honest', () => {
  assert.equal(geckodriverBridgeReport().bundled, false);
});

test('startGeckodriverBridge listens with stub', async () => {
  process.env.PM_GECKODRIVER_PATH = stub;
  const info = await startGeckodriverBridge('ff-profile', 2828);
  assert.match(info.webdriverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const port = Number(new URL(info.webdriverUrl).port);
  const status = await fetch(`${info.webdriverUrl}/status`);
  assert.equal(status.status, 200);
  const session = await fetch(`${info.webdriverUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'firefox' } } }),
  });
  assert.equal(session.status, 200);
  const sid = (await session.json()).value.sessionId;
  const nav = await fetch(`${info.webdriverUrl}/session/${sid}/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/' }),
  });
  assert.equal(nav.status, 200);
  const current = await fetch(`${info.webdriverUrl}/session/${sid}/url`);
  assert.equal((await current.json()).value, 'https://example.com/');
  stopGeckodriverBridge('ff-profile');
  delete process.env.PM_GECKODRIVER_PATH;
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

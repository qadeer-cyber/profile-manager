import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
  startWebDriverBridge, stopWebDriverBridge, webDriverBridgeReport, webDriverNewSessionBody, resolveChromedriverExecutable,
} from '../server/webdriver-bridge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-wd-'));
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
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: { ready: true, message: 'stub ready' } }));
    return;
  }
  if (req.method === 'POST' && req.url === '/session') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: { sessionId: 'stub-session', capabilities: {} } }));
    return;
  }
  const nav = req.url?.match(/^\\/session\\/([^/]+)\\/url$/);
  if (req.method === 'POST' && nav) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: null }));
    return;
  }
  if (req.method === 'GET' && nav) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: 'https://example.com/' }));
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
`);

test('webDriverBridgeReport is honest about chromedriver requirement', () => {
  const r = webDriverBridgeReport();
  assert.equal(r.bundled, false);
  assert.equal(r.fullParity, false);
  assert.equal(r.realPath.fullParity, false);
  assert.equal(r.realPath.env, 'PM_REAL_WEBDRIVER=1');
  assert.match(r.note, /automation/i);
});

test('startWebDriverBridge listens when chromedriver stub is configured', async () => {
  process.env.PM_CHROMEDRIVER_PATH = stub;
  const id = 'profile-test-wd';
  const info = await startWebDriverBridge(id, '127.0.0.1:59999');
  assert.match(info.webdriverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(info.debuggerAddress, '127.0.0.1:59999');
  assert.equal(info.newSession.capabilities.alwaysMatch['goog:chromeOptions'].debuggerAddress, '127.0.0.1:59999');
  const port = Number(new URL(info.webdriverUrl).port);
  await new Promise((res, rej) => {
    const c = net.connect(port, '127.0.0.1', () => { c.destroy(); res(); });
    c.on('error', rej);
  });
  const status = await fetch(`${info.webdriverUrl}/status`);
  assert.equal(status.status, 200);
  const session = await fetch(`${info.webdriverUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info.newSession),
  });
  assert.equal(session.status, 200);
  const body = await session.json();
  assert.equal(body.value.sessionId, 'stub-session');
  const sid = body.value.sessionId;
  const nav = await fetch(`${info.webdriverUrl}/session/${sid}/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/' }),
  });
  assert.equal(nav.status, 200);
  const current = await fetch(`${info.webdriverUrl}/session/${sid}/url`);
  assert.equal((await current.json()).value, 'https://example.com/');
  stopWebDriverBridge(id);
  delete process.env.PM_CHROMEDRIVER_PATH;
});

test('webDriverNewSessionBody rejects an unusable debugger address before spawn', () => {
  const body = webDriverNewSessionBody('127.0.0.1:9222');
  assert.equal(body.capabilities.alwaysMatch.browserName, 'chrome');
  assert.throws(() => webDriverNewSessionBody('not-a-port'), /debuggerAddress/);
});

test('resolveChromedriverExecutable prefers PM_CHROMEDRIVER_PATH', () => {
  process.env.PM_CHROMEDRIVER_PATH = stub;
  assert.equal(resolveChromedriverExecutable(), stub);
  delete process.env.PM_CHROMEDRIVER_PATH;
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
  startWebDriverBridge, stopWebDriverBridge, webDriverBridgeReport, resolveChromedriverExecutable,
} from '../server/webdriver-bridge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-wd-'));
const stub = path.join(tmp, process.platform === 'win32' ? 'chromedriver-stub.cmd' : 'chromedriver-stub.sh');

if (process.platform === 'win32') {
  fs.writeFileSync(stub, '@echo off\r\nnode "%~dp0fake-chromedriver.mjs" %*\r\n');
} else {
  fs.writeFileSync(stub, `#!/bin/sh\nexec node "${path.join(tmp, 'fake-chromedriver.mjs')}" "$@"\n`);
  fs.chmodSync(stub, 0o755);
}

fs.writeFileSync(path.join(tmp, 'fake-chromedriver.mjs'), `
import net from 'node:net';
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = Number(portArg?.slice(7) || 0);
const s = net.createServer(() => {}).listen(port, '127.0.0.1', () => {});
process.on('SIGTERM', () => { s.close(() => process.exit(0)); });
`);

test('webDriverBridgeReport is honest about chromedriver requirement', () => {
  const r = webDriverBridgeReport();
  assert.equal(r.bundled, false);
  assert.match(r.note, /automation/i);
});

test('startWebDriverBridge listens when chromedriver stub is configured', async () => {
  process.env.PM_CHROMEDRIVER_PATH = stub;
  const id = 'profile-test-wd';
  const info = await startWebDriverBridge(id, '127.0.0.1:59999');
  assert.match(info.webdriverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(info.debuggerAddress, '127.0.0.1:59999');
  const port = Number(new URL(info.webdriverUrl).port);
  await new Promise((res, rej) => {
    const c = net.connect(port, '127.0.0.1', () => { c.destroy(); res(); });
    c.on('error', rej);
  });
  stopWebDriverBridge(id);
  delete process.env.PM_CHROMEDRIVER_PATH;
});

test('resolveChromedriverExecutable prefers PM_CHROMEDRIVER_PATH', () => {
  process.env.PM_CHROMEDRIVER_PATH = stub;
  assert.equal(resolveChromedriverExecutable(), stub);
  delete process.env.PM_CHROMEDRIVER_PATH;
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

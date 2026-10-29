import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'node:net';
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
import net from 'node:net';
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = Number(portArg?.slice(7) || 0);
net.createServer(() => {}).listen(port, '127.0.0.1');
`);

test('geckodriverBridgeReport is honest', () => {
  assert.equal(geckodriverBridgeReport().bundled, false);
});

test('startGeckodriverBridge listens with stub', async () => {
  process.env.PM_GECKODRIVER_PATH = stub;
  const info = await startGeckodriverBridge('ff-profile', 2828);
  assert.match(info.webdriverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const port = Number(new URL(info.webdriverUrl).port);
  await new Promise((res, rej) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); res(); }); c.on('error', rej); });
  stopGeckodriverBridge('ff-profile');
  delete process.env.PM_GECKODRIVER_PATH;
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

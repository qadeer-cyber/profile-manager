import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { typeHumanTextOverWebDriver } from '../server/human-input.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hi-gd-'));
const script = path.join(tmp, 'stub-gecko.mjs');
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
const globalTyped = globalThis.__typedKeys || (globalThis.__typedKeys = []);
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/session') {
      return json(200, { value: { sessionId: 'hi-ff', capabilities: { browserName: 'firefox' } } });
    }
    if (req.method === 'POST' && req.url?.includes('/actions')) {
      try {
        const payload = JSON.parse(body || '{}');
        const actions = payload.actions?.[0]?.actions || [];
        for (const a of actions) if (a.type === 'keyDown') globalTyped.push(a.value);
      } catch {}
      return json(200, { value: null });
    }
    if (req.method === 'DELETE' && req.url?.includes('/session/')) return json(200, { value: null });
    res.writeHead(404); res.end();
  });
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
`);

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('typeHumanTextOverWebDriver sends key actions via geckodriver stub', async () => {
  process.env.PM_GECKODRIVER_PATH = stub;
  const { startGeckodriverBridge, stopGeckodriverBridge } = await import('../server/geckodriver-bridge.js');
  const bridge = await startGeckodriverBridge('hi-prof', 9999);
  const result = await typeHumanTextOverWebDriver(bridge.webdriverUrl, 'ab{Tab}c', { wpm: 600, deterministic: true });
  assert.equal(result.transport, 'geckodriver');
  assert.equal(result.typed, 4);
  assert.equal(result.deterministic, true);
  assert.equal(result.timingMeasured, false);
  assert.equal(result.measuredIntervalsMs, null);
  assert.equal(result.scheduleMs.length, 4);
  stopGeckodriverBridge('hi-prof');
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { freePort, trackProcess, hardKill } from './_ports.mjs';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { typeHumanTextOverCdp } from '../server/human-input.js';

const children = [];

after(() => {
  for (const proc of children) hardKill(proc?.pid);
});

test('typeHumanTextOverCdp fills an input on a local fixture page', { timeout: 120000 }, async () => {
  const fixture = await startLocalHttpFixture({
    body: '<!doctype html><html><body><input id="t" /></body></html>',
  });
  let exe;
  try { exe = chromium.executablePath(); } catch (e) {
    await fixture.close();
    assert.fail(e.message);
  }
  const port = await freePort('PM_TEST_HI');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hi-'));
  const proc = trackProcess(spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    fixture.origin,
  ], { stdio: 'ignore', detached: process.platform !== 'win32' }));
  children.push(proc);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  const result = await typeHumanTextOverCdp(port, 'hello', { wpm: 600, selector: '#t', jitterMs: 0, deterministic: true });
  assert.equal(result.typed, 5);
  assert.equal(result.deterministic, true);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const value = await page.inputValue('#t');
  await browser.close();
  assert.equal(value, 'hello');
  await fixture.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('typeHumanTextOverCdp types Unicode into input', { timeout: 120000 }, async () => {
  const fixture = await startLocalHttpFixture({
    body: '<!doctype html><html><body><input id="t" /></body></html>',
  });
  let exe;
  try { exe = chromium.executablePath(); } catch (e) {
    await fixture.close();
    assert.fail(e.message);
  }
  const port = await freePort('PM_TEST_HI2');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hi-u-'));
  const proc = trackProcess(spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    fixture.origin,
  ], { stdio: 'ignore', detached: process.platform !== 'win32' }));
  children.push(proc);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  await typeHumanTextOverCdp(port, 'café', { wpm: 600, selector: '#t', deterministic: true });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const value = await page.inputValue('#t');
  await browser.close();
  assert.equal(value, 'café');
  await fixture.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('humanInputReport documents Firefox geckodriver path', async () => {
  const { humanInputReport } = await import('../server/human-input.js');
  assert.equal(humanInputReport().firefox.supported, true);
  assert.equal(humanInputReport().firefox.transport, 'geckodriver');
});

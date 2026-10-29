import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { freePort, trackProcess, hardKill } from './_ports.mjs';
import { runCookieRobotTasksOverCdp } from '../server/cookie-robot-jobs.js';

const children = [];

after(() => {
  for (const proc of children) hardKill(proc?.pid);
});

test('runCookieRobotTasksOverCdp visits URLs over real Chromium CDP', { timeout: 120000 }, async () => {
  let exe;
  try {
    exe = chromium.executablePath();
  } catch (e) {
    assert.fail(`Chromium executable unavailable for CDP integration test: ${e.message}`);
  }
  const port = await freePort('PM_TEST_CDP_PORT');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cookie-robot-cdp-'));
  const proc = trackProcess(spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', detached: process.platform !== 'win32' }));
  children.push(proc);

  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { ready = true; break; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!ready) assert.fail('Timed out waiting for Chromium remote debugging port');

  const tasks = [{ url: 'https://example.com/', status: 'pending' }];
  const result = await runCookieRobotTasksOverCdp(port, tasks, { delayMs: 100 });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'ok', result[0].error || 'task failed');
});

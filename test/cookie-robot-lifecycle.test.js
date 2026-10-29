import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { freePort, trackProcess, hardKill } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cr-life-'));
process.env.PM_DATA_DIR = dir;

let fakeRunning = false;
let fakeCdpPort = null;
const children = [];

mock.module(new URL('../server/browsers.js', import.meta.url).href, {
  namedExports: {
    isRunning: () => fakeRunning,
    runInfo: () => (fakeRunning && fakeCdpPort ? { cdp_port: fakeCdpPort } : null),
    stop: async () => { fakeRunning = false; fakeCdpPort = null; },
    runningIds: () => (fakeRunning ? ['stub'] : []),
  },
});

const { db } = await import('../server/db.js');
const {
  configureCookieRobot, createCookieRobotJob, getCookieRobotJob,
} = await import('../server/cookie-robot-jobs.js');

after(() => {
  for (const proc of children) hardKill(proc?.pid);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('CookieRobot job runs queued URLs to done over live CDP', { timeout: 120000, skip: process.platform === 'win32' && !!process.env.CI }, async () => {
  let exe;
  try { exe = chromium.executablePath(); } catch (e) {
    assert.fail(`Chromium unavailable: ${e.message}`);
  }
  configureCookieRobot({
    launchProfile: async () => {
      const port = await freePort('PM_TEST_CR_LIFE');
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cr-life-ud-'));
      const proc = trackProcess(spawn(exe, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
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
      fakeRunning = true;
      fakeCdpPort = port;
    },
  });

  const pid = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, 'Chromium', '[]', '', '', 'chromium', now, now);

  const job = createCookieRobotJob({ profileId: pid, urls: ['https://example.com/'], delayMs: 500 });
  assert.equal(job.status, 'queued');

  const deadline = Date.now() + 90000;
  let final;
  while (Date.now() < deadline) {
    final = getCookieRobotJob(job.id);
    if (final.status === 'done' || final.status === 'failed' || final.status === 'cancelled') break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(final.status, 'done', final.error || JSON.stringify(final.tasks));
  assert.equal(final.tasks[0].status, 'ok');
});

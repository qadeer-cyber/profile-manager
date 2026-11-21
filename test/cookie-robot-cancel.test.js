import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cr-cancel-'));
process.env.PM_DATA_DIR = dir;
const { db } = await import('../server/db.js');
const { configureCookieRobot, createCookieRobotJob, cancelCookieRobotJob, getCookieRobotJob } = await import('../server/cookie-robot-jobs.js');

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

test('cancel before worker starts leaves job cancelled without launch', async () => {
  let launched = false;
  configureCookieRobot({ launchProfile: async () => { launched = true; } });
  const pid = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, 'Chromium', '[]', '', '', 'chromium', now, now);
  const job = createCookieRobotJob({ profileId: pid, urls: ['https://example.com/'] });
  cancelCookieRobotJob(job.id);
  await new Promise(r => setTimeout(r, 400));
  const state = getCookieRobotJob(job.id);
  assert.equal(state.status, 'cancelled');
  assert.equal(launched, false);
});

test('cancel during a pending navigation closes only the job tab and retains the task list', async t => {
  const { chromium } = await import('playwright');
  const { runCookieRobotTasksOverCdp } = await import('../server/cookie-robot-jobs.js');
  const { EventEmitter } = await import('node:events');
  const urls = [];
  let tabsClosed = 0, disconnected = 0;
  for (let i = 0; i < 2; i++) {
    const started = Promise.withResolvers(), pending = Promise.withResolvers();
    const page = Object.assign(new EventEmitter(), {
      goto: url => { urls.push(url); started.resolve(); return pending.promise; },
      close: async () => { tabsClosed++; pending.reject(new Error('tab closed')); },
    });
    const ctx = { newPage: async () => page };
    const connection = t.mock.method(chromium, 'connectOverCDP', async () => ({
      contexts: () => [ctx], close: async () => { disconnected++; },
    }));
    const controller = new AbortController();
    const tasks = ['https://example.com/one', 'https://example.com/two'].map(url => ({ url, status: 'pending' }));
    const run = runCookieRobotTasksOverCdp(1, tasks, { signal: controller.signal });
    await started.promise;
    controller.abort();
    assert.deepEqual(await run, tasks);
    connection.mock.restore();
  }
  assert.equal(tabsClosed, 2);
  assert.equal(disconnected, 2);
  assert.deepEqual(urls, Array(2).fill('https://example.com/one'));
});

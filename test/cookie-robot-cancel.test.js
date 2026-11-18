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

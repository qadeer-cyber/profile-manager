import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lim-'));
process.env.PM_DATA_DIR = dir;
const { db, setSetting } = await import('../server/db.js');
const { assertLaunchResources, resourceLimitsSummary, launchLimits } = await import('../server/launch-limits.js');

before(() => setSetting('maxRunningProfiles', 2));
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

test('launch limits expose host memory without fake Latitude numbers', () => {
  const limits = launchLimits({ runningCount: 0 });
  assert.ok(limits.hostTotalGiB >= 1);
  assert.ok(limits.maxRunningProfiles >= 1);
  assert.match(limits.note, /local guards/i);
});

test('assertLaunchResources throws when at max running profiles', () => {
  assert.throws(() => assertLaunchResources(2), err => err?.code === 'TOO_MANY_PROFILES');
});

test('resourceLimitsSummary includes queue pending', () => {
  const s = resourceLimitsSummary({ runningCount: 1, queuePending: 2 });
  assert.equal(s.queuePending, 2);
  assert.match(s.concurrencyNote, /maxConcurrentLaunches/);
});

test('one allowed profile reaches preflight even with queued requests and releases its slot on failure', async () => {
  const { randomUUID } = await import('node:crypto');
  const { userDataDir } = await import('../server/db.js');
  const { launch } = await import('../server/browsers.js');
  setSetting('maxRunningProfiles', 1);
  setSetting('maxConcurrentLaunches', 1);
  setSetting('minFreeMemoryGiB', 0);
  const profiles = Array.from({ length: 3 }, () => {
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, 'Preflight', '[]', '', '', now, now);
    fs.writeFileSync(userDataDir(id), 'disposable non-directory');
    return { id };
  });
  const outcomes = await Promise.allSettled(profiles.map(p => launch(p)));
  assert.deepEqual(outcomes.map(r => r.reason?.code), Array(3).fill('CORRUPT_DIR'));
});

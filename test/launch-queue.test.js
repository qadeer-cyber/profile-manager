import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m12-queue-'));
process.env.PM_DATA_DIR = dir;
const { db, setSetting } = await import('../server/db.js');
const { runWithLaunchQueue, launchQueueState, sweepLaunchReservations } = await import('../server/launch-queue.js');

before(() => {
  setSetting('maxConcurrentLaunches', 1);
  setSetting('launchReservationSeconds', 30);
});
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('launch queue limits parallel work and releases reservations', async () => {
  let active = 0;
  let maxActive = 0;
  const work = id => runWithLaunchQueue(id, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 40));
    active -= 1;
  });
  await Promise.all([work('a'), work('b')]);
  assert.equal(maxActive, 1);
  sweepLaunchReservations();
  assert.equal(launchQueueState().reservations, 0);
});

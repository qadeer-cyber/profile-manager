import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-trash-race-'));
process.env.PM_DATA_DIR = dataDir;
const { db } = await import('../server/db.js');
const { softDeleteProfile } = await import('../server/profile-lifecycle.js');

after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

test('softDeleteProfile awaits stop before marking deleted', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Stop first', '[]', '', '', now, now);
  let stopDone = false;
  await softDeleteProfile(id, {
    stopFn: async () => { await new Promise(r => setTimeout(r, 50)); stopDone = true; },
    isRunningFn: () => false,
  });
  assert.equal(stopDone, true);
  assert.ok(db.prepare('SELECT deleted_at FROM profiles WHERE id=?').get(id).deleted_at);
});

test('softDeleteProfile refuses trash when still running after stop', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Running', '[]', '', '', now, now);
  await assert.rejects(() => softDeleteProfile(id, {
    stopFn: async () => {},
    isRunningFn: () => true,
  }), err => err.code === 'PROFILE_STILL_RUNNING');
  assert.equal(db.prepare('SELECT deleted_at FROM profiles WHERE id=?').get(id).deleted_at, null);
});

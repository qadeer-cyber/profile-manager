import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-life-'));
process.env.PM_DATA_DIR = dataDir;
const { db } = await import('../server/db.js');
const { softDeleteProfile, restoreFromTrash, listTrash, purgeFromTrash } = await import('../server/profile-lifecycle.js');

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('soft delete and restore profile', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Trash me', '[]', '', '', now, now);
  await softDeleteProfile(id, { stopFn: async () => {} });
  assert.equal(listTrash(r => r).length, 1);
  restoreFromTrash(id);
  assert.equal(listTrash(r => r).length, 0);
});

test('purge requires confirmName', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Exact', '[]', '', '', now, now);
  await softDeleteProfile(id, { stopFn: async () => {} });
  await assert.rejects(async () => purgeFromTrash(id, { confirmName: 'wrong' }), /confirmName/);
  purgeFromTrash(id, { confirmName: 'Exact' });
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(id), undefined);
});

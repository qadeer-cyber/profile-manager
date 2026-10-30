import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-backup-sel-'));
process.env.PM_DATA_DIR = dataDir;
const { db, userDataDir } = await import('../server/db.js');
const { createBackup, restoreBackup, createProfileBackup } = await import('../server/backup.js');

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

function insertProfile(name) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, '[]', '', '', now, now);
  fs.mkdirSync(path.join(userDataDir(id), 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(id), 'Default', `${name}.txt`), name);
  return id;
}

test('restoreBackup restores only selected profileIds from full backup', () => {
  const a = insertProfile('Alpha');
  const b = insertProfile('Beta');
  const archive = createBackup({ ids: [] });
  db.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(a, b);
  fs.rmSync(userDataDir(a), { recursive: true, force: true });
  fs.rmSync(userDataDir(b), { recursive: true, force: true });
  const result = restoreBackup(archive, { profileIds: [b] });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].name, 'Beta');
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(a), undefined);
  assert.ok(db.prepare('SELECT id FROM profiles WHERE id=?').get(b));
});

test('portable .pmp backup restores profile row and files', () => {
  const id = insertProfile('Portable');
  const row = db.prepare('SELECT name FROM profiles WHERE id=?').get(id);
  const archive = createProfileBackup(id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  fs.rmSync(userDataDir(id), { recursive: true, force: true });
  const result = restoreBackup(archive);
  assert.equal(result.added.length, 1);
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, row.name);
  assert.ok(fs.existsSync(path.join(userDataDir(id), 'Default', 'Portable.txt')));
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-backup-sel-'));
process.env.PM_DATA_DIR = dataDir;
const { db, userDataDir } = await import('../server/db.js');
const { createBackup, restoreBackup, createLegacyProfileBackup } = await import('../server/backup.js');

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
  const archive = createLegacyProfileBackup(id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  fs.rmSync(userDataDir(id), { recursive: true, force: true });
  const result = restoreBackup(archive);
  assert.equal(result.added.length, 1);
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, row.name);
  assert.ok(fs.existsSync(path.join(userDataDir(id), 'Default', 'Portable.txt')));
});

test('portable restore rolls back row and replaced tree when failure follows file movement', () => {
  const id = insertProfile('Rollback');
  const marker = path.join(userDataDir(id), 'Default', 'Rollback.txt');
  const archive = createLegacyProfileBackup(id);
  db.prepare('UPDATE profiles SET name=? WHERE id=?').run('Current name', id);
  fs.writeFileSync(marker, 'current bytes');
  assert.throws(() => restoreBackup(archive, { collision: 'replace', failPoint: 'after-files' }), e => e.code === 'RESTORE_FAILED');
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, 'Current name');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'current bytes');
});

test('portable restore cannot commit a row when an orphan destination blocks its files', () => {
  const id = insertProfile('Orphan');
  const archive = createLegacyProfileBackup(id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  assert.throws(() => restoreBackup(archive), e => e.code === 'COLLISION');
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(id), undefined);
  assert.equal(fs.readFileSync(path.join(userDataDir(id), 'Default', 'Orphan.txt'), 'utf8'), 'Orphan');
});

test('portable restore rejects mismatched identity, unrelated files, and future schema', async () => {
  const { packArchive, unpackArchive } = await import('../server/archive.js');
  const id = insertProfile('Invalid manifest');
  const archive = createLegacyProfileBackup(id);
  for (const mutate of [
    meta => { meta.profileSnapshot.id = randomUUID(); },
    meta => { meta.schemaVersion = 9999; },
  ]) {
    const files = unpackArchive(archive), manifest = files.find(f => f.path === 'meta.json');
    const meta = JSON.parse(manifest.data.toString()); mutate(meta); manifest.data = Buffer.from(JSON.stringify(meta));
    assert.throws(() => restoreBackup(packArchive(files), { collision: 'replace' }), e => ['CORRUPT_BACKUP', 'UNSUPPORTED_BACKUP'].includes(e.code));
  }
  const files = unpackArchive(archive);
  files.push({ path: `profiles/${randomUUID()}/unrelated`, data: Buffer.from('bad') });
  assert.throws(() => restoreBackup(packArchive(files), { collision: 'replace' }), e => e.code === 'CORRUPT_BACKUP');
});

test('portable export refuses a symlink profile root', { skip: process.platform === 'win32' && 'symlink creation requires Windows privileges' }, () => {
  const id = insertProfile('Root link');
  const profile = userDataDir(id), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-outside-'));
  fs.rmSync(profile, { recursive: true, force: true });
  try {
    fs.writeFileSync(path.join(outside, 'private'), 'outside');
    fs.symlinkSync(outside, profile, 'dir');
    assert.throws(() => createLegacyProfileBackup(id), e => e.code === 'UNSAFE_PROFILE_LINK');
  } finally { fs.rmSync(profile, { force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

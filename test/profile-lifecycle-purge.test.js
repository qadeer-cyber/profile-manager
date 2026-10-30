import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-purge-safe-'));
process.env.PM_DATA_DIR = dataDir;
const { db, userDataDir } = await import('../server/db.js');
const {
  softDeleteProfile,
  purgeFromTrash,
  removeProfileDataFromDisk,
  resumeIncompletePurges,
  profileDataPaths,
} = await import('../server/profile-lifecycle.js');

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

function insertProfile(name) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, '[]', '', '', now, now);
  return id;
}

function seedProfileDirs(id) {
  for (const dir of Object.values(profileDataPaths(id))) {
    fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Default', 'marker.txt'), id);
  }
}

test('purge removes filesystem before deleting the database row', async () => {
  const id = insertProfile('FsFirst');
  seedProfileDirs(id);
  await softDeleteProfile(id, { stopFn: async () => {} });
  let rowDuringFs = null;
  const origRm = fs.rmSync.bind(fs);
  await purgeFromTrash(id, {
    confirmName: 'FsFirst',
    rmSyncImpl: (target, opts) => {
      rowDuringFs = db.prepare('SELECT id FROM profiles WHERE id=?').get(id);
      return origRm(target, opts);
    },
  });
  assert.equal(rowDuringFs?.id, id);
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(id), undefined);
  assert.equal(fs.existsSync(userDataDir(id)), false);
});

test('purge keeps trash row when filesystem removal fails', async () => {
  const id = insertProfile('Denied');
  seedProfileDirs(id);
  await softDeleteProfile(id, { stopFn: async () => {} });
  await assert.rejects(
    () => purgeFromTrash(id, {
      confirmName: 'Denied',
      rmSyncImpl: () => { throw new Error('EACCES: permission denied'); },
    }),
    err => err.code === 'PURGE_FS_FAILED',
  );
  const row = db.prepare('SELECT deleted_at, purge_error FROM profiles WHERE id=?').get(id);
  assert.ok(row?.deleted_at);
  assert.match(row.purge_error || '', /remaining data is retained/i);
  const { recoveryDiagnostics, recoverOperation } = await import('../server/recovery-journal.js');
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  assert.ok(op);
  assert.equal(fs.existsSync(userDataDir(id)), false);
  assert.equal(recoverOperation(op.id).verified, true);
  assert.ok(fs.existsSync(userDataDir(id)));
  assert.equal(fs.readFileSync(path.join(userDataDir(id), 'Default', 'marker.txt'), 'utf8'), id);
});

test('purge completes after interrupted filesystem cleanup', async () => {
  const id = insertProfile('Resume');
  seedProfileDirs(id);
  await softDeleteProfile(id, { stopFn: async () => {} });
  removeProfileDataFromDisk(id);
  assert.equal(fs.existsSync(userDataDir(id)), false);
  await purgeFromTrash(id, { confirmName: 'Resume' });
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(id), undefined);
});

test('startup reports interrupted purge without deleting files or clearing evidence', async () => {
  const id = insertProfile('Recover');
  seedProfileDirs(id);
  await softDeleteProfile(id, { stopFn: async () => {} });
  db.prepare('UPDATE profiles SET purge_error=? WHERE id=?').run('simulated partial purge', id);
  const results = resumeIncompletePurges({ rmSyncImpl: () => assert.fail('startup must not delete') });
  const mine = results.find(r => r.id === id);
  assert.equal(mine?.recovered, false);
  assert.equal(mine?.requiresConfirmation, true);
  assert.ok(fs.existsSync(userDataDir(id)));
  const row = db.prepare('SELECT purge_error FROM profiles WHERE id=?').get(id);
  assert.equal(row.purge_error, 'simulated partial purge');
});

test('partially failed purge is not silently restored or retried at startup', async () => {
  const { restoreFromTrash } = await import('../server/profile-lifecycle.js');
  const id = insertProfile('Partial'); seedProfileDirs(id);
  await softDeleteProfile(id);
  await assert.rejects(() => purgeFromTrash(id, {
    confirmName: 'Partial',
    rmSyncImpl: target => { fs.rmSync(path.join(target, 'Default', 'marker.txt'), { force: true }); throw new Error('interrupted'); },
  }), e => e.code === 'PURGE_FS_FAILED');
  assert.throws(() => restoreFromTrash(id), e => e.code === 'PURGE_RECOVERY_REQUIRED');
  assert.equal(resumeIncompletePurges().find(r => r.id === id).requiresConfirmation, true);
  assert.ok(db.prepare('SELECT deleted_at FROM profiles WHERE id=?').get(id).deleted_at);
});

test('database failure after filesystem purge retains durable interrupted-purge evidence', async () => {
  const id = insertProfile('DB failure'); seedProfileDirs(id); await softDeleteProfile(id);
  db.exec(`CREATE TEMP TRIGGER refuse_purge BEFORE DELETE ON profiles WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT, 'injected db failure'); END`);
  try {
    await assert.rejects(() => purgeFromTrash(id, { confirmName: 'DB failure' }), e => e.code === 'PURGE_FS_FAILED' && /injected db failure/.test(e.cause?.message));
    assert.match(db.prepare('SELECT purge_error FROM profiles WHERE id=?').get(id).purge_error, /Purge incomplete/);
  } finally { db.exec('DROP TRIGGER refuse_purge'); }
});

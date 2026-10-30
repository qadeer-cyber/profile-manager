import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-recovery-locks-'));
process.env.PM_DATA_DIR = dir;
const { db, userDataDir } = await import('../server/db.js');
const { runRecoverableRestore, recoverOperation, recoveryDiagnostics, assertProfileOperationAvailable } = await import('../server/recovery-journal.js');
const { softDeleteProfile, restoreFromTrash } = await import('../server/profile-lifecycle.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });
function profile(name = 'Before') {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, name, now, now);
  fs.mkdirSync(userDataDir(id), { recursive: true }); fs.writeFileSync(path.join(userDataDir(id), 'marker'), 'before'); return id;
}
function restore(id, fault = () => {}) {
  return runRecoverableRestore({ profileIds: [id], trees: [{ target: `profiles/${id}`, files: [{ path: 'marker', data: Buffer.from('after') }] }], applyDatabase: () => db.prepare('UPDATE profiles SET name=? WHERE id=?').run('After', id), fault });
}
test('profile and shared-path locks reject overlapping operations and release after verified rollback', () => {
  const id = profile(), other = profile();
  assert.throws(() => restore(id, point => {
    if (point !== 'prepared') return;
    assert.throws(() => assertProfileOperationAvailable(id), e => e.code === 'PROFILE_OPERATION_BUSY');
    assert.throws(() => runRecoverableRestore({ profileIds: [other], trees: [{ target: `profiles/${id}`, files: [] }], applyDatabase: () => {} }), e => e.code === 'PROFILE_OPERATION_BUSY');
    throw Error('injected rollback');
  }), /injected rollback/);
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, 'Before');
  assert.equal(fs.readFileSync(path.join(userDataDir(id), 'marker'), 'utf8'), 'before');
  assert.doesNotThrow(() => assertProfileOperationAvailable(id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pm_recovery_path_locks').get().n, 0);
});
test('committed dependency mismatch blocks cleanup and retains the original parked files', () => {
  const id = profile();
  assert.throws(() => restore(id, point => { if (point === 'after-db-commit') throw Error('interrupted'); }), /committed/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  db.prepare('UPDATE profiles SET name=? WHERE id=?').run('Unexpected mutation', id);
  assert.throws(() => recoverOperation(op.id, { cleanup: true }), /database dependencies/);
  assert.equal(fs.readFileSync(path.join(dir, 'recovery-operations', op.id, 'park', '0', 'marker'), 'utf8'), 'before');
  assert.throws(() => assertProfileOperationAvailable(id), e => e.code === 'PROFILE_OPERATION_BUSY');
});
test('live browser registration prevents new recovery operations', () => {
  const id = profile();
  db.prepare('INSERT INTO running (id,started_at) VALUES (?,?)').run(id, new Date().toISOString());
  assert.throws(() => restore(id), e => e.code === 'PROFILES_RUNNING');
  assert.equal(fs.readFileSync(path.join(userDataDir(id), 'marker'), 'utf8'), 'before');
  db.prepare('DELETE FROM running WHERE id=?').run(id);
});
test('trash restore and overlapping trash actions cannot race a pending restore', async () => {
  const id = profile();
  db.prepare('UPDATE profiles SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
  assert.throws(() => restore(id, point => { if (point === 'after-db-commit') throw Error('interrupted'); }), /committed/);
  assert.throws(() => restoreFromTrash(id), e => e.code === 'PROFILE_OPERATION_BUSY');
  await assert.rejects(() => softDeleteProfile(id), e => e.code === 'PROFILE_OPERATION_BUSY');
});

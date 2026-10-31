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

test('corrupt journal is visible without crashing startup; locks and retained bytes survive', async () => {
  const { recoverDataOperationsAtStartup } = await import('../server/recovery-journal.js');
  const id = profile();
  assert.throws(() => restore(id, p => { if (p === 'after-db-commit') throw Error('crash'); }), /committed/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  db.prepare('UPDATE pm_recovery_operations SET plan_json=? WHERE id=?').run('{broken private metadata', op.id);
  assert.doesNotThrow(() => recoverDataOperationsAtStartup());
  const diag = recoveryDiagnostics().find(o => o.id === op.id);
  assert.equal(diag.state, 'needs_review'); assert.equal(diag.recoverable, false);
  assert.equal(JSON.stringify(diag).includes('private metadata'), false);
  assert.throws(() => recoverOperation(op.id, { cleanup: true }), /corrupt/);
  assert.throws(() => assertProfileOperationAvailable(id), e => e.code === 'PROFILE_OPERATION_BUSY');
  assert.equal(fs.readFileSync(path.join(dir, 'recovery-operations', op.id, 'park', '0', 'marker'), 'utf8'), 'before');
});
test('missing staged data and forged journal paths fail closed before any cleanup', () => {
  const id = profile();
  assert.throws(() => restore(id, point => { if (point === 'after-db-commit') throw Error('crash'); }), /committed/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  const row = db.prepare('SELECT plan_json FROM pm_recovery_operations WHERE id=?').get(op.id);
  const plan = JSON.parse(row.plan_json); plan.moves[0].park = `recovery-operations/${op.id}/park/../outside`;
  db.prepare('UPDATE pm_recovery_operations SET plan_json=? WHERE id=?').run(JSON.stringify(plan), op.id);
  assert.throws(() => recoverOperation(op.id, { cleanup: true }), /invalid/);
  assert.equal(fs.readFileSync(path.join(dir, 'recovery-operations', op.id, 'park', '0', 'marker'), 'utf8'), 'before');
});
test('missing committed files refuse verification and preserve parked originals', () => {
  const id = profile();
  assert.throws(() => restore(id, p => { if (p === 'after-db-commit') throw Error('crash'); }), /committed/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  fs.rmSync(path.join(userDataDir(id), 'marker'));
  assert.throws(() => recoverOperation(op.id, { cleanup: true }), /files need review/);
  assert.ok(fs.existsSync(path.join(dir, 'recovery-operations', op.id, 'park', '0', 'marker')));
});
test('duplicate confirmed cleanup is idempotent and failed cleanup retains locks', () => {
  const id = profile();
  assert.throws(() => restore(id, p => { if (p === 'before-cleanup') throw Error('crash'); }), /committed/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  const original = fs.rmSync;
  try { fs.rmSync = () => { throw Object.assign(Error('locked fixture'), { code: 'EBUSY' }); }; assert.throws(() => recoverOperation(op.id, { cleanup: true }), /locked fixture/); }
  finally { fs.rmSync = original; }
  assert.throws(() => assertProfileOperationAvailable(id), e => e.code === 'PROFILE_OPERATION_BUSY');
  assert.equal(recoverOperation(op.id, { cleanup: true }).state, 'done');
  assert.equal(recoverOperation(op.id, { cleanup: true }).state, 'done');
  assert.doesNotThrow(() => assertProfileOperationAvailable(id));
});

test('missing staged file still permits a verified rollback when original live data is intact', async () => {
  const { recoverDataOperationsAtStartup } = await import('../server/recovery-journal.js');
  const id = profile();
  assert.throws(() => restore(id, p => { if (p === 'prepared') throw Error('interrupted'); }), /interrupted/);
  const op = recoveryDiagnostics().find(o => o.profileIds.includes(id));
  fs.rmSync(path.join(dir, 'recovery-operations', op.id, 'stage', '0', 'marker'));
  db.prepare('UPDATE pm_recovery_operations SET state=? WHERE id=?').run('prepared', op.id);
  recoverDataOperationsAtStartup();
  assert.equal(fs.readFileSync(path.join(userDataDir(id), 'marker'), 'utf8'), 'before');
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, 'Before');
  assert.equal(db.prepare('SELECT state FROM pm_recovery_operations WHERE id=?').get(op.id).state, 'rolled_back');
  assert.doesNotThrow(() => assertProfileOperationAvailable(id));
});

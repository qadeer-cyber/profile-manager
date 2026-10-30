import { hashFileSync } from './file-integrity.js';
// Local filesystem/SQLite coordination. Journal stores paths and fingerprints, not file contents or credential values.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readLock, isStale } from './lock.js';
import { isAlive } from './proc.js';
import { db, DATA_DIR } from './db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, code = 'RECOVERY_REQUIRED') => Object.assign(new Error(message), { status: 409, code });
db.exec(`CREATE TABLE IF NOT EXISTS pm_recovery_operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, plan_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
 CREATE TABLE IF NOT EXISTS pm_recovery_profile_locks (profile_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pm_recovery_path_locks (target TEXT PRIMARY KEY, operation_id TEXT NOT NULL)`);
// SQLite's commit marker must be durable before old filesystem data can be discarded.
db.pragma('synchronous = FULL');
const root = path.join(DATA_DIR, 'recovery-operations');
function syncDir(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch (e) { if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EISDIR', 'EINVAL'].includes(e.code)) throw e; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function safePath(rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(s => !s || s === '.' || s === '..' || /[:\x00-\x1f]/.test(s))) throw fail('Unsafe recovery path');
  const target = path.join(DATA_DIR, ...rel.split('/'));
  let current = DATA_DIR;
  if (fs.lstatSync(current).isSymbolicLink()) throw fail('Recovery data root must not be a symlink');
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw fail('Recovery refuses symlink paths');
  }
  return target;
}
function move(from, to) {
  const src = safePath(from), dest = safePath(to);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.renameSync(src, dest); syncDir(path.dirname(src)); syncDir(path.dirname(dest));
}
export function treeFingerprint(dir) {
  if (!fs.existsSync(dir)) return null;
  const result = {}; let count = 0, bytes = 0;
  const visit = (file, rel, depth) => {
    if (depth > 64 || ++count > 200000) throw fail('Recovery tree exceeds safety limits');
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw fail('Recovery refuses symlinks');
    if (st.isDirectory()) {
      result[rel + '/'] = 'directory';
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), rel ? rel + '/' + name : name, depth + 1);
    } else if (st.isFile()) {
      bytes += st.size;
      if (st.size > 4 * 1024 ** 3 || bytes > 8 * 1024 ** 3) throw fail('Recovery tree exceeds byte limits');
      result[rel] = hashFileSync(file);
    } else throw fail('Recovery refuses special files');
  };
  visit(dir, '', 0);
  return result;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function setState(id, state, error = null) {
  db.prepare('UPDATE pm_recovery_operations SET state=?, error=?, updated_at=? WHERE id=?').run(state, error, new Date().toISOString(), id);
}
export function assertProfileOperationAvailable(id) {
  if (db.prepare('SELECT operation_id FROM pm_recovery_profile_locks WHERE profile_id=?').get(id)) throw fail('Profile has a pending data operation. Open recovery diagnostics before retrying.', 'PROFILE_OPERATION_BUSY');
}
function unlock(id) {
  db.prepare('DELETE FROM pm_recovery_profile_locks WHERE operation_id=?').run(id);
  db.prepare('DELETE FROM pm_recovery_path_locks WHERE operation_id=?').run(id);
}
function databaseFingerprint(profileIds) {
  const rows = profileIds.map(id => {
    const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(id) || null;
    const links = db.prepare('SELECT * FROM profile_extensions WHERE profile_id=? ORDER BY extension_id').all(id);
    return { profile,
      workspace: profile?.workspace_id ? db.prepare('SELECT * FROM workspaces WHERE id=?').get(profile.workspace_id) || null : null,
      proxy: profile?.proxy_id ? db.prepare('SELECT * FROM proxies WHERE id=?').get(profile.proxy_id) || null : null,
      extensions: links.map(link => ({ link, row: db.prepare('SELECT * FROM extensions WHERE id=?').get(link.extension_id) || null })),
    };
  });
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function record(kind, profileIds, targets) {
  const id = crypto.randomUUID();
  const plan = { version: 1, profileIds, databaseBefore: null, databaseAfter: null, moves: targets.map((target, i) => {
    if (!/^(profiles|extensions|gecko-extensions)\/[0-9a-f-]{36}$/i.test(target)) throw fail('Invalid recovery destination');
    return { target, stage: `recovery-operations/${id}/stage/${i}`, park: `recovery-operations/${id}/park/${i}`, before: null, after: null };
  }) };
  db.transaction(() => {
    for (const pid of profileIds) { if (!UUID.test(pid)) throw fail('Invalid recovery profile'); assertProfileOperationAvailable(pid);
      const lock = readLock(path.join(DATA_DIR, 'profiles', pid));
      if (lock && (!isStale(lock) || isAlive(lock.browserPid))) throw fail('A browser process owns this profile', 'PROFILES_RUNNING');
      if (db.prepare('SELECT id FROM running WHERE id=?').get(pid)) throw fail('Stop the active profile before data operations', 'PROFILES_RUNNING');
    }
    for (const m of plan.moves) {
      if (db.prepare('SELECT operation_id FROM pm_recovery_path_locks WHERE target=?').get(m.target.toLowerCase())) throw fail('Another recovery operation owns these files', 'PROFILE_OPERATION_BUSY');
      db.prepare('INSERT INTO pm_recovery_path_locks VALUES (?,?)').run(m.target.toLowerCase(), id);
      m.before = treeFingerprint(safePath(m.target));
    }
    plan.databaseBefore = databaseFingerprint(profileIds);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO pm_recovery_operations VALUES (?,?,?,?,?,?,NULL)').run(id, kind, 'staging', JSON.stringify(plan), now, now);
    for (const pid of profileIds) db.prepare('INSERT INTO pm_recovery_profile_locks VALUES (?,?)').run(pid, id);
  })();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 }); syncDir(DATA_DIR);
  return { id, plan };
}
function savePlan(id, plan, state) {
  db.prepare('UPDATE pm_recovery_operations SET plan_json=?,state=?,updated_at=? WHERE id=?').run(JSON.stringify(plan), state, new Date().toISOString(), id);
}
function validFingerprint(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value['/'] !== 'directory') return false;
  const entries = Object.entries(value);
  return entries.length <= 200000 && entries.every(([name, digest]) => name.length <= 4096 && (digest === 'directory' || /^[0-9a-f]{64}$/.test(digest)));
}
function readOperation(id) {
  if (!UUID.test(id)) throw fail('Invalid recovery operation');
  const row = db.prepare('SELECT * FROM pm_recovery_operations WHERE id=?').get(id);
  if (!row) throw fail('Recovery operation not found');
  if (row.plan_json.length > 64 * 1024 * 1024) throw fail('Recovery journal exceeds limits');
  let plan;
  try { plan = JSON.parse(row.plan_json); } catch { throw fail('Recovery journal is corrupt. All copies are retained for manual review.'); }
  if (!plan || plan.version !== 1 || !['restore', 'purge'].includes(row.kind) ||
      !['staging', 'prepared', 'committed', 'rolled_back', 'partial_recovered', 'purge_staged', 'done'].includes(row.state) ||
      !Array.isArray(plan.profileIds) || !plan.profileIds.length || plan.profileIds.length > 10000 || plan.profileIds.some(id => !UUID.test(id)) ||
      new Set(plan.profileIds).size !== plan.profileIds.length || !Array.isArray(plan.moves) || plan.moves.length > 20000 ||
      !/^[0-9a-f]{64}$/.test(plan.databaseBefore || '') || (row.kind === 'restore' && row.state === 'committed' && !/^[0-9a-f]{64}$/.test(plan.databaseAfter || ''))) throw fail('Recovery journal structure is invalid');
  const targets = new Set();
  if (row.kind === 'purge' && (plan.moves.length !== 1 || plan.profileIds.length !== 1)) throw fail('Purge journal structure is invalid');
  for (const [index, m] of plan.moves.entries()) {
    if (!m || !/^(profiles|extensions|gecko-extensions)\/[0-9a-f-]{36}$/i.test(m.target) || m.stage !== `recovery-operations/${id}/stage/${index}` || m.park !== `recovery-operations/${id}/park/${index}`) throw fail('Recovery plan is invalid');
    if (targets.has(m.target.toLowerCase())) throw fail('Recovery journal repeats a destination');
    targets.add(m.target.toLowerCase());
    if (!validFingerprint(m.before) || !validFingerprint(m.after)) throw fail('Recovery fingerprints are invalid');
    if (row.kind === 'restore' && ['prepared', 'committed'].includes(row.state) && m.after === null) throw fail('Prepared restore fingerprint is missing');
    if (m.target.startsWith('profiles/') && !plan.profileIds.includes(m.target.slice(9))) throw fail('Recovery journal profile mapping is invalid');
    if (row.kind === 'purge' && m.target !== `profiles/${plan.profileIds[0]}`) throw fail('Purge target is invalid');
    safePath(m.target); safePath(m.stage); safePath(m.park);
  }
  return { ...row, plan };
}
function rollback(op) {
  for (const m of [...op.plan.moves].reverse()) {
    const live = safePath(m.target), parked = safePath(m.park), staged = safePath(m.stage);
    if (fs.existsSync(parked)) {
      if (fs.existsSync(live)) {
        if (fs.existsSync(staged) || !same(treeFingerprint(live), m.after)) throw fail('Restore rollback found unexpected live data; all copies were retained');
        move(m.target, m.stage);
      }
      move(m.park, m.target);
    } else if (m.before === null && !fs.existsSync(staged) && fs.existsSync(live)) {
      if (!same(treeFingerprint(live), m.after)) throw fail('Restore rollback found modified data; all copies were retained');
      move(m.target, m.stage);
    }
    if (!same(treeFingerprint(live), m.before)) throw fail('Restore rollback could not verify original files');
  }
  if (databaseFingerprint(op.plan.profileIds) !== op.plan.databaseBefore) throw fail('Rollback database state disagrees; manual recovery required');
  db.transaction(() => { setState(op.id, 'rolled_back'); unlock(op.id); })();
  return { id: op.id, state: 'rolled_back', verified: true };
}
function verifyCommitted(op) {
  if (databaseFingerprint(op.plan.profileIds) !== op.plan.databaseAfter) throw fail('Committed restore database dependencies need review');
  for (const m of op.plan.moves) if (!same(treeFingerprint(safePath(m.target)), m.after)) throw fail('Committed restore files need review; retained copies were preserved');
  for (const pid of op.plan.profileIds) if (!db.prepare('SELECT id FROM profiles WHERE id=?').get(pid)) throw fail('Committed restore database row is missing');
}
function cleanup(op) {
  if (op.state === 'staging' || op.state === 'prepared' || op.state === 'purge_staged') throw fail('Incomplete operation cannot be cleaned');
  if (['rolled_back', 'partial_recovered'].includes(op.state) && op.plan.moves.some(m => fs.existsSync(safePath(m.park)))) throw fail('Rollback still has parked original data; cleanup refused');
  fs.rmSync(safePath(`recovery-operations/${op.id}`), { recursive: true, force: true }); syncDir(root);
  db.transaction(() => { setState(op.id, 'done'); unlock(op.id); })();
}

/** Explicit manual recovery. Startup never removes recovery copies. */
export function recoverOperation(id, { cleanup: removeCopies = false } = {}) {
  const op = readOperation(id);
  if (op.kind === 'purge') return recoverPurge(op, removeCopies);
  if (['staging', 'prepared'].includes(op.state)) return rollback(op);
  if (op.state === 'committed') { verifyCommitted(op); if (removeCopies) cleanup(op); return { id, state: removeCopies ? 'done' : 'committed', verified: true }; }
  if (op.state === 'rolled_back' && removeCopies) { cleanup(op); return { id, state: 'done', verified: true }; }
  return { id, state: op.state, verified: ['done', 'rolled_back'].includes(op.state) };
}
export function recoveryDiagnostics() {
  return db.prepare("SELECT id,kind,state,created_at,updated_at,error FROM pm_recovery_operations WHERE state!='done' ORDER BY created_at").all().map(row => {
    try { const op = readOperation(row.id); return { ...row, profileIds: op.plan.profileIds, recoverable: true }; }
    catch {
      const profileIds = db.prepare('SELECT profile_id FROM pm_recovery_profile_locks WHERE operation_id=?').all(row.id).map(r => r.profile_id).filter(id => UUID.test(id));
      return { ...row, kind: ['purge', 'restore'].includes(row.kind) ? row.kind : 'unknown', persistedState: row.state, state: 'needs_review', profileIds, recoverable: false,
        error: 'Recovery journal is corrupt or unsafe. Profiles remain locked and all retained copies require manual review.' };
    }
  });
}
export function recoverDataOperationsAtStartup() {
  const results = [];
  for (const row of recoveryDiagnostics()) {
    try {
      if (row.recoverable === false) { results.push({ id: row.id, requiresReview: true }); continue; }
      if (row.kind === 'restore' && ['staging', 'prepared'].includes(row.state)) results.push(recoverOperation(row.id));
      else results.push({ id: row.id, state: row.state, requiresConfirmation: true });
    } catch { setState(row.id, row.state, 'Recovery could not verify filesystem/database agreement. Retained copies require manual review.'); results.push({ id: row.id, requiresReview: true }); }
  }
  return results;
}

export function runRecoverableRestore({ profileIds, trees, applyDatabase, fault = () => {} }) {
  const { id, plan } = record('restore', profileIds, trees.map(t => t.target));
  try {
    fault('journal-created');
    for (let i = 0; i < trees.length; i++) {
      const m = plan.moves[i], stage = safePath(m.stage);
      fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
      for (const f of trees[i].files) {
        const rel = f.path;
        if (!rel || path.isAbsolute(rel) || rel.split('/').some(p => !p || p === '..' || p === '.' || /[\\:\x00-\x1f]/.test(p))) throw fail('Unsafe staged file');
        const dest = path.join(stage, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
        if (f.source) {
          if (fs.lstatSync(f.source).isSymbolicLink()) throw fail('Staging source must not be a symlink');
          fs.copyFileSync(f.source, dest, fs.constants.COPYFILE_EXCL); fs.chmodSync(dest, 0o600);
        } else fs.writeFileSync(dest, f.data, { flag: 'wx', mode: 0o600 });
        const fd = fs.openSync(dest, 'r+');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        if (f.sha256 && hashFileSync(dest) !== f.sha256) throw fail('Staged file checksum disagrees with archive');
        syncDir(path.dirname(dest)); fault(`staged-file:${i}:${f.path}`);
      }
      m.after = treeFingerprint(stage);
      let dir = stage;
      while (dir !== DATA_DIR) { syncDir(dir); dir = path.dirname(dir); }
      syncDir(DATA_DIR);
    }
    savePlan(id, plan, 'prepared'); fault('prepared');
    db.transaction(() => {
      for (let i = 0; i < plan.moves.length; i++) {
        const m = plan.moves[i];
        if (!same(treeFingerprint(safePath(m.target)), m.before)) throw fail('Destination changed during staging; files were preserved');
        if (m.before !== null) move(m.target, m.park);
        fault(`park:${i}`); move(m.stage, m.target); fault(`install:${i}`);
      }
      applyDatabase();
      plan.databaseAfter = databaseFingerprint(profileIds);
      fault('before-db-commit'); savePlan(id, plan, 'committed');
    })();
    fault('after-db-commit');
    verifyCommitted(readOperation(id)); fault('before-cleanup'); cleanup(readOperation(id)); fault('after-cleanup');
    return id;
  } catch (error) {
    const op = readOperation(id);
    if (['staging', 'prepared'].includes(op.state)) {
      try { rollback(op); } catch { setState(id, op.state, 'Rollback could not verify retained files; manual recovery required'); throw fail(`Restore interrupted. Recovery operation ${id} requires review.`); }
      throw error;
    }
    throw fail(`Restore committed but recovery operation ${id} requires verification or cleanup.`);
  }
}

export function runRecoverablePurge(profileId, { remove = fs.rmSync, fault = () => {} } = {}) {
  let existing = db.prepare("SELECT o.* FROM pm_recovery_operations o JOIN pm_recovery_profile_locks l ON l.operation_id=o.id WHERE l.profile_id=? AND o.kind='purge'").get(profileId);
  let op;
  if (existing) op = readOperation(existing.id);
  else {
    const created = record('purge', [profileId], [`profiles/${profileId}`]); op = readOperation(created.id);
    savePlan(op.id, op.plan, 'prepared'); op.state = 'prepared';
  }
  const m = op.plan.moves[0];
  if (op.state === 'committed') { cleanup(op); return { id: profileId, purged: true }; }
  if (op.state === 'prepared') {
    if (fs.existsSync(safePath(m.target))) move(m.target, m.park);
    fault('purge-parked');
    db.transaction(() => {
      db.prepare('UPDATE profiles SET purge_error=? WHERE id=?').run('Purge staged; retained data requires explicit recovery or retry', profileId);
      setState(op.id, 'purge_staged');
    })();
  }
  fault('purge-before-delete');
  try {
    remove(safePath(m.park), { recursive: true, force: true });
    if (fs.existsSync(safePath(m.park))) throw fail('Profile data remains locked', 'PURGE_FS_FAILED');
    fault('purge-after-delete');
    db.transaction(() => { db.prepare('DELETE FROM profiles WHERE id=?').run(profileId); setState(op.id, 'committed'); })();
    fault('purge-committed'); cleanup(readOperation(op.id));
    return { id: profileId, purged: true };
  } catch (e) {
    db.prepare('UPDATE profiles SET purge_error=? WHERE id=?').run('Purge incomplete; remaining data is retained in recovery storage. Recover or explicitly retry.', profileId);
    throw Object.assign(new Error(`Purge incomplete; recovery operation ${op.id} retains available data.`), { status: 500, code: 'PURGE_FS_FAILED', cause: e });
  }
}
function recoverPurge(op, removeCopies) {
  const pid = op.plan.profileIds[0], m = op.plan.moves[0];
  if (op.state === 'committed') {
    if (db.prepare('SELECT id FROM profiles WHERE id=?').get(pid)) throw fail('Purge database state is inconsistent');
    if (op.plan.moves.some(m => fs.existsSync(safePath(m.park)))) throw fail('Purge retained files disagree with committed state; cleanup refused');
    if (removeCopies) cleanup(op);
    return { id: op.id, state: removeCopies ? 'done' : 'committed', verified: true };
  }
  if (op.state === 'partial_recovered') {
    if (removeCopies) cleanup(op);
    return { id: op.id, state: removeCopies ? 'done' : 'partial_recovered', verified: false, remainingDataRecovered: true };
  }
  if (op.state === 'rolled_back' && removeCopies) { cleanup(op); return { id: op.id, state: 'done', verified: true }; }
  if (['done', 'rolled_back'].includes(op.state)) return { id: op.id, state: op.state, verified: op.plan.recoveredComplete !== false };
  if (fs.existsSync(safePath(m.park))) {
    if (fs.existsSync(safePath(m.target))) throw fail('Both live and retained purge data exist; manual review required');
    move(m.park, m.target);
  }
  const complete = same(treeFingerprint(safePath(m.target)), m.before);
  db.transaction(() => {
    if (!db.prepare('SELECT id FROM profiles WHERE id=? AND deleted_at IS NOT NULL').get(pid)) throw fail('Purge row is missing or active');
    db.prepare('UPDATE profiles SET purge_error=? WHERE id=?').run(complete ? null : 'Remaining files recovered; profile is incomplete. Restore a backup before use.', pid);
    op.plan.recoveredComplete = complete;
    savePlan(op.id, op.plan, complete ? 'rolled_back' : 'partial_recovered'); unlock(op.id);
  })();
  return { id: op.id, state: complete ? 'rolled_back' : 'partial_recovered', verified: complete, remainingDataRecovered: true };
}

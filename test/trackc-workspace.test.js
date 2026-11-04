import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, userDataDir } from '../server/db.js';
import { encrypt, decrypt } from '../server/secrets.js';
import { createWorkspace, assignProfileWorkspace, bulkAssignProfilesToWorkspace, deleteWorkspace, updateWorkspace } from '../server/workspaces.js';
import { createPortableWorkspaceDescriptors, restorePortableWorkspace, validatePortableWorkspace } from '../server/portable-backup.js';
import { recoveryDiagnostics } from '../server/recovery-journal.js';
const options = { passphrase: 'disposable-secret-passphrase', confirmSensitive: true, encrypted: true, collision: 'rename', running: [] };
function profile(workspaceId, engine = 'chromium') {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, engine, '[]', '', '', engine, workspaceId, now, now);
  const dir = path.join(userDataDir(id), engine === 'firefox' ? 'gecko' : 'Default'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'persistent-fixture'), engine + '-private-data');
  return id;
}
test('workspace snapshot remaps collisions atomically, preserving engines, membership and shared encrypted proxy', () => {
  const w = createWorkspace({ name: 'Two browsers' }), a = profile(w.id), b = profile(w.id, 'firefox'), proxy = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(proxy, 'private proxy', 'socks5', '127.0.0.1', 9999, 'owner', encrypt('secret'), '[]', now, now);
  db.prepare('UPDATE profiles SET proxy_id=? WHERE workspace_id=?').run(proxy, w.id);
  const { meta, files } = createPortableWorkspaceDescriptors(w.id, options);
  const result = restorePortableWorkspace(files, meta, options);
  assert.notEqual(result.workspaceId, w.id); assert.equal(result.renamed.length, 2);
  const rows = db.prepare('SELECT * FROM profiles WHERE workspace_id=?').all(result.workspaceId);
  assert.equal(new Set(rows.map(p => p.proxy_id)).size, 1); assert.notEqual(rows[0].proxy_id, proxy);
  assert.equal(decrypt(db.prepare('SELECT password FROM proxies WHERE id=?').get(rows[0].proxy_id).password), 'secret');
  for (const row of rows) assert.equal(fs.readFileSync(path.join(userDataDir(row.id), row.browser_engine === 'firefox' ? 'gecko' : 'Default', 'persistent-fixture'), 'utf8'), row.browser_engine + '-private-data');
  assert.equal(db.prepare('SELECT workspace_id FROM profiles WHERE id=?').get(a).workspace_id, w.id);
  assert.equal(db.prepare('SELECT workspace_id FROM profiles WHERE id=?').get(b).workspace_id, w.id);
});
test('workspace corrupted checksum and inconsistent membership fail before database/filesystem changes', () => {
  const w = createWorkspace({ name: 'Corruption' }); profile(w.id);
  const { meta, files } = createPortableWorkspaceDescriptors(w.id, options), before = db.prepare('SELECT count(*) n FROM profiles').get().n;
  const bad = structuredClone(meta); bad.members[0].profileSnapshot.workspace_id = crypto.randomUUID();
  assert.throws(() => restorePortableWorkspace(files, bad, options));
  const modified = structuredClone(meta); modified.members[0].fileChecksums[files[0].path] = '0'.repeat(64);
  assert.throws(() => restorePortableWorkspace(files, modified, options), /checksum/);
  assert.equal(db.prepare('SELECT count(*) n FROM profiles').get().n, before);
  assert.throws(() => validatePortableWorkspace(files, meta, { encrypted: false }));
});
test('workspace failure after moving multiple profile trees rolls back all members and dependencies', () => {
  const w = createWorkspace({ name: 'Rollback' }); profile(w.id); profile(w.id, 'firefox');
  const { meta, files } = createPortableWorkspaceDescriptors(w.id, options);
  const before = db.prepare('SELECT count(*) n FROM profiles').get().n, workspaces = db.prepare('SELECT count(*) n FROM workspaces').get().n;
  assert.throws(() => restorePortableWorkspace(files, meta, { ...options, fault: boundary => { if (boundary === 'before-db-commit') throw Error('injected SQLite failure'); } }), /injected/);
  assert.equal(db.prepare('SELECT count(*) n FROM profiles').get().n, before); assert.equal(db.prepare('SELECT count(*) n FROM workspaces').get().n, workspaces);
  assert.equal(recoveryDiagnostics().filter(op => op.state !== 'done' && op.state !== 'rolled_back').length, 0);
});
test('empty workspace transfers and membership mutations fail atomically under recovery locks', () => {
  const a = createWorkspace({ name: 'Empty' }), b = createWorkspace({ name: 'Other' });
  const pack = createPortableWorkspaceDescriptors(a.id, options); const copy = restorePortableWorkspace(pack.files, pack.meta, options); assert.ok(copy.workspaceId);
  const one = profile(a.id), two = profile(a.id), op = crypto.randomUUID();
  db.prepare('INSERT INTO pm_recovery_profile_locks VALUES (?,?)').run(two, op);
  try {
    assert.throws(() => bulkAssignProfilesToWorkspace(b.id, [one, two]), /pending data operation/);
    assert.equal(db.prepare('SELECT workspace_id FROM profiles WHERE id=?').get(one).workspace_id, a.id);
    assert.throws(() => deleteWorkspace(a.id), /pending data operation/);
    assert.ok(db.prepare('SELECT id FROM workspaces WHERE id=?').get(a.id));
  } finally { db.prepare('DELETE FROM pm_recovery_profile_locks WHERE profile_id=?').run(two); }
  assert.throws(() => assignProfileWorkspace(crypto.randomUUID(), a.id), /not found/);
  assert.throws(() => updateWorkspace(a.id, { name: 'stale', expectedUpdatedAt: 'obsolete' }), /changed/);
});

import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { db } from '../server/db.js';
import { createWorkspace } from '../server/workspaces.js';
import { createPortableWorkspaceDescriptors, restorePortableWorkspace } from '../server/portable-backup.js';
import { saveTrafficPolicy, getTrafficPolicy } from '../server/proxy-traffic.js';
import { encrypt, decrypt } from '../server/secrets.js';
import { migrate, migrations, currentVersion } from '../server/migrations.js';
import { acquireFirefoxSession, assertFirefoxAddonIdle, firefoxSessionOwner } from '../server/firefox-session-lock.js';
import { startGeckodriverBridge } from '../server/geckodriver-bridge.js';
const options = { passphrase: 'unified-disposable-passphrase', confirmSensitive: true, encrypted: true, collision: 'rename', running: [] };
function snapshot() {
  const w = createWorkspace({ name: 'Unified' }), proxy = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(proxy, 'private', 'socks5', '127.0.0.1', 9999, 'owner', encrypt('secret'), '[]', now, now);
  saveTrafficPolicy(proxy, { enabled: true, blockExtensions: ['.png', '.jpg'] });
  for (const engine of ['chromium', 'firefox']) db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,workspace_id,proxy_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), engine, '[]', '', '', engine, w.id, proxy, now, now);
  return { ...createPortableWorkspaceDescriptors(w.id, options), proxy };
}
test('both engines restore shared proxy policy under a remapped ID without changing original secrets or policy', () => {
  const { files, meta, proxy } = snapshot();
  saveTrafficPolicy(proxy, { enabled: false, blockExtensions: [] });
  const result = restorePortableWorkspace(files, meta, options);
  const rows = db.prepare('SELECT * FROM profiles WHERE workspace_id=?').all(result.workspaceId);
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map(r => r.proxy_id)).size, 1);
  assert.notEqual(rows[0].proxy_id, proxy);
  assert.deepEqual(getTrafficPolicy(rows[0].proxy_id).blockExtensions, ['.png', '.jpg']);
  assert.equal(getTrafficPolicy(rows[0].proxy_id).enabled, true); assert.equal(getTrafficPolicy(proxy).enabled, false);
  assert.equal(decrypt(db.prepare('SELECT password FROM proxies WHERE id=?').get(rows[0].proxy_id).password), 'secret');
});
test('malformed/shared conflicting policy fails before restore; SQLite failure rolls back policy with profile', () => {
  const { files, meta } = snapshot(), before = db.prepare('SELECT count(*) n FROM proxy_traffic_policies').get().n;
  const bad = structuredClone(meta); bad.members[0].dependencies.proxy.trafficPolicy.blockExtensions = ['../../secret'];
  assert.throws(() => restorePortableWorkspace(files, bad, options));
  assert.throws(() => restorePortableWorkspace(files, meta, { ...options, fault: boundary => { if (boundary === 'before-db-commit') throw Error('SQLite fault'); } }), /SQLite fault/);
  assert.equal(db.prepare('SELECT count(*) n FROM proxy_traffic_policies').get().n, before);
});
test('older v2 manifests without traffic policy remain compatible', () => {
  const { files, meta } = snapshot();
  for (const m of meta.members) { delete m.dependencies.proxy.trafficPolicy; m.schemaVersion = 18; }
  const result = restorePortableWorkspace(files, meta, options);
  const row = db.prepare('SELECT proxy_id FROM profiles WHERE workspace_id=?').get(result.workspaceId);
  assert.equal(getTrafficPolicy(row.proxy_id).stored, false);
});
test('v18 upgrade preserves profile and recovery records; v19 applies once', () => {
  const d = new Database(':memory:');
  try {
    migrate(d, migrations.filter(m => m.version <= 18));
    for (const row of db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name LIKE 'pm_recovery_%'").all()) d.exec(row.sql);
    assert.equal(currentVersion(d), 18);
    d.prepare("INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES ('legacy','Preserved','[]','','','now','now')").run();
    d.prepare("INSERT INTO pm_recovery_profile_locks VALUES ('legacy','pending-operation')").run();
    assert.deepEqual(migrate(d).applied, [19]); assert.equal(currentVersion(d), 19);
    assert.equal(d.prepare("SELECT name FROM profiles WHERE id='legacy'").get().name, 'Preserved');
    assert.equal(d.prepare('SELECT count(*) n FROM pm_recovery_profile_locks').get().n, 1);
    assert.deepEqual(migrate(d).applied, []);
  } finally { d.close(); }
});
test('addon ownership excludes bridge startup and stop; stale release cannot unlock another owner', async () => {
  const id = crypto.randomUUID(), release = acquireFirefoxSession(id, 'addons');
  try {
    assert.throws(() => assertFirefoxAddonIdle(id), { code: 'FIREFOX_SESSION_BUSY' });
    await assert.rejects(startGeckodriverBridge(id, 12345), { code: 'FIREFOX_SESSION_BUSY' });
  } finally { release(); }
  const next = acquireFirefoxSession(id, 'geckodriver'); release();
  assert.equal(firefoxSessionOwner(id), 'geckodriver');
  assert.throws(() => acquireFirefoxSession(id, 'addons'), { code: 'FIREFOX_SESSION_BUSY' });
  next(); assert.equal(firefoxSessionOwner(id), null);
});

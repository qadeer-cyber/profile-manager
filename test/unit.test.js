// Unit tests (node:test): migrations, locking, process killing, secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-unit-'));
process.env.PM_DATA_DIR = path.join(tmp, 'data');
delete process.env.PM_SECRET;
const { migrate, migrations, currentVersion } = await import('../server/migrations.js');
const lock = await import('../server/lock.js');
const { killTree, isAlive } = await import('../server/proc.js');
const secrets = await import('../server/secrets.js');

// ---------- migrations ----------
test('migrations: fresh database reaches latest version', () => {
  const db = new Database(':memory:');
  const r = migrate(db);
  assert.equal(r.from, 0); assert.equal(r.to, migrations.at(-1).version);
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
  assert.ok(cols.includes('last_error') && cols.includes('last_launched_at'));
});
test('migrations: idempotent (second run applies nothing)', () => {
  const db = new Database(':memory:'); migrate(db);
  assert.deepEqual(migrate(db).applied, []);
});
test('migrations: legacy unversioned DB is adopted and data kept', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', folder TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', proxy TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE running (id TEXT PRIMARY KEY, pid INTEGER, cdp_port INTEGER, ws_endpoint TEXT, relay_url TEXT, started_at TEXT NOT NULL);
    INSERT INTO profiles VALUES ('a','Old','["x"]','F','n',NULL,'t','t');`);
  const r = migrate(db);
  assert.deepEqual(r.applied, migrations.map(m => m.version));
  assert.equal(db.prepare('SELECT automation_enabled FROM profiles').get().automation_enabled, 0, 'existing rows default to automation off');
  const row = db.prepare('SELECT * FROM profiles').get();
  assert.equal(row.name, 'Old'); assert.equal(row.last_error, null);
});
test('migrations: failing migration rolls back and is not recorded', () => {
  const db = new Database(':memory:'); migrate(db);
  const bad = [...migrations, { version: 99, name: 'bad', up: d => { d.exec('CREATE TABLE t99(x)'); throw new Error('boom'); } }];
  assert.throws(() => migrate(db, bad), /boom/);
  assert.equal(currentVersion(db), migrations.at(-1).version);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='t99'").get().n, 0);
});

// ---------- locking ----------
const dir = () => fs.mkdtempSync(path.join(tmp, 'prof-'));
test('lock: acquire writes pid; second acquire by same owner is refused', () => {
  const d = dir();
  assert.ok(lock.acquireLock(d));
  assert.equal(lock.readLock(d).ownerPid, process.pid);
  assert.throws(() => lock.acquireLock(d), /already being launched/);
  lock.releaseLock(d); assert.equal(lock.readLock(d), null);
});
test('lock: held by another live process -> LockedError (409)', () => {
  const d = dir();
  lock.acquireLock(d, { ownerPid: 4242, alive: () => true });
  assert.throws(() => lock.acquireLock(d, { alive: () => true }), e => e instanceof lock.LockedError && e.status === 409);
});
test('lock: stale lock (dead owner) is replaced', () => {
  const d = dir();
  lock.acquireLock(d, { ownerPid: 4242, alive: () => true });
  assert.ok(lock.acquireLock(d, { alive: pid => pid !== 4242 }));
  assert.equal(lock.readLock(d).ownerPid, process.pid);
});
test('lock: corrupt lock file is treated as stale', () => {
  const d = dir(); fs.writeFileSync(path.join(d, lock.LOCK_NAME), '{not json');
  assert.ok(lock.isStale(lock.readLock(d)));
  assert.ok(lock.acquireLock(d));
});
test('lock: release does not remove a lock owned by someone else', () => {
  const d = dir(); lock.acquireLock(d, { ownerPid: 4242 });
  lock.releaseLock(d); assert.equal(lock.readLock(d).ownerPid, 4242);
});
test('lock: updateLock merges browserPid', () => {
  const d = dir(); lock.acquireLock(d); lock.updateLock(d, { browserPid: 123, cdpPort: 9 });
  assert.equal(lock.readLock(d).browserPid, 123);
});

// ---------- process killing ----------
test('killTree (POSIX): terminates a running process', async () => {
  const p = spawn('sleep', ['30']); await new Promise(r => setTimeout(r, 100));
  assert.ok(isAlive(p.pid));
  assert.ok(await killTree(p.pid));
  assert.ok(!isAlive(p.pid));
});
test('killTree (POSIX): escalates to SIGKILL when SIGTERM is ignored', async () => {
  const p = spawn('bash', ['-c', 'trap "" TERM; while true; do sleep 0.1; done']); await new Promise(r => setTimeout(r, 200));
  assert.ok(await killTree(p.pid, { graceMs: 300 }));
  assert.ok(!isAlive(p.pid));
});
test('killTree (Windows path): calls taskkill /PID <pid> /T /F', async () => {
  let call;
  const ok = await killTree(1234, { platform: 'win32', alive: () => false, exec: (cmd, args, opts, cb) => { call = [cmd, args]; cb(null); } });
  assert.ok(ok); assert.deepEqual(call, ['taskkill', ['/PID', '1234', '/T', '/F']]);
});
test('isAlive: false for a dead pid', () => assert.equal(isAlive(2 ** 22 + 12345), false));

// ---------- secrets ----------
test('secrets: AES-GCM round trip, key file created, ciphertext differs per call', () => {
  const a = secrets.encrypt('pw'), b = secrets.encrypt('pw');
  assert.match(a, /^enc:v1:/); assert.notEqual(a, b);
  assert.equal(secrets.decrypt(a), 'pw');
  assert.ok(fs.existsSync(path.join(process.env.PM_DATA_DIR, 'secret.key')));
});
test('secrets: tampered ciphertext is rejected', () => {
  const s = secrets.encrypt('pw').split(':'); s[4] = Buffer.from('xx').toString('base64');
  assert.throws(() => secrets.decrypt(s.join(':')));
});
test('secrets: external cipher (safeStorage-like) preferred; AES values still readable; migration detection', () => {
  const aes = secrets.encrypt('old');
  secrets.setExternalCipher({ name: 'test-os', encrypt: s => Buffer.from([...Buffer.from(s)].reverse()), decrypt: b => Buffer.from([...b].reverse()).toString() });
  const ss = secrets.encrypt('new');
  assert.match(ss, /^ss:v1:/); assert.equal(secrets.decrypt(ss), 'new'); assert.equal(secrets.decrypt(aes), 'old');
  assert.ok(secrets.needsReencrypt(aes)); assert.ok(!secrets.needsReencrypt(ss));
  assert.equal(secrets.encryptionStatus().backend, 'test-os');
  secrets.setExternalCipher(null);
  assert.throws(() => secrets.decrypt(ss), /secure storage/);
});

// ---------- strict secret prefixes ----------
test('secrets: before strict mode, legacy plaintext is returned (for the startup migration)', () => {
  secrets.setStrictPrefixes(false);
  assert.equal(secrets.decrypt('plain-pw'), 'plain-pw');
});
test('secrets: in strict mode, unprefixed values are rejected and the value is never logged', () => {
  secrets.setStrictPrefixes(true);
  const logs = []; const orig = console.warn; console.warn = (...a) => logs.push(a.join(' '));
  try {
    assert.throws(() => secrets.decrypt('hunter2-secret'), e => e instanceof secrets.UnprefixedSecretError && e.code === 'UNPREFIXED_SECRET' && !e.message.includes('hunter2'));
    assert.ok(logs.length === 1 && !logs[0].includes('hunter2'), 'warning logged without the value');
    assert.equal(secrets.decrypt(secrets.encrypt('ok-pw')), 'ok-pw', 'prefixed values still decrypt');
    assert.equal(secrets.decrypt(''), '', 'empty stays empty');
  } finally { console.warn = orig; secrets.setStrictPrefixes(false); }
});
test('migrations: v5 adds automation_enabled NOT NULL DEFAULT 0', () => {
  const db = new Database(':memory:'); migrate(db);
  const col = db.prepare('PRAGMA table_info(profiles)').all().find(c => c.name === 'automation_enabled');
  assert.ok(col && col.notnull === 1 && col.dflt_value === '0' && col.type === 'INTEGER');
});

// ---------- migration v6: inline proxies -> library ----------
test('migrations: v6 moves inline proxies into the library (dedupe identical, keep ciphertext, skip invalid) with FK SET NULL', () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  migrate(db, migrations.filter(m => m.version <= 5));
  const ins = db.prepare("INSERT INTO profiles (id,name,proxy,created_at,updated_at) VALUES (?,?,?,'t','t')");
  const px = (pw, port = 1080) => JSON.stringify({ type: 'socks5', host: 'h', port, username: 'u', password: pw });
  ins.run('a', 'A', px('enc:v1:SAME')); ins.run('b', 'B', px('enc:v1:SAME')); ins.run('c', 'C', px('enc:v1:OTHER'));
  ins.run('d', 'D', null); ins.run('e', 'E', JSON.stringify({ type: 'ftp', host: 'h', port: 1 }));
  const r = migrate(db);
  assert.deepEqual(r.applied, [6]);
  const rows = db.prepare('SELECT * FROM proxies ORDER BY password').all();
  assert.equal(rows.length, 2, 'identical endpoint+ciphertext deduped; different password kept separate');
  assert.equal(rows[1].password, 'enc:v1:SAME'); assert.equal(rows[1].name, 'socks5://h:1080');
  const prof = Object.fromEntries(db.prepare('SELECT id, proxy_id, proxy FROM profiles').all().map(p => [p.id, p]));
  assert.equal(prof.a.proxy_id, prof.b.proxy_id); assert.notEqual(prof.a.proxy_id, prof.c.proxy_id);
  assert.equal(prof.a.proxy, null, 'inline column cleared');
  assert.equal(prof.d.proxy_id, null); assert.equal(prof.e.proxy_id, null, 'invalid inline proxy not migrated');
  db.prepare('DELETE FROM proxies WHERE id=?').run(prof.a.proxy_id);
  assert.equal(db.prepare("SELECT proxy_id FROM profiles WHERE id='a'").get().proxy_id, null, 'ON DELETE SET NULL');
  assert.throws(() => db.prepare("UPDATE profiles SET proxy_id='nope' WHERE id='d'").run(), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO proxies (id,name,type,host,port,created_at,updated_at) VALUES ('x','x','ftp','h',1,'t','t')").run(), /CHECK/);
});

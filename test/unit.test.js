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
const { browserProcess, classifyExitCode, classifyPreferences, closeOutcome, trackExit } = await import('../server/browsers.js');

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

test('closeOutcome: known exit status decides, unknown is not a crash, SessionEnded is Stopped', () => {
  const base = { stopping: false, exitCode: null, exitSignal: null, exitType: null, exitTypeState: 'missing' };
  assert.equal(classifyExitCode({ exitSignal: 'SIGKILL', exitCode: null }), 'error');
  assert.equal(classifyExitCode({ exitCode: 0, exitSignal: null }), 'stopped');
  assert.equal(classifyExitCode({ exitCode: 1, exitSignal: null }), 'error');
  assert.equal(classifyExitCode({ exitCode: null, exitSignal: null }), 'unknown');
  assert.equal(classifyPreferences({ exitTypeState: 'ok', exitType: 'Normal' }), 'stopped');
  assert.equal(classifyPreferences({ exitTypeState: 'ok', exitType: 'SessionEnded' }), 'stopped');
  assert.equal(classifyPreferences({ exitTypeState: 'ok', exitType: 'Crashed' }), 'error');
  assert.equal(classifyPreferences({ exitTypeState: 'missing', exitType: null }), 'unknown');
  assert.equal(classifyPreferences({ exitTypeState: 'unreadable', exitType: null }), 'unknown');
  assert.equal(classifyPreferences({ exitTypeState: 'ok', exitType: 'Other' }), 'unknown');
  assert.equal(closeOutcome({ ...base, stopping: true, exitSignal: 'SIGKILL', exitType: 'Crashed', exitTypeState: 'ok' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitType: 'Normal', exitTypeState: 'ok', exitCode: 0 }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitCode: 0, exitTypeState: 'missing' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitCode: 0, exitTypeState: 'unreadable' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitCode: 0, exitType: 'Crashed', exitTypeState: 'ok' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitType: 'Normal', exitTypeState: 'ok' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitType: 'SessionEnded', exitTypeState: 'ok', exitCode: 1, exitSignal: 'SIGTERM' }), 'stopped');
  assert.equal(closeOutcome({ ...base, exitType: 'Crashed', exitTypeState: 'ok' }), 'error');
  assert.equal(closeOutcome({ ...base, exitSignal: 'SIGKILL', exitType: 'Normal', exitTypeState: 'ok' }), 'error');
  assert.equal(closeOutcome({ ...base, exitCode: 1, exitType: 'Normal', exitTypeState: 'ok' }), 'error');
  assert.equal(closeOutcome({ ...base, exitCode: 1, exitTypeState: 'missing' }), 'error');
  assert.equal(closeOutcome(base), 'stopped');
  assert.equal(closeOutcome({ ...base, exitTypeState: 'unreadable' }), 'stopped');
  assert.equal(closeOutcome({ ...base, stillAlive: true, exitCode: 0 }), 'error');
});
test('missing playwright process handle is logged and is not a crash', () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    const entry = { ctx: { browser() { return {}; } }, exitCode: null, exitSignal: null, exitType: null, exitTypeState: 'missing' };
    trackExit(entry);
    assert.equal(entry.proc, null);
    assert.match(logs.join('\n'), /CLASSIFIER-FALLBACK/);
    assert.equal(closeOutcome(entry), 'stopped');
  } finally { console.warn = orig; }
});
test('migrate copies a file database before changing it and keeps the rows', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'mig-'));
  const file = path.join(dir, 'profiles.db');
  const db = new Database(file);
  const v040 = migrations.filter(m => m.version <= 6);
  const first = migrate(db, v040);
  assert.deepEqual(first.applied, [1, 2, 3, 4, 5, 6]);
  assert.ok(first.backup && fs.existsSync(first.backup));
  const id = '11111111-1111-1111-1111-111111111111';
  db.prepare('INSERT INTO profiles (id, name, tags, folder, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Kept', '[]', '', '', 't', 't');
  const second = migrate(db);
  assert.equal(second.from, 6);
  assert.ok(second.applied.includes(7));
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, 'Kept');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_profiles_updated_at'").get().name, 'idx_profiles_updated_at');
  assert.ok(second.backup && second.backup !== first.backup && fs.existsSync(second.backup));
  const third = migrate(db);
  assert.deepEqual(third.applied, []);
  assert.equal(third.backup, null);
  assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.bak')).length, 2);
  db.close();
});
test('0.5.0-alpha.2 keeps the v0.4.0 install identity and uninstall keeps data', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.5.0-alpha.2');
  assert.equal(pkg.name, 'profile-manager');
  assert.equal(pkg.build.appId, 'local.profilemanager.app');
  assert.equal(pkg.build.productName, 'Profile Manager');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  const offline = fs.readFileSync(new URL('../electron-builder.offline.cjs', import.meta.url), 'utf8');
  assert.match(offline, /deleteAppDataOnUninstall:\s*false/);
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(process\.env\.PM_USER_DATA\) app\.setPath\('userData', process\.env\.PM_USER_DATA\)/);
});
test('upgrade from 0.5.0-alpha.1 schema 10 keeps profiles, proxies, secrets, and Chrome user-data', async () => {
  const { DEFAULT_ADVANCED_SETTINGS } = await import('../server/advanced-settings.js');
  const dir = fs.mkdtempSync(path.join(tmp, 'up10-'));
  const file = path.join(dir, 'profiles.db');
  const profileId = '22222222-2222-2222-2222-222222222222';
  const userData = path.join(dir, 'profiles', profileId, 'Default');
  fs.mkdirSync(path.join(userData, 'Network'), { recursive: true });
  const cookieFile = path.join(userData, 'Network', 'Cookies');
  const prefFile = path.join(userData, 'Preferences');
  const cookieBytes = Buffer.from('cookie-bytes-v10');
  const prefBytes = Buffer.from('{"exit_type":"Normal"}');
  fs.writeFileSync(cookieFile, cookieBytes);
  fs.writeFileSync(prefFile, prefBytes);
  const secret = 'enc:v1:kept-ciphertext';
  const db = new Database(file);
  const to10 = migrate(db, migrations.filter(m => m.version <= 10));
  assert.equal(to10.to, 10);
  const now = '2026-01-01T00:00:00.000Z';
  const proxyId = '33333333-3333-3333-3333-333333333333';
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(proxyId, 'KeptProxy', 'http', '127.0.0.1', 8080, 'user', secret, '[]', now, now);
  db.prepare(`INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at,proxy_id,browser_settings,webrtc_settings)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(profileId, 'KeptProfile', '["alpha"]', 'Folder', 'note', now, now, proxyId,
      '{"locale":"en-US","timezoneId":"UTC","languages":["en-US"]}',
      '{"mode":"disable_non_proxied_udp"}');
  db.close();
  const db2 = new Database(file);
  const upgraded = migrate(db2);
  assert.equal(upgraded.from, 10);
  assert.deepEqual(upgraded.applied, [11, 12]);
  assert.equal(upgraded.to, migrations.at(-1).version);
  assert.ok(upgraded.backup && fs.existsSync(upgraded.backup));
  const profile = db2.prepare('SELECT name, tags, folder, notes, proxy_id, browser_settings, webrtc_settings, advanced_settings, automation_enabled FROM profiles WHERE id=?').get(profileId);
  assert.equal(profile.name, 'KeptProfile');
  assert.equal(profile.tags, '["alpha"]');
  assert.equal(profile.folder, 'Folder');
  assert.equal(profile.notes, 'note');
  assert.equal(profile.proxy_id, proxyId);
  assert.equal(profile.automation_enabled, 0);
  assert.equal(profile.browser_settings, '{"locale":"en-US","timezoneId":"UTC","languages":["en-US"]}');
  assert.equal(profile.webrtc_settings, '{"mode":"disable_non_proxied_udp"}');
  assert.deepEqual(JSON.parse(profile.advanced_settings), DEFAULT_ADVANCED_SETTINGS);
  const proxy = db2.prepare('SELECT name, type, host, port, username, password, provider, provider_ref, provider_meta FROM proxies WHERE id=?').get(proxyId);
  assert.equal(proxy.name, 'KeptProxy');
  assert.equal(proxy.type, 'http');
  assert.equal(proxy.host, '127.0.0.1');
  assert.equal(proxy.port, 8080);
  assert.equal(proxy.username, 'user');
  assert.equal(proxy.password, secret);
  assert.equal(proxy.provider, null);
  assert.equal(proxy.provider_ref, null);
  assert.equal(proxy.provider_meta, '{}');
  for (const table of ['provider_accounts', 'saved_views', 'bulk_jobs', 'proxy_checks']) {
    assert.equal(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table).name, table);
  }
  db2.close();
  assert.deepEqual(fs.readFileSync(cookieFile), cookieBytes);
  assert.deepEqual(fs.readFileSync(prefFile), prefBytes);
});
test('v0.4.0 migrations stay the be575c7 list', async () => {
  const { migrationsV040 } = await import('./fixtures/schema-v0.4.0.mjs');
  assert.deepEqual(migrationsV040.map(m => m.version), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    migrationsV040.map(m => [m.version, m.name]),
    migrations.filter(m => m.version <= 6).map(m => [m.version, m.name]),
  );
});
test('installed playwright-core 1.64.1 exposes the launched browser child', async () => {
  const file = path.resolve('node_modules/playwright-core/lib/coreBundle.js');
  const lines = fs.readFileSync(file, 'utf8').split(/\n/);
  assert.match(lines[41260], /browserProcess = \{/);
  assert.match(lines[41262], /process: launchedProcess/);
  assert.match(lines[65543], /clientConnection\.toImpl = /);
  const { chromium } = await import('playwright');
  const dir = fs.mkdtempSync(path.join(tmp, 'pw-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true, timeout: 30000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  try {
    const proc = browserProcess(ctx);
    assert.equal(typeof proc?.pid, 'number');
    assert.ok(proc.pid > 0);
    assert.equal(typeof proc.once, 'function');
    const session = await ctx.browser().newBrowserCDPSession();
    const info = await session.send('SystemInfo.getProcessInfo');
    await session.detach();
    const pid = Number(info.processInfo.find(p => p.type === 'browser').id);
    assert.equal(Number(proc.pid), pid, 'Playwright child PID equals Chromium browser PID');
    assert.ok(await (await import('../server/proc.js')).pidMatches(pid, dir), 'browser command line belongs to this profile');
  } finally {
    await ctx.close();
  }
});

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
  assert.deepEqual(r.applied, [6, 7, 8, 9, 10, 11, 12]);
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


// Per-launch evidence regressions run under the same unit-test command.
await import('./termination-evidence.test.js');

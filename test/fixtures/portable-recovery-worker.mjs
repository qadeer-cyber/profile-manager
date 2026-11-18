// Disposable subprocess fixture. Never opens actual user data.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { db, DATA_DIR, userDataDir } from '../../server/db.js';
import { encrypt, decrypt } from '../../server/secrets.js';
import { createProfileBackup, restoreBackup, inspectBackup } from '../../server/backup.js';
import { softDeleteProfile, purgeFromTrash, restoreFromTrash } from '../../server/profile-lifecycle.js';
import { recoverDataOperationsAtStartup, recoveryDiagnostics, recoverOperation, assertProfileOperationAvailable } from '../../server/recovery-journal.js';
const args = JSON.parse(process.env.PM_TEST_ARGS || '{}');
const ids = { chromium: '11111111-1111-4111-8111-111111111111', firefox: '22222222-2222-4222-8222-222222222222', workspace: '33333333-3333-4333-8333-333333333333', proxy: '44444444-4444-4444-8444-444444444444', chromiumExt: '55555555-5555-4555-8555-555555555555', firefoxExt: '66666666-6666-4666-8666-666666666666' };
const passphrase = 'disposable test passphrase';
const fault = point => { if (args.crash === point) process.exit(86); if (args.fail === point) throw Error('injected interruption'); };
let output;
try {
  if (args.mode === 'seed') {
    const now = new Date().toISOString(), label = args.label || 'Export';
    db.prepare('INSERT INTO workspaces VALUES (?,?,?,?,?,?)').run(ids.workspace, label + ' workspace', 'fixture', 0, now, now);
    db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(ids.proxy, label + ' proxy', 'socks5', '127.0.0.1', 1080, 'fixture-user', encrypt('fixture-proxy-password'), '[]', now, now);
    for (const engine of ['chromium', 'firefox']) {
      const id = ids[engine], ext = ids[engine + 'Ext'];
      db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at,browser_engine,workspace_id,proxy_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, label + ' ' + engine, '[]', '', label, now, now, engine, ids.workspace, ids.proxy);
      const storage = `${engine === 'firefox' ? 'gecko-extensions' : 'extensions'}/${ext}`;
      fs.mkdirSync(path.join(DATA_DIR, storage), { recursive: true });
      const manifest = { manifest_version: 2, name: engine + ' extension', version: '1.0', ...(engine === 'firefox' ? { browser_specific_settings: { gecko: { id: 'fixture@test' } } } : {}) };
      fs.writeFileSync(path.join(DATA_DIR, storage, 'manifest.json'), JSON.stringify(manifest)); fs.writeFileSync(path.join(DATA_DIR, storage, 'background.js'), '// fixture asset');
      db.prepare('INSERT INTO extensions (id,name,version,manifest_version,storage_dir,created_at,updated_at,browser_engine,gecko_extension_id) VALUES (?,?,?,?,?,?,?,?,?)').run(ext, manifest.name, '1.0', 2, storage, now, now, engine, engine === 'firefox' ? 'fixture@test' : null);
      db.prepare('INSERT INTO profile_extensions VALUES (?,?,?,?,?)').run(id, ext, 1, now, now);
      const tree = engine === 'firefox' ? path.join(userDataDir(id), 'gecko') : path.join(userDataDir(id), 'Default');
      fs.mkdirSync(path.join(tree, 'Local Storage'), { recursive: true });
      fs.writeFileSync(path.join(tree, 'Local Storage', 'fixture'), label + ' ' + engine);
      fs.writeFileSync(path.join(tree, 'marker'), label + ' ' + engine);
      const cookie = new Database(path.join(tree, 'cookies.sqlite'));
      cookie.exec('CREATE TABLE fixture_cookies (name TEXT,value TEXT)'); cookie.prepare('INSERT INTO fixture_cookies VALUES (?,?)').run('isolation', engine); cookie.close();
    }
    output = ids;
  } else if (args.mode === 'export') {
    const buffer = createProfileBackup(ids[args.engine || 'chromium'], { passphrase, confirmSensitive: true });
    fs.writeFileSync(args.file, buffer); output = { encrypted: buffer.subarray(0, 4).toString() === 'PMBE', bytes: buffer.length, preview: inspectBackup(buffer, { passphrase }) };
  } else if (args.mode === 'restore') {
    output = restoreBackup(fs.readFileSync(args.file), { passphrase, collision: args.collision || 'abort', fault });
  } else if (args.mode === 'startup') output = recoverDataOperationsAtStartup();
  else if (args.mode === 'recover') output = recoveryDiagnostics().filter(o => !args.profileId || o.profileIds.includes(args.profileId)).map(o => recoverOperation(o.id, { cleanup: args.cleanup === true }));
  else if (args.mode === 'purge') {
    const id = ids[args.engine || 'chromium'];
    if (!db.prepare('SELECT deleted_at FROM profiles WHERE id=?').get(id).deleted_at) await softDeleteProfile(id);
    if (args.dbFail) db.exec("CREATE TEMP TRIGGER refuse_purge BEFORE DELETE ON profiles BEGIN SELECT RAISE(ABORT, 'injected db failure'); END");
    const remove = args.partial ? (target, options) => {
      const sub = path.join(target, 'Default', 'marker'); fs.rmSync(sub, { force: true }); throw Object.assign(Error('locked fixture'), { code: 'EBUSY' });
    } : undefined;
    output = await purgeFromTrash(id, { confirmName: db.prepare('SELECT name FROM profiles WHERE id=?').get(id).name, rmSyncImpl: remove, fault });
  } else if (args.mode === 'status') {
    const profiles = db.prepare('SELECT id,name,browser_engine,proxy_id,workspace_id,purge_error,deleted_at FROM profiles ORDER BY id').all();
    output = { profiles: profiles.map(p => {
      let blocked = false; try { assertProfileOperationAvailable(p.id); } catch { blocked = true; }
      const prefix = p.browser_engine === 'firefox' ? 'gecko' : 'Default', tree = path.join(userDataDir(p.id), prefix);
      return { ...p, blocked, marker: fs.existsSync(path.join(tree, 'marker')) ? fs.readFileSync(path.join(tree, 'marker'), 'utf8') : null,
        localStorage: fs.existsSync(path.join(tree, 'Local Storage', 'fixture')) ? fs.readFileSync(path.join(tree, 'Local Storage', 'fixture'), 'utf8') : null,
        proxySecretMatches: p.proxy_id ? decrypt(db.prepare('SELECT password FROM proxies WHERE id=?').get(p.proxy_id).password) === 'fixture-proxy-password' : false,
        extensions: db.prepare('SELECT e.id,e.storage_dir,e.browser_engine FROM extensions e JOIN profile_extensions pe ON pe.extension_id=e.id WHERE pe.profile_id=?').all(p.id).map(e => ({ ...e, assetPresent: fs.existsSync(path.join(DATA_DIR, e.storage_dir, 'background.js')) })),
      };
    }), operations: recoveryDiagnostics(), locks: db.prepare('SELECT * FROM pm_recovery_profile_locks').all() };
  } else throw Error('Unknown fixture mode');
  console.log(JSON.stringify({ ok: true, value: output }));
} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: e.message })); process.exitCode = 1; }
finally { if (db.open) db.close(); }

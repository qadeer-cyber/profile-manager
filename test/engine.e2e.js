// Engine reliability integration tests: DB upgrade, isolation, persistence across restarts, clone safety,
// cross-process locking, crash detection, failed launches, stale-lock recovery, safe shutdown.
import { spawn } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { migrations } from '../server/migrations.js';
import { listenFree, freePort, spawnServer } from './_ports.mjs';
const LATEST = migrations.at(-1).version;

// Ports: OS-assigned unless PM_TEST_PORT / PM_TEST_PORT2 / PM_TEST_TARGET_PORT / PM_TEST_CDP_PORT are set.
let B;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-engine-'));
const baseEnv = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: 't', PM_HEALTH_INTERVAL: '500' };
delete baseEnv.PM_SECRET;
const target = http.createServer((q, s) => s.end('<title>t</title>ok'));
const ORIGIN = `http://127.0.0.1:${await listenFree(target, 'PM_TEST_TARGET_PORT')}/`;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function startServer(envName = 'PM_TEST_PORT') {
  const p = await spawnServer(baseEnv, { envName, echo: true });
  if (envName === 'PM_TEST_PORT') B = p.url;
  return p;
}
const stopServer = p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); });
const api = async (m, u, b, base = B) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }); return { s: r.status, d: r.status === 204 ? null : await r.json() }; };

// Attach over CDP, run fn(page) on ORIGIN in a new page, then disconnect without closing the profile.
async function withPage(profile, fn) {
  const br = await chromium.connectOverCDP(profile.cdp.wsEndpoint);
  const ctx = br.contexts()[0]; const pg = await ctx.newPage();
  await pg.goto(ORIGIN);
  try { return await fn(pg, ctx); } finally { await pg.close(); await br.close(); }
}
const readState = (pg, ctx) => Promise.all([pg.evaluate(() => localStorage.getItem('who')), ctx.cookies(ORIGIN).then(c => c.find(x => x.name === 'who')?.value ?? null)]);
const writeState = (pg, v) => pg.evaluate(v => { localStorage.setItem('who', v); document.cookie = `who=${v}; max-age=86400; path=/`; }, v);

let srv;
try {
  // ---- 1. Upgrade a copy of a pre-migration DB (schema exactly as shipped in the previous stage) ----
  const keyB64 = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'secret.key'), keyB64);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ct = Buffer.concat([c.update('legacy-pw'), c.final()]);
  const encPw = `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
  const legacyId = crypto.randomUUID();
  const orig = path.join(os.tmpdir(), `pm-legacy-${process.pid}.db`);
  const ldb = new Database(orig);
  ldb.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', folder TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', proxy TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE running (id TEXT PRIMARY KEY, pid INTEGER, cdp_port INTEGER, ws_endpoint TEXT, relay_url TEXT, started_at TEXT NOT NULL);`);
  ldb.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?)').run(legacyId, 'Legacy', '["old"]', 'Archive', 'from v0', JSON.stringify({ type: 'http', host: '10.0.0.1', port: 8080, username: 'bob', password: encPw }), 't0', 't0');
  ldb.close();
  fs.copyFileSync(orig, path.join(dataDir, 'profiles.db')); // upgrade the copy, keep the original
  fs.mkdirSync(path.join(dataDir, 'profiles', legacyId));
  srv = await startServer();
  let r = await api('GET', `/api/profiles/${legacyId}`);
  ok(r.s === 200 && r.d.name === 'Legacy' && r.d.tags[0] === 'old' && r.d.proxy.username === 'bob' && r.d.proxy.password === '••••', 'upgraded DB: legacy profile kept with its data');
  r = await api('GET', '/api/diagnostics');
  ok(r.d.schemaVersion === LATEST && r.d.migration.from === 0 && r.d.migration.applied.join() === migrations.map(m => m.version).join(), `upgraded DB: schema_version 0 -> ${LATEST}`);
  ok(new Database(orig, { readonly: true }).prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schema_version'").get().n === 0, 'original DB file untouched (upgrade ran on a copy)');
  const udb = new Database(path.join(dataDir, 'profiles.db'), { readonly: true });
  const stored = udb.prepare('SELECT x.password FROM proxies x JOIN profiles p ON p.proxy_id = x.id WHERE p.id=?').get(legacyId).password; udb.close();
  ok(stored === encPw, 'upgraded DB: inline proxy moved to the library with its AES ciphertext unchanged');
  await api('DELETE', `/api/profiles/${legacyId}`);

  // ---- 2. Simultaneous profiles have separate cookies + localStorage ----
  const A = (await api('POST', '/api/profiles', { name: 'A' })).d, Bp = (await api('POST', '/api/profiles', { name: 'B' })).d;
  ok(path.resolve(dataDir, 'profiles', A.id) !== path.resolve(dataDir, 'profiles', Bp.id), 'each profile has its own data dir');
  const a = (await api('POST', `/api/profiles/${A.id}/launch`)).d, b = (await api('POST', `/api/profiles/${Bp.id}/launch`)).d;
  ok(a.running && b.running && a.cdp.pid && b.cdp.pid && a.cdp.pid !== b.cdp.pid, 'two profiles running at once (separate browser processes)');
  await withPage(a, pg => writeState(pg, 'A'));
  const bBefore = await withPage(b, (pg, ctx) => readState(pg, ctx));
  ok(bBefore[0] === null && bBefore[1] === null, 'B does not see A\'s localStorage or cookie');
  await withPage(b, pg => writeState(pg, 'B'));
  const aNow = await withPage(a, (pg, ctx) => readState(pg, ctx));
  ok(aNow[0] === 'A' && aNow[1] === 'A', 'A keeps its own values after B writes');
  ok((await api('GET', `/api/profiles/${A.id}`)).d.running && alive(a.cdp.pid), 'CDP disconnect leaves the profile running');
  const lk = JSON.parse(fs.readFileSync(path.join(dataDir, 'profiles', A.id, '.pm-lock'), 'utf8'));
  ok(lk.ownerPid === srv.pid && lk.browserPid === a.cdp.pid, 'lock file records owner pid and browser pid');

  // ---- 3. Cross-process lock: a second app instance can't launch a profile the first one holds ----
  const srv2 = await startServer('PM_TEST_PORT2');
  r = await api('POST', `/api/profiles/${A.id}/launch`, {}, srv2.url);
  ok(r.s === 409 && /in use by another process/.test(r.d.error), 'second instance gets 409 "in use by another process"');
  ok(alive(a.cdp.pid), 'second instance\'s recovery did not kill the first instance\'s browser');
  await stopServer(srv2);

  // ---- 4. Data kept across app restarts ----
  await stopServer(srv);
  ok(!alive(a.cdp.pid) && !alive(b.cdp.pid), 'safe shutdown: SIGTERM closes all browsers');
  const sdb = new Database(path.join(dataDir, 'profiles.db'), { readonly: true });
  ok(sdb.prepare('SELECT COUNT(*) n FROM running').get().n === 0, 'safe shutdown: running table empty'); sdb.close();
  ok(!fs.existsSync(path.join(dataDir, 'profiles', A.id, '.pm-lock')), 'safe shutdown: locks released');
  srv = await startServer();
  const a2 = (await api('POST', `/api/profiles/${A.id}/launch`)).d;
  const aAfter = await withPage(a2, (pg, ctx) => readState(pg, ctx));
  ok(aAfter[0] === 'A' && aAfter[1] === 'A', 'after restart: cookie + localStorage persisted');
  await api('POST', `/api/profiles/${A.id}/stop`);

  // ---- 5. Clone doesn't corrupt the original ----
  const C = (await api('POST', `/api/profiles/${A.id}/clone`)).d;
  ok(C.id !== A.id && fs.existsSync(path.join(dataDir, 'profiles', C.id)), 'clone gets its own data directory');
  const c1 = (await api('POST', `/api/profiles/${C.id}/launch`)).d;
  const cState = await withPage(c1, (pg, ctx) => readState(pg, ctx));
  ok(cState[0] === 'A' && cState[1] === 'A', 'clone starts with a copy of the original\'s data');
  await withPage(c1, pg => writeState(pg, 'C'));
  await api('POST', `/api/profiles/${C.id}/stop`);
  const a3 = (await api('POST', `/api/profiles/${A.id}/launch`)).d;
  const aOrig = await withPage(a3, (pg, ctx) => readState(pg, ctx));
  ok(aOrig[0] === 'A' && aOrig[1] === 'A', 'original unchanged after clone was modified');

  // ---- 6. Crash detection (browser killed externally) ----
  const evs = [];
  const ac = new AbortController();
  fetch(B + '/api/events', { signal: ac.signal }).then(async res => {
    const rd = res.body.getReader(), dec = new TextDecoder();
    for (;;) { const { value, done } = await rd.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.*)/g)) evs.push(JSON.parse(m[1])); }
  }).catch(() => {});
  await sleep(300);
  process.kill(a3.cdp.pid, 'SIGKILL');
  for (let i = 0; i < 40 && !evs.some(e => e.type === 'profile:crashed'); i++) await sleep(100);
  ok(evs.some(e => e.type === 'profile:crashed' && e.id === A.id), 'crash detected and profile:crashed event emitted to UI stream');
  r = await api('GET', `/api/profiles/${A.id}`);
  ok(!r.d.running && /unexpectedly|died/.test(r.d.last_error || ''), 'crashed profile marked stopped with last_error');
  ok(!fs.existsSync(path.join(dataDir, 'profiles', A.id, '.pm-lock')), 'crash releases the profile lock');
  r = await api('POST', `/api/profiles/${A.id}/launch`); ok(r.d.running, 'crashed profile relaunches');
  const aStateCrash = await withPage(r.d, (pg, ctx) => readState(pg, ctx));
  ok(aStateCrash[0] === 'A', 'profile data survives a browser crash');
  await api('POST', `/api/profiles/${A.id}/stop`);
  ac.abort();

  // ---- 7. Failed launches ----
  const badExe = path.join(dataDir, 'bad-browser.sh'); fs.writeFileSync(badExe, '#!/bin/sh\necho broken >&2\nexit 1\n', { mode: 0o755 });
  r = await api('PUT', '/api/settings', { executablePath: '/nope/chrome' }); ok(r.s === 400 && /not found/.test(r.d.error), 'settings reject a missing executable path');
  await api('PUT', '/api/settings', { executablePath: badExe });
  r = await api('POST', `/api/profiles/${A.id}/launch`);
  ok(r.s === 500 && r.d.code === 'LAUNCH_FAILED' && /Failed to launch browser/.test(r.d.error), `bad executable -> clear error (${(r.d.error || '').slice(0, 70)}…)`);
  r = await api('GET', `/api/profiles/${A.id}`);
  ok(!r.d.running && r.d.last_error && !fs.existsSync(path.join(dataDir, 'profiles', A.id, '.pm-lock')), 'failed launch: not stuck running, lock released, last_error set');
  await api('PUT', '/api/settings', { executablePath: '' });
  r = await api('POST', `/api/profiles/${A.id}/launch`); ok(r.d.running, 'launch works again after fixing the executable');
  await api('POST', `/api/profiles/${A.id}/stop`);
  const D = (await api('POST', '/api/profiles', { name: 'D' })).d, dDir = path.join(dataDir, 'profiles', D.id);
  fs.rmSync(dDir, { recursive: true }); fs.writeFileSync(dDir, 'garbage');
  r = await api('POST', `/api/profiles/${D.id}/launch`);
  ok(r.s === 500 && r.d.code === 'CORRUPT_DIR' && /damaged/.test(r.d.error), 'corrupt data dir -> clear CORRUPT_DIR error');
  ok(!(await api('GET', `/api/profiles/${D.id}`)).d.running, 'corrupt dir: state not stuck');
  ok((await api('DELETE', `/api/profiles/${D.id}`)).s === 204 && !fs.existsSync(dDir), 'corrupt profile can still be deleted');
  // concurrent double launch of the same profile -> one browser
  const [l1, l2] = await Promise.all([api('POST', `/api/profiles/${Bp.id}/launch`), api('POST', `/api/profiles/${Bp.id}/launch`)]);
  ok(l1.d.running && l2.d.running && l1.d.cdp.pid === l2.d.cdp.pid, 'concurrent launch requests for one profile start a single browser');
  await api('POST', `/api/profiles/${Bp.id}/stop`);

  // ---- 8. Startup recovery: stale lock and orphan running record after a hard crash ----
  const bRun = (await api('POST', `/api/profiles/${Bp.id}/launch`)).d;
  srv.kill('SIGKILL'); await new Promise(r => srv.once('exit', r));
  fs.writeFileSync(path.join(dataDir, 'profiles', C.id, '.pm-lock'), JSON.stringify({ ownerPid: 2 ** 22 + 999, browserPid: null, startedAt: 'x', host: os.hostname() }));
  srv = await startServer(); await sleep(300);
  ok(/Recovery: cleared 1 running record\(s\), \d+ stale lock\(s\)/.test(srv.out), 'startup recovery reported cleanup');
  ok(!fs.existsSync(path.join(dataDir, 'profiles', C.id, '.pm-lock')) && !fs.existsSync(path.join(dataDir, 'profiles', Bp.id, '.pm-lock')), 'stale locks removed on startup');
  await sleep(500);
  ok(!alive(bRun.cdp.pid), 'orphaned browser from the crashed session is gone');
  r = await api('GET', '/api/meta'); ok(r.d.running.length === 0, 'running state reset after crash');
  r = await api('POST', `/api/profiles/${C.id}/launch`); ok(r.d.running, 'previously stale-locked profile launches');
  r = await api('POST', `/api/profiles/${Bp.id}/launch`); ok(r.d.running, 'previously orphaned profile launches');
  await stopServer(srv);

  // ---- 9. Recovery kills a truly orphaned browser (one that outlived its app, as can happen on Windows),
  //         but never a pid whose CDP port no longer answers (pid-reuse safety) ----
  const E = Bp.id, eDir = path.join(dataDir, 'profiles', E);
  const cdpPort = await freePort('PM_TEST_CDP_PORT');
  const orphan = spawn(chromium.executablePath(), ['--headless=new', `--user-data-dir=${eDir}`, `--remote-debugging-port=${cdpPort}`, '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) break; } catch {} await sleep(100); }
  const decoy = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  const wdb = new Database(path.join(dataDir, 'profiles.db'));
  wdb.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(E, orphan.pid, cdpPort, 'ws://x', null, 'x');
  wdb.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(C.id, decoy.pid, 1, 'ws://x', null, 'x'); wdb.close();
  const deadOwner = JSON.stringify({ ownerPid: 2 ** 22 + 998, browserPid: orphan.pid, cdpPort, startedAt: 'x', host: os.hostname() });
  fs.writeFileSync(path.join(eDir, '.pm-lock'), deadOwner);
  ok(alive(orphan.pid), `orphan browser running before restart (pid ${orphan.pid})`);
  srv = await startServer(); await sleep(500);
  ok(/killed 1 orphaned/.test(srv.out) && !alive(orphan.pid), 'startup recovery killed the orphaned browser (verified via its CDP port)');
  ok(alive(decoy.pid), 'unrelated process with a recorded pid but no CDP port was NOT killed');
  process.kill(decoy.pid, 'SIGKILL');
  r = await api('POST', `/api/profiles/${E}/launch`); ok(r.d.running, 'profile launches after orphan cleanup');
  await stopServer(srv);
} catch (e) { fail++; console.error(e); }
if (srv && srv.exitCode === null) await stopServer(srv);
console.log(`\n${pass} passed, ${fail} failed`);
target.close(); fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

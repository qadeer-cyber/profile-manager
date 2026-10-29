// Windows-only: install published Alpha.3 offline EXE, seed profile data, upgrade to branch-built EXE, verify schema v16+.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnInstalledServer, stopServer } from './_ports.mjs';

if (process.platform !== 'win32') {
  console.error('branch upgrade smoke requires Windows');
  process.exit(2);
}

const branchSetup = process.env.PM_BRANCH_SETUP
  || (() => {
    const exes = fs.readdirSync('release').filter(f => f.endsWith('.exe') && f.includes('offline') && f.includes('Setup'));
    if (exes.length !== 1) throw new Error(`expected one branch setup in release/, found ${exes.length}`);
    return path.resolve('release', exes[0]);
  })();

const alpha3Setup = process.env.PM_ALPHA3_SETUP
  || path.join(os.tmpdir(), 'Profile.Manager-offline-Setup-0.5.0-alpha.3-x64.exe');

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Profile Manager');
const appData = path.join(process.env.APPDATA, 'profile-manager');
const dataDir = path.join(appData, 'data');
const dbPath = path.join(dataDir, 'profiles.db');

function silentInstall(setupPath) {
  const p = spawn(setupPath, ['/S'], { stdio: 'inherit', windowsHide: true });
  return new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`installer exit ${code}`))));
  });
}

async function seedPersistFixture(installDirForSeed) {
  const server = http.createServer((req, res) => {
    const u = req.url || '';
    if (u.startsWith('/set')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>localStorage.setItem('pm_k','pm_v');document.cookie='pm_c=pm_cookie; path=/; max-age=86400';fetch('/wrote').catch(()=>{})<\/script>`);
      return;
    }
    if (u.startsWith('/wrote')) { res.end('ok'); return; }
    res.end('ok');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const originPort = server.address().port;
  const env = { ...process.env, PM_DATA_DIR: dataDir, PM_API_TOKEN: 'branch-up-seed' };
  const auth = { Authorization: 'Bearer branch-up-seed', 'Content-Type': 'application/json' };
  const proc = await spawnInstalledServer(installDirForSeed, env);
  try {
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0 }) });
    const persist = await (await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Persist' }) })).json();
    const launch = await fetch(proc.url + '/api/v1/profiles/' + persist.id + '/launch', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ headless: true, automation: true, url: `http://127.0.0.1:${originPort}/set` }),
    });
    if (launch.status !== 200) throw new Error('launch ' + launch.status);
    await new Promise(r => setTimeout(r, 3000));
    await fetch(proc.url + '/api/v1/profiles/' + persist.id + '/stop', { method: 'POST', headers: auth });
    fs.writeFileSync(path.join(appData, 'branch-upgrade-smoke.json'), JSON.stringify({ id: persist.id }));
  } finally {
    await stopServer(proc).catch(() => {});
    await new Promise(r => server.close(() => r()));
  }
}

let pass = 0;
let fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };

if (!fs.existsSync(alpha3Setup)) {
  console.error(`Alpha.3 installer missing at ${alpha3Setup}; set PM_ALPHA3_SETUP or download v0.5.0-alpha.3-m1-m17 asset`);
  process.exit(2);
}

for (const p of [installDir, appData]) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

await silentInstall(alpha3Setup);
ok(fs.existsSync(path.join(installDir, 'Profile Manager.exe')), 'alpha.3 baseline installed');

await seedPersistFixture(installDir);
ok(fs.existsSync(dbPath), `profiles.db exists (${dbPath})`);

const preVersion = (await import('better-sqlite3')).default;
const preDb = new preVersion(dbPath, { readonly: true });
const preSchema = preDb.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get()?.v ?? 0;
preDb.close();
ok(preSchema >= 6, `alpha.3 schema baseline (${preSchema})`);

await silentInstall(branchSetup);
ok(fs.existsSync(path.join(installDir, 'Profile Manager.exe')), 'branch build installed over alpha.3');

const Database = (await import('better-sqlite3')).default;
const ddb = new Database(dbPath, { readonly: true });
const persistRow = ddb.prepare('SELECT id, name FROM profiles WHERE name = ?').get('Persist');
ok(persistRow?.name === 'Persist', 'Persist profile row survived upgrade');
const schemaV = ddb.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get();
ok((schemaV?.v ?? 0) >= 16, `schema_version after branch upgrade (${schemaV?.v})`);
ok(ddb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get(), 'workspaces table present');
if (persistRow?.id) {
  ok(fs.existsSync(path.join(dataDir, 'profiles', persistRow.id, 'Default')), 'Chromium user-data dir exists after upgrade');
}
ddb.close();

try { execFileSync('taskkill', ['/F', '/IM', 'Profile Manager.exe', '/T'], { stdio: 'ignore' }); } catch { /* none */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

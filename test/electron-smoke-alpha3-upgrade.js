// Windows-only: install alpha.2 EXE, seed profile data via API, upgrade to alpha.3 EXE, verify preservation.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnServer, stopServer } from './_ports.mjs';

if (process.platform !== 'win32') {
  console.error('alpha2→alpha3 upgrade smoke requires Windows');
  process.exit(2);
}

const ALPHA2_SHA = (process.env.PM_ALPHA2_SHA256 || '053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4').toLowerCase();
const alpha3Setup = process.env.PM_ALPHA3_SETUP
  || (() => {
    const exes = fs.readdirSync('release').filter(f => f.endsWith('.exe') && f.includes('offline') && f.includes('Setup'));
    if (exes.length !== 1) throw new Error(`expected one alpha3 setup in release/, found ${exes.length}`);
    return path.resolve('release', exes[0]);
  })();

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Profile Manager');
const appData = path.join(process.env.APPDATA, 'profile-manager');
const dataDir = path.join(appData, 'data');
const db = path.join(dataDir, 'profiles.db');

function silentInstall(setupPath) {
  const p = spawn(setupPath, ['/S'], { stdio: 'inherit', windowsHide: true });
  return new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`installer exit ${code}`))));
  });
}

function runPhase(exe, phase) {
  const env = {
    ...process.env,
    PM_SMOKE: '1',
    PM_SMOKE_OFFLINE: '1',
    PM_SMOKE_PHASE: phase,
    PM_AUTOMATION_DEFAULT: '1',
    PM_HEALTH_INTERVAL: '400',
    PM_PROXY_LOOPBACK: '1',
    PM_PROXY_TEST_INSECURE_TLS: '1',
    PLAYWRIGHT_DOWNLOAD_HOST: 'http://127.0.0.1:9',
    PM_SMOKE_RESULT: path.join(os.tmpdir(), `pm-a3up-${phase}.json`),
  };
  delete env.PM_BROWSERS_PATH;
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  fs.rmSync(env.PM_SMOKE_RESULT, { force: true });
  return new Promise(resolve => {
    const child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: 'timeout', out, result: env.PM_SMOKE_RESULT }); }, 300000);
    child.on('exit', code => { clearTimeout(t); resolve({ code, out, result: env.PM_SMOKE_RESULT }); });
  });
}

function load(run) {
  if (!fs.existsSync(run.result)) return { error: 'no result file', exit: run.code };
  return { ...JSON.parse(fs.readFileSync(run.result, 'utf8')), exit: run.code };
}

async function seedPersistFixture() {
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
  const env = { ...process.env, PM_DATA_DIR: dataDir, PM_API_TOKEN: 'a3up-seed' };
  const auth = { Authorization: 'Bearer a3up-seed', 'Content-Type': 'application/json' };
  const proc = await spawnServer(env);
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
    fs.writeFileSync(path.join(appData, 'offline-smoke.json'), JSON.stringify({ port: originPort, id: persist.id }));
  } finally {
    await stopServer(proc).catch(() => {});
    await new Promise(r => server.close(() => r()));
  }
}

let pass = 0;
let fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };

const cache = process.env.PM_ALPHA2_SETUP
  || path.join(os.tmpdir(), 'Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe');
if (!fs.existsSync(cache)) {
  throw new Error(`alpha.2 installer not found at ${cache}; set PM_ALPHA2_SETUP or download via gh release download`);
}
const hash = execFileSync('certutil', ['-hashfile', cache, 'SHA256'], { encoding: 'utf8' })
  .split('\n').find(l => /^[0-9a-f]{64}$/i.test(l.trim()))?.trim().toLowerCase();
ok(hash === ALPHA2_SHA, `alpha.2 SHA-256 matches (${hash})`);

for (const p of [installDir, appData]) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

await silentInstall(cache);
const alpha2Exe = path.join(installDir, 'Profile Manager.exe');
ok(fs.existsSync(alpha2Exe), 'alpha.2 installed');

await seedPersistFixture();
ok(fs.existsSync(db), `profiles.db exists (${db})`);
ok(fs.existsSync(path.join(appData, 'offline-smoke.json')), 'offline-smoke marker written');

await silentInstall(alpha3Setup);
const alpha3Exe = path.join(installDir, 'Profile Manager.exe');
ok(fs.existsSync(alpha3Exe), 'alpha.3 installed over alpha.2');

const Database = (await import('better-sqlite3')).default;
const ddb = new Database(db, { readonly: true });
const persistRow = ddb.prepare('SELECT id, name FROM profiles WHERE name = ?').get('Persist');
ok(persistRow?.name === 'Persist', 'Persist profile row survived upgrade');
if (persistRow?.id) {
  ok(fs.existsSync(path.join(dataDir, 'profiles', persistRow.id, 'Default')), 'profile Chromium user-data dir exists after upgrade');
}
ddb.close();

try { execFileSync('taskkill', ['/F', '/IM', 'Profile Manager.exe', '/T'], { stdio: 'ignore' }); } catch { /* none running */ }
await new Promise(r => setTimeout(r, 1500));

const builtVersion = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;
ok(builtVersion === '0.5.0-alpha.3', `CI tree version (${builtVersion})`);
ok(path.basename(alpha3Setup).includes('0.5.0-alpha.3'), `installer artifact name (${path.basename(alpha3Setup)})`);

const schemaV = new Database(db, { readonly: true }).prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get();
ok((schemaV?.v ?? 0) >= 6, `schema_version after upgrade (${schemaV?.v})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

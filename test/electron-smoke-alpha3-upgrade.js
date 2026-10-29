// Windows-only: install alpha.2 EXE, seed profile data, upgrade to alpha.3 EXE in release/, verify preservation.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
if (process.platform !== 'win32') {
  console.error('alpha2→alpha3 upgrade smoke requires Windows');
  process.exit(2);
}

const ALPHA2_URL = process.env.PM_ALPHA2_SETUP_URL
  || 'https://github.com/qadeer-cyber/profile-manager/releases/download/v0.5.0-alpha.2-m1-m9/Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe';
const ALPHA2_SHA = (process.env.PM_ALPHA2_SHA256 || '053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4').toLowerCase();
const alpha3Setup = process.env.PM_ALPHA3_SETUP
  || (() => {
    const exes = fs.readdirSync('release').filter(f => f.endsWith('.exe') && f.includes('offline') && f.includes('Setup'));
    if (exes.length !== 1) throw new Error(`expected one alpha3 setup in release/, found ${exes.length}`);
    return path.resolve('release', exes[0]);
  })();

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Profile Manager');
const appData = path.join(process.env.APPDATA, 'profile-manager');
const db = path.join(appData, 'data', 'profiles.db');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

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

const seedRun = await runPhase(alpha2Exe, 'seed');
const seed = load(seedRun);
ok(seed.exit === 0 && !seed.error, `alpha.2 seed phase (${seed.exit})`);
ok(seed.persist?.wrote === true, 'alpha.2 persisted cookie/localStorage');
ok(fs.existsSync(db), `profiles.db exists (${db})`);

await silentInstall(alpha3Setup);
const alpha3Exe = path.join(installDir, 'Profile Manager.exe');
ok(fs.existsSync(alpha3Exe), 'alpha.3 installed over alpha.2');

const checkRun = await runPhase(alpha3Exe, 'check');
const check = load(checkRun);
ok(check.exit === 0 && !check.error, `alpha.3 check after upgrade (${check.exit})`);
ok(check.saved?.read?.ls === 'pm_v' && String(check.saved?.read?.c || '').includes('pm_c=pm_cookie'),
  `cookies/localStorage survived upgrade (${JSON.stringify(check.saved?.read)})`);

const diagRun = await runPhase(alpha3Exe, 'clean');
const diag = load(diagRun);
ok(diag.clean?.version === '0.5.0-alpha.3', `installed version is 0.5.0-alpha.3 (${diag.clean?.version})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

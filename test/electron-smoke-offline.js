// Offline NSIS install smoke. Separate from test/electron-smoke.js (that file is the standard build).
// Launch the per-user installed exe. Do not set PM_BROWSERS_PATH or PLAYWRIGHT_BROWSERS_PATH.
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { SMOKE_PHASES } from '../electron/smoke-gate.js';

if (process.platform !== 'win32') {
  console.error('This smoke runs on Windows against the installed per-user Profile Manager.');
  process.exit(1);
}

const exe = process.env.PM_OFFLINE_EXE || path.join(process.env.LOCALAPPDATA, 'Programs', 'Profile Manager', 'Profile Manager.exe');
const appData = path.join(process.env.APPDATA, 'profile-manager');
const bundledPrefix = path.join(process.env.LOCALAPPDATA, 'Programs', 'Profile Manager', 'resources', 'browsers') + path.sep;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };

function childEnv(phase, tlsPort) {
  if (!SMOKE_PHASES.includes(phase)) {
    throw new Error(`PM_SMOKE_PHASE must be set explicitly to one of ${SMOKE_PHASES.join(', ')}; got ${phase}`);
  }
  const env = { ...process.env };
  delete env.PM_BROWSERS_PATH;
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  delete env.PM_USER_DATA;
  env.PM_SMOKE = '1';
  env.PM_SMOKE_OFFLINE = '1';
  env.PM_SMOKE_PHASE = phase;
  env.PM_AUTOMATION_DEFAULT = '1';
  env.PM_HEALTH_INTERVAL = '400';
  env.PM_PROXY_LOOPBACK = '1';
  env.PM_PROXY_TEST_INSECURE_TLS = '1';
  env.PLAYWRIGHT_DOWNLOAD_HOST = 'http://127.0.0.1:9';
  env.PM_SMOKE_TLS_PORT = String(tlsPort);
  env.PM_SMOKE_RESULT = path.join(os.tmpdir(), `pm-offline-${phase}.json`);
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '0';
  return env;
}

function runPhase(phase, tlsPort) {
  const env = childEnv(phase, tlsPort);
  console.log(`phase ${phase}: PM_BROWSERS_PATH=${env.PM_BROWSERS_PATH || '(unset)'} PLAYWRIGHT_BROWSERS_PATH=${env.PLAYWRIGHT_BROWSERS_PATH || '(unset)'} PM_AUTOMATION_DEFAULT=${env.PM_AUTOMATION_DEFAULT} PM_PROXY_LOOPBACK=${env.PM_PROXY_LOOPBACK} PM_PROXY_TEST_INSECURE_TLS=${env.PM_PROXY_TEST_INSECURE_TLS}`);
  fs.rmSync(env.PM_SMOKE_RESULT, { force: true });
  return new Promise(resolve => {
    const child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: 'timeout', out, result: env.PM_SMOKE_RESULT }); }, 300000);
    child.on('error', err => { clearTimeout(t); resolve({ code: 'error', out: out + '\n' + err.message, result: env.PM_SMOKE_RESULT }); });
    child.on('exit', code => { clearTimeout(t); resolve({ code, out, result: env.PM_SMOKE_RESULT }); });
  });
}

function load(run) {
  console.log(run.out.split('\n').filter(l => /\[main\]|Error|FAIL|offline smoke/i.test(l)).map(l => '  | ' + l).join('\n'));
  if (!fs.existsSync(run.result)) return { error: 'no result file', exit: run.code };
  return { ...JSON.parse(fs.readFileSync(run.result, 'utf8')), exit: run.code };
}

function chromiumDownloadDirs(dir) {
  const hits = [];
  const walk = (d, depth) => {
    if (depth < 0) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/^chromium-/.test(e.name)) hits.push(path.join(d, e.name));
      else if (e.isDirectory()) walk(path.join(d, e.name), depth - 1);
    }
  };
  walk(dir, 3);
  return hits;
}

function materializeCert(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const pfx = path.join(dir, 'cert.pfx');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], { stdio: 'pipe' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch {
    console.log('openssl unavailable; generating a certificate with New-SelfSignedCertificate');
  }
  const pass = crypto.randomBytes(16).toString('hex');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$ErrorActionPreference = 'Stop'",
    "$cert = New-SelfSignedCertificate -DnsName '127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1)",
    '$pwd = ConvertTo-SecureString -String $env:PM_PFX_PASS -AsPlainText -Force',
    'Export-PfxCertificate -Cert $cert -FilePath $env:PM_PFX_PATH -Password $pwd | Out-Null',
    "Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint)",
  ].join('\n')], { env: { ...process.env, PM_PFX_PASS: pass, PM_PFX_PATH: pfx }, stdio: 'inherit' });
  return { pfx: fs.readFileSync(pfx), passphrase: pass };
}

const norm = p => String(p || '').replaceAll('/', '\\').toLowerCase();
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tls-'));
const tlsServer = https.createServer(materializeCert(certDir), (_req, res) => res.end('no'));
const tlsPort = await new Promise((resolve, reject) => {
  tlsServer.once('error', reject);
  tlsServer.listen(0, '127.0.0.1', () => resolve(tlsServer.address().port));
});
console.log(`bad-cert https server on 127.0.0.1:${tlsPort}`);
try {
const appDataName = path.basename(appData);
ok(appDataName === 'profile-manager', `profile data folder is profile-manager (${appData})`);
ok(!fs.existsSync(path.join(process.env.APPDATA, 'Profile Manager')), 'no %APPDATA%\\Profile Manager directory');
ok(!fs.existsSync(appData), 'clean install has not created %APPDATA%\\profile-manager yet');
const cleanRun = await runPhase('clean', tlsPort);
const clean = load(cleanRun);
ok(clean.exit === 0 && !clean.error, `clean launch exited (${clean.exit})`);
ok(clean.clean?.version === '0.5.0-alpha.1', `installed version is 0.5.0-alpha.1 (${clean.clean?.version})`);
ok(path.basename(clean.clean?.userData || '') === 'profile-manager', `userData is profile-manager (${clean.clean?.userData})`);
ok(clean.clean?.from === 0 && clean.clean?.backup && fs.existsSync(clean.clean.backup), `fresh database was backed up before migration (${clean.clean?.backup})`);
fs.rmSync(appData, { recursive: true, force: true });
execFileSync(exe, [path.resolve('scripts', 'seed-v040-db.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PM_DATA_DIR: path.join(appData, 'data') },
});
const upgradeRun = await runPhase('upgrade', tlsPort);
const upgrade = load(upgradeRun);
ok(upgrade.exit === 0 && !upgrade.error, `upgrade launch exited (${upgrade.exit})`);
ok(upgrade.upgrade?.from === 6 && upgrade.upgrade?.schemaVersion > 6, `v0.4.0 schema migrated (${upgrade.upgrade?.from} -> ${upgrade.upgrade?.schemaVersion})`);
ok(upgrade.upgrade?.backupExists === true, `migration backup exists (${upgrade.upgrade?.backup})`);
ok(upgrade.upgrade?.name === 'Legacy' && upgrade.upgrade?.proxy === true, 'legacy profile and proxy survived');
ok(upgrade.upgrade?.secretError == null && upgrade.upgrade?.hasPassword === true && upgrade.upgrade?.decrypted === true, 'legacy proxy password still decrypts');
ok(upgrade.upgrade?.read?.ls === 'legacy' && String(upgrade.upgrade?.read?.c || '').includes('who=legacy'), `legacy cookie and localStorage survived (${JSON.stringify(upgrade.upgrade?.read)})`);
const launchEnv = childEnv('seed', tlsPort);
ok(launchEnv.PM_AUTOMATION_DEFAULT === '1' && launchEnv.PM_PROXY_LOOPBACK === '1' && launchEnv.PM_PROXY_TEST_INSECURE_TLS === '1', 'installed exe is launched with PM_AUTOMATION_DEFAULT, PM_PROXY_LOOPBACK and PM_PROXY_TEST_INSECURE_TLS set to 1');
ok(!('PM_BROWSERS_PATH' in launchEnv) && !('PLAYWRIGHT_BROWSERS_PATH' in launchEnv), 'PM_BROWSERS_PATH and PLAYWRIGHT_BROWSERS_PATH are unset');
ok(launchEnv.PM_SMOKE_TLS_PORT === String(tlsPort), 'the app is told only the bad-cert port');
const seedRun = await runPhase('seed', tlsPort);
const seed = load(seedRun);
ok(seed.exit === 0 && !seed.error, `seed app exited cleanly (${seed.exit})`);
console.log(`electron ${seed.native?.electron}`);
console.log(`modules ABI ${seed.native?.modules}`);
console.log(`better_sqlite3.node ${seed.native?.path}`);
const nativeRaw = String(seed.native?.path || '');
const native = norm(nativeRaw);
const nativeEnds = native.endsWith('\\better_sqlite3.node');
const unpackedNative = nativeRaw.replace(/app\.asar(?!\.unpacked)/gi, 'app.asar.unpacked');
const sqliteOk = /app\.asar/i.test(nativeRaw)
  ? nativeEnds && fs.existsSync(unpackedNative) && String(seed.native?.modules) === '149'
  : native.includes('\\app.asar.unpacked\\') && nativeEnds;
ok(sqliteOk, `better-sqlite3 loads from app.asar.unpacked (${seed.native?.path}, abi ${seed.native?.modules})`);
ok(seed.browserBefore?.installed === true, 'Chromium is installed before any download attempt');
const exePath = norm(seed.browserBefore?.path);
const prefix = norm(bundledPrefix);
ok(exePath.startsWith(prefix) && exePath.includes(`\\chromium-${seed.revision}\\`), `browser executable is under resources\\browsers\\chromium-${seed.revision} (${seed.browserBefore?.path})`);
ok(seed.headlessShellExists === true, `chromium_headless_shell-${seed.revision} exists (${seed.headlessShell})`);
ok(seed.install?.code === 'ALREADY_INSTALLED' && seed.install?.installed === true && seed.userBrowsersUnchanged === true, 'install endpoint reports already-installed and writes nothing');
ok(seed.bannerBefore === false, 'rendered window has no Download Chromium text before the Launch click');
ok(seed.launchClicked === true, 'Plain profile Launch button was clicked in the window');
ok(seed.bannerAfter === false, 'rendered window has no Download Chromium text after the Launch click');
ok(seed.plain?.status === 200 && seed.plain?.code !== 'CHROMIUM_MISSING' && seed.plain?.error !== 'CHROMIUM_MISSING', `profile launch is not CHROMIUM_MISSING (${seed.plain?.status} ${seed.plain?.error || ''})`);
const launched = norm(seed.plain?.cmd);
ok(seed.plain?.cdp === false && launched.length > 0 && !String(seed.plain?.cmd).includes('--remote-debugging-port'), 'default launch exposes no CDP port with the test flags set');
ok(launched.includes(prefix), `launched browser executable is under resources\\browsers (${seed.plain?.cmd})`);
const bypassArgs = String(seed.plain?.cmd || '').split(/\s+/).filter(a => a === '--proxy-bypass-list=<-loopback>');
ok(bypassArgs.length === 1, `launch args contain exactly one --proxy-bypass-list=<-loopback> (${bypassArgs.length})`);
ok(seed.tls?.ok === false && /cert|self-signed|unable to verify|UNABLE_TO_VERIFY|DEPTH_ZERO|altname|hostname/i.test(seed.tls?.message || ''), `bad TLS certificate is rejected (${seed.tls?.message})`);
ok(seed.auto?.cdp === true && seed.auto?.status === 200, 'explicit automationEnabled profile still gets CDP');
ok(String(seed.auto?.address || '').startsWith('127.0.0.1:'), `automation CDP address is loopback (${seed.auto?.address})`);
ok(seed.persist?.wrote === true && seed.persist?.status === 200, 'profile stored a cookie and localStorage before quit');
const downloaded = chromiumDownloadDirs(appData);
ok(downloaded.length === 0, `no chromium-* directory under %APPDATA%\\profile-manager (${downloaded.join(', ') || 'none'})`);

const checkRun = await runPhase('check', tlsPort);
const check = load(checkRun);
ok(check.exit === 0 && !check.error, `relaunch exited cleanly (${check.exit})`);
ok(check.saved?.profile === true && check.saved?.proxy === true, 'profile and proxy rows survived the graceful quit');
ok(check.saved?.read?.ls === 'pm_v' && String(check.saved?.read?.c || '').includes('pm_c=pm_cookie'), `cookie and localStorage survived relaunch (${JSON.stringify(check.saved?.read)})`);

const lifeRun = await runPhase('lifecycle', tlsPort);
const life = load(lifeRun);
ok(life.exit === 0 && !life.error, `lifecycle launch exited (${life.exit})`);
ok(life.lifecycle?.close?.running === false && !life.lifecycle?.close?.error, `window close is Stopped (${life.lifecycle?.close?.error})`);
ok(life.lifecycle?.kill?.running === false && /unexpectedly|died|exit code|signal|Crashed/i.test(life.lifecycle?.kill?.error || ''), `taskkill is Error (${life.lifecycle?.kill?.error})`);
ok(life.lifecycle?.restart?.running === true && !life.lifecycle?.restart?.error, `relaunch after kill is running with no error (${life.lifecycle?.restart?.error})`);

console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  tlsServer.close();
  fs.rmSync(certDir, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);

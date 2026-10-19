// Electron smoke test: runs the real desktop app (under xvfb on Linux) in smoke mode, then checks
// security settings, in-process backend, profile launch, safe shutdown, and takes screenshots.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { migrations } from '../server/migrations.js';

const require = createRequire(import.meta.url);
// PM_APP_EXE=path runs a packaged build instead of the dev app (e.g. release/linux-unpacked/profile-manager)
// The electron package (v44) has no postinstall, so npm ci does not extract dist/electron.exe.
// require('electron') downloads that binary and returns its real path.
const packaged = process.env.PM_APP_EXE;
const electron = packaged ? path.resolve(packaged) : require('electron');
const userData = process.env.PM_SMOKE_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'pm-electron-'));
const result = path.join(userData, 'smoke-result.json');
const shot = path.resolve(packaged ? path.join(userData, 'shot.png') : 'screenshot-electron.png');
const args = [electron, ...(packaged ? [] : ['.']), ...(process.env.PM_SMOKE_ARGS ? process.env.PM_SMOKE_ARGS.split(' ') : []), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
const cmd = process.platform === 'linux' && !process.env.DISPLAY ? 'xvfb-run' : args.shift();
const finalArgs = cmd === 'xvfb-run' ? ['-a', '-s', '-screen 0 1440x900x24', ...args] : args;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

const t0 = Date.now();
const smokeEnv = { ...process.env, PM_SMOKE: '1', PM_USER_DATA: userData, PM_SMOKE_RESULT: result, PM_SMOKE_SCREENSHOT: shot, ...(packaged && { PM_BROWSERS_PATH: path.join(userData, 'browsers') }), ELECTRON_DISABLE_SECURITY_WARNINGS: '0' };
delete smokeEnv.PM_SMOKE_OFFLINE;
delete smokeEnv.PM_SMOKE_PHASE;
const child = spawn(cmd, finalArgs, { env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
child.on('error', err => { out += '\n' + (err.stack || err.message); });
const code = await new Promise(r => { const t = setTimeout(() => { child.kill('SIGKILL'); r('timeout'); }, packaged ? 600000 : 90000); child.on('exit', c => { clearTimeout(t); r(c); }); });
console.log(out.split('\n').filter(l => /\[main\]|Error|WARN/i.test(l)).map(l => '  | ' + l).join('\n'));
ok(code === 0, `app exited cleanly after quit (code ${code}, ${Date.now() - t0} ms)`);
const r = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8')) : { error: 'no result file' };
if (r.error) console.log(r.error);
ok(!r.error, 'smoke script completed');
ok(r.unauthorized === 401, 'backend rejects UI API calls without the per-session token');
ok(r.webPreferences?.contextIsolation === true && r.webPreferences?.nodeIntegration === false && r.webPreferences?.sandbox === true, 'contextIsolation on, nodeIntegration off, sandbox on');
ok(r.renderer?.require === 'undefined' && r.renderer?.process === 'undefined' && r.renderer?.pmBridge === 'object', 'renderer has no Node globals; preload bridge present');
ok(r.renderer?.rows >= 3, `UI rendered the profile table (${r.renderer?.rows} rows)`);
ok(r.launch?.status === 200 && r.launch?.running && r.launch?.pid, 'profile launched from the desktop app');
ok(r.launch?.cdpExposed === false, 'desktop launch without automation exposes no CDP endpoint (top-level pid only)');
ok(r.launch?.pid && !alive(r.launch.pid), 'safe shutdown on quit: launched browser is gone');
ok(r.diagnostics?.versions?.electron && r.diagnostics.dataDir.startsWith(userData), `backend runs in-process in Electron ${r.diagnostics?.versions?.electron}; data in userData`);
ok(r.diagnostics?.schemaVersion === migrations.at(-1).version, 'database migrated in desktop mode');
const enc = r.diagnostics?.encryption || {};
ok((enc.backend === 'electron-safeStorage' && r.storedSecretPrefix === 'ss:v1:') || (enc.backend === 'aes-256-gcm-keyfile' && enc.warning && r.storedSecretPrefix === 'enc:v1:'),
  `secret storage: ${enc.backend} (stored as ${r.storedSecretPrefix})${enc.warning ? ' — fallback warning: ' + enc.warning : ''}`);
ok(fs.existsSync(shot) && fs.statSync(shot).size > 10000, `screenshot -> ${shot}`);
if (packaged) {
  ok(r.browserBefore && !r.browserBefore.installed, 'packaged app started without Chromium (fresh browsers folder)');
  ok(r.browserAfter?.installed && r.browserAfter.path.startsWith(path.join(userData, 'browsers')), `first-run Chromium download into userData succeeded (${r.browserAfter?.path})`);
}
ok(r.secretErrors === 0, 'all stored proxy secrets decrypt');
const db = path.join(userData, 'data', 'profiles.db');
ok(fs.existsSync(db), 'database stored under app userData');
console.log(`\n${pass} passed, ${fail} failed`);
if (!process.env.PM_SMOKE_USERDATA) fs.rmSync(userData, { recursive: true, force: true });
fs.writeFileSync(path.join(os.tmpdir(), 'pm-last-smoke.json'), JSON.stringify(r));
process.exit(fail ? 1 : 0);

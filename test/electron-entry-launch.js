// Packaged entry is package.json "main" (electron/main.js), the file electron-builder ships.
// A user launch sets no smoke env. It must come up and must not reject a missing phase.
// An offline smoke launch with a bad phase must write the result file and exit non-zero
// before the backend starts, well inside the harness timeout.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };

function kill(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch {} }
}

function launch(extra) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-entry-'));
  const env = { ...process.env, ...extra, PM_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '0' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PM_SMOKE') && !(key in extra)) delete env[key];
  }
  const args = [electron, '.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const cmd = useXvfb ? 'xvfb-run' : args.shift();
  const finalArgs = useXvfb ? ['-a', '-s', '-screen 0 1440x900x24', ...args] : args;
  const child = spawn(cmd, finalArgs, { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const exited = new Promise(resolve => {
    child.on('exit', code => resolve(code));
    child.on('error', err => { out += `\n${err.message}`; resolve('error'); });
  });
  return {
    userData,
    child,
    exited,
    output: () => `${out}\n${readLog(userData)}`,
  };
}

function readLog(userData) {
  try { return fs.readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8'); } catch { return ''; }
}

async function waitFor(run, pred, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = pred(run.output(), run.child.exitCode);
    if (hit) return hit;
    await Promise.race([run.exited, new Promise(r => setTimeout(r, 100))]);
  }
  return 'timeout';
}

ok(pkg.main === 'electron/main.js', `packaged entry is ${pkg.main}`);

const normal = launch({});
try {
  const saw = await waitFor(normal, (text, code) => {
    if (/PM_SMOKE_PHASE must be one of/.test(text)) return 'rejected';
    if (/backend on /.test(text)) return 'up';
    if (code !== null) return `exit ${code}`;
    return '';
  }, 60000);
  ok(saw === 'up', `normal launch reached the backend (${saw})`);
  await new Promise(r => setTimeout(r, 1000));
  ok(normal.child.exitCode === null, `normal launch stays running (code ${normal.child.exitCode})`);
  ok(!/PM_SMOKE_PHASE must be one of/.test(normal.output()), 'normal launch does not reject a missing phase');
} finally {
  kill(normal.child);
  await Promise.race([normal.exited, new Promise(r => setTimeout(r, 3000))]);
  fs.rmSync(normal.userData, { recursive: true, force: true });
}
if (fail) console.log(normal.output().split('\n').slice(-40).join('\n'));

for (const phase of [undefined, 'seeded']) {
  const result = path.join(os.tmpdir(), `pm-bad-phase-${phase || 'missing'}-${process.pid}.json`);
  fs.rmSync(result, { force: true });
  const extra = { PM_SMOKE: '1', PM_SMOKE_OFFLINE: '1', PM_SMOKE_RESULT: result };
  if (phase) extra.PM_SMOKE_PHASE = phase;
  const run = launch(extra);
  const t0 = Date.now();
  let code;
  try {
    code = await Promise.race([
      run.exited,
      new Promise(resolve => setTimeout(() => resolve('timeout'), 45000)),
    ]);
  } finally {
    kill(run.child);
    await Promise.race([run.exited, new Promise(r => setTimeout(r, 3000))]);
  }
  const elapsed = Date.now() - t0;
  const label = phase || '(missing)';
  ok(code === 1, `bad phase ${label} exits 1 (code ${code}, ${elapsed} ms)`);
  ok(elapsed < 45000, `bad phase ${label} fails inside 45s, not the harness timeout`);
  let body = null;
  try { body = JSON.parse(fs.readFileSync(result, 'utf8')); } catch {}
  ok(body && body.phase === (phase ?? null), `bad phase ${label} result names the phase (${body && body.phase})`);
  ok(body && /PM_SMOKE_PHASE must be one of clean, upgrade, seed, check, lifecycle/.test(body.error || ''), `bad phase ${label} result explains the rejection (${body && body.error})`);
  ok(!/backend on /.test(run.output()), `bad phase ${label} does not start the backend`);
  fs.rmSync(result, { force: true });
  fs.rmSync(run.userData, { recursive: true, force: true });
  if (!body || code !== 1) console.log(run.output().split('\n').slice(-30).join('\n'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

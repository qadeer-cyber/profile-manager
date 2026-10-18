// Port helpers for tests: every server listens on an OS-assigned free port (port 0) unless an
// env override is given (e.g. PM_TEST_PORT=4000), so parallel runs on a shared machine can't collide.
import net from 'net';
import path from 'path';
import { execFileSync, fork } from 'child_process';
import { fileURLToPath } from 'url';

const serverScript = path.resolve(fileURLToPath(new URL('../server/index.js', import.meta.url)));
const tracked = new Set();
const SHUTDOWN_ACK_MS = 15000;
let missedShutdownAcks = 0;
// Suites add this to their failure count. A missing shutdown-done must fail CI even if later asserts pass.
export function missedGracefulShutdowns() { return missedShutdownAcks; }

function exited(proc) { return !proc || proc.exitCode !== null || proc.signalCode != null; }

// Windows: taskkill /T /F kills the process tree. Elsewhere, signal the process group
// (the child is started detached so it is the group leader) and fall back to the pid.
export function hardKill(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 20000 }); } catch {}
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); return; } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

export function trackProcess(proc) {
  if (!proc) return proc;
  tracked.add(proc);
  proc.once('exit', () => tracked.delete(proc));
  return proc;
}

export function killTracked() {
  for (const proc of [...tracked]) if (!exited(proc)) hardKill(proc.pid);
}

// unref'd backstop so a hung suite cannot keep CI alive. Kills every tracked child tree, then exits.
export function armWatchdog(ms = 15 * 60 * 1000, { beforeExit } = {}) {
  const t = setTimeout(() => {
    console.error(`watchdog: tests exceeded ${ms}ms; killing child trees`);
    const killAndExit = () => { killTracked(); process.exit(1); };
    const force = setTimeout(killAndExit, 8000);
    force.unref();
    Promise.resolve().then(() => beforeExit?.()).catch(err => console.error(err)).finally(killAndExit);
  }, ms);
  t.unref();
  return t;
}

// Listen `server` on process.env[envName] (if set) or port 0; resolves to the actual port.
export function listenFree(server, envName) {
  const want = Number(envName && process.env[envName] || 0);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(want, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
  });
}
// A free port for a process we don't control (e.g. Chromium --remote-debugging-port). Small race by nature.
export function freePort(envName) {
  if (envName && process.env[envName]) return Promise.resolve(Number(process.env[envName]));
  return new Promise((res, rej) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }).on('error', rej); });
}

// Fork server/index.js so the parent can request a graceful IPC shutdown. On Windows,
// child.kill('SIGTERM') is TerminateProcess: signal handlers never run and Chromium is
// torn down before it can flush cookies. POSIX children are process-group leaders so
// the fallback kill covers browsers they spawned.
export function spawnServer(env, { envName = 'PM_TEST_PORT', port, echo = false, timeoutMs = 20000 } = {}) {
  const PORT = String(port ?? (process.env[envName] || 0));
  const proc = trackProcess(fork(serverScript, [], {
    execArgv: [],
    env: { ...env, PORT },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  }));
  proc.out = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { hardKill(proc.pid); reject(new Error('server start timeout')); }, timeoutMs);
    proc.stdout.on('data', d => {
      proc.out += d; if (echo) process.stdout.write('  [srv] ' + d);
      const m = proc.out.match(/Profile manager on (http:\/\/[^\s]+)/);
      if (m && !proc.url) { clearTimeout(t); proc.url = m[1]; proc.port = Number(new URL(m[1]).port); resolve(proc); }
    });
    proc.on('exit', c => { clearTimeout(t); if (!proc.url) reject(new Error('server exited before start: ' + c + '\n' + proc.out)); });
  });
}

function isShutdownDone(m) { return !!(m && typeof m === 'object' && m.type === 'shutdown-done'); }

// Parent sends {type:'shutdown'}. Success is {type:'shutdown-done'} and exit 0 within timeoutMs
// (15s). Anything else is a test failure, then the tree is killed so cleanup cannot hang.
export function stopServer(proc, { timeoutMs = SHUTDOWN_ACK_MS } = {}) {
  if (!proc || exited(proc)) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false, gotDone = false, grace, afterKill;
    const finish = (graceful) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      clearTimeout(afterKill);
      proc.off('message', onMsg);
      if (!graceful) {
        missedShutdownAcks++;
        console.error(gotDone
          ? `FAIL graceful shutdown: pid ${proc.pid} acknowledged shutdown but did not exit 0 within ${timeoutMs}ms`
          : `FAIL graceful shutdown: shutdown-done not received from pid ${proc.pid} within ${timeoutMs}ms`);
        hardKill(proc.pid);
      }
      resolve(graceful);
    };
    const onMsg = m => {
      if (isShutdownDone(m)) gotDone = true;
      if (gotDone && exited(proc) && proc.exitCode === 0) finish(true);
    };
    proc.on('message', onMsg);
    proc.once('exit', code => {
      const decide = () => { if (!settled) finish(gotDone && code === 0); };
      // The ack is written just before exit; give IPC a moment to land first.
      if (gotDone) decide();
      else setTimeout(decide, 500);
    });
    if (exited(proc)) return finish(gotDone && proc.exitCode === 0);
    let sent = false;
    try {
      if (typeof proc.send === 'function' && proc.connected) { proc.send({ type: 'shutdown' }); sent = true; }
    } catch { sent = false; }
    const killThenFail = () => {
      if (settled) return;
      hardKill(proc.pid);
      afterKill = setTimeout(() => finish(false), 5000);
    };
    if (!sent) { killThenFail(); return; }
    grace = setTimeout(() => {
      if (settled) return;
      if (!(gotDone && exited(proc) && proc.exitCode === 0)) killThenFail();
    }, timeoutMs);
  });
}

// Hard crash (no IPC). Used where a test must leave running rows behind for startup recovery.
export function killServer(proc, { timeoutMs = 5000 } = {}) {
  if (exited(proc)) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false, grace, afterKill;
    const finish = () => { if (settled) return; settled = true; clearTimeout(grace); clearTimeout(afterKill); resolve(); };
    proc.once('exit', finish);
    if (exited(proc)) return finish();
    try { proc.kill('SIGKILL'); } catch {}
    grace = setTimeout(() => {
      if (settled) return;
      hardKill(proc.pid);
      afterKill = setTimeout(finish, 5000);
    }, timeoutMs);
  });
}

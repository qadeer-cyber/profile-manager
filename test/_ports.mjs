// Port helpers for tests: every server listens on an OS-assigned free port (port 0) unless an
// env override is given (e.g. PM_TEST_PORT=4000), so parallel runs on a shared machine can't collide.
import net from 'net';
import { spawn } from 'child_process';

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
// Spawn server/index.js with PORT=<override or 0> and read the actual URL from its startup line.
export function spawnServer(env, { envName = 'PM_TEST_PORT', port, echo = false, timeoutMs = 20000 } = {}) {
  const PORT = String(port ?? (process.env[envName] || 0));
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
  proc.out = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('server start timeout')); }, timeoutMs);
    proc.stdout.on('data', d => {
      proc.out += d; if (echo) process.stdout.write('  [srv] ' + d);
      const m = proc.out.match(/Profile manager on (http:\/\/[^\s]+)/);
      if (m && !proc.url) { clearTimeout(t); proc.url = m[1]; proc.port = Number(new URL(m[1]).port); resolve(proc); }
    });
    proc.on('exit', c => { clearTimeout(t); if (!proc.url) reject(new Error('server exited before start: ' + c + '\n' + proc.out)); });
  });
}

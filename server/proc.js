// Cross-platform process helpers: liveness, command-line lookup (PID-reuse guard) and tree kill.
import fs from 'fs';
import { execFile } from 'child_process';

export function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (exec, cmd, args) => new Promise(res => exec(cmd, args, { windowsHide: true, timeout: 8000 }, (err, out) => res(err ? null : String(out))));

// Full command line of a live process, or null if it can't be read (dead, no permission, unsupported).
// Linux: /proc/<pid>/cmdline. Windows: CIM Win32_Process (PowerShell), falling back to wmic. macOS: ps.
export async function processCommandLine(pid, { platform = process.platform, exec = execFile } = {}) {
  if (!pid || !Number.isInteger(Number(pid))) return null;
  pid = Number(pid);
  if (platform === 'linux') {
    try { const s = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '').split('\0').join(' '); return s || null; } catch { return null; }
  }
  if (platform === 'win32') {
    let out = await run(exec, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
    if (out == null || !out.trim()) {
      const w = await run(exec, 'wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value']);
      const m = w && w.match(/CommandLine=(.*)/); out = m ? m[1] : null;
    }
    return out && out.trim() ? out.trim() : null;
  }
  const out = await run(exec, 'ps', ['-o', 'command=', '-p', String(pid)]);
  return out && out.trim() ? out.trim() : null;
}

const norm = (s, platform) => { s = String(s).replace(/\\/g, '/').replace(/"/g, ''); return platform === 'win32' ? s.toLowerCase() : s; };
// PID-reuse guard: true only if pid is alive AND its command line contains `needle`
// (we pass the profile's user-data-dir). Unreadable command line => false (never kill on doubt).
export async function pidMatches(pid, needle, opts = {}) {
  const platform = opts.platform || process.platform;
  if (!needle || !(opts.alive || isAlive)(pid)) return false;
  const cl = await processCommandLine(pid, opts);
  if (!cl) return false;
  const hay = norm(cl, platform), n = norm(needle, platform).replace(/\/+$/, '');
  // Require a boundary after the match so /profiles/abc does not match /profiles/abcd.
  for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + 1)) if (!/[\w.-]/.test(hay[i + n.length] || '')) return true;
  return false;
}

// Kill a process and its children; resolves true only once the root pid is verified gone.
// Windows: taskkill /T /F (immediate), then poll. POSIX: SIGTERM, SIGKILL after graceMs, then poll.
// opts.expect: if set, the pid must still match it (see pidMatches) or nothing is killed (returns false).
export async function killTree(pid, { graceMs = 2000, waitMs = 5000, platform = process.platform, exec = execFile, alive = isAlive, expect } = {}) {
  if (!pid) return false;
  if (expect && !(await pidMatches(pid, expect, { platform, exec, alive }))) return false;
  const waitGone = async ms => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!alive(pid)) return true; await sleep(100); } return !alive(pid); };
  if (platform === 'win32') {
    // Exit code 128 = "process not found" (already gone): still verified by polling below.
    await new Promise(res => exec('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()));
    if (await waitGone(waitMs)) return true;
    await new Promise(res => exec('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, () => res())); // retry root only
    return waitGone(1000);
  }
  if (!alive(pid)) return true;
  try { process.kill(pid, 'SIGTERM'); } catch { return !alive(pid); }
  if (await waitGone(graceMs)) return true;
  try { process.kill(pid, 'SIGKILL'); } catch {}
  return waitGone(Math.max(1000, waitMs - graceMs));
}

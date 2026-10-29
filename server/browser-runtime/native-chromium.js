// Independently spawned Chromium for ordinary manual browsing (no Playwright control pipe).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { pidMatches, isAlive } from '../proc.js';

const FORBIDDEN_NATIVE = ['--remote-debugging-pipe', '--enable-automation', '--headless'];

export function assertNativeLaunchArgs(args) {
  for (const a of args) {
    const flag = String(a).split('=')[0];
    if (FORBIDDEN_NATIVE.includes(flag)) {
      throw Object.assign(new Error(`Native manual launch must not include ${flag}`), { status: 500, code: 'NATIVE_LAUNCH_FORBIDDEN_ARG' });
    }
  }
}

export function nativeArgv(plan) {
  assertNativeLaunchArgs(plan.args);
  const argv = [...plan.args, `--user-data-dir=${plan.dir}`];
  for (const u of plan.openUrls || []) {
    if (typeof u === 'string' && u.trim()) argv.push(u.trim());
  }
  return argv;
}

export async function discoverOwnedBrowserPid(userDataDir, candidates, { timeoutMs = 15000, pollMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const tried = new Set();
  while (Date.now() < deadline) {
    for (const pid of candidates) {
      if (!pid || tried.has(pid)) continue;
      if (await pidMatches(pid, userDataDir)) return pid;
    }
    await new Promise(r => setTimeout(r, pollMs));
    for (const pid of candidates) {
      if (pid && isAlive(pid)) tried.add(pid);
    }
  }
  for (const pid of candidates) {
    if (pid && (await pidMatches(pid, userDataDir))) return pid;
  }
  return candidates.find(p => p && isAlive(p)) ?? null;
}

export async function launchNativeChromium(plan) {
  const exe = plan.executablePath;
  if (!exe) throw Object.assign(new Error('Chromium executable path is missing'), { status: 503, code: 'CHROMIUM_MISSING' });
  const argv = nativeArgv(plan);
  const proc = spawn(exe, argv, { stdio: 'ignore', windowsHide: false, detached: false });
  if (!proc.pid) throw Object.assign(new Error('Failed to spawn Chromium'), { status: 500, code: 'NATIVE_SPAWN_FAILED' });
  const browserPid = await discoverOwnedBrowserPid(plan.dir, [proc.pid]);
  return { proc, browserPid, argv, spawnPid: proc.pid };
}

export function defaultChromiumExecutable() {
  try { return chromium.executablePath(); } catch { return null; }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { freePort, trackProcess, hardKill } from './_ports.mjs';

export async function startChromiumCdpFixture(t, { url = 'about:blank' } = {}) {
  const exe = chromium.executablePath();
  if (!fs.existsSync(exe)) throw new Error('Pinned Chromium is unavailable; install it with npx playwright install chromium');
  const port = await freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cdp-fixture-'));
  let spawnError, stderr = '';
  const proc = trackProcess(spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []), url], { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true }));
  proc.on('error', e => { spawnError = e; });
  proc.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  const closed = new Promise(resolve => proc.once('close', resolve));
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      hardKill(proc.pid); let timer;
      try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Chromium fixture cleanup timed out')), 5000); })]); }
      finally { clearTimeout(timer); }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const endpoint = `http://127.0.0.1:${port}`, deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (proc.exitCode !== null || proc.signalCode !== null) throw Error(`Chromium fixture exited before CDP readiness: ${stderr}`);
    try {
      const response = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
      const version = await response.json();
      if (response.ok && typeof version.webSocketDebuggerUrl === 'string') return { port, endpoint };
    } catch { /* bounded polling; exit and spawn errors checked above */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Chromium fixture did not publish a CDP endpoint: ${stderr}`);
}

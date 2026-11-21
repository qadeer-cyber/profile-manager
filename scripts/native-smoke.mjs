// Fresh-runner smoke test for a built browser (experimental AZWAH native Chromium). No external websites:
// a local HTTP server serves a page that writes localStorage and reports back. Steps, each timed:
//   1. <chrome> --version          2. launch with a temporary profile, page loads and reports
//   3. graceful close, process exits   4. relaunch the same profile, the stored value is still there
//   5. temporary profile removed
// Prints one SMOKE_RESULT JSON line; exit 0 only when every step passed. No cookies or profile contents are
// logged. A pass shows the binary starts, renders a page, keeps profile data and exits; nothing more.
//
//   node scripts/native-smoke.mjs <path to chrome.exe> [--expect-version 159.0.8153.0] [--headless] [--chrome-arg <switch>] [--settle-ms 3000]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';

export async function smoke(chrome, { expectVersion = null, headless = false, timeoutMs = 60000, extraArgs = [], settleMs = 3000 } = {}) {
  const steps = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, ...(detail && { detail }) }); return true; }
    catch (error) { steps.push({ name, ok: false, ms: Date.now() - t0, error: String(error.message || error).slice(0, 300) }); return false; }
  };
  const reports = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/report') { reports.set(u.searchParams.get('key'), u.searchParams.get('value')); res.end('ok'); return; }
    const key = u.pathname.slice(1).replace(/[^a-z0-9-]/g, '');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(`<title>smoke</title><script>
const before = localStorage.getItem('azwah-smoke');
if (!before) localStorage.setItem('azwah-smoke', 'kept');
fetch('/report?key=${key}&value=' + encodeURIComponent(before || 'new'));</script>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-native-smoke-'));
  const baseArgs = [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : []), ...extraArgs];
  const waitReport = async key => { for (let t = Date.now(); Date.now() - t < timeoutMs;) { if (reports.has(key)) return reports.get(key); await new Promise(r => setTimeout(r, 200)); } throw new Error(`no report for ${key}`); };
  const launch = url => spawn(chrome, [...baseArgs, url], { stdio: 'ignore', windowsHide: false });
  const closeGracefully = child => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('browser did not exit within 20 s of a graceful close')), 20000);
    child.once('exit', code => { clearTimeout(timer); resolve({ exitCode: code }); });
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid)], () => {}); // WM_CLOSE, no /F
    else child.kill('SIGTERM');
  });
  let child = null;
  try {
    await step('version', () => {
      const r = spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 30000 });
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
      // On Windows chrome.exe --version may print nothing; the file version is then the evidence.
      if (expectVersion && out && !out.includes(expectVersion)) throw new Error(`version "${out}" does not contain ${expectVersion}`);
      return { reported: out || null };
    });
    // settleMs: time between the page reporting and the close, like a person closing a window a moment later.
    // Without it, Linux SIGTERM exits before Chromium writes localStorage (seen locally on Chromium 153).
    const first = await step('launch and load page', async () => {
      child = launch(`${origin}/first`);
      const value = await waitReport('first');
      await new Promise(r => setTimeout(r, settleMs));
      return { value, settleMs };
    });
    if (first) await step('graceful close', async () => { const r = await closeGracefully(child); child = null; return r; });
    if (first) await step('relaunch keeps profile data', async () => {
      // Let the previous instance's helper processes and profile lock go before relaunching.
      await new Promise(r => setTimeout(r, 2000));
      child = launch(`${origin}/second`);
      const value = await waitReport('second');
      if (value !== 'kept') throw new Error(`stored value after restart was "${value}"`);
      await new Promise(r => setTimeout(r, settleMs));
      const r = await closeGracefully(child); child = null;
      return { value, ...r };
    });
  } finally {
    if (child) { try { child.kill('SIGKILL'); } catch {} await new Promise(r => setTimeout(r, 2000)); }
    server.close();
    await step('remove temporary profile', () => { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });
  }
  return { ok: steps.every(s => s.ok) && steps.length >= 5, platform: process.platform, steps };
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  // --chrome-arg passes one extra switch (repeatable), e.g. --no-sandbox for a local Linux root harness check only.
  const extraArgs = args.flatMap((a, i) => (a === '--chrome-arg' && args[i + 1] ? [args[i + 1]] : []));
  const result = await smoke(args[0], { expectVersion: at('--expect-version'), headless: args.includes('--headless'), extraArgs, ...(at('--settle-ms') && { settleMs: Number(at('--settle-ms')) }) });
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

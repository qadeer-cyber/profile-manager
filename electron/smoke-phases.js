// Phase dispatch for the packaged offline smoke. No Electron import: unit tests call this directly.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { MANIFEST } from '../server/chromium.js';
import { processCommandLine } from '../server/proc.js';
import { selectSmokePhase } from './smoke-gate.js';

export { SMOKE_PHASES, selectSmokePhase, classifyLaunch, writeSmokeRejection } from './smoke-gate.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const closeServer = server => new Promise(resolve => server.close(() => resolve()));
const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address().port));
});

function nativeModulePath() {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
  return Object.keys(require.cache).find(p => p.includes('better-sqlite3') && p.endsWith('.node')) || '';
}

// handlers is the explicit table { clean, upgrade, seed, check, lifecycle }.
export async function dispatchSmokePhase(phase, handlers) {
  const name = selectSmokePhase(phase);
  const fn = handlers?.[name];
  if (typeof fn !== 'function') throw new Error(`no handler for smoke phase ${name}`);
  const body = await fn();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`smoke phase ${name} returned no result object`);
  return { phase: name, ...body };
}

export function phaseHandlers(ctx) {
  return {
    clean: () => runCleanPhase(ctx),
    upgrade: () => runUpgradePhase(ctx),
    seed: () => runSeedPhase(ctx),
    check: () => runCheckPhase(ctx),
    lifecycle: () => runLifecyclePhase(ctx),
  };
}

export function createSmokeContext({ backend, win, uiToken, userData, log, env = process.env } = {}) {
  const H = { 'Content-Type': 'application/json', 'X-UI-Token': uiToken };
  const call = async (m, u, b) => {
    const res = await fetch(backend.url + u, { method: m, headers: H, body: b && JSON.stringify(b) });
    return { s: res.status, d: await res.json().catch(() => null) };
  };
  return {
    call, win, userData, log, env, fs, sleep, listen, http, path,
    backendUrl: backend?.url || '',
    dataDir: env.PM_DATA_DIR,
    nativeModulePath, processCommandLine, manifest: MANIFEST,
    execPath: process.execPath,
    taskkill: pid => new Promise((resolve, reject) => {
      execFile('taskkill', ['/F', '/PID', String(pid)], err => err ? reject(err) : resolve());
    }),
    closeLastWindow: closeLastPage,
    readExitType: id => readProfileExitType(env.PM_DATA_DIR, id),
    listeningPorts: listeningTcpPorts,
    proxyPassword: async name => {
      const { db } = await import('../server/db.js');
      return db.prepare('SELECT password FROM proxies WHERE name=?').get(name)?.password ?? null;
    },
    decrypt: async ciphertext => {
      const { decrypt } = await import('../server/secrets.js');
      return decrypt(ciphertext);
    },
  };
}

function cdpRequest(wsUrl, method, params, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => {
      try { ws?.close(); } catch {}
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);
    const finish = (err, result) => {
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      if (err) reject(err);
      else resolve(result || {});
    };
    try { ws = new WebSocket(wsUrl); }
    catch (err) { finish(err); return; }
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ id: 1, method, params: params || {} })); }
      catch (err) { finish(err); }
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id !== 1) return;
      if (msg.error) finish(new Error(msg.error.message || method));
      else finish(null, msg.result || {});
    };
    ws.onerror = () => finish(new Error(`CDP ${method} socket error`));
  });
}

// Close every page target. The last page is the window close: Chromium exits on its
// own and writes exit_type Normal. Browser.close is the app-quit path and is not used here.
export async function closeLastPage(wsUrl) {
  const listed = await cdpRequest(wsUrl, 'Target.getTargets', {});
  const pages = (listed.targetInfos || []).filter(t => t.type === 'page' && t.targetId);
  if (!pages.length) throw new Error('last-window close found no page target');
  let closed = 0;
  for (const page of pages) {
    try {
      const result = await cdpRequest(wsUrl, 'Target.closeTarget', { targetId: page.targetId });
      if (result.success === false) throw new Error('Target.closeTarget rejected the page');
      closed += 1;
    } catch (err) {
      if (closed === 0) throw err;
    }
  }
  return { method: 'last-window', closed };
}

async function readProfileExitType(dataDir, id) {
  if (!dataDir || !id) return null;
  const file = path.join(dataDir, 'profiles', id, 'Default', 'Preferences');
  let last = null;
  for (let i = 0; i < 30; i++) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.exit_type;
      if (typeof value === 'string' && value) last = value;
      if (last === 'Normal') return last;
    } catch {}
    await sleep(100);
  }
  return last;
}

const execText = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out)));
});

export function portsFromNetstat(text, pids) {
  const want = new Set((pids || []).map(p => String(p)));
  const ports = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'TCP' || String(parts[3] || '').toUpperCase() !== 'LISTENING') continue;
    if (!want.has(parts[4])) continue;
    const port = Number(String(parts[1] || '').slice(String(parts[1] || '').lastIndexOf(':') + 1));
    if (port) ports.add(port);
  }
  return [...ports];
}

export function portsFromProcNet(text, inodes) {
  const ports = new Set();
  for (const line of String(text).trim().split('\n').slice(1)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts[3] !== '0A' || !inodes.has(parts[9])) continue;
    const local = parts[1] || '';
    const port = parseInt(local.slice(local.lastIndexOf(':') + 1), 16);
    if (port) ports.add(port);
  }
  return [...ports];
}

function procDescendants(root) {
  const parent = new Map();
  let ents = [];
  try { ents = fs.readdirSync('/proc'); } catch { return new Set([Number(root)]); }
  for (const ent of ents) {
    if (!/^\d+$/.test(ent)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${ent}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parent.set(Number(ent), Number(rest[1]));
    } catch {}
  }
  const out = new Set([Number(root)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of parent) {
      if (out.has(ppid) && !out.has(pid)) { out.add(pid); grew = true; }
    }
  }
  return out;
}

function socketInodes(pids) {
  const inodes = new Set();
  for (const pid of pids) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      try {
        const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join('/proc', String(pid), 'fd', fd)));
        if (m) inodes.add(m[1]);
      } catch {}
    }
  }
  return inodes;
}

async function windowsProcessTree(pid) {
  const script = `$root=${Number(pid)}; $all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId); $want=New-Object System.Collections.Generic.List[int]; $want.Add($root); $changed=$true; while ($changed) { $changed=$false; foreach ($p in $all) { if ($null -eq $p.ProcessId) { continue }; $id=[int]$p.ProcessId; $parent=[int]$p.ParentProcessId; if ($want.Contains($parent) -and -not $want.Contains($id)) { [void]$want.Add($id); $changed=$true } } }; $want -join ','`;
  const out = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const ids = out.split(/[^0-9]+/).map(Number).filter(n => n > 0);
  return ids.length ? ids : [Number(pid)];
}

export async function listeningTcpPorts(pid) {
  const root = Number(pid);
  if (!root) return [];
  if (process.platform === 'win32') {
    const [text, tree] = await Promise.all([execText('netstat', ['-ano', '-p', 'tcp']), windowsProcessTree(root)]);
    return portsFromNetstat(text, tree);
  }
  const inodes = socketInodes(procDescendants(root));
  const tcp = fs.existsSync('/proc/net/tcp') ? fs.readFileSync('/proc/net/tcp', 'utf8') : '';
  const tcp6 = fs.existsSync('/proc/net/tcp6') ? fs.readFileSync('/proc/net/tcp6', 'utf8') : '';
  return [...new Set([...portsFromProcNet(tcp, inodes), ...portsFromProcNet(tcp6, inodes)])];
}

async function pageText(win) {
  return win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
}
async function waitForPlainLaunch(win) {
  for (let i = 0; i < 40; i++) {
    const ready = await win.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('tbody tr')].find(tr => (tr.querySelector('.name') || {}).textContent === 'Plain');
      return !!row && [...row.querySelectorAll('button')].some(b => b.textContent.includes('Launch'));
    })()`);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}
function clickPlainLaunch(win) {
  return win.webContents.executeJavaScript(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find(tr => (tr.querySelector('.name') || {}).textContent === 'Plain');
    const btn = row && [...row.querySelectorAll('button')].find(b => b.textContent.includes('Launch'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

export async function commonSmokeFacts(ctx) {
  const nativePath = ctx.nativeModulePath();
  ctx.log(`process.versions.electron=${process.versions.electron || null}`);
  ctx.log(`process.versions.modules=${process.versions.modules}`);
  ctx.log(`better_sqlite3.node=${nativePath}`);
  const browser = (await ctx.call('GET', '/api/browser')).d || {};
  const shellDir = ctx.path.join(ctx.path.dirname(ctx.execPath), 'resources', 'browsers', `chromium_headless_shell-${ctx.manifest.revision}`);
  return {
    native: { electron: process.versions.electron || null, modules: process.versions.modules, path: nativePath },
    browserBefore: { installed: !!browser.installed, path: browser.path || '' },
    revision: ctx.manifest.revision,
    headlessShell: shellDir,
    headlessShellExists: ctx.fs.existsSync(shellDir),
  };
}

export async function runCleanPhase(ctx) {
  const diag = (await ctx.call('GET', '/api/diagnostics')).d || {};
  return {
    clean: {
      version: diag.app?.version || null,
      schemaVersion: diag.schemaVersion ?? null,
      from: diag.migration?.from ?? null,
      backup: diag.migration?.backup || null,
      userData: ctx.userData,
      dataDir: diag.dataDir || null,
    },
  };
}

async function waitProfile(ctx, id, pred) {
  let row = null;
  for (let i = 0; i < 80; i++) {
    const list = (await ctx.call('GET', '/api/profiles')).d || [];
    row = list.find(p => p.id === id) || null;
    if (row && pred(row)) return row;
    await ctx.sleep(250);
  }
  return row;
}

export async function runUpgradePhase(ctx) {
  if (!ctx.dataDir) throw new Error('PM_DATA_DIR is not set; upgrade-expect.json has no directory');
  const expect = JSON.parse(ctx.fs.readFileSync(ctx.path.join(ctx.dataDir, 'upgrade-expect.json'), 'utf8'));
  const diag = (await ctx.call('GET', '/api/diagnostics')).d || {};
  const profiles = (await ctx.call('GET', '/api/profiles')).d || [];
  const proxies = (await ctx.call('GET', '/api/proxies')).d || [];
  const row = profiles.find(p => p.id === expect.id) || null;
  const stored = await ctx.proxyPassword(expect.proxyName);
  let decrypted = false;
  try { decrypted = !!stored && await ctx.decrypt(stored) === expect.password; } catch { decrypted = false; }
  // The seeded profile keeps its library proxy so migration of that link is real.
  // A packaged app does not add --proxy-bypass-list, and 203.0.113.10 cannot reach the
  // local page that reads the cookie. Detach only for this read; the library row stays.
  if (row?.proxy) await ctx.call('POST', `/api/profiles/${row.id}/proxy`, { proxyId: null });
  let read = null;
  const pages = ctx.http.createServer((req, res) => {
    const u = req.url || '';
    if (u.startsWith('/get')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>fetch('/read?ls='+encodeURIComponent(localStorage.getItem('who')||'')+'&c='+encodeURIComponent(document.cookie||'')).catch(()=>{})<\/script>`);
      return;
    }
    if (u.startsWith('/read')) {
      const q = new URL(u, 'http://127.0.0.1').searchParams;
      read = { ls: q.get('ls'), c: q.get('c') };
      res.end('ok');
      return;
    }
    res.end('ok');
  });
  await ctx.listen(pages, expect.port);
  const launched = row && await ctx.call('POST', `/api/profiles/${row.id}/launch`, { headless: true, url: `http://127.0.0.1:${expect.port}/get` });
  for (let i = 0; i < 40 && !read; i++) await ctx.sleep(250);
  if (row) await ctx.call('POST', `/api/profiles/${row.id}/stop`);
  await closeServer(pages);
  const backup = diag.migration?.backup || null;
  return {
    upgrade: {
      version: diag.app?.version || null,
      schemaVersion: diag.schemaVersion ?? null,
      from: diag.migration?.from ?? null,
      backup,
      backupExists: !!(backup && ctx.fs.existsSync(backup)),
      name: row?.name || null,
      secretError: row?.secretError || null,
      hasPassword: !!row?.proxy?.hasPassword,
      proxy: proxies.some(p => p.name === expect.proxyName),
      decrypted,
      read,
      launch: launched?.s || null,
    },
  };
}

export async function runLifecyclePhase(ctx) {
  const created = await ctx.call('POST', '/api/profiles', { name: 'Window', automationEnabled: true });
  const id = created.d?.id;
  const opened = id && await ctx.call('POST', `/api/profiles/${id}/launch`, { headless: false });
  const cdp = opened?.d?.cdp;
  const ws = cdp?.wsEndpoint;
  const address = cdp?.debuggerAddress || '';
  if (id && !ws) throw new Error('lifecycle launch did not return a CDP endpoint; only this lifecycle profile enables automation so the last page can be closed');
  if (ws && !address.startsWith('127.0.0.1:')) throw new Error(`lifecycle CDP is not loopback-only (${address || 'missing'})`);
  if (ws) {
    let host = '';
    try { host = new URL(ws).hostname; } catch {}
    if (host !== '127.0.0.1') throw new Error(`lifecycle CDP socket is not loopback-only (${ws})`);
  }
  const how = ws ? await ctx.closeLastWindow(ws) : null;
  const closed = id && await waitProfile(ctx, id, p => !p.running && !p.last_error);
  const exitType = id ? await ctx.readExitType(id) : null;
  const killedLaunch = id && await ctx.call('POST', `/api/profiles/${id}/launch`, { headless: false });
  if (id && !killedLaunch?.d?.pid) throw new Error('lifecycle relaunch did not return a browser pid');
  let killed = null;
  if (killedLaunch?.d?.pid) {
    try { await ctx.taskkill(killedLaunch.d.pid); } catch (e) { killed = String(e.message || e); }
  }
  const errored = id && await waitProfile(ctx, id, p => !p.running && !!p.last_error);
  const restarted = id && await ctx.call('POST', `/api/profiles/${id}/launch`, { headless: false });
  if (id) await ctx.call('POST', `/api/profiles/${id}/stop`);
  return {
    lifecycle: {
      close: { running: closed?.running ?? null, error: closed?.last_error || null, exitType, method: how?.method || null, address },
      kill: { running: errored?.running ?? null, error: errored?.last_error || null, taskkill: killed },
      restart: { status: restarted?.s || null, running: !!restarted?.d?.running, error: restarted?.d?.last_error || null },
    },
  };
}

export async function runSeedPhase(ctx) {
  const userBrowsers = ctx.path.join(ctx.userData, 'browsers');
  const before = ctx.fs.existsSync(userBrowsers) ? ctx.fs.readdirSync(userBrowsers) : [];
  const inst = await ctx.call('POST', '/api/browser/install');
  const after = ctx.fs.existsSync(userBrowsers) ? ctx.fs.readdirSync(userBrowsers) : [];
  const install = { status: inst.s, state: inst.d?.install?.state || null, code: inst.d?.install?.code || null, installed: !!inst.d?.installed };
  const userBrowsersUnchanged = JSON.stringify(before) === JSON.stringify(after);

  const tlsPort = Number(ctx.env.PM_SMOKE_TLS_PORT);
  if (!tlsPort) throw new Error('PM_SMOKE_TLS_PORT is required');
  const tested = await ctx.call('POST', '/api/proxy/test', { proxy: { type: 'https', host: '127.0.0.1', port: tlsPort } });
  const tls = { status: tested.s, ok: tested.d?.ok === true, error: tested.d?.error || null, message: tested.d?.message || tested.d?.error || '' };

  const hits = [];
  const proxy = ctx.http.createServer((req, res) => { hits.push(String(req.url || '')); res.end('x'); });
  proxy.on('connect', (req, socket) => { hits.push(String(req.url || '')); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  const proxyPort = await ctx.listen(proxy);
  let echoed = false;
  const echo = ctx.http.createServer((_req, res) => { echoed = true; res.end('ok'); });
  const echoPort = await ctx.listen(echo);
  await ctx.call('PUT', '/api/settings', { startUrl: `http://127.0.0.1:${echoPort}/local` });
  const plain = await ctx.call('POST', '/api/profiles', { name: 'Plain', proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } });

  const loaded = new Promise(res => ctx.win.webContents.once('did-finish-load', res));
  ctx.win.loadURL(ctx.backendUrl);
  await loaded;
  const launchButtonReady = await waitForPlainLaunch(ctx.win);
  const bannerBefore = (await pageText(ctx.win)).includes('Download Chromium');
  const launchClicked = launchButtonReady ? await clickPlainLaunch(ctx.win) : false;
  await ctx.sleep(1000);
  const bannerAfter = (await pageText(ctx.win)).includes('Download Chromium');

  let row = null;
  for (let i = 0; i < 40; i++) {
    const list = (await ctx.call('GET', '/api/profiles')).d || [];
    row = list.find(p => p.name === 'Plain');
    if (row?.running) break;
    await ctx.sleep(250);
  }
  let cmd = '';
  for (let i = 0; i < 15 && row?.pid && !cmd; i++) { cmd = await ctx.processCommandLine(row.pid) || ''; if (!cmd) await ctx.sleep(200); }
  await ctx.sleep(500);
  const plainResult = {
    status: row?.running ? 200 : 0,
    error: row?.last_error || null,
    code: null,
    cdp: !!row?.cdp,
    automationEnabled: row?.automationEnabled === true,
    listening: row?.pid ? await ctx.listeningPorts(row.pid) : [],
    cmd,
    proxyHits: hits.slice(),
    echoed,
    id: plain.d?.id || null,
  };
  await ctx.call('PUT', '/api/settings', { startUrl: '' });
  if (plain.d?.id) await ctx.call('POST', `/api/profiles/${plain.d.id}/stop`);
  await closeServer(proxy); await closeServer(echo);

  const auto = await ctx.call('POST', '/api/profiles', { name: 'Auto', automationEnabled: true });
  const al = await ctx.call('POST', `/api/profiles/${auto.d?.id}/launch`, { headless: true });
  const autoResult = { status: al.s, cdp: !!al.d?.cdp, address: al.d?.cdp?.debuggerAddress || '', error: al.d?.error || null };
  if (auto.d?.id) await ctx.call('POST', `/api/profiles/${auto.d.id}/stop`);

  await ctx.call('POST', '/api/proxies', { name: 'PersistProxy', type: 'http', host: '203.0.113.10', port: 8080 });
  let wrote = false;
  const pages = ctx.http.createServer((req, res) => {
    const u = req.url || '';
    if (u.startsWith('/set')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>localStorage.setItem('pm_k','pm_v');document.cookie='pm_c=pm_cookie; path=/; max-age=86400';fetch('/wrote').catch(()=>{})<\/script>`);
      return;
    }
    if (u.startsWith('/wrote')) { wrote = true; res.end('ok'); return; }
    res.end('ok');
  });
  const originPort = await ctx.listen(pages);
  const persist = await ctx.call('POST', '/api/profiles', { name: 'Persist' });
  const pl = await ctx.call('POST', `/api/profiles/${persist.d?.id}/launch`, { headless: true, url: `http://127.0.0.1:${originPort}/set` });
  for (let i = 0; i < 40 && !wrote; i++) await ctx.sleep(250);
  const persistResult = { id: persist.d?.id || null, status: pl.s, wrote, cdp: !!pl.d?.cdp, error: pl.d?.error || null };
  await closeServer(pages);
  ctx.fs.writeFileSync(ctx.path.join(ctx.userData, 'offline-smoke.json'), JSON.stringify({ port: originPort, id: persist.d?.id || null }));
  return {
    install, userBrowsersUnchanged, tls, launchButtonReady, bannerBefore, launchClicked, bannerAfter,
    plain: plainResult, auto: autoResult, persist: persistResult,
  };
}

export async function runCheckPhase(ctx) {
  const marker = ctx.path.join(ctx.userData, 'offline-smoke.json');
  const saved = JSON.parse(ctx.fs.readFileSync(marker, 'utf8'));
  let read = null;
  const pages = ctx.http.createServer((req, res) => {
    const u = req.url || '';
    if (u.startsWith('/get')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>fetch('/read?ls='+encodeURIComponent(localStorage.getItem('pm_k')||'')+'&c='+encodeURIComponent(document.cookie||'')).catch(()=>{})<\/script>`);
      return;
    }
    if (u.startsWith('/read')) {
      const q = new URL(u, 'http://127.0.0.1').searchParams;
      read = { ls: q.get('ls'), c: q.get('c') };
      res.end('ok');
      return;
    }
    res.end('ok');
  });
  await ctx.listen(pages, saved.port);
  const profiles = (await ctx.call('GET', '/api/profiles')).d || [];
  const proxies = (await ctx.call('GET', '/api/proxies')).d || [];
  const row = profiles.find(p => p.name === 'Persist');
  const launched = row && await ctx.call('POST', `/api/profiles/${row.id}/launch`, { headless: true, url: `http://127.0.0.1:${saved.port}/get` });
  for (let i = 0; i < 40 && !read; i++) await ctx.sleep(250);
  if (row) await ctx.call('POST', `/api/profiles/${row.id}/stop`);
  await closeServer(pages);
  return { saved: { profile: !!row, proxy: proxies.some(p => p.name === 'PersistProxy'), read, launch: launched?.s || null } };
}

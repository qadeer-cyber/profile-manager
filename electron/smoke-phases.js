// Phase dispatch for the packaged offline smoke. No Electron import: unit tests call this directly.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { MANIFEST } from '../server/chromium.js';
import { processCommandLine } from '../server/proc.js';

export const SMOKE_PHASES = Object.freeze(['clean', 'upgrade', 'seed', 'check', 'lifecycle']);

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

export function selectSmokePhase(value) {
  if (typeof value !== 'string' || !SMOKE_PHASES.includes(value)) {
    const shown = value === undefined || value === null || value === '' ? '(missing)' : JSON.stringify(value);
    throw Object.assign(new Error(`PM_SMOKE_PHASE must be one of ${SMOKE_PHASES.join(', ')}; got ${shown}`), { code: 'SMOKE_PHASE' });
  }
  return value;
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
    browserClose: browserClose,
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

function browserClose(wsUrl) {
  return new Promise(resolve => {
    let ws;
    const done = () => { clearTimeout(t); try { ws?.close(); } catch {} resolve(); };
    const t = setTimeout(done, 8000);
    try { ws = new WebSocket(wsUrl); } catch { done(); return; }
    ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch { done(); } };
    ws.onerror = done;
    ws.onclose = done;
  });
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
  const ws = opened?.d?.cdp?.wsEndpoint;
  if (id && !ws) throw new Error('lifecycle launch did not return a CDP endpoint; the profile must be created with automationEnabled so Browser.close can run');
  if (ws) await ctx.browserClose(ws);
  const closed = id && await waitProfile(ctx, id, p => !p.running && !p.last_error);
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
      close: { running: closed?.running ?? null, error: closed?.last_error || null },
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

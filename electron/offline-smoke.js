// Packaged offline-install smoke. Loaded only when PM_SMOKE=1 and PM_SMOKE_OFFLINE=1.
// The bad-certificate HTTPS server is started by the Windows harness; this file only
// receives its port. No key or certificate material lives here.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { createRequire } from 'module';
import { MANIFEST } from '../server/chromium.js';
import { processCommandLine } from '../server/proc.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
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

export async function runOfflineSmoke({ backend, win, uiToken, userData, log }) {
  if (process.env.PM_SMOKE !== '1' || process.env.PM_SMOKE_OFFLINE !== '1') {
    throw new Error('offline smoke requires PM_SMOKE=1 and PM_SMOKE_OFFLINE=1');
  }
  const phase = process.env.PM_SMOKE_PHASE === 'check' ? 'check' : 'seed';
  const H = { 'Content-Type': 'application/json', 'X-UI-Token': uiToken };
  const call = async (m, u, b) => {
    const res = await fetch(backend.url + u, { method: m, headers: H, body: b && JSON.stringify(b) });
    return { s: res.status, d: await res.json().catch(() => null) };
  };
  const r = { phase };
  const marker = path.join(userData, 'offline-smoke.json');
  try {
    const nativePath = nativeModulePath();
    r.native = { electron: process.versions.electron || null, modules: process.versions.modules, path: nativePath };
    log(`process.versions.electron=${r.native.electron}`);
    log(`process.versions.modules=${r.native.modules}`);
    log(`better_sqlite3.node=${nativePath}`);

    const browser = (await call('GET', '/api/browser')).d || {};
    r.browserBefore = { installed: !!browser.installed, path: browser.path || '' };
    r.revision = MANIFEST.revision;
    const shellDir = path.join(path.dirname(process.execPath), 'resources', 'browsers', `chromium_headless_shell-${MANIFEST.revision}`);
    r.headlessShell = shellDir;
    r.headlessShellExists = fs.existsSync(shellDir);

    if (phase === 'seed') {
      const userBrowsers = path.join(userData, 'browsers');
      const before = fs.existsSync(userBrowsers) ? fs.readdirSync(userBrowsers) : [];
      const inst = await call('POST', '/api/browser/install');
      const after = fs.existsSync(userBrowsers) ? fs.readdirSync(userBrowsers) : [];
      r.install = { status: inst.s, state: inst.d?.install?.state || null, code: inst.d?.install?.code || null, installed: !!inst.d?.installed };
      r.userBrowsersUnchanged = JSON.stringify(before) === JSON.stringify(after);

      const tlsPort = Number(process.env.PM_SMOKE_TLS_PORT);
      if (!tlsPort) throw new Error('PM_SMOKE_TLS_PORT is required');
      const tested = await call('POST', '/api/proxy/test', { proxy: { type: 'https', host: '127.0.0.1', port: tlsPort } });
      r.tls = { status: tested.s, ok: tested.d?.ok === true, error: tested.d?.error || null, message: tested.d?.message || tested.d?.error || '' };

      const hits = [];
      const proxy = http.createServer((req, res) => { hits.push(String(req.url || '')); res.end('x'); });
      proxy.on('connect', (req, socket) => { hits.push(String(req.url || '')); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
      const proxyPort = await listen(proxy);
      let echoed = false;
      const echo = http.createServer((_req, res) => { echoed = true; res.end('ok'); });
      const echoPort = await listen(echo);
      await call('PUT', '/api/settings', { startUrl: `http://127.0.0.1:${echoPort}/local` });
      const plain = await call('POST', '/api/profiles', { name: 'Plain', proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } });

      const loaded = new Promise(res => win.webContents.once('did-finish-load', res));
      win.loadURL(backend.url);
      await loaded;
      r.launchButtonReady = await waitForPlainLaunch(win);
      r.bannerBefore = (await pageText(win)).includes('Download Chromium');
      r.launchClicked = r.launchButtonReady ? await clickPlainLaunch(win) : false;
      await sleep(1000);
      r.bannerAfter = (await pageText(win)).includes('Download Chromium');

      let row = null;
      for (let i = 0; i < 40; i++) {
        const list = (await call('GET', '/api/profiles')).d || [];
        row = list.find(p => p.name === 'Plain');
        if (row?.running) break;
        await sleep(250);
      }
      let cmd = '';
      for (let i = 0; i < 15 && row?.pid && !cmd; i++) { cmd = await processCommandLine(row.pid) || ''; if (!cmd) await sleep(200); }
      await sleep(500);
      r.plain = {
        status: row?.running ? 200 : 0,
        error: row?.last_error || null,
        code: null,
        cdp: !!row?.cdp,
        cmd,
        proxyHits: hits.slice(),
        echoed,
        id: plain.d?.id || null,
      };
      await call('PUT', '/api/settings', { startUrl: '' });
      if (plain.d?.id) await call('POST', `/api/profiles/${plain.d.id}/stop`);
      proxy.close(); echo.close();

      const auto = await call('POST', '/api/profiles', { name: 'Auto', automationEnabled: true });
      const al = await call('POST', `/api/profiles/${auto.d?.id}/launch`, { headless: true });
      r.auto = { status: al.s, cdp: !!al.d?.cdp, address: al.d?.cdp?.debuggerAddress || '', error: al.d?.error || null };
      if (auto.d?.id) await call('POST', `/api/profiles/${auto.d.id}/stop`);

      await call('POST', '/api/proxies', { name: 'PersistProxy', type: 'http', host: '203.0.113.10', port: 8080 });
      let wrote = false;
      const pages = http.createServer((req, res) => {
        const u = req.url || '';
        if (u.startsWith('/set')) {
          res.setHeader('Content-Type', 'text/html');
          res.end(`<script>localStorage.setItem('pm_k','pm_v');document.cookie='pm_c=pm_cookie; path=/';fetch('/wrote').catch(()=>{})<\/script>`);
          return;
        }
        if (u.startsWith('/wrote')) { wrote = true; res.end('ok'); return; }
        res.end('ok');
      });
      const originPort = await listen(pages);
      const persist = await call('POST', '/api/profiles', { name: 'Persist' });
      const pl = await call('POST', `/api/profiles/${persist.d?.id}/launch`, { headless: true, url: `http://127.0.0.1:${originPort}/set` });
      for (let i = 0; i < 40 && !wrote; i++) await sleep(250);
      r.persist = { id: persist.d?.id || null, status: pl.s, wrote, cdp: !!pl.d?.cdp, error: pl.d?.error || null };
      pages.close();
      fs.writeFileSync(marker, JSON.stringify({ port: originPort, id: persist.d?.id || null }));
    } else {
      const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
      let read = null;
      const pages = http.createServer((req, res) => {
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
      await listen(pages, saved.port);
      const profiles = (await call('GET', '/api/profiles')).d || [];
      const proxies = (await call('GET', '/api/proxies')).d || [];
      const row = profiles.find(p => p.name === 'Persist');
      const launched = row && await call('POST', `/api/profiles/${row.id}/launch`, { headless: true, url: `http://127.0.0.1:${saved.port}/get` });
      for (let i = 0; i < 40 && !read; i++) await sleep(250);
      if (row) await call('POST', `/api/profiles/${row.id}/stop`);
      pages.close();
      r.saved = { profile: !!row, proxy: proxies.some(p => p.name === 'PersistProxy'), read, launch: launched?.s || null };
    }
  } catch (err) {
    r.error = String(err && err.stack || err);
    log('offline smoke error', err);
  }
  fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify(r, null, 2));
  app.quit();
}

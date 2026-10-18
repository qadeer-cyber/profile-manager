// Packaged offline-install smoke (PM_SMOKE_OFFLINE=1). Not used by test/electron-smoke.js.
// The self-signed certificate exists only so a proxy TLS check is rejected.
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { createRequire } from 'module';
import { MANIFEST } from '../server/chromium.js';
import { processCommandLine } from '../server/proc.js';

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCsYrgaDYMvRPMA
7lonS+Lj9AihwGI8oxMskAOxGRvkfv554eufPrgnvvEeo94gY4Bat37B+TfXDX6u
bI6kmm91Kl5kV1Qw4JVONdLNEA7P4eDthCbQSjImrwG5CvhLKUroUpzjv60dvOWW
j68qjr/rjbenTQOBL5VNdorkCjYuhZH5OW+RNB1Dow24clLp8NibL2F4nJo+/6yE
qGexfIopJy6I/V4ZNPD1XQNyAvY4h8CXbxuYAFoiiMxEXTODr7maK/BWAUQDjK6x
4i3Z4CvIgrW8DzvTkRA0NfxKWx1qnRtrafKRVD7fbwaXgWy12QZzvh2nBZmCw5U3
/KYDCYHFAgMBAAECggEADFLpaPlm08II4lvn54/KCnRnipLLoxygcgrgrLBIGXOH
w1RmqSWNek/xAnkCGAwtAK9GGV11A8OT9ynNH9Dnn3d2NJO2seDYY7U+2winGm8C
StCsCq+HOtM/mwhA/HSZBZdkXnbVTD81Jaijg/YdG9yvkL8VfU6WzKkpIEjnmzc0
uykpz5+d2+GCC9FqfG+58Jr9MkzOWs5f+l7gMsKSJb3GhkitaVqMWbFSVcR8VY+S
q3nuIDaAZms5WCJd/8gz4BfTRAGWyNTikSoL5nwvZayx5Am6fHFf6LyiotTg5aQT
9PYx9398yop20Ait6mto9HcIKPssmNbvFhZwAyH6MQKBgQDil5vfU9nsQU9gxM+b
WC71ARRv+DdT+yHVYYy0dgvQGAd6/QPoddYlwj5DUwxlukzRsVYvfluygofRdpd5
l30HYIEoyqhJpNO7OxOVxtvK5F9oO/iH8RaAO2zSrthxwZOhlmPY6ap/L24A6s0p
EhyQumk08i+Asior89G3/5gtsQKBgQDCwiDdJJBFm7wVBbIw1hYRbSsIKUJPc7tf
5nPe9rdk/Vy4Hp2yA1/LHkQG3FOKr2IxWft+R86ApN+mG0fbU5slD7vjreNBPepy
RCLivM4LvjoHew4p9w7jummM3K5UJ2twdZLpB2Fj5Dm3/a4wNbccrpUCDvWsoLS8
Kr7OZo82VQKBgQCq2PE4FDst/ZhiOELouDa/mM7WFetxsNqzzteOgasqfdO2EevO
bHrJAYp8rLOeSDf/q5x2Nung0LajYq2XindFBqicHyGAVX0noMWFmujCNCsTppQf
u9HhYe0NdbPRIcm0fnZOaPCa8SIaIvAJ1ZQgM817lFfoy20ssqwf9eHCIQKBgHuC
1YipWX1riFnkpN7nxlMC4ploYQ82HAxzf+RUnnXDX/u8HtH35dZQuV+Idsqq8yDN
Kfsp2sImzVbwUh+749YbJlL7wfVsKLSSlXUpu5oi53Y7Cf5/Gcg+PhYBFeV0omRN
i/+QmKja4efXT5JvXlMoPINzrUXvHO+AREVtMUGJAoGAT09NkbzOcyYZskWhlL+z
Wz8gF2EFLXGn9vQKzLnZW2ncZbqGpp8b4EeIXb9rffVTlaQbEG8YLwS8PziCytrK
PzdbmVMBYnCmcyX2Z0tSeDQFtBRwzs7eGy7G3Px3J4vjzBvWnrqQiC0X0M75kFMr
1sMynVsuRV7dOhtr5AgoFHg=
-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUKW00LhQNJremcjn05Ms0ovClEdkwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAxODE5MzQzNVoXDTM2MTAx
NTE5MzQzNVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEArGK4Gg2DL0TzAO5aJ0vi4/QIocBiPKMTLJADsRkb5H7+
eeHrnz64J77xHqPeIGOAWrd+wfk31w1+rmyOpJpvdSpeZFdUMOCVTjXSzRAOz+Hg
7YQm0EoyJq8BuQr4SylK6FKc47+tHbzllo+vKo6/6423p00DgS+VTXaK5Ao2LoWR
+TlvkTQdQ6MNuHJS6fDYmy9heJyaPv+shKhnsXyKKScuiP1eGTTw9V0DcgL2OIfA
l28bmABaIojMRF0zg6+5mivwVgFEA4yuseIt2eAryIK1vA8705EQNDX8Slsdap0b
a2nykVQ+328Gl4FstdkGc74dpwWZgsOVN/ymAwmBxQIDAQABo1MwUTAdBgNVHQ4E
FgQUfRCxDEW7smtih09A/fSM/fJkCxcwHwYDVR0jBBgwFoAUfRCxDEW7smtih09A
/fSM/fJkCxcwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAeqLw
/cRAra96n2xGqfB0Iao34+Q/gz8/+RzVwAo0uV63+vbsf33k+nN0BnmHRJkEkLQt
LRkHpz/H6KSJDrYlkF7mIvCKZNUs8XWCNkh9neDM9R70G1NwlYuw2T/tmnSR93m7
x5nN03cdbLxi6OwHXLlEJ0iQNhMAjhVqy4fgt7bopLcoqOUjw6sTByAsU+09PfEX
ZGczzaM8fGlIjKzNfIcKxQJ9Wst0UWvKdFwylPMGrQcs16+VgBjK3EX3NoFsk7Ps
HbvSXPg4ckoyV+sGJF1bFyGRfDWd3X/DFMUhUCWxFYI6UyAEOY8QkrmBs+Zm2N0z
g2Zpz+Mc3lbb2e3Rfg==
-----END CERTIFICATE-----`;

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

export async function runOfflineSmoke({ backend, win, uiToken, userData, log }) {
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

    const bundledRoot = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Profile Manager', 'resources', 'browsers');
    r.bundledRoot = bundledRoot;
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

      if (win.webContents.isLoading()) await new Promise(res => win.webContents.once('did-finish-load', res));
      await sleep(800);
      r.downloadBanner = await win.webContents.executeJavaScript(`document.body && document.body.innerText.includes('Download Chromium')`);

      const tlsServer = https.createServer({ key: KEY, cert: CERT }, (_req, res) => res.end('no'));
      const tlsPort = await listen(tlsServer);
      const tested = await call('POST', '/api/proxy/test', { proxy: { type: 'https', host: '127.0.0.1', port: tlsPort } });
      r.tls = { status: tested.s, ok: tested.d?.ok === true, error: tested.d?.error || null, message: tested.d?.message || tested.d?.error || '' };
      tlsServer.close();

      const hits = [];
      const proxy = http.createServer((req, res) => { hits.push(String(req.url || '')); res.end('x'); });
      proxy.on('connect', (req, socket) => { hits.push(String(req.url || '')); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
      const proxyPort = await listen(proxy);
      let echoed = false;
      const echo = http.createServer((_req, res) => { echoed = true; res.end('ok'); });
      const echoPort = await listen(echo);
      const plain = await call('POST', '/api/profiles', { name: 'Plain', proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } });
      const launched = await call('POST', `/api/profiles/${plain.d?.id}/launch`, { headless: true, url: `http://127.0.0.1:${echoPort}/local` });
      let cmd = '';
      for (let i = 0; i < 15 && launched.d?.pid && !cmd; i++) { cmd = await processCommandLine(launched.d.pid) || ''; if (!cmd) await sleep(200); }
      await sleep(1000);
      r.plain = {
        status: launched.s,
        error: launched.d?.error || null,
        code: launched.d?.code || null,
        cdp: !!launched.d?.cdp,
        cmd,
        proxyHits: hits.slice(),
        echoed,
      };
      if (plain.d?.id) await call('POST', `/api/profiles/${plain.d.id}/stop`);
      proxy.close(); echo.close();

      const auto = await call('POST', '/api/profiles', { name: 'Auto', automationEnabled: true });
      const al = await call('POST', `/api/profiles/${auto.d?.id}/launch`, { headless: true });
      r.auto = { status: al.s, cdp: !!al.d?.cdp, address: al.d?.cdp?.debuggerAddress || null, error: al.d?.error || null };
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
      if (persist.d?.id) await call('POST', `/api/profiles/${persist.d.id}/stop`);
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

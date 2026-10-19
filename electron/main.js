// Electron main process: runs the backend in-process on a random loopback port (protected by a
// per-session UI token) and opens the window. Users never deal with localhost, ports or npm.
import { app, BrowserWindow, safeStorage, ipcMain, shell, session, Menu, dialog } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyPackagedFlag } from '../server/testflags.js';
import { durableShutdown } from '../server/shutdown.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.PM_SMOKE === '1';
// Overwrite any inherited value before the backend is loaded (dynamic import in startBackend).
applyPackagedFlag(process.env, app.isPackaged);

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// User data follows the package name: %APPDATA%\profile-manager on Windows.
// Do not point this at "Profile Manager"; v0.4.0 already stores profiles under profile-manager.
if (process.env.PM_USER_DATA) app.setPath('userData', process.env.PM_USER_DATA);
const userData = app.getPath('userData');
process.env.PM_DATA_DIR = path.join(userData, 'data');
// Browser location, in priority order:
//  1. PM_BROWSERS_PATH (tests/overrides)
//  2. offline build: Chromium bundled in <resources>/browsers (dist:win:offline), used if it contains an install
//  3. packaged default: downloaded on first run into <userData>/browsers (see README)
//  4. dev: Playwright's default cache
const bundledBrowsers = app.isPackaged ? path.join(process.resourcesPath, 'browsers') : null;
const hasBundled = !!bundledBrowsers && fs.existsSync(bundledBrowsers) && fs.readdirSync(bundledBrowsers).some(d => /^chromium-\d+$/.test(d));
if (process.env.PM_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PM_BROWSERS_PATH;
else if (hasBundled) process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers;
else if (app.isPackaged) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(userData, 'browsers');
process.env.PM_BROWSERS_BUNDLED = hasBundled ? '1' : '0';
process.env.PM_APP_VERSION = app.getVersion();

const uiToken = crypto.randomBytes(24).toString('hex');
let backend, win, quitStarted = false;
// Crash/diagnostic log: <userData>/logs/main.log (rotated at 1 MB).
const logDir = path.join(userData, 'logs'); fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'main.log');
try { if (fs.statSync(logFile).size > 1 << 20) fs.renameSync(logFile, logFile + '.1'); } catch {}
const fileLog = (lvl, a) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${lvl} ${a.map(x => x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch {} };
const log = (...a) => { console.log('[main]', ...a); fileLog('INFO', a); };
const logErr = (...a) => { console.error('[main]', ...a); fileLog('ERROR', a); };
process.on('uncaughtException', e => logErr('uncaughtException', e));
process.on('unhandledRejection', e => logErr('unhandledRejection', e));

function configureSecrets(secrets) {
  // safeStorage uses DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux.
  let usable = safeStorage.isEncryptionAvailable(), reason = '';
  if (usable && process.platform === 'linux') {
    const backendName = safeStorage.getSelectedStorageBackend?.();
    if (!backendName || ['basic_text', 'unknown'].includes(backendName)) { usable = false; reason = `no OS keyring (backend: ${backendName})`; }
  }
  if (usable) {
    secrets.setExternalCipher({ name: 'electron-safeStorage', encrypt: s => safeStorage.encryptString(s), decrypt: b => safeStorage.decryptString(b) });
  } else {
    const w = `OS secure storage unavailable${reason ? ' (' + reason + ')' : ''}; using AES-256-GCM with a key file in the data folder.`;
    secrets.setEncryptionWarning(w); console.warn('[main] WARNING:', w);
  }
}

async function startBackend() {
  const secrets = await import('../server/secrets.js');
  configureSecrets(secrets);
  const { startServer } = await import('../server/app.js');
  backend = await startServer({ port: 0, host: '127.0.0.1', uiToken, staticDir: path.join(app.getAppPath(), 'web', 'dist') });
  log(`backend on ${backend.url}; data in ${process.env.PM_DATA_DIR}; re-encrypted ${backend.reencrypted} secret(s)`);
  backend.events.on('event', e => { if (win && !win.isDestroyed()) win.webContents.send('pm:event', e); });
  // If the in-process HTTP server dies unexpectedly, restart it and point the window at the new URL.
  const srv = backend.server, mine = () => !quitStarted && backend?.server === srv;
  srv.on('close', () => { if (mine()) restartBackend('server closed unexpectedly'); });
  srv.on('error', e => { logErr('backend server error', e); if (mine()) restartBackend(e.message); });
}
let restarts = 0;
async function restartBackend(reason) {
  if (quitStarted || ++restarts > 3) { logErr(`backend down (${reason}); not restarting (attempt ${restarts})`); return; }
  logErr(`backend down (${reason}); restarting (attempt ${restarts})`);
  const old = backend; backend = null;
  try { await old?.close(); } catch {}
  try { await startBackend(); if (win && !win.isDestroyed()) win.loadURL(backend.url); } catch (e) { logErr('backend restart failed', e); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600, show: !SMOKE || process.env.PM_SMOKE_SHOW === '1',
    title: 'Profile Manager', backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  const origin = new URL(backend.url).origin;
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
  // Renderer crash: log and reload (max 3 times per minute, then show an error box).
  let crashes = [];
  win.webContents.on('render-process-gone', (e, d) => {
    logErr('render-process-gone', d);
    if (quitStarted || d.reason === 'clean-exit') return;
    crashes = crashes.filter(t => Date.now() - t < 60000).concat(Date.now());
    if (crashes.length <= 3 && backend) win.loadURL(backend.url);
    else dialog.showErrorBox('Profile Manager', `The window crashed repeatedly (${d.reason}). Details: ${logFile}`);
  });
  win.webContents.on('unresponsive', () => logErr('renderer unresponsive'));
  win.loadURL(backend.url);
  return win;
}

ipcMain.on('pm:get-ui-token', e => { e.returnValue = uiToken; });
ipcMain.handle('pm:open-data-dir', () => shell.openPath(process.env.PM_DATA_DIR));
ipcMain.handle('pm:app-info', () => ({ version: app.getVersion(), userData, packaged: app.isPackaged, bundledBrowsers: hasBundled, logFile }));

app.on('child-process-gone', (e, d) => logErr('child-process-gone', d)); // GPU/utility crashes (profile browsers are not Electron children)
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// First before-quit is one-shot: guard, cancel the default quit, then browser close,
// WAL checkpoint, and db.close. app.exit(0) only if every step succeeds.
app.on('before-quit', e => {
  if (quitStarted) return;
  quitStarted = true;
  e.preventDefault();
  (async () => {
    try {
      const { db } = await import('../server/db.js');
      await durableShutdown({
        closeBrowsers: async () => { if (backend) await backend.close(); },
        db,
        timeoutMs: 10000,
        log: logErr,
      });
      app.exit(0);
    } catch (err) {
      logErr(err);
      app.exit(1);
    }
  })();
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  if (!SMOKE) Menu.setApplicationMenu(null);
  try { await startBackend(); }
  catch (e) { logErr('backend failed to start', e); dialog.showErrorBox('Profile Manager could not start', `${e.message}\n\nLog: ${logFile}`); app.exit(1); return; }
  createWindow();
  if (SMOKE) runSmoke().catch(err => { console.error(err); fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify({ error: String(err.stack || err) })); app.quit(); });
});

// ---- smoke-test mode (used by test/electron-smoke.js under xvfb) ----
async function runSmoke() {
  // Literal in-app import. Both flags are required; a path is never taken from the environment.
  if (process.env.PM_SMOKE === '1' && process.env.PM_SMOKE_OFFLINE === '1') {
    const { runOfflineSmoke } = await import('./offline-smoke.js');
    await runOfflineSmoke({ backend, win, uiToken, userData, log });
    return;
  }
  const H = { 'Content-Type': 'application/json', 'X-UI-Token': uiToken };
  const call = (m, u, b) => fetch(backend.url + u, { method: m, headers: H, body: b && JSON.stringify(b) }).then(r => r.json().catch(() => null).then(d => ({ s: r.status, d })));
  const r = {};
  r.unauthorized = (await fetch(backend.url + '/api/profiles')).status;
  // First-run browser download (packaged builds start without Chromium)
  r.browserBefore = (await call('GET', '/api/browser')).d;
  if (!r.browserBefore.installed) {
    await call('POST', '/api/browser/install');
    for (let i = 0; i < 600; i++) { const b = (await call('GET', '/api/browser')).d; if (b.install.state !== 'running') { r.browserAfter = b; break; } await new Promise(res => setTimeout(res, 1000)); }
  }
  const p1 = await call('POST', '/api/profiles', { name: 'Shopping', tags: ['personal'], folder: 'Home', notes: 'Everyday browsing' });
  await call('POST', '/api/profiles', { name: 'Client — Acme', tags: ['work', 'client'], folder: 'Work', proxy: { type: 'socks5', host: '127.0.0.1', port: 1080, username: 'user', password: 'secret' } });
  await call('POST', '/api/profiles', { name: 'Research', tags: ['work'], folder: 'Work' });
  const launched = await call('POST', `/api/profiles/${p1.d.id}/launch`, { headless: true });
  r.launch = { status: launched.s, running: launched.d?.running, pid: launched.d?.pid ?? launched.d?.cdp?.pid, cdpExposed: !!launched.d?.cdp };
  r.diagnostics = (await call('GET', '/api/diagnostics')).d;
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(process.env.PM_DATA_DIR, 'profiles.db'), { readonly: true });
  r.storedSecretPrefix = db.prepare("SELECT x.password FROM proxies x JOIN profiles p ON p.proxy_id = x.id WHERE p.name LIKE 'Client%'").get().password.match(/^(ss:v1:|enc:v1:)/)?.[0]; db.close();
  r.secretErrors = (await call('GET', '/api/profiles')).d.filter(p => p.secretError).length;
  if (win.webContents.isLoading()) await new Promise(res => win.webContents.once('did-finish-load', res));
  await new Promise(res => setTimeout(res, 2500));
  r.renderer = await win.webContents.executeJavaScript(`({ require: typeof require, process: typeof process, pmBridge: typeof window.pm, rows: document.querySelectorAll('tbody tr').length, title: document.title })`);
  r.webPreferences = { contextIsolation: win.webContents.getLastWebPreferences().contextIsolation, nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration, sandbox: win.webContents.getLastWebPreferences().sandbox };
  const shots = [['profiles', process.env.PM_SMOKE_SCREENSHOT]];
  for (const [page, file] of shots) { if (file) fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }
  for (const page of ['settings', 'diagnostics']) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="${page}"]').click()`);
    await new Promise(res => setTimeout(res, 800));
    if (process.env.PM_SMOKE_SCREENSHOT) fs.writeFileSync(process.env.PM_SMOKE_SCREENSHOT.replace(/\.png$/, `-${page}.png`), (await win.webContents.capturePage()).toPNG());
  }
  r.userData = userData; r.reencrypted = backend.reencrypted;
  fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify(r, null, 2));
  app.quit(); // exercises the safe-shutdown path
}

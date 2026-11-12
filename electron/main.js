// Electron main process: runs the backend in-process on a random loopback port (protected by a
// per-session UI token) and opens the window. Users never deal with localhost, ports or npm.
import { isOwnerEdition, isUltimateEdition, isProvisionedOffice, productName } from '../server/office/edition.js';
import { officeUserDataPath, adoptLegacyData } from './office-upgrade.js';
import { app, BrowserWindow, safeStorage, ipcMain, shell, session, Menu, dialog, clipboard } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyPackagedFlag } from '../server/testflags.js';
import { durableShutdown } from '../server/shutdown.js';
import { classifyLaunch, writeSmokeRejection } from './smoke-gate.js';

import { createUpdateChecker } from './release-updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.PM_SMOKE === '1';
// Overwrite any inherited value before the backend is loaded (dynamic import in startBackend).
applyPackagedFlag(process.env, app.isPackaged);
const packageMetadata = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
if (app.isPackaged && packageMetadata.azwahChromiumRuntime === 'stable-chrome') process.env.AZWAH_STABLE_CHROME_EDITION = '1';

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// User data follows the package name: %APPDATA%\profile-manager on Windows.
// Do not point this at "Profile Manager"; v0.4.0 already stores profiles under profile-manager.
app.setPath('userData', isUltimateEdition ? path.join(app.getPath('appData'),'azwah-multi-browser-ultimate') : isOwnerEdition ? path.join(app.getPath('appData'),'azwah-multi-browser-owner') : isProvisionedOffice ? path.join(app.getPath('appData'),'azwah-multi-browser-office') : officeUserDataPath(app.getPath('appData')));
if (process.env.PM_USER_DATA) app.setPath('userData', process.env.PM_USER_DATA);
if (!isOwnerEdition && !isUltimateEdition && !isProvisionedOffice) adoptLegacyData(app.getPath('userData'));
app.setName(productName);
if (isProvisionedOffice) process.env.AZWAH_OFFICE_ENFORCE = '1';
else delete process.env.AZWAH_OFFICE_ENFORCE;
process.env.AZWAH_OFFICE_PACKAGED = app.isPackaged ? '1' : '0';
let userData = app.getPath('userData');
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
  if (isUltimateEdition) {
    const { setDesktopBridge } = await import('../server/ultimate-admin.js');
    setDesktopBridge({
      resourcesPath: process.resourcesPath,
      chooseDirectory: async () => { const result = await dialog.showOpenDialog(win, {properties: ['openDirectory']}); return result.canceled ? null : result.filePaths[0]; },
      chooseSaveFile: async defaultPath => { const result = await dialog.showSaveDialog(win, {defaultPath}); return result.canceled ? null : result.filePath; },
      chooseRestoreFile: async () => { const result = await dialog.showOpenDialog(win, {properties: ['openFile'], filters: [{name: 'Encrypted vault', extensions: ['vault']}]}); return result.canceled ? null : result.filePaths[0]; },
    });
    process.env.AZWAH_ADMIN_VAULT = path.join(userData, 'organization.vault');
  }
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
    title: productName, backgroundColor: '#f5f6f8',
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
    else dialog.showErrorBox('Azwah Multi Browser', `The window crashed repeatedly (${d.reason}). Details: ${logFile}`);
  });
  win.webContents.on('unresponsive', () => logErr('renderer unresponsive'));
  win.loadURL(backend.url);
  return win;
}

ipcMain.on('pm:get-ui-token', e => { e.returnValue = uiToken; });
ipcMain.handle('pm:open-data-dir', () => shell.openPath(process.env.PM_DATA_DIR));
// Copy only this device's identity. Renderer callers cannot supply clipboard contents.
ipcMain.handle('pm:copy-device-code', async event => {
  if (isOwnerEdition || !win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !backend || new URL(event.senderFrame.url).origin !== new URL(backend.url).origin) {
    throw Error('Device identity clipboard access denied');
  }
  const { deviceIdentity } = await import('../server/office/device.js');
  clipboard.writeText(deviceIdentity());
});
ipcMain.handle('pm:app-info', () => ({ product: productName, edition: isUltimateEdition ? 'Ultimate' : isOwnerEdition ? 'Owner / Personal' : 'Office', version: app.getVersion(), userData, packaged: app.isPackaged, bundledBrowsers: hasBundled, logFile }));

app.on('child-process-gone', (e, d) => logErr('child-process-gone', d)); // GPU/utility crashes (profile browsers are not Electron children)
if (app.isPackaged && process.platform === 'win32' && packageMetadata.azwahChromiumRuntime === 'stable-chrome') {
  const version = app.getVersion();
  const checker = createUpdateChecker({ version, channel: version.includes('-beta.') ? 'beta' : 'stable' });
  function authorizeUpdateRequest(event) {
    if (!win || !backend || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== new URL(backend.url).origin) {
      throw new Error('Unauthorized update request.');
    }
  }
  ipcMain.handle('pm:update-status', event => { authorizeUpdateRequest(event); return checker.status(); });
  ipcMain.handle('pm:update-check', event => { authorizeUpdateRequest(event); return checker.check(); });
  ipcMain.handle('pm:update-open', event => {
    authorizeUpdateRequest(event);
    const state = checker.status();
    if (state.status === 'available') return shell.openExternal(state.latest.url);
  });
  if (!SMOKE) {
    const startupCheck = setTimeout(() => void checker.check(), 15000);
    const periodicCheck = setInterval(() => void checker.check(), 6 * 60 * 60 * 1000);
    app.once('before-quit', () => { clearTimeout(startupCheck); clearInterval(periodicCheck); });
  }
}

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
  // Phase is validated only inside offline smoke, and before the backend starts,
  // so a bad phase writes its result and exits before the harness can time out.
  // A normal launch leaves both gates unset and never enters this branch.
  if (process.env.PM_SMOKE === '1' && process.env.PM_SMOKE_OFFLINE === '1') {
    const decision = classifyLaunch(process.env);
    if (decision.mode === 'rejected') {
      log(decision.error);
      try { writeSmokeRejection(process.env, decision.body, fs.writeFileSync); }
      catch (err) { logErr('could not write smoke result', err); }
      app.exit(1);
      return;
    }
  }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  if (!SMOKE) Menu.setApplicationMenu(null);
  try {
    if (isUltimateEdition && !process.env.PM_USER_DATA) {
      const {prepareUltimateStartup} = await import('./ultimate-migration-startup.js');
      const selected = await prepareUltimateStartup({
        appData: app.getPath('appData'), ultimateDir:userData, platform:process.platform,
        encrypt:value=>safeStorage.encryptString(value),
        log:error=>logErr('legacy migration paused',error),
        showLogs:()=>shell.openPath(logDir),
        prompt:async detail=>{
          const {response}=await dialog.showMessageBox({
            type:'warning', title:'Legacy Owner migration paused',
            message:'Azwah Ultimate could not safely import legacy data.',
            detail:detail + '\\n\\nRetry after closing legacy Owner and its browsers, or start with a separate empty store. Legacy data, vaults, and any existing Ultimate store will be preserved.',
            buttons:['Retry migration','Start Fresh','Open diagnostics','Exit'],defaultId:0,cancelId:3,noLink:true,
          });
          return ['retry','fresh','logs','exit'][response];
        },
      });
      if (!selected) { app.quit(); return; }
      userData=selected;
      process.env.PM_DATA_DIR=path.join(userData,'data');
    }
    await startBackend();
  }
  catch (e) { logErr('backend failed to start', e); dialog.showErrorBox('Azwah Multi Browser could not start', `${e.message}\n\nLog: ${logFile}`); app.exit(1); return; }
  createWindow();
  if (SMOKE) runSmoke().catch(err => { console.error(err); fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify({ error: String(err.stack || err) })); app.quit(); });
});

// ---- smoke-test mode (used by test/electron-smoke.js under xvfb) ----
async function captureInstalledVisuals() {
  const directory = process.env.PM_SMOKE_VISUAL_DIR;
  fs.mkdirSync(directory, { recursive: true });
  const results = [];
  for (const [width, height] of [[1366, 768], [1600, 900], [1920, 1080]]) {
    win.setContentSize(width, height);
    for (const theme of ['light', 'dark']) {
      for (const destination of ['profiles', 'proxies', 'extensions', 'workspaces', 'cookie-robot',
        'license-admin', 'settings', 'diagnostics', 'dashboard', 'monitoring', 'templates', 'trash', 'backup']) {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const theme = ${JSON.stringify(theme)};
          const button = document.querySelector('[aria-label="' + theme[0].toUpperCase() + theme.slice(1) + ' theme"]');
          if (!button) throw new Error('Theme controls unavailable');
          if (document.documentElement.dataset.theme !== theme) button.click();
          const destination = ${JSON.stringify(destination)};
          const nav = document.querySelector('[data-nav="' + destination + '"]');
          if (!nav) throw new Error('Missing navigation item: ' + destination);
          nav.click();
          const expectedPage = destination === 'backup' ? 'settings' : destination;
          for (let attempt = 0; attempt < 50; attempt++) {
            const page = document.querySelector('main[data-shot="' + expectedPage + '"]');
            const ready = destination === 'profiles' ? page?.querySelector('.profiles .launch') :
              destination === 'backup' ? page?.querySelector('#backup') : page?.querySelector('h1');
            if (ready && document.documentElement.dataset.theme === theme) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const content = document.querySelector('.content');
          const sidebar = document.querySelector('.side');
          const launch = document.querySelector('.profiles .col-actions .primary');
          const table = document.querySelector('.profiles')?.closest('.table-wrap');
          const bounds = launch?.getBoundingClientRect();
          const tableBounds = table?.getBoundingClientRect();
          return {
            destination, width: innerWidth, height: innerHeight, theme: document.documentElement.dataset.theme,
            ready: content?.dataset.shot === expectedPage && !!content?.querySelector(destination === 'backup' ? '#backup' : 'h1'),
            sidebar: !!sidebar?.querySelector('[data-nav=profiles]'),
            sidebarOverflow: sidebar ? sidebar.scrollWidth - sidebar.clientWidth : null,
            overflow: content ? content.scrollWidth - content.clientWidth : null,
            tableOverflow: table ? table.scrollWidth - table.clientWidth : null,
            launchVisible: !!bounds && !!tableBounds && bounds.width > 0 &&
              bounds.left >= tableBounds.left && bounds.right <= tableBounds.right,
          };
        })()`);
        results.push(result);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(directory, `${destination}-${width}x${height}-${theme}.png`), image.toPNG());
        if (result.width !== width || result.height !== height || result.theme !== theme ||
            !result.ready || !result.sidebar || result.sidebarOverflow > 1 || result.overflow > 1 ||
            (destination === 'profiles' && (!result.launchVisible || result.tableOverflow > 1))) {
          fs.writeFileSync(path.join(directory, 'layout.json'), JSON.stringify(results, null, 2));
          throw new Error('Installed layout acceptance failed: ' + JSON.stringify(result));
        }
      }
    }
  }
  fs.writeFileSync(path.join(directory, 'layout.json'), JSON.stringify(results, null, 2));
}

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
  if (process.env.AZWAH_STABLE_CHROME_EDITION === '1') {
    const profile = await call('POST', '/api/profiles', { name: 'Stable installer smoke', advancedSettings: { runtime: 'stable-chrome' } });
    if (profile.s !== 201) throw new Error('Installed smoke profile creation failed: ' + JSON.stringify(profile));
    const endpoint = '/api/profiles/' + profile.d.id;
    const launch = await call('POST', endpoint + '/launch', { headless: false, url: 'about:blank' });
    if (launch.s !== 200 || !launch.d?.pid || launch.d?.cdp) throw new Error('Installed Chrome launch failed: ' + JSON.stringify(launch));
    const stopped = await call('POST', endpoint + '/stop');
    if (stopped.s !== 200) throw new Error('Installed Chrome stop failed: ' + JSON.stringify(stopped));
    if (process.env.PM_SMOKE_VISUAL_DIR) await captureInstalledVisuals();
    fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify({ chromeStable: true, pid: launch.d.pid, stopped: true, userData }));
    app.quit();
    return;
  }
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

import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { navigationOrigin, permitsGeolocation, validateEngineConfig, validateProfileId } from './config.js';

const argument = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const verify = process.argv.includes('--azwah-verify');
const qaLog = verify && process.env.AZWAH_ENGINE_QA_LOG;
const stage = message => { if (qaLog) fs.appendFileSync(qaLog, message + '\n'); };

async function start() {
  stage('main entered');
  const id = validateProfileId(argument('--azwah-profile'));
  const initialUrl = argument('--azwah-url');
  const initialOrigin = navigationOrigin(initialUrl, verify);
  if (!initialOrigin || (verify && new URL(initialUrl).hostname !== '127.0.0.1')) throw new Error('Choose a secure starting page.');
  const root = path.join(app.getPath('appData'), 'Azwah Privacy Prototype', id);
  for (const dir of [path.dirname(root), root, path.join(root, 'chromium'), path.join(root, 'session')]) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Linked prototype profile directories are unsupported.');
  }
  const config = validateEngineConfig(JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8')));
  if (config.origin?.startsWith('http:') && !verify) throw new Error('Geolocation permissions require HTTPS.');
  app.setPath('userData', path.join(root, 'chromium'));
  app.setPath('sessionData', path.join(root, 'session'));
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) app.exit(2);
  app.on('window-all-closed', () => app.quit());
  app.on('web-contents-created', (_, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-frame-navigate', event => {
      if (!navigationOrigin(event.url, verify)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!navigationOrigin(url, verify)) event.preventDefault();
    });
  });

  stage('profile configured');
  await app.whenReady();
  stage('app ready');
  const browserSession = session.defaultSession;
  const allowed = (contents, permission, requestingOrigin, isMainFrame) => {
    return Boolean(isMainFrame && contents && permission === 'geolocation' &&
      permitsGeolocation(config, navigationOrigin(requestingOrigin, verify), navigationOrigin(contents.getURL(), verify)));
  };
  browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    allowed(contents, permission, requestingOrigin, details.isMainFrame));
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowed(contents, permission, details.requestingUrl, details.isMainFrame)));
  browserSession.on('will-download', event => event.preventDefault());

  const window = new BrowserWindow({
    width: 1100, height: 760, show: false, autoHideMenuBar: true, title: 'Azwah Privacy Prototype',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false },
  });
  const contents = window.webContents;
  stage('window created');
  // Electron creates the initial renderer lazily. Initialize it with an
  // inert document before attaching the debugger or issuing emulation calls.
  await window.loadURL('about:blank');
  contents.debugger.attach('1.3');
  stage('debugger attached');
  async function emulate(method, options) {
    let timeout;
    try {
      await Promise.race([
        contents.debugger.sendCommand(method, options),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(method + ' did not respond.')), 10000); }),
      ]);
    } finally { clearTimeout(timeout); }
  }
  if (config.timezone) await emulate('Emulation.setTimezoneOverride', { timezoneId: config.timezone });
  if (config.location) await emulate('Emulation.setGeolocationOverride', config.location);
  contents.debugger.on('detach', () => { if (!contents.isDestroyed()) window.close(); });
  contents.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); });
  stage('emulation installed');
  await window.loadURL(initialUrl);
  stage('fixture navigation complete');
  window.show();

  if (!verify) return;
  const marker = argument('--azwah-fixture-marker');
  if (marker && !/^[A-Za-z0-9_-]{1,80}$/.test(marker)) throw new Error('Invalid test marker.');
  if (navigationOrigin(contents.getURL(), true) !== initialOrigin) throw new Error('Fixture origin changed.');
  const before = await contents.executeJavaScript(`(async () => {
    const position = await new Promise(resolve => navigator.geolocation.getCurrentPosition(
      ({coords}) => resolve({latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy}),
      ({code}) => resolve({error: code}), {timeout: 8000}));
    return {
      position, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language, languages: navigator.languages, platform: navigator.platform,
      userAgent: navigator.userAgent, nodeExposed: typeof globalThis.require !== 'undefined',
      cookie: document.cookie, stored: localStorage.getItem('azwah_fixture'),
      camera: (await navigator.permissions.query({name: 'camera'})).state,
    };
  })()`);
  stage('browser observations collected');
  if (marker) {
    const value = JSON.stringify(marker);
    await contents.executeJavaScript(`localStorage.setItem('azwah_fixture', ${value}); document.cookie = 'azwah_fixture=' + ${value} + '; Max-Age=3600; SameSite=Strict';`);
    await browserSession.cookies.flushStore();
    browserSession.flushStorageData();
  }
  const renderer = app.getAppMetrics().find(metric => metric.pid === contents.getOSProcessId());
  const evidence = {
    executable: process.execPath, chromium: process.versions.chrome, electron: process.versions.electron,
    packaged: app.isPackaged, sandboxed: renderer?.sandboxed ?? null, ...before,
  };
  const temporary = path.join(root, 'evidence.pending');
  fs.writeFileSync(temporary, JSON.stringify(evidence), { flag: 'wx' });
  fs.renameSync(temporary, path.join(root, 'evidence.json'));
  if (!process.argv.includes('--azwah-fixture-hold')) app.quit();
}

start().catch(error => {
  stage('Prototype failed: ' + error.message);
  console.error('Prototype failed:', error.message);
  app.exit(1);
});

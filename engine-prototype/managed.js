import { app, BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navigationOrigin, validateEngineConfig } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isolated = { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false };

export async function startManaged(request, stage) {
  stage('managed entry');
  const root = path.dirname(request);
  if (path.basename(root) !== 'privacy-engine' || !/^[0-9a-f-]{36}\.json$/i.test(path.basename(request))) throw new Error('Invalid profile handoff.');
  const control = request.slice(0, -5);
  const data = JSON.parse(fs.readFileSync(request, 'utf8'));
  fs.unlinkSync(request);
  const { timezone, location } = validateEngineConfig({ version: data.version, timezone: data.timezone, location: data.location });
  for (const folder of [root, path.join(root, 'chromium'), path.join(root, 'session')]) {
    fs.mkdirSync(folder, { recursive: true });
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('Linked engine data directory.');
  }
  app.setPath('userData', path.join(root, 'chromium'));
  app.setPath('sessionData', path.join(root, 'session'));
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) { app.exit(2); return; }
  await app.whenReady();
  stage('Electron ready');

  const web = session.defaultSession;
  const proxy = data.proxyRules ? new URL(data.proxyRules) : null;
  if (proxy && (!['http:', 'https:', 'socks5:'].includes(proxy.protocol) || proxy.username || proxy.password ||
      proxy.pathname !== '' && proxy.pathname !== '/' || proxy.search || proxy.hash)) throw new Error('Invalid proxy handoff.');
  if (proxy) {
    await web.setProxy({ mode: 'fixed_servers', proxyRules: data.proxyRules, proxyBypassRules: '<-loopback>' });
    await web.closeAllConnections();
  }
  const allowedUrl = value => {
    const origin = navigationOrigin(value, data.verify === true);
    return data.verify === true && origin && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin) ? null : origin;
  };
  const window = new BrowserWindow({
    width: 1150, height: 780, show: false, title: 'Azwah Privacy Engine', autoHideMenuBar: true,
    webPreferences: { ...isolated, partition: 'azwah-trusted-toolbar', preload: path.join(here, 'toolbar-preload.cjs') },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('page-title-updated', event => event.preventDefault());

  const tabs = [];
  let active = 0;
  let closed = false;
  let starting = false;
  const permissions = new Set();
  const permissionKey = (contents, origin) => contents.id + ':' + origin;
  const eligible = (contents, permission, origin, details) => Boolean(location && !data.denyGeolocation &&
    contents && permission === 'geolocation' && details.isMainFrame && allowedUrl(origin) === allowedUrl(contents.getURL()) && allowedUrl(origin));
  web.setPermissionCheckHandler((contents, permission, origin, details) =>
    eligible(contents, permission, origin, details) && permissions.has(permissionKey(contents, allowedUrl(origin))));
  web.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!eligible(contents, permission, details.requestingUrl, details)) { callback(false); return; }
    const origin = allowedUrl(details.requestingUrl);
    if (data.verify === true) {
      permissions.add(permissionKey(contents, origin));
      callback(true);
      return;
    }
    // Native dialog is outside page control. Recheck the origin after the decision.
    import('electron').then(({ dialog }) => dialog.showMessageBox(window, {
      type: 'question', message: 'Share configured location with this site?', detail: origin,
      buttons: ['Block', 'Allow for this tab'], defaultId: 0, cancelId: 0,
    })).then(({ response }) => {
      const allow = response === 1 && !contents.isDestroyed() && allowedUrl(contents.getURL()) === origin;
      if (allow) permissions.add(permissionKey(contents, origin));
      callback(allow);
    }).catch(() => callback(false));
  });
  web.on('will-download', event => event.preventDefault());

  function layout() {
    if (closed) return;
    const [width, height] = window.getContentSize();
    tabs.forEach((tab, index) => {
      tab.setVisible(index === active);
      tab.setBounds({ x: 0, y: 88, width, height: Math.max(0, height - 88) });
    });
  }
  function snapshot() {
    if (closed) return;
    window.webContents.send('azwah-toolbar-state', { active, tabs: tabs.map(tab => ({
      url: allowedUrl(tab.webContents.getURL()) ? tab.webContents.getURL() : '',
    })) });
  }
  async function navigate(contents, value) {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a valid address.');
    const url = /^https?:\/\//i.test(value) ? value : 'https://' + value;
    if (!allowedUrl(url)) throw new Error('Only secure HTTPS addresses are supported.');
    await contents.loadURL(url);
  }
  async function addTab(url) {
    if (starting || tabs.length >= 20) return;
    starting = true;
    const tab = new WebContentsView({ webPreferences: { ...isolated, session: web } });
    tab.setVisible(false);
    window.contentView.addChildView(tab);
    const contents = tab.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    for (const eventName of ['will-frame-navigate', 'will-redirect']) {
      contents.on(eventName, (event, urlValue) => { if (!allowedUrl(event.url || urlValue)) event.preventDefault(); });
    }
    for (const name of ['did-navigate', 'did-navigate-in-page', 'did-fail-load']) contents.on(name, snapshot);
    contents.on('render-process-gone', () => app.exit(1));
    try {
      await contents.loadURL('about:blank');
      if (timezone || location) {
        contents.debugger.attach('1.3');
        contents.debugger.on('detach', () => { if (!closed && tabs.includes(tab)) app.exit(1); });
        if (timezone) {
          try { await contents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: timezone }); }
          catch (error) {
            // Tabs sharing a renderer also share its timezone override. Every
            // tab in this process uses the same configured profile timezone.
            if (!/Timezone override is already in effect/i.test(error.message)) throw error;
          }
        }
        if (location) await contents.debugger.sendCommand('Emulation.setGeolocationOverride', location);
      }
      tabs.push(tab);
      active = tabs.length - 1;
      layout();
      snapshot();
      if (url) await navigate(contents, url);
    } catch (error) {
      const index = tabs.indexOf(tab);
      if (index >= 0) tabs.splice(index, 1);
      active = Math.max(0, tabs.length - 1);
      window.contentView.removeChildView(tab);
      contents.close();
      layout();
      snapshot();
      throw error;
    } finally { starting = false; }
  }
  window.on('resize', layout);
  ipcMain.handle('azwah-toolbar', async (event, action, value) => {
    if (closed || event.sender !== window.webContents || event.senderFrame?.parent !== null) throw new Error('Invalid toolbar sender.');
    if (action === 'state') { snapshot(); return; }
    if (action === 'new') {
      try { await addTab(); } catch (error) { stage('New tab failed: ' + error.message); throw error; }
      return;
    }
    const tab = tabs[active];
    if (!tab) return;
    if (action === 'navigate') await navigate(tab.webContents, value);
    else if (action === 'back' && tab.webContents.navigationHistory.canGoBack()) tab.webContents.navigationHistory.goBack();
    else if (action === 'forward' && tab.webContents.navigationHistory.canGoForward()) tab.webContents.navigationHistory.goForward();
    else if (action === 'reload') tab.webContents.reload();
    else if (action === 'select' && Number.isInteger(value) && tabs[value]) { active = value; layout(); }
    else if (action === 'close' && tabs.length > 1) {
      tabs.splice(active, 1);
      window.contentView.removeChildView(tab);
      tab.webContents.close();
      active = Math.min(active, tabs.length - 1);
      layout();
    }
    snapshot();
  });
  stage('toolbar loading');
  if (data.verify === true) window.webContents.on('console-message', event => stage('Toolbar console: ' + event.message));
  await window.loadFile(path.join(here, 'toolbar.html'));
  stage('toolbar loaded');
  await addTab(data.url);
  stage('first tab loaded');
  window.show();
  window.on('closed', () => {
    closed = true;
    for (const tab of tabs) if (!tab.webContents.isDestroyed()) tab.webContents.close();
    app.quit();
  });
  setInterval(() => { if (fs.existsSync(control + '.stop')) window.close(); }, 250).unref();
  if (data.verify === true) {
    const observe = tab => tab.webContents.executeJavaScript(`(async () => ({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cookie: document.cookie, storage: localStorage.getItem('qa'), previous: globalThis.before ?? null,
      position: await new Promise(resolve => navigator.geolocation.getCurrentPosition(
        ({coords}) => resolve([coords.latitude,coords.longitude,coords.accuracy]),
        ({code}) => resolve([code]), {timeout: 5000})),
      node: typeof require,
    }))()`);
    const first = await observe(tabs[0]);
    stage('first tab observed');
    async function until(predicate) {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Toolbar action did not complete. ' +
          await window.webContents.executeJavaScript('JSON.stringify({ bridge: typeof window.azwahControls, status: document.querySelector("#status").textContent })'));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    await window.webContents.executeJavaScript('document.querySelector("[data-action=new]").click(); void 0');
    await until(() => tabs.length === 2);
    stage('toolbar created second tab');
    await window.webContents.executeJavaScript(`document.querySelector('#address').value = ${JSON.stringify(data.url)};
      document.querySelector('#navigation').requestSubmit(); void 0`);
    await until(() => tabs[1].webContents.getURL() === data.url && !tabs[1].webContents.isLoading());
    const second = await observe(tabs[1]);
    const ui = await window.webContents.executeJavaScript('({ address: document.querySelector("#address").value, tabs: document.querySelector("#tabs").children.length })');
    const renderer = app.getAppMetrics().find(metric => metric.pid === tabs[0].webContents.getOSProcessId());
    web.flushStorageData();
    await web.cookies.flushStore();
    fs.writeFileSync(control + '.evidence', JSON.stringify({ first, second, ui, pid: process.pid,
      sandboxed: renderer?.sandboxed, chromium: process.versions.chrome, executable: process.execPath }), { flag: 'wx' });
  }
  fs.writeFileSync(control + '.ready', '', { flag: 'wx' });
}

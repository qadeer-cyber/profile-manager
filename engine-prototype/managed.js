import { app, BrowserWindow, WebContentsView, dialog, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedicatedExtensionIssue } from './extension-policy.js';
import { PROXY_IDENTITY_EXIT, observeBrowserProxyExit, verifyBrowserProxyExit } from './proxy-identity.js';
import { verifyBrowserLocation } from './location-verification.js';
import { openBrowserState } from './browser-state.js';
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
  if (data.proxyRules) {
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
    app.commandLine.appendSwitch('disable-quic');
    app.commandLine.appendSwitch('dns-prefetch-disable');
  }
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) { app.exit(2); return; }
  await app.whenReady();
  stage('Electron ready');

  const { state, update } = openBrowserState(root);
  const downloads = [];
  const web = session.defaultSession;
  const proxy = data.proxyRules ? new URL(data.proxyRules) : null;
  if (proxy && (!['http:', 'https:', 'socks5:'].includes(proxy.protocol) || proxy.username || proxy.password ||
      proxy.pathname !== '' && proxy.pathname !== '/' || proxy.search || proxy.hash)) throw new Error('Invalid proxy handoff.');
  if (proxy) {
    await web.setProxy({ mode: 'fixed_servers', proxyRules: data.proxyRules, proxyBypassRules: '<-loopback>' });
    await web.closeAllConnections();
  }
  if (data.expectedProxyExit) {
    if (!proxy) throw new Error('Follow Proxy requires a fixed browser proxy.');
    const failIdentity = () => {
      web.webRequest.onBeforeRequest((_, callback) => callback({ cancel: true }));
      app.exit(PROXY_IDENTITY_EXIT);
    };
    const verifyExit = () => verifyBrowserProxyExit(web, data.expectedProxyExit);
    try {
      await verifyExit();
      await verifyBrowserLocation(web, isolated, timezone, location);
    }
    catch { failIdentity(); return; }
    const refresh = () => setTimeout(async () => {
      try { await verifyExit(); refresh(); }
      catch { failIdentity(); }
    }, 30000).unref();
    refresh();
    setInterval(() => { if (fs.existsSync(control + '.invalidate')) failIdentity(); }, 250).unref();
  }
  const loadedExtensions = [];
  const extensionRoot = path.join(path.dirname(path.dirname(path.dirname(root))), 'extensions');
  for (const extensionPath of data.extensions || []) {
    if (path.dirname(extensionPath).toLowerCase() !== extensionRoot.toLowerCase() ||
        fs.lstatSync(extensionPath).isSymbolicLink()) throw new Error('Invalid managed extension path.');
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
    const reason = dedicatedExtensionIssue(manifest);
    if (reason) {
      loadedExtensions.push({ name: String(manifest.name).slice(0, 128), status: reason });
      continue;
    }
    try {
      const extension = await web.extensions.loadExtension(extensionPath, { allowFileAccess: false });
      loadedExtensions.push({ name: extension.name, status: 'Loaded' });
    } catch {
      loadedExtensions.push({ name: String(manifest.name).slice(0, 128), status: 'Chromium declined to load this extension' });
    }
  }

  const allowedUrl = value => {
    const origin = navigationOrigin(value, data.verify === true);
    return data.verify === true && origin && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin) ? null : origin;
  };
  const window = new BrowserWindow({
    width: 1150, height: 780, show: false, title: 'Azwah Privacy Engine (experimental)', autoHideMenuBar: true,
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
  const pageErrors = new WeakMap();
  let networkDiagnostic;
  const permissionKey = (contents, origin) => contents.id + ':' + origin;
  const eligible = (contents, permission, origin, details) => Boolean(location && !data.denyGeolocation &&
    contents && permission === 'geolocation' && details.isMainFrame && allowedUrl(origin) === allowedUrl(contents.getURL()) && allowedUrl(origin));
  web.setPermissionCheckHandler((contents, permission, origin, details) =>
    eligible(contents, permission, origin, details) &&
    (data.verify === true || permissions.has(permissionKey(contents, allowedUrl(origin)))));
  web.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!eligible(contents, permission, details.requestingUrl, details)) { callback(false); return; }
    const origin = allowedUrl(details.requestingUrl);
    if (data.verify === true) {
      permissions.add(permissionKey(contents, origin));
      callback(true);
      return;
    }
    // Native dialog is outside page control. Recheck the origin after the decision.
    dialog.showMessageBox(window, {
      type: 'question', message: 'Share configured location with this site?', detail: origin,
      buttons: ['Block', 'Allow for this tab'], defaultId: 0, cancelId: 0,
    }).then(({ response }) => {
      const allow = response === 1 && !contents.isDestroyed() && allowedUrl(contents.getURL()) === origin;
      if (allow) permissions.add(permissionKey(contents, origin));
      callback(allow);
    }).catch(() => callback(false));
  });
  web.on('will-download', (event, item, contents) => {
    if (!tabs.some(tab => tab.webContents === contents) || !allowedUrl(item.getURL())) {
      event.preventDefault();
      return;
    }
    const entry = { name: item.getFilename(), status: 'in progress' };
    downloads.unshift(entry);
    if (downloads.length > 50) downloads.pop();
    item.setSaveDialogOptions({ title: 'Save download' });
    item.once('done', (_, result) => { entry.status = result; snapshot(); });
    snapshot();
  });

  function layout() {
    if (closed) return;
    const [width, height] = window.getContentSize();
    tabs.forEach((tab, index) => {
      tab.setVisible(index === active);
      tab.setBounds({ x: 0, y: 122, width, height: Math.max(0, height - 122) });
    });
  }
  function snapshot() {
    if (closed) return;
    window.webContents.send('azwah-toolbar-state', { active, tabs: tabs.map(tab => ({
      url: allowedUrl(tab.webContents.getURL()) ? tab.webContents.getURL() : '',
      error: pageErrors.get(tab.webContents),
    })), networkDiagnostic, bookmarks: state.bookmarks, history: state.history, downloads, extensions: loadedExtensions });
  }
  let restoring = true;
  function persistTabs() {
    if (restoring || closed || data.verify) return;
    update({ tabs: tabs.map(tab => tab.webContents.getURL()) });
  }
  const locationRefresh = new WeakMap();
  async function navigate(contents, value) {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a valid address.');
    const url = /^https?:\/\//i.test(value) ? value : 'https://' + value;
    if (!allowedUrl(url)) throw new Error('Only secure HTTPS addresses are supported.');
    pageErrors.delete(contents);
    await contents.loadURL(url);
    await locationRefresh.get(contents);
  }
  async function addTab(url) {
    if (starting || tabs.length >= 20) return;
    starting = true;
    const tab = new WebContentsView({ webPreferences: {
      ...isolated, session: web,
      // Native window occlusion must not suspend an active profile's
      // location requests just because another profile is in front.
      backgroundThrottling: false,
    } });
    tab.setVisible(false);
    window.contentView.addChildView(tab);
    const contents = tab.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    for (const eventName of ['will-frame-navigate', 'will-redirect']) {
      contents.on(eventName, (event, urlValue) => { if (!allowedUrl(event.url || urlValue)) event.preventDefault(); });
    }
    for (const name of ['did-navigate', 'did-navigate-in-page']) contents.on(name, (_, url) => {
      if (!restoring && !data.verify && allowedUrl(url)) {
        try {
          update({ tabs: tabs.map(tab => tab.webContents.getURL()), history: [url, ...state.history.filter(item => item !== url)] });
        } catch { stage('Browser history could not be saved.'); }
      }
      snapshot();
    });
    contents.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isInPlace) pageErrors.delete(contents);
    });
    contents.on('did-fail-load', (_, code, description, __, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      pageErrors.set(contents, /^[A-Z_]+$/.test(description) ? description : 'Navigation failed');
      snapshot();
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.shift) return;
      const key = input.key.toLowerCase();
      if (key === 't' || key === 'w' || key === 'r') {
        event.preventDefault();
        if (key === 't') addTab().catch(() => stage('New tab failed.'));
        if (key === 'w' && tabs.length > 1) closeTab(active);
        if (key === 'r') contents.reload();
      }
      if (key === 'l') {
        event.preventDefault();
        window.webContents.focus();
        window.webContents.send('azwah-toolbar-focus');
      }
    });
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
        if (location) {
          const applyLocation = () => contents.debugger.sendCommand('Emulation.setGeolocationOverride', location);
          await applyLocation();
          contents.on('dom-ready', () => {
            const pending = applyLocation();
            locationRefresh.set(contents, pending);
            pending.catch(() => { if (!contents.isDestroyed()) app.exit(1); });
          });
        }
      }
      if (timezone) {
        const observed = await contents.executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone');
        const expected = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
        if (observed !== expected) throw new Error('Chromium did not apply the configured timezone.');
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
  function closeTab(index) {
    const [tab] = tabs.splice(index, 1);
    window.contentView.removeChildView(tab);
    tab.webContents.close();
    active = Math.min(index, tabs.length - 1);
    layout();
    persistTabs();
    snapshot();
  }
  window.on('resize', layout);
  ipcMain.handle('azwah-toolbar', async (event, action, value) => {
    if (closed || event.sender !== window.webContents || event.senderFrame?.parent !== null) throw new Error('Invalid toolbar sender.');
    if (action === 'state') { snapshot(); return; }
    if (action === 'new') {
      try { await addTab(); } catch (error) { stage('New tab failed: ' + error.message); throw error; }
      return;
    }
    if (action === 'network') {
      if (!proxy) { networkDiagnostic = 'No profile proxy configured.'; snapshot(); return; }
      try {
        const exit = data.expectedProxyExit
          ? await verifyBrowserProxyExit(web, data.expectedProxyExit) : await observeBrowserProxyExit(web);
        networkDiagnostic = 'Chromium observed ' + exit + ' through the configured proxy. DNS and WebRTC exposure are not measured by this check.';
      } catch {
        networkDiagnostic = 'Chromium could not confirm the proxy exit.';
      }
      snapshot();
      return;
    }
    const tab = tabs[active];
    if (!tab) return;
    if (action === 'navigate') await navigate(tab.webContents, value);
    else if (action === 'bookmark') {
      const url = tab.webContents.getURL();
      if (allowedUrl(url) && !data.verify) {
        update({ bookmarks: state.bookmarks.includes(url)
          ? state.bookmarks.filter(item => item !== url) : [url, ...state.bookmarks] });
      }
    }
    else if (action === 'back' && tab.webContents.navigationHistory.canGoBack()) tab.webContents.navigationHistory.goBack();
    else if (action === 'forward' && tab.webContents.navigationHistory.canGoForward()) tab.webContents.navigationHistory.goForward();
    else if (action === 'reload') tab.webContents.reload();
    else if (action === 'select' && Number.isInteger(value) && tabs[value]) { active = value; layout(); }
    else if (action === 'close' && tabs.length > 1) closeTab(active);
    snapshot();
  });
  stage('toolbar loading');
  if (data.verify === true) window.webContents.on('console-message', event => stage('Toolbar console: ' + event.message));
  await window.loadFile(path.join(here, 'toolbar.html'));
  stage('toolbar loaded');
  const startup = data.url ? [data.url] : state.tabs.length ? [...state.tabs] : [null];
  for (const url of startup) {
    try { await addTab(url); }
    catch (error) {
      if (data.verify) throw error;
      stage('A startup page could not be restored.');
    }
  }
  if (!tabs.length) await addTab();
  restoring = false;
  persistTabs();
  stage('first tab loaded');
  window.show();
  window.on('closed', () => {
    closed = true;
    for (const tab of tabs) if (!tab.webContents.isDestroyed()) tab.webContents.close();
    app.quit();
  });
  setInterval(() => { if (fs.existsSync(control + '.stop')) window.close(); }, 250).unref();
  if (data.verify === true) {
    const observe = async tab => {
      await locationRefresh.get(tab.webContents);
      if (loadedExtensions.some(extension => extension.status === 'Loaded')) {
        const deadline = Date.now() + 5000;
        while (!(await tab.webContents.executeJavaScript("document.documentElement.hasAttribute('data-azwah-extension-qa')")) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      return tab.webContents.executeJavaScript(`(async () => ({
      visibility: document.visibilityState,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cookie: document.cookie, storage: localStorage.getItem('qa'), previous: globalThis.before ?? null,
      position: await new Promise(resolve => navigator.geolocation.getCurrentPosition(
        ({coords}) => resolve([coords.latitude,coords.longitude,coords.accuracy]),
        ({code}) => resolve([code]), {timeout: 5000})),
      node: typeof require, extensionMarker: document.documentElement.getAttribute('data-azwah-extension-qa'),
    }))()`);
    };
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

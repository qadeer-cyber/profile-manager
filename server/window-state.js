import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { userDataDir } from './db.js';
import { assertProfileOperationAvailable } from './recovery-journal.js';
import { observeNativeWindow, restoreNativeWindow } from './native-window-state.js';
import { assessWindowPlacement, readHostDisplays } from './window-placement.js';
const FILE = '.pm-window.json';
export function normalizeWindowState(value) {
  if (!value || typeof value !== 'object' || !['width','height','left','top'].every(k => Number.isInteger(value[k]))) return null;
  if (value.width < 320 || value.width > 7680 || value.height < 240 || value.height > 4320 || value.left < -32768 || value.left > 32767 || value.top < -32768 || value.top > 32767 || typeof value.maximized !== 'boolean') return null;
  return { width: value.width, height: value.height, left: value.left, top: value.top, maximized: value.maximized, source: ['cdp-browser-window','win32-placement','x11-window-manager'].includes(value.source) ? value.source : 'legacy', ...(typeof value.savedAt === 'string' && { savedAt: value.savedAt }) };
}
export function windowStatePath(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid profile identity');
  return path.join(userDataDir(id), FILE);
}
export function readWindowState(id) {
  try { const file = windowStatePath(id); if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) return null; const st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink() || st.size > 4096) return null; return normalizeWindowState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}
export function writeWindowState(id, value) {
  const state = normalizeWindowState(value); if (!state) throw Error('Invalid observed window state');
  assertProfileOperationAvailable(id);
  const file = windowStatePath(id), dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Refusing symlink profile directory');
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'; let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ ...state, savedAt: new Date().toISOString() })); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
}
export async function captureWindowStateForSession(id, entry) {
  if (!entry?.rememberWindow || entry.diagnosticHeadless) return null;
  let state;
  try { if (entry.browserPid) state = await observeNativeWindow(entry.browserPid); } catch { /* try browser protocol */ }
  if (!state && entry.engine !== 'firefox') {
    let browser, session;
    try {
      let page = entry.ctx?.pages()?.[0];
      if (!page && entry.cdp_port) { browser = await chromium.connectOverCDP(`http://127.0.0.1:${entry.cdp_port}`, { timeout: 2000 }); page = browser.contexts()[0]?.pages()[0]; }
      if (page) {
        session = await page.context().newCDPSession(page);
        const { bounds } = await session.send('Browser.getWindowForTarget');
        const previous = readWindowState(id);
        state = { width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top, maximized: bounds.windowState === 'maximized', source: 'cdp-browser-window' };
        if (state.maximized && previous) state = { ...previous, maximized: true, source: state.source };
        if (['minimized', 'fullscreen'].includes(bounds.windowState)) state = null;
      }
    } catch { /* unavailable observation never overwrites the saved record */ }
    finally { await session?.detach().catch(() => {}); await browser?.close().catch(() => {}); }
  }
  const normalized = normalizeWindowState(state);
  if (normalized && !entry.closed) { writeWindowState(id, normalized); return normalized; }
  return null;
}
export function clampRememberedWindow(saved, displays) {
  const state = normalizeWindowState(saved); if (!state) return null;
  const placement = assessWindowPlacement({ width: state.width, height: state.height, windowX: state.left, windowY: state.top }, displays);
  return { ...state, left: placement.windowX, top: placement.windowY };
}
export function applyRememberedWindow(advancedSettings) { return advancedSettings; }
export function screenFromRememberedWindow(id, advancedSettings) {
  const base = advancedSettings?.screen || {};
  if (!advancedSettings?.preferences?.rememberLastWindow) return advancedSettings?.screen;
  const saved = clampRememberedWindow(readWindowState(id), readHostDisplays());
  if (!saved || base.startMaximized) return advancedSettings?.screen;
  return { ...base, preset: 'custom', width: saved.width, height: saved.height,
    viewportWidth: Math.min(saved.width, base.viewportWidth || saved.width), viewportHeight: Math.min(saved.height, base.viewportHeight || saved.height),
    windowX: saved.maximized ? null : saved.left, windowY: saved.maximized ? null : saved.top, startMaximized: saved.maximized };
}
export function monitorWindowState(id, entry) {
  if (!entry.rememberWindow || entry.diagnosticHeadless) return;
  let busy = false;
  const saved = clampRememberedWindow(readWindowState(id), readHostDisplays());
  let restorePending = !!saved, attempts = 0;
  const tick = async () => {
    if (busy || entry.stopping || entry.closed) return;
    busy = true;
    try {
      if (restorePending) { attempts++; restorePending = !(await restoreNativeWindow(entry.browserPid, saved)) && attempts < 3; }
      if (!restorePending) await captureWindowStateForSession(id, entry);
    } catch { if (++attempts >= 3) restorePending = false; }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 3000); timer.unref();
  entry.stopWindowTracking = () => clearInterval(timer);
  entry.proc?.once('exit', entry.stopWindowTracking);
  entry.ctx?.once('close', entry.stopWindowTracking);
  void tick();
}

// Persist last observed browser window bounds per profile (local file, optional preference).
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { userDataDir } from './db.js';
import { locateRunningBrowserSession } from './browser-window-actions.js';

const FILE = '.pm-window.json';

export function windowStatePath(profileId) {
  return path.join(userDataDir(profileId), FILE);
}

export function readWindowState(profileId) {
  try {
    const p = windowStatePath(profileId);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeWindowState(profileId, state) {
  const p = windowStatePath(profileId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 0), { mode: 0o600 });
}

/** Capture bounds from CDP, Win32 main window, or Playwright pages (best effort). */
export async function captureWindowStateForSession(profileId, entry) {
  if (!entry?.rememberWindow) return null;
  let state = null;
  if (entry.cdp_port) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${entry.cdp_port}`);
      try {
        const target = browser.contexts()[0]?.pages()?.[0];
        if (target) {
          state = await target.evaluate(() => ({
            width: window.outerWidth,
            height: window.outerHeight,
            left: window.screenX,
            top: window.screenY,
            maximized: false,
          }));
        }
      } finally {
        await browser.close();
      }
    } catch { /* fall through */ }
  }
  if (!state && entry.browserPid && process.platform === 'win32') {
    try {
      const loc = await locateRunningBrowserSession({ pid: entry.browserPid, cdpPort: null });
      if (loc.rect?.width && loc.rect.height) {
        state = {
          width: loc.rect.width,
          height: loc.rect.height,
          left: loc.rect.left,
          top: loc.rect.top,
          maximized: false,
        };
      }
    } catch { /* ignore */ }
  }
  if (state?.width > 0 && state.height > 0) {
    writeWindowState(profileId, state);
    return state;
  }
  return null;
}

/** Merge saved bounds into advanced screen settings when rememberLastWindow is enabled. */
export function applyRememberedWindow(advancedSettings) {
  const prefs = advancedSettings?.preferences || {};
  if (!prefs.rememberLastWindow) return advancedSettings;
  return advancedSettings;
}

export function screenFromRememberedWindow(profileId, advancedSettings) {
  const prefs = advancedSettings?.preferences || {};
  if (!prefs.rememberLastWindow) return advancedSettings?.screen;
  const saved = readWindowState(profileId);
  if (!saved?.width || !saved.height) return advancedSettings?.screen;
  const base = advancedSettings?.screen || {};
  if (base.startMaximized) return base;
  return {
    ...base,
    preset: 'custom',
    width: saved.width,
    height: saved.height,
    viewportWidth: Math.min(saved.width, base.viewportWidth || saved.width),
    viewportHeight: Math.min(saved.height, base.viewportHeight || saved.height),
    windowX: saved.left ?? base.windowX,
    windowY: saved.top ?? base.windowY,
    startMaximized: !!saved.maximized,
  };
}

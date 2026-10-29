// Opt-in list of tabs to reopen after a graceful stop or a last-window close.
// The list lives in the profile directory, not in the database, and it is not a
// browser fingerprint. Crash classification does not write it.
import fs from 'fs';
import path from 'path';

export const TAB_STATE_NAME = '.pm-tabs.json';
export const MAX_RESTORED_TABS = 20;

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i;

export function eligibleTabUrl(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  if (text.includes('pm-diagnostics-v1')) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || LOOPBACK.test(host) || host.endsWith('.localhost')) return null;
  return url.href;
}

function stateFile(dir) {
  const root = path.resolve(dir);
  const file = path.join(root, TAB_STATE_NAME);
  if (path.dirname(file) !== root) {
    throw Object.assign(new Error('Refusing to read tab state outside the profile'), { status: 500, code: 'TAB_STATE_PATH' });
  }
  return file;
}

export function readSavedTabs(dir) {
  let file;
  try { file = stateFile(dir); } catch { return { urls: [], corrupt: true }; }
  if (!fs.existsSync(file)) return { urls: [], corrupt: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.urls)) return { urls: [], corrupt: true };
    const urls = [];
    for (const item of parsed.urls) {
      const eligible = eligibleTabUrl(item);
      if (eligible && !urls.includes(eligible)) urls.push(eligible);
      if (urls.length >= MAX_RESTORED_TABS) break;
    }
    return { urls, corrupt: false };
  } catch {
    return { urls: [], corrupt: true };
  }
}

export function writeSavedTabs(dir, urls) {
  const file = stateFile(dir);
  const saved = [];
  for (const item of urls || []) {
    const eligible = eligibleTabUrl(item);
    if (eligible && !saved.includes(eligible)) saved.push(eligible);
    if (saved.length >= MAX_RESTORED_TABS) break;
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, urls: saved }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return saved;
}

// null means there is no open page, so the caller keeps the previous list.
// An empty array means pages are open and none of them are eligible.
export function snapshotTabUrls(pages) {
  const open = [];
  for (const page of pages || []) {
    try { if (page?.isClosed?.()) continue; } catch { continue; }
    open.push(page);
  }
  if (!open.length) return null;
  const urls = [];
  for (const page of open) {
    let raw = '';
    try { raw = typeof page.url === 'function' ? page.url() : ''; } catch { raw = ''; }
    const eligible = eligibleTabUrl(raw);
    if (eligible && !urls.includes(eligible)) urls.push(eligible);
    if (urls.length >= MAX_RESTORED_TABS) break;
  }
  return urls;
}

// An explicit launch URL wins. Startup URLs win over the saved list.
// Saved tabs are not added beside either of those, so the launch does not
// open the same kind of page twice.
export function chooseLaunchUrls({ explicitUrl, startupUrls, savedUrls } = {}) {
  const explicit = typeof explicitUrl === 'string' ? explicitUrl.trim() : '';
  if (explicit) return [explicit];
  if (Array.isArray(startupUrls) && startupUrls.length) return startupUrls.slice();
  return Array.isArray(savedUrls) ? savedUrls.slice(0, MAX_RESTORED_TABS) : [];
}

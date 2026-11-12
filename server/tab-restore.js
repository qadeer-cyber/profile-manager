// Opt-in list of tabs to reopen after a graceful stop or a last-window close.
// The list lives in the profile directory, not in the database, and it is not a
// browser fingerprint. Crash classification does not write it.
import fs from 'fs';
import { BlockList, isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'path';

export const TAB_STATE_NAME = '.pm-tabs.json';
export const MAX_RESTORED_TABS = 20;

const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_STABLE_TABS = 1000;
const localAddresses = new BlockList();
localAddresses.addSubnet('127.0.0.0', 8);
localAddresses.addAddress('0.0.0.0');
localAddresses.addAddress('::', 'ipv6');
localAddresses.addAddress('::1', 'ipv6');

export function eligibleTabUrl(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  if (text.includes('pm-diagnostics-v1')) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  const family = isIP(host);
  if (!host || host === 'localhost' || host.endsWith('.localhost') ||
      (family && localAddresses.check(host, family === 6 ? 'ipv6' : 'ipv4'))) return null;
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

function readBoundedState(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const { size } = stat;
    if (!stat.isFile() || !size || size > MAX_STATE_BYTES) throw new Error('Invalid tab checkpoint size');
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== size) throw new Error('Tab checkpoint changed while reading');
    return JSON.parse(bytes.toString('utf8', 0, size));
  } finally {
    fs.closeSync(fd);
  }
}

export function readSavedTabs(dir, { preserveDuplicates = false } = {}) {
  let file;
  try { file = stateFile(dir); } catch { return { urls: [], corrupt: true }; }
  if (!fs.existsSync(file)) return { urls: [], corrupt: false };
  try {
    const parsed = readBoundedState(file);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.urls) || parsed.urls.length > MAX_STABLE_TABS) return { urls: [], corrupt: true };
    const urls = [];
    for (const item of parsed.urls) {
      const eligible = eligibleTabUrl(item);
      if (eligible && (preserveDuplicates || !urls.includes(eligible))) urls.push(eligible);
      if (!preserveDuplicates && urls.length >= MAX_RESTORED_TABS) break;
    }
    return { urls, corrupt: false };
  } catch {
    return { urls: [], corrupt: true };
  }
}

export function writeSavedTabs(dir, urls, { preserveDuplicates = false } = {}) {
  const file = stateFile(dir);
  const saved = [];
  for (const item of urls || []) {
    const eligible = eligibleTabUrl(item);
    if (eligible && (preserveDuplicates || !saved.includes(eligible))) saved.push(eligible);
    if (!preserveDuplicates && saved.length >= MAX_RESTORED_TABS) break;
  }
  if (preserveDuplicates && !saved.length) return saved;
  const encoded = JSON.stringify({ version: 1, urls: saved });
  if (saved.length > MAX_STABLE_TABS || Buffer.byteLength(encoded) > MAX_STATE_BYTES) {
    throw new RangeError('Tab checkpoint exceeds its storage limit');
  }
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, encoded, { mode: 0o600, flag: 'wx', flush: true });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return saved;
}

// null means there is no open page, so the caller keeps the previous list.
// An empty array means pages are open and none of them are eligible.
export function snapshotTabUrls(pages, { preserveDuplicates = false } = {}) {
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
    if (eligible && (preserveDuplicates || !urls.includes(eligible))) urls.push(eligible);
    if (!preserveDuplicates && urls.length >= MAX_RESTORED_TABS) break;
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

export function hasChromeSession(dir) {
  const sessions = path.join(dir, 'Default', 'Sessions');
  try {
    return fs.readdirSync(sessions, { withFileTypes: true }).some(entry =>
      entry.isFile() && /^Session_\d+$/.test(entry.name) && fs.statSync(path.join(sessions, entry.name)).size > 8);
  } catch { return false; }
}

export function chooseStableLaunchUrls({ explicitUrl, startupUrls, savedUrls, nativeSession } = {}) {
  const explicit = explicitUrl?.trim();
  if (nativeSession) return explicit ? [explicit] : [];
  if (savedUrls?.length) return explicit && !savedUrls.includes(explicit) ? [...savedUrls, explicit] : savedUrls.slice();
  return chooseLaunchUrls({ explicitUrl, startupUrls });
}

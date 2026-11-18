// On-disk profile storage. Sizes are bytes currently visible on disk. A running
// browser can still hold unflushed data, so cleanup is refused until it is stopped.
import fs from 'fs';
import path from 'path';
import { userDataDir } from './db.js';
import { isRunning } from './browsers.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', path.join('Service Worker', 'CacheStorage')];
const SITE_DATA_DIRS = ['Local Storage', 'Session Storage', 'IndexedDB', 'File System', 'Service Worker', 'WebStorage', 'blob_storage', 'databases'];
const COOKIE_FILES = ['Cookies', path.join('Network', 'Cookies'), path.join('Network', 'Cookies-journal')];

function safeJoin(root, rel) {
  const dest = path.resolve(root, rel);
  const relative = path.relative(root, dest);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw fail(400, 'storage path is not allowed', 'UNSAFE_PATH');
  return dest;
}

function measure(abs) {
  if (!fs.existsSync(abs)) return { bytes: 0, present: false, skippedSymlink: false };
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) return { bytes: 0, present: true, skippedSymlink: true };
  if (stat.isFile()) return { bytes: stat.size, present: true, skippedSymlink: false };
  let bytes = 0;
  let skippedSymlink = false;
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const child = path.join(dir, name);
      const childStat = fs.lstatSync(child);
      if (childStat.isSymbolicLink()) { skippedSymlink = true; continue; }
      if (childStat.isDirectory()) stack.push(child);
      else if (childStat.isFile()) bytes += childStat.size;
    }
  }
  return { bytes, present: true, skippedSymlink };
}

function locations(root, relatives) {
  const seen = new Set();
  const out = [];
  for (const rel of relatives) {
    for (const base of [rel, path.join('Default', rel)]) {
      if (seen.has(base)) continue;
      seen.add(base);
      const abs = safeJoin(root, base);
      const size = measure(abs);
      if (size.present) out.push({ path: base, bytes: size.bytes, skippedSymlink: size.skippedSymlink });
    }
  }
  return out;
}

export function inspectStorage(profileId, { running = isRunning(profileId) } = {}) {
  const root = userDataDir(profileId);
  const exists = fs.existsSync(root);
  const total = exists ? measure(root) : { bytes: 0, present: false, skippedSymlink: false };
  const cookies = locations(root, COOKIE_FILES);
  const cache = locations(root, CACHE_DIRS);
  const siteData = locations(root, SITE_DATA_DIRS);
  const sum = rows => rows.reduce((totalBytes, row) => totalBytes + row.bytes, 0);
  return {
    profileId,
    running: !!running,
    cleanupAllowed: !running,
    dataDirectory: root,
    directoryPresent: exists,
    totalBytes: total.bytes,
    cookies: { bytes: sum(cookies), files: cookies },
    cache: { bytes: sum(cache), directories: cache },
    siteData: { bytes: sum(siteData), directories: siteData },
    skippedSymlink: !!(total.skippedSymlink || [...cookies, ...cache, ...siteData].some(row => row.skippedSymlink)),
    preserved: ['Cookies', 'Login Data', 'History', 'Preferences', 'Bookmarks', 'Extensions'],
    note: running
      ? 'The profile is running. Sizes are the bytes currently on disk and do not include data the browser has not flushed. Cleanup is refused until the profile is stopped.'
      : 'The profile is stopped. Sizes are the bytes currently on disk.',
  };
}

function removeDir(root, rel, removed) {
  const abs = safeJoin(root, rel);
  if (!fs.existsSync(abs)) return;
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) {
    removed.push({ path: rel, ok: false, error: 'symlink skipped' });
    return;
  }
  fs.rmSync(abs, { recursive: true, force: true });
  removed.push({ path: rel, ok: true });
}

export function cleanupStorage(profileId, body = {}, { running = isRunning(profileId) } = {}) {
  if (running) throw fail(409, 'Stop the profile before deleting cache or site data. A live browser can recreate or lose those files.', 'PROFILE_RUNNING');
  const confirm = body.confirm;
  if (confirm !== 'clear-cache' && confirm !== 'clear-site-data') throw fail(400, 'confirm must be clear-cache or clear-site-data', 'CONFIRMATION_REQUIRED');
  const root = userDataDir(profileId);
  const targets = confirm === 'clear-cache' ? CACHE_DIRS : SITE_DATA_DIRS;
  const removed = [];
  for (const rel of targets) {
    removeDir(root, rel, removed);
    removeDir(root, path.join('Default', rel), removed);
  }
  return {
    profileId,
    confirm,
    removed: removed.filter(item => item.ok),
    skipped: removed.filter(item => !item.ok),
    preserved: ['Cookies', 'Login Data', 'History', 'Preferences', 'Bookmarks', 'Extensions'],
    storage: inspectStorage(profileId, { running: false }),
  };
}

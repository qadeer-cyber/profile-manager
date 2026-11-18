// Read-only export of Chromium on-disk bookmarks and history for a stopped profile.
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { acquireLock, releaseLock } from './lock.js';

const MAX_HISTORY = 2000;
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export function chromiumProfileDefaultDir(userDataRoot) {
  const direct = path.join(userDataRoot, 'Default');
  if (fs.existsSync(path.join(direct, 'Bookmarks')) || fs.existsSync(path.join(direct, 'History'))) return direct;
  return direct;
}

function flattenBookmarkNodes(node, out, folderStack = []) {
  if (!node || typeof node !== 'object') return;
  const type = node.type;
  if (type === 'folder') {
    const name = String(node.name || '');
    const next = name ? [...folderStack, name] : folderStack;
    for (const child of node.children || []) flattenBookmarkNodes(child, out, next);
    return;
  }
  if (type === 'url') {
    out.push({
      name: String(node.name || ''),
      url: String(node.url || ''),
      folder: folderStack.join(' / '),
      dateAdded: node.date_added ? Number(node.date_added) : null,
    });
  }
}

export function readProfileBookmarks(userDataRoot) {
  const file = path.join(chromiumProfileDefaultDir(userDataRoot), 'Bookmarks');
  if (!fs.existsSync(file)) return { availability: 'empty', bookmarks: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { availability: 'unavailable', reason: 'invalid_bookmarks_json', bookmarks: [] };
  }
  const out = [];
  flattenBookmarkNodes(parsed.roots?.bookmark_bar, out, ['Bookmarks bar']);
  flattenBookmarkNodes(parsed.roots?.other, out, ['Other']);
  flattenBookmarkNodes(parsed.roots?.synced, out, ['Mobile']);
  return { availability: 'available', bookmarks: out };
}

function chromeTimeToUnix(micros) {
  if (!micros) return null;
  const unix = Math.round(Number(micros) / 1e6 - 11644473600);
  return Number.isFinite(unix) ? unix : null;
}

export function readProfileHistory(userDataRoot, { limit = 500 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 500), MAX_HISTORY);
  const historyPath = path.join(chromiumProfileDefaultDir(userDataRoot), 'History');
  if (!fs.existsSync(historyPath)) return { availability: 'empty', entries: [] };
  acquireLock(userDataRoot);
  try {
    const db = new Database(historyPath, { readonly: true, fileMustExist: true });
    try {
      const hasUrls = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='urls'").get();
      if (!hasUrls) return { availability: 'empty', entries: [] };
      const rows = db.prepare(`
        SELECT u.url, u.title, v.visit_time, v.visit_duration
        FROM visits v
        JOIN urls u ON u.id = v.url
        ORDER BY v.visit_time DESC
        LIMIT ?
      `).all(cap);
      return {
        availability: 'available',
        entries: rows.map(row => ({
          url: row.url,
          title: row.title || '',
          visitedAt: chromeTimeToUnix(row.visit_time),
          durationMicros: row.visit_duration ?? null,
        })),
      };
    } finally {
      db.close();
    }
  } catch (e) {
    if (/locked|busy/i.test(String(e.message))) {
      return { availability: 'unavailable', reason: 'history_locked', entries: [] };
    }
    throw e;
  } finally {
    releaseLock(userDataRoot);
  }
}

export function exportStoppedProfileBookmarks(userDataRoot) {
  return readProfileBookmarks(userDataRoot);
}

export function exportStoppedProfileHistory(userDataRoot, opts) {
  return readProfileHistory(userDataRoot, opts);
}

export function assertProfileStoppedForDiskExport(isRunning, id) {
  if (isRunning(id)) throw fail(409, 'Stop the profile before exporting on-disk bookmarks or history.', 'PROFILE_RUNNING');
}

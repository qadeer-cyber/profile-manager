// Read-only access to Firefox moz_cookies in a gecko profile directory (stopped profile).
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const SAME_SITE = { 0: 'None', 1: 'Lax', 2: 'Strict' };

export function geckoCookieDbPath(geckoProfileDir) {
  return path.join(geckoProfileDir, 'cookies.sqlite');
}

function rowToCookie(row) {
  const expiry = Number(row.expiry) || 0;
  const session = !expiry;
  return {
    name: row.name,
    domain: row.host,
    path: row.path || '/',
    secure: !!row.isSecure,
    httpOnly: !!row.isHttpOnly,
    sameSite: SAME_SITE[row.sameSite] || 'Unspecified',
    expires: session ? null : expiry,
    session,
    hostOnly: row.host && !String(row.host).startsWith('.'),
    valueState: 'available',
    value: row.value == null ? '' : String(row.value),
  };
}

export function readGeckoProfileCookies(geckoProfileDir) {
  const file = geckoCookieDbPath(geckoProfileDir);
  if (!fs.existsSync(file)) return [];
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='moz_cookies'").get()) return [];
    const cols = new Set(db.prepare('PRAGMA table_info(moz_cookies)').all().map(c => c.name));
    const select = ['name', 'value', 'host', 'path', 'expiry', 'isSecure', 'isHttpOnly'].filter(c => cols.has(c));
    if (!select.includes('name') || !select.includes('host')) return [];
    if (cols.has('sameSite')) select.push('sameSite');
    const rows = db.prepare(`SELECT ${select.join(', ')} FROM moz_cookies ORDER BY host, name`).all();
    return rows.map(rowToCookie);
  } finally {
    db.close();
  }
}

export function exportGeckoCookiesPayload(cookies) {
  return { version: 1, engine: 'firefox', readOnly: true, cookies };
}

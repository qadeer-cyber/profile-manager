// Chromium cookie store for a stopped profile. Values are encrypted the way this
// Chromium build writes them (v10, host-bound). Cookie values are never logged.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { acquireLock, releaseLock } from './lock.js';

const EPOCH = 11644473600;
const MAX_COOKIES = 500;
const SAME_SITE = { Unspecified: -1, None: 0, Lax: 1, Strict: 2 };
const SAME_SITE_NAME = Object.fromEntries(Object.entries(SAME_SITE).map(([name, value]) => [value, name]));
const KEY = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
const IV = Buffer.alloc(16, ' ');
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export function cookieDbPath(dir) {
  const network = path.join(dir, 'Default', 'Network', 'Cookies');
  const legacy = path.join(dir, 'Default', 'Cookies');
  if (fs.existsSync(network)) return network;
  return legacy;
}

function chromeNow() { return Math.round((Date.now() / 1000 + EPOCH) * 1e6); }
function toChrome(unix) { return Math.round((unix + EPOCH) * 1e6); }
function fromChrome(value) {
  if (!value) return null;
  const unix = Math.round(value / 1e6 - EPOCH);
  return Number.isFinite(unix) ? unix : null;
}

export function encryptCookieValue(host, value) {
  const plain = Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from(value, 'utf8')]);
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()]);
}
export function decryptCookieValue(host, blob) {
  if (!blob || !blob.length) return { state: 'empty', value: '' };
  const prefix = blob.subarray(0, 3).toString('utf8');
  if (prefix !== 'v10') return { state: 'unavailable', reason: 'unsupported_encryption' };
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
    const plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]);
    const bound = crypto.createHash('sha256').update(host).digest();
    if (plain.length >= 32 && plain.subarray(0, 32).equals(bound)) return { state: 'available', value: plain.subarray(32).toString('utf8') };
    if (plain.length >= 32) return { state: 'unavailable', reason: 'unsupported_encryption' };
    return { state: 'available', value: plain.toString('utf8') };
  } catch {
    return { state: 'unavailable', reason: 'unsupported_encryption' };
  }
}

function openDb(file, { create = false } = {}) {
  if (!fs.existsSync(file)) {
    if (!create) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cookies'").get();
  if (!exists && create) {
    db.exec(`CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,
      source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL,
      has_cross_site_ancestor INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS cookies_unique_index ON cookies(host_key, top_frame_site_key, name, path, source_scheme, source_port);`);
  }
  return db;
}

function rowToCookie(row) {
  const decoded = row.value ? { state: 'available', value: String(row.value) } : decryptCookieValue(row.host_key, row.encrypted_value);
  const session = !row.has_expires || !row.is_persistent;
  const cookie = {
    name: row.name,
    domain: row.host_key,
    path: row.path,
    secure: !!row.is_secure,
    httpOnly: !!row.is_httponly,
    sameSite: SAME_SITE_NAME[row.samesite] || 'Unspecified',
    expires: session ? null : fromChrome(row.expires_utc),
    session,
    hostOnly: !String(row.host_key).startsWith('.'),
    valueState: decoded.state === 'available' ? 'available' : 'unavailable',
  };
  if (decoded.state === 'available') cookie.value = decoded.value;
  else cookie.valueReason = decoded.reason || 'unsupported_encryption';
  return cookie;
}

export function readProfileCookies(dir) {
  const file = cookieDbPath(dir);
  if (!fs.existsSync(file)) return [];
  const db = openDb(file);
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cookies'").get()) return [];
    return db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, is_persistent, samesite FROM cookies ORDER BY host_key, name').all().map(rowToCookie);
  } finally { db.close(); }
}

function describe(index, cookie) {
  const name = cookie && typeof cookie.name === 'string' ? cookie.name.slice(0, 80) : '';
  const domain = cookie && typeof cookie.domain === 'string' ? cookie.domain.slice(0, 120) : '';
  return `cookie ${index + 1}${name ? ` (${name}` : ''}${name && domain ? `, ${domain}` : domain ? ` (${domain}` : ''}${name || domain ? ')' : ''}`;
}
function bad(index, cookie, message) {
  throw fail(400, `${describe(index, cookie)}: ${message}`, 'INVALID_COOKIE');
}
export function validateCookie(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad(index, input, 'must be an object');
  const name = input.name;
  if (typeof name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || name.length > 256) bad(index, input, 'has an invalid name');
  if (typeof input.value !== 'string' || input.value.length > 4096 || /[\u0000-\u001f\u007f]/.test(input.value)) bad(index, input, 'has an invalid value');
  if (typeof input.domain !== 'string' || input.domain.length > 253 || !/^\.?[A-Za-z0-9.-]+$/.test(input.domain) || input.domain.includes('..')) bad(index, input, 'has an invalid domain');
  if (typeof input.path !== 'string' || !input.path.startsWith('/') || input.path.length > 1024 || /[\u0000-\u001f]/.test(input.path)) bad(index, input, 'has an invalid path');
  if (typeof input.secure !== 'boolean' || typeof input.httpOnly !== 'boolean') bad(index, input, 'secure and httpOnly must be booleans');
  if (!Object.hasOwn(SAME_SITE, input.sameSite)) bad(index, input, 'sameSite must be Strict, Lax, None, or Unspecified');
  if (input.sameSite === 'None' && !input.secure) bad(index, input, 'SameSite=None requires Secure');
  if (input.hostOnly != null && typeof input.hostOnly !== 'boolean') bad(index, input, 'hostOnly must be a boolean');
  const hostOnly = input.hostOnly != null ? input.hostOnly : !input.domain.startsWith('.');
  if (hostOnly && input.domain.startsWith('.')) bad(index, input, 'a host-only cookie domain cannot start with a dot');
  if (!hostOnly && !input.domain.startsWith('.')) bad(index, input, 'a domain cookie domain must start with a dot');
  if (name.startsWith('__Host-') && (!input.secure || input.path !== '/' || !hostOnly)) bad(index, input, '__Host- cookies require Secure, path /, and no Domain');
  if (name.startsWith('__Secure-') && !input.secure) bad(index, input, '__Secure- cookies require Secure');
  let expires = null;
  if (input.expires != null) {
    if (typeof input.expires !== 'number' || !Number.isFinite(input.expires) || input.expires < 0 || input.expires > 4e10) bad(index, input, 'has an invalid expires time');
    expires = Math.floor(input.expires);
  }
  return { name, value: input.value, domain: input.domain, path: input.path, secure: input.secure, httpOnly: input.httpOnly, sameSite: input.sameSite, hostOnly, expires };
}

function columnMap(db) {
  return new Map(db.prepare('PRAGMA table_info(cookies)').all().map(column => [column.name, column]));
}
function insertCookie(db, columns, cookie) {
  const now = chromeNow();
  const session = cookie.expires == null;
  const values = {
    creation_utc: now,
    host_key: cookie.domain,
    top_frame_site_key: '',
    name: cookie.name,
    value: '',
    encrypted_value: encryptCookieValue(cookie.domain, cookie.value),
    path: cookie.path,
    expires_utc: session ? 0 : toChrome(cookie.expires),
    is_secure: cookie.secure ? 1 : 0,
    is_httponly: cookie.httpOnly ? 1 : 0,
    last_access_utc: now,
    has_expires: session ? 0 : 1,
    is_persistent: session ? 0 : 1,
    priority: 1,
    samesite: SAME_SITE[cookie.sameSite],
    source_scheme: cookie.secure ? 2 : 1,
    source_port: cookie.secure ? 443 : 80,
    last_update_utc: now,
    source_type: 0,
    has_cross_site_ancestor: 0,
  };
  for (const [name, column] of columns) {
    if (column.notnull && column.dflt_value == null && !(name in values)) {
      throw fail(409, 'This Chromium cookie store has a column this app cannot fill safely', 'COOKIE_STORE_UNSUPPORTED');
    }
  }
  const names = [...columns.keys()].filter(name => name in values);
  db.prepare(`DELETE FROM cookies WHERE host_key=? AND name=? AND path=?`).run(cookie.domain, cookie.name, cookie.path);
  db.prepare(`INSERT INTO cookies (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map(name => values[name]));
}

function withStore(dir, fn) {
  acquireLock(dir);
  try {
    const file = cookieDbPath(dir);
    const db = openDb(file, { create: true });
    try {
      const result = fn(db);
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* the cookie file remains usable without a checkpoint */ }
      return result;
    } finally { db.close(); }
  } finally { releaseLock(dir); }
}

export function importProfileCookies(dir, cookies) {
  if (!Array.isArray(cookies) || cookies.length > MAX_COOKIES) throw fail(400, `cookies must be an array of at most ${MAX_COOKIES} items`, 'INVALID_COOKIE');
  const valid = cookies.map((cookie, index) => validateCookie(cookie, index));
  return withStore(dir, db => {
    const columns = columnMap(db);
    const write = db.transaction(items => { for (const cookie of items) insertCookie(db, columns, cookie); });
    write(valid);
    return { imported: valid.length };
  });
}

export function clearProfileCookies(dir, { all = false, selected = [] } = {}) {
  const existing = cookieDbPath(dir);
  if (!fs.existsSync(existing)) return { cleared: 0, notFound: all ? 0 : selected.length };
  return withStore(dir, db => {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cookies'").get()) return { cleared: 0, notFound: all ? 0 : selected.length };
    if (all) {
      const cleared = db.prepare('SELECT COUNT(*) n FROM cookies').get().n;
      db.prepare('DELETE FROM cookies').run();
      return { cleared };
    }
    let cleared = 0;
    let notFound = 0;
    const remove = db.prepare('DELETE FROM cookies WHERE host_key=? AND name=? AND path=?');
    for (const cookie of selected) {
      const result = remove.run(cookie.domain, cookie.name, cookie.path);
      if (result.changes) cleared += result.changes;
      else notFound += 1;
    }
    return { cleared, notFound };
  });
}

export function validateClearSelection(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_COOKIES) throw fail(400, 'cookies must list 1 to 500 cookies to clear', 'INVALID_COOKIE');
  return input.map((cookie, index) => {
    if (!cookie || typeof cookie !== 'object') bad(index, cookie, 'must be an object');
    if (typeof cookie.name !== 'string' || typeof cookie.domain !== 'string' || typeof cookie.path !== 'string') bad(index, cookie, 'name, domain, and path are required');
    if ('value' in cookie) bad(index, cookie, 'clear requests must not include a value');
    return { name: cookie.name, domain: cookie.domain, path: cookie.path };
  });
}

export function cookiesFromContext(cookies) {
  return cookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite || 'Lax',
    expires: cookie.expires > 0 ? cookie.expires : null,
    session: !(cookie.expires > 0),
    hostOnly: !String(cookie.domain).startsWith('.'),
    valueState: 'available',
  }));
}

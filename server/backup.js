// Backup and restore of profiles, extension files, and the app database.
// A running browser is refused. Restore validates the archive before it changes
// the live data directory, and a failed swap rolls the database transaction back.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { db, DATA_DIR, userDataDir } from './db.js';
import { runningIds } from './browsers.js';
import { DATA_COPY_SKIP } from './browsers.js';
import { currentVersion } from './migrations.js';
import { encrypt, decrypt } from './secrets.js';
import { DEFAULT_ADVANCED_SETTINGS } from './advanced-settings.js';
import { packArchive, unpackArchive } from './archive.js';
import { decryptBackup, describeEncryptedBackup, encryptBackup, isEncryptedBackup } from './backup-crypto.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const ADVANCED_DEFAULT = JSON.stringify(DEFAULT_ADVANCED_SETTINGS);

function decryptStored(stored, key) {
  if (!stored) return '';
  if (stored.startsWith('ss:v1:')) throw new Error('os-secret');
  if (!stored.startsWith('enc:v1:')) throw new Error('unprefixed');
  const parts = stored.split(':');
  if (parts.length !== 5) throw new Error('secret-shape');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64')), decipher.final()]).toString('utf8');
}
function recoverPassword(stored, archivedKey) {
  if (!stored) return '';
  const errors = [];
  if (archivedKey) {
    try { return decryptStored(stored, archivedKey); } catch (error) { errors.push(error); }
  }
  try { return decrypt(stored); } catch (error) { errors.push(error); }
  throw errors.at(-1) || new Error('secret');
}

function walkFiles(root, prefix, files) {
  if (!fs.existsSync(root)) return;
  const visit = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      if (DATA_COPY_SKIP.has(name)) continue;
      const abs = path.join(dir, name);
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) throw fail(400, 'Refusing to back up a profile that contains a symlink', 'UNSAFE_PROFILE_LINK');
      const child = rel ? `${rel}/${name}` : name;
      if (stat.isDirectory()) visit(abs, child);
      else if (stat.isFile()) files.push({ path: `${prefix}/${child}`, data: fs.readFileSync(abs) });
    }
  };
  visit(root, '');
}

export function createBackup({ ids = runningIds() } = {}) {
  if (ids.length) throw fail(409, 'Stop every running profile before creating a backup. A live browser can leave its databases half-written.', 'PROFILES_RUNNING');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* the main database file is still copied */ }
  const profiles = db.prepare('SELECT id, name FROM profiles ORDER BY created_at, rowid').all();
  const meta = { format: 'profile-manager-backup', version: 1, createdAt: new Date().toISOString(), schemaVersion: currentVersion(db), profiles };
  const files = [
    { path: 'meta.json', data: Buffer.from(JSON.stringify(meta)) },
    { path: 'profiles.db', data: fs.readFileSync(path.join(DATA_DIR, 'profiles.db')) },
  ];
  const keyFile = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(keyFile)) files.push({ path: 'secret.key', data: fs.readFileSync(keyFile) });
  for (const profile of profiles) walkFiles(userDataDir(profile.id), `profiles/${profile.id}`, files);
  const extensions = path.join(DATA_DIR, 'extensions');
  if (fs.existsSync(extensions)) {
    for (const name of fs.readdirSync(extensions)) {
      if (!UUID.test(name)) continue;
      const abs = path.join(extensions, name);
      if (fs.lstatSync(abs).isSymbolicLink()) throw fail(400, 'Refusing to back up an extension symlink', 'UNSAFE_PROFILE_LINK');
      walkFiles(abs, `extensions/${name}`, files);
    }
  }
  return packArchive(files);
}

export function createEncryptedBackup(passphrase, options) {
  return encryptBackup(createBackup(options), passphrase);
}

function plaintextArchive(buffer, passphrase) {
  if (!isEncryptedBackup(buffer)) return { buffer, encrypted: false };
  if (typeof passphrase !== 'string' || !passphrase) throw fail(400, 'This backup is encrypted. A passphrase is required.', 'PASSPHRASE_REQUIRED');
  return { buffer: decryptBackup(buffer, passphrase), encrypted: true };
}

export function inspectBackup(buffer, { passphrase } = {}) {
  if (isEncryptedBackup(buffer) && (typeof passphrase !== 'string' || !passphrase)) {
    return { ...describeEncryptedBackup(), profiles: null, containsSecretKey: null };
  }
  const opened = plaintextArchive(buffer, passphrase);
  const files = unpackArchive(opened.buffer);
  const metaFile = files.find(file => file.path === 'meta.json');
  if (!metaFile) throw fail(400, 'Backup is missing its manifest', 'CORRUPT_BACKUP');
  let meta;
  try { meta = JSON.parse(metaFile.data.toString('utf8')); } catch { throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP'); }
  if (!meta || !Array.isArray(meta.profiles)) throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP');
  return {
    encrypted: opened.encrypted,
    ...(opened.encrypted ? describeEncryptedBackup() : { format: meta.format, version: meta.version, requiresPassphrase: false }),
    createdAt: meta.createdAt || null,
    profiles: meta.profiles.map(profile => ({ id: profile && profile.id, name: profile && profile.name })),
    containsSecretKey: files.some(file => file.path === 'secret.key'),
  };
}

function writeTree(root, files) {
  const base = path.resolve(root);
  for (const file of files) {
    const dest = path.resolve(base, file.path);
    const rel = path.relative(base, dest);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, 'Backup path is not allowed', 'UNSAFE_ARCHIVE');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.data, { mode: 0o600 });
  }
}

function tableExists(database, name) {
  return !!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnSet(database, table) {
  if (!tableExists(database, table)) return new Set();
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

export function restoreBackup(buffer, { collision = 'abort', failPoint = null, running = runningIds(), passphrase } = {}) {
  if (!['abort', 'rename', 'replace'].includes(collision)) throw fail(400, 'collision must be abort, rename, or replace', 'INVALID_RESTORE');
  const opened = plaintextArchive(buffer, passphrase);
  buffer = opened.buffer;
  const files = unpackArchive(buffer);
  const byPath = new Map(files.map(file => [file.path, file.data]));
  if (!byPath.has('meta.json') || !byPath.has('profiles.db')) throw fail(400, 'Backup is missing its manifest or database', 'CORRUPT_BACKUP');
  let meta;
  try { meta = JSON.parse(byPath.get('meta.json').toString('utf8')); } catch { throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP'); }
  if (!meta || meta.format !== 'profile-manager-backup' || meta.version !== 1 || !Array.isArray(meta.profiles)) throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-restore-'));
  let source;
  try {
    writeTree(tmp, files);
    source = new Database(path.join(tmp, 'profiles.db'), { readonly: true, fileMustExist: true });
    if (source.pragma('integrity_check', { simple: true }) !== 'ok') throw fail(400, 'Backup database failed its integrity check', 'CORRUPT_BACKUP');
    if (!tableExists(source, 'schema_version') || !tableExists(source, 'profiles')) throw fail(400, 'Backup database is missing its schema', 'CORRUPT_BACKUP');
    const version = source.prepare('SELECT COALESCE(MAX(version), 0) v FROM schema_version').get().v;
    if (version > currentVersion(db)) throw fail(400, 'Backup was created by a newer Profile Manager', 'UNSUPPORTED_BACKUP');
    const archived = source.prepare('SELECT * FROM profiles').all();
    const metaIds = meta.profiles.map(profile => profile && profile.id);
    const rowIds = archived.map(profile => profile.id);
    if (metaIds.length !== rowIds.length || metaIds.some(id => !rowIds.includes(id))) throw fail(400, 'Backup manifest does not match its database', 'CORRUPT_BACKUP');
    for (const file of files) {
      const profile = file.path.match(/^profiles\/([^/]+)\//);
      if (profile && !rowIds.includes(profile[1])) throw fail(400, 'Backup contains files for a profile that is not in the database', 'CORRUPT_BACKUP');
    }
    const localIds = new Set(db.prepare('SELECT id FROM profiles').all().map(row => row.id));
    const active = new Set(running);
    const plan = archived.map(row => {
      if (!UUID.test(String(row.id || '')) || typeof row.name !== 'string' || !row.name.trim()) throw fail(400, 'Backup profile row is invalid', 'CORRUPT_BACKUP');
      try { if (!Array.isArray(JSON.parse(row.tags || '[]'))) throw new Error('tags'); } catch { throw fail(400, 'Backup profile tags are invalid', 'CORRUPT_BACKUP'); }
      const exists = localIds.has(row.id);
      if (exists && collision === 'abort') throw fail(409, `Profile ${row.id} already exists. Choose rename or replace.`, 'COLLISION');
      if (exists && collision === 'replace' && active.has(row.id)) throw fail(409, 'Stop the profile before replacing it from a backup.', 'PROFILES_RUNNING');
      return { row, action: exists && collision === 'rename' ? 'rename' : exists ? 'replace' : 'add', id: exists && collision === 'rename' ? crypto.randomUUID() : row.id };
    });
    const archivedKey = byPath.has('secret.key') ? Buffer.from(byPath.get('secret.key').toString('utf8').trim(), 'base64') : null;
    const result = { added: [], replaced: [], renamed: [], proxyDetached: [], extensionsSkipped: 0 };
    const ops = [];
    const asides = [];
    const relocate = (from, to) => {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      ops.push({ from, to });
    };
    const undo = () => {
      for (const op of ops.reverse()) if (fs.existsSync(op.to)) fs.renameSync(op.to, op.from);
    };
    const sourceColumns = columnSet(source, 'profiles');
    const destColumns = columnSet(db, 'profiles');
    try {
      db.transaction(() => {
        for (const item of plan) applyProfile(source, item, archivedKey, result, sourceColumns, destColumns);
        if (failPoint === 'before-files') throw fail(500, 'Restore stopped before files were moved', 'RESTORE_FAILED');
        for (const item of plan) moveProfileDir(tmp, item, relocate, asides);
        moveNewExtensions(tmp, source, relocate);
      })();
    } catch (error) {
      try { undo(); } catch { throw fail(500, 'Restore failed and rolling the files back also failed. The database transaction was not committed.', 'RESTORE_ROLLBACK_FAILED'); }
      throw error;
    }
    for (const aside of asides) fs.rmSync(aside, { recursive: true, force: true });
    return result;
  } finally {
    try { source?.close(); } catch { /* the temp copy is discarded */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function valueOf(row, name, fallback = null) { return Object.hasOwn(row, name) && row[name] != null ? row[name] : fallback; }

function applyProfile(source, item, archivedKey, result, sourceColumns, destColumns) {
  const row = item.row;
  let proxyId = sourceColumns.has('proxy_id') ? row.proxy_id : null;
  if (proxyId) {
    const imported = importProxy(source, proxyId, archivedKey);
    if (!imported) { result.proxyDetached.push(item.id); proxyId = null; }
    else proxyId = imported;
  }
  const record = {
    id: item.id,
    name: row.name,
    tags: valueOf(row, 'tags', '[]'),
    folder: valueOf(row, 'folder', ''),
    notes: valueOf(row, 'notes', ''),
    proxy: null,
    created_at: valueOf(row, 'created_at', new Date().toISOString()),
    updated_at: new Date().toISOString(),
    last_launched_at: null,
    last_error: null,
    automation_enabled: valueOf(row, 'automation_enabled', 0),
    proxy_id: proxyId,
    browser_settings: valueOf(row, 'browser_settings', '{"locale":"","timezoneId":"","languages":[]}'),
    webrtc_settings: valueOf(row, 'webrtc_settings', '{"mode":"browser_default"}'),
    advanced_settings: valueOf(row, 'advanced_settings', ADVANCED_DEFAULT),
  };
  const names = [...destColumns].filter(name => Object.hasOwn(record, name));
  if (item.action === 'replace') {
    db.prepare('DELETE FROM profile_extensions WHERE profile_id=?').run(item.id);
    const assignments = names.filter(name => name !== 'id').map(name => `${name}=@${name}`).join(',');
    db.prepare(`UPDATE profiles SET ${assignments} WHERE id=@id`).run(Object.fromEntries(names.map(name => [name, record[name]])));
    result.replaced.push({ id: item.id, name: row.name });
  } else {
    db.prepare(`INSERT INTO profiles (${names.join(',')}) VALUES (${names.map(name => '@' + name).join(',')})`).run(Object.fromEntries(names.map(name => [name, record[name]])));
    (item.action === 'rename' ? result.renamed : result.added).push({ id: item.id, sourceId: row.id, name: row.name });
  }
  linkExtensions(source, row.id, item.id, result);
}

function importProxy(source, proxyId, archivedKey) {
  if (!tableExists(source, 'proxies')) return null;
  const row = source.prepare('SELECT * FROM proxies WHERE id=?').get(proxyId);
  if (!row) return null;
  let password = '';
  try { password = recoverPassword(row.password, archivedKey); } catch { return null; }
  const local = db.prepare('SELECT * FROM proxies WHERE id=?').get(proxyId);
  if (local) {
    const same = local.type === row.type && local.host === row.host && Number(local.port) === Number(row.port) && local.username === row.username;
    return same ? proxyId : null;
  }
  const now = new Date().toISOString();
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.name, row.type, row.host, row.port, row.username || '', encrypt(password), row.tags || '[]', row.created_at || now, now);
  return proxyId;
}

function linkExtensions(source, sourceId, destId, result) {
  if (!tableExists(source, 'profile_extensions') || !tableExists(source, 'extensions')) return;
  for (const link of source.prepare('SELECT * FROM profile_extensions WHERE profile_id=?').all(sourceId)) {
    if (!ensureExtension(source, link.extension_id)) { result.extensionsSkipped += 1; continue; }
    db.prepare('INSERT OR REPLACE INTO profile_extensions (profile_id, extension_id, enabled, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(destId, link.extension_id, link.enabled ? 1 : 0, link.created_at, link.updated_at);
  }
}
function ensureExtension(source, id) {
  if (db.prepare('SELECT id FROM extensions WHERE id=?').get(id)) return true;
  const row = source.prepare('SELECT * FROM extensions WHERE id=?').get(id);
  if (!row || row.storage_dir !== `extensions/${row.id}`) return false;
  db.prepare(`INSERT INTO extensions (
    id, name, version, description, manifest_version, permissions, host_permissions,
    optional_permissions, optional_host_permissions, storage_dir, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.name, row.version, row.description || '', row.manifest_version, row.permissions || '[]', row.host_permissions || '[]',
    row.optional_permissions || '[]', row.optional_host_permissions || '[]', row.storage_dir, row.created_at, row.updated_at,
  );
  return true;
}

function moveProfileDir(tmp, item, relocate, asides) {
  const from = path.join(tmp, 'profiles', item.row.id);
  if (!fs.existsSync(from)) return;
  const dest = userDataDir(item.id);
  if (item.action === 'replace' && fs.existsSync(dest)) {
    const aside = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-aside-'));
    asides.push(aside);
    const parked = path.join(aside, 'dir');
    relocate(dest, parked);
  }
  if (fs.existsSync(dest)) throw fail(409, 'Profile directory already exists', 'COLLISION');
  relocate(from, dest);
}
function moveNewExtensions(tmp, source, relocate) {
  if (!tableExists(source, 'extensions')) return;
  for (const row of source.prepare('SELECT id, storage_dir FROM extensions').all()) {
    const dest = path.join(DATA_DIR, 'extensions', row.id);
    const from = path.join(tmp, 'extensions', row.id);
    if (!fs.existsSync(from) || fs.existsSync(dest)) continue;
    if (row.storage_dir !== `extensions/${row.id}`) continue;
    relocate(from, dest);
  }
}

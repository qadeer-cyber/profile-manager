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
import { createPortableBackup, restorePortableV2, validatePortableV2 } from './portable-backup.js';
import { runRecoverableRestore, assertProfileOperationAvailable } from './recovery-journal.js';
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

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function createBackup(options = {}) {
  return db.transaction(() => createBackupSnapshot(options)).immediate();
}

function createBackupSnapshot({ ids = runningIds() } = {}) {
  if (db.prepare('SELECT id FROM running LIMIT 1').get()) throw fail(409, 'Stop every active session before backup', 'PROFILES_RUNNING');
  if (db.prepare('SELECT profile_id FROM pm_recovery_profile_locks LIMIT 1').get()) throw fail(409, 'Finish pending data recovery before full backup', 'RECOVERY_REQUIRED');
  if (ids.length) throw fail(409, 'Stop every running profile before creating a backup. A live browser can leave its databases half-written.', 'PROFILES_RUNNING');
  const profiles = db.prepare('SELECT id, name FROM profiles ORDER BY created_at, rowid').all();
  const fileEntries = [];
  const pushFile = (relPath, data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fileEntries.push({ path: relPath, data: buf, sha256: sha256Hex(buf) });
  };
  const files = [];
  const stageMeta = () => {
    const meta = {
      format: 'profile-manager-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      schemaVersion: currentVersion(db),
      profiles,
      fileChecksums: Object.fromEntries(fileEntries.map(entry => [entry.path, entry.sha256])),
    };
    const metaBuf = Buffer.from(JSON.stringify(meta));
    const metaEntry = { path: 'meta.json', data: metaBuf, sha256: sha256Hex(metaBuf) };
    return [
      metaEntry,
      ...fileEntries.filter(entry => entry.path !== 'meta.json'),
    ];
  };
  pushFile('profiles.db', db.serialize());
  const keyFile = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(keyFile)) pushFile('secret.key', fs.readFileSync(keyFile));
  const walkInto = (root, prefix) => {
    if (!fs.existsSync(root)) return;
    if (fs.lstatSync(root).isSymbolicLink()) throw fail(400, 'Refusing to back up a symlink root', 'UNSAFE_PROFILE_LINK');
    const visit = (dir, rel) => {
      for (const name of fs.readdirSync(dir)) {
        if (DATA_COPY_SKIP.has(name)) continue;
        const abs = path.join(dir, name);
        const stat = fs.lstatSync(abs);
        if (stat.isSymbolicLink()) throw fail(400, 'Refusing to back up a profile that contains a symlink', 'UNSAFE_PROFILE_LINK');
        const child = rel ? `${rel}/${name}` : name;
        if (stat.isDirectory()) visit(abs, child);
        else if (stat.isFile()) pushFile(`${prefix}/${child}`, fs.readFileSync(abs));
      }
    };
    visit(root, '');
  };
  for (const profile of profiles) walkInto(userDataDir(profile.id), `profiles/${profile.id}`);
  for (const engineRoot of ['extensions', 'gecko-extensions']) {
  const extensions = path.join(DATA_DIR, engineRoot);
  if (fs.existsSync(extensions)) {
    for (const name of fs.readdirSync(extensions)) {
      if (!UUID.test(name)) continue;
      const abs = path.join(extensions, name);
      if (fs.lstatSync(abs).isSymbolicLink()) throw fail(400, 'Refusing to back up an extension symlink', 'UNSAFE_PROFILE_LINK');
      walkInto(abs, `${engineRoot}/${name}`);
    }
  }
  }
  for (const entry of stageMeta()) files.push({ path: entry.path, data: entry.data });
  return packArchive(files);
}

/** Portable single-profile archive (subset of full backup manifest format). */
export function createLegacyProfileBackup(profileId, { ids = runningIds() } = {}) {
  if (!UUID.test(String(profileId || ''))) throw fail(400, 'profile id is invalid', 'INVALID_PROFILE');
  if (ids.includes(profileId)) throw fail(409, 'Stop the profile before exporting a portable backup.', 'PROFILES_RUNNING');
  const row = db.prepare('SELECT id, name FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (!row) throw fail(404, 'Profile not found', 'NOT_FOUND');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* continue */ }
  const fileEntries = [];
  const pushFile = (relPath, data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fileEntries.push({ path: relPath, data: buf, sha256: sha256Hex(buf) });
  };
  const walkInto = (root, prefix) => {
    if (!fs.existsSync(root)) return;
    if (fs.lstatSync(root).isSymbolicLink()) throw fail(400, 'Refusing to back up a symlink root', 'UNSAFE_PROFILE_LINK');
    const visit = (dir, rel) => {
      for (const name of fs.readdirSync(dir)) {
        if (DATA_COPY_SKIP.has(name)) continue;
        const abs = path.join(dir, name);
        const stat = fs.lstatSync(abs);
        if (stat.isSymbolicLink()) throw fail(400, 'Refusing to export a profile that contains a symlink', 'UNSAFE_PROFILE_LINK');
        const child = rel ? `${rel}/${name}` : name;
        if (stat.isDirectory()) visit(abs, child);
        else if (stat.isFile()) pushFile(`${prefix}/${child}`, fs.readFileSync(abs));
      }
    };
    visit(root, '');
  };
  walkInto(userDataDir(profileId), `profiles/${profileId}`);
  const profileSnapshot = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  const extensionLinks = db.prepare('SELECT extension_id, enabled FROM profile_extensions WHERE profile_id=?').all(profileId);
  const meta = {
    format: 'profile-manager-profile-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    schemaVersion: currentVersion(db),
    profiles: [row],
    profileSnapshot,
    extensionLinks,
    fileChecksums: Object.fromEntries(fileEntries.map(entry => [entry.path, entry.sha256])),
  };
  const metaBuf = Buffer.from(JSON.stringify(meta));
  const files = [{ path: 'meta.json', data: metaBuf }, ...fileEntries];
  return packArchive(files);
}

export function createProfileBackup(profileId, options = {}) {
  return createPortableBackup(profileId, { ids: runningIds(), ...options });
}

export function createEncryptedBackup(passphrase, options) {
  return encryptBackup(createBackup(options), passphrase);
}

function plaintextArchive(buffer, passphrase) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 66 * 1024 * 1024 + 64) throw fail(400, 'Backup container exceeds size limits', 'UNSAFE_ARCHIVE');
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
  if (metaFile.data.length > 1024 * 1024) throw fail(400, 'Backup manifest exceeds 1 MiB', 'CORRUPT_BACKUP');
  try { meta = JSON.parse(metaFile.data.toString('utf8')); } catch { throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP'); }
  if (!meta || !Array.isArray(meta.profiles)) throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP');
  if (![1, 2].includes(meta.version) || !['profile-manager-backup', 'profile-manager-profile-backup'].includes(meta.format)) throw fail(400, 'Backup format is unsupported', 'UNSUPPORTED_BACKUP');
  assertManifestChecksums(meta, files);
  if (meta.version === 2) validatePortableV2(files, meta, { encrypted: opened.encrypted });
  const fileCounts = {};
  if (meta.fileChecksums && typeof meta.fileChecksums === 'object') {
    for (const rel of Object.keys(meta.fileChecksums)) {
      const m = rel.match(/^profiles\/([^/]+)\//);
      if (m) fileCounts[m[1]] = (fileCounts[m[1]] || 0) + 1;
    }
  }
  return {
    encrypted: opened.encrypted,
    ...(opened.encrypted ? describeEncryptedBackup() : { format: meta.format, version: meta.version, requiresPassphrase: false }),
    createdAt: meta.createdAt || null,
    schemaVersion: meta.schemaVersion ?? null,
    fileChecksumCount: meta.fileChecksums && typeof meta.fileChecksums === 'object' ? Object.keys(meta.fileChecksums).length : 0,
    profiles: meta.profiles.map(profile => ({
      id: profile && profile.id,
      name: profile && profile.name,
      fileCount: fileCounts[profile?.id] || 0,
    })),
    containsSecretKey: files.some(file => file.path === 'secret.key'),
    containsDatabase: files.some(file => file.path === 'profiles.db'),
  };
}

function assertManifestChecksums(meta, files) {
  if (!meta?.fileChecksums || typeof meta.fileChecksums !== 'object') return;
  const byPath = new Map(files.map(file => [file.path, file.data]));
  for (const [rel, expected] of Object.entries(meta.fileChecksums)) {
    if (rel === 'meta.json') continue;
    const data = byPath.get(rel);
    if (!data) throw fail(400, `Backup manifest lists missing file ${rel}`, 'CORRUPT_BACKUP');
    if (sha256Hex(data) !== expected) throw fail(400, `Backup manifest checksum mismatch for ${rel}`, 'CORRUPT_BACKUP');
  }
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

function parseProfileIdsFilter(profileIds) {
  if (profileIds == null) return null;
  const list = Array.isArray(profileIds) ? profileIds : String(profileIds).split(',').map(s => s.trim()).filter(Boolean);
  const out = list.filter(id => UUID.test(id));
  if (!out.length) throw fail(400, 'profileIds must list at least one valid profile id', 'INVALID_RESTORE');
  return new Set(out);
}

export function restoreBackup(buffer, { collision = 'abort', failPoint = null, running = runningIds(), passphrase, profileIds, fault } = {}) {
  if (!['abort', 'rename', 'replace'].includes(collision)) throw fail(400, 'collision must be abort, rename, or replace', 'INVALID_RESTORE');
  const opened = plaintextArchive(buffer, passphrase);
  buffer = opened.buffer;
  const files = unpackArchive(buffer);
  const byPath = new Map(files.map(file => [file.path, file.data]));
  if (!byPath.has('meta.json')) throw fail(400, 'Backup is missing its manifest', 'CORRUPT_BACKUP');
  let meta;
  if (byPath.get('meta.json').length > 1024 * 1024) throw fail(400, 'Backup manifest exceeds 1 MiB', 'CORRUPT_BACKUP');
  try { meta = JSON.parse(byPath.get('meta.json').toString('utf8')); } catch { throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP'); }
  if (!meta || ![1, 2].includes(meta.version) || !Array.isArray(meta.profiles)) throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP');
  assertManifestChecksums(meta, files);
  const onlyIds = parseProfileIdsFilter(profileIds);
  if (meta.format === 'profile-manager-profile-backup' && meta.version === 2) {
    return restorePortableV2(files, meta, { encrypted: opened.encrypted, collision, running, onlyIds, fault });
  }
  if (meta.version !== 1) throw fail(400, 'Unsupported backup version', 'UNSUPPORTED_BACKUP');
  if (meta.format === 'profile-manager-profile-backup') {
    return restorePortableProfileBackup(files, meta, { collision, running, onlyIds, failPoint, fault });
  }
  if (meta.format !== 'profile-manager-backup') throw fail(400, 'Backup manifest is corrupt', 'CORRUPT_BACKUP');
  if (!byPath.has('profiles.db')) throw fail(400, 'Backup is missing its database', 'CORRUPT_BACKUP');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-restore-'));
  let source;
  try {
    writeTree(tmp, files);
    source = new Database(path.join(tmp, 'profiles.db'), { readonly: true, fileMustExist: true });
    if (source.pragma('integrity_check', { simple: true }) !== 'ok') throw fail(400, 'Backup database failed its integrity check', 'CORRUPT_BACKUP');
    if (!tableExists(source, 'schema_version') || !tableExists(source, 'profiles')) throw fail(400, 'Backup database is missing its schema', 'CORRUPT_BACKUP');
    const version = source.prepare('SELECT COALESCE(MAX(version), 0) v FROM schema_version').get().v;
    if (version > currentVersion(db)) throw fail(400, 'Backup was created by a newer Profile Manager', 'UNSUPPORTED_BACKUP');
    let archived = source.prepare('SELECT * FROM profiles').all();
    const metaIds = meta.profiles.map(profile => profile && profile.id);
    const rowIds = archived.map(profile => profile.id);
    if (!onlyIds) {
      if (metaIds.length !== rowIds.length || metaIds.some(id => !rowIds.includes(id))) throw fail(400, 'Backup manifest does not match its database', 'CORRUPT_BACKUP');
    }
    if (onlyIds) {
      archived = archived.filter(row => onlyIds.has(row.id));
      if (!archived.length) throw fail(400, 'Selected profiles were not found in the backup database', 'INVALID_RESTORE');
      for (const id of onlyIds) {
        if (!metaIds.includes(id)) throw fail(400, `Profile ${id} is not listed in the backup manifest`, 'INVALID_RESTORE');
      }
    }
    const activeRowIds = archived.map(r => r.id);
    for (const file of files) {
      const profile = file.path.match(/^profiles\/([^/]+)\//);
      if (profile && onlyIds && !onlyIds.has(profile[1])) continue;
      if (profile && !activeRowIds.includes(profile[1]) && !rowIds.includes(profile[1])) throw fail(400, 'Backup contains files for a profile that is not in the database', 'CORRUPT_BACKUP');
      if (profile && !onlyIds && !rowIds.includes(profile[1])) throw fail(400, 'Backup contains files for a profile that is not in the database', 'CORRUPT_BACKUP');
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
    const trees = plan.map(item => {
      if (item.action !== 'replace' && fs.existsSync(userDataDir(item.id))) throw fail(409, 'Profile directory already exists', 'COLLISION');
      const prefix = `profiles/${item.row.id}/`;
      return { target: `profiles/${item.id}`, files: files.filter(f => f.path.startsWith(prefix)).map(f => ({ path: f.path.slice(prefix.length), data: f.data })) };
    });
    if (tableExists(source, 'extensions')) for (const e of source.prepare('SELECT * FROM extensions').all()) {
      if (!UUID.test(e.id) || !/^(extensions|gecko-extensions)\/[0-9a-f-]{36}$/i.test(e.storage_dir || '')) throw fail(400, 'Invalid extension storage', 'CORRUPT_BACKUP');
      const prefix = e.storage_dir + '/';
      if (!fs.existsSync(path.join(DATA_DIR, e.storage_dir))) trees.push({ target: e.storage_dir, files: files.filter(f => f.path.startsWith(prefix)).map(f => ({ path: f.path.slice(prefix.length), data: f.data })) });
    }
    runRecoverableRestore({ profileIds: plan.map(p => p.id), trees,
      fault: point => { fault?.(point); if (failPoint === 'before-files' && point === 'prepared') throw fail(500, 'Restore stopped before files were moved', 'RESTORE_FAILED'); },
      applyDatabase: () => {
        for (const item of plan) applyProfile(source, item, archivedKey, result, columnSet(source, 'profiles'), columnSet(db, 'profiles'));
      },
    });
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
    browser_engine: valueOf(row, 'browser_engine', 'chromium'),
    workspace_id: importWorkspace(source, valueOf(row, 'workspace_id', null)),
    is_quick: valueOf(row, 'is_quick', 0),
    deleted_at: valueOf(row, 'deleted_at', null),
    purge_error: valueOf(row, 'purge_error', null),
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

function importWorkspace(source, id) {
  if (!id) return null;
  if (!tableExists(source, 'workspaces')) throw fail(400, 'Workspace dependency is missing', 'DEPENDENCY_MISSING');
  const row = source.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (!row || !UUID.test(id)) throw fail(400, 'Workspace dependency is invalid', 'DEPENDENCY_MISSING');
  const local = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (local) {
    if (local.name !== row.name || local.notes !== row.notes || local.vault_locked !== row.vault_locked) throw fail(409, 'Workspace conflict requires a portable v2 restore with ID remapping', 'COLLISION');
    return id;
  }
  db.prepare('INSERT INTO workspaces (id,name,notes,vault_locked,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, row.name, row.notes, row.vault_locked, row.created_at, row.updated_at);
  return id;
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
  if (!row || !/^(extensions|gecko-extensions)\/[0-9a-f-]{36}$/i.test(row.storage_dir || '')) return false;
  db.prepare(`INSERT INTO extensions (
    id, name, version, description, manifest_version, permissions, host_permissions,
    optional_permissions, optional_host_permissions, storage_dir, created_at, updated_at, browser_engine, gecko_extension_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.name, row.version, row.description || '', row.manifest_version, row.permissions || '[]', row.host_permissions || '[]',
    row.optional_permissions || '[]', row.optional_host_permissions || '[]', row.storage_dir, row.created_at, row.updated_at, row.browser_engine || 'chromium', row.gecko_extension_id || null,
  );
  return true;
}

function restorePortableProfileBackup(files, meta, { collision, running, onlyIds, failPoint, fault }) {
  if (!meta.profileSnapshot?.id) throw fail(400, 'Portable backup is missing profileSnapshot', 'CORRUPT_BACKUP');
  const row = meta.profileSnapshot;
  if (!UUID.test(String(row.id || '')) || typeof row.name !== 'string' || !row.name.trim() ||
      meta.profiles.length !== 1 || meta.profiles[0]?.id !== row.id) throw fail(400, 'Portable profile identity is invalid', 'CORRUPT_BACKUP');
  if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion > currentVersion(db)) throw fail(400, 'Portable backup schema is unsupported', 'UNSUPPORTED_BACKUP');
  try { if (!Array.isArray(JSON.parse(row.tags || '[]'))) throw new Error('tags'); }
  catch { throw fail(400, 'Backup profile tags are invalid', 'CORRUPT_BACKUP'); }
  if (files.some(f => f.path !== 'meta.json' && !f.path.startsWith(`profiles/${row.id}/`))) throw fail(400, 'Portable backup contains unrelated files', 'CORRUPT_BACKUP');
  if (onlyIds && !onlyIds.has(row.id)) throw fail(400, 'Selected profileIds do not match this portable backup', 'INVALID_RESTORE');
  if (running.includes(row.id) && collision === 'replace') throw fail(409, 'Stop the profile before replacing it from a backup.', 'PROFILES_RUNNING');
  const localIds = new Set(db.prepare('SELECT id FROM profiles').all().map(r => r.id));
  const exists = localIds.has(row.id);
  if (exists && collision === 'abort') throw fail(409, `Profile ${row.id} already exists. Choose rename or replace.`, 'COLLISION');
  const item = {
    row,
    action: exists && collision === 'rename' ? 'rename' : exists ? 'replace' : 'add',
    id: exists && collision === 'rename' ? crypto.randomUUID() : row.id,
  };
  const result = { added: [], replaced: [], renamed: [], proxyDetached: [], extensionsSkipped: 0 };
  if (row.workspace_id && !db.prepare('SELECT id FROM workspaces WHERE id=?').get(row.workspace_id)) throw fail(400, 'Older portable backup lacks its workspace; use a full or v2 backup', 'DEPENDENCY_MISSING');
  if (row.proxy_id && !db.prepare('SELECT id FROM proxies WHERE id=?').get(row.proxy_id)) throw fail(400, 'Older portable backup lacks its proxy; use a full or v2 backup', 'DEPENDENCY_MISSING');
  for (const link of meta.extensionLinks || []) {
    const e = db.prepare('SELECT storage_dir FROM extensions WHERE id=?').get(link.extension_id);
    if (!e || !fs.existsSync(path.join(DATA_DIR, e.storage_dir, 'manifest.json'))) throw fail(400, 'Older portable backup lacks extension assets; use a full or v2 backup', 'DEPENDENCY_MISSING');
  }
  if (!exists && fs.existsSync(userDataDir(item.id))) throw fail(409, 'Profile directory already exists', 'COLLISION');
  const prefix = `profiles/${row.id}/`;
  runRecoverableRestore({ profileIds: [item.id], trees: [{ target: `profiles/${item.id}`, files: files.filter(f => f.path.startsWith(prefix)).map(f => ({ path: f.path.slice(prefix.length), data: f.data })) }],
    fault: point => {
      fault?.(point);
      if ((failPoint === 'before-files' && point === 'prepared') || (failPoint === 'after-files' && point === 'install:0')) throw fail(500, 'Injected restore failure', 'RESTORE_FAILED');
    },
    applyDatabase: () => {
      applyProfileFromRow(row, item, null, result, columnSet(db, 'profiles'));
      for (const link of meta.extensionLinks || []) db.prepare('INSERT OR REPLACE INTO profile_extensions (profile_id,extension_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?)').run(item.id, link.extension_id, link.enabled ? 1 : 0, new Date().toISOString(), new Date().toISOString());
    },
  });
  return result;
}

function applyProfileFromRow(row, item, archivedKey, result, destColumns) {
  let proxyId = row.proxy_id || null;
  if (proxyId && !db.prepare('SELECT id FROM proxies WHERE id=?').get(proxyId)) {
    result.proxyDetached.push(item.id);
    proxyId = null;
  }
  const record = {
    id: item.id,
    name: row.name,
    tags: valueOf(row, 'tags', '[]'),
    folder: valueOf(row, 'folder', ''),
    notes: valueOf(row, 'notes', ''),
    created_at: valueOf(row, 'created_at', new Date().toISOString()),
    updated_at: new Date().toISOString(),
    last_launched_at: null,
    last_error: null,
    automation_enabled: valueOf(row, 'automation_enabled', 0),
    proxy_id: proxyId,
    browser_settings: valueOf(row, 'browser_settings', '{"locale":"","timezoneId":"","languages":[]}'),
    webrtc_settings: valueOf(row, 'webrtc_settings', '{"mode":"browser_default"}'),
    advanced_settings: valueOf(row, 'advanced_settings', ADVANCED_DEFAULT),
    browser_engine: valueOf(row, 'browser_engine', 'chromium'),
    workspace_id: row.workspace_id && db.prepare('SELECT id FROM workspaces WHERE id=?').get(row.workspace_id) ? row.workspace_id : null,
    is_quick: valueOf(row, 'is_quick', 0),
    deleted_at: null,
    purge_error: null,
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
}

function ensureExtensionRowInDb(id) {
  return !!db.prepare('SELECT id FROM extensions WHERE id=?').get(id);
}

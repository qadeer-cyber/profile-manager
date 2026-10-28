// Unpacked-extension library. Files are copied into the app data directory after
// manifest checks. Profiles reference that copy; Chromium loads only the enabled ones.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, DATA_DIR } from './db.js';

const MAX_FILES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const invalid = (message, status = 400, code = 'INVALID_EXTENSION') => {
  throw Object.assign(new Error(message), { status, code });
};

function storagePath(rel) {
  if (typeof rel !== 'string' || !/^extensions\/[0-9a-f-]{36}$/i.test(rel)) invalid('extension storage path is invalid', 500, 'EXTENSION_PATH');
  const root = path.resolve(DATA_DIR, 'extensions');
  const abs = path.resolve(DATA_DIR, rel);
  if (path.dirname(abs) !== root) invalid('extension storage path is invalid', 500, 'EXTENSION_PATH');
  return abs;
}

function chromeVersion(value) {
  if (typeof value !== 'string' || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(value)) invalid('version must be one to four numbers, each at most 65535');
  if (value.split('.').some(part => Number(part) > 65535)) invalid('version must be one to four numbers, each at most 65535');
  return value;
}

function permList(manifest, key) {
  if (!(key in manifest) || manifest[key] == null) return [];
  const value = manifest[key];
  if (!Array.isArray(value) || value.length > 100) invalid(`${key} must be an array of at most 100 strings`);
  return value.map(item => {
    if (typeof item !== 'string' || !item || item.length > 200 || /[\u0000-\u001f]/.test(item)) invalid(`${key} contains an invalid entry`);
    return item;
  });
}

export function readExtensionManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  let listed;
  try { listed = fs.lstatSync(file); } catch { invalid('manifest.json is required'); }
  if (listed.isSymbolicLink() || !listed.isFile()) invalid('manifest.json must be a regular file');
  if (listed.size > MAX_MANIFEST_BYTES) invalid('manifest.json is too large');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { invalid('manifest.json is not valid JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) invalid('manifest.json must be an object');
  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) invalid('manifest_version must be 2 or 3');
  if (typeof manifest.name !== 'string') invalid('name is required');
  const name = manifest.name.trim();
  if (!name || name.length > 128 || /[\u0000-\u001f]/.test(manifest.name)) invalid('name is invalid');
  const version = chromeVersion(manifest.version);
  let description = '';
  if ('description' in manifest && manifest.description != null) {
    if (typeof manifest.description !== 'string' || manifest.description.length > 4096 || /[\u0000-\u001f]/.test(manifest.description)) invalid('description is invalid');
    description = manifest.description;
  }
  return {
    name, version, description, manifestVersion: manifest.manifest_version,
    permissions: permList(manifest, 'permissions'),
    hostPermissions: permList(manifest, 'host_permissions'),
    optionalPermissions: permList(manifest, 'optional_permissions'),
    optionalHostPermissions: permList(manifest, 'optional_host_permissions'),
  };
}

function inside(root, target) {
  const base = path.resolve(root);
  const abs = path.resolve(target);
  return abs === base || abs.startsWith(base + path.sep);
}

function collectFiles(root) {
  const files = [];
  let bytes = 0;
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      if (!name || name === '.' || name === '..' || name !== path.basename(name) || name.includes('\0') || name.includes('/') || name.includes('\\')) {
        invalid('extension contains an illegal file name');
      }
      const relPath = rel ? `${rel}/${name}` : name;
      const full = path.join(dir, name);
      const listed = fs.lstatSync(full);
      if (listed.isSymbolicLink()) invalid('symlinks are not allowed in an unpacked extension');
      if (listed.isDirectory()) {
        if (!inside(root, full)) invalid('extension path escapes its directory');
        walk(full, relPath);
      } else if (listed.isFile()) {
        if (!inside(root, full)) invalid('extension path escapes its directory');
        bytes += listed.size;
        if (bytes > MAX_BYTES || files.length >= MAX_FILES) invalid('extension is larger than the import limit (2000 files or 50 MB)');
        files.push({ full, relPath });
      } else invalid('extension contains an unsupported file type');
    }
  };
  walk(root, '');
  return files;
}

export function importUnpackedExtension(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) invalid('path is required');
  if (sourcePath.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(sourcePath)) invalid('path must be a local directory');
  if (!path.isAbsolute(sourcePath)) invalid('path must be absolute');
  let listed;
  try { listed = fs.lstatSync(sourcePath); } catch { invalid('path does not exist'); }
  if (listed.isSymbolicLink()) invalid('path must not be a symlink');
  if (!listed.isDirectory()) invalid('path must be a directory');
  let root;
  try { root = fs.realpathSync(sourcePath); } catch { invalid('path does not exist'); }
  const manifest = readExtensionManifest(root);
  const files = collectFiles(root);
  if (!files.some(file => file.relPath === 'manifest.json')) invalid('manifest.json is required');
  const id = crypto.randomUUID();
  const rel = `extensions/${id}`;
  const dest = storagePath(rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.mkdirSync(dest);
    for (const file of files) {
      const target = path.resolve(dest, ...file.relPath.split('/'));
      if (!inside(dest, target)) invalid('extension path escapes its directory');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.full, target);
    }
    readExtensionManifest(dest);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO extensions (
      id, name, version, description, manifest_version, permissions, host_permissions,
      optional_permissions, optional_host_permissions, storage_dir, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, manifest.name, manifest.version, manifest.description, manifest.manifestVersion,
      JSON.stringify(manifest.permissions), JSON.stringify(manifest.hostPermissions),
      JSON.stringify(manifest.optionalPermissions), JSON.stringify(manifest.optionalHostPermissions),
      rel, now, now,
    );
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
  return publicExtension(extensionRow(id));
}

function parseJsonList(value) {
  const parsed = JSON.parse(value || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function extensionRow(id) {
  return db.prepare('SELECT * FROM extensions WHERE id=?').get(id);
}

export function publicExtension(row, extra = {}) {
  if (!row) return row;
  return {
    id: row.id, name: row.name, version: row.version, description: row.description,
    manifestVersion: row.manifest_version,
    permissions: parseJsonList(row.permissions),
    hostPermissions: parseJsonList(row.host_permissions),
    optionalPermissions: parseJsonList(row.optional_permissions),
    optionalHostPermissions: parseJsonList(row.optional_host_permissions),
    assignedProfiles: db.prepare('SELECT COUNT(*) n FROM profile_extensions WHERE extension_id=?').get(row.id).n,
    createdAt: row.created_at, updatedAt: row.updated_at, ...extra,
  };
}

export function listExtensions() {
  return db.prepare('SELECT * FROM extensions ORDER BY created_at DESC, name, id').all().map(row => publicExtension(row));
}

export function mustExtension(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) invalid('extension id is invalid');
  const row = extensionRow(id);
  if (!row) throw Object.assign(new Error('extension not found'), { status: 404, code: 'EXTENSION_NOT_FOUND' });
  return row;
}

export function deleteExtension(id, force = false) {
  const row = mustExtension(id);
  const assigned = db.prepare('SELECT COUNT(*) n FROM profile_extensions WHERE extension_id=?').get(id).n;
  if (assigned && !force) {
    throw Object.assign(new Error(`Extension is assigned to ${assigned} profile(s). Unassign it first or pass ?force=1.`), { status: 409, code: 'EXTENSION_IN_USE' });
  }
  db.prepare('DELETE FROM extensions WHERE id=?').run(id);
  fs.rmSync(storagePath(row.storage_dir), { recursive: true, force: true });
}

export function profileExtensions(profileId) {
  return db.prepare(`SELECT e.*, pe.enabled FROM extensions e
    JOIN profile_extensions pe ON pe.extension_id = e.id
    WHERE pe.profile_id = ? ORDER BY e.name, e.id`).all(profileId)
    .map(row => {
      const { enabled, ...rest } = publicExtension(row);
      return { ...rest, enabled: !!row.enabled };
    });
}

export function parseExtensionAssignments(value) {
  if (!Array.isArray(value) || value.length > 50) invalid('extensionAssignments must be an array of at most 50 entries');
  const seen = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid('extension assignment must be an object');
    if (Object.keys(entry).some(key => !['extensionId', 'enabled'].includes(key))) invalid('Unknown extension assignment field');
    if (typeof entry.extensionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.extensionId)) invalid('extensionId must be an id');
    if (typeof entry.enabled !== 'boolean') invalid('enabled must be a boolean');
    if (seen.has(entry.extensionId)) invalid('extensionAssignments must not contain duplicates');
    seen.add(entry.extensionId);
    return { extensionId: entry.extensionId, enabled: entry.enabled };
  });
}

export function assertKnownAssignments(value) {
  const parsed = parseExtensionAssignments(value);
  for (const entry of parsed) mustExtension(entry.extensionId);
  return parsed;
}

export function replaceProfileExtensions(profileId, assignments) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM profile_extensions WHERE profile_id=?').run(profileId);
    const insert = db.prepare('INSERT INTO profile_extensions (profile_id, extension_id, enabled, created_at, updated_at) VALUES (?,?,?,?,?)');
    for (const entry of assignments) insert.run(profileId, entry.extensionId, entry.enabled ? 1 : 0, now, now);
  })();
}

export function copyExtensionAssignments(fromId, toId) {
  const rows = db.prepare('SELECT extension_id, enabled FROM profile_extensions WHERE profile_id=?').all(fromId);
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO profile_extensions (profile_id, extension_id, enabled, created_at, updated_at) VALUES (?,?,?,?,?)');
  for (const row of rows) insert.run(toId, row.extension_id, row.enabled, now, now);
}

function assignment(profileId, extensionId) {
  return db.prepare('SELECT enabled FROM profile_extensions WHERE profile_id=? AND extension_id=?').get(profileId, extensionId);
}

export function assignExtension(profileId, extensionId, enabled) {
  mustExtension(extensionId);
  if (typeof enabled !== 'boolean') invalid('enabled must be a boolean');
  const now = new Date().toISOString();
  if (assignment(profileId, extensionId)) {
    db.prepare('UPDATE profile_extensions SET enabled=?, updated_at=? WHERE profile_id=? AND extension_id=?').run(enabled ? 1 : 0, now, profileId, extensionId);
  } else {
    db.prepare('INSERT INTO profile_extensions (profile_id, extension_id, enabled, created_at, updated_at) VALUES (?,?,?,?,?)').run(profileId, extensionId, enabled ? 1 : 0, now, now);
  }
}

export function setExtensionEnabled(profileId, extensionId, enabled) {
  mustExtension(extensionId);
  if (typeof enabled !== 'boolean') invalid('enabled must be a boolean');
  if (!assignment(profileId, extensionId)) throw Object.assign(new Error('extension is not assigned to this profile'), { status: 404, code: 'EXTENSION_NOT_ASSIGNED' });
  db.prepare('UPDATE profile_extensions SET enabled=?, updated_at=? WHERE profile_id=? AND extension_id=?')
    .run(enabled ? 1 : 0, new Date().toISOString(), profileId, extensionId);
}

export function unassignExtension(profileId, extensionId) {
  mustExtension(extensionId);
  const result = db.prepare('DELETE FROM profile_extensions WHERE profile_id=? AND extension_id=?').run(profileId, extensionId);
  if (!result.changes) throw Object.assign(new Error('extension is not assigned to this profile'), { status: 404, code: 'EXTENSION_NOT_ASSIGNED' });
}

export function extensionCommandArgs(paths) {
  if (!Array.isArray(paths) || !paths.length) return { args: [], ignoreDefaultArgs: [] };
  if (paths.some(item => typeof item !== 'string' || !item || item.includes(',') || item.includes('\0'))) {
    invalid('An extension path cannot contain a comma, so Chromium would split --load-extension incorrectly', 500, 'EXTENSION_PATH');
  }
  const joined = paths.join(',');
  // Playwright adds --disable-extensions unless that default is ignored.
  // Omitting a disabled extension is the supported way to keep it unloaded.
  return {
    args: [`--disable-extensions-except=${joined}`, `--load-extension=${joined}`],
    ignoreDefaultArgs: ['--disable-extensions'],
  };
}

export function extensionLaunchPlan(profileId) {
  if (typeof profileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(profileId)) return extensionCommandArgs([]);
  const rows = db.prepare(`SELECT e.* FROM extensions e
    JOIN profile_extensions pe ON pe.extension_id = e.id
    WHERE pe.profile_id = ? AND pe.enabled = 1 ORDER BY e.id`).all(profileId);
  if (!rows.length) return extensionCommandArgs([]);
  const paths = rows.map(row => {
    const dir = storagePath(row.storage_dir);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      invalid(`Extension "${row.name}" is missing from disk. Remove it from the library or import it again.`, 500, 'EXTENSION_MISSING');
    }
    return dir;
  });
  return extensionCommandArgs(paths);
}

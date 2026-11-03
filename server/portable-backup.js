import { hashFileSync } from './file-integrity.js';
// Portable v2: explicit dependencies inside a mandatory authenticated encrypted envelope.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR, userDataDir } from './db.js';
import { currentVersion } from './migrations.js';
import { encrypt, decrypt } from './secrets.js';
import { packArchive, assertArchivePath } from './archive.js';
import { encryptBackup } from './backup-crypto.js';
import { runRecoverableRestore, assertProfileOperationAvailable } from './recovery-journal.js';
import { assertWorkspaceAccess } from './workspaces.js';
import { normalizeProfileConfigInput } from './profile-config-engine.js';
import { validateXpiArchive } from './gecko-xpi.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, code = 'CORRUPT_BACKUP', status = 400) => Object.assign(new Error(message), { status, code });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function validateId(id) { if (!UUID.test(id || '')) throw fail('Invalid dependency identity'); return id; }
function regularPath(rel) {
  const parts = rel.split('/'); let dir = DATA_DIR;
  if (fs.lstatSync(DATA_DIR).isSymbolicLink()) throw fail('Backup refuses a symlink data root', 'UNSAFE_PROFILE_LINK');
  for (const p of parts) { dir = path.join(dir, p); if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw fail('Backup refuses symlink paths', 'UNSAFE_PROFILE_LINK'); }
  return dir;
}
function collect(root, prefix, output, limits, depth = 0) {
  if (!fs.existsSync(root)) return;
  if (depth > 64) throw fail('Backup nesting exceeds limits', 'UNSAFE_ARCHIVE');
  for (const name of fs.readdirSync(root)) {
    const profileRoot = /^profiles\/[0-9a-f-]{36}(?:\/gecko)?$/i.test(prefix);
    if (profileRoot && ['SingletonLock', 'SingletonSocket', 'SingletonCookie', '.pm-lock.json', '.pm-lock', '.parentlock', 'parent.lock', 'lock'].includes(name)) continue;
    const file = path.join(root, name), st = fs.lstatSync(file), rel = prefix + '/' + name;
    assertArchivePath(rel);
    if (st.isSymbolicLink()) throw fail('Backup refuses symlinks', 'UNSAFE_PROFILE_LINK');
    if (st.isDirectory()) collect(file, rel, output, limits, depth + 1);
    else if (st.isFile()) {
      limits.bytes += st.size;
      if (st.size > (limits.streaming ? 4 * 1024 ** 3 : 32 * 1024 * 1024) || limits.bytes > (limits.streaming ? 8 * 1024 ** 3 : 60 * 1024 * 1024) || output.length >= (limits.streaming ? 100000 : 9998)) throw fail('Portable data exceeds 60 MiB or 9998 file limit', 'UNSAFE_ARCHIVE');
      output.push(limits.streaming ? { path: rel, source: file, size: st.size, sha256: hashFileSync(file) } : { path: rel, data: fs.readFileSync(file) });
    } else throw fail('Backup refuses special files', 'UNSAFE_ARCHIVE');
  }
}
function extensionPrefix(row) { return `${row.browser_engine === 'firefox' ? 'gecko-extensions' : 'extensions'}/${row.id}`; }
function boundedData(file, maxBytes) {
  if (!file) return null;
  if (!file.source) { if (file.data.length > maxBytes) throw fail('Extension metadata exceeds size limits'); return file.data; }
  if (fs.statSync(file.source).size > maxBytes) throw fail('Extension metadata exceeds size limits');
  return fs.readFileSync(file.source);
}
function validateExtension(e, files) {
  validateId(e.id);
  if (typeof e.name !== 'string' || !e.name || e.name.length > 128 || typeof e.version !== 'string' || e.version.length > 32 || ![2, 3].includes(e.manifest_version)) throw fail('Extension metadata is invalid');
  for (const key of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions']) {
    try { const entries = JSON.parse(e[key]); if (!Array.isArray(entries) || entries.length > 100 || entries.some(p => typeof p !== 'string' || p.length > 200)) throw Error(); }
    catch { throw fail('Extension permission metadata is invalid'); }
  }
  if (!['chromium', 'firefox'].includes(e.browser_engine) || e.storage_dir !== extensionPrefix(e)) throw fail('Extension storage mapping is invalid');
  const manifestFile = files.find(f => f.path === e.storage_dir + '/manifest.json');
  if (!manifestFile) throw fail('Portable extension assets are missing', 'DEPENDENCY_MISSING');
  let manifest;
  try { manifest = JSON.parse(boundedData(manifestFile, 1024 * 1024).toString('utf8')); } catch { throw fail('Portable extension manifest is invalid'); }
  if (![2, 3].includes(manifest?.manifest_version) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw fail('Portable extension manifest is invalid');
  if (e.browser_engine === 'firefox') {
    const gid = manifest.browser_specific_settings?.gecko?.id || manifest.applications?.gecko?.id;
    if (typeof gid !== 'string' || !/^(?:[a-z0-9._+-]+@[a-z0-9._-]+|\{[0-9a-f-]{36}\})$/i.test(gid) || gid !== e.gecko_extension_id) throw fail('Portable Firefox extension identity is invalid');
    const xpi = files.find(f => f.path === e.storage_dir + '/extension.xpi');
    if (xpi) {
      const inside = validateXpiArchive(boundedData(xpi, 32 * 1024 * 1024)).get('manifest.json');
      if (!inside || !inside.equals(boundedData(manifestFile, 1024 * 1024))) throw fail('XPI and extension manifests disagree');
    }
  }
}
export function createPortableBackup(profileId, options = {}) {
  return db.transaction(() => createPortableSnapshot(profileId, options)).immediate();
}
function createPortableSnapshot(profileId, { ids = [], passphrase, confirmSensitive = false, descriptorMode = false } = {}) {
  if (!confirmSensitive) throw fail('Confirm export of sensitive browser data and choose a passphrase.', 'SENSITIVE_EXPORT_CONFIRMATION');
  // Validate encryption controls before reading sensitive data.
  if (typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > 1024) throw fail('Passphrase must be 8 to 1024 characters', 'INVALID_PASSPHRASE');
  validateId(profileId); assertProfileOperationAvailable(profileId);
  if (db.prepare('SELECT id FROM running WHERE id=?').get(profileId)) throw fail('Profile has an active session', 'PROFILES_RUNNING', 409);
  if (ids.includes(profileId)) throw fail('Stop the profile before exporting.', 'PROFILES_RUNNING', 409);
  const row = db.prepare('SELECT * FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (!row || row.purge_error) throw fail('Profile is missing or requires recovery', 'PROFILE_RECOVERY_REQUIRED');
  assertWorkspaceAccess(row.workspace_id);
  const deps = { workspace: null, proxy: null, extensions: [], assignments: [] };
  if (row.workspace_id) {
    deps.workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id);
    if (!deps.workspace) throw fail('Referenced workspace is missing', 'DEPENDENCY_MISSING');
  }
  if (row.proxy_id) {
    const px = db.prepare('SELECT * FROM proxies WHERE id=?').get(row.proxy_id);
    if (!px) throw fail('Referenced proxy is missing', 'DEPENDENCY_MISSING');
    deps.proxy = Object.fromEntries(['id', 'name', 'type', 'host', 'port', 'username', 'tags'].map(k => [k, px[k]]));
    try { deps.proxy.password = decrypt(px.password); } catch { throw fail('Proxy secret cannot be decrypted. Re-enter it before export.', 'PROXY_SECRET_UNAVAILABLE'); }
  }
  if (row.proxy) throw fail('Legacy inline proxy must be migrated before portable export', 'DEPENDENCY_MISSING');
  const files = [], limits = { bytes: 0, streaming: descriptorMode };
  const profileRoot = regularPath(`profiles/${profileId}`);
  if (fs.existsSync(profileRoot)) collect(profileRoot, `profiles/${profileId}`, files, limits);
  for (const link of db.prepare('SELECT extension_id,enabled FROM profile_extensions WHERE profile_id=?').all(profileId)) {
    const e = db.prepare('SELECT * FROM extensions WHERE id=?').get(link.extension_id);
    if (!e || e.browser_engine !== row.browser_engine) throw fail('Extension dependency is missing or uses another engine', 'DEPENDENCY_MISSING');
    if (typeof e.storage_dir !== 'string' || !/^(extensions|gecko-extensions)\/[0-9a-f-]{36}$/i.test(e.storage_dir)) throw fail('Unsafe extension storage');
    const root = regularPath(e.storage_dir), prefix = extensionPrefix(e);
    if (!fs.existsSync(root)) throw fail('Required extension files are missing', 'DEPENDENCY_MISSING');
    collect(root, prefix, files, limits);
    const copy = { ...e, storage_dir: prefix };
    validateExtension(copy, files); deps.extensions.push(copy); deps.assignments.push(link);
  }
  const meta = {
    format: 'profile-manager-profile-backup', version: 2, schemaVersion: currentVersion(db), createdAt: new Date().toISOString(),
    profiles: [{ id: row.id, name: row.name }], profileSnapshot: row, dependencies: deps,
    fileChecksums: Object.fromEntries(files.map(f => [f.path, f.sha256 || hash(f.data)])),
    limitations: ['Browser data may contain OS-bound credentials. Password-manager entries and browser-encrypted cookies are not guaranteed portable across operating systems or machines.'],
  };
  if (descriptorMode) return { meta, files };
  const encodedManifest = Buffer.from(JSON.stringify(meta));
  if (encodedManifest.length > 1024 * 1024) throw fail('Portable manifest exceeds 1 MiB', 'UNSAFE_ARCHIVE');
  const archive = packArchive([{ path: 'meta.json', data: encodedManifest }, ...files]);
  if (archive.length + 64 > 64 * 1024 * 1024) throw fail('Portable container exceeds the 64 MiB transfer limit', 'UNSAFE_ARCHIVE');
  return encryptBackup(archive, passphrase);
}

export function createPortableDescriptors(profileId, options = {}) {
  return db.transaction(() => createPortableSnapshot(profileId, { ...options, descriptorMode: true })).immediate();
}

export function validatePortableV2(files, meta, { encrypted } = {}) {
  if (!encrypted) throw fail('Portable v2 archives must use authenticated encryption', 'ENCRYPTION_REQUIRED');
  const row = meta.profileSnapshot, deps = meta.dependencies;
  if (meta.version !== 2 || !Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1 || meta.schemaVersion > currentVersion(db)) throw fail('Portable schema is unsupported', 'UNSUPPORTED_BACKUP');
  validateId(row?.id);
  if (meta.profiles?.length !== 1 || meta.profiles[0]?.id !== row.id || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200) throw fail('Portable profile identity is invalid');
  if (!deps || !Array.isArray(deps.extensions) || !Array.isArray(deps.assignments) || deps.extensions.length > 50 || deps.assignments.length > 50 || !meta.fileChecksums || typeof meta.fileChecksums !== 'object' || Array.isArray(meta.fileChecksums)) throw fail('Portable dependency mapping is invalid');
  try {
    if (!Array.isArray(JSON.parse(row.tags))) throw Error();
    normalizeProfileConfigInput({ browserEngine: row.browser_engine, browserSettings: JSON.parse(row.browser_settings), webrtcSettings: JSON.parse(row.webrtc_settings), advancedSettings: JSON.parse(row.advanced_settings) });
  } catch { throw fail('Portable browser configuration is invalid'); }
  if (row.proxy) throw fail('Portable inline proxy is unsupported');
  if (row.workspace_id) {
    if (deps.workspace?.id !== row.workspace_id || typeof deps.workspace.name !== 'string' || !deps.workspace.name.trim() || deps.workspace.name.length > 120 || ![0, 1].includes(deps.workspace.vault_locked)) throw fail('Required workspace dependency is missing or invalid', 'DEPENDENCY_MISSING');
    validateId(row.workspace_id);
  } else if (deps.workspace !== null) throw fail('Unreferenced workspace dependency');
  if (row.proxy_id) {
    const px = deps.proxy;
    if (px?.id !== row.proxy_id || !['http', 'https', 'socks5'].includes(px.type) || typeof px.host !== 'string' || !px.host || /[\x00-\x20]/.test(px.host) || !Number.isInteger(px.port) || px.port < 1 || px.port > 65535 || typeof px.password !== 'string' || typeof px.username !== 'string') throw fail('Required proxy dependency is missing or invalid', 'DEPENDENCY_MISSING');
    validateId(px.id);
  } else if (deps.proxy !== null) throw fail('Unreferenced proxy dependency');
  const ids = new Set();
  for (const e of deps.extensions) {
    if (ids.has(e.id) || e.browser_engine !== row.browser_engine) throw fail('Duplicate or incompatible extension dependency');
    ids.add(e.id); validateExtension(e, files);
  }
  const links = new Set();
  for (const link of deps.assignments) {
    if (!ids.has(link.extension_id) || links.has(link.extension_id) || ![0, 1].includes(link.enabled)) throw fail('Required extension assignment is invalid', 'DEPENDENCY_MISSING');
    links.add(link.extension_id);
  }
  if (links.size !== ids.size) throw fail('Unreferenced extension dependency');
  const roots = [`profiles/${row.id}/`, ...deps.extensions.map(e => extensionPrefix(e) + '/')];
  const payload = files.filter(f => f.path !== 'meta.json');
  if (Object.keys(meta.fileChecksums).length !== payload.length) throw fail('Portable checksum manifest is incomplete');
  for (const f of payload) if (!roots.some(r => f.path.startsWith(r)) || meta.fileChecksums[f.path] !== (f.sha256 || hash(f.data))) throw fail('Portable file checksum or dependency path is invalid');
  return { row, deps };
}
function insertRow(table, record) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  const keys = Object.keys(record).filter(k => columns.has(k));
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => '@' + k).join(',')})`).run(Object.fromEntries(keys.map(k => [k, record[k]])));
}
function planPortableRestore(files, meta, { encrypted, collision, running = [], onlyIds, workspaceId: targetWorkspace } = {}, context = {}) {
  const { row, deps } = validatePortableV2(files, meta, { encrypted });
  if (onlyIds && (onlyIds.size !== 1 || !onlyIds.has(row.id))) throw fail('Selected profile does not match this archive', 'INVALID_RESTORE');
  const existing = db.prepare('SELECT id,workspace_id FROM profiles WHERE id=?').get(row.id);
  if (existing && collision === 'replace') assertWorkspaceAccess(existing.workspace_id);
  if (existing && collision === 'abort') throw fail('Profile already exists; choose rename or replace', 'COLLISION', 409);
  if (existing && collision === 'replace' && running.includes(row.id)) throw fail('Stop the profile before replacing it', 'PROFILES_RUNNING', 409);
  const id = existing && collision === 'rename' ? crypto.randomUUID() : row.id;
  if (!existing && fs.existsSync(userDataDir(id))) throw fail('An orphan profile directory blocks restore', 'COLLISION', 409);
  const mapping = context.mapping ||= { profiles: {}, workspaces: {}, proxies: {}, extensions: {} };
  mapping.profiles[row.id] = id;
  const inserted = context.inserted ||= new Set();
  const first = key => { if (inserted.has(key)) return false; inserted.add(key); return true; };
  const remap = (table, sourceId) => {
    if (mapping[table][sourceId]) return mapping[table][sourceId];
    let dest = sourceId;
    if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(dest) || (table === 'extensions' && (fs.existsSync(path.join(DATA_DIR, 'extensions', dest)) || fs.existsSync(path.join(DATA_DIR, 'gecko-extensions', dest))))) dest = crypto.randomUUID();
    mapping[table][sourceId] = dest; return dest;
  };
  if (targetWorkspace) { validateId(targetWorkspace); if (!context.newWorkspace) assertWorkspaceAccess(targetWorkspace); }
  const workspaceId = targetWorkspace || (deps.workspace ? remap('workspaces', deps.workspace.id) : null);
  if (deps.workspace && targetWorkspace) mapping.workspaces[deps.workspace.id] = targetWorkspace;
  const proxyId = deps.proxy ? remap('proxies', deps.proxy.id) : null;
  for (const e of deps.extensions) remap('extensions', e.id);
  const treeFor = (prefix, target) => ({ target, files: files.filter(f => f.path.startsWith(prefix + '/')).map(f => ({ path: f.path.slice(prefix.length + 1), ...(f.source ? { source: f.source, sha256: f.sha256 } : { data: f.data }) })) });
  const newExtensions = deps.extensions.filter(e => first('extensions:' + e.id));
  const newProxy = deps.proxy && first('proxies:' + deps.proxy.id);
  const trees = [treeFor(`profiles/${row.id}`, `profiles/${id}`), ...newExtensions.map(e => treeFor(extensionPrefix(e), `${e.browser_engine === 'firefox' ? 'gecko-extensions' : 'extensions'}/${mapping.extensions[e.id]}`))];
  const now = new Date().toISOString();
  const result = { added: [], replaced: [], renamed: [], proxyDetached: [], extensionsSkipped: 0, dependencyMap: mapping, warnings: meta.limitations || [] };
  const applyDatabase = () => {
    if (deps.workspace && !targetWorkspace) insertRow('workspaces', { ...deps.workspace, id: workspaceId, created_at: now, updated_at: now });
    if (newProxy) insertRow('proxies', { ...deps.proxy, id: proxyId, password: encrypt(deps.proxy.password), created_at: now, updated_at: now });
    for (const e of newExtensions) insertRow('extensions', { ...e, id: mapping.extensions[e.id], storage_dir: `${e.browser_engine === 'firefox' ? 'gecko-extensions' : 'extensions'}/${mapping.extensions[e.id]}`, created_at: now, updated_at: now });
    const record = { ...row, id, workspace_id: workspaceId, proxy_id: proxyId, proxy: null, deleted_at: null, purge_error: null, updated_at: now, last_launched_at: null, last_error: null };
    if (existing && collision === 'replace') {
      db.prepare('DELETE FROM profile_extensions WHERE profile_id=?').run(id);
      const columns = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name).filter(k => k !== 'id' && Object.hasOwn(record, k));
      db.prepare(`UPDATE profiles SET ${columns.map(k => k + '=@' + k).join(',')} WHERE id=@id`).run(Object.fromEntries(['id', ...columns].map(k => [k, record[k]])));
    } else insertRow('profiles', record);
    for (const link of deps.assignments) insertRow('profile_extensions', { profile_id: id, extension_id: mapping.extensions[link.extension_id], enabled: link.enabled, created_at: now, updated_at: now });
  };
  result[existing ? collision === 'rename' ? 'renamed' : 'replaced' : 'added'].push({ id, sourceId: row.id, name: row.name });
  return { id, trees, applyDatabase, result };
}

export function restorePortableV2(files, meta, options = {}) {
  const plan = planPortableRestore(files, meta, options);
  runRecoverableRestore({ profileIds: [plan.id], trees: plan.trees, applyDatabase: plan.applyDatabase, fault: options.fault });
  return plan.result;
}


// A workspace envelope contains complete portable-v2 members and shared assets once.
export function createPortableWorkspaceDescriptors(workspaceId, options = {}) {
  return db.transaction(() => {
    assertWorkspaceAccess(workspaceId);
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
    if (!workspace) throw fail('Workspace not found', 'NOT_FOUND', 404);
    if (options.confirmSensitive !== true || typeof options.passphrase !== 'string' || options.passphrase.length < 8 || options.passphrase.length > 1024) throw fail('Confirm sensitive workspace export and provide a passphrase', 'SENSITIVE_EXPORT_CONFIRMATION');
    const profiles = db.prepare('SELECT id FROM profiles WHERE workspace_id=? AND deleted_at IS NULL ORDER BY id').all(workspaceId);
    if (profiles.length > 100) throw fail('Workspace export supports up to 100 profiles', 'UNSAFE_ARCHIVE');
    const members = [], assets = new Map();
    for (const { id } of profiles) {
      const snapshot = createPortableSnapshot(id, { ...options, descriptorMode: true });
      members.push(snapshot.meta);
      for (const f of snapshot.files) assets.set(f.path, f);
    }
    const files = [...assets.values()];
    if (files.length > 99999 || files.reduce((n, f) => n + f.size, 0) > 8 * 1024 ** 3) throw fail('Workspace payload exceeds portable limits', 'UNSAFE_ARCHIVE');
    return { files, meta: { format: 'profile-manager-workspace-backup', version: 1, workspace, members,
      profiles: members.flatMap(m => m.profiles), createdAt: new Date().toISOString(),
      limitations: ['OS-bound browser credentials may not decrypt on another computer. Team synchronization transfers encrypted snapshots and requires explicit conflict resolution.'] } };
  }).immediate();
}
export function validatePortableWorkspace(files, meta, { encrypted } = {}) {
  const w = meta?.workspace;
  if (!encrypted || meta?.format !== 'profile-manager-workspace-backup' || meta.version !== 1 || !w || !UUID.test(w.id || '') || typeof w.name !== 'string' || !w.name.trim() || w.name.length > 120 || typeof w.notes !== 'string' || w.notes.length > 2000 || ![0, 1].includes(w.vault_locked) || !Array.isArray(meta.members) || meta.members.length > 100) throw fail('Invalid encrypted workspace manifest');
  const ids = new Set(), allowed = new Set(['meta.json']), dependencies = new Map();
  for (const member of meta.members) {
    if (ids.has(member?.profileSnapshot?.id) || member?.profileSnapshot?.workspace_id !== w.id || JSON.stringify(member?.dependencies?.workspace) !== JSON.stringify(w)) throw fail('Workspace membership mapping is invalid');
    const paths = Object.keys(member.fileChecksums || {});
    validatePortableV2(files.filter(f => paths.includes(f.path)), member, { encrypted: true });
    ids.add(member.profileSnapshot.id); paths.forEach(p => allowed.add(p));
    for (const [kind, rows] of [['proxy', member.dependencies.proxy ? [member.dependencies.proxy] : []], ['extension', member.dependencies.extensions]]) {
      for (const row of rows) {
        const key = kind + ':' + row.id, encoded = JSON.stringify(row);
        if (dependencies.has(key) && dependencies.get(key) !== encoded) throw fail('Conflicting shared dependency');
        dependencies.set(key, encoded);
      }
    }
  }
  if (files.some(f => !allowed.has(f.path))) throw fail('Unreferenced workspace asset');
  if (!Array.isArray(meta.profiles) || meta.profiles.length !== ids.size || meta.profiles.some(p => !ids.delete(p.id)) || ids.size) throw fail('Workspace profile index is invalid');
  return w;
}
export function restorePortableWorkspace(files, meta, options = {}) {
  const source = validatePortableWorkspace(files, meta, options);
  if (options.profileIds || options.onlyIds || options.workspaceId) throw fail('Workspace snapshots restore as a complete new workspace');
  const id = db.prepare('SELECT id FROM workspaces WHERE id=?').get(source.id) ? crypto.randomUUID() : source.id;
  const context = { newWorkspace: true }, plans = meta.members.map(member => planPortableRestore(files.filter(f => Object.hasOwn(member.fileChecksums, f.path)), member, { ...options, workspaceId: id }, context));
  const now = new Date().toISOString();
  const applyDatabase = () => {
    insertRow('workspaces', { ...source, id, created_at: now, updated_at: now });
    for (const plan of plans) plan.applyDatabase();
  };
  if (plans.length) runRecoverableRestore({ profileIds: plans.map(p => p.id), trees: plans.flatMap(p => p.trees), applyDatabase, fault: options.fault });
  else db.transaction(applyDatabase).immediate(); // Empty workspace has no filesystem mutations.
  return { workspaceId: id, added: plans.flatMap(p => p.result.added), renamed: plans.flatMap(p => p.result.renamed), replaced: plans.flatMap(p => p.result.replaced), dependencyMap: context.mapping || { workspaces: { [source.id]: id } }, warnings: meta.limitations || [] };
}

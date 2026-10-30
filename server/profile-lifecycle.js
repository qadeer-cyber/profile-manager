// Quick profiles, trash (soft delete), and profile templates.
import crypto from 'crypto';
import fs from 'fs';
import { db, userDataDir } from './db.js';
import { geckoUserDataDir } from './browser-runtime/firefox-launch.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

const trashLocks = new Set();

export function profileDataPaths(id) {
  return {
    chromium: userDataDir(id),
    gecko: geckoUserDataDir(id, userDataDir),
  };
}

/** Remove on-disk profile trees. DB row must still exist until this succeeds. */
export function removeProfileDataFromDisk(id, { rmSyncImpl = fs.rmSync } = {}) {
  const failures = [];
  for (const [kind, dir] of Object.entries(profileDataPaths(id))) {
    try {
      if (!fs.existsSync(dir)) continue;
      rmSyncImpl(dir, { recursive: true, force: true });
      if (fs.existsSync(dir)) failures.push(`${kind}: directory still present after removal (${dir})`);
    } catch (e) {
      failures.push(`${kind}: ${e.message || e}`);
    }
  }
  if (failures.length) {
    throw fail(500, `Profile data removal failed: ${failures.join('; ')}`, 'PURGE_FS_FAILED');
  }
}

export function clearPurgeError(id) {
  db.prepare('UPDATE profiles SET purge_error=NULL, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
}

export function recordPurgeError(id, message) {
  db.prepare('UPDATE profiles SET purge_error=?, updated_at=? WHERE id=?').run(String(message || 'purge failed').slice(0, 500), new Date().toISOString(), id);
}

/** Startup reports interrupted purges. Retrying destructive cleanup requires explicit confirmation. */
export function resumeIncompletePurges() {
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
  if (!cols.includes('purge_error')) return [];
  return db.prepare('SELECT id, purge_error FROM profiles WHERE deleted_at IS NOT NULL AND purge_error IS NOT NULL').all()
    .map(row => ({ id: row.id, recovered: false, requiresConfirmation: true, error: row.purge_error }));
}

export function activeProfileFilterSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}deleted_at IS NULL`;
}

export function createQuickProfile({ name, folder = '', insertFn }) {
  const label = String(name || '').trim() || `Quick ${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const id = insertFn({
    name: label.slice(0, 200),
    tags: ['quick'],
    folder: String(folder || '').trim(),
    notes: 'Temporary quick profile',
    browserEngine: 'chromium',
    browserSettings: { locale: '', timezoneId: '', languages: [] },
    webrtcSettings: { mode: 'browser_default' },
    advancedSettings: undefined,
    extensionAssignments: [],
    proxyId: null,
    automationEnabled: false,
    isQuick: true,
  });
  return id;
}

export async function softDeleteProfile(id, { stopFn, isRunningFn } = {}) {
  if (trashLocks.has(id)) throw fail(409, 'Trash operation already in progress for this profile', 'TRASH_BUSY');
  trashLocks.add(id);
  try {
    const row = db.prepare('SELECT * FROM profiles WHERE id=? AND deleted_at IS NULL').get(id);
    if (!row) throw fail(404, 'Profile not found', 'NOT_FOUND');
    if (typeof stopFn === 'function') {
      await stopFn(id);
    }
    if (isRunningFn?.(id)) {
      throw fail(409, 'Profile is still running; trash was not applied', 'PROFILE_STILL_RUNNING');
    }
    db.prepare('UPDATE profiles SET deleted_at=?, updated_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), id);
    return { id, trashed: true };
  } catch (e) {
    if (e.status && e.code) throw e;
    throw fail(500, e.message || 'Trash failed', 'TRASH_FAILED');
  } finally {
    trashLocks.delete(id);
  }
}

export function listTrash(mapRow) {
  return db.prepare('SELECT * FROM profiles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all().map(mapRow);
}

export function restoreFromTrash(id) {
  if (trashLocks.has(id)) throw fail(409, 'Trash operation in progress', 'TRASH_BUSY');
  const row = db.prepare('SELECT id, purge_error FROM profiles WHERE id=? AND deleted_at IS NOT NULL').get(id);
  if (!row) throw fail(404, 'Profile not in trash', 'NOT_IN_TRASH');
  if (row.purge_error) throw fail(409, 'A purge was interrupted; profile files may be incomplete. Restore a backup or explicitly retry the purge.', 'PURGE_RECOVERY_REQUIRED');
  db.prepare('UPDATE profiles SET deleted_at=NULL, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  return { id, restored: true };
}

export async function purgeFromTrash(id, { confirmName, stopFn, isRunningFn, rmSyncImpl } = {}) {
  if (trashLocks.has(id)) throw fail(409, 'Trash operation in progress', 'TRASH_BUSY');
  trashLocks.add(id);
  try {
    const row = db.prepare('SELECT name FROM profiles WHERE id=? AND deleted_at IS NOT NULL').get(id);
    if (!row) throw fail(404, 'Profile not in trash', 'NOT_IN_TRASH');
    if (String(confirmName || '') !== row.name) throw fail(400, 'confirmName must match the profile name exactly', 'CONFIRM_NAME_MISMATCH');
    if (typeof stopFn === 'function') await stopFn(id).catch(() => {});
    if (isRunningFn?.(id)) throw fail(409, 'Cannot purge a running profile', 'PROFILE_STILL_RUNNING');
    recordPurgeError(id, 'Purge started; interrupted cleanup requires review');
    try {
      removeProfileDataFromDisk(id, { rmSyncImpl });
    } catch (e) {
      if (e.code === 'PURGE_FS_FAILED') recordPurgeError(id, e.message);
      throw e;
    }
    db.prepare('DELETE FROM profiles WHERE id=?').run(id);
    return { id, purged: true };
  } finally {
    trashLocks.delete(id);
  }
}

export function convertQuickToRegular(id) {
  const row = db.prepare('SELECT id, is_quick FROM profiles WHERE id=? AND deleted_at IS NULL').get(id);
  if (!row) throw fail(404, 'Profile not found', 'NOT_FOUND');
  if (!row.is_quick) return { id, converted: false };
  db.prepare('UPDATE profiles SET is_quick=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  return { id, converted: true };
}

export function createTemplateFromProfile(profileId, { name, getProfile }) {
  const p = getProfile(profileId);
  if (!p) throw fail(404, 'Profile not found', 'NOT_FOUND');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const snapshot = {
    browserEngine: p.browserEngine || 'chromium',
    browserSettings: p.browserSettings,
    webrtcSettings: p.webrtcSettings,
    advancedSettings: p.advancedSettings,
    folder: p.folder,
    tags: p.tags.filter(t => t !== 'quick'),
    automationEnabled: p.automationEnabled,
    proxyId: p.proxy_id || null,
  };
  db.prepare('INSERT INTO profile_templates (id,name,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(id, String(name || `${p.name} template`).slice(0, 120), JSON.stringify(snapshot), now, now);
  return { id, name: String(name || `${p.name} template`).slice(0, 120) };
}

export function listTemplates() {
  return db.prepare('SELECT id,name,created_at,updated_at FROM profile_templates ORDER BY updated_at DESC').all();
}

export function applyTemplate(templateId, { name, insertFn, getTemplateSnapshot }) {
  const row = db.prepare('SELECT * FROM profile_templates WHERE id=?').get(templateId);
  if (!row) throw fail(404, 'Template not found', 'NOT_FOUND');
  const snap = getTemplateSnapshot(row);
  const id = insertFn({
    name: String(name || row.name || 'From template').slice(0, 200),
    tags: snap.tags || [],
    folder: snap.folder || '',
    notes: '',
    browserEngine: snap.browserEngine || 'chromium',
    browserSettings: snap.browserSettings,
    webrtcSettings: snap.webrtcSettings,
    advancedSettings: snap.advancedSettings,
    extensionAssignments: [],
    proxyId: snap.proxyId || null,
    automationEnabled: !!snap.automationEnabled,
    isQuick: false,
  });
  return id;
}

export function deleteTemplate(templateId) {
  const result = db.prepare('DELETE FROM profile_templates WHERE id=?').run(templateId);
  if (!result.changes) throw fail(404, 'Template not found', 'NOT_FOUND');
  return { id: templateId, deleted: true };
}

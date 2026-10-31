// Local workspaces (project folders). No cloud sync.
import crypto from 'crypto';
import { db } from './db.js';
import { encryptionStatus } from './secrets.js';
import { assertProfileOperationAvailable } from './recovery-journal.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export function vaultStorageAvailable() {
  const backend = encryptionStatus().backend;
  return backend === 'electron-safeStorage' || backend === 'test-os';
}

export function listWorkspaces({ q } = {}) {
  const needle = q != null && String(q).trim() ? String(q).trim().toLowerCase() : '';
  const rows = db.prepare(`
    SELECT w.*, (SELECT COUNT(*) FROM profiles p WHERE p.workspace_id=w.id AND p.deleted_at IS NULL) AS profile_count
    FROM workspaces w ORDER BY w.updated_at DESC`).all().map(row => ({
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    vaultLocked: !!row.vault_locked,
    profileCount: row.profile_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  if (!needle) return rows;
  return rows.filter(ws => ws.name.toLowerCase().includes(needle) || (ws.notes || '').toLowerCase().includes(needle));
}

export function getWorkspace(id) {
  const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    vaultLocked: !!row.vault_locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assertWorkspaceAccess(workspaceId) {
  if (!workspaceId) return;
  const ws = getWorkspace(workspaceId);
  if (!ws) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  if (ws.vaultLocked && !vaultStorageAvailable()) {
    throw fail(403, 'This workspace is vault-locked and requires OS secure storage (Electron/DPAPI). Open the desktop app or disable vault lock.', 'VAULT_LOCKED');
  }
}

export function createWorkspace({ name, notes = '', vaultLocked = false }) {
  const label = String(name || '').trim();
  if (!label || label.length > 120) throw fail(400, 'name must be 1-120 characters', 'INVALID_WORKSPACE');
  if (vaultLocked && !vaultStorageAvailable()) {
    throw fail(400, 'Vault lock requires OS secure storage (Electron safeStorage/DPAPI). It is not available in this process.', 'VAULT_UNAVAILABLE');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workspaces (id,name,notes,vault_locked,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, label, String(notes || '').slice(0, 2000), vaultLocked ? 1 : 0, now, now);
  return getWorkspace(id);
}

function updateWorkspaceInTransaction(id, { name, notes, vaultLocked, expectedUpdatedAt }) {
  const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (!row) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  assertWorkspaceAccess(id);
  if (expectedUpdatedAt && expectedUpdatedAt !== row.updated_at) throw fail(409, 'Workspace changed; reload before saving', 'WORKSPACE_CONFLICT');
  for (const profile of db.prepare('SELECT id FROM profiles WHERE workspace_id=?').all(id)) assertProfileOperationAvailable(profile.id);
  const now = new Date(Math.max(Date.now(), (Date.parse(row.updated_at) || 0) + 1)).toISOString();
  const nextName = name != null ? String(name).trim() : row.name;
  if (!nextName || nextName.length > 120) throw fail(400, 'name must be 1-120 characters', 'INVALID_WORKSPACE');
  let locked = !!row.vault_locked;
  if (vaultLocked != null) {
    if (vaultLocked && !vaultStorageAvailable()) throw fail(400, 'Vault lock requires OS secure storage', 'VAULT_UNAVAILABLE');
    locked = !!vaultLocked;
  }
  const nextNotes = notes != null ? String(notes).slice(0, 2000) : row.notes;
  db.prepare('UPDATE workspaces SET name=?, notes=?, vault_locked=?, updated_at=? WHERE id=?')
    .run(nextName.slice(0, 120), nextNotes, locked ? 1 : 0, now, id);
  return getWorkspace(id);
}

function guardProfileMutation(profileId) {
  const row = db.prepare('SELECT id,workspace_id FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (row) { assertProfileOperationAvailable(profileId); assertWorkspaceAccess(row.workspace_id); }
  return row;
}

function deleteWorkspaceInTransaction(id) {
  assertWorkspaceAccess(id);
  const row = db.prepare('SELECT id FROM workspaces WHERE id=?').get(id);
  if (!row) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  const profiles = db.prepare('SELECT id FROM profiles WHERE workspace_id=?').all(id);
  for (const profile of profiles) assertProfileOperationAvailable(profile.id);
  db.prepare('UPDATE profiles SET workspace_id=NULL, updated_at=? WHERE workspace_id=?').run(new Date().toISOString(), id);
  db.prepare('DELETE FROM workspaces WHERE id=?').run(id);
  return { id, deleted: true };
}

function assignProfileWorkspaceInTransaction(profileId, workspaceId) {
  if (!guardProfileMutation(profileId)) throw fail(404, 'Profile not found', 'NOT_FOUND');
  if (workspaceId) assertWorkspaceAccess(workspaceId);
  db.prepare('UPDATE profiles SET workspace_id=?, updated_at=? WHERE id=? AND deleted_at IS NULL')
    .run(workspaceId || null, new Date().toISOString(), profileId);
}

function bulkAssignProfilesToWorkspaceInTransaction(workspaceId, profileIds) {
  assertWorkspaceAccess(workspaceId);
  if (!Array.isArray(profileIds) || !profileIds.length || profileIds.length > 100 || new Set(profileIds).size !== profileIds.length) {
    throw fail(400, 'profileIds must be an array of 1-100 profile ids', 'INVALID_WORKSPACE');
  }
  const ids = profileIds.map(profileId => {
    const row = db.prepare('SELECT id FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
    if (!row) throw fail(404, `Profile ${profileId} not found`, 'NOT_FOUND');
    assertProfileOperationAvailable(profileId);
    return profileId;
  });
  const results = [];
  for (const profileId of ids) {
    assignProfileWorkspace(profileId, workspaceId);
    results.push({ id: profileId, ok: true });
  }
  return { workspaceId, assigned: results.length, results };
}

/** Import local workspace metadata export; re-links profiles that still exist by id. */
export function importWorkspaceBundle(payload) {
  if (!payload || payload.format !== 'profile-manager-workspace' || !payload.workspace) {
    throw fail(400, 'Expected profile-manager-workspace export JSON', 'INVALID_WORKSPACE_IMPORT');
  }
  const src = payload.workspace;
  const assigned = [];
  for (const profile of payload.profiles || []) {
    if (!profile?.id) continue;
    if (guardProfileMutation(profile.id)) assigned.push(profile.id);
  }
  const ws = db.transaction(() => {
    const byId = src.id ? getWorkspace(src.id) : null;
    const next = byId
      ? updateWorkspace(byId.id, { name: src.name || byId.name, notes: src.notes ?? byId.notes })
      : createWorkspace({ name: src.name || 'Imported workspace', notes: src.notes || '' });
    for (const id of assigned) assignProfileWorkspace(id, next.id);
    return next;
  })();
  return {
    workspace: ws,
    assignedProfileIds: assigned,
    skippedProfiles: Math.max(0, (payload.profiles || []).filter(profile => profile?.id).length - assigned.length),
  };
}

export function exportWorkspaceBundle(workspaceId) {
  assertWorkspaceAccess(workspaceId);
  const ws = getWorkspace(workspaceId);
  if (!ws) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  const profiles = db.prepare(`
    SELECT id, name, browser_engine, folder, tags, workspace_id, created_at, updated_at
    FROM profiles WHERE workspace_id=? AND deleted_at IS NULL ORDER BY name`).all(workspaceId)
    .map(r => ({
      id: r.id,
      name: r.name,
      browserEngine: r.browser_engine,
      folder: r.folder,
      tags: JSON.parse(r.tags || '[]'),
    }));
  return {
    format: 'profile-manager-workspace',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: ws,
    profiles,
    note: 'Local workspace metadata only. Profile user-data is exported separately via profile backup.',
  };
}

// All membership checks and writes share one reserved SQLite writer transaction.
export const assignProfileWorkspace = (id, workspaceId) => db.transaction(() => assignProfileWorkspaceInTransaction(id, workspaceId)).immediate();
export const bulkAssignProfilesToWorkspace = (id, profileIds) => db.transaction(() => bulkAssignProfilesToWorkspaceInTransaction(id, profileIds)).immediate();
export const deleteWorkspace = id => db.transaction(() => deleteWorkspaceInTransaction(id)).immediate();

export const updateWorkspace = (id, values) => db.transaction(() => updateWorkspaceInTransaction(id, values)).immediate();

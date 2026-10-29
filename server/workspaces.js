// Local workspaces (project folders). No cloud sync.
import crypto from 'crypto';
import { db } from './db.js';
import { encryptionStatus } from './secrets.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export function vaultStorageAvailable() {
  const backend = encryptionStatus().backend;
  return backend === 'electron-safeStorage' || backend === 'test-os';
}

export function listWorkspaces() {
  return db.prepare(`
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

export function updateWorkspace(id, { name, notes, vaultLocked }) {
  const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  if (!row) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  const now = new Date().toISOString();
  const nextName = name != null ? String(name).trim() : row.name;
  if (!nextName) throw fail(400, 'name is required', 'INVALID_WORKSPACE');
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

export function deleteWorkspace(id) {
  const row = db.prepare('SELECT id FROM workspaces WHERE id=?').get(id);
  if (!row) throw fail(404, 'Workspace not found', 'NOT_FOUND');
  db.prepare('UPDATE profiles SET workspace_id=NULL, updated_at=? WHERE workspace_id=?').run(new Date().toISOString(), id);
  db.prepare('DELETE FROM workspaces WHERE id=?').run(id);
  return { id, deleted: true };
}

export function assignProfileWorkspace(profileId, workspaceId) {
  if (workspaceId) assertWorkspaceAccess(workspaceId);
  db.prepare('UPDATE profiles SET workspace_id=?, updated_at=? WHERE id=? AND deleted_at IS NULL')
    .run(workspaceId || null, new Date().toISOString(), profileId);
}

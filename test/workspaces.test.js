import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ws-'));
process.env.PM_DATA_DIR = dir;
const { db } = await import('../server/db.js');
const { createWorkspace, listWorkspaces, assignProfileWorkspace, assertWorkspaceAccess } = await import('../server/workspaces.js');
const { randomUUID } = await import('crypto');

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

test('workspace CRUD and profile assignment', () => {
  const ws = createWorkspace({ name: 'Client A' });
  assert.equal(listWorkspaces().length, 1);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'In workspace', '[]', '', '', now, now);
  assignProfileWorkspace(id, ws.id);
  assertWorkspaceAccess(ws.id);
  assignProfileWorkspace(id, null);
});

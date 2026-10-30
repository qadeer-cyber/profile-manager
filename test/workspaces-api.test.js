import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ws-api-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'ws-api';
const { startServer } = await import('../server/app.js');
let server;

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer ws-api', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('workspace API CRUD, profile assignment, and list filter', async () => {
  const created = await call('POST', '/api/v1/workspaces', { name: 'Ops', notes: 'local only' });
  assert.equal(created.status, 201);
  const wsId = created.body.id;
  const profile = await call('POST', '/api/v1/profiles', { name: 'In ops', workspaceId: wsId });
  assert.equal(profile.status, 201);
  assert.equal(profile.body.workspaceId, wsId);
  const listed = await call('GET', `/api/v1/profiles?workspaceId=${wsId}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.length, 1);
  const patched = await call('PATCH', `/api/v1/workspaces/${wsId}`, { name: 'Ops renamed' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.name, 'Ops renamed');
  const workspaces = await call('GET', '/api/v1/workspaces');
  assert.equal(workspaces.body.find(w => w.id === wsId).profileCount, 1);
  await call('POST', `/api/v1/profiles/${profile.body.id}/workspace`, { workspaceId: null });
  const unassigned = await call('GET', `/api/v1/profiles?workspaceId=${wsId}`);
  assert.equal(unassigned.body.length, 0);
  await call('POST', `/api/v1/profiles/${profile.body.id}/workspace`, { workspaceId: wsId });
  const exported = await call('GET', `/api/v1/workspaces/${wsId}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.format, 'profile-manager-workspace');
  const del = await call('DELETE', `/api/v1/workspaces/${wsId}`);
  assert.equal(del.status, 204);
});

test('workspace search, bulk assign, and import', async () => {
  const a = await call('POST', '/api/v1/workspaces', { name: 'Alpha team' });
  const b = await call('POST', '/api/v1/workspaces', { name: 'Beta team' });
  const filtered = await call('GET', '/api/v1/workspaces?q=alpha');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.length, 1);
  const p1 = await call('POST', '/api/v1/profiles', { name: 'One' });
  const p2 = await call('POST', '/api/v1/profiles', { name: 'Two' });
  const bulk = await call('POST', `/api/v1/workspaces/${a.body.id}/assign-profiles`, { profileIds: [p1.body.id, p2.body.id] });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.assigned, 2);
  const exported = await call('GET', `/api/v1/workspaces/${a.body.id}/export`);
  await call('DELETE', `/api/v1/workspaces/${a.body.id}`);
  const imported = await call('POST', '/api/v1/workspaces/import', exported.body);
  assert.equal(imported.status, 201);
  assert.ok(imported.body.assignedProfileIds.length >= 1);
  await call('DELETE', `/api/v1/workspaces/${imported.body.workspace.id}`);
  await call('DELETE', `/api/v1/workspaces/${b.body.id}`);
});

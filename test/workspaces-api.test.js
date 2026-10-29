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
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
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
  const del = await call('DELETE', `/api/v1/workspaces/${wsId}`);
  assert.equal(del.status, 204);
});

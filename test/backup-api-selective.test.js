import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-backup-api-'));
process.env.PM_DATA_DIR = dataDir;
process.env.PM_API_TOKEN = 'backup-api';

const { startServer } = await import('../server/app.js');
let server;

const raw = async (method, url, body, query = '') => {
  const response = await fetch(`${server.url}${url}${query}`, {
    method,
    headers: {
      Authorization: 'Bearer backup-api',
      ...(body == null ? {} : { 'Content-Type': 'application/octet-stream' }),
    },
    body: body ?? undefined,
  });
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buf };
};

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('backup inspect and selective restore over HTTP', async () => {
  const a = await fetch(`${server.url}/api/v1/profiles`, {
    method: 'POST',
    headers: { Authorization: 'Bearer backup-api', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Backup Alpha' }),
  });
  const b = await fetch(`${server.url}/api/v1/profiles`, {
    method: 'POST',
    headers: { Authorization: 'Bearer backup-api', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Backup Beta' }),
  });
  const idA = (await a.json()).id;
  const idB = (await b.json()).id;
  const { userDataDir } = await import('../server/db.js');
  fs.mkdirSync(path.join(userDataDir(idA), 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(idA), 'Default', 'alpha.marker'), 'A');
  fs.mkdirSync(path.join(userDataDir(idB), 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(idB), 'Default', 'beta.marker'), 'B');

  const backup = await raw('POST', '/api/v1/backup', null);
  assert.equal(backup.status, 200);
  assert.ok(backup.buf?.length);

  const inspected = await raw('POST', '/api/v1/backup/inspect', backup.buf);
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.profiles.length, 2);
  assert.ok(inspected.body.profiles.some(p => p.name === 'Backup Beta'));

  const { db } = await import('../server/db.js');
  db.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(idA, idB);
  fs.rmSync(userDataDir(idA), { recursive: true, force: true });
  fs.rmSync(userDataDir(idB), { recursive: true, force: true });

  const restored = await raw('POST', '/api/v1/backup/restore', backup.buf, `?collision=rename&profileIds=${idB}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.added.length, 1);
  assert.equal(restored.body.added[0].name, 'Backup Beta');
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(idA), undefined);
  assert.ok(db.prepare('SELECT id FROM profiles WHERE id=?').get(restored.body.added[0].id));
  assert.ok(fs.existsSync(path.join(userDataDir(restored.body.added[0].id), 'Default', 'beta.marker')));
});

test('portable profile export and restore via API', async () => {
  const created = await fetch(`${server.url}/api/v1/profiles`, {
    method: 'POST',
    headers: { Authorization: 'Bearer backup-api', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Portable API' }),
  });
  const { id } = await created.json();
  const { userDataDir, db } = await import('../server/db.js');
  fs.mkdirSync(path.join(userDataDir(id), 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(id), 'Default', 'portable.txt'), 'ok');

  const exported = await raw('POST', `/api/v1/profiles/${id}/backup/export`, null);
  assert.equal(exported.status, 200);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  fs.rmSync(userDataDir(id), { recursive: true, force: true });

  const restored = await raw('POST', '/api/v1/backup/restore', exported.buf, '?collision=rename');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.added.length, 1);
  assert.ok(fs.existsSync(path.join(userDataDir(restored.body.added[0].id), 'Default', 'portable.txt')));
});

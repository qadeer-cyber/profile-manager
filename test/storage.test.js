import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-storage-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm8-storage';
const { startServer } = await import('../server/app.js');
const { cleanupStorage } = await import('../server/storage.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m8-storage', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('storage reports on-disk bytes and deletes cache only after confirmation', async () => {
  const created = await call('POST', '/api/v1/profiles', { name: 'Stored' });
  const root = path.join(dir, 'profiles', created.body.id, 'Default');
  fs.mkdirSync(path.join(root, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Cache', 'blob.bin'), Buffer.alloc(4096));
  fs.writeFileSync(path.join(root, 'Cookies'), Buffer.alloc(128));
  const before = await call('GET', `/api/v1/profiles/${created.body.id}/storage`);
  assert.equal(before.body.running, false);
  assert.equal(before.body.cleanupAllowed, true);
  assert.ok(before.body.cache.bytes >= 4096);
  assert.ok(before.body.cookies.bytes >= 128);
  assert.match(before.body.note, /stopped/i);
  assert.equal((await call('POST', `/api/v1/profiles/${created.body.id}/storage/cleanup`, {})).status, 400);
  assert.throws(() => cleanupStorage(created.body.id, { confirm: 'clear-cache' }, { running: true }), error => error.code === 'PROFILE_RUNNING');
  const cleaned = await call('POST', `/api/v1/profiles/${created.body.id}/storage/cleanup`, { confirm: 'clear-cache' });
  assert.equal(cleaned.status, 200);
  assert.equal(fs.existsSync(path.join(root, 'Cache')), false);
  assert.equal(fs.readFileSync(path.join(root, 'Cookies')).length, 128);
  assert.ok(cleaned.body.preserved.includes('Cookies'));
  const site = path.join(root, 'IndexedDB');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'db'), 'site');
  const cleared = await call('POST', `/api/v1/profiles/${created.body.id}/storage/cleanup`, { confirm: 'clear-site-data' });
  assert.equal(fs.existsSync(site), false);
  assert.equal(fs.existsSync(path.join(root, 'Cookies')), true);
  assert.equal(cleared.body.confirm, 'clear-site-data');
});

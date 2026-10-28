import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-dash-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm8-dash';
const { startServer } = await import('../server/app.js');
const { db } = await import('../server/db.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m8-dash', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('dashboard counts come from the database and the live running set', async () => {
  const denied = await fetch(server.url + '/api/v1/dashboard');
  assert.equal(denied.status, 401);
  const first = await call('POST', '/api/v1/profiles', { name: 'Dash A' });
  const second = await call('POST', '/api/v1/profiles', { name: 'Dash B' });
  assert.equal(first.status, 201);
  db.prepare('UPDATE profiles SET last_error=? WHERE id=?').run('boom from the health monitor', second.body.id);
  await call('POST', '/api/v1/proxies', { name: 'Local', type: 'http', host: '127.0.0.1', port: 1 });
  const stats = await call('GET', '/api/v1/dashboard');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.profiles.total, 2);
  assert.equal(stats.body.profiles.running, 0);
  assert.equal(stats.body.profiles.stopped, 2);
  assert.equal(stats.body.profiles.withError, 1);
  assert.equal(stats.body.sessions.length, 0);
  assert.equal(stats.body.proxies.total, 1);
  assert.equal(stats.body.proxies.untested, 1);
  assert.equal(stats.body.errors[0].message, 'boom from the health monitor');
  assert.equal(typeof stats.body.generatedAt, 'string');
  assert.equal(JSON.stringify(stats.body).includes('127.0.0.1'), false);
});

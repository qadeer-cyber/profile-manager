import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-table-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm8-table';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m8-table', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('profile table filters, sorts, pages, and persists a saved view', async () => {
  for (const profile of [{ name: 'Alpha', folder: 'Work', tags: ['shop'] }, { name: 'Bravo', folder: 'Work', tags: ['b'] }, { name: 'Charlie', folder: 'Personal', tags: ['shop'] }]) {
    assert.equal((await call('POST', '/api/v1/profiles', profile)).status, 201);
  }
  const asc = await call('GET', '/api/v1/profile-table?sort=name&dir=asc&pageSize=2&page=1');
  assert.deepEqual(asc.body.items.map(profile => profile.name), ['Alpha', 'Bravo']);
  assert.equal(asc.body.total, 3);
  const page2 = await call('GET', '/api/v1/profile-table?sort=name&dir=asc&pageSize=2&page=2');
  assert.deepEqual(page2.body.items.map(profile => profile.name), ['Charlie']);
  const search = await call('GET', '/api/v1/profile-table?q=brav&sort=name&dir=asc');
  assert.deepEqual(search.body.items.map(profile => profile.name), ['Bravo']);
  const folder = await call('GET', '/api/v1/profile-table?folder=Personal&sort=name&dir=asc');
  assert.deepEqual(folder.body.items.map(profile => profile.name), ['Charlie']);
  const saved = await call('POST', '/api/v1/views', { name: 'Personal shop', query: { folder: 'Personal', sort: 'name', dir: 'asc', pageSize: 25 } });
  assert.equal(saved.status, 201);
  const listed = await call('GET', '/api/v1/views');
  assert.equal(listed.body[0].name, 'Personal shop');
  assert.equal(listed.body[0].query.folder, 'Personal');
  const renamed = await call('PATCH', `/api/v1/views/${saved.body.id}`, { name: 'Personal only' });
  assert.equal(renamed.body.name, 'Personal only');
  assert.equal((await call('DELETE', `/api/v1/views/${saved.body.id}`)).status, 204);
  assert.equal((await call('GET', '/api/v1/views')).body.length, 0);
  assert.equal((await call('GET', '/api/v1/profile-table?sort=nope')).status, 400);
});

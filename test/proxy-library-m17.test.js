import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m17-lib-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm17-lib';

const { startServer } = await import('../server/app.js');
let server;

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer m17-lib', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('proxy template CRUD and instantiate live proxy', async () => {
  const created = await call('POST', '/api/v1/proxies/templates', {
    name: 'HTTP preset',
    type: 'http',
    host: 'preset.example',
    port: 8080,
    tags: ['office'],
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.tags.includes('template'));
  const listed = await call('GET', '/api/v1/proxies/templates');
  assert.equal(listed.body.length, 1);
  const patched = await call('PATCH', `/api/v1/proxies/templates/${created.body.id}`, { name: 'HTTP preset v2' });
  assert.equal(patched.body.name, 'HTTP preset v2');
  const live = await call('POST', `/api/v1/proxies/templates/${created.body.id}/instantiate`, { name: 'Office live' });
  assert.equal(live.status, 201);
  assert.equal(live.body.tags.includes('template'), false);
  assert.ok(live.body.tags.includes('office'));
});

test('tag groups and measurable analytics', async () => {
  const groups = await call('GET', '/api/v1/proxies/groups');
  assert.ok(groups.body.some(g => g.tag === 'template' || g.tag === 'office'));
  const analytics = await call('GET', '/api/v1/proxies/library/analytics');
  assert.equal(analytics.body.trafficSaverSupported, false);
  assert.ok('checksLast7Days' in analytics.body);
  assert.match(analytics.body.note, /local/i);
});

test('safe proxy switch direct and library', async () => {
  const profile = await call('POST', '/api/v1/profiles', { name: 'Proxy switch' });
  const proxy = await call('POST', '/api/v1/proxies', { name: 'Live', type: 'http', host: 'live.example', port: 80 });
  await call('POST', `/api/v1/profiles/${profile.body.id}/proxy/switch`, { mode: 'library', proxyId: proxy.body.id });
  let row = await call('GET', `/api/v1/profiles/${profile.body.id}`);
  assert.equal(row.body.proxyId, proxy.body.id);
  await call('POST', `/api/v1/profiles/${profile.body.id}/proxy/switch`, { mode: 'direct' });
  row = await call('GET', `/api/v1/profiles/${profile.body.id}`);
  assert.equal(row.body.proxyId, null);
});

test('batch proxy test endpoint validates HTTP proxy types', async () => {
  const a = await call('POST', '/api/v1/proxies', { name: 'Batch A', type: 'http', host: 'batch-a.example', port: 80 });
  const batch = await call('POST', '/api/v1/proxies/test-batch', { ids: [a.body.id] });
  assert.equal(batch.status, 200);
  assert.equal(batch.body.tested, 1);
  assert.ok(batch.body.results[0].id === a.body.id);
});

test('cannot assign template or paused proxy to profile', async () => {
  const profile = await call('POST', '/api/v1/profiles', { name: 'Blocked assign' });
  const tmpl = await call('POST', '/api/v1/proxies/templates', { name: 'T', type: 'http', host: 't.example', port: 1 });
  const blocked = await call('POST', `/api/v1/profiles/${profile.body.id}/proxy`, { proxyId: tmpl.body.id });
  assert.equal(blocked.status, 409);
  const paused = await call('POST', '/api/v1/proxies', { name: 'Paused', type: 'http', host: 'p.example', port: 2, tags: ['paused'] });
  const blocked2 = await call('POST', `/api/v1/profiles/${profile.body.id}/proxy`, { proxyId: paused.body.id });
  assert.equal(blocked2.status, 409);
});

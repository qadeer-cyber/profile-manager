import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxy-dup-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'proxy-dup';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer proxy-dup', 'Content-Type': 'application/json' },
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

test('duplicate proxy creates reusable template preset', async () => {
  const created = await call('POST', '/api/v1/proxies', {
    name: 'Primary HTTP',
    type: 'http',
    host: 'proxy.example',
    port: 8080,
    tags: ['office'],
  });
  assert.equal(created.status, 201);
  const dup = await call('POST', `/api/v1/proxies/${created.body.id}/duplicate`, { name: 'Office template', asTemplate: true });
  assert.equal(dup.status, 201);
  assert.notEqual(dup.body.id, created.body.id);
  assert.equal(dup.body.host, 'proxy.example');
  assert.ok(dup.body.tags.includes('template'));
  assert.ok(dup.body.tags.includes('office'));
  const templates = await call('GET', '/api/v1/proxies?tag=template');
  assert.equal(templates.status, 200);
  assert.equal(templates.body.some(row => row.id === dup.body.id), true);
});

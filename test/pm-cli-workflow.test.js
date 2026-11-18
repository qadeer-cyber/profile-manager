import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-wf-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'cli-wf';
const cli = path.join('scripts', 'pm-cli.mjs');
let startServer;
let server;
let baseUrl;
let v1;
let ui;

function runCli(args, { expect = 0 } = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PM_API_BASE: `${baseUrl}/api/v1`,
      PM_UI_BASE: `${baseUrl}/api`,
      PM_API_TOKEN: 'cli-wf',
    },
    timeout: 15000,
  });
  if (r.status !== expect) {
    throw new Error(`pm-cli ${args.join(' ')} exit ${r.status}\nstderr:${r.stderr}\nstdout:${r.stdout}`);
  }
  return r;
}

const call = async (method, url, payload, { uiRoute = false } = {}) => {
  const root = uiRoute ? ui : v1;
  const response = await fetch(root + url, {
    method,
    headers: { Authorization: 'Bearer cli-wf', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
};

before(async () => {
  ({ startServer } = await import('../server/app.js'));
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  baseUrl = server.url.replace(/\/$/, '');
  v1 = `${baseUrl}/api/v1`;
  ui = `${baseUrl}/api`;
});

after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('pm-cli help and usage exit codes', () => {
  const help = runCli(['help']);
  assert.match(help.stdout, /workspace-import/);
  runCli(['not-a-command'], { expect: 2 });
});

test('API workflow mirrored by pm-cli command paths', async () => {
  const created = await call('POST', '/profiles', { name: 'CLI Alpha', folder: 'ops' });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const shown = await call('GET', `/profiles/${id}`);
  assert.equal(shown.body.name, 'CLI Alpha');

  const updated = await call('PATCH', `/profiles/${id}`, { notes: 'via cli' });
  assert.equal(updated.body.notes, 'via cli');

  const ws = await call('POST', '/workspaces', { name: 'CLI WS', notes: 'local' });
  assert.equal(ws.status, 201);
  await call('POST', `/profiles/${id}/workspace`, { workspaceId: ws.body.id });
  const listed = await call('GET', `/profiles?workspaceId=${ws.body.id}`);
  assert.equal(listed.body.length, 1);

  const beta = await call('POST', '/profiles', { name: 'CLI Beta' });
  const bulk = await call('POST', `/workspaces/${ws.body.id}/assign-profiles`, { profileIds: [id, beta.body.id] });
  assert.equal(bulk.body.assigned, 2);

  const filtered = await call('GET', '/workspaces?q=CLI');
  assert.ok(filtered.body.some(w => w.id === ws.body.id));

  const exported = await call('GET', `/workspaces/${ws.body.id}/export`);
  assert.equal(exported.body.format, 'profile-manager-workspace');
  const imported = await call('POST', '/workspaces/import', exported.body);
  assert.equal(imported.status, 201);

  const summary = await call('GET', '/proxies/library/summary');
  assert.ok('total' in summary.body);

  const cloned = await call('POST', `/profiles/${id}/clone`, { name: 'CLI Alpha copy' });
  assert.notEqual(cloned.body.id, id);

  await call('DELETE', `/profiles/${id}`);
  const trash = await call('GET', '/trash', null, { uiRoute: true });
  assert.ok(trash.body.some(p => p.id === id));
  await call('POST', `/trash/${id}/restore`, null, { uiRoute: true });

  const diag = await call('GET', '/diagnostics', null, { uiRoute: true });
  assert.ok(diag.body.profiles >= 1);
  await call('GET', '/dashboard');
  await call('GET', '/profile-config/schema');
  await call('POST', '/profile-config/validate', { browserSettings: { locale: 'en-US', languages: ['en-US'] } });
  await call('GET', '/running');
  await call('GET', `/profiles/${id}/launch-status`);

  const cookies = await call('GET', `/profiles/${id}/cookies`);
  assert.ok(Array.isArray(cookies.body.cookies));

  await call('DELETE', `/workspaces/${ws.body.id}`);
});

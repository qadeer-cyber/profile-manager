import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createWorkspaceSyncService } from '../server/workspace-sync-service.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('two independent local installations synchronize real encrypted workspace files through authenticated TLS, enforce ACL/CAS, then restart', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-trackc-sync-')), key = path.join(root, 'key.pem'), cert = path.join(root, 'cert.pem');
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', timeout: 10000 });
  const token = crypto.randomBytes(32).toString('base64url'), reader = crypto.randomBytes(32).toString('base64url'), remoteId = crypto.randomUUID();
  const principals = [{ tokenSha256: crypto.createHash('sha256').update(token).digest('hex'), workspaces: { [remoteId]: 'writer' } }, { tokenSha256: crypto.createHash('sha256').update(reader).digest('hex'), workspaces: { [remoteId]: 'reader' } }];
  const directory = path.join(root, 'relay'); let relay, a, b;
  const startRelay = async () => { relay = createWorkspaceSyncService({ directory, key: fs.readFileSync(key), cert: fs.readFileSync(cert), principals, maxBytes: 1024 * 1024, quotaBytes: 4 * 1024 * 1024 }); await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve)); return `https://127.0.0.1:${relay.address().port}`; };
  const closeRelay = () => new Promise(resolve => { relay.close(resolve); relay.closeIdleConnections(); });
  t.after(async () => { if (a) assert.equal(await stopServer(a), true); if (b) assert.equal(await stopServer(b), true); if (relay?.listening) await closeRelay(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  let serverUrl = await startRelay();
  const env = dir => { const e = { ...process.env, PM_DATA_DIR: path.join(root, dir), PM_API_TOKEN: 'trackc-test', PM_SYNC_CA_FILE: cert }; delete e.PM_SECRET; return e; };
  a = await spawnServer(env('A')); b = await spawnServer(env('B'));
  const api = async (server, route, body) => {
    const r = await fetch(server.url + '/api/v1' + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer trackc-test', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const json = await r.json(); assert.ok(r.ok, JSON.stringify(json)); return json;
  };
  const workspace = await api(a, '/workspaces', { name: 'Shared portable workspace' });
  const profiles = [];
  for (const engine of ['chromium','firefox']) {
    const p = await api(a, '/profiles', { name: 'Shared ' + engine, browserEngine: engine, workspaceId: workspace.id }); profiles.push(p);
    const dir = path.join(root, 'A', 'profiles', p.id, engine === 'firefox' ? 'gecko' : 'Default'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'persisted-data'), engine + '-private-marker');
  }
  const controls = { serverUrl, remoteId, token, passphrase: 'portable-team-passphrase', confirmSensitive: true, expectedRevision: 0 };
  const pushed = await api(a, `/workspaces/${workspace.id}/sync/push`, controls); assert.equal(pushed.revision, 1);
  const cipherFile = fs.readdirSync(directory).find(n => n.endsWith('.pmp')); const ciphertext = fs.readFileSync(path.join(directory, cipherFile));
  assert.equal(ciphertext.subarray(0, 4).toString(), 'PMBE'); assert.equal(ciphertext.includes('private-marker'), false); assert.equal(ciphertext.includes(controls.passphrase), false);
  const pulled = await api(b, '/workspaces/sync/pull', { ...controls, token: reader }); assert.equal(pulled.added.length, 2);
  for (const p of profiles) assert.equal(fs.readFileSync(path.join(root, 'B', 'profiles', p.id, p.browserEngine === 'firefox' ? 'gecko' : 'Default', 'persisted-data'), 'utf8'), p.browserEngine + '-private-marker');
  const relayRequest = (method, auth, id = remoteId, revision = 1) => new Promise((resolve, reject) => {
    const req = https.request(`${serverUrl}/v1/workspaces/${id}/snapshot`, { method, ca: fs.readFileSync(cert), headers: { Authorization: `Bearer ${auth}`, ...(method === 'PUT' ? { 'If-Match': `"${revision}"`, 'Content-Length': ciphertext.length } : {}) } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(method === 'PUT' ? ciphertext : undefined);
  });
  assert.equal(await relayRequest('GET', 'invalid-token'), 401);
  assert.equal(await relayRequest('PUT', reader), 403);
  assert.equal(await relayRequest('GET', token, crypto.randomUUID()), 403);
  assert.deepEqual((await Promise.all([relayRequest('PUT', token), relayRequest('PUT', token)])).sort(), [200,409]);
  assert.equal(await relayRequest('PUT', token), 409);
  assert.equal(await stopServer(b), true); b = null; await closeRelay();
  serverUrl = await startRelay(); b = await spawnServer(env('B'));
  const persisted = await api(b, '/profiles'); assert.equal(persisted.filter(p => p.workspaceId === pulled.workspaceId).length, 2);
  const again = await api(b, '/workspaces/sync/pull', { ...controls, serverUrl }); assert.equal(again.revision, 2); assert.equal(again.renamed.length, 2); assert.notEqual(again.workspaceId, pulled.workspaceId);
});

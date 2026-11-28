// A profile that is exported on one computer and restored on another must keep its identity: the fingerprint is derived
// from the profile id and the seed generation, so both must survive the move; a copy made on the same computer
// (collision rename) is a new identity on purpose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer, missedGracefulShutdowns } from './_ports.mjs';
import { nativeIdentityFor, noiseSeedsFor } from '../server/browser-runtime/native-identity.js';

const TOKEN = 'portability';
const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'pm-port-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'pm-port-b-'))];
let a, b;
const call = (srv, method, url, body, headers = {}) => fetch(`${srv.url}/api/v1${url}`, {
  method,
  headers: { Authorization: `Bearer ${TOKEN}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/octet-stream' } : {}), ...headers },
  body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
});

before(async () => {
  a = await spawnServer({ ...process.env, PM_DATA_DIR: dirs[0], PM_API_TOKEN: TOKEN });
  b = await spawnServer({ ...process.env, PM_DATA_DIR: dirs[1], PM_API_TOKEN: TOKEN });
});
after(async () => {
  await stopServer(a); await stopServer(b);
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  assert.equal(missedGracefulShutdowns(), 0);
});

test('export on one computer, restore on another: same id, same settings, same fingerprint inputs', async () => {
  const created = await call(a, 'POST', '/profiles', {
    name: 'Portable identity',
    advancedSettings: {
      experimental: { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype', seedEpoch: 3 },
      deviceName: 'DESKTOP-PORT01', macLabel: 'AA:BB:CC:11:22:33', macLabelMode: 'manual',
    },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const original = await created.json();
  assert.equal(original.advancedSettings.experimental.seedEpoch, 3);

  const exported = await call(a, 'POST', `/profiles/${original.id}/backup/export-stream`, { confirmSensitive: true, passphrase: 'move me please' });
  assert.equal(exported.status, 200);
  const bytes = Buffer.from(await exported.arrayBuffer());

  const restored = await call(b, 'POST', '/backup/restore-stream?collision=rename', bytes, { 'X-Backup-Passphrase': 'move me please' });
  assert.equal(restored.status, 200, await restored.clone().text());
  const result = await restored.json();
  assert.equal(result.added.length, 1);
  const movedId = result.added[0].id;

  const moved = await (await call(b, 'GET', `/profiles/${movedId}`)).json();
  assert.equal(movedId, original.id, 'the profile id survives a move to an empty computer');
  assert.deepEqual(moved.advancedSettings.experimental, original.advancedSettings.experimental, 'protection settings and seed generation survive');
  assert.equal(moved.advancedSettings.deviceName, 'DESKTOP-PORT01');
  assert.equal(moved.macLabel, 'AA:BB:CC:11:22:33', 'a manual MAC label survives');
  const epoch = moved.advancedSettings.experimental.seedEpoch;
  assert.deepEqual(nativeIdentityFor(moved.id, epoch), nativeIdentityFor(original.id, original.advancedSettings.experimental.seedEpoch));
  assert.deepEqual(noiseSeedsFor(moved.id, epoch), noiseSeedsFor(original.id, 3));
  assert.notDeepEqual(noiseSeedsFor(moved.id, 4), noiseSeedsFor(moved.id, epoch), 'a new generation really is a different identity');
});

test('a derived MAC label follows the id, so it also survives the move', async () => {
  const created = await (await call(a, 'POST', '/profiles', { name: 'Derived label' })).json();
  const exported = await call(a, 'POST', `/profiles/${created.id}/backup/export-stream`, { confirmSensitive: true, passphrase: 'move me please' });
  const bytes = Buffer.from(await exported.arrayBuffer());
  const restored = await (await call(b, 'POST', '/backup/restore-stream?collision=rename', bytes, { 'X-Backup-Passphrase': 'move me please' })).json();
  const moved = await (await call(b, 'GET', `/profiles/${restored.added[0].id}`)).json();
  assert.equal(moved.id, created.id);
  assert.equal(moved.macLabel, created.macLabel);
  assert.equal(moved.macLabelMode, created.macLabelMode);
});

test('a copy restored next to the original is a new identity (new id, new fingerprint inputs)', async () => {
  const created = await (await call(a, 'POST', '/profiles', { name: 'Copy me', advancedSettings: { experimental: { canvasReadback: 'prototype', seedEpoch: 2 } } })).json();
  const exported = await call(a, 'POST', `/profiles/${created.id}/backup/export-stream`, { confirmSensitive: true, passphrase: 'copy passphrase 1' });
  const bytes = Buffer.from(await exported.arrayBuffer());
  const restored = await (await call(a, 'POST', '/backup/restore-stream?collision=rename', bytes, { 'X-Backup-Passphrase': 'copy passphrase 1' })).json();
  assert.equal(restored.renamed.length, 1);
  assert.equal(restored.renamed[0].sourceId, created.id);
  const copy = await (await call(a, 'GET', `/profiles/${restored.renamed[0].id}`)).json();
  assert.notEqual(copy.id, created.id);
  assert.notDeepEqual(noiseSeedsFor(copy.id, copy.advancedSettings.experimental.seedEpoch || 0), noiseSeedsFor(created.id, 2), 'the copy does not share the fingerprint');
  assert.notEqual(copy.macLabel, created.macLabel, 'the copy has its own derived MAC label');
});

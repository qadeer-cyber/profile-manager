import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encryptBackup, decryptBackup } from '../server/backup-crypto.js';
import { packArchive } from '../server/archive.js';

test('encrypted envelope rejects a bad passphrase and a modified byte', () => {
  const plain = packArchive([{ path: 'meta.json', data: Buffer.from('{"format":"profile-manager-backup","version":1,"profiles":[]}') }]);
  const passphrase = 'correct horse battery staple';
  const encrypted = encryptBackup(plain, passphrase);
  assert.equal(encrypted.subarray(0, 4).toString(), 'PMBE');
  assert.equal(decryptBackup(encrypted, passphrase).equals(plain), true);
  assert.throws(() => decryptBackup(encrypted, 'wrong passphrase here'), error => error.code === 'INVALID_PASSPHRASE' && !error.message.includes(passphrase));
  const flipped = Buffer.from(encrypted);
  flipped[flipped.length - 1] ^= 0xff;
  assert.throws(() => decryptBackup(flipped, passphrase), error => error.code === 'INVALID_PASSPHRASE');
  assert.throws(() => encryptBackup(plain, 'short'), error => error.code === 'INVALID_PASSPHRASE');
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-backup-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm8-backup';
const { startServer } = await import('../server/app.js');
const { createBackup, createEncryptedBackup, restoreBackup, inspectBackup } = await import('../server/backup.js');
let server;
const call = async (method, url, body, headers = {}) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m8-backup', ...headers }, body });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: response.status, body: parsed, text };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => {
  await server.close();
  const { db } = await import('../server/db.js');
  if (db.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('old plaintext backups restore, and encrypted backups hide the passphrase and profile bytes', async () => {
  const marker = 'marker-' + 'Z'.repeat(40);
  const secret = 'proxy-secret-' + 'Q'.repeat(24);
  const created = await call('POST', '/api/v1/profiles', JSON.stringify({ name: 'Kept', proxy: { type: 'http', host: '127.0.0.1', port: 8080, username: 'alice', password: secret } }), { 'Content-Type': 'application/json' });
  assert.equal(created.status, 201);
  const profileDir = path.join(dir, 'profiles', created.body.id, 'Default');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'marker.txt'), marker);
  const plain = createBackup({ ids: [] });
  const passphrase = 'another correct passphrase';
  const encrypted = createEncryptedBackup(passphrase, { ids: [] });
  assert.equal(encrypted.includes(Buffer.from(marker)), false);
  assert.equal(encrypted.includes(Buffer.from(secret)), false);
  assert.equal(encrypted.includes(Buffer.from(passphrase)), false);
  const locked = inspectBackup(encrypted);
  assert.equal(locked.requiresPassphrase, true);
  assert.equal(locked.profiles, null);
  assert.equal(JSON.stringify(locked).includes(secret), false);
  const opened = inspectBackup(encrypted, { passphrase });
  assert.equal(opened.profiles.some(profile => profile.name === 'Kept'), true);
  assert.equal(JSON.stringify(opened).includes(secret), false);
  const legacy = inspectBackup(plain);
  assert.equal(legacy.encrypted, false);
  assert.equal(JSON.stringify(legacy).includes(secret), false);
  fs.writeFileSync(path.join(profileDir, 'marker.txt'), 'changed');
  const restored = restoreBackup(encrypted, { collision: 'replace', passphrase });
  assert.equal(restored.replaced.length, 1);
  assert.equal(fs.readFileSync(path.join(profileDir, 'marker.txt'), 'utf8'), marker);
  fs.writeFileSync(path.join(profileDir, 'marker.txt'), 'changed-again');
  restoreBackup(plain, { collision: 'replace' });
  assert.equal(fs.readFileSync(path.join(profileDir, 'marker.txt'), 'utf8'), marker);
  const query = await call('POST', '/api/v1/backup?passphrase=' + encodeURIComponent(passphrase), JSON.stringify({ encrypt: true, passphrase }), { 'Content-Type': 'application/json' });
  assert.equal(query.status, 400);
  assert.equal(query.text.includes(passphrase), false);
  const download = await fetch(server.url + '/api/v1/backup', { method: 'POST', headers: { Authorization: 'Bearer m8-backup', 'Content-Type': 'application/json' }, body: JSON.stringify({ encrypt: true, passphrase }) });
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(download.status, 200);
  assert.equal(bytes.subarray(0, 4).toString(), 'PMBE');
  assert.equal(bytes.includes(Buffer.from(marker)), false);
  const wrong = await call('POST', '/api/v1/backup/restore?collision=rename', bytes, { 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': 'not-the-passphrase' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'INVALID_PASSPHRASE');
  assert.equal(wrong.text.includes(passphrase), false);
  assert.equal(wrong.text.includes('not-the-passphrase'), false);
});

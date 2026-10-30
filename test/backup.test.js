import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { assertArchivePath, packArchive, unpackArchive } from '../server/archive.js';

test('archives reject traversal, checksum mismatches, and trailing bytes', () => {
  for (const bad of ['../secret', '/etc/passwd', 'profiles/not-a-uuid/file', 'profiles.db/extra', 'secret.key/../x']) {
    assert.throws(() => assertArchivePath(bad), error => error.code === 'UNSAFE_ARCHIVE');
  }
  const packed = packArchive([{ path: 'meta.json', data: Buffer.from('{"ok":true}') }]);
  const flipped = Buffer.from(packed);
  flipped[flipped.length - 1] ^= 0xff;
  assert.throws(() => unpackArchive(flipped), error => error.code === 'UNSAFE_ARCHIVE');
  assert.throws(() => unpackArchive(Buffer.concat([packed, Buffer.from([1])])), /trailing/);
  const evilPath = Buffer.from('../outside');
  const evil = Buffer.concat([
    Buffer.from('PMB1'), Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 0, 1]),
    Buffer.from([0, evilPath.length]), evilPath, Buffer.alloc(8), Buffer.alloc(32),
  ]);
  assert.throws(() => unpackArchive(evil), error => error.code === 'UNSAFE_ARCHIVE');
  assert.equal(fs.existsSync('/tmp/outside-from-backup'), false);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m7-backup-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm7-backup';
const { startServer } = await import('../server/app.js');
const { createBackup, restoreBackup } = await import('../server/backup.js');
const { db } = await import('../server/db.js');
let server;
const call = async (method, url, payload, headers = {}) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m7-backup', ...headers }, body: payload });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
  return { status: response.status, body: parsed, text };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function makeProfile(name) {
  const response = await call('POST', '/api/v1/profiles', JSON.stringify({ name }), { 'Content-Type': 'application/json' });
  assert.equal(response.status, 201);
  fs.mkdirSync(path.join(dir, 'profiles', response.body.id, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles', response.body.id, 'Default', 'marker.txt'), name);
  return response.body;
}
test('restore validates collisions, rolls back a failed apply, and refuses symlinks', async () => {
  const first = await makeProfile('First');
  assert.throws(() => createBackup({ ids: ['running'] }), error => error.code === 'PROFILES_RUNNING');
  const archive = createBackup({ ids: [] });
  fs.symlinkSync('/etc/passwd', path.join(dir, 'profiles', first.id, 'Default', 'escape'));
  assert.throws(() => createBackup({ ids: [] }), error => error.code === 'UNSAFE_PROFILE_LINK');
  fs.rmSync(path.join(dir, 'profiles', first.id, 'Default', 'escape'));
  const second = await makeProfile('Second');
  assert.throws(() => restoreBackup(archive, { collision: 'abort' }), error => error.code === 'COLLISION');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM profiles').get().n, 2);
  assert.throws(() => restoreBackup(archive, { collision: 'rename', failPoint: 'before-files' }), error => error.code === 'RESTORE_FAILED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM profiles').get().n, 2);
  assert.equal(db.prepare('SELECT name FROM profiles WHERE id=?').get(second.id).name, 'Second');
  const renamed = restoreBackup(archive, { collision: 'rename' });
  assert.equal(renamed.renamed.length, 1);
  assert.notEqual(renamed.renamed[0].id, first.id);
  assert.equal(fs.readFileSync(path.join(dir, 'profiles', renamed.renamed[0].id, 'Default', 'marker.txt'), 'utf8'), 'First');
  assert.equal(fs.readFileSync(path.join(dir, 'profiles', first.id, 'Default', 'marker.txt'), 'utf8'), 'First');
  fs.writeFileSync(path.join(dir, 'profiles', first.id, 'Default', 'marker.txt'), 'changed');
  const replaced = restoreBackup(archive, { collision: 'replace' });
  assert.equal(replaced.replaced.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'profiles', first.id, 'Default', 'marker.txt'), 'utf8'), 'First');
  const downloaded = await call('POST', '/api/v1/backup', null);
  assert.equal(downloaded.status, 200);
  const { inspectBackup } = await import('../server/backup.js');
  const inspected = inspectBackup(createBackup({ ids: [] }));
  assert.ok(inspected.fileChecksumCount >= 2);
  const corrupt = await call('POST', '/api/v1/backup/restore?collision=abort', Buffer.from('not-a-backup'), { 'Content-Type': 'application/octet-stream' });
  assert.equal(corrupt.status, 400);
  assert.equal(corrupt.body.code, 'UNSAFE_ARCHIVE');
});

test('archives reject Windows aliases, alternate streams, and case-colliding entries', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const suffix of ['aux.txt', 'x:stream', 'file.', 'dir /file', 'nul']) {
    assert.throws(() => assertArchivePath(`profiles/${id}/${suffix}`), e => e.code === 'UNSAFE_ARCHIVE');
  }
  const archive = packArchive([
    { path: `profiles/${id}/Data`, data: Buffer.from('a') },
    { path: `profiles/${id}/data`, data: Buffer.from('b') },
  ]);
  assert.throws(() => unpackArchive(archive), e => e.code === 'UNSAFE_ARCHIVE');
});

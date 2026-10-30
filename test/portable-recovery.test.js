import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decryptBackup, encryptBackup } from '../server/backup-crypto.js';
import { unpackArchive, packArchive } from '../server/archive.js';
const worker = fileURLToPath(new URL('./fixtures/portable-recovery-worker.mjs', import.meta.url));
const passphrase = 'disposable test passphrase';
function sandbox(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portable-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })); return root; }
function run(dir, args, expected = 0) {
  const env = { ...process.env, PM_DATA_DIR: dir, PM_TEST_ARGS: JSON.stringify(args) }; delete env.PM_SECRET; delete env.NODE_TEST_CONTEXT;
  const p = spawnSync(process.execPath, [worker], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(p.status, expected, p.stderr + p.stdout);
  return p.stdout.trim() ? JSON.parse(p.stdout.trim()) : null;
}
function archive(t, engine = 'chromium') {
  const root = sandbox(t), a = path.join(root, 'A'), b = path.join(root, 'B'), file = path.join(root, 'portable.pmp');
  const ids = run(a, { mode: 'seed' }).value;
  assert.equal(run(a, { mode: 'export', engine, file }).value.encrypted, true);
  return { root, a, b, file, ids };
}
for (const engine of ['chromium', 'firefox']) {
  test(`encrypted portable ${engine}: installation A → clean B restores all dependencies and isolated data`, t => {
    const { a, b, file, ids } = archive(t, engine);
    const result = run(b, { mode: 'restore', file }).value;
    assert.equal(result.extensionsSkipped, 0); assert.deepEqual(result.proxyDetached, []);
    const status = run(b, { mode: 'status' }).value;
    assert.equal(status.profiles.length, 1); assert.equal(status.locks.length, 0);
    const p = status.profiles[0];
    assert.equal(p.id, ids[engine]); assert.equal(p.browser_engine, engine); assert.equal(p.marker, 'Export ' + engine); assert.equal(p.localStorage, 'Export ' + engine);
    assert.equal(p.proxySecretMatches, true); assert.equal(p.workspace_id, ids.workspace);
    assert.equal(p.extensions.length, 1); assert.equal(p.extensions[0].assetPresent, true); assert.equal(p.extensions[0].browser_engine, engine);
    const sqlite = fs.readFileSync(path.join(b, 'profiles', p.id, engine === 'firefox' ? 'gecko' : 'Default', 'cookies.sqlite'));
    assert.deepEqual(sqlite, fs.readFileSync(path.join(a, 'profiles', p.id, engine === 'firefox' ? 'gecko' : 'Default', 'cookies.sqlite')));
    assert.equal(fs.existsSync(path.join(b, 'profiles', ids[engine === 'firefox' ? 'chromium' : 'firefox'])), false);
  });
}
test('colliding profile and dependency IDs are remapped without overwriting destination data', t => {
  const { b, file, ids } = archive(t); run(b, { mode: 'seed', label: 'Existing' });
  const result = run(b, { mode: 'restore', file, collision: 'rename' }).value;
  const id = result.renamed[0].id; assert.notEqual(id, ids.chromium);
  assert.notEqual(result.dependencyMap.workspaces[ids.workspace], ids.workspace);
  assert.notEqual(result.dependencyMap.proxies[ids.proxy], ids.proxy);
  assert.notEqual(result.dependencyMap.extensions[ids.chromiumExt], ids.chromiumExt);
  const status = run(b, { mode: 'status' }).value;
  assert.equal(status.profiles.find(p => p.id === ids.chromium).marker, 'Existing chromium');
  assert.equal(status.profiles.find(p => p.id === id).marker, 'Export chromium');
});
for (const kind of ['workspace', 'proxy', 'extension', 'checksum', 'future-version', 'manifest']) {
  test(`portable restore rejects ${kind} corruption before creating a profile`, t => {
    const { root, b, file } = archive(t), files = unpackArchive(decryptBackup(fs.readFileSync(file), passphrase)), metaFile = files.find(f => f.path === 'meta.json');
    const meta = JSON.parse(metaFile.data);
    if (kind === 'workspace') meta.dependencies.workspace = null;
    if (kind === 'proxy') meta.dependencies.proxy = null;
    if (kind === 'extension') files.splice(files.findIndex(f => f.path.endsWith('/background.js')), 1);
    if (kind === 'checksum') meta.fileChecksums[Object.keys(meta.fileChecksums)[0]] = '0'.repeat(64);
    if (kind === 'future-version') meta.schemaVersion = 9999;
    metaFile.data = Buffer.from(kind === 'manifest' ? '{broken' : JSON.stringify(meta));
    const corrupt = path.join(root, 'corrupt.pmp'); fs.writeFileSync(corrupt, encryptBackup(packArchive(files), passphrase));
    assert.equal(run(b, { mode: 'restore', file: corrupt }, 1).ok, false);
    assert.equal(run(b, { mode: 'status' }).value.profiles.length, 0);
  });
}
for (const boundary of ['journal-created', 'staged-file:0:Default/marker', 'prepared', 'park:0', 'install:0', 'park:1', 'install:1', 'before-db-commit', 'after-db-commit', 'before-cleanup', 'after-cleanup']) {
  test(`process interruption at ${boundary} recovers idempotently with database/filesystem agreement`, t => {
    const { b, file, ids } = archive(t); run(b, { mode: 'seed', label: 'Previous' });
    run(b, { mode: 'restore', file, collision: 'replace', crash: boundary }, 86);
    run(b, { mode: 'startup' }); run(b, { mode: 'startup' });
    const committed = ['after-db-commit', 'before-cleanup', 'after-cleanup'].includes(boundary);
    let status = run(b, { mode: 'status' }).value;
    const p = status.profiles.find(p => p.id === ids.chromium);
    assert.equal(p.name, (committed ? 'Export' : 'Previous') + ' chromium');
    assert.equal(p.marker, (committed ? 'Export' : 'Previous') + ' chromium');
    assert.equal(p.proxySecretMatches, true);
    if (committed && boundary !== 'after-cleanup') { assert.equal(p.blocked, true); run(b, { mode: 'recover', cleanup: true }); }
    status = run(b, { mode: 'status' }).value; assert.equal(status.locks.length, 0);
  });
}
for (const boundary of ['purge-parked', 'purge-before-delete', 'purge-after-delete', 'purge-committed']) {
  test(`interrupted purge at ${boundary} never automatically retries destruction`, t => {
    const root = sandbox(t), dir = path.join(root, 'purge'), ids = run(dir, { mode: 'seed' }).value;
    run(dir, { mode: 'purge', crash: boundary }, 86);
    const before = run(dir, { mode: 'status' }).value;
    run(dir, { mode: 'startup' }); run(dir, { mode: 'startup' });
    const after = run(dir, { mode: 'status' }).value;
    assert.deepEqual(after.profiles, before.profiles);
    if (boundary !== 'purge-committed') {
      const recovered = run(dir, { mode: 'recover', profileId: ids.chromium }).value[0];
      assert.equal(recovered.remainingDataRecovered, true);
      assert.equal(recovered.verified, boundary !== 'purge-after-delete');
    } else assert.equal(after.profiles.some(p => p.id === ids.chromium), false);
  });
}
test('partial Windows-style EBUSY purge preserves remaining data for manual recovery and backup replacement', t => {
  const { b, file, ids } = archive(t); run(b, { mode: 'seed', label: 'Previous' });
  assert.equal(run(b, { mode: 'purge', partial: true }, 1).code, 'PURGE_FS_FAILED');
  run(b, { mode: 'startup' });
  const recovered = run(b, { mode: 'recover', profileId: ids.chromium }).value[0];
  assert.equal(recovered.verified, false);
  assert.equal(run(b, { mode: 'recover', profileId: ids.chromium }).value[0].verified, false);
  let p = run(b, { mode: 'status' }).value.profiles.find(p => p.id === ids.chromium);
  assert.match(p.purge_error, /incomplete/); assert.equal(p.localStorage, 'Previous chromium');
  run(b, { mode: 'restore', file, collision: 'replace' });
  p = run(b, { mode: 'status' }).value.profiles.find(p => p.id === ids.chromium);
  assert.equal(p.marker, 'Export chromium'); assert.equal(p.purge_error, null);
});
test('SQLite purge error retains the trash row and explicit retry is idempotent', t => {
  const root = sandbox(t), dir = path.join(root, 'purge'), ids = run(dir, { mode: 'seed' }).value;
  assert.equal(run(dir, { mode: 'purge', dbFail: true }, 1).code, 'PURGE_FS_FAILED');
  const status = run(dir, { mode: 'status' }).value;
  assert.ok(status.profiles.find(p => p.id === ids.chromium).deleted_at);
  run(dir, { mode: 'purge' });
  assert.equal(run(dir, { mode: 'status' }).value.profiles.some(p => p.id === ids.chromium), false);
});

test('portable v2 accepts an older supported source schema and rejects plaintext downgrade', t => {
  const { root, b, file } = archive(t);
  const files = unpackArchive(decryptBackup(fs.readFileSync(file), passphrase));
  const manifest = files.find(f => f.path === 'meta.json'), meta = JSON.parse(manifest.data);
  meta.schemaVersion = 17; manifest.data = Buffer.from(JSON.stringify(meta));
  const older = path.join(root, 'older.pmp'); fs.writeFileSync(older, encryptBackup(packArchive(files), passphrase));
  assert.equal(run(b, { mode: 'restore', file: older }).ok, true);
  const plain = path.join(root, 'downgrade.pmp'); fs.writeFileSync(plain, packArchive(files));
  assert.equal(run(path.join(root, 'C'), { mode: 'restore', file: plain }, 1).code, 'ENCRYPTION_REQUIRED');
});

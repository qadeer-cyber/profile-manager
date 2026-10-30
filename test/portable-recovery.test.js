import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decryptBackup, encryptBackup } from '../server/backup-crypto.js';
import { unpackArchive, packArchive } from '../server/archive.js';
import { archive, sandbox, run, passphrase } from './_portable-recovery-helpers.mjs';
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

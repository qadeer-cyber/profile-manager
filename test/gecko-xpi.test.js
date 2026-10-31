import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateXpiArchive, readZipEntry, xpiHasMozillaSignatureMetadata } from '../server/gecko-xpi.js';
import { buildXpi, demoManifest } from './_xpi-fixture.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-xpi-'));
process.env.PM_DATA_DIR = dir;
const { db } = await import('../server/db.js');
const { importXpiGeckoExtension, geckoExtensionReport } = await import('../server/gecko-extensions.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.PM_DATA_DIR; });

for (const options of [{}, { deflate: true }, { deflate: true, descriptor: true }]) {
  test(`reads bounded ZIP manifest ${JSON.stringify(options)}`, () => {
    const zip = buildXpi({ 'manifest.json': demoManifest }, options);
    assert.equal(readZipEntry(zip, 'manifest.json').toString(), demoManifest);
  });
}
test('fabricated signature metadata confers no signing or installation claim', () => {
  const zip = buildXpi({ 'manifest.json': demoManifest, 'META-INF/mozilla.rsa': 'fabricated' });
  assert.equal(xpiHasMozillaSignatureMetadata(zip), true);
  const file = path.join(dir, 'untrusted.xpi'); fs.writeFileSync(file, zip);
  const row = importXpiGeckoExtension(file);
  assert.equal(row.gecko_extension_id, 'demo@test');
  assert.equal(geckoExtensionReport().automaticInstallation, false);
  assert.match(geckoExtensionReport().signingPolicy, /performed by Firefox/);
});
for (const name of ['../escape', '/absolute', 'C:/escape', 'dir\\escape', 'aux.txt', 'file:stream', 'a./b']) {
  test(`rejects unsafe XPI path ${name}`, () => assert.throws(() => validateXpiArchive(buildXpi({ [name]: 'bad' })), /unsafe entry path/));
}
test('rejects duplicate names across Windows case folding', () => {
  assert.throws(() => validateXpiArchive(buildXpi({ 'a.js': 'a', 'A.js': 'b' })), /duplicate/);
});
test('rejects malformed offsets, CRC corruption, unsupported compression, and symlinks', () => {
  const original = buildXpi({ 'manifest.json': demoManifest });
  for (const mutate of [
    b => b.writeUInt32LE(0xfffffff0, b.length - 6),
    b => { b[30 + 'manifest.json'.length] ^= 1; },
    b => { const c = b.readUInt32LE(b.length - 6); b.writeUInt16LE(99, c + 10); },
    b => { const c = b.readUInt32LE(b.length - 6); b.writeUInt32LE((0xa1ff << 16) >>> 0, c + 38); },
  ]) { const corrupt = Buffer.from(original); mutate(corrupt); assert.throws(() => validateXpiArchive(corrupt), /Invalid XPI/); }
  for (const n of [0, 1, 20, original.length - 1]) assert.throws(() => validateXpiArchive(original.subarray(0, n)), /Invalid XPI/);
});
test('rejects a decompression bomb before expanding it', () => {
  assert.throws(() => validateXpiArchive(buildXpi({ 'bomb.bin': Buffer.alloc(2 * 1024 * 1024) }, { deflate: true })), /decompression limits/);
});
test('rejects unsafe extension identity without creating library files', () => {
  const manifest = JSON.parse(demoManifest); manifest.browser_specific_settings.gecko.id = '../../escape';
  const file = path.join(dir, 'unsafe.xpi'); fs.writeFileSync(file, buildXpi({ 'manifest.json': JSON.stringify(manifest) }));
  const before = db.prepare('SELECT COUNT(*) n FROM extensions').get().n;
  assert.throws(() => importXpiGeckoExtension(file), /safe gecko.id/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM extensions').get().n, before);
});

test('database failure during XPI import removes only the new library copy', () => {
  const root = path.join(dir, 'gecko-extensions');
  const before = fs.readdirSync(root).sort();
  const file = path.join(dir, 'db-failure.xpi');
  fs.writeFileSync(file, buildXpi({ 'manifest.json': demoManifest }));
  db.exec("CREATE TEMP TRIGGER refuse_xpi BEFORE INSERT ON extensions BEGIN SELECT RAISE(ABORT, 'injected import failure'); END");
  try { assert.throws(() => importXpiGeckoExtension(file), /injected import failure/); }
  finally { db.exec('DROP TRIGGER refuse_xpi'); }
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});

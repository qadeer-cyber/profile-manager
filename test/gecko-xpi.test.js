import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listZipEntries, readZipEntry, xpiHasMozillaSignature } from '../server/gecko-xpi.js';

function buildStoreZip(files) {
  const parts = [];
  let offset = 0;
  const central = [];
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(data.length, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    parts.push(local);
    offset += local.length;
    const c = Buffer.alloc(46 + nameBuf.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0, 4);
    c.writeUInt16LE(0, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt32LE(0, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset - local.length, 42);
    nameBuf.copy(c, 46);
    central.push(c);
  }
  const centralStart = offset;
  for (const c of central) { parts.push(c); offset += c.length; }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(central.reduce((s, c) => s + c.length, 0), 12);
  eocd.writeUInt32LE(centralStart, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}

test('xpi reader detects mozilla signature files', () => {
  const manifest = Buffer.from(JSON.stringify({
    manifest_version: 2,
    name: 'Demo',
    version: '1.0.0',
    browser_specific_settings: { gecko: { id: 'demo@test', strict_min_version: '102.0' } },
  }));
  const zip = buildStoreZip({ 'manifest.json': manifest, 'META-INF/mozilla.rsa': Buffer.from('stub') });
  assert.equal(xpiHasMozillaSignature(zip), true);
  assert.ok(listZipEntries(zip).has('manifest.json'));
  assert.equal(JSON.parse(readZipEntry(zip, 'manifest.json').toString()).name, 'Demo');
});

test('importXpiGeckoExtension stores signed fixture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-xpi-import-'));
  process.env.PM_DATA_DIR = dir;
  const manifest = Buffer.from(JSON.stringify({
    manifest_version: 2,
    name: 'Signed',
    version: '2.0.0',
    browser_specific_settings: { gecko: { id: 'signed@test' } },
  }));
  const xpiPath = path.join(dir, 'ext.xpi');
  fs.writeFileSync(xpiPath, buildStoreZip({ 'manifest.json': manifest, 'META-INF/mozilla.sf': Buffer.from('sf') }));
  const { importXpiGeckoExtension } = await import('../server/gecko-extensions.js');
  const row = importXpiGeckoExtension(xpiPath);
  assert.equal(row.gecko_extension_id, 'signed@test');
  const { db } = await import('../server/db.js');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-ext-'));
process.env.PM_DATA_DIR = dataDir;
const { db } = await import('../server/db.js');
const {
  importUnpackedGeckoExtension, materializeGeckoExtensions, readGeckoManifestFromDir,
  setGeckoProfileExtensionEnabled, readGeckoProfileExtensions,
} = await import('../server/gecko-extensions.js');
const { assignExtension } = await import('../server/extensions.js');

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('importUnpackedGeckoExtension requires gecko id in manifest', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-src-'));
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Bad', version: '1.0' }));
  assert.throws(() => importUnpackedGeckoExtension(src), /gecko\.id/);
  fs.rmSync(src, { recursive: true, force: true });
});

test('setGeckoProfileExtensionEnabled toggles userDisabled in extensions.json', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-json-'));
  fs.writeFileSync(path.join(profileDir, 'extensions.json'), JSON.stringify({
    schemaVersion: 35,
    addons: [{ id: 'demo@test', version: '1.0', active: true, userDisabled: false, type: 'extension' }],
  }));
  setGeckoProfileExtensionEnabled(profileDir, 'demo@test', false);
  const read = readGeckoProfileExtensions(profileDir);
  assert.equal(read.addons[0].userDisabled, true);
  fs.rmSync(profileDir, { recursive: true, force: true });
});

test('materializeGeckoExtensions copies enabled assignments into profile tree', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-good-'));
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({
    manifest_version: 2,
    name: 'Demo',
    version: '1.0.0',
    browser_specific_settings: { gecko: { id: 'demo@profile-manager.test', strict_min_version: '102.0' } },
  }));
  readGeckoManifestFromDir(src);
  const row = importUnpackedGeckoExtension(src);
  const pid = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, 'FF', '[]', '', '', 'firefox', now, now);
  assignExtension(pid, row.id, true);
  const profileDir = path.join(dataDir, 'profiles', pid, 'gecko');
  fs.mkdirSync(profileDir, { recursive: true });
  const { count } = materializeGeckoExtensions(profileDir, pid);
  assert.equal(count, 1);
  assert.ok(fs.existsSync(path.join(profileDir, 'extensions', 'demo@profile-manager.test', 'manifest.json')));
  fs.rmSync(src, { recursive: true, force: true });
});

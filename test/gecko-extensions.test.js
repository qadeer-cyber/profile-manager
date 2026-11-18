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

test('offline toggle returns a capability error and leaves Firefox metadata unchanged', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-json-'));
  fs.writeFileSync(path.join(profileDir, 'extensions.json'), JSON.stringify({
    schemaVersion: 35,
    addons: [{ id: 'demo@test', version: '1.0', active: true, userDisabled: false, type: 'extension' }],
  }));
  const original = fs.readFileSync(path.join(profileDir, 'extensions.json'));
  assert.throws(() => setGeckoProfileExtensionEnabled(profileDir, 'demo@test', false), e => e.status === 501 && e.code === 'GECKO_EXTENSION_TOGGLE_UNSUPPORTED');
  assert.deepEqual(fs.readFileSync(path.join(profileDir, 'extensions.json')), original);
  fs.rmSync(profileDir, { recursive: true, force: true });
});

test('Firefox assignments remain inventory and never mutate browser files', () => {
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
  const result = materializeGeckoExtensions(profileDir, pid);
  assert.equal(result.count, 0);
  assert.deepEqual(result.pendingManualInstallation, [row.id]);
  assert.equal(fs.existsSync(path.join(profileDir, 'extensions')), false);
  fs.rmSync(src, { recursive: true, force: true });
});

test('removing a Firefox library item uses its engine-specific storage directory', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-delete-'));
  try {
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Remove', version: '1.0', browser_specific_settings: { gecko: { id: 'remove@test' } } }));
    const row = importUnpackedGeckoExtension(src);
    const target = path.join(dataDir, row.storage_dir);
    assert.equal(fs.existsSync(target), true);
    // Loaded dynamically to share the same isolated DB.
    return import('../server/extensions.js').then(({ deleteExtension }) => {
      deleteExtension(row.id);
      assert.equal(fs.existsSync(target), false);
      assert.equal(db.prepare('SELECT id FROM extensions WHERE id=?').get(row.id), undefined);
    });
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

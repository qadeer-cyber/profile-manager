import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m5-'));
process.env.PM_DATA_DIR = dir;
const ext = await import('../server/extensions.js');
const { db, DATA_DIR } = await import('../server/db.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const manifest = (over = {}) => ({ manifest_version: 3, name: 'Sample Notes', version: '1.2.3', description: 'Shows notes', permissions: ['storage'], host_permissions: ['https://example.com/*'], optional_permissions: ['tabs'], ...over });
function writeExt(name, value = manifest(), extra) {
  const root = path.join(dir, 'src', name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), typeof value === 'string' ? value : JSON.stringify(value));
  if (extra) fs.writeFileSync(path.join(root, 'background.js'), '/* fixture */\n');
  return root;
}

test('import copies a valid unpacked extension and reports version and permissions', () => {
  const root = writeExt('good', manifest(), true);
  const row = ext.importUnpackedExtension(root);
  assert.equal(row.name, 'Sample Notes');
  assert.equal(row.version, '1.2.3');
  assert.equal(row.manifestVersion, 3);
  assert.deepEqual(row.permissions, ['storage']);
  assert.deepEqual(row.hostPermissions, ['https://example.com/*']);
  assert.deepEqual(row.optionalPermissions, ['tabs']);
  assert.equal(row.assignedProfiles, 0);
  assert.ok(!('storage_dir' in row));
  const stored = path.join(DATA_DIR, 'extensions', row.id, 'manifest.json');
  assert.equal(fs.existsSync(stored), true);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(stored), true, 'library copy survives deletion of the source');
  assert.equal(ext.listExtensions().length, 1);
});

test('a second extension is listed separately', () => {
  const row = ext.importUnpackedExtension(writeExt('other', manifest({ name: 'Other', version: '0.0.1', permissions: [], manifest_version: 2 }), true));
  assert.equal(row.manifestVersion, 2);
  assert.deepEqual(row.permissions, []);
  assert.equal(ext.listExtensions().length, 2);
});

test('command lines join enabled paths and reject commas', () => {
  assert.deepEqual(ext.extensionCommandArgs([]), { args: [], ignoreDefaultArgs: ['--disable-extensions'] });
  const plan = ext.extensionCommandArgs(['/opt/ext/a', '/opt/ext/b']);
  assert.deepEqual(plan.ignoreDefaultArgs, ['--disable-extensions']);
  assert.equal(plan.args[0], '--disable-extensions-except=/opt/ext/a,/opt/ext/b');
  assert.equal(plan.args[1], '--load-extension=/opt/ext/a,/opt/ext/b');
  assert.throws(() => ext.extensionCommandArgs(['/tmp/has,comma']), e => e.status === 500 && e.code === 'EXTENSION_PATH');
});

for (const [label, setup] of [
  ['relative path', () => 'extensions/not-absolute'],
  ['missing path', () => path.join(dir, 'missing-extension')],
  ['file instead of directory', () => { const file = path.join(dir, 'a-file'); fs.writeFileSync(file, '{}'); return file; }],
  ['null byte', () => `/tmp/ext\0bad`],
  ['url', () => 'https://example.com/ext'],
  ['symlink root', () => { const real = writeExt('link-target'); const link = path.join(dir, 'link-root'); fs.symlinkSync(real, link); return link; }],
  ['missing manifest', () => { const root = path.join(dir, 'src', 'empty'); fs.mkdirSync(root, { recursive: true }); return root; }],
  ['invalid json', () => writeExt('bad-json', '{')],
  ['manifest version 1', () => writeExt('mv1', manifest({ manifest_version: 1 }))],
  ['missing name', () => writeExt('noname', manifest({ name: '  ' }))],
  ['bad version', () => writeExt('badver', manifest({ version: '1.2.3.4.5' }))],
  ['permissions not an array', () => writeExt('badperm', manifest({ permissions: { storage: true } }))],
  ['symlink inside', () => { const root = writeExt('linked', manifest(), true); const outside = path.join(dir, 'secret.txt'); fs.writeFileSync(outside, 'secret'); fs.symlinkSync(outside, path.join(root, 'escaped')); return root; }],
]) {
  test(`reject malformed extension import: ${label}`, () => {
    const before = ext.listExtensions().length;
    assert.throws(() => ext.importUnpackedExtension(setup()), e => e.code === 'INVALID_EXTENSION' && e.status === 400);
    assert.equal(ext.listExtensions().length, before);
  });
}

test('removing an extension deletes the copied files', () => {
  const row = ext.listExtensions().find(item => item.name === 'Sample Notes');
  const stored = path.join(DATA_DIR, 'extensions', row.id);
  ext.deleteExtension(row.id);
  assert.equal(fs.existsSync(stored), false);
  assert.equal(ext.listExtensions().some(item => item.id === row.id), false);
  assert.throws(() => ext.deleteExtension(row.id), e => e.status === 404);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {createRequire} from 'node:module';
import {asarHasEntry, readAsarEntry} from '../scripts/asar-entries.mjs';

test('a Windows asar listing still identifies the packaged admin module', () => {
  const listed = [
    path.win32.join('/', 'server', 'ultimate-admin.js'),
    path.win32.join('/', 'scripts', 'license-admin', 'admin.mjs'),
    path.win32.join('/', 'scripts', 'license-admin', 'issuer.mjs'),
    path.win32.join('/', 'server', 'office', 'license.js'),
  ];
  const rendered = listed.join('\n');
  assert.equal(rendered.includes('server/ultimate-admin.js'), false);
  assert.equal(rendered.includes('scripts/license-admin/admin.mjs'), false);
  assert.equal(asarHasEntry(listed, 'server/ultimate-admin.js'), true);
  assert.equal(asarHasEntry(listed, 'scripts/license-admin/admin.mjs'), true);
  assert.equal(asarHasEntry(listed, 'scripts/license-admin/issuer.mjs'), true);
  assert.equal(asarHasEntry(listed, 'server/office/license.js'), true);
  assert.equal(asarHasEntry(listed, 'scripts/license-admin/missing.mjs'), false);
});

test('reads a nested ASAR entry using the host path separator', async t => {
  const asar = createRequire(import.meta.url)('@electron/asar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimate-asar-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const stage = path.join(root, 'stage');
  const module = 'scripts/license-admin/admin.mjs';
  const source = path.join(stage, module);
  const archive = path.join(root, 'app.asar');
  fs.mkdirSync(path.dirname(source), {recursive: true});
  fs.writeFileSync(source, 'export {};\n');
  await asar.createPackage(stage, archive);
  assert.ok(asarHasEntry(asar.listPackage(archive), module));
  assert.equal(readAsarEntry(asar, archive, module).toString('utf8'), 'export {};\n');
});

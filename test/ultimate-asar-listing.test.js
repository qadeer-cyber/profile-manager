import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {asarHasEntry} from '../scripts/asar-entries.mjs';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {asarHasEntry, asarLookupPath} from '../scripts/asar-entries.mjs';

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
  const nested = 'scripts/license-admin/admin.mjs';
  assert.equal(path.win32.dirname(nested).split(path.win32.sep).includes('license-admin'), false);
  const lookup = nested.replaceAll('/', '\\');
  assert.deepEqual(path.win32.dirname(lookup).split(path.win32.sep), ['scripts', 'license-admin']);
  assert.equal(asarLookupPath(nested).includes('/'), process.platform !== 'win32');
});

test('the installed acceptance calls Page methods on windows, not on Electron applications', () => {
  const source = fs.readFileSync(new URL('../scripts/ultimate-unified-acceptance.mjs', import.meta.url), 'utf8');
  const allowed = new Set(['evaluate', 'firstWindow', 'close', 'windows', 'process', 'context', 'browserWindow']);
  const calls = [...source.matchAll(/\b(ownerApp|adminApp|unified|office)\.([A-Za-z]+)/g)];
  assert.ok(calls.length > 0);
  for (const [, object, method] of calls) {
    assert.ok(allowed.has(method), `${object}.${method} is not an ElectronApplication method`);
  }
});

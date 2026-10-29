import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { yazl } = require('playwright-core/lib/utilsBundle');
const cr = await import('../server/chromium.js');
const life = await import('../server/chromium-lifecycle.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-chromium-life-'));
async function fakeManifest(zip) {
  return { revision: '9999', browserVersion: '1.0', baseUrl: 'https://cdn.playwright.dev/builds/cft/1.0/',
    builds: { chromium: { linux64: { path: 'linux64/chrome-linux64.zip', sha256: await cr.sha256File(zip), size: fs.statSync(zip).size } } } };
}
function makeZip(file) {
  return new Promise(res => { const z = new yazl.ZipFile(); z.addBuffer(Buffer.from('#!/bin/sh\necho ok\n'), 'chrome-linux64/chrome', { mode: 0o100755 }); z.outputStream.pipe(fs.createWriteStream(file)).on('close', res); z.end(); });
}

test('installWithBackup rolls back when extraction fails', async () => {
  const good = path.join(tmp, 'good-life.zip'); await makeZip(good);
  const manifest = await fakeManifest(good);
  const root = path.join(tmp, 'root-life');
  await cr.installOne('chromium', { root, manifest, key: 'linux64', download: async (u, d) => fs.copyFileSync(good, d) });
  const dir = cr.installDir('chromium', { root, manifest });
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'keep');
  await assert.rejects(life.installWithBackup('chromium', {
    root, manifest, key: 'linux64',
    download: async (u, d) => fs.copyFileSync(path.join(tmp, 'missing.zip'), d),
  }), () => true);
  assert.equal(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8'), 'keep');
  assert.equal(life.listInstallBackups('chromium', { root, manifest }).length, 0);
});

test('interruptedInstallState reports partial installs and rollback availability', () => {
  const state = life.interruptedInstallState('chromium', { root: tmp, manifest: { revision: '1', builds: { chromium: { linux64: { path: 'x.zip' } } } } });
  assert.equal(typeof state.present, 'boolean');
  assert.equal(typeof state.rollbackAvailable, 'boolean');
});

test('executableCompatibility blocks a mismatched custom executable', async () => {
  const { chromium } = await import('playwright');
  const exe = chromium.executablePath();
  if (!fs.existsSync(exe)) return;
  const compat = life.executableCompatibility(exe);
  assert.equal(compat.launchAllowed, true);
  assert.equal(compat.versionMismatch, false);
  const fake = life.executableCompatibility(process.execPath);
  if (fake.executableVersion && fake.pinnedVersion && fake.executableVersion !== fake.pinnedVersion) {
    assert.equal(fake.launchAllowed, false);
    assert.match(fake.warning, /pinned/);
  }
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

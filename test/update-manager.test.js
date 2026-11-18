import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { yazl } = require('playwright-core/lib/utilsBundle');
const cr = await import('../server/chromium.js');
const life = await import('../server/chromium-lifecycle.js');
const { browserUpdateManagerReport } = await import('../server/browser-runtime/update-manager.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-upd-mgr-'));

async function fakeManifest(zip) {
  return { revision: '8888', browserVersion: '1.0', baseUrl: 'https://cdn.playwright.dev/builds/cft/1.0/',
    builds: { chromium: { linux64: { path: 'linux64/chrome-linux64.zip', sha256: await cr.sha256File(zip), size: fs.statSync(zip).size } } } };
}

function makeZip(file) {
  return new Promise(res => { const z = new yazl.ZipFile(); z.addBuffer(Buffer.from('#!/bin/sh\necho ok\n'), 'chrome-linux64/chrome', { mode: 0o100755 }); z.outputStream.pipe(fs.createWriteStream(file)).on('close', res); z.end(); });
}

test('rollbackBrowserSlot restores previous CfT tree', async () => {
  const good = path.join(tmp, 'upd-good.zip'); await makeZip(good);
  const manifest = await fakeManifest(good);
  const root = path.join(tmp, 'upd-root');
  await cr.installOne('chromium', { root, manifest, key: 'linux64', download: async (u, d) => fs.copyFileSync(good, d) });
  const dir = cr.installDir('chromium', { root, manifest });
  fs.writeFileSync(path.join(dir, 'slot-marker.txt'), 'v1');
  life.backupInstallDir('chromium', { root, manifest });
  await cr.installOne('chromium', { root, manifest, key: 'linux64', download: async (u, d) => fs.copyFileSync(good, d) });
  const restored = life.rollbackLatest('chromium', { root, manifest });
  assert.ok(restored);
  assert.equal(fs.readFileSync(path.join(dir, 'slot-marker.txt'), 'utf8'), 'v1');
});

test('browserUpdateManagerReport documents wired rollback', () => {
  const report = browserUpdateManagerReport();
  assert.equal(report.rollback.supported, true);
  assert.ok(report.rollback.endpoints?.rollback);
  assert.ok(Array.isArray(report.slots));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

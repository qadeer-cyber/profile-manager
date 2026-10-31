import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m11-'));
process.env.PM_DATA_DIR = dir;
const { db, setSetting } = await import('../server/db.js');
const { assertLaunchResources } = await import('../server/launch-limits.js');
const { fingerprintCapabilityReport } = await import('../server/fingerprint-capabilities.js');

before(() => setSetting('minFreeMemoryGiB', 0));
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('launch guard rejects too many concurrent profiles', () => {
  setSetting('maxRunningProfiles', 2);
  assertLaunchResources(1);
  assert.throws(() => assertLaunchResources(2), error => error.code === 'TOO_MANY_PROFILES');
});

test('fingerprint capability report lists custom-Chromium needs without inventing controls', () => {
  const report = fingerprintCapabilityReport({ platform: 'win32' });
  assert.ok(report.controls.some(item => item.id === 'webgl'));
  assert.ok(report.customChromiumRequired.length >= 5);
  assert.match(report.observation, /not a stealth/);
});

test('diagnostics exposes launch limits and browser compatibility', async () => {
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm11-diag' };
  const proc = await spawnServer(env);
  try {
    const response = await fetch(`${proc.url}/api/diagnostics`);
    const body = await response.json();
    assert.equal(response.ok, true);
    assert.equal(typeof body.launchLimits.maxRunningProfiles, 'number');
    assert.equal(typeof body.browserCompatibility.pinnedVersion, 'string');
  } finally {
    await stopServer(proc);
  }
});

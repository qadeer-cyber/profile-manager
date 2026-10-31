import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-drivers-'));
process.env.PM_DATA_DIR = dir;
const { db, setSetting } = await import('../server/db.js');
const {
  automationDriversReport, installAutomationDrivers, resolveChromedriverForBridge, resolveGeckodriverForBridge,
} = await import('../server/automation-drivers.js');

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_CHROMEDRIVER_PATH;
  delete process.env.PM_GECKODRIVER_PATH;
});

test('automationDriversReport is honest about bundling', () => {
  const r = automationDriversReport();
  assert.equal(r.bundledInInstaller, false);
  assert.equal(r.optInRequired, true);
  assert.equal(r.optIn, false);
  assert.ok(r.chromedriver.license.includes('Chrome for Testing'));
  assert.equal(r.geckodriver.license, 'MPL-2.0');
});

test('install requires opt-in and confirm', async () => {
  await assert.rejects(
    () => installAutomationDrivers('chromedriver', { confirm: true }),
    e => e.code === 'DRIVERS_OPT_IN_REQUIRED',
  );
  setSetting('automationDriversOptIn', true);
  await assert.rejects(
    () => installAutomationDrivers('chromedriver', { confirm: false }),
    e => e.code === 'CONFIRM_REQUIRED',
  );
});

test('resolve prefers env then cached setting path', () => {
  const stub = path.join(dir, 'cd-stub.exe');
  fs.writeFileSync(stub, '');
  process.env.PM_CHROMEDRIVER_PATH = stub;
  assert.equal(resolveChromedriverForBridge(), stub);
  delete process.env.PM_CHROMEDRIVER_PATH;
  setSetting('chromedriverCachePath', stub);
  assert.equal(resolveChromedriverForBridge(), stub);
  const gstub = path.join(dir, 'g-stub');
  fs.writeFileSync(gstub, '');
  setSetting('geckodriverCachePath', gstub);
  assert.equal(resolveGeckodriverForBridge(), gstub);
});

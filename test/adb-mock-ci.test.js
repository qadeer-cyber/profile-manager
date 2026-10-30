import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adb-mock-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_MOCK_ADB = '1';

before(() => {
  delete process.env.PM_ADB_MOCK;
});

after(async () => {
  delete process.env.PM_MOCK_ADB;
  try {
    const { db } = await import('../server/db.js');
    db.close();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

const {
  listAdbDevices, connectAdbTarget, disconnectAdbTarget, getAdbDeviceInfo, adbDiagnostics,
  setSelectedAdbSerial, validateAdbSerial, parseAdbDevicesListing,
} = await import('../server/adb-adapter.js');

test('mock adb lists devices with unauthorized state', () => {
  const report = listAdbDevices();
  assert.equal(report.mockMode, true);
  assert.equal(report.farmEquivalent, false);
  assert.ok(report.devices.length >= 2);
  assert.ok(report.counts.unauthorized >= 1);
});

test('connect and disconnect network target in mock mode', () => {
  const c = connectAdbTarget('10.0.0.8:5555');
  assert.equal(c.ok, true);
  assert.ok(c.devices.some(d => d.serial === '10.0.0.8:5555'));
  const d = disconnectAdbTarget('10.0.0.8:5555');
  assert.equal(d.ok, true);
});

test('device info and selection persist in settings', () => {
  const info = getAdbDeviceInfo('mock-usb-001');
  assert.equal(info.ok, true);
  assert.equal(info.properties['ro.product.model'], 'MockPhone');
  const sel = setSelectedAdbSerial('mock-usb-001');
  assert.equal(sel.selectedSerial, 'mock-usb-001');
  const diag = adbDiagnostics();
  assert.equal(diag.selectedSerial, 'mock-usb-001');
  assert.equal(diag.selectedPresent, true);
});

test('validateAdbSerial rejects shell injection', () => {
  assert.equal(validateAdbSerial('foo; rm -rf /').ok, false);
  assert.equal(validateAdbSerial('emulator-5554').ok, true);
});

test('parseAdbDevicesListing marks usbAuthorized', () => {
  const devices = parseAdbDevicesListing('List of devices attached\nX\tunauthorized\n');
  assert.equal(devices[0].usbAuthorized, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adb-adapter-'));
process.env.PM_DATA_DIR = dir;
const { adbAvailability, ADB_ADAPTER_NOTE } = await import('../server/adb-adapter.js');

test('adb adapter reports farm-equivalent false and optional availability', () => {
  const report = adbAvailability();
  assert.equal(report.farmEquivalent, false);
  assert.match(report.note, /NOT equivalent/i);
  assert.ok(typeof report.available === 'boolean');
  if (!report.available) assert.ok(report.reason);
  assert.equal(ADB_ADAPTER_NOTE.includes('cloud phone'), true);
});

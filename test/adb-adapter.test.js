import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adbAvailability, ADB_ADAPTER_NOTE } from '../server/adb-adapter.js';

test('adb adapter reports farm-equivalent false and optional availability', () => {
  const report = adbAvailability();
  assert.equal(report.farmEquivalent, false);
  assert.match(report.note, /NOT equivalent/i);
  assert.ok(typeof report.available === 'boolean');
  if (!report.available) assert.ok(report.reason);
  assert.equal(ADB_ADAPTER_NOTE.includes('cloud phone'), true);
});

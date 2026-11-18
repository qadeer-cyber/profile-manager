import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbDevicesListing, adbAdapterReport } from '../server/adb-adapter.js';

test('parseAdbDevicesListing extracts serial, state, and model props', () => {
  const sample = `List of devices attached
R58M90ABCDE\tdevice usb:1-2 product:dreamltexx model:SM_G950F device:dreamlte transport_id:1
emulator-5554\toffline
`;
  const devices = parseAdbDevicesListing(sample);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].serial, 'R58M90ABCDE');
  assert.equal(devices[0].state, 'device');
  assert.equal(devices[0].model, 'SM_G950F');
  assert.equal(devices[1].state, 'offline');
});

test('adbAdapterReport always denies farm equivalence', () => {
  const report = adbAdapterReport();
  assert.equal(report.farmEquivalent, false);
  assert.ok(Array.isArray(report.devices));
});

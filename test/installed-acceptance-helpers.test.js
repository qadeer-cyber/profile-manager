import assert from 'node:assert/strict';
import test from 'node:test';
import {assertIssuedDevice, waitForIssuedToken, waitForOfficeDeviceCode} from '../scripts/installed-acceptance-helpers.mjs';

const license = device => 'AZW1.' + Buffer.from(JSON.stringify({device})).toString('base64url') + '.signature';

test('fresh-looking licenses for the previous device fail before upload', () => {
  assert.throws(() => assertIssuedDevice(license('previous-device'), 'employee-device'), /does not target/);
  assert.doesNotThrow(() => assertIssuedDevice(license('employee-device'), 'employee-device'));
});

test('token readiness excludes the previously issued license', async () => {
  const old = license('previous-device');
  const next = license('employee-device');
  const savedDocument = globalThis.document;
  let value = old;
  globalThis.document = {querySelector: () => ({value})};
  try {
    const page = {
      async waitForFunction(predicate, previous) {
        assert.equal(previous, old);
        assert.equal(predicate(previous), false);
        value = next;
        assert.equal(predicate(previous), true);
      },
      locator(selector) {
        assert.equal(selector, 'textarea[readonly]');
        return {inputValue: async () => value};
      },
    };
    assert.equal(await waitForIssuedToken(page, old), next);
  } finally {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});

test('Office waits for rendered device identity and checks it against the API', async () => {
  const code = 'AZD1-' + 'a'.repeat(64);
  let hydrated = false;
  const page = {getByRole: () => ({
    getByRole: () => ({waitFor: async () => { hydrated = true; }}),
    getByLabel: () => ({inputValue: async () => hydrated ? code : 'Unavailable'}),
  })};
  assert.equal(await waitForOfficeDeviceCode(page, async () => ({status: 200, body: {deviceCode: code}})), code);
  await assert.rejects(waitForOfficeDeviceCode(page, async () => ({status: 200, body: {code:'DEVICE_ID_UNAVAILABLE'}})), /DEVICE_ID_UNAVAILABLE/);
});

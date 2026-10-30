// Stock-feasible acceptance criteria for M20–M30 (unit / plan level). Browser observables: fingerprint-feasible-local-browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan } from '../server/advanced-launch.js';
import { privateNetworkWeakening, WEBGL_DISABLE_ARG, fingerprintLaunchArgs } from '../server/fingerprint-settings.js';
import { MANIFEST } from '../server/chromium.js';

const PNA_FEATURES = [
  'PrivateNetworkAccessSendPreflights',
  'PrivateNetworkAccessRespectPreflightResults',
  'BlockInsecurePrivateNetworkRequests',
  'LocalNetworkAccessChecks',
];

test('M30 launch plan never adds private-network weakening disable-features', () => {
  const settings = validateAdvancedSettings({
    fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted', portScan: 'real' },
    geolocation: { permission: 'deny' },
    screen: { preset: '1280x800', deviceScaleFactor: 1 },
    userAgent: { mode: 'reduced' },
  });
  const plan = advancedLaunchPlan(settings, { version: MANIFEST.browserVersion, headless: true });
  const joined = plan.args.join(' ');
  for (const name of PNA_FEATURES) {
    assert.equal(joined.includes(name), false, `must not weaken ${name}`);
  }
  assert.ok(plan.args.includes(WEBGL_DISABLE_ARG));
  assert.equal(privateNetworkWeakening(joined).features.length, 0);
});

test('M30 privateNetworkWeakening detects injected weakening flags only', () => {
  assert.deepEqual(privateNetworkWeakening(''), { availability: 'unavailable', features: [] });
  assert.deepEqual(privateNetworkWeakening('chrome --foo'), { availability: 'observed', features: [] });
  const weakened = privateNetworkWeakening('chrome --disable-features=Translate,PrivateNetworkAccessSendPreflights,Foo');
  assert.equal(weakened.availability, 'observed');
  assert.deepEqual(weakened.features, ['PrivateNetworkAccessSendPreflights']);
});

test('M28–M29 restricted fingerprint conflicts with allow capture are rejected', () => {
  assert.throws(
    () => validateAdvancedSettings({
      fingerprint: { mediaDevices: 'restricted' },
      preferences: { permissions: { microphone: 'allow' } },
    }),
    err => err.code === 'INVALID_ADVANCED_SETTINGS',
  );
  const ok = validateAdvancedSettings({
    fingerprint: { webgl: 'restricted', mediaDevices: 'restricted' },
    preferences: { permissions: { camera: 'default', microphone: 'default' } },
  });
  assert.deepEqual(fingerprintLaunchArgs(ok.fingerprint), [WEBGL_DISABLE_ARG]);
});

test('M21 geolocation incoherent storage is rejected before launch', () => {
  assert.throws(
    () => validateAdvancedSettings({ geolocation: { permission: 'deny', latitude: 1, longitude: 2 } }),
    /coordinates require/,
  );
});

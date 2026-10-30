import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan } from '../server/advanced-launch.js';
import { fingerprintLaunchArgs, privateNetworkWeakening, WEBGL_DISABLE_ARG } from '../server/fingerprint-settings.js';
import { MANIFEST } from '../server/chromium.js';

test('M28–M30 stock-supported launch plan denies local-fonts and media when restricted', () => {
  const settings = validateAdvancedSettings({
    fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' },
    preferences: { permissions: { camera: 'default', microphone: 'default' } },
  });
  const plan = advancedLaunchPlan(settings, { version: MANIFEST.browserVersion, headless: false });
  assert.ok(fingerprintLaunchArgs(settings.fingerprint).includes(WEBGL_DISABLE_ARG));
  assert.equal(plan.permissions?.['local-fonts'], 'denied');
  assert.equal(plan.permissions?.camera, 'denied');
  assert.equal(plan.permissions?.microphone, 'denied');
  assert.throws(
    () => validateAdvancedSettings({
      fingerprint: { mediaDevices: 'restricted' },
      preferences: { permissions: { camera: 'allow' } },
    }),
    err => err.code === 'INVALID_ADVANCED_SETTINGS',
  );
  const joined = plan.args.join(' ');
  assert.equal(privateNetworkWeakening(joined).features.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADVANCED_SETTINGS, normalizeAdvancedSettings, validateAdvancedSettings } from '../server/advanced-settings.js';
import { fingerprintLaunchArgs, privateNetworkWeakening, validateFingerprint, verifyFingerprintLaunchArgs, WEBGL_DISABLE_ARG } from '../server/fingerprint-settings.js';

test('fingerprint defaults are real or browser-default and round-trip in advanced settings', () => {
  const settings = validateAdvancedSettings({});
  assert.deepEqual(settings.fingerprint, DEFAULT_ADVANCED_SETTINGS.fingerprint);
  assert.equal(settings.fingerprint.webgl, 'default');
  assert.equal(settings.fingerprint.canvas, 'real');
  assert.equal(settings.fingerprint.audio, 'real');
  assert.equal(settings.fingerprint.portScan, 'real');
  assert.deepEqual(fingerprintLaunchArgs(settings.fingerprint), []);
  assert.equal(verifyFingerprintLaunchArgs([], settings.fingerprint), true);
});

test('stored profiles without a fingerprint section gain the defaults without dropping other settings', () => {
  const legacy = { userAgent: { mode: 'full' }, geolocation: DEFAULT_ADVANCED_SETTINGS.geolocation, screen: DEFAULT_ADVANCED_SETTINGS.screen, preferences: DEFAULT_ADVANCED_SETTINGS.preferences };
  const normalized = normalizeAdvancedSettings(legacy);
  assert.equal(normalized.userAgent.mode, 'full');
  assert.equal(normalized.fingerprint.webgl, 'default');
  assert.equal(normalized.preferences.restoreTabs, false);
});

test('WebGL restricted is the only graphics switch, and invented modes are rejected', () => {
  const restricted = validateAdvancedSettings({ fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' } });
  assert.deepEqual(fingerprintLaunchArgs(restricted.fingerprint), [WEBGL_DISABLE_ARG]);
  assert.equal(verifyFingerprintLaunchArgs(['--disable-webgl', '--window-size=1280,800'], restricted.fingerprint), true);
  assert.equal(verifyFingerprintLaunchArgs([], restricted.fingerprint), false);
  for (const fingerprint of [
    { webgl: 'masked' },
    { webgl: 'noise' },
    { webgl: 'custom' },
    { fonts: 'masked' },
    { mediaDevices: 'custom' },
    { canvas: 'noise' },
    { canvas: 'disabled' },
    { audio: 'noise' },
    { portScan: 'masked' },
    { portScan: 'custom' },
    { webgpu: 'restricted' },
    { navigator: { hardwareConcurrency: 4 } },
  ]) {
    assert.throws(() => validateFingerprint(fingerprint, DEFAULT_ADVANCED_SETTINGS.preferences), error => error.code === 'INVALID_ADVANCED_SETTINGS' && error.tab === 'fingerprint');
  }
});

test('M30 privateNetworkWeakening stays unavailable without a command line', () => {
  assert.deepEqual(privateNetworkWeakening(null), { availability: 'unavailable', features: [] });
  assert.deepEqual(privateNetworkWeakening('   '), { availability: 'unavailable', features: [] });
});

test('media restriction cannot be combined with allowing capture', () => {
  assert.throws(() => validateAdvancedSettings({
    fingerprint: { mediaDevices: 'restricted' },
    preferences: { permissions: { camera: 'allow' } },
  }), /cannot be Allow/);
});

// Phase 2 Device Identity: presets are declarations verified against the live browser, and only
// what this host's real engine can present is accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_PRESETS, describeHost, presetSupport, presetMatrix, validateDeviceIdentity, assertDevicePresetSupported, deviceIdentityFinding } from '../server/device-identity.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';

const WIN11 = describeHost('win32', '10.0.22631');
const WIN10 = describeHost('win32', '10.0.19045');
const LINUX = describeHost('linux', '6.8.0');
const MAC = describeHost('darwin', '24.1.0');
const supported = host => presetMatrix(host).filter(p => p.state === 'supported').map(p => p.id);

test('host detection uses the Windows build number, not the 10.0 kernel version', () => {
  assert.deepEqual([WIN11.os, WIN11.osVersion], ['windows', '11']);
  assert.deepEqual([WIN10.os, WIN10.osVersion], ['windows', '10']);
  assert.equal(describeHost('win32', '10.0.22000').osVersion, '11');
  assert.equal(describeHost('win32', 'garbage').osVersion, null);
  assert.equal(LINUX.os, 'linux');
  assert.equal(MAC.os, 'macos');
});

test('only presets the host engine can present are supported', () => {
  assert.equal(DEVICE_PRESETS.length, 10);
  assert.deepEqual(supported(WIN11), ['host', 'windows-11']);
  assert.deepEqual(supported(WIN10), ['host', 'windows-10']);
  assert.deepEqual(supported(LINUX), ['host', 'linux-desktop']);
  assert.deepEqual(supported(MAC), ['host', 'macos-imac', 'macos-macbook']);
  for (const host of [WIN11, WIN10, LINUX, MAC]) {
    for (const mobile of ['android-phone', 'android-tablet', 'iphone', 'ipad']) {
      const s = presetSupport(mobile, host);
      assert.equal(s.state, 'unsupported', mobile);
      assert.match(s.reason, /mobile browser engine|WebKit/);
    }
  }
  assert.match(presetSupport('macos-imac', WIN11).reason, /Requires a macOS computer/);
  assert.match(presetSupport('windows-10', WIN11).reason, /client hints/);
  assert.equal(presetSupport('windows-11', describeHost('win32', '')).state, 'unsupported', 'unknown Windows version is not guessed');
});

test('validation: shape in the shared validator, host support on save', () => {
  assert.deepEqual(validateDeviceIdentity(undefined), { preset: 'host' });
  assert.throws(() => validateDeviceIdentity({ preset: 'commodore-64' }), /Unknown device preset/);
  assert.throws(() => validateDeviceIdentity({ preset: 'host', userAgent: 'x' }), /Unknown deviceIdentity field/);
  assert.equal('deviceIdentity' in validateAdvancedSettings({ deviceIdentity: { preset: 'host' } }), false, 'host is stored by omission');
  assert.deepEqual(validateAdvancedSettings({ deviceIdentity: { preset: 'windows-11' } }).deviceIdentity, { preset: 'windows-11' });
  assert.equal('deviceIdentity' in validateAdvancedSettings({}), false, 'legacy profiles keep their shape');
  assert.doesNotThrow(() => assertDevicePresetSupported({ preset: 'windows-11' }, WIN11));
  assert.throws(() => assertDevicePresetSupported({ preset: 'iphone' }, WIN11), err => err.status === 400 && /WebKit/.test(err.message));
  assert.throws(() => assertDevicePresetSupported({ preset: 'windows-10' }, WIN11), err => err.status === 400);
});

const observed = (over = {}) => ({ platform: 'Win32', clientHints: { availability: 'observed', platform: 'Windows', platformVersion: '15.0.0', mobile: false }, ...over });
test('verification compares the preset with the browser and never passes without an observation', () => {
  assert.equal(deviceIdentityFinding({ preset: 'windows-11' }, WIN11, null).status, 'unavailable');
  assert.equal(deviceIdentityFinding(undefined, WIN11, observed()).status, 'pass');
  assert.equal(deviceIdentityFinding({ preset: 'windows-11' }, WIN11, observed()).status, 'pass');
  const old = deviceIdentityFinding({ preset: 'windows-11' }, WIN11, observed({ clientHints: { availability: 'observed', platform: 'Windows', platformVersion: '10.0.0', mobile: false } }));
  assert.equal(old.status, 'warning');
  assert.match(old.summary, /Windows 10/);
  assert.equal(deviceIdentityFinding(undefined, WIN11, observed({ clientHints: { availability: 'observed', platform: 'Windows', platformVersion: '15.0.0', mobile: true } })).status, 'warning');
  assert.equal(deviceIdentityFinding(undefined, WIN11, observed({ platform: 'MacIntel' })).status, 'warning');
  const moved = deviceIdentityFinding({ preset: 'windows-11' }, WIN10, observed());
  assert.equal(moved.status, 'warning', 'a profile restored onto a different OS is flagged, not passed');
  assert.equal(deviceIdentityFinding(undefined, LINUX, { platform: 'Linux x86_64', clientHints: { availability: 'observed', platform: 'Linux', mobile: false } }).status, 'pass');
  assert.equal(deviceIdentityFinding(undefined, WIN11, {}).status, 'unavailable', 'no platform values exposed');
});

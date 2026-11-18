import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADVANCED_SETTINGS, validateAdvancedSettings } from '../server/advanced-settings.js';
import { buildUserAgent } from '../server/advanced-launch.js';
import { MANIFEST } from '../server/chromium.js';

const version = MANIFEST.browserVersion;
test('defaults and partial updates keep omitted sections', () => {
  assert.equal(validateAdvancedSettings({}).userAgent.mode, 'default');
  const next = validateAdvancedSettings({ userAgent: { mode: 'full' } }, DEFAULT_ADVANCED_SETTINGS);
  assert.equal(next.userAgent.mode, 'full');
  assert.equal(next.geolocation.permission, 'default');
  assert.deepEqual(next.screen.preset, 'native');
});
test('user agent presets cannot name another Chromium version', () => {
  const full = buildUserAgent({ version, platform: 'linux', headless: false, mode: 'full' });
  const reduced = buildUserAgent({ version, platform: 'linux', headless: true, mode: 'reduced' });
  assert.match(full.userAgent, new RegExp(`Chrome/${version}`));
  assert.equal(full.metadata.fullVersion, version);
  assert.equal(full.metadata.fullVersionList.find(item => item.brand === 'Chromium').version, version);
  assert.match(reduced.userAgent, /HeadlessChrome\/\d+\.0\.0\.0/);
  assert.doesNotMatch(reduced.userAgent, new RegExp(version.replace(/\./g, '\\.')));
  assert.equal(reduced.metadata.fullVersion, version);
  assert.throws(() => buildUserAgent({ version: '99', platform: 'linux', headless: false, mode: 'full' }), /not available/);
  assert.throws(() => validateAdvancedSettings({ userAgent: { mode: 'chrome-99', value: 'Chrome/99.0.0.0' } }), error => error.code === 'INVALID_ADVANCED_SETTINGS');
});
test('geolocation, screen, and startup URLs reject incoherent values', () => {
  assert.throws(() => validateAdvancedSettings({ geolocation: { permission: 'deny', latitude: 1, longitude: 2 } }), /coordinates require/);
  assert.throws(() => validateAdvancedSettings({ geolocation: { permission: 'allow', latitude: 91, longitude: 0 } }), /latitude/);
  assert.equal(validateAdvancedSettings({ geolocation: { permission: 'allow', latitude: 37.7, longitude: -122.4, accuracy: 20 } }).geolocation.accuracy, 20);
  const preset = validateAdvancedSettings({ screen: { preset: '1280x800' } });
  assert.equal(preset.screen.width, 1280);
  assert.equal(preset.screen.viewportHeight, 800);
  assert.throws(() => validateAdvancedSettings({ screen: { preset: '1280x800', width: 100 } }), /cannot be overridden/);
  assert.throws(() => validateAdvancedSettings({ screen: { preset: 'custom', width: 800, height: 600, viewportWidth: 900, viewportHeight: 600 } }), /viewport width/);
  assert.throws(() => validateAdvancedSettings({ screen: { preset: 'custom', width: 800, height: 600, viewportWidth: 800, viewportHeight: 600, deviceScaleFactor: 7 } }), /deviceScaleFactor/);
  assert.throws(() => validateAdvancedSettings({ screen: { preset: 'native', startMaximized: true, windowX: 1, windowY: 1 } }), /startMaximized/);
  assert.throws(() => validateAdvancedSettings({ preferences: { startupUrls: ['javascript:alert(1)'] } }), /http or https/);
  assert.throws(() => validateAdvancedSettings({ preferences: { startupUrls: ['https://user:pw@example.com/'] } }), /credentials/);
  assert.deepEqual(validateAdvancedSettings({ preferences: { startupUrls: ['https://example.com/a'] } }).preferences.startupUrls, ['https://example.com/a']);
});

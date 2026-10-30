import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { FINGERPRINT_REJECTED } from '../server/fingerprint-settings.js';

test('stock fingerprint rejects canvas/audio noise and WebGL mask modes', () => {
  for (const mode of ['noise', 'masked', 'custom']) {
    assert.throws(
      () => validateAdvancedSettings({ fingerprint: { canvas: mode } }),
      err => err.code === 'INVALID_ADVANCED_SETTINGS',
    );
    assert.throws(
      () => validateAdvancedSettings({ fingerprint: { audio: mode } }),
      err => err.code === 'INVALID_ADVANCED_SETTINGS',
    );
    assert.throws(
      () => validateAdvancedSettings({ fingerprint: { webgl: mode } }),
      err => err.code === 'INVALID_ADVANCED_SETTINGS',
    );
  }
  assert.ok(FINGERPRINT_REJECTED.some(row => row[0] === 'canvas' && row[1] === 'noise'));
});

test('restricted WebGL and fonts remain valid stock controls', () => {
  const settings = validateAdvancedSettings({
    fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' },
    preferences: { permissions: { camera: 'default', microphone: 'default' } },
  });
  assert.equal(settings.fingerprint.webgl, 'restricted');
  assert.equal(settings.fingerprint.fonts, 'restricted');
});

// Protection presets: pure mapping between a preset name and the three stored switches, and the server default.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTECTION_FLAGS, presetOf, presetSettings } from '../server/protection-presets.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { spawnServer, stopServer } from './_ports.mjs';

const ALL = { canvas: true, identity: true, audioScreen: true };

test('standard turns on every protection the build has, off turns them all off', () => {
  assert.deepEqual(presetSettings('standard', ALL), { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype' });
  assert.deepEqual(presetSettings('off', ALL), { canvasReadback: 'off', hardwareIdentity: 'off', audioReadback: 'off' });
  assert.deepEqual(presetSettings('standard', { canvas: true, identity: true, audioScreen: false }), { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'off' },
    'a preset never enables a protection the build lacks, because the launcher refuses such a profile');
});

test('presetOf reads the saved switches back, relative to what the build has', () => {
  assert.equal(presetOf(presetSettings('standard', ALL), ALL), 'standard');
  assert.equal(presetOf(presetSettings('off', ALL), ALL), 'off');
  assert.equal(presetOf({ canvasReadback: 'prototype', hardwareIdentity: 'off', audioReadback: 'off' }, ALL), 'custom');
  assert.equal(presetOf({}, ALL), 'off');
  const noAudio = { canvas: true, identity: true, audioScreen: false };
  assert.equal(presetOf(presetSettings('standard', noAudio), noAudio), 'standard', 'standard means everything the build has');
  assert.equal(presetOf({ canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype' }, noAudio), 'custom', 'a stray switch the build lacks is not standard');
  assert.equal(presetOf({ canvasReadback: 'prototype' }, { canvas: false, identity: false, audioScreen: false }), 'unavailable');
});

test('preset output is accepted by the settings validator', () => {
  const settings = validateAdvancedSettings({ experimental: { ...presetSettings('standard', ALL), webglReadback: 'off' } });
  assert.equal(settings.experimental.canvasReadback, 'prototype');
  assert.equal(settings.experimental.hardwareIdentity, 'prototype');
  assert.equal(settings.experimental.audioReadback, 'prototype');
  assert.equal(PROTECTION_FLAGS.length, 3);
});

test('API: a new default profile gets Standard when AZWAH Chromium is installed; an explicit choice is kept; existing profiles are untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-presets-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'pp', PM_TEST_AZWAH_NATIVE_AVAILABLE: '1',
    AZWAH_NATIVE_CHROMIUM_CANVAS: '1', AZWAH_NATIVE_CHROMIUM_IDENTITY: '1', AZWAH_NATIVE_CHROMIUM_AUDIO_SCREEN: '1' };
  const proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer pp', 'Content-Type': 'application/json' };
  const post = (body) => fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify(body) }).then(r => r.json());
  try {
    const features = await fetch(proc.url + '/api/protection-features', { headers: auth }).then(r => r.json());
    assert.equal(features.available, true);
    assert.deepEqual([features.features.canvas, features.features.identity, features.features.audioScreen], [true, true, true]);
    const fresh = await post({ name: 'fresh' });
    assert.equal(fresh.advancedSettings.runtime, 'azwah-native');
    assert.equal(presetOf(fresh.advancedSettings.experimental, ALL), 'standard');
    const chosen = await post({ name: 'chosen', advancedSettings: { experimental: { canvasReadback: 'off', webglReadback: 'off' } } });
    assert.equal(chosen.advancedSettings.runtime, 'azwah-native');
    assert.equal(presetOf(chosen.advancedSettings.experimental, ALL), 'off', 'an explicit experimental section is kept');
    const automation = await post({ name: 'auto', automationEnabled: true });
    assert.notEqual(automation.advancedSettings.runtime, 'azwah-native');
    assert.equal(presetOf(automation.advancedSettings.experimental, ALL), 'off', 'automation profiles are not on AZWAH Chromium and get no preset');
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

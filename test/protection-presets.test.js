// Protection presets: pure mapping between a preset name and the three stored switches, and the server default.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTECTION_FLAGS, presetOf, presetSettings, strictAvailability, strictPreconditions } from '../server/protection-presets.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { spawnServer, stopServer } from './_ports.mjs';

const ALL = { canvas: true, identity: true, audioScreen: true };
const FULL = { canvas: true, identity: true, audioScreen: true, gpuFonts: true, rectsUa: true, mediaWebrtc: true };

test('standard turns on every protection the build has, off turns them all off', () => {
  assert.deepEqual(presetSettings('standard', ALL), { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype', strict: 'off' });
  assert.deepEqual(presetSettings('off', ALL), { canvasReadback: 'off', hardwareIdentity: 'off', audioReadback: 'off', strict: 'off' });
  assert.deepEqual(presetSettings('standard', { canvas: true, identity: true, audioScreen: false }), { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'off', strict: 'off' },
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

test('strict: needs every build feature; the settings carry strict only when it can be honored, and switching away clears it', () => {
  assert.deepEqual(strictAvailability(FULL), { available: true, missing: [] });
  const partial = strictAvailability({ ...FULL, mediaWebrtc: false, gpuFonts: false });
  assert.equal(partial.available, false);
  assert.deepEqual(partial.missing, ['fonts and WebGPU identity', 'media devices and WebRTC address']);
  assert.deepEqual(presetSettings('strict', FULL), { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype', strict: 'on' });
  assert.equal(presetSettings('strict', { ...FULL, mediaWebrtc: false }).strict, 'off', 'an incomplete build never gets a Strict flag it cannot honor');
  assert.equal(presetSettings('standard', FULL).strict, 'off');
  assert.equal(presetOf(presetSettings('strict', FULL), FULL), 'strict');
  assert.equal(presetOf({ ...presetSettings('standard', FULL), strict: 'on' }, FULL), 'strict');
  assert.equal(presetOf({ canvasReadback: 'prototype', strict: 'on' }, FULL), 'custom', 'strict with a protection off is not a preset');
  assert.equal(presetOf(presetSettings('off', FULL), FULL), 'off');
});

test('strict preconditions: nothing is enforced for other presets, and every broken rule is reported together', () => {
  const strictProfile = (extra = {}) => ({ advancedSettings: { runtime: 'azwah-native', experimental: presetSettings('strict', FULL) }, proxyId: 'p1', proxy: { lastTest: { status: 'ok' } }, ...extra });
  assert.deepEqual(strictPreconditions({ profile: strictProfile(), features: FULL }), []);
  assert.deepEqual(strictPreconditions({ profile: { advancedSettings: { runtime: 'azwah-native', experimental: presetSettings('standard', FULL) } }, features: FULL }), [], 'Standard has no launch rules');
  const codes = failures => failures.map(f => f.code);
  assert.deepEqual(codes(strictPreconditions({ profile: strictProfile({ proxyId: null, proxy: null }), features: FULL })), ['STRICT_REQUIRES_PROXY']);
  assert.deepEqual(codes(strictPreconditions({ profile: strictProfile(), features: { ...FULL, rectsUa: false } })), ['STRICT_BUILD_INCOMPLETE']);
  assert.deepEqual(codes(strictPreconditions({ profile: strictProfile({ proxy: { lastTest: { status: 'failed' } } }), features: FULL })), ['STRICT_PROXY_FAILED']);
  assert.deepEqual(codes(strictPreconditions({ profile: strictProfile({ advancedSettings: { runtime: 'stable-chrome', experimental: { ...presetSettings('strict', FULL) } } }), features: FULL })), ['STRICT_REQUIRES_AZWAH_CHROMIUM']);
  assert.deepEqual(codes(strictPreconditions({ profile: strictProfile({ advancedSettings: { runtime: 'azwah-native', experimental: { ...presetSettings('strict', FULL), audioReadback: 'off' } } }), features: FULL })), ['STRICT_PROTECTIONS_OFF']);
  const all = strictPreconditions({ profile: { advancedSettings: { runtime: 'stable-chrome', experimental: { strict: 'on' } }, proxy: null }, features: {} });
  assert.deepEqual(codes(all), ['STRICT_REQUIRES_AZWAH_CHROMIUM', 'STRICT_REQUIRES_PROXY', 'STRICT_BUILD_INCOMPLETE', 'STRICT_PROTECTIONS_OFF']);
  assert.ok(all.every(f => f.message.length > 20));
});

test('the settings validator accepts strict on/off, stores it only when on, and rejects anything else', () => {
  assert.equal(validateAdvancedSettings({ experimental: { strict: 'on' } }).experimental.strict, 'on');
  assert.equal('strict' in validateAdvancedSettings({ experimental: { strict: 'off' } }).experimental, false);
  assert.throws(() => validateAdvancedSettings({ experimental: { strict: 'maybe' } }), /strict must be off or on/);
});

test('launcher: a Strict profile that breaks a rule is refused before the browser is verified or started', async () => {
  const { assertStrictLaunchAllowed } = await import('../server/browser-runtime/azwah-native.js');
  const features = { canvas: true, identity: true, audioScreen: true, gpuFonts: false, rectsUa: true, mediaWebrtc: true };
  const profile = { id: 'x', advancedSettings: { runtime: 'azwah-native', experimental: { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype', strict: 'on' } }, proxy: null };
  assert.throws(() => assertStrictLaunchAllowed(profile, features), e => {
    assert.equal(e.code, 'STRICT_REQUIRES_PROXY'); assert.equal(e.status, 409);
    assert.deepEqual(e.strictFailures.map(f => f.code), ['STRICT_REQUIRES_PROXY', 'STRICT_BUILD_INCOMPLETE']);
    assert.match(e.message, /Strict protection did not allow this launch/); return true;
  });
  assert.doesNotThrow(() => assertStrictLaunchAllowed({ ...profile, advancedSettings: { ...profile.advancedSettings, experimental: { ...profile.advancedSettings.experimental, strict: 'off' } } }, features), 'only Strict profiles are checked');
  // The launcher calls it right after reading the build's features and before the binary is verified.
  const src = fs.readFileSync(new URL('../server/browser-runtime/azwah-native.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function launchAzwahNative('));
  assert.ok(body.indexOf('assertStrictLaunchAllowed(profile') > 0 && body.indexOf('assertStrictLaunchAllowed(profile') < body.indexOf('await Promise.all([verifyBinary'));
});

test('API: bulk create with Strict is refused when the build is incomplete, and creates Strict profiles when it is complete', async () => {
  const run = async (features, protection) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-strict-'));
    const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'st', PM_TEST_AZWAH_NATIVE_AVAILABLE: '1', ...features };
    const proc = await spawnServer(env);
    const h = { Authorization: 'Bearer st', 'Content-Type': 'application/json' };
    try {
      const res = await fetch(proc.url + '/api/v1/bulk/jobs', { method: 'POST', headers: h, body: JSON.stringify({ action: 'createWithProxies', protection, proxyLines: ['203.0.113.1:80'] }) });
      const body = await res.json();
      if (res.status !== 202) return { status: res.status, body };
      let job = body;
      while (job.status === 'running' || job.status === 'queued') job = await fetch(proc.url + '/api/v1/bulk/jobs/' + job.id, { headers: h }).then(r => r.json());
      return { status: 202, job, profiles: await fetch(proc.url + '/api/v1/profiles', { headers: h }).then(r => r.json()) };
    } finally { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const partial = await run({ AZWAH_NATIVE_CHROMIUM_CANVAS: '1', AZWAH_NATIVE_CHROMIUM_IDENTITY: '1' }, 'strict');
  assert.equal(partial.status, 400); assert.equal(partial.body.code, 'STRICT_BUILD_INCOMPLETE'); assert.match(partial.body.error, /lacks/);
  const full = await run({ AZWAH_NATIVE_CHROMIUM_CANVAS: '1', AZWAH_NATIVE_CHROMIUM_IDENTITY: '1', AZWAH_NATIVE_CHROMIUM_AUDIO_SCREEN: '1', AZWAH_NATIVE_CHROMIUM_GPU_FONTS: '1', AZWAH_NATIVE_CHROMIUM_RECTS_UA: '1', AZWAH_NATIVE_CHROMIUM_MEDIA_WEBRTC: '1' }, 'strict');
  assert.equal(full.status, 202);
  assert.equal(full.profiles.length, 1);
  assert.equal(full.profiles[0].advancedSettings.runtime, 'azwah-native');
  assert.equal(presetOf(full.profiles[0].advancedSettings.experimental, FULL), 'strict');
});

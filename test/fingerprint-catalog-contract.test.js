// The profile editor's fingerprint catalog must agree with the real validators and the
// consistency engine: unsupported modes are rejected, supported modes are accepted, and every
// verification row is backed by findings the engine actually emits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FINGERPRINT_CATEGORIES, verificationByCategory, categoryById } from '../server/fingerprint-catalog.js';
import { validateFingerprint } from '../server/fingerprint-settings.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { validateWebRtcSettings, WEBRTC_MODES } from '../server/webrtc-policy.js';
import { fingerprintFindings } from '../server/fingerprint-consistency.js';

const emitted = new Set([...['server/fingerprint-consistency.js', 'server/webrtc-observe.js']
  .flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/finding\('([a-z_]+)'/g)].map(m => m[1]))]);

test('the catalog covers all sixteen requested categories with unique ids', () => {
  const ids = FINGERPRINT_CATEGORIES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.sort(), ['audio', 'canvas', 'fonts', 'geolocationAccess', 'geolocationData', 'languages', 'mediaDevices', 'navigatorHardware', 'portScan', 'screen', 'timezone', 'userAgent', 'webgl', 'webglMetadata', 'webgpu', 'webrtc'].sort());
  for (const c of FINGERPRINT_CATEGORIES) {
    assert.ok(c.modes.some(m => m.state === 'supported'), `${c.id} has a selectable mode`);
    for (const m of c.modes) {
      assert.ok(['supported', 'conditional', 'unsupported'].includes(m.state), `${c.id}.${m.id}`);
      if (m.state === 'unsupported') assert.ok(m.reason && m.reason.length > 20, `${c.id}.${m.id} explains why`);
      if (m.state === 'conditional') assert.ok(m.requires, `${c.id}.${m.id} names its requirement`);
    }
  }
});

test('every verification id exists in the consistency engine and every finding has a category', () => {
  const mapped = new Set(FINGERPRINT_CATEGORIES.flatMap(c => c.verifiedBy));
  for (const id of mapped) assert.ok(emitted.has(id), `catalog references unknown finding ${id}`);
  for (const id of emitted) assert.ok(mapped.has(id), `finding ${id} is not shown in any category`);
});

const FINGERPRINT_FIELDS = { fonts: 'fonts', mediaDevices: 'mediaDevices', webgl: 'webgl', canvas: 'canvas', audio: 'audio', portScan: 'portScan' };
test('unsupported fingerprint modes are rejected and supported ones accepted by the validator', () => {
  for (const [category, field] of Object.entries(FINGERPRINT_FIELDS)) {
    for (const mode of categoryById(category).modes) {
      if (mode.state === 'unsupported') assert.throws(() => validateFingerprint({ [field]: mode.id }), err => err.status === 400, `${category}.${mode.id} must be rejected`);
      else assert.equal(validateFingerprint({ [field]: mode.id })[field], mode.id, `${category}.${mode.id} must be accepted`);
    }
  }
});

test('user agent, geolocation access and WebRTC modes match their validators', () => {
  for (const mode of categoryById('userAgent').modes) {
    const run = () => validateAdvancedSettings({ userAgent: { mode: mode.id } });
    if (mode.state === 'unsupported') assert.throws(run); else assert.equal(run().userAgent.mode, mode.id);
  }
  for (const mode of categoryById('geolocationAccess').modes) assert.equal(validateAdvancedSettings({ geolocation: { permission: mode.id } }).geolocation.permission, mode.id);
  for (const mode of categoryById('webrtc').modes.filter(m => m.state === 'unsupported')) assert.throws(() => validateWebRtcSettings({ mode: mode.id }), `webrtc ${mode.id}`);
  for (const mode of WEBRTC_MODES) assert.equal(validateWebRtcSettings({ mode }).mode, mode);
});

test('verification statuses never report pass without a passing observation', () => {
  const stopped = verificationByCategory(fingerprintFindings({ observation: null }).findings);
  assert.equal(stopped.length, FINGERPRINT_CATEGORIES.length);
  for (const row of stopped) assert.notEqual(row.status, 'pass', `${row.id} passed with no running browser`);
  const rows = Object.fromEntries(verificationByCategory([
    { id: 'canvas_noise', status: 'unsupported' }, { id: 'canvas_readback', status: 'pass' },
    { id: 'timezone', status: 'pass' }, { id: 'timezone_offset', status: 'unavailable' },
    { id: 'languages', status: 'warning' }, { id: 'locale', status: 'pass' },
    { id: 'webgl_metadata', status: 'unsupported' },
  ]).map(r => [r.id, r.status]));
  assert.equal(rows.canvas, 'pass');
  assert.equal(rows.timezone, 'partial');
  assert.equal(rows.languages, 'warning');
  assert.equal(rows.webglMetadata, 'real-only');
  assert.equal(rows.audio, 'unavailable');
});

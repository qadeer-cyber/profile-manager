import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintFindings, readPreviousObservation } from '../server/fingerprint-consistency.js';
import { DEFAULT_ADVANCED_SETTINGS } from '../server/advanced-settings.js';

const version = '156.0.8078.4';
const command = `chrome --user-data-dir=/tmp/p --disable-features=Translate,OptimizationHints ${''}`;

function baseObservation(over = {}) {
  return {
    availability: 'observed',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36',
    platform: 'Linux x86_64',
    locale: 'en-US',
    languages: ['en-US'],
    timezone: 'UTC',
    clientHints: { availability: 'observed', uaFullVersion: version, chromiumVersion: version, platform: 'Linux' },
    screen: { width: 1280, height: 800, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 },
    permissions: {
      geolocation: { availability: 'observed', state: 'prompt' },
      camera: { availability: 'observed', state: 'prompt' },
      microphone: { availability: 'observed', state: 'prompt' },
      'local-fonts': { availability: 'observed', state: 'prompt' },
    },
    geolocation: null,
    webgl: { availability: 'observed', vendor: 'Google Inc. (Google)', renderer: 'ANGLE (SwiftShader)' },
    webgpu: { availability: 'unavailable', reason: 'no_adapter', apiPresent: true },
    canvas: { availability: 'observed', sha256: 'abc' },
    audio: { availability: 'observed', sha256: 'def', sampleRate: 44100 },
    ...over,
  };
}

function byId(report, id) {
  const finding = report.findings.find(item => item.id === id);
  assert.ok(finding, id);
  return finding;
}

test('a stopped profile does not receive a pass for signals that were not observed', () => {
  const report = fingerprintFindings({
    advanced: DEFAULT_ADVANCED_SETTINGS,
    browserSettings: {},
    commandLine: null,
    chromiumVersion: version,
    hostPlatform: 'linux',
    observation: null,
  });
  for (const id of ['ua_version', 'screen', 'canvas_readback', 'webgl_restriction', 'port_scan_policy', 'restart_canvas']) {
    assert.equal(byId(report, id).status, 'unavailable', id);
  }
  assert.equal(byId(report, 'webgl_metadata').status, 'unsupported');
  assert.equal(byId(report, 'canvas_noise').status, 'unsupported');
  assert.equal(byId(report, 'navigator_custom').status, 'unsupported');
  assert.equal(report.findings.some(item => item.status === 'pass' && /undetectable|anonymous|masked proxy/i.test(item.summary)), false);
});

test('matching client hints, screen, timezone, and an absent WebRTC flag can pass', () => {
  const report = fingerprintFindings({
    advanced: { ...DEFAULT_ADVANCED_SETTINGS, screen: { ...DEFAULT_ADVANCED_SETTINGS.screen, preset: 'custom', width: 1280, height: 800, viewportWidth: 1280, viewportHeight: 800, deviceScaleFactor: null } },
    browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US'] },
    webrtc: { mode: 'browser_default' },
    observation: baseObservation(),
    commandLine: command,
    chromiumVersion: version,
    hostPlatform: 'linux',
    hostTimezone: 'UTC',
  });
  assert.equal(byId(report, 'ua_version').status, 'pass');
  assert.equal(byId(report, 'ua_client_hints').status, 'pass');
  assert.equal(byId(report, 'host_platform').status, 'pass');
  assert.equal(byId(report, 'screen').status, 'pass');
  assert.equal(byId(report, 'timezone').status, 'pass');
  assert.equal(byId(report, 'languages').status, 'pass');
  assert.equal(byId(report, 'webrtc_flag').status, 'pass');
  assert.equal(byId(report, 'webrtc_ice').status, 'unavailable');
  assert.equal(byId(report, 'webgl_metadata').status, 'unsupported');
  assert.equal(byId(report, 'port_scan_policy').status, 'pass');
  assert.match(byId(report, 'port_scan_policy').summary, /not proof/);
});

test('a mismatched version, a weakened private-network flag, and a failed WebGL restriction are not passes', () => {
  const advanced = { ...DEFAULT_ADVANCED_SETTINGS, fingerprint: { ...DEFAULT_ADVANCED_SETTINGS.fingerprint, webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' } };
  const report = fingerprintFindings({
    advanced,
    browserSettings: {},
    observation: baseObservation({
      clientHints: { availability: 'observed', uaFullVersion: '99.0.0.0', chromiumVersion: '99.0.0.0' },
      permissions: {
        geolocation: { availability: 'observed', state: 'prompt' },
        camera: { availability: 'observed', state: 'prompt' },
        microphone: { availability: 'observed', state: 'granted' },
        'local-fonts': { availability: 'observed', state: 'prompt' },
      },
    }),
    commandLine: command + ' --disable-features=PrivateNetworkAccessSendPreflights',
    chromiumVersion: version,
    hostPlatform: 'linux',
  });
  assert.equal(byId(report, 'ua_version').status, 'warning');
  assert.equal(byId(report, 'webgl_restriction').status, 'warning');
  assert.equal(byId(report, 'fonts_permission').status, 'warning');
  assert.equal(byId(report, 'media_permission').status, 'warning');
  assert.equal(byId(report, 'port_scan_policy').status, 'warning');
  assert.equal(byId(report, 'webgpu_metadata').status, 'unsupported');
});

test('WebGL restricted passes only when the flag is present and the context is gone', () => {
  const advanced = { ...DEFAULT_ADVANCED_SETTINGS, fingerprint: { ...DEFAULT_ADVANCED_SETTINGS.fingerprint, webgl: 'restricted' } };
  const report = fingerprintFindings({
    advanced,
    observation: baseObservation({ webgl: { availability: 'unavailable', reason: 'webgl_unavailable' } }),
    commandLine: command + ' --disable-webgl',
    chromiumVersion: version,
    hostPlatform: 'linux',
    previous: { canvasSha256: 'abc', audioSha256: 'def', webglRenderer: 'ANGLE (SwiftShader)' },
  });
  assert.equal(byId(report, 'webgl_restriction').status, 'pass');
  assert.equal(byId(report, 'restart_canvas').status, 'pass');
  assert.equal(byId(report, 'restart_audio').status, 'pass');
  assert.equal(byId(report, 'restart_webgl').status, 'unavailable');
});

test('a comparison body cannot carry cookies or account data', () => {
  assert.throws(() => readPreviousObservation({ previous: { canvasSha256: 'abc', cookie: 'secret' } }), error => error.code === 'INVALID_FINGERPRINT_COMPARISON');
  assert.deepEqual(readPreviousObservation({ previous: { canvasSha256: 'abc' } }), { canvasSha256: 'abc', audioSha256: null, webglRenderer: null });
});

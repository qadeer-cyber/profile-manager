// Phase A/B/C/D contracts. These lock honest limits. They do not promote PARTIAL
// rows and they do not recompute the frozen stock-feasible denominator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences } from '../server/advanced-launch.js';
import {
  assertPrivateNetworkLaunchPolicy,
  WEBGL_DISABLE_ARG,
  FONT_ACCESS_DISABLE_FEATURE,
  fingerprintLaunchArgs,
} from '../server/fingerprint-settings.js';
import { geolocationLaunchFacts, NATIVE_GEO_COORDINATE_OVERRIDE } from '../server/geolocation-launch.js';
import { classifyMediaCaptureError } from '../server/media-capture.js';
import { webglReadPixelsPrototypeInitScript, webglReadPrototypeSeed } from '../server/experimental/webgl-readpixels-prototype.js';
import { launchRuntimeMode } from '../server/browser-runtime/launch-plan.js';
import { compareEngineIdentity } from '../server/engine-identity.js';
import { assessWindowPlacement, parseXrandr } from '../server/window-placement.js';
import { canvasPrototypeInitScript, canvasPrototypeSeed, perturbRgba } from '../server/experimental/canvas-readback-prototype.js';
import { GECKO_TIMEZONE_PREF_NOTE } from '../server/firefox-gecko-prefs.js';
import { buildManagedGeckoPrefLines } from '../server/firefox-gecko-userjs.js';
import { profileConfigWarnings, normalizeProfileConfigInput } from '../server/profile-config-engine.js';
import { validateCookieRobotUrl } from '../server/cookie-robot-url.js';
import {
  HISTORICAL_MATRIX,
  STOCK_FEASIBLE_BASELINE,
  PARTIAL_REQUIREMENTS,
  CUSTOM_ENGINE,
  M42_ACCEPTANCE,
  WINDOWS_QUALIFICATION,
  advancedPrivacyScorecards,
  historicalCoverage,
  scoreHistoricalMarkdown,
} from '../server/privacy-acceptance.js';
import { MANIFEST } from '../server/chromium.js';

const matrixPath = new URL('../docs/handoff/multilogin-platform/MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md', import.meta.url);

test('historical matrix denominator 43 and row statuses stay frozen', () => {
  const scored = scoreHistoricalMarkdown(fs.readFileSync(matrixPath, 'utf8'));
  assert.equal(scored.denominator, HISTORICAL_MATRIX.denominator);
  assert.equal(scored.denominator, 43);
  assert.equal(scored.verified, 31);
  assert.equal(scored.partial, 7);
  assert.equal(scored.unsupported, 5);
  assert.equal(scored.cloudExcluded, 2);
  assert.deepEqual(scored.partialIds, [...HISTORICAL_MATRIX.partialIds]);
  assert.deepEqual(scored.unsupportedIds, [...HISTORICAL_MATRIX.unsupportedIds]);
  const coverage = historicalCoverage();
  assert.equal(coverage, (31 + 3.5) / 43);
  assert.ok(Math.abs(coverage - 0.8023255813953488) < 1e-12);
  const report = advancedPrivacyScorecards();
  assert.equal(report.A.file.denominator, 43);
  assert.equal(report.B.frozen, true);
  assert.equal(report.B.recalculatedHere, false);
  assert.equal(report.B.ownerPass, STOCK_FEASIBLE_BASELINE.ownerPass);
  assert.equal(report.B.publishedNamedPassRows, 22);
  assert.equal(report.B.ownerBlockedExcluded, 8);
  assert.equal(report.D.status, 'NOT_RUN');
  assert.equal(WINDOWS_QUALIFICATION.realTests, false);
});

test('PARTIAL rows keep engine requirements and are not relabeled', () => {
  for (const id of HISTORICAL_MATRIX.partialIds) {
    const row = PARTIAL_REQUIREMENTS[id];
    assert.equal(row.matrixStatus, 'PARTIAL', id);
    assert.ok(row.satisfied.length >= 3, id);
    assert.ok(row.engineRequired.length >= 1, id);
  }
  assert.match(PARTIAL_REQUIREMENTS.M21.engineRequired.join(' '), /outside this browser/);
  assert.match(PARTIAL_REQUIREMENTS.M28.engineRequired.join(' '), /font list/);
  assert.match(PARTIAL_REQUIREMENTS.M30.satisfied.join(' '), /refused/);
});

test('M24–M27 stay BLOCKED and M42 stays UNSUPPORTED without a bypass', () => {
  for (const row of CUSTOM_ENGINE.rows) {
    assert.equal(row.matrixStatus, 'UNSUPPORTED');
    assert.equal(row.qualification, 'BLOCKED');
    assert.equal(row.stockApiEnough, false);
    assert.equal(row.sourceChangeRequired, true);
  }
  const canvas = CUSTOM_ENGINE.rows.find(row => row.id === 'M24');
  assert.equal(canvas.prototypeQualification, 'EXPERIMENTAL_NOT_ENGINE');
  assert.equal(CUSTOM_ENGINE.rows.find(row => row.id === 'M25').prototype, null);
  assert.equal(M42_ACCEPTANCE.matrixStatus, 'UNSUPPORTED');
  assert.equal(M42_ACCEPTANCE.guarantee, 'UNSUPPORTED');
  assert.equal(M42_ACCEPTANCE.bypass, false);
  assert.throws(
    () => validateCookieRobotUrl('https://www.google.com/recaptcha/api2/demo'),
    error => error.code === 'URL_NOT_ALLOWED',
  );
});

test('M20 Firefox timezone note does not claim the unused pref is the control', () => {
  const lines = buildManagedGeckoPrefLines({
    regional: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE'] },
  });
  assert.ok(lines.some(line => line.includes(GECKO_TIMEZONE_PREF_NOTE)));
  assert.ok(lines.some(line => line.includes('intl.accept_languages')));
  assert.ok(lines.some(line => line.includes('privacy.timezone.override')));
  assert.match(GECKO_TIMEZONE_PREF_NOTE, /does not change the timezone by itself/);
});

test('M21 rejects incoherent coordinates and does not invent a position', () => {
  assert.throws(
    () => validateAdvancedSettings({ geolocation: { permission: 'deny', latitude: 1, longitude: 2 } }),
    /coordinates require/,
  );
  const allow = validateAdvancedSettings({ geolocation: { permission: 'allow' } });
  const plan = advancedLaunchPlan(allow, { version: MANIFEST.browserVersion });
  assert.equal(plan.launch.geolocation, undefined);
  const placed = advancedLaunchPlan(validateAdvancedSettings({
    geolocation: { permission: 'allow', latitude: 48.137, longitude: 11.575, accuracy: 25 },
  }), { version: MANIFEST.browserVersion });
  assert.deepEqual(placed.launch.geolocation, { latitude: 48.137, longitude: 11.575, accuracy: 25 });
});

test('M22 clamps a fully off-screen window and leaves an overlapping one', () => {
  const displays = [
    { name: 'eDP-1', x: 0, y: 0, width: 1920, height: 1080 },
    { name: 'HDMI-1', x: 1920, y: 0, width: 1920, height: 1080 },
  ];
  const off = assessWindowPlacement({ windowX: 9000, windowY: 9000, width: 1280, height: 800 }, displays);
  assert.equal(off.status, 'clamped-primary');
  assert.deepEqual({ x: off.windowX, y: off.windowY }, { x: 0, y: 0 });
  const onSecond = assessWindowPlacement({ windowX: 2000, windowY: 40, width: 1280, height: 800 }, displays);
  assert.equal(onSecond.status, 'on-display');
  assert.equal(onSecond.clamped, false);
  assert.equal(assessWindowPlacement({ windowX: 10, windowY: 10 }, null).status, 'unverified');
  const parsed = parseXrandr('eDP-1 connected primary 1920x1080+0+0\nHDMI-1 connected 1280x800+1920+0\n');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].x, 1920);
  const settings = validateAdvancedSettings({
    screen: { preset: 'custom', width: 1280, height: 800, viewportWidth: 1280, viewportHeight: 800, windowX: 9000, windowY: 20 },
  });
  const plan = advancedLaunchPlan(settings, { version: MANIFEST.browserVersion, displays });
  assert.ok(plan.args.includes('--window-position=0,20') === false);
  assert.ok(plan.args.includes('--window-position=0,0'));
  assert.ok(plan.args.includes('--window-size=1280,800'));
  assert.equal(plan.settings.screen.windowX, 9000);
});

test('M23 flags a user agent or client hint that is not this Chromium', () => {
  const version = MANIFEST.browserVersion;
  const major = `${version.split('.')[0]}.0.0.0`;
  const reduced = compareEngineIdentity({
    engineVersion: version,
    userAgent: `Mozilla/5.0 Chrome/${major} Safari/537.36`,
    clientHints: { availability: 'observed', uaFullVersion: version, chromiumVersion: version },
  });
  assert.equal(reduced.status, 'coherent');
  const lied = compareEngineIdentity({
    engineVersion: version,
    userAgent: 'Mozilla/5.0 Chrome/99.0.0.0 Safari/537.36',
    clientHints: { availability: 'observed', uaFullVersion: '99.0.0.0', chromiumVersion: '99.0.0.0' },
  });
  assert.equal(lied.status, 'inconsistent');
  assert.match(lied.issues.join(' '), new RegExp(version.replace(/\./g, '\\.')));
  const firefox = profileConfigWarnings(normalizeProfileConfigInput({
    browserEngine: 'firefox',
    advancedSettings: { userAgent: { mode: 'full' } },
  }, {}));
  assert.ok(firefox.some(item => item.code === 'FIREFOX_UA_CHROMIUM_ONLY'));
});

test('M28 and M29 persist deny content settings and M30 refuses weakening flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-privacy-prefs-'));
  try {
    const settings = validateAdvancedSettings({
      fingerprint: { fonts: 'restricted', mediaDevices: 'restricted' },
      preferences: { permissions: { camera: 'ask', microphone: 'ask' } },
    });
    assert.equal(applyAdvancedPreferences(dir, settings), true);
    const file = path.join(dir, 'Default', 'Preferences');
    const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(prefs.profile.default_content_setting_values.local_fonts, 2);
    assert.equal(prefs.profile.default_content_setting_values.media_stream_camera, 2);
    assert.equal(prefs.profile.default_content_setting_values.media_stream_mic, 2);
    assert.equal(prefs.profile.default_content_setting_values.local_network_access, 2);
    const opened = validateAdvancedSettings({
      fingerprint: { fonts: 'real', mediaDevices: 'real' },
    });
    assert.equal(applyAdvancedPreferences(dir, opened), true);
    const cleared = JSON.parse(fs.readFileSync(file, 'utf8'));
    const content = cleared.profile.default_content_setting_values || {};
    assert.equal(content.local_fonts, undefined);
    assert.equal(content.media_stream_camera, undefined);
    assert.equal(content.local_network_access, 2, 'default portScan real keeps local_network_access deny pref');
    assert.throws(
      () => assertPrivateNetworkLaunchPolicy(['--disable-features=PrivateNetworkAccessSendPreflights']),
      error => error.code === 'PRIVATE_NETWORK_POLICY',
    );
    assert.equal(assertPrivateNetworkLaunchPolicy(['--disable-webgl']).features.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M21 native spawn is BLOCKED_SPAWN for coordinate override', () => {
  assert.equal(NATIVE_GEO_COORDINATE_OVERRIDE.status, 'BLOCKED_SPAWN');
  const coords = validateAdvancedSettings({
    geolocation: { permission: 'allow', latitude: 1, longitude: 2, accuracy: 10 },
  });
  const nativeFacts = geolocationLaunchFacts({
    runtime: launchRuntimeMode({ automation: false, headless: false }),
    geolocation: coords.geolocation,
    automation: false,
  });
  assert.equal(nativeFacts.coordinateOverride, 'BLOCKED_SPAWN');
  assert.equal(nativeFacts.nativeBlocked, true);
  const autoFacts = geolocationLaunchFacts({
    runtime: launchRuntimeMode({ automation: true, headless: true }),
    geolocation: coords.geolocation,
    automation: true,
  });
  assert.equal(autoFacts.coordinateOverride, 'playwright_context');
});

test('M28 launch args disable FontAccess when fonts are restricted', () => {
  const args = fingerprintLaunchArgs({ webgl: 'default', fonts: 'restricted', mediaDevices: 'real', canvas: 'real', audio: 'real', portScan: 'real' });
  assert.ok(args.join(' ').includes(FONT_ACCESS_DISABLE_FEATURE));
});

test('M29 classifies permission denial separately from missing hardware', () => {
  assert.equal(classifyMediaCaptureError('NotAllowedError', { cameraState: 'denied', microphoneState: 'denied' }).kind, 'permission_denied');
  assert.equal(classifyMediaCaptureError('NotFoundError', { cameraState: 'denied', microphoneState: 'denied' }).kind, 'no_device');
});

test('M24 prototype is deterministic, opt-in, and does not claim a custom engine', () => {
  const seedA = canvasPrototypeSeed('11111111-1111-1111-1111-111111111111');
  const seedB = canvasPrototypeSeed('22222222-2222-2222-2222-222222222222');
  assert.equal(seedA, canvasPrototypeSeed('11111111-1111-1111-1111-111111111111'));
  assert.notEqual(seedA, seedB);
  const pixels = Buffer.alloc(64, 40);
  const once = perturbRgba(pixels, seedA);
  assert.deepEqual(perturbRgba(pixels, seedA), once);
  assert.notDeepEqual(once, pixels);
  assert.notDeepEqual(perturbRgba(pixels, seedB), once);
  const script = canvasPrototypeInitScript(seedA);
  assert.match(script, /customEngine: false/);
  assert.match(script, /captchaBypass: false/);
  assert.equal(script.includes('undetectable'), false);
  assert.throws(() => canvasPrototypeInitScript('not-a-seed'), /64 hex/);
  const enabled = validateAdvancedSettings({ experimental: { canvasReadback: 'prototype' } });
  assert.equal(enabled.experimental.canvasReadback, 'prototype');
  assert.equal(enabled.fingerprint.canvas, 'real');
  assert.throws(
    () => validateAdvancedSettings({ fingerprint: { canvas: 'noise' } }),
    /Canvas noise/,
  );
  const warnings = profileConfigWarnings(normalizeProfileConfigInput({
    advancedSettings: { experimental: { canvasReadback: 'prototype' } },
  }, {}));
  assert.ok(warnings.some(item => item.code === 'CANVAS_PROTOTYPE_NOT_ENGINE'));
});

test('M26 readPixels prototype is opt-in and does not claim a custom engine', () => {
  const seed = webglReadPrototypeSeed('33333333-3333-3333-3333-333333333333');
  const script = webglReadPixelsPrototypeInitScript(seed);
  assert.match(script, /customEngine: false/);
  const enabled = validateAdvancedSettings({ experimental: { webglReadback: 'prototype', canvasReadback: 'off' } });
  assert.equal(enabled.experimental.webglReadback, 'prototype');
  const row = CUSTOM_ENGINE.rows.find(item => item.id === 'M26');
  assert.equal(row.prototypeQualification, 'EXPERIMENTAL_NOT_ENGINE');
});

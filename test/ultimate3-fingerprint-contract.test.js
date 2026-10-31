import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateBrowserSettings } from '../server/browser-settings.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan } from '../server/advanced-launch.js';
import { applyChromiumLanguagePreferences } from '../server/regional-preferences.js';
import { assertPrivateNetworkLaunchPolicy } from '../server/fingerprint-settings.js';
import { nativeChromiumEnv } from '../server/browser-runtime/native-chromium.js';
import { firefoxProcessEnv } from '../server/browser-runtime/firefox-launch.js';
import { fingerprintFindings } from '../server/fingerprint-consistency.js';
import { MANIFEST } from '../server/chromium.js';
import {
  assessAcceptLanguage,
  assessLanguageList,
  languageListMatchesStock,
  timezoneOffsetMinutes,
} from '../server/regional-consistency.js';
import { classifyLocalNetworkProbe, probeOutcomeChanged, summarizeCausalProbe } from '../server/local-network-probe.js';
import { describeFingerprintPaths, restrictedPreferenceSnapshot } from '../server/fingerprint-path-gaps.js';
import {
  BASELINE_RELEASE,
  GROK_SCORECARD,
  ROW_CONTRACTS,
  ULTIMATE3_CONTRACT_VERSION,
  decideRelease,
  featureCompletion,
  metricsAreSeparate,
  releaseQualification,
} from '../server/ultimate3-acceptance.js';

test('timezone offsets follow Date#getTimezoneOffset for fixed instants', () => {
  assert.equal(timezoneOffsetMinutes('UTC', new Date('2026-01-15T12:00:00Z')), 0);
  assert.equal(timezoneOffsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z')), -60);
  assert.equal(timezoneOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z')), -120);
  assert.equal(timezoneOffsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z')), 240);
  assert.equal(timezoneOffsetMinutes('Asia/Tokyo', new Date('2026-10-31T00:00:00Z')), -540);
  assert.equal(timezoneOffsetMinutes('Pacific/Auckland', new Date('2026-01-15T12:00:00Z')), -780);
  assert.equal(timezoneOffsetMinutes('Pacific/Auckland', new Date('2026-07-15T12:00:00Z')), -720);
});

test('language and Accept-Language checks keep configured order', () => {
  assert.equal(assessLanguageList(['de-DE', 'en-US'], ['de-DE', 'en-US']).status, 'pass');
  assert.equal(languageListMatchesStock(['de-DE', 'en-US'], ['de-DE', 'en-US', 'en']), true);
  assert.equal(languageListMatchesStock(['de-DE', 'en-US'], ['de-DE', 'en-US', 'fr']), false);
  assert.equal(assessLanguageList(['de-DE'], ['en-US']).status, 'fail');
  assert.equal(assessAcceptLanguage('de-DE,en-US;q=0.9,en;q=0.8', ['de-DE', 'en-US']).status, 'pass');
  assert.equal(assessAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7', ['de-DE', 'en-US']).status, 'pass');
  assert.equal(assessAcceptLanguage('en-US,de-DE', ['de-DE', 'en-US']).status, 'fail');
  assert.equal(assessAcceptLanguage('de-DE,fr,en-US', ['de-DE', 'en-US']).status, 'fail');
  assert.throws(() => validateBrowserSettings({ locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['en-US'] }), /first preferred language/);
});

test('native Chromium and Firefox process env carry the profile timezone only when set', () => {
  const chromium = nativeChromiumEnv({ regional: { timezoneId: 'Asia/Tokyo' } }, { PATH: '/usr/bin', TZ: 'UTC' });
  assert.equal(chromium.TZ, 'Asia/Tokyo');
  assert.equal(chromium.PATH, '/usr/bin');
  assert.equal(nativeChromiumEnv({ regional: { timezoneId: '' } }, { TZ: 'UTC' }).TZ, 'UTC');
  const firefox = firefoxProcessEnv({ timezoneId: 'Europe/Berlin', marionettePort: 2828 }, { PATH: '/bin' });
  assert.equal(firefox.TZ, 'Europe/Berlin');
  assert.equal(firefox.MARIONETTE_PORT, '2828');
  assert.equal(firefoxProcessEnv({ timezoneId: '', marionettePort: null }, { TZ: 'UTC' }).TZ, 'UTC');
});

test('Chromium language preferences and private-network policy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-u3-prefs-'));
  try {
    assert.equal(applyChromiumLanguagePreferences(dir, { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] }), true);
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));
    assert.equal(prefs.intl.accept_languages, 'de-DE,en-US');
    assert.equal(applyChromiumLanguagePreferences(dir, { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] }), false);
    const screen = validateAdvancedSettings({
      screen: { preset: '1280x800', deviceScaleFactor: 2 },
    });
    const plan = advancedLaunchPlan(screen, { version: MANIFEST.browserVersion, headless: true });
    assert.ok(plan.args.includes('--window-size=1280,800'));
    assert.ok(plan.args.includes('--force-device-scale-factor=2'));
    assert.equal(plan.launch.viewport.width, 1280);
    assert.equal(plan.launch.deviceScaleFactor, 2);
    assert.throws(() => assertPrivateNetworkLaunchPolicy(['--disable-features=PrivateNetworkAccessSendPreflights']), /private-network/);
    assert.deepEqual(assertPrivateNetworkLaunchPolicy(plan.args).features, []);
    assert.throws(() => validateAdvancedSettings({ fingerprint: { portScan: 'masked' } }), /Masked port-scan/);
    assert.throws(() => validateAdvancedSettings({ fingerprint: { fonts: 'masked' } }), /font list/);
    assert.throws(() => validateAdvancedSettings({
      fingerprint: { mediaDevices: 'restricted' },
      preferences: { permissions: { camera: 'allow' } },
    }), /cannot be Allow/);
    assert.throws(() => validateAdvancedSettings({ userAgent: { mode: 'custom' } }), /default, reduced, or full/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('consistency grades timezone offset, Intl locale, and hidden media labels', () => {
  const offset = timezoneOffsetMinutes('Europe/Berlin');
  const report = fingerprintFindings({
    advanced: {
      fingerprint: { webgl: 'default', fonts: 'real', mediaDevices: 'restricted', canvas: 'real', audio: 'real', portScan: 'real' },
      userAgent: { mode: 'default' },
      screen: { preset: 'native', width: null, height: null, viewportWidth: null, viewportHeight: null, deviceScaleFactor: null, windowX: null, windowY: null, startMaximized: false },
      geolocation: { permission: 'default', latitude: null, longitude: null, accuracy: null },
      preferences: { startupUrls: [], restoreTabs: false, rememberLastWindow: false, permissions: { notifications: 'default', microphone: 'default', camera: 'default', clipboard: 'default', midi: 'default' } },
    },
    browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] },
    observation: {
      availability: 'observed',
      userAgent: `Mozilla/5.0 Chrome/${MANIFEST.browserVersion} Safari/537.36`,
      platform: 'Linux x86_64',
      locale: 'de-DE',
      intlLocale: 'de-DE',
      languages: ['de-DE', 'en-US'],
      timezone: 'Europe/Berlin',
      timezoneOffset: offset,
      clientHints: { availability: 'observed', uaFullVersion: MANIFEST.browserVersion, chromiumVersion: MANIFEST.browserVersion, platform: 'Linux', mobile: false, brands: ['Chromium', 'Google Chrome'] },
      screen: { width: 1280, height: 800, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 },
      permissions: {
        geolocation: { availability: 'observed', state: 'prompt' },
        camera: { availability: 'observed', state: 'denied' },
        microphone: { availability: 'observed', state: 'denied' },
        'local-fonts': { availability: 'observed', state: 'prompt' },
      },
      media: { devices: { availability: 'observed', count: 0, kinds: [], labelsAvailable: false } },
      mediaCapture: { availability: 'observed', errorName: 'NotAllowedError' },
    },
    commandLine: 'chrome',
    chromiumVersion: MANIFEST.browserVersion,
    hostPlatform: 'linux',
    hostTimezone: 'UTC',
  });
  const byId = id => report.findings.find(item => item.id === id);
  assert.equal(byId('timezone_offset').status, 'pass');
  assert.equal(byId('intl_locale').status, 'pass');
  assert.equal(byId('ua_hint_pin').status, 'pass');
  assert.equal(byId('media_enumeration').status, 'pass');
  assert.equal(byId('media_mask').status, 'unsupported');
  assert.match(byId('media_enumeration').summary, /not a substitute list/);
});

test('local-network probe classification does not treat a successful fetch as blocked', () => {
  assert.equal(classifyLocalNetworkProbe({ permissionState: 'denied', fetchOk: false, errorName: 'TypeError' }).status, 'pass');
  assert.equal(classifyLocalNetworkProbe({ permissionState: 'denied', fetchOk: true }).status, 'fail');
  assert.equal(classifyLocalNetworkProbe({ permissionState: 'prompt', fetchOk: false }).status, 'fail');
  assert.equal(probeOutcomeChanged(
    { fetchOk: true, permissionState: 'prompt' },
    { fetchOk: false, permissionState: 'denied' },
  ), true);
  assert.equal(probeOutcomeChanged(
    { fetchOk: false, permissionState: 'prompt' },
    { fetchOk: false, permissionState: 'denied' },
  ), false);
});

test('M30 deny preference is causal only when the request outcome changes', () => {
  const stock = summarizeCausalProbe([
    { space: 'local', deny: false, fetchOk: true, permissionState: 'prompt', body: 'local-ok' },
    { space: 'local', deny: true, fetchOk: true, permissionState: 'denied', body: 'local-ok' },
    { space: 'public', deny: false, fetchOk: false, permissionState: 'prompt', body: '' },
    { space: 'public', deny: true, fetchOk: false, permissionState: 'denied', body: '' },
  ]);
  assert.equal(stock.causal, false);
  assert.match(stock.note, /not the cause/);
  const caused = summarizeCausalProbe([
    { space: 'local', deny: false, fetchOk: true, permissionState: 'prompt', body: 'local-ok' },
    { space: 'local', deny: true, fetchOk: false, permissionState: 'denied', body: '' },
    { space: 'public', deny: false, fetchOk: false, permissionState: 'prompt', body: '' },
    { space: 'public', deny: true, fetchOk: false, permissionState: 'denied', body: '' },
  ]);
  assert.equal(caused.causal, true);
  assert.equal(caused.pairs.find(pair => pair.space === 'local').causal, true);
});

test('native and automation fingerprint paths do not invent coordinates, hints, fonts, or devices', () => {
  const paths = describeFingerprintPaths();
  assert.equal(paths.M21.native, 'BLOCKED_SPAWN');
  assert.equal(paths.M21.nativeCoordinateFlag, false);
  assert.equal(paths.M21.automationGeolocation.latitude, 52.52);
  assert.equal(paths.M23.nativeDebugPort, false);
  assert.equal(paths.M23.nativeClientHints, 'not_attached');
  assert.equal(paths.M23.automationClientHints, 'cdp_session_retained');
  assert.match(paths.M23.nativeUserAgent, new RegExp(MANIFEST.browserVersion.replace(/\./g, '\\.')));
  assert.equal(paths.M23.nativeUserAgent.includes('--remote-debugging-port'), false);
  assert.equal(paths.M28.fontAccessDisabled, true);
  assert.equal(paths.M28.substituteFontList, false);
  assert.equal(paths.M29.camera, 'denied');
  assert.equal(paths.M29.microphone, 'denied');
  assert.equal(paths.M29.substituteDevices, false);
  const prefs = restrictedPreferenceSnapshot();
  assert.equal(prefs.local_fonts, 2);
  assert.equal(prefs.media_stream_camera, 2);
  assert.equal(prefs.media_stream_mic, 2);
  assert.equal(prefs.local_network_access, 2);
  assert.deepEqual(prefs.invented, []);
});

test('feature completion and release qualification stay separate', () => {
  const feature = featureCompletion([
    { id: 'a', result: 'pass' },
    { id: 'b', result: 'fail' },
    { id: 'c', result: 'blocked' },
    { id: 'd', result: 'not_run' },
  ]);
  const release = releaseQualification(BASELINE_RELEASE);
  assert.equal(feature.denominator, 2);
  assert.equal(feature.percent, 50);
  assert.equal(feature.blocked, 1);
  assert.equal(release.denominator, 43);
  assert.equal(release.verified, 18);
  assert.equal(release.partial, 20);
  assert.equal(release.percent, 65.1);
  const current = releaseQualification({ verified: 20, partial: 18 });
  assert.equal(current.percent, 67.4);
  assert.notEqual(current.percent, release.percent);
  assert.equal(metricsAreSeparate(feature, release), true);
  assert.notEqual(feature.percent, release.percent);
  assert.notEqual(GROK_SCORECARD.percent, release.percent);
  assert.notEqual(GROK_SCORECARD.percent, current.percent);
  assert.equal(GROK_SCORECARD.mixWithRelease, false);
  assert.equal(ULTIMATE3_CONTRACT_VERSION, '1.0.0');
  const blocked = decideRelease('M21', {
    'm21-allow-coordinates': 'pass',
    'm21-deny': 'pass',
    'm21-persist-restart': 'pass',
    'm21-isolation': 'pass',
    'm21-native-coordinates': 'blocked',
  });
  assert.equal(blocked.status, 'PARTIAL');
  assert.deepEqual(blocked.missing, ['m21-native-coordinates']);
  const promoted = decideRelease('M20', Object.fromEntries(ROW_CONTRACTS.M20.releaseGates.map(id => [id, 'pass'])));
  assert.equal(promoted.status, 'VERIFIED');
  assert.equal(promoted.missing.length, 0);
});

test('acceptance contract v1 names every release gate', () => {
  const markdown = fs.readFileSync(new URL('../docs/handoff/ultimate3/ACCEPTANCE_M20_M30_V1.md', import.meta.url), 'utf8');
  assert.match(markdown, /1\.0\.0/);
  assert.match(markdown, /feature-completion/i);
  assert.match(markdown, /release-qualification/i);
  assert.match(markdown, /80\.2/);
  for (const [id, contract] of Object.entries(ROW_CONTRACTS)) {
    assert.match(markdown, new RegExp(id));
    for (const gate of contract.releaseGates) assert.ok(markdown.includes(gate), gate);
    for (const remainder of contract.remainders) assert.ok(markdown.includes(remainder.id), remainder.id);
  }
});

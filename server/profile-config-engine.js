// Coordinated typed profile configuration (validation, warnings, schema export).
import { validateBrowserSettings, DEFAULT_BROWSER_SETTINGS } from './browser-settings.js';
import { validateWebRtcSettings, DEFAULT_WEBRTC_SETTINGS } from './webrtc-policy.js';
import { validateAdvancedSettings, DEFAULT_ADVANCED_SETTINGS } from './advanced-settings.js';
import { privacyEngineReport } from './privacy-engine-report.js';

export const BROWSER_ENGINES = Object.freeze(['chromium', 'firefox']);
export const CONFIG_SCHEMA_VERSION = 2;

const invalid = (message, code = 'INVALID_PROFILE_CONFIG') => Object.assign(new Error(message), { status: 400, code });

export function validateBrowserEngine(value, previous = 'chromium') {
  const v = value === undefined ? previous : value;
  if (!BROWSER_ENGINES.includes(v)) throw invalid('browserEngine must be chromium or firefox');
  return v;
}

export function normalizeProfileConfigInput(body = {}, previous = {}) {
  return {
    browserEngine: validateBrowserEngine(body.browserEngine, previous.browserEngine || 'chromium'),
    browserSettings: validateBrowserSettings(body.browserSettings ?? previous.browserSettings ?? DEFAULT_BROWSER_SETTINGS, previous.browserSettings),
    webrtcSettings: validateWebRtcSettings(body.webrtcSettings ?? previous.webrtcSettings ?? DEFAULT_WEBRTC_SETTINGS, previous.webrtcSettings),
    advancedSettings: validateAdvancedSettings(body.advancedSettings ?? previous.advancedSettings ?? DEFAULT_ADVANCED_SETTINGS, previous.advancedSettings),
  };
}

export function profileConfigWarnings(config) {
  const warnings = [];
  if (config.browserEngine === 'firefox') {
    warnings.push({ code: 'FIREFOX_EXTENSIONS_UNSUPPORTED', message: 'Chromium extension assignments are not loaded on the Firefox engine path.' });
    warnings.push({ code: 'FIREFOX_CHROMIUM_FLAGS_IGNORED', message: 'Chromium-only launch flags (WebGL disable, force-DPR) are not applied to Firefox.' });
    warnings.push({ code: 'FIREFOX_COOKIES_API_CHROMIUM_STORE', message: 'Stopped-profile cookie import/export uses the Chromium cookie database only; Gecko cookies are not exposed by the cookies API.' });
    if (config.webrtcSettings?.mode && config.webrtcSettings.mode !== 'browser_default') {
      warnings.push({ code: 'FIREFOX_WEBRTC_GECKO_PREFS', message: 'WebRTC policy is mapped to stock Firefox ICE prefs (user.js), not Chromium --force-webrtc-ip-handling-policy.' });
    }
  }
  const fp = config.advancedSettings?.fingerprint || {};
  if (fp.canvas === 'noise' || fp.audio === 'noise') {
    warnings.push({ code: 'UNSUPPORTED_FINGERPRINT_NOISE', message: 'Canvas/audio noise is not implemented on stock browsers; setting is stored but has no effect.' });
  }
  if (config.advancedSettings?.userAgent?.mode === 'custom') {
    warnings.push({ code: 'UNSUPPORTED_CUSTOM_UA', message: 'Free-form user-agent strings are rejected; use reduced/full presets.' });
  }
  return warnings;
}

export function buildProfileConfigDocument(profile) {
  const config = normalizeProfileConfigInput({
    browserEngine: profile.browserEngine,
    browserSettings: profile.browserSettings,
    webrtcSettings: profile.webrtcSettings,
    advancedSettings: profile.advancedSettings,
  }, profile);
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    profileId: profile.id,
    config,
    warnings: profileConfigWarnings(config),
    privacyEngineSummary: privacyEngineReport({ platform: process.platform }).categories?.length ? 'see GET /api/privacy-engine' : null,
  };
}

export function profileConfigJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ProfileManagerProfileConfigV2',
    schemaVersion: CONFIG_SCHEMA_VERSION,
    type: 'object',
    required: ['browserEngine', 'browserSettings', 'webrtcSettings', 'advancedSettings'],
    properties: {
      browserEngine: { type: 'string', enum: [...BROWSER_ENGINES] },
      browserSettings: { type: 'object' },
      webrtcSettings: { type: 'object' },
      advancedSettings: { type: 'object' },
    },
    additionalProperties: false,
  };
}

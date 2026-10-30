// Per-profile advanced browser settings. Values are either applied through a
// Chromium feature that exists (user agent, geolocation, window, content
// settings, fingerprint restrictions) or rejected. Nothing here claims a
// different Chromium version or a substitute GPU, font list, or device.
import { DEFAULT_FINGERPRINT, validateFingerprint } from './fingerprint-settings.js';
export const SCREEN_PRESETS = Object.freeze({
  '1280x800': Object.freeze({ width: 1280, height: 800 }),
  '1366x768': Object.freeze({ width: 1366, height: 768 }),
  '1440x900': Object.freeze({ width: 1440, height: 900 }),
  '1920x1080': Object.freeze({ width: 1920, height: 1080 }),
});
export const UA_MODES = Object.freeze(['default', 'reduced', 'full']);
export const PERMISSION_STATES = Object.freeze(['default', 'ask', 'allow', 'deny']);
export const PERMISSION_KEYS = Object.freeze(['notifications', 'microphone', 'camera', 'clipboard', 'midi']);
export const GEO_STATES = PERMISSION_STATES;
const SCALE = new Set([1, 1.25, 1.5, 2, 3]);

export const DEFAULT_ADVANCED_SETTINGS = Object.freeze({
  userAgent: Object.freeze({ mode: 'default' }),
  geolocation: Object.freeze({ permission: 'default', latitude: null, longitude: null, accuracy: null }),
  screen: Object.freeze({
    preset: 'native', width: null, height: null, viewportWidth: null, viewportHeight: null,
    deviceScaleFactor: null, windowX: null, windowY: null, startMaximized: false,
  }),
  preferences: Object.freeze({
    startupUrls: Object.freeze([]),
    restoreTabs: false,
    rememberLastWindow: false,
    permissions: Object.freeze({ notifications: 'default', microphone: 'default', camera: 'default', clipboard: 'default', midi: 'default' }),
  }),
  fingerprint: DEFAULT_FINGERPRINT,
});

const invalid = (message, tab = 'identity') => {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_ADVANCED_SETTINGS', tab });
};
const clone = value => structuredClone(value);
const keysOf = value => Object.keys(value).filter(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype');

function section(value, allowed, tab) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('advancedSettings section must be an object', tab);
  if (keysOf(value).some(key => !allowed.includes(key))) invalid('Unknown advancedSettings field', tab);
  return value;
}
function nullableNumber(value, tab, label) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) invalid(`${label} must be a finite number`, tab);
  return n;
}
function integerIn(value, min, max, tab, label) {
  const n = nullableNumber(value, tab, label);
  if (n == null) return null;
  if (!Number.isInteger(n) || n < min || n > max) invalid(`${label} must be an integer from ${min} to ${max}`, tab);
  return n;
}

function validateUserAgent(value) {
  const input = section(value, ['mode'], 'identity');
  if (!UA_MODES.includes(input.mode)) invalid('userAgent.mode must be default, reduced, or full', 'identity');
  return { mode: input.mode };
}
function validateGeolocation(value) {
  const input = section(value, ['permission', 'latitude', 'longitude', 'accuracy'], 'location');
  const permission = input.permission ?? 'default';
  if (!GEO_STATES.includes(permission)) invalid('geolocation.permission must be default, ask, allow, or deny', 'location');
  const latitude = nullableNumber(input.latitude, 'location', 'latitude');
  const longitude = nullableNumber(input.longitude, 'location', 'longitude');
  const accuracy = nullableNumber(input.accuracy, 'location', 'accuracy');
  if ((latitude == null) !== (longitude == null)) invalid('latitude and longitude must be set together', 'location');
  if (latitude != null && (latitude < -90 || latitude > 90)) invalid('latitude must be between -90 and 90', 'location');
  if (longitude != null && (longitude < -180 || longitude > 180)) invalid('longitude must be between -180 and 180', 'location');
  if (accuracy != null && !(accuracy >= 1 && accuracy <= 100000)) invalid('accuracy must be between 1 and 100000 meters', 'location');
  if (permission !== 'allow' && (latitude != null || accuracy != null)) invalid('coordinates require geolocation permission allow', 'location');
  return { permission, latitude, longitude, accuracy };
}
function validateScreen(value) {
  const input = section(value, ['preset', 'width', 'height', 'viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'windowX', 'windowY', 'startMaximized'], 'window');
  const preset = input.preset ?? 'native';
  if (preset !== 'native' && preset !== 'custom' && !SCREEN_PRESETS[preset]) invalid('Unknown screen preset', 'window');
  if ('startMaximized' in input && typeof input.startMaximized !== 'boolean') invalid('startMaximized must be a boolean', 'window');
  const startMaximized = !!input.startMaximized;
  const known = SCREEN_PRESETS[preset];
  if (known) {
    for (const [key, expected] of [['width', known.width], ['height', known.height], ['viewportWidth', known.width], ['viewportHeight', known.height]]) {
      if (input[key] != null && input[key] !== '' && Number(input[key]) !== expected) invalid('preset dimensions cannot be overridden', 'window');
    }
  }
  let width = integerIn(input.width, 320, 7680, 'window', 'width');
  let height = integerIn(input.height, 240, 4320, 'window', 'height');
  let viewportWidth = integerIn(input.viewportWidth, 320, 7680, 'window', 'viewportWidth');
  let viewportHeight = integerIn(input.viewportHeight, 240, 4320, 'window', 'viewportHeight');
  if (known) {
    if (width != null && width !== known.width) invalid('preset dimensions cannot be overridden', 'window');
    if (height != null && height !== known.height) invalid('preset dimensions cannot be overridden', 'window');
    if (viewportWidth != null && viewportWidth !== known.width) invalid('preset viewport cannot be overridden', 'window');
    if (viewportHeight != null && viewportHeight !== known.height) invalid('preset viewport cannot be overridden', 'window');
    width = known.width; height = known.height; viewportWidth = known.width; viewportHeight = known.height;
  }
  if (preset === 'native' && (width != null || height != null || viewportWidth != null || viewportHeight != null)) invalid('native screen does not take dimensions; choose custom', 'window');
  if (preset === 'custom' && (width == null || height == null || viewportWidth == null || viewportHeight == null)) invalid('custom screen requires width, height, and viewport', 'window');
  if (viewportWidth != null && width != null && viewportWidth > width) invalid('viewport width cannot exceed screen width', 'window');
  if (viewportHeight != null && height != null && viewportHeight > height) invalid('viewport height cannot exceed screen height', 'window');
  let deviceScaleFactor = nullableNumber(input.deviceScaleFactor, 'window', 'deviceScaleFactor');
  if (deviceScaleFactor != null && !SCALE.has(deviceScaleFactor)) invalid('deviceScaleFactor must be 1, 1.25, 1.5, 2, or 3', 'window');
  if (deviceScaleFactor != null && viewportWidth == null) invalid('deviceScaleFactor requires a viewport', 'window');
  const windowX = integerIn(input.windowX, 0, 10000, 'window', 'windowX');
  const windowY = integerIn(input.windowY, 0, 10000, 'window', 'windowY');
  if ((windowX == null) !== (windowY == null)) invalid('window position requires both windowX and windowY', 'window');
  if (startMaximized && windowX != null) invalid('startMaximized cannot be combined with a window position', 'window');
  return { preset, width, height, viewportWidth, viewportHeight, deviceScaleFactor, windowX, windowY, startMaximized };
}
function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) invalid('startup URL is invalid', 'preferences');
  let url;
  try { url = new URL(value); } catch { invalid('startup URL must be an http or https URL', 'preferences'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') invalid('startup URL must be an http or https URL', 'preferences');
  if (url.username || url.password) invalid('startup URL cannot include credentials', 'preferences');
  return url.href;
}
function validatePreferences(value, previous) {
  const input = section(value, ['startupUrls', 'restoreTabs', 'rememberLastWindow', 'permissions'], 'preferences');
  const out = clone(previous);
  if ('restoreTabs' in input) {
    if (typeof input.restoreTabs !== 'boolean') invalid('restoreTabs must be a boolean', 'preferences');
    out.restoreTabs = input.restoreTabs;
  }
  if (typeof out.restoreTabs !== 'boolean') out.restoreTabs = false;
  if ('rememberLastWindow' in input) {
    if (typeof input.rememberLastWindow !== 'boolean') invalid('rememberLastWindow must be a boolean', 'preferences');
    out.rememberLastWindow = input.rememberLastWindow;
  }
  if (typeof out.rememberLastWindow !== 'boolean') out.rememberLastWindow = false;
  if ('startupUrls' in input) {
    if (!Array.isArray(input.startupUrls) || input.startupUrls.length > 8) invalid('startupUrls must contain at most 8 URLs', 'preferences');
    const urls = input.startupUrls.map(validateUrl);
    if (new Set(urls).size !== urls.length) invalid('startupUrls must not contain duplicates', 'preferences');
    out.startupUrls = urls;
  }
  if ('permissions' in input) {
    const permissions = section(input.permissions, PERMISSION_KEYS, 'preferences');
    for (const key of keysOf(permissions)) {
      if (!PERMISSION_STATES.includes(permissions[key])) invalid(`${key} permission must be default, ask, allow, or deny`, 'preferences');
      out.permissions[key] = permissions[key];
    }
  }
  return out;
}

function finishAdvanced(settings) {
  const out = clone(settings);
  out.fingerprint = validateFingerprint(out.fingerprint || DEFAULT_FINGERPRINT, out.preferences);
  return out;
}

export function validateAdvancedSettings(value, previous = DEFAULT_ADVANCED_SETTINGS) {
  const base = previous && typeof previous === 'object' ? previous : DEFAULT_ADVANCED_SETTINGS;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) invalid('advancedSettings must be an object');
  if (!keysOf(value).length) return finishAdvanced(base);
  if (keysOf(value).some(key => !['userAgent', 'geolocation', 'screen', 'preferences', 'fingerprint'].includes(key))) invalid('Unknown advancedSettings field');
  const out = clone(base);
  if ('userAgent' in value) out.userAgent = validateUserAgent(value.userAgent);
  if ('geolocation' in value) out.geolocation = validateGeolocation(value.geolocation);
  if ('screen' in value) out.screen = validateScreen(value.screen);
  if ('preferences' in value) out.preferences = validatePreferences(value.preferences, out.preferences);
  if ('fingerprint' in value) out.fingerprint = value.fingerprint;
  return finishAdvanced(out);
}

export function normalizeAdvancedSettings(value) {
  try {
    return validateAdvancedSettings(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  } catch {
    return clone(DEFAULT_ADVANCED_SETTINGS);
  }
}

export function startupUrlsForLaunch(settings, explicitUrl) {
  const advanced = validateAdvancedSettings(settings || {});
  if (explicitUrl) return [explicitUrl];
  return [...advanced.preferences.startupUrls];
}

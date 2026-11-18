// What stock Chromium applies on native manual spawn versus the Playwright
// automation launch. This does not add font lists, device names, or a native
// geolocation coordinate flag.
import { validateAdvancedSettings } from './advanced-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences } from './advanced-launch.js';
import { assertNativeLaunchArgs } from './browser-runtime/native-chromium.js';
import { MANIFEST } from './chromium.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SAMPLE = {
  userAgent: { mode: 'full' },
  geolocation: { permission: 'allow', latitude: 52.52, longitude: 13.405, accuracy: 30 },
  screen: { preset: '1280x800', deviceScaleFactor: 2 },
  fingerprint: { fonts: 'restricted', mediaDevices: 'restricted', portScan: 'real' },
};

const INVENTED_KEYS = ['font_list', 'device_labels', 'pm_fonts', 'pm_devices', 'substitute_fonts', 'substitute_devices'];

export function inventedFingerprintKeys(prefs) {
  const found = [];
  const walk = (value, key) => {
    if (INVENTED_KEYS.includes(key)) found.push(key);
    if (!value || typeof value !== 'object') return;
    for (const [child, next] of Object.entries(value)) walk(next, child);
  };
  walk(prefs, '');
  return found;
}

export function describeFingerprintPaths({ version = MANIFEST.browserVersion } = {}) {
  const advanced = validateAdvancedSettings(SAMPLE);
  const nativePlan = advancedLaunchPlan(advanced, { headless: false, version });
  const automationPlan = advancedLaunchPlan(advanced, { headless: true, version });
  const nativeArgs = [...nativePlan.args];
  if (nativePlan.launch.userAgent) nativeArgs.push(`--user-agent=${nativePlan.launch.userAgent}`);
  assertNativeLaunchArgs(nativeArgs);
  const automationArgs = [...automationPlan.args];
  if (automationPlan.launch.userAgent) automationArgs.push(`--user-agent=${automationPlan.launch.userAgent}`);
  return {
    M21: {
      native: 'BLOCKED_SPAWN',
      nativeCoordinateFlag: nativeArgs.some(arg => /latitude|geolocation/i.test(arg)),
      automationGeolocation: automationPlan.launch.geolocation || null,
      note: 'Playwright geolocation is applied only on the automation launch. Native manual spawn has no coordinate argument and no debugging port.',
    },
    M23: {
      nativeUserAgent: nativeArgs.find(arg => arg.startsWith('--user-agent=')) || '',
      nativeDebugPort: nativeArgs.some(arg => arg.includes('--remote-debugging-port')),
      nativeClientHints: 'not_attached',
      automationClientHints: 'cdp_session_retained',
      note: 'Client-hint metadata is applied by a CDP session kept open on the automation path. Native manual launch can pass --user-agent and does not attach that session.',
    },
    M28: {
      fontAccessDisabled: nativeArgs.some(arg => arg.includes('FontAccess')) && automationArgs.some(arg => arg.includes('FontAccess')),
      substituteFontList: false,
      note: 'Restricted disables FontAccess. No substitute font list is written.',
    },
    M29: {
      camera: automationPlan.permissions.camera || null,
      microphone: automationPlan.permissions.microphone || null,
      substituteDevices: false,
      note: 'Restricted denies camera and microphone. Device names are not invented.',
    },
  };
}

export function restrictedPreferenceSnapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-path-gap-'));
  try {
    const settings = validateAdvancedSettings(SAMPLE);
    applyAdvancedPreferences(dir, settings);
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));
    const values = prefs.profile?.default_content_setting_values || {};
    return {
      local_fonts: values.local_fonts ?? null,
      media_stream_camera: values.media_stream_camera ?? null,
      media_stream_mic: values.media_stream_mic ?? null,
      local_network_access: values.local_network_access ?? null,
      invented: inventedFingerprintKeys(prefs),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

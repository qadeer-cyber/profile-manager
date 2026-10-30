// Turn validated advanced settings into Chromium launch options, command-line
// arguments, and preference edits. User-agent strings are derived from the
// installed Chromium version and the host platform. Headless launches keep the
// HeadlessChrome token. Client hints always carry that same full version.
import fs from 'fs';
import path from 'path';
import { validateAdvancedSettings } from './advanced-settings.js';
import { fingerprintLaunchArgs } from './fingerprint-settings.js';
import { assessWindowPlacement } from './window-placement.js';

const PLATFORMS = {
  linux: { token: 'X11; Linux x86_64', hint: 'Linux', navigatorPlatform: 'Linux x86_64' },
  win32: { token: 'Windows NT 10.0; Win64; x64', hint: 'Windows', navigatorPlatform: 'Win32' },
  darwin: { token: 'Macintosh; Intel Mac OS X 10_15_7', hint: 'macOS', navigatorPlatform: 'MacIntel' },
};
const CONTENT_KEYS = {
  notifications: 'notifications',
  microphone: 'media_stream_mic',
  camera: 'media_stream_camera',
  clipboard: 'clipboard',
  midi: 'midi_sysex',
  geolocation: 'geolocation',
  'local-fonts': 'local_fonts',
  'local-network-access': 'local_network_access',
};
const CONTENT_VALUES = { allow: 1, deny: 2, ask: 3 };
const CDP_SETTING = { allow: 'granted', deny: 'denied', ask: 'prompt' };
const CDP_PERMISSIONS = ['geolocation', 'notifications', 'camera', 'microphone', 'midi'];

const fail = (message, code = 'INVALID_ADVANCED_SETTINGS') => Object.assign(new Error(message), { status: 400, code });

export function buildUserAgent({ version, platform, headless, mode }) {
  if (mode !== 'reduced' && mode !== 'full') return null;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version || '')) throw fail('Chromium version is not available, so a user-agent preset cannot be applied', 'UA_VERSION_UNAVAILABLE');
  const host = PLATFORMS[platform];
  if (!host) throw fail('This operating system has no coherent Chromium user-agent preset', 'UA_UNSUPPORTED_PLATFORM');
  const major = version.split('.')[0];
  const productVersion = mode === 'full' ? version : `${major}.0.0.0`;
  const product = headless ? 'HeadlessChrome' : 'Chrome';
  const hintProduct = headless ? 'HeadlessChrome' : 'Google Chrome';
  const userAgent = `Mozilla/5.0 (${host.token}) AppleWebKit/537.36 (KHTML, like Gecko) ${product}/${productVersion} Safari/537.36`;
  if (!userAgent.includes(`${product}/${productVersion}`)) throw fail('Refusing a user agent that does not match the installed Chromium');
  const metadata = {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: hintProduct, version: major },
      { brand: 'Not.A/Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version },
      { brand: hintProduct, version },
      { brand: 'Not.A/Brand', version: '24.0.0.0' },
    ],
    fullVersion: version,
    platform: host.hint,
    platformVersion: '',
    architecture: 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  };
  if (metadata.fullVersion !== version || metadata.fullVersionList.some(item => (item.brand === 'Chromium' || item.brand === hintProduct) && item.version !== version)) {
    throw fail('Refusing client hints that do not match the installed Chromium');
  }
  return { userAgent, metadata, navigatorPlatform: host.navigatorPlatform, version, mode, headless: !!headless };
}

export function advancedLaunchPlan(settings, { headless = false, version = null, platform = process.platform, displays = null } = {}) {
  const advanced = validateAdvancedSettings(settings || {});
  const userAgent = advanced.userAgent.mode === 'default' ? null : buildUserAgent({ version, platform, headless: !!headless, mode: advanced.userAgent.mode });
  const launch = {};
  const args = [];
  if (userAgent) launch.userAgent = userAgent.userAgent;
  const screen = advanced.screen;
  if (screen.viewportWidth != null && screen.viewportHeight != null) launch.viewport = { width: screen.viewportWidth, height: screen.viewportHeight };
  if (screen.width != null && screen.height != null) launch.screen = { width: screen.width, height: screen.height };
  if (screen.deviceScaleFactor != null) {
    launch.deviceScaleFactor = screen.deviceScaleFactor;
    args.push(`--force-device-scale-factor=${screen.deviceScaleFactor}`);
  }
  const placement = assessWindowPlacement(screen, displays);
  if (screen.startMaximized) args.push('--start-maximized');
  else if (screen.width != null && screen.height != null) args.push(`--window-size=${screen.width},${screen.height}`);
  if (!screen.startMaximized && placement.windowX != null && placement.windowY != null) {
    args.push(`--window-position=${placement.windowX},${placement.windowY}`);
  }
  const geo = advanced.geolocation;
  if (geo.permission === 'allow' && geo.latitude != null && geo.longitude != null) {
    launch.geolocation = { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy ?? 100 };
  }
  const permissions = {};
  if (geo.permission !== 'default') permissions.geolocation = CDP_SETTING[geo.permission];
  for (const key of CDP_PERMISSIONS) {
    if (key === 'geolocation') continue;
    const state = advanced.preferences.permissions[key];
    if (state && state !== 'default') permissions[key] = CDP_SETTING[state];
  }
  const fingerprint = advanced.fingerprint;
  if (fingerprint.fonts === 'restricted') permissions['local-fonts'] = 'denied';
  if (fingerprint.mediaDevices === 'restricted') {
    permissions.camera = 'denied';
    permissions.microphone = 'denied';
  }
  for (const flag of fingerprintLaunchArgs(fingerprint)) args.push(flag);
  return { args, launch, userAgent, startupUrls: [...advanced.preferences.startupUrls], permissions, settings: advanced, placement };
}

function preferenceFile(dir) {
  const root = path.resolve(dir);
  const prefDir = path.join(root, 'Default');
  const file = path.join(prefDir, 'Preferences');
  if (path.resolve(file) !== file || !file.startsWith(prefDir + path.sep)) {
    throw Object.assign(new Error('Refusing to write preferences outside the profile'), { status: 500, code: 'PREFERENCE_PATH' });
  }
  return { prefDir, file };
}

function contentState(settings, key) {
  if (key === 'geolocation') return settings.geolocation.permission;
  if (key === 'local-fonts') return settings.fingerprint?.fonts === 'restricted' ? 'deny' : 'default';
  if (key === 'local-network-access') {
    return settings.fingerprint?.portScan === 'real' ? 'deny' : 'default';
  }
  if ((key === 'camera' || key === 'microphone') && settings.fingerprint?.mediaDevices === 'restricted') return 'deny';
  return settings.preferences.permissions[key];
}

// Merge managed permission values into Default/Preferences. Other keys, including
// exit_type and WebRTC, are left in place. default removes only that one key.
export function applyAdvancedPreferences(dir, settings) {
  const advanced = validateAdvancedSettings(settings || {});
  const { prefDir, file } = preferenceFile(dir);
  let prefs = {};
  if (fs.existsSync(file)) {
    try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  }
  const hadProfile = prefs.profile && typeof prefs.profile === 'object' && !Array.isArray(prefs.profile);
  const profile = hadProfile ? prefs.profile : {};
  const current = profile.default_content_setting_values && typeof profile.default_content_setting_values === 'object' && !Array.isArray(profile.default_content_setting_values)
    ? profile.default_content_setting_values : {};
  const next = { ...current };
  for (const [key, prefKey] of Object.entries(CONTENT_KEYS)) {
    const state = contentState(advanced, key);
    if (!state || state === 'default') delete next[prefKey];
    else next[prefKey] = CONTENT_VALUES[state];
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  prefs.profile = profile;
  if (Object.keys(next).length) profile.default_content_setting_values = next;
  else delete profile.default_content_setting_values;
  fs.mkdirSync(prefDir, { recursive: true });
  const tmp = file + '.pm-tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs));
  fs.renameSync(tmp, file);
  return true;
}

export async function applyDocumentPermissions(page, url, permissions) {
  const entries = Object.entries(permissions || {}).filter(([, setting]) => setting);
  if (!entries.length || !url) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // Browser.setPermission is tied to the CDP session that created it. Detaching
  // that session puts the permission back, so the session is kept with the page.
  if (!page.__pmPermissionSession) page.__pmPermissionSession = await page.context().newCDPSession(page);
  const session = page.__pmPermissionSession;
  const failed = [];
  for (const [name, setting] of entries) {
    try {
      await session.send('Browser.setPermission', { origin: parsed.origin, permission: { name }, setting });
    } catch {
      failed.push(name);
    }
  }
  return failed.length === 0;
}

export async function installUserAgent(ctx, userAgent) {
  if (!userAgent) return;
  const apply = async page => {
    const session = await ctx.newCDPSession(page);
    try {
      await session.send('Emulation.setUserAgentOverride', {
        userAgent: userAgent.userAgent,
        platform: userAgent.navigatorPlatform,
        userAgentMetadata: userAgent.metadata,
      });
    } finally {
      await session.detach().catch(() => {});
    }
  };
  ctx.on('page', page => { apply(page).catch(() => {}); });
  for (const page of ctx.pages()) await apply(page);
}

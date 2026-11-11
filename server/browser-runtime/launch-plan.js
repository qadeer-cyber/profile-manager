// Shared launch plan for native Chromium vs Playwright automation adapter.
import fs from 'fs';
import net from 'net';
import { isIP } from 'node:net';
import { anonymizeProxy } from 'proxy-chain';
import { browserContextSettings, validateBrowserSettings } from '../browser-settings.js';
import { chromiumPolicyArgs, validateWebRtcSettings } from '../webrtc-policy.js';
import { verifyWebRtcLaunchArgs, applyWebRtcPreference } from '../webrtc-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences } from '../advanced-launch.js';
import { applyChromiumLanguagePreferences } from '../regional-preferences.js';
import { verifyFingerprintLaunchArgs, assertPrivateNetworkLaunchPolicy } from '../fingerprint-settings.js';
import { readHostDisplays } from '../window-placement.js';
import { executableCompatibility } from '../chromium-lifecycle.js';
import { chromiumIdentity } from '../chromium-identity.js';
import { extensionLaunchPlan } from '../extensions.js';
import { getSetting, setSetting } from '../db.js';
import { assertProfileVersion, resolveWindowsChromeStable, stableProxyNetworkArgs } from './chrome-stable.js';
import { geoIpCredentials } from '../geoip-settings.js';
import { resolveProxyLocation } from '../proxy-location.js';
import { chromiumMissingError } from '../chromium.js';
import { automationDefault, proxyLoopback, isPackaged } from '../testflags.js';

const automationEnabled = opts => !!opts.automation || automationDefault();
import { chooseLaunchUrls, readSavedTabs } from '../tab-restore.js';
import { screenFromRememberedWindow } from '../window-state.js';
import { chromium } from 'playwright';

const httpErr = (status, msg, code) => Object.assign(new Error(msg), { status, code });
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }).on('error', rej);
});

/** @returns {'native'|'playwright'} */
export function launchRuntimeMode(opts = {}, engine = 'chromium') {
  if (process.env.PM_MANUAL_LAUNCH_RUNTIME === 'playwright' && engine !== 'firefox') return 'playwright';
  const automation = automationEnabled(opts);
  const headless = !!opts.headless;
  if (engine === 'firefox') return 'native';
  return automation || headless ? 'playwright' : 'native';
}

export async function buildProfileLaunchPlan(p, opts = {}) {
  const { headless, url } = opts;
  const automation = automationEnabled(opts);
  const explicitStable = p.advancedSettings?.runtime === 'stable-chrome';
  const requireStable = explicitStable || process.env.AZWAH_STABLE_CHROME_EDITION === '1';
  if (requireStable && process.platform !== 'win32') throw httpErr(503, 'The installed Chrome Stable runtime requires Windows.', 'CHROME_STABLE_UNSUPPORTED');
  const stable = process.platform === 'win32' && (!headless || requireStable) ? await resolveWindowsChromeStable() : null;
  let runtime = launchRuntimeMode(opts, 'chromium');
  const regional = validateBrowserSettings(p.browserSettings || {});
  const policy = validateWebRtcSettings(requireStable && p.proxy ? { mode: 'disable_non_proxied_udp' } : p.webrtcSettings || {});
  const extensionPlan = extensionLaunchPlan(p.id);
  const dir = opts.userDataDir;
  if (!dir) throw httpErr(500, 'userDataDir required', 'INTERNAL');
  let locationOverride = null;
  const advanced = p.advancedSettings || {};
  const geo = advanced.geolocation || {};
  const mode = requireStable && p.proxy ? 'auto' : geo.mode ?? (p.proxy ? 'auto' : 'manual');
  if (stable) {
    const profileRoot = fs.realpathSync(dir);
    const defaultData = process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data';
    const defaultRoot = defaultData && fs.existsSync(defaultData) ? fs.realpathSync(defaultData) : defaultData;
    if (defaultRoot && (profileRoot.toLowerCase() === defaultRoot.toLowerCase() ||
      profileRoot.toLowerCase().startsWith(defaultRoot.toLowerCase() + '\\'))) {
      throw httpErr(409, 'Refusing to launch Chrome with the personal Chrome profile directory.', 'CHROME_PERSONAL_PROFILE');
    }
    assertProfileVersion(dir, stable.version);
    if (extensionPlan.args.some(arg => arg.startsWith('--load-extension'))) {
      throw httpErr(409, 'Chrome Stable does not support launching with Azwah unpacked extension assignments. Disable the assignments or install trusted extensions within this Chrome profile.', 'CHROME_STABLE_UNPACKED_EXTENSION');
    }
    if (mode === 'auto') {
      const key = 'proxy-location:' + p.id;
      const cached = getSetting(key, null);
      if (requireStable) setSetting(key, null);
      locationOverride = await resolveProxyLocation(p.proxy, { read: () => cached,
        save: requireStable ? undefined : value => setSetting(key, value), credentials: geoIpCredentials });
      regional.timezoneId = locationOverride.timezone;
      if (/^[A-Z]{2}$/.test(locationOverride.country || '') && !regional.locale && !regional.languages.length) {
        const inferred = new Intl.Locale('und-' + locationOverride.country).maximize();
        regional.locale = inferred.language + '-' + locationOverride.country;
        regional.languages = [regional.locale, inferred.language];
      }
    } else if (mode === 'system') {
      regional.timezoneId = '';
    } else if (geo.latitude != null && geo.longitude != null) {
      if (geo.accuracy == null) throw httpErr(409, 'Set a manual accuracy in meters before launching.', 'CHROME_MANUAL_ACCURACY_REQUIRED');
      locationOverride = geo;
    }
    if (requireStable || locationOverride || regional.timezoneId) runtime = 'playwright';
  }
  const contextSettings = browserContextSettings(regional);


  const cdpPort = automation ? await freePort() : null;
  const args = [];
  if (automation) {
    args.push(`--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1');
  }

  let executablePath = stable?.path || getSetting('executablePath', '') || undefined;
  if (executablePath && !stable) {
    const compat = executableCompatibility(executablePath);
    if (!compat.launchAllowed) throw httpErr(503, compat.warning, 'CHROMIUM_VERSION_MISMATCH');
  }
  if (!executablePath) {
    const miss = chromiumMissingError(!!headless);
    if (miss) throw miss;
    try { executablePath = chromium.executablePath(); } catch {}
  }


  if (regional.languages.length) {
    args.push('--accept-lang=' + regional.languages.join(','));
    args.push('--lang=' + (regional.locale || regional.languages[0]));
  }
  for (const flag of chromiumPolicyArgs(policy)) args.push(flag);
  for (const flag of extensionPlan.args) args.push(flag);
  if (!verifyWebRtcLaunchArgs(args, policy.mode)) {
    throw httpErr(500, 'Refusing to launch because the WebRTC arguments do not match the saved policy.', 'WEBRTC_LAUNCH_MISMATCH');
  }

  const identity = stable ? { version: stable.version, executableVersion: stable.version, source: 'chrome-stable', versionMismatch: false } : chromiumIdentity(executablePath && fs.existsSync(executablePath) ? executablePath : '');
  const rememberedScreen = screenFromRememberedWindow(p.id, p.advancedSettings || {});
  const mergedAdvanced = { ...(p.advancedSettings || {}) };
  const screenOverride = rememberedScreen ?? mergedAdvanced.screen;
  if (screenOverride != null) mergedAdvanced.screen = screenOverride;
  const screenInput = mergedAdvanced.screen && typeof mergedAdvanced.screen === 'object' ? mergedAdvanced.screen : {};
  const displays = !headless && screenInput.windowX != null && screenInput.windowY != null ? readHostDisplays() : null;
  const plan = advancedLaunchPlan(mergedAdvanced, { headless: !!headless, version: identity.version, platform: process.platform, displays });
  for (const flag of plan.args) args.push(flag);
  if (!verifyFingerprintLaunchArgs(args, plan.settings.fingerprint)) {
    throw httpErr(500, 'Refusing to launch because the WebGL restriction does not match the saved fingerprint settings.', 'FINGERPRINT_LAUNCH_MISMATCH');
  }
  if (plan.launch.userAgent) args.push(`--user-agent=${plan.launch.userAgent}`);
  assertPrivateNetworkLaunchPolicy(args);

  if (policy.mode !== 'browser_default') applyWebRtcPreference(dir, policy.mode);
  const preferences = stable && locationOverride && geo.permission !== 'deny'
    ? { ...advanced, geolocation: { ...geo, latitude: null, longitude: null, accuracy: null, permission: 'ask' } }
    : advanced;
  applyAdvancedPreferences(dir, preferences);
  applyChromiumLanguagePreferences(dir, regional);

  const restoreTabs = plan.settings.preferences.restoreTabs === true;
  const rememberWindow = plan.settings.preferences.rememberLastWindow === true;
  const saved = restoreTabs ? readSavedTabs(dir) : { urls: [], corrupt: false };
  const openUrls = chooseLaunchUrls({
    explicitUrl: url,
    startupUrls: plan.startupUrls,
    savedUrls: saved.urls,
  });

  let relayUrl = null;
  const proxyHost = p.proxy && isIP(p.proxy.host) === 6 ? `[${p.proxy.host}]` : p.proxy?.host;
  const proxyArg = server => `--proxy-server=${server}`;
  if (p.proxy) {
    if (requireStable) args.push(...stableProxyNetworkArgs(p.proxy.host, Boolean(p.proxy.username)));
    if (p.proxy.username) {
      const scheme = p.proxy.type === 'socks5' ? 'socks5h' : p.proxy.type;
      const up = `${scheme}://${encodeURIComponent(p.proxy.username)}:${encodeURIComponent(p.proxy.password)}@${proxyHost}:${p.proxy.port}`;
      try {
        // Let the relay bind atomically instead of releasing a probed port
        // that another concurrently launching profile can claim.
        relayUrl = await anonymizeProxy({ url: up, port: 0 });
      } catch {
        throw httpErr(503, 'Could not start the authenticated proxy relay. Check the proxy configuration and retry.', 'PROXY_RELAY_START_FAILED');
      }
      args.push(proxyArg(relayUrl));
    } else {
      args.push(proxyArg(`${p.proxy.type}://${proxyHost}:${p.proxy.port}`));
    }
    // Dev/test: PM_PROXY_LOOPBACK. Packaged manual native: always send loopback through the proxy (offline smoke).
    if (stable || proxyLoopback() || (isPackaged() && runtime === 'native')) args.push('--proxy-bypass-list=<-loopback>');
  }

  const playwrightOpts = {
    ...contextSettings,
    headless: !!headless,
    viewport: null,
    args: [...args],
    executablePath,
    timeout: 30000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
  if (plan.launch.userAgent) playwrightOpts.userAgent = plan.launch.userAgent;
  if (plan.launch.viewport) playwrightOpts.viewport = plan.launch.viewport;
  if (plan.launch.screen) playwrightOpts.screen = plan.launch.screen;
  if (plan.launch.deviceScaleFactor) playwrightOpts.deviceScaleFactor = plan.launch.deviceScaleFactor;
  if (plan.launch.geolocation) playwrightOpts.geolocation = plan.launch.geolocation;
  if (p.proxy) {
    if (relayUrl) playwrightOpts.proxy = { server: relayUrl };
    else playwrightOpts.proxy = { server: `${p.proxy.type}://${proxyHost}:${p.proxy.port}` };
  }
  if (extensionPlan.ignoreDefaultArgs.length) playwrightOpts.ignoreDefaultArgs = [...extensionPlan.ignoreDefaultArgs];
  if (stable) {
    // Use the inherited CDP pipe while retaining Chrome's ordinary security defaults.
    // Playwright's automation defaults include switches that disable security services.
    playwrightOpts.ignoreDefaultArgs = true;
    playwrightOpts.args = [...args, '--remote-debugging-pipe', `--user-data-dir=${dir}`, '--no-first-run', ...(headless ? ['--headless=new'] : []), 'about:blank'];
    playwrightOpts.chromiumSandbox = true;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(AZWAH_MAXMIND_|ELECTRON_|NODE_OPTIONS$|PM_API_TOKEN$|PM_SECRET$|PM_UI_TOKEN$)/i.test(key)));
    playwrightOpts.env = env;
    delete playwrightOpts.geolocation;
    if (locationOverride) {
      const { latitude, longitude, accuracy } = locationOverride;
      playwrightOpts.geolocation = { latitude, longitude, accuracy };
    }
    // Chrome decides geolocation permission per site. Other saved policies are unchanged.
    delete plan.permissions.geolocation;
  }

  return {
    runtime,
    stable,
    requiredStable: requireStable,
    stableLocation: locationOverride,
    locationMode: stable ? mode : null,
    automation,
    headless: !!headless,
    dir,
    executablePath,
    args,
    relayUrl,
    cdpPort,
    extensionPlan,
    plan,
    regional,
    openUrls,
    restoreTabs,
    rememberWindow,
    playwrightOpts,
    identity,
  };
}

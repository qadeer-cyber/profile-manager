// Shared launch plan for native Chromium vs Playwright automation adapter.
import fs from 'fs';
import net from 'net';
import { anonymizeProxy } from 'proxy-chain';
import { browserContextSettings, validateBrowserSettings } from '../browser-settings.js';
import { chromiumPolicyArgs, validateWebRtcSettings } from '../webrtc-policy.js';
import { verifyWebRtcLaunchArgs, applyWebRtcPreference } from '../webrtc-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences } from '../advanced-launch.js';
import { verifyFingerprintLaunchArgs } from '../fingerprint-settings.js';
import { executableCompatibility } from '../chromium-lifecycle.js';
import { chromiumIdentity } from '../chromium-identity.js';
import { extensionLaunchPlan } from '../extensions.js';
import { getSetting } from '../db.js';
import { chromiumMissingError } from '../chromium.js';
import { automationDefault, proxyLoopback } from '../testflags.js';

const automationEnabled = opts => !!opts.automation || automationDefault();
import { chooseLaunchUrls, readSavedTabs } from '../tab-restore.js';
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
  const runtime = launchRuntimeMode(opts, 'chromium');
  const regional = validateBrowserSettings(p.browserSettings || {});
  const contextSettings = browserContextSettings(regional);
  const policy = validateWebRtcSettings(p.webrtcSettings || {});
  const extensionPlan = extensionLaunchPlan(p.id);
  const dir = opts.userDataDir;
  if (!dir) throw httpErr(500, 'userDataDir required', 'INTERNAL');

  const cdpPort = automation ? await freePort() : null;
  const args = [];
  if (automation) {
    args.push(`--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1');
  }

  let executablePath = getSetting('executablePath', '') || undefined;
  if (executablePath) {
    const compat = executableCompatibility(executablePath);
    if (!compat.launchAllowed) throw httpErr(503, compat.warning, 'CHROMIUM_VERSION_MISMATCH');
  }
  if (!executablePath) {
    const miss = chromiumMissingError(!!headless);
    if (miss) throw miss;
    try { executablePath = chromium.executablePath(); } catch {}
  }

  let relayUrl = null;
  const proxyArg = server => `--proxy-server=${server}`;
  if (p.proxy) {
    if (p.proxy.username) {
      const up = `${p.proxy.type}://${encodeURIComponent(p.proxy.username)}:${encodeURIComponent(p.proxy.password)}@${p.proxy.host}:${p.proxy.port}`;
      relayUrl = await anonymizeProxy({ url: up, port: await freePort() });
      args.push(proxyArg(relayUrl));
    } else {
      args.push(proxyArg(`${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`));
    }
    if (proxyLoopback()) args.push('--proxy-bypass-list=<-loopback>');
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

  const identity = chromiumIdentity(executablePath && fs.existsSync(executablePath) ? executablePath : '');
  const plan = advancedLaunchPlan(p.advancedSettings || {}, { headless: !!headless, version: identity.version, platform: process.platform });
  for (const flag of plan.args) args.push(flag);
  if (!verifyFingerprintLaunchArgs(args, plan.settings.fingerprint)) {
    throw httpErr(500, 'Refusing to launch because the WebGL restriction does not match the saved fingerprint settings.', 'FINGERPRINT_LAUNCH_MISMATCH');
  }
  if (plan.launch.userAgent) args.push(`--user-agent=${plan.launch.userAgent}`);

  if (policy.mode !== 'browser_default') applyWebRtcPreference(dir, policy.mode);
  applyAdvancedPreferences(dir, p.advancedSettings || {});

  const restoreTabs = plan.settings.preferences.restoreTabs === true;
  const saved = restoreTabs ? readSavedTabs(dir) : { urls: [], corrupt: false };
  const openUrls = chooseLaunchUrls({
    explicitUrl: url,
    startupUrls: plan.startupUrls,
    savedUrls: saved.urls,
  });

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
    else playwrightOpts.proxy = { server: `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}` };
  }
  if (extensionPlan.ignoreDefaultArgs.length) playwrightOpts.ignoreDefaultArgs = [...extensionPlan.ignoreDefaultArgs];

  return {
    runtime,
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
    playwrightOpts,
    identity,
  };
}

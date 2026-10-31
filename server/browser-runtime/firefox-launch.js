// Firefox/Gecko manual launch (no Chromium flags, separate profile tree).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { anonymizeProxy } from 'proxy-chain';
import net from 'node:net';
import { validateBrowserSettings } from '../browser-settings.js';
import { getSetting } from '../db.js';
import { pidMatches, isAlive } from '../proc.js';
import { automationDefault } from '../testflags.js';
import { buildManagedGeckoPrefLines, writeManagedGeckoUserJs } from '../firefox-gecko-userjs.js';
import { materializeGeckoExtensions } from '../gecko-extensions.js';
import { validateAdvancedSettings, SCREEN_PRESETS } from '../advanced-settings.js';
import { screenFromRememberedWindow } from '../window-state.js';
import { geckoTimezoneEnv } from '../firefox-gecko-prefs.js';

const automationEnabled = opts => !!opts?.automation || automationDefault();

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }).on('error', rej);
});

export function geckoUserDataDir(profileId, dataDirFn) {
  return path.join(dataDirFn(profileId), 'gecko');
}

export function resolveFirefoxExecutable() {
  const configured = getSetting('firefoxExecutablePath', '') || process.env.PM_FIREFOX_EXECUTABLE || '';
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Mozilla Firefox', 'firefox.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Mozilla Firefox', 'firefox.exe'),
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  }
  for (const c of ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/Applications/Firefox.app/Contents/MacOS/firefox']) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function buildFirefoxLaunchPlan(p, { userDataDir, userDataDirFn, opts = {} } = {}) {
  const automation = automationEnabled(opts);
  const exe = resolveFirefoxExecutable();
  if (!exe) {
    throw Object.assign(new Error('Firefox is not installed. Set Settings → firefoxExecutablePath or install Firefox.'), { status: 503, code: 'FIREFOX_MISSING' });
  }
  const regional = validateBrowserSettings(p.browserSettings || {});
  const profileDir = geckoUserDataDir(p.id, userDataDirFn || (() => userDataDir));
  fs.mkdirSync(profileDir, { recursive: true });

  let relayUrl = null;
  if (p.proxy?.username) {
    const up = `${p.proxy.type}://${encodeURIComponent(p.proxy.username)}:${encodeURIComponent(p.proxy.password)}@${p.proxy.host}:${p.proxy.port}`;
    relayUrl = await anonymizeProxy({ url: up, port: await freePort() });
  }
  const marionettePort = automation ? await freePort() : null;
  const managed = buildManagedGeckoPrefLines({
    proxy: p.proxy && !p.proxy.username ? p.proxy : null,
    relayUrl,
    regional,
    webrtcSettings: p.webrtcSettings,
  });
  if (marionettePort) managed.push(`user_pref("marionette.port", ${marionettePort});`);
  writeManagedGeckoUserJs(profileDir, managed);
  materializeGeckoExtensions(profileDir, p.id);

  const rememberedScreen = screenFromRememberedWindow(p.id, p.advancedSettings || {});
  const mergedAdvanced = { ...(p.advancedSettings || {}) };
  const screenOverride = rememberedScreen ?? mergedAdvanced.screen;
  if (screenOverride != null) mergedAdvanced.screen = screenOverride;
  const advanced = validateAdvancedSettings(mergedAdvanced);
  const args = ['-no-remote', '-profile', profileDir];
  const screen = advanced.screen || {};
  if (screen.startMaximized) {
    // Firefox uses -width/-height; maximized is best-effort via large window on manual launch.
  } else if (screen.preset && screen.preset !== 'native' && SCREEN_PRESETS[screen.preset]) {
    const dim = SCREEN_PRESETS[screen.preset];
    args.push('-width', String(dim.width), '-height', String(dim.height));
  } else if (screen.width && screen.height) {
    args.push('-width', String(screen.width), '-height', String(screen.height));
  }
  if (automation) args.push('-marionette');
  if (regional.languages.length) args.push('-lang', regional.locale || regional.languages[0]);
  const openUrls = Array.isArray(opts.openUrls) ? opts.openUrls.slice(0, 20) : (opts.url ? [opts.url] : []);
  for (const u of openUrls) {
    if (typeof u === 'string' && u.trim()) args.push(u.trim());
  }

  const timezoneId = geckoTimezoneEnv(regional.timezoneId);
  return {
    runtime: 'native', engine: 'firefox', executablePath: exe, args, profileDir, relayUrl, openUrls,
    restoreTabs: !!opts.restoreTabs, automation, marionettePort, timezoneId,
  };
}

export async function discoverGeckoBrowserPid(profileDir, candidates, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const pid of candidates) {
      if (pid && await pidMatches(pid, profileDir)) return pid;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return candidates.find(p => p && isAlive(p)) ?? null;
}

export async function launchFirefoxNative(plan) {
  const env = { ...process.env };
  if (plan.marionettePort) env.MARIONETTE_PORT = String(plan.marionettePort);
  if (plan.timezoneId) env.TZ = plan.timezoneId;
  const proc = spawn(plan.executablePath, plan.args, { stdio: 'ignore', windowsHide: false, detached: false, env });
  if (!proc.pid) throw Object.assign(new Error('Failed to spawn Firefox'), { status: 500, code: 'FIREFOX_SPAWN_FAILED' });
  const browserPid = await discoverGeckoBrowserPid(plan.profileDir, [proc.pid]);
  return { proc, browserPid, spawnPid: proc.pid, argv: plan.args };
}

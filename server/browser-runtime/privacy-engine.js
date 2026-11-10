import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { geoIpCredentials } from '../geoip-settings.js';
import { resolveProxyLocation } from '../proxy-location.js';
import { db, getSetting, setSetting } from '../db.js';
import { killTree } from '../proc.js';
import { enabledChromiumExtensionPaths } from '../extensions.js';

import { isPackaged } from '../testflags.js';

export const PROXY_IDENTITY_EXIT = 24;
export const PROXY_IDENTITY_ERROR = 'Chromium could not confirm the proxy exit, timezone or coordinates, or the proxy changed. Check the proxy and restart the profile. Use a sticky session if the exit rotates per connection.';

const fail = (message, code = 'PRIVACY_ENGINE_UNAVAILABLE') => Object.assign(new Error(message), { code, status: 409 });

export async function launchPrivacyEngine(profile, dir, opts, checkCancelled) {
  if (process.platform !== 'win32') throw fail('The dedicated privacy engine is currently Windows-only.');
  if (opts.headless || opts.automation) throw fail('The dedicated engine currently supports visible interactive browsing only.');
  const executable = isPackaged()
    ? path.join(process.resourcesPath, 'privacy-engine', 'AzwahPrivacyPrototype.exe')
    : process.env.PM_PRIVACY_ENGINE_EXE;
  if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw fail('The dedicated privacy engine is not installed in this Azwah build.');
  }
  const root = path.join(dir, 'privacy-engine');
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw fail('Linked dedicated browser directories are unsupported.');
  const launch = randomUUID();
  const control = path.join(root, launch);
  const request = control + '.json';
  const ready = control + '.ready';
  const stop = control + '.stop';
  const invalidate = control + '.invalidate';
  const exited = child => child.exitCode !== null || child.signalCode !== null;
  let child, relay, autoLocation;
  const mode = profile.advancedSettings?.geolocation?.mode ?? (profile.proxy ? 'auto' : 'manual');
  const locationKey = 'proxy-location:' + profile.id;
  try {
    const geo = profile.advancedSettings?.geolocation || {};
    let timezone = mode === 'system' ? null : profile.browserSettings?.timezoneId || null;
    let location = mode === 'manual' && geo.latitude != null && geo.longitude != null
      ? { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy } : null;
    const proxy = profile.proxy;
    if (mode === 'auto') {
      const result = await resolveProxyLocation(proxy, { read: () => getSetting(locationKey, null), credentials: geoIpCredentials });
      autoLocation = result;
      timezone = result.timezone;
      location = { latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy };
    }
    let proxyRules;
    if (proxy) {
      const scheme = proxy.type === 'socks5' && proxy.username ? 'socks5h' : proxy.type;
      const credentials = proxy.username
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
      const host = isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host;
      const endpoint = `${scheme}://${host}:${proxy.port}`;
      if (credentials) relay = await anonymizeProxy({ url: endpoint.replace('://', '://' + credentials), port: 0 });
      proxyRules = relay || endpoint;
    }
    checkCancelled();
    const verify = !isPackaged() && process.env.PM_PRIVACY_ENGINE_QA === '1';
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (/^ELECTRON_|^NODE_OPTIONS$|^AZWAH_MAXMIND_|^PM_API_TOKEN$|^PM_SECRET$|^PM_UI_TOKEN$/i.test(name)) delete env[name];
    }
    delete env.AZWAH_ENGINE_QA_LOG;
    if (verify) env.AZWAH_ENGINE_QA_LOG = control + '.log';
    fs.writeFileSync(request, JSON.stringify({ version: 1, timezone, location, proxyRules, expectedProxyExit: autoLocation?.ip,
      extensions: enabledChromiumExtensionPaths(profile.id), denyGeolocation: geo.permission === 'deny', url: opts.url || null, verify }), { flag: 'wx', mode: 0o600 });
    const argv = [`--azwah-managed=${request}`, `--user-data-dir=${path.join(root, 'chromium')}`];
    child = spawn(executable, argv, { env, windowsHide: false, stdio: 'ignore' });
    let spawnError = false;
    child.on('error', () => { spawnError = true; });
    const deadline = Date.now() + 25000;
    for (;;) {
      checkCancelled();
      if (child.exitCode === PROXY_IDENTITY_EXIT) throw fail(PROXY_IDENTITY_ERROR, 'PROXY_BROWSER_IDENTITY_FAILED');
      if (spawnError || exited(child) || !child.pid) throw fail('The dedicated engine exited during startup.', 'PRIVACY_ENGINE_START_FAILED');
      if (fs.existsSync(ready)) break;
      if (Date.now() >= deadline) throw fail('The dedicated engine did not confirm readiness.', 'PRIVACY_ENGINE_START_TIMEOUT');
      await delay(100);
    }
    const proxyStillAssigned = () => {
      const current = db.prepare('SELECT profiles.proxy_id, proxies.updated_at FROM profiles LEFT JOIN proxies ON proxies.id = profiles.proxy_id WHERE profiles.id = ? AND profiles.deleted_at IS NULL').get(profile.id);
      return current?.proxy_id === proxy.id && current.updated_at === proxy.revision;
    };
    if (autoLocation) {
      if (!proxyStillAssigned()) throw fail(PROXY_IDENTITY_ERROR, 'PROXY_BROWSER_IDENTITY_FAILED');
      setSetting(locationKey, { ...autoLocation, browserVerifiedAt: Date.now() });
    }
    const monitor = autoLocation && setInterval(() => {
      try {
        if (!proxyStillAssigned()) {
          setSetting(locationKey, null);
          fs.writeFileSync(invalidate, '');
        }
      } catch {
        try { fs.writeFileSync(invalidate, ''); } catch {}
      }
    }, 1000).unref();
    const requestStop = () => fs.writeFileSync(stop, '');
    child.once('exit', code => {
      if (monitor) clearInterval(monitor);
      if (code === PROXY_IDENTITY_EXIT) {
        try { setSetting(locationKey, null); } catch {}
      }
      for (const file of [request, ready, stop, invalidate]) {
        try { fs.rmSync(file, { force: true, maxRetries: 2 }); } catch { /* next launch uses a new token */ }
      }
    });
    return { proc: child, browserPid: child.pid, spawnPid: child.pid, argv, requestStop, relayUrl: relay };
  } catch (error) {
    if (mode === 'auto') {
      try { setSetting(locationKey, null); } catch {}
    }
    if (!isPackaged() && process.env.PM_PRIVACY_ENGINE_QA === '1') {
      try { console.error('Privacy engine QA startup:', fs.readFileSync(control + '.log', 'utf8')); } catch {}
    }
    if (child?.pid && !exited(child)) {
      try { await killTree(child.pid, { expect: root }); } catch {}
      if (!exited(child)) {
        error.preserveProfileLock = true;
        error.browserPid = child.pid;
      }
    }
    for (const file of [request, ready, stop, invalidate]) fs.rmSync(file, { force: true, maxRetries: 2 });
    if (relay) await closeAnonymizedProxy(relay, true).catch(() => {});
    throw error;
  }
}

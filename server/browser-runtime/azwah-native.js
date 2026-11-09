import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from 'proxy-chain';
import { db, getSetting, setSetting } from '../db.js';
import { geoIpCredentials } from '../geoip-settings.js';
import { resolveProxyLocation } from '../proxy-location.js';
import { isAlive, killTree } from '../proc.js';
import { isPackaged } from '../testflags.js';

const error = (message, code = 'AZWAH_NATIVE_UNAVAILABLE') =>
  Object.assign(new Error(message), { status: 409, code });

function developmentBinary() {
  const exe = process.env.AZWAH_NATIVE_CHROMIUM_EXE;
  const hash = process.env.AZWAH_NATIVE_CHROMIUM_SHA256;
  const dllHash = process.env.AZWAH_NATIVE_CHROMIUM_DLL_SHA256;
  if (process.platform !== 'win32' || isPackaged() || !exe || !path.isAbsolute(exe) ||
      !hash || !/^[a-f0-9]{64}$/i.test(hash) || !dllHash || !/^[a-f0-9]{64}$/i.test(dllHash)) {
    throw error('Native Azwah requires a qualified Windows development build configured with the executable path and SHA-256 for both chrome.exe and chrome.dll.');
  }
  return { exe, hash: hash.toLowerCase(), dllHash: dllHash.toLowerCase() };
}

async function verifyBinary(binary, expected) {
  const hash = createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(binary)) hash.update(chunk);
  } catch {
    throw error('The configured native Azwah browser binary could not be read.');
  }
  if (hash.digest('hex') !== expected) throw error('A native Azwah browser binary SHA-256 does not match.');
}

function proxyRelay(proxy) {
  const scheme = { http: 'http', https: 'https', socks5: 'socks5h' }[proxy.type];
  const port = Number(proxy.port);
  if (!scheme || !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof proxy.host !== 'string' || !/^[a-z0-9.:[\]-]+$/i.test(proxy.host)) {
    throw error('The native Azwah profile has an invalid proxy.');
  }
  const host = isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host;
  const upstream = new URL(`${scheme}://${host}:${port}`);
  upstream.username = encodeURIComponent(proxy.username || '');
  upstream.password = encodeURIComponent(proxy.password || '');
  return new Server({
    host: '127.0.0.1', port: 0, verbose: false,
    prepareRequestFunction: () => ({ upstreamProxyUrl: upstream.href }),
  });
}

export async function launchAzwahNative(profile, dir, opts, checkCancelled, onRotation) {
  const { exe, hash, dllHash } = developmentBinary();
  if (opts.automation || opts.headless) throw error('Native Azwah interactive profiles cannot start in automation mode.');
  await Promise.all([verifyBinary(exe, hash), verifyBinary(path.join(path.dirname(exe), 'chrome.dll'), dllHash)]);
  checkCancelled();

  const nativeDir = path.join(dir, 'azwah-native');
  fs.mkdirSync(nativeDir, { recursive: true });
  if (fs.lstatSync(nativeDir).isSymbolicLink()) throw error('Linked native Azwah storage is unsupported.');
  const receipt = path.join(nativeDir, `.ready-${randomUUID()}`);
  const proxy = profile.proxy;
  const locationKey = 'proxy-location:' + profile.id;
  const resolveLocation = () => resolveProxyLocation(proxy, {
    read: () => getSetting(locationKey, null), credentials: geoIpCredentials,
  });
  const assignmentCurrent = () => {
    const row = db.prepare(`SELECT p.proxy_id AS id, x.updated_at AS revision
      FROM profiles p LEFT JOIN proxies x ON x.id = p.proxy_id
      WHERE p.id = ? AND p.deleted_at IS NULL`).get(profile.id);
    return Boolean(row) && row.id === (proxy?.id ?? null) && row.revision === (proxy?.revision ?? null);
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(AZWAH_NATIVE_|AZWAH_MAXMIND_|ELECTRON_|NODE_OPTIONS$|PM_API_TOKEN$|PM_SECRET$|PM_UI_TOKEN$)/i.test(key)));
  env.AZWAH_NATIVE_READY_PATH = receipt;

  let child, relay, location, monitor;
  let invalidated = false;
  const closeRelay = async () => {
    if (monitor) clearTimeout(monitor);
    if (!relay) return;
    const server = relay;
    relay = null;
    await server.close(true).catch(() => {});
  };
  const discardReceipt = () => {
    try { fs.rmSync(receipt, { force: true }); } catch {}
  };
  try {
    if (proxy) {
      location = await resolveLocation();
      relay = proxyRelay(proxy);
      await relay.listen();
      env.AZWAH_NATIVE_PROXY_RELAY_PORT = String(relay.port);
      env.AZWAH_NATIVE_EXPECTED_EXIT_IP = location.ip;
      env.AZWAH_NATIVE_PROXY_TIMEZONE = location.timezone;
      env.AZWAH_NATIVE_PROXY_GEOLOCATION = [location.latitude, location.longitude, location.accuracy].join(',');
    }
    checkCancelled();
    if (!assignmentCurrent()) throw error('The assigned proxy changed during native launch.', 'PROXY_BROWSER_IDENTITY_FAILED');
    const args = [`--user-data-dir=${nativeDir}`, '--no-first-run', '--no-default-browser-check'];
    if (opts.url) {
      const url = new URL(opts.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw error('Enter an HTTP or HTTPS website URL.');
      args.push(url.href);
    } else if (profile.advancedSettings?.preferences?.restoreTabs) {
      args.push('--restore-last-session');
    }
    child = spawn(exe, args, { env, stdio: 'ignore', windowsHide: false });
    let spawnFailed = false;
    child.on('error', () => { spawnFailed = true; });
    child.once('exit', () => { invalidated = true; discardReceipt(); void closeRelay(); });
    const deadline = Date.now() + 25000;
    const expected = location ? `${location.ip}\n${location.timezone}` : 'direct';
    while (true) {
      checkCancelled();
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null || !child.pid || Date.now() >= deadline) {
        throw error('Native Azwah exited or did not verify browser startup.', 'PROXY_BROWSER_IDENTITY_FAILED');
      }
      try {
        if (fs.readFileSync(receipt, 'utf8') === expected) break;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      await delay(100);
    }
    discardReceipt();
    if (!assignmentCurrent()) throw error('The assigned proxy changed during native launch.', 'PROXY_BROWSER_IDENTITY_FAILED');
    if (location) {
      location = { ...location, browserExitVerifiedAt: Date.now(), nativeTimezoneVerifiedAt: Date.now() };
      delete location.browserVerifiedAt;
      setSetting(locationKey, location);
    }

    let lastProbe = Date.now();
    const recheck = async () => {
      let rotation = false;
      try {
        if (!assignmentCurrent()) throw error('The assigned proxy changed.');
        if (location && Date.now() - lastProbe >= 30000) {
          const current = await resolveLocation();
          if (invalidated) return;
          if (!assignmentCurrent()) throw error('The assigned proxy changed.');
          rotation = ['ip', 'timezone', 'latitude', 'longitude', 'accuracy'].some(key => current[key] !== location[key]);
          if (rotation) throw error('The proxy exit identity changed.');
          if (current.expiresAt !== location.expiresAt) {
            location = { ...current, browserExitVerifiedAt: location.browserExitVerifiedAt,
              nativeTimezoneVerifiedAt: location.nativeTimezoneVerifiedAt };
            delete location.browserVerifiedAt;
            setSetting(locationKey, location);
          }
          lastProbe = Date.now();
        }
      } catch {
        if (invalidated) return;
        invalidated = true;
        try { setSetting(locationKey, null); } catch {}
        await closeRelay();
        if (rotation && onRotation && await onRotation().catch(() => false)) return;
        await killTree(child.pid, { expect: nativeDir }).catch(() => {});
        return;
      }
      if (!invalidated) monitor = setTimeout(recheck, 1000).unref();
    };
    monitor = setTimeout(recheck, 1000).unref();
    return { proc: child, browserPid: child.pid, spawnPid: child.pid, argv: args, cleanup: closeRelay,
      relayUrl: relay ? `http://127.0.0.1:${relay.port}` : null };
  } catch (err) {
    invalidated = true;
    if (proxy) {
      try { setSetting(locationKey, null); } catch {}
    }
    await closeRelay();
    discardReceipt();
    if (child?.pid && isAlive(child.pid)) {
      await killTree(child.pid, { expect: nativeDir }).catch(() => {});
      if (isAlive(child.pid)) {
        err.preserveProfileLock = true;
        err.browserPid = child.pid;
      }
    }
    throw err;
  }
}

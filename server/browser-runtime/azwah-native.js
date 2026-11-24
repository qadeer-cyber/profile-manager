import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from 'proxy-chain';
import { db, getSetting, setSetting } from '../db.js';
import { geoIpCredentials } from '../geoip-settings.js';
import { resolveProxyLocationWithRetry } from '../proxy-location.js';
import { isAlive, killTree } from '../proc.js';
import { isPackaged, azwahNativeTestAvailable } from '../testflags.js';

export const RECEIPT_NOT_READY = new Set(['ENOENT', 'EBUSY', 'EPERM', 'EACCES']);
const error = (message, code = 'AZWAH_NATIVE_UNAVAILABLE') =>
  Object.assign(new Error(message), { status: 409, code });

function developmentBinary() {
  if (process.platform !== 'win32') throw error('Native Azwah Chromium is Windows-only.');
  if (isPackaged()) {
    // Never substitute the manager's Electron runtime or the stock bundled Chromium.
    // This directory exists only in the genuine-native, provenance-gated Ultimate build.
    const directory = path.join(process.resourcesPath, 'native-chromium');
    const manifestFile = path.join(directory, 'BASELINE-MANIFEST.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
    catch { throw error('This Ultimate installation has no qualified patched native Chromium payload.'); }
    if (manifest.kind !== 'azwah-native-source-development' ||
        manifest.chromiumCommit !== 'b0cbb99d9f0f9fbbb6c6780e73b17984e991c866' ||
        manifest.depotToolsCommit !== '96a7c1418eedaa6bea333a8941e8a0078681b4d0' ||
        !/^[a-f0-9]{64}$/i.test(manifest.sourcePatchSha256 || '')) {
      throw error('Packaged Chromium is not a pinned Azwah native source build.');
    }
    const fileHash = name => {
      const entries = Array.isArray(manifest.files) ? manifest.files.filter(item => item?.name === name) : [];
      if (entries.length !== 1 || !/^[a-f0-9]{64}$/i.test(entries[0].sha256 || '')) {
        throw error('Packaged Azwah native binary provenance is incomplete: ' + name);
      }
      const file = path.join(directory, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entries[0].bytes) {
          throw new Error('Invalid binary file');
        }
      } catch {
        throw error('Packaged Azwah native binary is missing or has the wrong size: ' + name);
      }
      return entries[0].sha256.toLowerCase();
    };
    // Canvas protection exists only in builds made with native-chromium/canvas-noise.patch (recorded in the manifest).
    const canvas = /^[a-f0-9]{64}$/i.test(manifest.canvasPatchSha256 || '');
    return { exe: path.join(directory, 'chrome.exe'), hash: fileHash('chrome.exe'), dllHash: fileHash('chrome.dll'), canvas };
  }
  const exe = process.env.AZWAH_NATIVE_CHROMIUM_EXE;
  const hash = process.env.AZWAH_NATIVE_CHROMIUM_SHA256;
  const dllHash = process.env.AZWAH_NATIVE_CHROMIUM_DLL_SHA256;
  if (!exe || !path.isAbsolute(exe) ||
      !hash || !/^[a-f0-9]{64}$/i.test(hash) || !dllHash || !/^[a-f0-9]{64}$/i.test(dllHash)) {
    throw error('Native Azwah requires an explicitly qualified development build or a genuine packaged native runtime.');
  }
  return { exe, hash: hash.toLowerCase(), dllHash: dllHash.toLowerCase(), canvas: process.env.AZWAH_NATIVE_CHROMIUM_CANVAS === '1' };
}

// True when this installation carries a provenance-checked AZWAH Chromium (packaged Windows build only).
// Cheap: reads the manifest and checks file sizes; the full SHA-256 check still runs at every launch.
export function azwahNativeAvailable() {
  if (azwahNativeTestAvailable()) return true;
  if (process.platform !== 'win32' || !isPackaged()) return false;
  try { developmentBinary(); return true; } catch { return false; }
}

// Chromium's Windows sandbox starts page processes with restricted and AppContainer tokens that must be able to
// read the browser folder ("Sandbox cannot access executable ... Access is denied", measured in CI run 45146948553).
// Program Files grants this; a per-user install folder does not. Grant read/execute to ALL APPLICATION PACKAGES
// and ALL RESTRICTED APPLICATION PACKAGES. The sandbox stays on.
export const SANDBOX_READ_SIDS = ['*S-1-15-2-1:(OI)(CI)(RX)', '*S-1-15-2-2:(OI)(CI)(RX)'];
export function sandboxAccessArgs(directory) { return [directory, '/grant', ...SANDBOX_READ_SIDS, '/T', '/C', '/Q']; }
// Applied before every launch (idempotent, about a second): an update or repair reinstalls the folder without these
// entries even when the browser build is unchanged (measured: installer run 45306804506, Beta A -> Beta B).
async function ensureSandboxAccess(directory) {
  const icacls = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
  const code = await new Promise(resolve => {
    const child = spawn(icacls, sandboxAccessArgs(directory), { stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(-1));
    child.on('exit', resolve);
  });
  if (code !== 0) throw error(`Could not let the AZWAH browser's sandbox read its folder (icacls exit ${code}).`, 'AZWAH_NATIVE_SANDBOX_ACCESS');
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
  const { exe, hash, dllHash, canvas } = developmentBinary();
  if (opts.automation || opts.headless) throw error('Native Azwah interactive profiles cannot start in automation mode.');
  const canvasProtection = profile.advancedSettings?.experimental?.canvasReadback === 'prototype';
  if (canvasProtection && !canvas) {
    throw error('This AZWAH Chromium build does not include canvas protection. Turn it off for this profile or update AZWAH.', 'AZWAH_NATIVE_CANVAS_UNSUPPORTED');
  }
  await Promise.all([verifyBinary(exe, hash), verifyBinary(path.join(path.dirname(exe), 'chrome.dll'), dllHash)]);
  checkCancelled();
  if (isPackaged()) await ensureSandboxAccess(path.dirname(exe));
  checkCancelled();

  const nativeDir = path.join(dir, 'azwah-native');
  fs.mkdirSync(nativeDir, { recursive: true });
  if (fs.lstatSync(nativeDir).isSymbolicLink()) throw error('Linked native Azwah storage is unsupported.');
  const receipt = path.join(nativeDir, `.ready-${randomUUID()}`);
  const proxy = profile.proxy;
  const locationKey = 'proxy-location:' + profile.id;
  const resolveLocation = () => resolveProxyLocationWithRetry(proxy, {
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
    // Opt-in canvas readback protection: a new secret per launch, so values are stable within a site for this
    // session and differ between sites, profiles and launches (docs/privacy-threat-model.md).
    if (canvasProtection) args.push(`--azwah-canvas-seed=${randomUUID().replace(/-/g, '')}`);
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
        // Not written yet, or the browser still holds it open while writing (Windows: EBUSY/EPERM/EACCES,
        // measured in the live qualification run 45323301364). Both mean "not ready yet"; the deadline still applies.
        if (!RECEIPT_NOT_READY.has(err.code)) throw err;
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

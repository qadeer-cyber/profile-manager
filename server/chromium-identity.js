// The Chromium version this process will actually launch. Presets are built from
// that version so a profile cannot claim a different browser.
import { spawnSync } from 'child_process';
import fs from 'fs';
import { MANIFEST } from './chromium.js';

const cache = new Map();
const VERSION = /\b(\d+\.\d+\.\d+\.\d+)\b/;

export function readExecutableVersion(exe) {
  if (!exe || !fs.existsSync(exe)) return null;
  if (cache.has(exe)) return cache.get(exe);
  let version = null;
  try {
    const result = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const match = `${result.stdout || ''} ${result.stderr || ''}`.match(VERSION);
    version = match ? match[1] : null;
  } catch { version = null; }
  cache.set(exe, version);
  return version;
}

export function chromiumIdentity(executablePath) {
  const pinnedVersion = MANIFEST.browserVersion;
  const executableVersion = executablePath ? readExecutableVersion(executablePath) : null;
  const version = executableVersion || pinnedVersion || null;
  const source = executableVersion ? 'executable' : pinnedVersion ? 'pinned-manifest' : 'unavailable';
  return {
    pinnedVersion: pinnedVersion || null,
    executableVersion,
    version,
    source,
    versionMismatch: !!(executableVersion && pinnedVersion && executableVersion !== pinnedVersion),
  };
}

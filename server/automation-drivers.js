// Optional user-initiated cache for ChromeDriver (CfT / same pin as Chromium) and geckodriver (Mozilla MPL).
// Not bundled in the NSIS offline installer. Requires settings.automationDriversOptIn === true before install.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { DATA_DIR, getSetting, setSetting } from './db.js';
import { MANIFEST, platformKey, httpsDownload, sha256File, extractZip, assertOfficialUrl } from './chromium.js';
import GECKO_MANIFEST from './geckodriver-manifest.json' with { type: 'json' };

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

const CHROMEDRIVER_LAYOUT = {
  win64: 'chromedriver-win64/chromedriver.exe',
  linux64: 'chromedriver-linux64/chromedriver',
};

export function driversCacheRoot() {
  return path.join(DATA_DIR, 'automation-drivers');
}

export function automationDriversOptIn() {
  return !!getSetting('automationDriversOptIn', false);
}

export function chromedriverInstallDir() {
  return path.join(driversCacheRoot(), `chromedriver-${MANIFEST.browserVersion}`);
}

export function geckodriverInstallDir() {
  return path.join(driversCacheRoot(), `geckodriver-${GECKO_MANIFEST.version}`);
}

export function expectedChromedriverPath() {
  const key = platformKey();
  if (!key) return null;
  const rel = CHROMEDRIVER_LAYOUT[key];
  return rel ? path.join(chromedriverInstallDir(), rel) : null;
}

export function expectedGeckodriverPath() {
  const key = platformKey();
  if (!key) return null;
  const entry = GECKO_MANIFEST.builds[key];
  if (!entry) return null;
  return path.join(geckodriverInstallDir(), entry.executableInArchive);
}

function driverState(name, exePath, meta) {
  const installed = !!(exePath && fs.existsSync(exePath));
  return { installed, path: installed ? exePath : null, ...meta };
}

export function automationDriversReport() {
  const key = platformKey();
  return {
    generatedAt: new Date().toISOString(),
    bundledInInstaller: false,
    optInRequired: true,
    optIn: automationDriversOptIn(),
    cacheRoot: driversCacheRoot(),
    platform: key,
    chromedriver: driverState('chromedriver', expectedChromedriverPath(), {
      pinnedBrowserVersion: MANIFEST.browserVersion,
      license: 'Chrome for Testing / Google (same pin as bundled Chromium)',
      source: 'cdn.playwright.dev Chrome-for-Testing bucket',
      envOverride: 'PM_CHROMEDRIVER_PATH',
    }),
    geckodriver: driverState('geckodriver', expectedGeckodriverPath(), {
      version: GECKO_MANIFEST.version,
      license: GECKO_MANIFEST.license,
      publisher: GECKO_MANIFEST.publisher,
      envOverride: 'PM_GECKODRIVER_PATH',
    }),
    note: 'Install places verified binaries under the data folder only after you enable opt-in in Settings. WebDriver bridges still require an automation profile session.',
  };
}

async function installChromedriverCached({ download = httpsDownload, log = () => {} } = {}) {
  if (!automationDriversOptIn()) throw fail(403, 'Enable automation driver cache in Settings before downloading.', 'DRIVERS_OPT_IN_REQUIRED');
  const key = platformKey();
  const entry = MANIFEST.builds.chromedriver?.[key];
  if (!entry) throw fail(400, 'ChromeDriver cache is not pinned for this platform.', 'UNSUPPORTED_PLATFORM');
  const url = assertOfficialUrl(new URL(entry.path, MANIFEST.baseUrl).href).href;
  const dir = chromedriverInstallDir();
  const root = driversCacheRoot();
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `.download-chromedriver-${process.pid}.zip`);
  try {
    log(`Downloading ${url}`);
    await download(url, tmp);
    const sha = (await sha256File(tmp)).toLowerCase();
    if (sha !== entry.sha256.toLowerCase()) throw fail(500, 'ChromeDriver SHA-256 mismatch', 'CHECKSUM_MISMATCH');
    const staging = dir + '.partial';
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await extractZip(tmp, staging);
    fs.writeFileSync(path.join(staging, '.pm-verified.json'), JSON.stringify({ url, sha256: sha, at: new Date().toISOString() }));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    const exe = expectedChromedriverPath();
    setSetting('chromedriverCachePath', exe || '');
    return { driver: 'chromedriver', path: exe, sha256: sha };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function installGeckodriverCached({ download = httpsDownload, log = () => {} } = {}) {
  if (!automationDriversOptIn()) throw fail(403, 'Enable automation driver cache in Settings before downloading.', 'DRIVERS_OPT_IN_REQUIRED');
  const key = platformKey();
  const entry = GECKO_MANIFEST.builds[key];
  if (!entry) throw fail(400, 'Geckodriver cache is not pinned for this platform.', 'UNSUPPORTED_PLATFORM');
  const dir = geckodriverInstallDir();
  const root = driversCacheRoot();
  fs.mkdirSync(root, { recursive: true });
  const ext = entry.url.endsWith('.zip') ? '.zip' : '.tar.gz';
  const tmp = path.join(root, `.download-geckodriver-${process.pid}${ext}`);
  try {
    log(`Downloading ${entry.url}`);
    await download(entry.url, tmp);
    const sha = (await sha256File(tmp)).toLowerCase();
    if (sha !== entry.sha256.toLowerCase()) throw fail(500, 'Geckodriver SHA-256 mismatch', 'CHECKSUM_MISMATCH');
    const staging = dir + '.partial';
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    if (ext === '.zip') await extractZip(tmp, staging);
    else execFileSync('tar', ['-xzf', tmp, '-C', staging], { stdio: 'ignore' });
    if (process.platform !== 'win32') {
      const exe = path.join(staging, entry.executableInArchive);
      if (fs.existsSync(exe)) fs.chmodSync(exe, 0o755);
    }
    fs.writeFileSync(path.join(staging, '.pm-verified.json'), JSON.stringify({ url: entry.url, sha256: sha, at: new Date().toISOString() }));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    const exePath = expectedGeckodriverPath();
    setSetting('geckodriverCachePath', exePath || '');
    return { driver: 'geckodriver', path: exePath, sha256: sha };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export async function installAutomationDrivers(which = 'both', opts = {}) {
  if (!opts.confirm) throw fail(400, 'Pass { confirm: true } to download drivers into the data folder.', 'CONFIRM_REQUIRED');
  const out = [];
  if (which === 'chromedriver' || which === 'both') out.push(await installChromedriverCached(opts));
  if (which === 'geckodriver' || which === 'both') out.push(await installGeckodriverCached(opts));
  return { installed: out, report: automationDriversReport() };
}

export function resolveChromedriverForBridge() {
  const configured = process.env.PM_CHROMEDRIVER_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;
  const fromSetting = getSetting('chromedriverCachePath', '');
  if (fromSetting && fs.existsSync(fromSetting)) return fromSetting;
  const cached = expectedChromedriverPath();
  if (automationDriversOptIn() && cached && fs.existsSync(cached)) return cached;
  return process.platform === 'win32' ? 'chromedriver.exe' : 'chromedriver';
}

export function resolveGeckodriverForBridge() {
  const configured = process.env.PM_GECKODRIVER_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;
  const fromSetting = getSetting('geckodriverCachePath', '');
  if (fromSetting && fs.existsSync(fromSetting)) return fromSetting;
  const cached = expectedGeckodriverPath();
  if (automationDriversOptIn() && cached && fs.existsSync(cached)) return cached;
  return process.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver';
}

// Verified Chromium install (first-run download) and "is Chromium installed?" checks.
// Security model: download only over HTTPS from the official Playwright CDN, verify the archive's
// SHA-256 against the pinned manifest (server/chromium-manifest.json) BEFORE extracting, and refuse
// to install anything that doesn't match. Playwright itself publishes no checksums, so we pin them.
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const MANIFEST = JSON.parse(fs.readFileSync(new URL('./chromium-manifest.json', import.meta.url), 'utf8'));
export const OFFICIAL_ORIGIN = 'https://cdn.playwright.dev';
const err = (code, msg, status = 500) => Object.assign(new Error(msg), { code, status });

export function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'win64';
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  return null;
}
// The bundled offline tree is read-only. Downloads must not write into it.
export function isResourcesBrowsers(root) {
  const parts = path.resolve(String(root || '')).split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.at(-1).toLowerCase() === 'browsers' && parts.at(-2).toLowerCase() === 'resources';
}
export function browsersRoot(env = process.env, platform = process.platform) {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return path.resolve(env.PLAYWRIGHT_BROWSERS_PATH);
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright');
}
// Install layout Playwright expects: <root>/<dirName>-<rev>/<zip root>/<exe>
const LAYOUT = {
  chromium: { dir: 'chromium', exe: { win64: 'chrome-win64/chrome.exe', linux64: 'chrome-linux64/chrome' } },
  'chromium-headless-shell': { dir: 'chromium_headless_shell', exe: { win64: 'chrome-headless-shell-win64/chrome-headless-shell.exe', linux64: 'chrome-headless-shell-linux64/chrome-headless-shell' } },
};
export function installDir(name, { root = browsersRoot(), manifest = MANIFEST } = {}) { return path.join(root, `${LAYOUT[name].dir}-${manifest.revision}`); }
export function expectedExecutable(name, { root, manifest = MANIFEST, key = platformKey() } = {}) {
  return key ? path.join(installDir(name, { root, manifest }), LAYOUT[name].exe[key]) : null;
}
// Manifest must match the bundled playwright-core revision; otherwise checksums are for the wrong build.
export function manifestMatchesPlaywright(manifest = MANIFEST) {
  try {
    const pc = path.dirname(require.resolve('playwright-core/package.json'));
    const b = JSON.parse(fs.readFileSync(path.join(pc, 'browsers.json'), 'utf8')).browsers.find(x => x.name === 'chromium');
    return b.revision === manifest.revision && b.browserVersion === manifest.browserVersion;
  } catch { return false; }
}

// Structured error for launching with no browser installed (UI shows a "Download Chromium" prompt).
// Returns null if the needed executable exists. `force` = Playwright already said it's missing.
export function chromiumMissingError(headless, force = false, opts = {}) {
  const name = headless ? 'chromium-headless-shell' : 'chromium';
  const exe = expectedExecutable(name, opts);
  if (!force && (!exe || fs.existsSync(exe))) return null; // unknown platform: let Playwright decide
  return Object.assign(err('CHROMIUM_MISSING', `Chromium is not installed${headless ? ' (headless shell)' : ''}. Open Diagnostics → Download Chromium, or set a browser path in Settings.`, 503),
    { browser: name, expectedPath: exe, action: 'POST /api/browser/install' });
}

export function sha256File(file) {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });
}
export async function verifyArchive(file, entry) {
  const size = fs.statSync(file).size;
  if (entry.size && size !== entry.size) throw err('CHECKSUM_MISMATCH', `Chromium download rejected: size ${size} != pinned ${entry.size}`);
  const got = await sha256File(file);
  if (got !== entry.sha256.toLowerCase()) throw err('CHECKSUM_MISMATCH', `Chromium download rejected: SHA-256 ${got} != pinned ${entry.sha256}`);
  return got;
}
export function assertOfficialUrl(u) {
  const url = new URL(u);
  if (url.protocol !== 'https:' || url.origin !== OFFICIAL_ORIGIN) throw err('UNTRUSTED_SOURCE', `Refusing to download Chromium from ${url.origin}; only ${OFFICIAL_ORIGIN} over HTTPS is allowed`);
  return url;
}

// HTTPS download with redirects (HTTPS only). Integrity is enforced by the hash, not the transport.
export function httpsDownload(url, dest, { onProgress, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const get = (u, left) => {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:') return reject(err('UNTRUSTED_SOURCE', `Refusing non-HTTPS redirect to ${parsed.origin}`));
      https.get(parsed, { timeout: 60000 }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); if (!left) return reject(err('DOWNLOAD_FAILED', 'Too many redirects'));
          return get(new URL(res.headers.location, parsed).href, left - 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(err('DOWNLOAD_FAILED', `HTTP ${res.statusCode} for ${u}`)); }
        const total = Number(res.headers['content-length']) || 0; let done = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', d => { done += d.length; onProgress?.(done, total); });
        res.pipe(out); out.on('finish', () => out.close(() => resolve(dest))); out.on('error', reject); res.on('error', reject);
      }).on('error', e => reject(err('DOWNLOAD_FAILED', e.message))).on('timeout', function () { this.destroy(new Error('timeout')); });
    };
    get(url, maxRedirects);
  });
}

// Extract a zip with zip-slip protection; keeps POSIX exec bits.
export function extractZip(file, destDir) {
  const { yauzl } = require('playwright-core/lib/utilsBundle');
  const root = path.resolve(destDir) + path.sep;
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (e, zip) => {
      if (e) return reject(e);
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', ent => {
        const target = path.resolve(destDir, ent.fileName);
        if (!target.startsWith(root)) return reject(err('BAD_ARCHIVE', `Unsafe path in archive: ${ent.fileName}`));
        if (/\/$/.test(ent.fileName)) { fs.mkdirSync(target, { recursive: true }); return zip.readEntry(); }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const mode = (ent.externalFileAttributes >>> 16) & 0o777;
        const isLink = ((ent.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
        zip.openReadStream(ent, (e2, rs) => {
          if (e2) return reject(e2);
          if (isLink) { let t = ''; rs.on('data', d => t += d); rs.on('end', () => { const lt = path.resolve(path.dirname(target), t); if (!lt.startsWith(root)) return reject(err('BAD_ARCHIVE', `Unsafe symlink ${ent.fileName}`)); fs.rmSync(target, { force: true }); fs.symlinkSync(t, target); zip.readEntry(); }); return; }
          const ws = fs.createWriteStream(target, mode ? { mode } : {});
          rs.pipe(ws); ws.on('finish', () => zip.readEntry()); ws.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

// Download + verify + extract one browser. `download(url, dest)` is injectable for tests.
export async function installOne(name, { root = browsersRoot(), manifest = MANIFEST, key = platformKey(), download = httpsDownload, onProgress, log = () => {} } = {}) {
  if (isResourcesBrowsers(root)) throw err('BAD_INSTALL_ROOT', 'Refusing to install Chromium into resources/browsers');
  const entry = manifest.builds[name]?.[key];
  if (!entry) throw err('UNSUPPORTED_PLATFORM', `No pinned ${name} build for ${process.platform}-${process.arch}`);
  const url = assertOfficialUrl(new URL(entry.path, manifest.baseUrl).href).href;
  const dir = installDir(name, { root, manifest });
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `.download-${name}-${process.pid}-${Date.now()}.zip`);
  try {
    log(`Downloading ${url}`);
    await download(url, tmp, { onProgress: (d, t) => onProgress?.(name, d, t) });
    const sha = await verifyArchive(tmp, entry);
    log(`Verified SHA-256 ${sha}`);
    const staging = dir + '.partial';
    fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
    await extractZip(tmp, staging);
    fs.writeFileSync(path.join(staging, '.pm-verified.json'), JSON.stringify({ url, sha256: sha, at: new Date().toISOString() }));
    fs.writeFileSync(path.join(staging, 'INSTALLATION_COMPLETE'), '');
    fs.writeFileSync(path.join(staging, 'DEPENDENCIES_VALIDATED'), '');
    fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(staging, dir);
    return { name, dir, sha256: sha };
  } finally { fs.rmSync(tmp, { force: true }); }
}

export async function installVerifiedChromium(opts = {}) {
  if (!(opts.skipRevisionCheck) && !manifestMatchesPlaywright(opts.manifest)) throw err('MANIFEST_STALE', 'chromium-manifest.json does not match the bundled playwright-core revision; regenerate it (scripts/update-chromium-manifest.mjs)');
  const out = [];
  for (const name of opts.names || ['chromium', 'chromium-headless-shell']) out.push(await installOne(name, opts));
  return out;
}

// Status for /api/browser and Diagnostics.
export function chromiumStatus(opts = {}) {
  const res = {};
  for (const name of Object.keys(LAYOUT)) {
    const exe = expectedExecutable(name, opts), dir = installDir(name, opts);
    let verified = null; try { verified = JSON.parse(fs.readFileSync(path.join(dir, '.pm-verified.json'), 'utf8')); } catch {}
    res[name] = { path: exe, installed: !!exe && fs.existsSync(exe), verified: !!verified, sha256: verified?.sha256 || null };
  }
  return { root: opts.root || browsersRoot(), revision: MANIFEST.revision, browserVersion: MANIFEST.browserVersion, manifestMatchesPlaywright: manifestMatchesPlaywright(), ...res };
}

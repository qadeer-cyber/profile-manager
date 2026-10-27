// Source verification only: exact pinned archives, one selected official source,
// or predownloaded archives. No installer build, dependency update, or CI dispatch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MANIFEST, manifestMatchesPlaywright, platformKey, browsersRoot, isResourcesBrowsers,
  httpsDownload, verifyArchive, installOne, chromiumStatus } from '../server/chromium.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(source|archives)=(.+)$/.exec(arg);
  if (!match) throw new Error('Usage: node scripts/m3-install-runtime.mjs --source=google|playwright [--archives=/absolute/path]');
  return [match[1], match[2]];
}));
const source = options.source || 'playwright';
if (!['google', 'playwright'].includes(source)) throw new Error('Unknown official source');
if (!manifestMatchesPlaywright()) throw new Error('Installed Playwright does not match the pinned browser manifest');
const key = platformKey(), root = browsersRoot();
if (!key) throw new Error('This verification procedure supports Linux x64 and Windows x64');
if (isResourcesBrowsers(root)) throw new Error('Refusing to modify a packaged resources/browsers tree');
const archives = options.archives ? path.resolve(options.archives) : fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m3-archives-'));
try {
  for (const name of ['chromium', 'chromium-headless-shell']) {
    const entry = MANIFEST.builds[name][key];
    const base = source === 'google' ? 'https://storage.googleapis.com/chrome-for-testing-public/' + MANIFEST.browserVersion + '/' : MANIFEST.baseUrl;
    const url = new URL(entry.path, base).href;
    const archive = path.join(archives, name + '.zip');
    // No automatic retry or source/version fallback. Existing archives are still
    // verified before reuse; a caller cannot bypass size or SHA-256 validation.
    if (!options.archives) await httpsDownload(url, archive);
    const sha256 = await verifyArchive(archive, entry);
    const cached = chromiumStatus()[name];
    let installed;
    if (cached.installed && cached.verified) installed = { dir: path.dirname(path.dirname(cached.path)) };
    else installed = await installOne(name, { download: async (_url, dest) => fs.copyFileSync(archive, dest) });
    const marker = path.join(installed.dir, '.pm-verified.json');
    const provenance = JSON.parse(fs.readFileSync(marker, 'utf8'));
    // Report the actual verified archive source, rather than installOne's CDN URL.
    fs.writeFileSync(marker, JSON.stringify({ ...provenance, url, sha256, archiveVerifiedAt: new Date().toISOString() }));
    console.log(JSON.stringify({ name, source: url, size: entry.size, sha256, reusedVerifiedInstall: !!cached.verified }));
  }
  console.log(JSON.stringify(chromiumStatus()));
} finally {
  if (!options.archives) fs.rmSync(archives, { recursive: true, force: true });
}

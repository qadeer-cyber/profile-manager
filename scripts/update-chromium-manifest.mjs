// Regenerate server/chromium-manifest.json for the installed playwright-core.
// Downloads each archive from cdn.playwright.dev, hashes it, and cross-checks against Google's
// Chrome for Testing bucket (independent source). Usage: node scripts/update-chromium-manifest.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto';
import { createRequire } from 'module';
import { httpsDownload, sha256File } from '../server/chromium.js';
const require = createRequire(import.meta.url);
const pc = path.dirname(require.resolve('playwright-core/package.json'));
const ver = JSON.parse(fs.readFileSync(path.join(pc, 'package.json'))).version;
const cr = JSON.parse(fs.readFileSync(path.join(pc, 'browsers.json'))).browsers.find(b => b.name === 'chromium');
const base = `https://cdn.playwright.dev/builds/cft/${cr.browserVersion}/`, google = `https://storage.googleapis.com/chrome-for-testing-public/${cr.browserVersion}/`;
const files = {
  chromium: { win64: 'win64/chrome-win64.zip', linux64: 'linux64/chrome-linux64.zip' },
  chromedriver: { win64: 'win64/chromedriver-win64.zip', linux64: 'linux64/chromedriver-linux64.zip' },
  'chromium-headless-shell': { win64: 'win64/chrome-headless-shell-win64.zip', linux64: 'linux64/chrome-headless-shell-linux64.zip' },
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cft-')); const builds = {};
for (const [name, plats] of Object.entries(files)) for (const [k, p] of Object.entries(plats)) {
  const a = path.join(tmp, 'a.zip'), b = path.join(tmp, 'b.zip');
  await httpsDownload(base + p, a); await httpsDownload(google + p, b);
  const [ha, hb] = [await sha256File(a), await sha256File(b)];
  if (ha !== hb) throw new Error(`MISMATCH between CDN and Google for ${p}: ${ha} vs ${hb}`);
  (builds[name] ||= {})[k] = { path: p, sha256: ha, size: fs.statSync(a).size }; console.log(p, ha);
}
const out = { comment: JSON.parse(fs.readFileSync('server/chromium-manifest.json')).comment, playwrightCore: ver, revision: cr.revision, browserVersion: cr.browserVersion, baseUrl: base, builds };
fs.writeFileSync('server/chromium-manifest.json', JSON.stringify(out, null, 2) + '\n'); fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote server/chromium-manifest.json');

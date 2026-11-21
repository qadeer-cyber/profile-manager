// Runs test/fixtures/compat/index.html in a browser and prints its results (Playwright, local HTTP, offline).
// Used to record an unmodified baseline before any privacy protection exists, and later to check that a
// protection keeps every "ok" true. The browser and machine are part of the result.
//   node scripts/compat-baseline.mjs [path to browser executable]
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';

export async function runCompat({ executablePath, args = [] } = {}) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const html = fs.readFileSync(new URL('../test/fixtures/compat/index.html', import.meta.url));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }).end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath, args });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.title === 'done', null, { timeout: 30000 });
    const results = await page.evaluate(() => window.__azwahCompat);
    return { browser: browser.version(), platform: process.platform, results, ok: Object.values(results).every(r => r.ok) };
  } finally { await browser.close(); server.close(); }
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const r = await runCompat({ executablePath: process.argv[2] || undefined });
  console.log('COMPAT_BASELINE ' + JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}

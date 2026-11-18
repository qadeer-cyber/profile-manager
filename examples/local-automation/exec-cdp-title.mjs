import { chromium } from 'playwright';

const endpoint = process.env.PM_CDP_HTTP;
if (!endpoint) {
  console.log(JSON.stringify({ ok: false, reason: 'no-cdp' }));
  process.exit(0);
}
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages?.()[0];
  const title = page ? await page.title() : null;
  console.log(JSON.stringify({ ok: true, title }));
} finally {
  await browser.close();
}

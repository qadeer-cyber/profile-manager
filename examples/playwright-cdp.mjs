// Attach Playwright to a profile via the local automation API.
// Usage: PM_API_TOKEN=... PROFILE_ID=... node examples/playwright-cdp.mjs
// Automation is opt-in (`automation: true`). CDP must be on 127.0.0.1 or localhost.
import { chromium } from 'playwright';
import { assertLoopbackEndpoint } from './cdp-guard.mjs';

const token = process.env.PM_API_TOKEN || '';
const profileId = process.env.PROFILE_ID || '';
if (!token || !profileId) {
  console.error('PM_API_TOKEN and PROFILE_ID are required. CDP stays on loopback and automation is opt-in.');
  process.exit(2);
}
const base = process.env.PM_URL || 'http://127.0.0.1:3000';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const res = await fetch(`${base}/api/v1/profiles/${profileId}/launch`, { method: 'POST', headers, body: JSON.stringify({ automation: true }) });
const profile = await res.json();
if (!res.ok) throw new Error(profile.error || profile.message || `HTTP ${res.status}`);
const endpoint = assertLoopbackEndpoint(profile.cdp.wsEndpoint);
const browser = await chromium.connectOverCDP(endpoint.href);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.goto(process.env.TARGET_URL || 'https://example.com');
console.log('title:', await page.title());
await browser.close();
await fetch(`${base}/api/v1/profiles/${profile.id}/stop`, { method: 'POST', headers });

// Attach Playwright to a profile via CDP.
// Usage: PM_API_TOKEN=... PROFILE_ID=... node examples/playwright-cdp.mjs
import { chromium } from 'playwright';
const BASE = process.env.PM_URL || 'http://127.0.0.1:3000';
const headers = { Authorization: `Bearer ${process.env.PM_API_TOKEN}`, 'Content-Type': 'application/json' };

const res = await fetch(`${BASE}/api/v1/profiles/${process.env.PROFILE_ID}/launch`, { method: 'POST', headers, body: '{}' });
const profile = await res.json();
if (!res.ok) throw new Error(profile.error);
const browser = await chromium.connectOverCDP(profile.cdp.wsEndpoint);
const context = browser.contexts()[0];              // the profile's persistent context
const page = await context.newPage();
await page.goto(process.env.TARGET_URL || 'https://example.com');
console.log('title:', await page.title());
await browser.close();                              // disconnects only; profile keeps running
await fetch(`${BASE}/api/v1/profiles/${profile.id}/stop`, { method: 'POST', headers });

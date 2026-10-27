// Attach Puppeteer to a profile. Requires: npm i puppeteer-core
// Usage: PM_API_TOKEN=... PROFILE_ID=... node examples/puppeteer-connect.mjs
import puppeteer from 'puppeteer-core';
const BASE = process.env.PM_URL || 'http://127.0.0.1:3000';
const headers = { Authorization: `Bearer ${process.env.PM_API_TOKEN}`, 'Content-Type': 'application/json' };

const res = await fetch(`${BASE}/api/v1/profiles/${process.env.PROFILE_ID}/launch`, { method: 'POST', headers, body: '{}' });
const profile = await res.json();
if (!res.ok) throw new Error(profile.error);
const browser = await puppeteer.connect({ browserWSEndpoint: profile.cdp.wsEndpoint, defaultViewport: null });
const page = await browser.newPage();
await page.goto(process.env.TARGET_URL || 'https://example.com');
console.log('title:', await page.title());
await browser.disconnect();
await fetch(`${BASE}/api/v1/profiles/${profile.id}/stop`, { method: 'POST', headers });

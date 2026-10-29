#!/usr/bin/env node
/** Read-only export of stopped Firefox profile cookies (moz_cookies). Requires PM_API_TOKEN. */
const base = (process.env.PM_API_BASE || 'http://127.0.0.1:3847').replace(/\/$/, '');
const token = process.env.PM_API_TOKEN;
const profileId = process.env.PM_PROFILE_ID;
const out = process.env.PM_OUT || 'gecko-cookies.json';

if (!token || !profileId) {
  console.error('Set PM_API_TOKEN, PM_PROFILE_ID (Firefox profile). Profile must be stopped.');
  process.exit(1);
}

const r = await fetch(`${base}/api/v1/profiles/${profileId}/cookies/export`, {
  headers: { Authorization: `Bearer ${token}` },
});
const text = await r.text();
if (!r.ok) throw new Error(`${r.status} ${text}`);
const payload = JSON.parse(text);
if (payload.engine !== 'firefox') {
  console.error('Profile is not Firefox; use GET /cookies for Chromium.');
  process.exit(1);
}
await import('node:fs/promises').then(fs => fs.writeFile(out, JSON.stringify(payload, null, 2)));
console.log(`Wrote ${payload.cookies.length} gecko cookies to ${out} (readOnly=${payload.readOnly})`);

#!/usr/bin/env node
/** User-authorized cookie warming: open URLs in an existing profile via v1 API. */
const base = process.env.PM_API_BASE || 'http://127.0.0.1:3847/api/v1';
const token = process.env.PM_API_TOKEN;
const profileId = process.env.PM_PROFILE_ID;
const urls = (process.env.PM_URLS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!token || !profileId || !urls.length) {
  console.error('Set PM_API_TOKEN, PM_PROFILE_ID, PM_URLS=https://example.com,https://example.org');
  process.exit(1);
}

async function api(method, path, body) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

await api('POST', `/profiles/${profileId}/launch`, { automation: true, url: urls[0] });
console.log('Launched with automation for scripted navigation; stop profile when finished.');
for (const url of urls.slice(1)) console.log('Additional URL (open via your automation client):', url);

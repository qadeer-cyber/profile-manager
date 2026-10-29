#!/usr/bin/env node
/** Fetch profile-config v2 document (warnings + schema). Requires PM_API_TOKEN and PM_PROFILE_ID. */
const base = (process.env.PM_API_BASE || 'http://127.0.0.1:3847').replace(/\/$/, '');
const token = process.env.PM_API_TOKEN;
const profileId = process.env.PM_PROFILE_ID;

if (!token) {
  console.error('Set PM_API_TOKEN');
  process.exit(1);
}

async function api(path) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

const schema = await api('/api/v1/profile-config/schema');
console.log('Schema version', schema.schemaVersion, 'engines', schema.properties.browserEngine.enum.join(', '));

if (profileId) {
  const doc = await api(`/api/v1/profiles/${profileId}/browser-config`);
  console.log('Profile', doc.profileId, 'engine', doc.config.browserEngine);
  for (const w of doc.warnings || []) console.log('  warn', w.code, '-', w.message);
} else {
  console.log('Set PM_PROFILE_ID to print browser-config warnings for one profile.');
}

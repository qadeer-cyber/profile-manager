#!/usr/bin/env node
/** Queue a CookieRobot-local job (Chromium CDP). Requires PM_API_TOKEN and a Chromium profile id. */
const base = (process.env.PM_API_BASE || 'http://127.0.0.1:3847').replace(/\/$/, '');
const token = process.env.PM_API_TOKEN;
const profileId = process.env.PM_PROFILE_ID;
const urls = (process.env.PM_URLS || 'https://example.com').split(',').map(s => s.trim()).filter(Boolean);

if (!token || !profileId) {
  console.error('Set PM_API_TOKEN, PM_PROFILE_ID, optional PM_URLS=https://a.com,https://b.com');
  process.exit(1);
}

async function api(method, path, body) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const report = await api('GET', '/api/cookie-robot');
console.log('CookieRobot:', report.supportedEngines.join(', '), '| Firefox:', report.firefox.supported ? 'yes' : 'no');

const job = await api('POST', '/api/cookie-robot/jobs', { profileId, urls, delayMs: 1500 });
console.log('Queued job', job.id, job.status);

for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const state = await api('GET', `/api/cookie-robot/jobs/${job.id}`);
  const ok = state.tasks.filter(t => t.status === 'ok').length;
  console.log(state.status, `${ok}/${state.tasks.length}`, state.error || '');
  if (state.status === 'done' || state.status === 'failed' || state.status === 'cancelled') {
    process.exit(state.status === 'done' ? 0 : 1);
  }
}
console.error('Timed out waiting for job');
process.exit(1);

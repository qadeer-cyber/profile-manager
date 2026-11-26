// Owner decision (2026-11-20): new proxy profiles launch Manual (no automation connection); existing
// profiles are never switched silently. AZWAH offers once to switch them, and records the answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxy-launch-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'proxy-launch';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, route, body) => {
  const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server?.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('new profiles are Manual; existing Controlled proxy profiles are offered a one-time switch', async () => {
  const proxy = { type: 'http', host: '127.0.0.1', port: 18080 };
  const fresh = (await call('POST', '/profiles', { name: 'new proxy', proxy, advancedSettings: { runtime: 'stable-chrome' } })).body;
  assert.equal(fresh.advancedSettings.proxyLaunch, 'manual', 'new profiles default to Manual');
  const chosen = (await call('POST', '/profiles', { name: 'chose controlled', proxy, advancedSettings: { runtime: 'stable-chrome', proxyLaunch: 'controlled' } })).body;
  assert.equal(chosen.advancedSettings.proxyLaunch, 'controlled', 'an explicit choice is kept');

  // Two profiles saved before this change (no proxyLaunch stored) behave as Controlled.
  const { db } = await import('../server/db.js');
  const legacy = [];
  for (const name of ['legacy 1', 'legacy 2']) {
    const p = (await call('POST', '/profiles', { name, proxy, advancedSettings: { runtime: 'stable-chrome' } })).body;
    const adv = JSON.parse(db.prepare('SELECT advanced_settings FROM profiles WHERE id=?').get(p.id).advanced_settings);
    delete adv.proxyLaunch;
    db.prepare('UPDATE profiles SET advanced_settings=? WHERE id=?').run(JSON.stringify(adv), p.id);
    legacy.push(p.id);
  }
  const noProxy = (await call('POST', '/profiles', { name: 'direct', advancedSettings: { runtime: 'stable-chrome' } })).body;

  let offer = (await call('GET', '/profiles/proxy-launch-offer')).body;
  assert.deepEqual(offer, { controlled: 3, offered: true }, 'legacy + explicitly Controlled proxy profiles are counted');

  const switched = await call('POST', '/profiles/proxy-launch-offer', { action: 'switch' });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.switched, 3);
  for (const id of [...legacy, chosen.id]) {
    assert.equal((await call('GET', '/profiles/' + id)).body.advancedSettings.proxyLaunch, 'manual');
  }
  assert.equal((await call('GET', '/profiles/' + noProxy.id)).body.advancedSettings.proxyLaunch, 'manual', 'unchanged: created after the change');
  offer = (await call('GET', '/profiles/proxy-launch-offer')).body;
  assert.deepEqual(offer, { controlled: 0, offered: false }, 'answered once');

  // Keeping Controlled is remembered too.
  const later = (await call('POST', '/profiles', { name: 'later', proxy, advancedSettings: { runtime: 'stable-chrome', proxyLaunch: 'controlled' } })).body;
  assert.equal((await call('GET', '/profiles/proxy-launch-offer')).body.offered, false, 'not offered again after an answer');
  assert.equal((await call('GET', '/profiles/' + later.id)).body.advancedSettings.proxyLaunch, 'controlled');
  assert.equal((await call('POST', '/profiles/proxy-launch-offer', { action: 'bogus' })).status, 400);
});

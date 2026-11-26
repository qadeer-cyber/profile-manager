// The one-time proxy-launch offer: "Keep Controlled" changes no profile, and the answer survives an app restart
// (real server restarted on the same data folder). Synthetic profiles only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-offer-restart-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'offer-restart';
const { startServer } = await import('../server/app.js');
const { db } = await import('../server/db.js');

test('"Keep Controlled" is remembered across a restart and changes nothing', async () => {
  let server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  const call = async (method, route, body) => {
    const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const p = (await call('POST', '/profiles', { name: 'old controlled', proxy: { type: 'http', host: '198.51.100.9', port: 3128 }, advancedSettings: { runtime: 'stable-chrome' } })).body;
    const adv = JSON.parse(db.prepare('SELECT advanced_settings FROM profiles WHERE id=?').get(p.id).advanced_settings);
    delete adv.proxyLaunch; // saved before proxyLaunch existed
    db.prepare('UPDATE profiles SET advanced_settings=? WHERE id=?').run(JSON.stringify(adv), p.id);
    const before = db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id);
    assert.deepEqual((await call('GET', '/profiles/proxy-launch-offer')).body, { controlled: 1, offered: true });
    assert.deepEqual((await call('POST', '/profiles/proxy-launch-offer', { action: 'keep' })).body, { switched: 0 });
    assert.deepEqual(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id), before, 'Keep changes nothing');

    await server.close();
    server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
    assert.deepEqual((await call('GET', '/profiles/proxy-launch-offer')).body, { controlled: 1, offered: false }, 'not offered again after restart');
    assert.deepEqual(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id), before);
  } finally {
    await server.close();
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

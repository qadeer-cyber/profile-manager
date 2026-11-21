// Existing profiles are never changed silently (owner rule). Byte-level snapshot of profile rows and data folders
// around everything that could touch them; "Switch to Manual" may change exactly one field of eligible profiles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-non-mutation-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'non-mutation';
const { startServer } = await import('../server/app.js');
const { db, userDataDir } = await import('../server/db.js');
let server;
const call = async (method, route, body) => {
  const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => { await server?.close(); try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });

function tree(root) {
  if (!fs.existsSync(root)) return {};
  const out = {};
  for (const e of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const full = path.join(e.parentPath ?? e.path, e.name);
    out[path.relative(root, full)] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
  return out;
}
const snapshot = ids => ids.map(id => ({ row: db.prepare('SELECT * FROM profiles WHERE id=?').get(id), files: tree(userDataDir(id)) }));

test('nothing but an explicit "Switch to Manual" changes existing profiles, and it changes one field', async () => {
  const proxy = { type: 'http', host: '127.0.0.1', port: 18081 };
  const made = {};
  for (const [name, body] of Object.entries({
    legacyControlled: { proxy, advancedSettings: { runtime: 'stable-chrome' } },
    direct: { advancedSettings: { runtime: 'stable-chrome' } },
    firefox: { browserEngine: 'firefox', proxy },
    privacyRuntime: { proxy, advancedSettings: { runtime: 'privacy' } },
  })) {
    const r = await call('POST', '/profiles', { name, ...body });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.body)}`);
    made[name] = r.body.id;
    // Synthetic browser data (no real credentials): a cookie store, preferences and an encrypted-looking blob.
    const d = userDataDir(r.body.id);
    fs.mkdirSync(path.join(d, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(d, 'Default', 'Cookies'), `synthetic cookie db ${name}`);
    fs.writeFileSync(path.join(d, 'Default', 'Preferences'), JSON.stringify({ profile: { name } }));
    fs.writeFileSync(path.join(d, 'Default', 'Login Data'), Buffer.from([1, 2, 3, 4, 5]));
  }
  // Make the first one look like a profile saved before proxyLaunch existed.
  const adv = JSON.parse(db.prepare('SELECT advanced_settings FROM profiles WHERE id=?').get(made.legacyControlled).advanced_settings);
  delete adv.proxyLaunch;
  db.prepare('UPDATE profiles SET advanced_settings=? WHERE id=?').run(JSON.stringify(adv), made.legacyControlled);

  const ids = Object.values(made);
  const before = snapshot(ids);
  assert.equal((await call('GET', '/profiles/proxy-launch-offer')).status, 200);
  assert.equal((await call('GET', '/meta')).status, 200);
  assert.equal((await call('GET', '/profiles')).status, 200);
  assert.equal((await call('POST', '/profiles', { name: 'another', proxy })).status, 201);
  assert.deepEqual(snapshot(ids), before, 'reading, listing and creating another profile change nothing');

  // "Switch" changes only proxyLaunch, only on the eligible (Chrome, proxied, non-native-runtime) profile.
  const switched = await call('POST', '/profiles/proxy-launch-offer', { action: 'switch' });
  assert.equal(switched.status, 200);
  const after = snapshot(ids);
  ids.forEach((id, i) => {
    assert.deepEqual(after[i].files, before[i].files, 'browser data untouched');
    const a = { ...after[i].row }, b = { ...before[i].row };
    if (id === made.legacyControlled) {
      const aAdv = JSON.parse(a.advanced_settings), bAdv = JSON.parse(b.advanced_settings);
      assert.equal(aAdv.proxyLaunch, 'manual');
      delete aAdv.proxyLaunch;
      assert.deepEqual(aAdv, bAdv, 'no other advanced setting changed');
      delete a.advanced_settings; delete b.advanced_settings;
    }
    assert.deepEqual(a, b, `profile row ${id}`);
  });
});

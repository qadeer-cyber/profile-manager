import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, migrations } from '../server/migrations.js';
import { DEFAULT_ADVANCED_SETTINGS } from '../server/advanced-settings.js';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m3-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm3-local-test-token' };
let proc;
const settings = { locale: 'en-US', timezoneId: 'Asia/Karachi', languages: ['en-US', 'ur-PK'] };
async function req(method, url, body, auth = true) {
  const r = await fetch(proc.url + '/api/v1' + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer m3-local-test-token' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });
let id;
test('create, read and settings-only clone preserve regional settings', async () => {
  const c = await req('POST', '/profiles', { name: 'Regional', browserSettings: settings });
  assert.equal(c.status, 201); id = c.body.id;
  assert.deepEqual(c.body.browserSettings, settings); assert.equal(c.body.automationEnabled, false);
  assert.ok(!('browser_settings' in c.body));
  const clone = await req('POST', `/profiles/${id}/clone`, { copyData: false });
  assert.equal(clone.status, 201); assert.deepEqual(clone.body.browserSettings, settings);
});
test('partial profile and regional updates preserve omitted settings', async () => {
  let r = await req('PATCH', `/profiles/${id}`, { notes: 'retained' });
  assert.deepEqual(r.body.browserSettings, settings);
  r = await req('PATCH', `/profiles/${id}`, { browserSettings: { timezoneId: 'UTC' } });
  assert.deepEqual(r.body.browserSettings, { ...settings, timezoneId: 'UTC' });
});
test('invalid settings reject atomically and auth remains required', async () => {
  for (const browserSettings of [null, { timezoneId: 'invalid' }, { languages: ['ur'] }, { locale: 'en_US' }]) {
    const r = await req('PATCH', `/profiles/${id}`, { name: 'must not save', browserSettings });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'INVALID_BROWSER_SETTINGS');
  }
  assert.equal((await req('GET', `/profiles/${id}`)).body.name, 'Regional');
  assert.equal((await req('PATCH', `/profiles/${id}`, { browserSettings: settings }, false)).status, 401);
});
test('settings survive an actual server shutdown and restart', async () => {
  assert.equal(await stopServer(proc), true); proc = await spawnServer(env);
  const r = await req('GET', `/profiles/${id}`);
  assert.deepEqual(r.body.browserSettings, { ...settings, timezoneId: 'UTC' });
  assert.equal(r.body.notes, 'retained');
});
test('host defaults and explicit reset persist; bulk validation rejects before insertion', async () => {
  const c = await req('POST', '/profiles', { name: 'Default' });
  const defaults = { locale: '', timezoneId: '', languages: [] };
  assert.deepEqual(c.body.browserSettings, defaults);
  assert.deepEqual((await req('PUT', `/profiles/${id}`, { browserSettings: defaults })).body.browserSettings, defaults);
  const before = (await req('GET', '/profiles')).body.length;
  assert.equal((await req('POST', '/bulk/create', { profiles: [{ name: 'valid' }, { name: 'invalid', browserSettings: { timezoneId: 'bad' } }] })).status, 400);
  assert.equal((await req('GET', '/profiles')).body.length, before);
});
test('M1 database upgrade is additive, backed up, idempotent and preserves profile values', () => {
  const file = path.join(dir, 'upgrade.db'); const db = new Database(file);
  try {
    migrate(db, migrations.filter(m => m.version <= 7));
    db.prepare("INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES ('legacy','Legacy','[]','Folder','Notes','t','t')").run();
    const previous = db.prepare('SELECT * FROM profiles').get();
    const m = migrate(db); assert.deepEqual(m.applied, [8, 9, 10, 11, 12]); assert.ok(fs.existsSync(m.backup));
    const row = db.prepare('SELECT * FROM profiles').get();
    const { browser_settings, webrtc_settings, advanced_settings, ...original } = row;
    assert.deepEqual(original, previous);
    assert.deepEqual(JSON.parse(browser_settings), { locale: '', timezoneId: '', languages: [] });
    assert.deepEqual(JSON.parse(webrtc_settings), { mode: 'browser_default' });
    assert.deepEqual(JSON.parse(advanced_settings), DEFAULT_ADVANCED_SETTINGS);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM extensions").get().n, 0);
    assert.deepEqual(migrate(db).applied, []);
    const old = new Database(m.backup, { readonly: true });
    try { assert.deepEqual(old.prepare('SELECT * FROM profiles').get(), previous); } finally { old.close(); }
  } finally { db.close(); }
});

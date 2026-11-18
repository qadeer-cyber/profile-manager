import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, migrations } from '../server/migrations.js';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m4-api-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm4-local-test-token' };
let proc;
const regional = { locale: 'en-US', timezoneId: 'Asia/Karachi', languages: ['en-US', 'ur-PK'] };
async function req(method, url, body, auth = true) {
  const r = await fetch(proc.url + '/api/v1' + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer m4-local-test-token' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

let alpha, bravo;
test('profiles keep independent WebRTC policies and M3 regional settings', async () => {
  const a = await req('POST', '/profiles', { name: 'Alpha', browserSettings: regional, webrtcSettings: { mode: 'disable_non_proxied_udp' }, automationEnabled: false });
  assert.equal(a.status, 201);
  alpha = a.body.id;
  assert.equal(a.body.automationEnabled, false);
  assert.deepEqual(a.body.browserSettings, regional);
  assert.deepEqual(a.body.webrtcSettings, { mode: 'disable_non_proxied_udp' });
  assert.ok(!('webrtc_settings' in a.body));
  const b = await req('POST', '/profiles', { name: 'Bravo' });
  assert.equal(b.status, 201);
  bravo = b.body.id;
  assert.deepEqual(b.body.webrtcSettings, { mode: 'browser_default' });
  assert.deepEqual(b.body.browserSettings, { locale: '', timezoneId: '', languages: [] });
  assert.notDeepEqual(a.body.webrtcSettings, b.body.webrtcSettings);
});

test('unsupported WebRTC modes are rejected without changing the profile', async () => {
  for (const mode of ['disabled', 'off', 'spoof', 'default_public_interface_only ', '']) {
    const r = await req('PATCH', `/profiles/${alpha}`, { name: 'must not save', webrtcSettings: { mode } });
    assert.equal(r.status, 400, mode);
    assert.equal(r.body.code, 'INVALID_WEBRTC_SETTINGS');
  }
  const got = await req('GET', `/profiles/${alpha}`);
  assert.equal(got.body.name, 'Alpha');
  assert.deepEqual(got.body.webrtcSettings, { mode: 'disable_non_proxied_udp' });
  assert.deepEqual(got.body.browserSettings, regional);
  assert.equal((await req('PATCH', `/profiles/${alpha}`, { webrtcSettings: { mode: 'default' } }, false)).status, 401);
});

test('partial updates do not clobber the other profile or omitted settings', async () => {
  const r = await req('PATCH', `/profiles/${alpha}`, { notes: 'kept', browserSettings: { timezoneId: 'UTC' } });
  assert.equal(r.body.notes, 'kept');
  assert.deepEqual(r.body.browserSettings, { ...regional, timezoneId: 'UTC' });
  assert.deepEqual(r.body.webrtcSettings, { mode: 'disable_non_proxied_udp' });
  assert.deepEqual((await req('GET', `/profiles/${bravo}`)).body.webrtcSettings, { mode: 'browser_default' });
  assert.deepEqual((await req('PATCH', `/profiles/${bravo}`, { webrtcSettings: { mode: 'default_public_interface_only' } })).body.webrtcSettings, { mode: 'default_public_interface_only' });
  assert.deepEqual((await req('GET', `/profiles/${alpha}`)).body.webrtcSettings, { mode: 'disable_non_proxied_udp' });
});

test('WebRTC policy survives a server restart and clone', async () => {
  assert.equal(await stopServer(proc), true);
  proc = await spawnServer(env);
  const got = await req('GET', `/profiles/${alpha}`);
  assert.deepEqual(got.body.webrtcSettings, { mode: 'disable_non_proxied_udp' });
  assert.equal(got.body.notes, 'kept');
  assert.deepEqual(got.body.browserSettings.languages, regional.languages);
  const clone = await req('POST', `/profiles/${alpha}/clone`, { copyData: false });
  assert.equal(clone.status, 201);
  assert.deepEqual(clone.body.webrtcSettings, got.body.webrtcSettings);
  assert.notEqual(clone.body.id, alpha);
});

test('invalid WebRTC policy rejects a bulk create before any insert', async () => {
  const before = (await req('GET', '/profiles')).body.length;
  const bulk = await req('POST', '/bulk/create', { profiles: [{ name: 'ok' }, { name: 'bad', webrtcSettings: { mode: 'disabled' } }] });
  assert.equal(bulk.status, 400);
  assert.equal(bulk.body.code, 'INVALID_WEBRTC_SETTINGS');
  assert.equal((await req('GET', '/profiles')).body.length, before);
});

test('v8 database gains WebRTC and extension tables without rewriting profile values', () => {
  const file = path.join(dir, 'from-v8.db');
  const db = new Database(file);
  try {
    migrate(db, migrations.filter(m => m.version <= 8));
    db.prepare("INSERT INTO profiles (id,name,tags,folder,notes,browser_settings,created_at,updated_at) VALUES ('legacy','Legacy','[]','Folder','Notes','{\"locale\":\"de-DE\",\"timezoneId\":\"Europe/Berlin\",\"languages\":[\"de-DE\"]}','t','t')").run();
    const previous = db.prepare('SELECT id,name,folder,notes,browser_settings FROM profiles').get();
    const m = migrate(db);
    assert.deepEqual(m.applied, migrations.filter(step => step.version > 8).map(step => step.version));
    assert.ok(fs.existsSync(m.backup));
    const row = db.prepare('SELECT id,name,folder,notes,browser_settings,webrtc_settings,advanced_settings FROM profiles').get();
    assert.equal(row.name, previous.name);
    assert.equal(row.browser_settings, previous.browser_settings);
    assert.deepEqual(JSON.parse(row.webrtc_settings), { mode: 'browser_default' });
    assert.equal(JSON.parse(row.advanced_settings).userAgent.mode, 'default');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extensions'").get().name, 'extensions');
    assert.deepEqual(migrate(db).applied, []);
  } finally { db.close(); }
});

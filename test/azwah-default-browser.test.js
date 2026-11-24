// Owner decision 2026-11-24: AZWAH Chromium is the default browser for NEW profiles when the installation carries
// it. Existing profiles, explicit choices, Firefox and automation profiles are not changed. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sandboxAccessArgs } from '../server/browser-runtime/azwah-native.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-azwah-default-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'azwah-default';
const { startServer } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const runtimeOf = id => JSON.parse(db.prepare('SELECT advanced_settings FROM profiles WHERE id=?').get(id).advanced_settings).runtime;

test('new profiles default to AZWAH Chromium only when it is installed; nothing else changes', async () => {
  const server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  const call = async (method, route, body) => {
    const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    delete process.env.PM_TEST_AZWAH_NATIVE_AVAILABLE;
    const before = (await call('POST', '/profiles', { name: 'made before AZWAH Chromium was installed' })).body;
    assert.equal(runtimeOf(before.id), 'compatibility', 'without the browser the previous default stays');

    process.env.PM_TEST_AZWAH_NATIVE_AVAILABLE = '1';
    const plain = (await call('POST', '/profiles', { name: 'new default' })).body;
    assert.equal(runtimeOf(plain.id), 'azwah-native');
    const viaDefault = (await call('POST', '/profiles', { name: 'Default chosen', advancedSettings: { runtime: 'compatibility' } })).body;
    assert.equal(runtimeOf(viaDefault.id), 'azwah-native');
    const stable = (await call('POST', '/profiles', { name: 'explicit stable', advancedSettings: { runtime: 'stable-chrome' } })).body;
    assert.equal(runtimeOf(stable.id), 'stable-chrome', 'an explicit choice is kept');
    const automated = (await call('POST', '/profiles', { name: 'automation', automationEnabled: true })).body;
    assert.equal(runtimeOf(automated.id), 'compatibility', 'AZWAH Chromium is manual-only');
    const firefox = (await call('POST', '/profiles', { name: 'fx', browserEngine: 'firefox' })).body;
    assert.equal(runtimeOf(firefox.id), 'compatibility');

    const row = db.prepare('SELECT * FROM profiles WHERE id=?').get(before.id);
    assert.equal((await call('PUT', '/profiles/' + before.id, { name: 'renamed', notes: 'edited' })).status, 200);
    assert.equal(runtimeOf(before.id), 'compatibility', 'editing an existing profile never switches its browser');
    assert.equal(db.prepare('SELECT browser_engine FROM profiles WHERE id=?').get(before.id).browser_engine, row.browser_engine);
  } finally {
    delete process.env.PM_TEST_AZWAH_NATIVE_AVAILABLE;
    await server.close();
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

test('the test switch is ignored in a packaged app', async () => {
  const { azwahNativeTestAvailable } = await import('../server/testflags.js');
  assert.equal(azwahNativeTestAvailable({ PM_TEST_AZWAH_NATIVE_AVAILABLE: '1', PM_PACKAGED: '1' }), false);
  assert.equal(azwahNativeTestAvailable({ PM_TEST_AZWAH_NATIVE_AVAILABLE: '1', PM_PACKAGED: '0' }), true);
});

test('sandbox folder access grants read/execute only, to the two AppContainer groups, and keeps the sandbox', () => {
  assert.deepEqual(sandboxAccessArgs('C:\\AZWAH\\resources\\native-chromium'),
    ['C:\\AZWAH\\resources\\native-chromium', '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '*S-1-15-2-2:(OI)(CI)(RX)', '/T', '/C', '/Q']);
  const src = fs.readFileSync(new URL('../server/browser-runtime/azwah-native.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /no-sandbox/);
});

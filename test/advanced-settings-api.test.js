import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { DEFAULT_ADVANCED_SETTINGS } from '../server/advanced-settings.js';
import { MANIFEST } from '../server/chromium.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m6-api-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm6-api' };
let proc;
const req = async (method, url, body) => {
  const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m6-api', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

test('advanced settings persist across restart and reject invalid values without saving', async () => {
  const created = await req('POST', '/profiles', { name: 'Advanced', advancedSettings: { userAgent: { mode: 'reduced' }, screen: { preset: '1440x900' }, preferences: { startupUrls: ['https://example.com/start'] } } });
  assert.equal(created.status, 201);
  assert.equal(created.body.advancedSettings.userAgent.mode, 'reduced');
  assert.equal(created.body.advancedSettings.screen.width, 1440);
  assert.deepEqual(created.body.advancedSettings.preferences.startupUrls, ['https://example.com/start']);
  assert.equal(created.body.browserSettings.locale, '');
  const id = created.body.id;
  const bad = await req('PATCH', `/profiles/${id}`, { name: 'nope', advancedSettings: { geolocation: { permission: 'allow', latitude: 200, longitude: 0 } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_ADVANCED_SETTINGS');
  assert.equal((await req('GET', `/profiles/${id}`)).body.name, 'Advanced');
  assert.equal(await stopServer(proc), true);
  proc = await spawnServer(env);
  const again = await req('GET', `/profiles/${id}`);
  assert.equal(again.body.advancedSettings.userAgent.mode, 'reduced');
  assert.equal(again.body.advancedSettings.screen.preset, '1440x900');
  const fresh = await req('POST', '/profiles', { name: 'Plain' });
  assert.deepEqual(fresh.body.advancedSettings, DEFAULT_ADVANCED_SETTINGS);
  const identity = await req('GET', '/chromium-identity');
  assert.equal(identity.body.pinnedVersion, MANIFEST.browserVersion);
  assert.match(identity.body.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.match(identity.body.presets.full, new RegExp(identity.body.version.replace(/\./g, '\\.')));
  assert.equal(identity.body.presets.reduced.includes(identity.body.version), false);
});

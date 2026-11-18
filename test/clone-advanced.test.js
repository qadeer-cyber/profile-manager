import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m7-clone-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm7-clone' };
let proc;
async function req(method, url, body) {
  const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m7-clone', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

test('settings clone starts empty, data clone copies files, and symlinks are refused', async () => {
  const source = await req('POST', '/profiles', { name: 'Source', advancedSettings: { userAgent: { mode: 'full' } }, browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US'] } });
  const folder = path.join(dir, 'profiles', source.body.id, 'Default');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'marker.txt'), 'profile-data');
  const settings = await req('POST', `/profiles/${source.body.id}/clone`, { mode: 'settings' });
  assert.equal(settings.status, 201);
  assert.equal(settings.body.advancedSettings.userAgent.mode, 'full');
  assert.equal(fs.existsSync(path.join(dir, 'profiles', settings.body.id, 'Default', 'marker.txt')), false);
  const data = await req('POST', `/profiles/${source.body.id}/clone`, { mode: 'data', copyData: true });
  assert.equal(data.status, 201);
  assert.notEqual(data.body.id, source.body.id);
  assert.equal(fs.readFileSync(path.join(dir, 'profiles', data.body.id, 'Default', 'marker.txt'), 'utf8'), 'profile-data');
  fs.symlinkSync('/etc/passwd', path.join(folder, 'escape'));
  const refused = await req('POST', `/profiles/${source.body.id}/clone`, { copyData: true });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'UNSAFE_PROFILE_LINK');
  const still = await req('POST', `/profiles/${source.body.id}/clone`, { copyData: false });
  assert.equal(still.status, 201);
  assert.equal(fs.existsSync(path.join(dir, 'profiles', still.body.id, 'Default', 'escape')), false);
  assert.equal((await req('POST', `/profiles/${source.body.id}/clone`, { mode: 'settings', copyData: true })).status, 400);
});

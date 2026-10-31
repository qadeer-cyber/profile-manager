import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m7-cookies-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm7-cookies' };
const secret = 'api-secret-cookie-value';
let proc;
async function req(method, url, body) {
  const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m7-cookies', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, text };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

test('import, export, and clear keep cookie flags and require confirmation', async () => {
  const profile = await req('POST', '/profiles', { name: 'Cookies' });
  const id = profile.body.id;
  const cookie = { name: 'sid', value: secret, domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: Math.floor(Date.now() / 1000) + 86400 };
  const bad = await req('POST', `/profiles/${id}/cookies/import`, { cookies: [{ ...cookie, sameSite: 'None', secure: false }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.text.includes(secret), false);
  const imported = await req('POST', `/profiles/${id}/cookies/import`, { version: 1, cookies: [cookie, { ...cookie, name: 'plain', value: 'visible', httpOnly: false, sameSite: 'Lax', secure: false, domain: '.example.test', hostOnly: false }] });
  assert.equal(imported.body.imported, 2);
  const listed = await req('GET', `/profiles/${id}/cookies`);
  const sid = listed.body.cookies.find(item => item.name === 'sid');
  assert.equal(sid.value, secret);
  assert.equal(sid.httpOnly, true);
  assert.equal(sid.sameSite, 'Strict');
  assert.equal(sid.secure, true);
  const unconfirmed = await req('POST', `/profiles/${id}/cookies/clear`, { cookies: [{ name: 'sid', domain: 'example.test', path: '/', value: secret }] });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.text.includes(secret), false);
  assert.equal((await req('GET', `/profiles/${id}/cookies`)).body.cookies.length, 2);
  const cleared = await req('POST', `/profiles/${id}/cookies/clear`, { confirm: 'clear-selected', cookies: [{ name: 'sid', domain: 'example.test', path: '/' }] });
  assert.equal(cleared.body.cleared, 1);
  assert.equal((await req('GET', `/profiles/${id}/cookies`)).body.cookies.map(item => item.name).join(), 'plain');
  assert.equal((await req('POST', `/profiles/${id}/cookies/clear`, { confirm: 'clear-all' })).body.cleared, 1);
  assert.equal(proc.out.includes(secret), false);
});

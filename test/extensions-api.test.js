import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m5-api-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm5-local-test-token' };
let proc;
const manifest = (name, permissions, host = []) => ({ manifest_version: 3, name, version: '2.0.0', permissions, host_permissions: host });
function source(name, body) {
  const root = path.join(dir, 'sources', name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(body));
  fs.writeFileSync(path.join(root, 'page.js'), '/* fixture */\n');
  return root;
}
async function req(method, url, body, auth = true, ui = false) {
  const r = await fetch(proc.url + (ui ? '/api' : '/api/v1') + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer m5-local-test-token' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

let notes, ads, alpha, bravo;
test('library import lists version and permissions for more than one extension', async () => {
  notes = (await req('POST', '/extensions/import', { path: source('notes', manifest('Notes', ['storage'], ['https://notes.example/*'])) })).body;
  ads = (await req('POST', '/extensions/import', { path: source('ads', manifest('Ads', ['tabs'])) })).body;
  assert.equal(notes.version, '2.0.0');
  assert.deepEqual(notes.permissions, ['storage']);
  assert.deepEqual(notes.hostPermissions, ['https://notes.example/*']);
  assert.deepEqual(ads.permissions, ['tabs']);
  const list = await req('GET', '/extensions');
  assert.equal(list.body.length, 2);
  assert.equal((await req('POST', '/extensions/import', { path: 'relative/nope' })).status, 400);
  assert.equal((await req('POST', '/extensions/import', { path: path.join(dir, 'missing') })).body.code, 'INVALID_EXTENSION');
});

test('assignments are isolated per profile and survive restart', async () => {
  alpha = (await req('POST', '/profiles', { name: 'Alpha', extensionAssignments: [{ extensionId: notes.id, enabled: true }, { extensionId: ads.id, enabled: false }] })).body;
  bravo = (await req('POST', '/profiles', { name: 'Bravo', extensionAssignments: [{ extensionId: ads.id, enabled: true }] })).body;
  assert.deepEqual(alpha.extensions.map(item => [item.name, item.enabled, item.permissions]), [['Ads', false, ['tabs']], ['Notes', true, ['storage']]]);
  assert.deepEqual(bravo.extensions.map(item => item.name), ['Ads']);
  assert.equal(bravo.extensions[0].enabled, true);
  assert.equal((await req('GET', `/profiles/${alpha.id}`)).body.extensions.some(item => item.id === ads.id && item.enabled), false);
  const patched = await req('PATCH', `/profiles/${alpha.id}/extensions/${ads.id}`, { enabled: true });
  assert.equal(patched.body.extensions.find(item => item.id === ads.id).enabled, true);
  assert.equal((await req('PATCH', `/profiles/${bravo.id}/extensions/${notes.id}`, { enabled: true })).status, 404);
  assert.equal(await stopServer(proc), true);
  proc = await spawnServer(env);
  const again = await req('GET', `/profiles/${alpha.id}`);
  assert.equal(again.body.extensions.find(item => item.id === notes.id).enabled, true);
  assert.equal(again.body.extensions.find(item => item.id === ads.id).enabled, true);
  assert.deepEqual(again.body.extensions.find(item => item.id === notes.id).hostPermissions, ['https://notes.example/*']);
  assert.deepEqual((await req('GET', `/profiles/${bravo.id}`)).body.extensions.map(item => item.id), [ads.id]);
  const clone = await req('POST', `/profiles/${alpha.id}/clone`, { copyData: false });
  assert.equal(clone.status, 201);
  assert.deepEqual(clone.body.extensions.map(item => [item.id, item.enabled]), again.body.extensions.map(item => [item.id, item.enabled]));
  assert.notEqual(clone.body.id, alpha.id);
  assert.equal((await req('DELETE', `/profiles/${clone.body.id}`)).status, 204);
  assert.equal((await req('DELETE', `/trash/${clone.body.id}`, { confirmName: clone.body.name }, true, true)).status, 200);
});

test('cleanup removes assignments and copied files without deleting the other extension', async () => {
  const stored = path.join(dir, 'extensions', notes.id);
  assert.equal(fs.existsSync(path.join(stored, 'manifest.json')), true);
  assert.equal((await req('DELETE', `/extensions/${notes.id}`)).status, 409);
  assert.equal(fs.existsSync(stored), true);
  assert.equal((await req('DELETE', `/profiles/${alpha.id}/extensions/${notes.id}`)).status, 200);
  const removed = await req('DELETE', `/extensions/${notes.id}`);
  assert.equal(removed.status, 204);
  assert.equal(fs.existsSync(stored), false);
  const bravoNow = await req('GET', `/profiles/${bravo.id}`);
  assert.deepEqual(bravoNow.body.extensions.map(item => item.id), [ads.id]);
  assert.equal((await req('DELETE', `/profiles/${alpha.id}`)).status, 204);
  assert.equal((await req('DELETE', `/profiles/${bravo.id}`)).status, 204);
  // Trash retains assignments for recovery; only a confirmed purge removes them.
  assert.equal((await req('DELETE', `/trash/${alpha.id}`, { confirmName: alpha.name }, true, true)).status, 200);
  assert.equal((await req('DELETE', `/trash/${bravo.id}`, { confirmName: bravo.name }, true, true)).status, 200);
  const adsRow = await req('GET', `/extensions/${ads.id}`);
  assert.equal(adsRow.body.assignedProfiles, 0);
  assert.equal(fs.existsSync(path.join(dir, 'extensions', ads.id, 'manifest.json')), true);
  assert.equal((await req('DELETE', `/extensions/${ads.id}`)).status, 204);
  assert.equal(fs.existsSync(path.join(dir, 'extensions', ads.id)), false);
  assert.deepEqual((await req('GET', '/extensions')).body, []);
});

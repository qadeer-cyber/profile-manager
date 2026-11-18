import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { mapPool } from '../server/bulk.js';

test('mapPool keeps at most the requested number of operations in flight', async () => {
  let active = 0; let max = 0;
  const results = await mapPool([1, 2, 3, 4, 5], 2, async value => {
    active += 1; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    return { ok: true, value };
  });
  assert.equal(max, 2);
  assert.deepEqual(results.map(item => item.value), [1, 2, 3, 4, 5]);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m7-bulk-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm7-bulk' };
let proc;
async function req(method, url, body) {
  const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m7-bulk', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

test('csv and json imports report each row and assignments are bounded', async () => {
  const csv = 'name,folder,tags,notes,locale,timezoneId,languages\nAlpha,Work,a|b,hello,en-US,UTC,en-US\n,Bad folder,,,,,\n=Danger,Work,,,,,\n';
  const hostile = await req('POST', '/bulk/import', { format: 'csv', csv });
  assert.equal(hostile.status, 400);
  const mixed = await req('POST', '/bulk/import', { format: 'csv', csv: 'name,folder,tags\nAlpha,Work,a|b\n,Missing,\nBeta,Lab,c\n' });
  assert.equal(mixed.status, 200);
  assert.deepEqual(mixed.body.map(row => row.ok), [true, false, true]);
  assert.equal(mixed.body[0].profile.folder, 'Work');
  assert.deepEqual(mixed.body[0].profile.tags, ['a', 'b']);
  const names = (await req('GET', '/profiles')).body.map(profile => profile.name);
  assert.ok(names.includes('Alpha') && names.includes('Beta') && !names.includes(''));
  const json = await req('POST', '/bulk/import', { format: 'json', profiles: [{ name: 'Gamma', advancedSettings: { userAgent: { mode: 'full' } } }, { name: 'Bad', advancedSettings: { screen: { preset: 'nope' } } }] });
  assert.deepEqual(json.body.map(row => row.ok), [true, false]);
  assert.equal(json.body[0].profile.advancedSettings.userAgent.mode, 'full');
  const proxy = await req('POST', '/proxies', { name: 'Local', type: 'http', host: '127.0.0.1', port: 8080 });
  const ids = [mixed.body[0].profile.id, 'missing-id'];
  const assigned = await req('POST', '/bulk/assign', { ids, folder: 'Moved', addTags: ['bulk'], proxyId: proxy.body.id });
  assert.equal(assigned.body[0].ok, true);
  assert.equal(assigned.body[0].profile.folder, 'Moved');
  assert.ok(assigned.body[0].profile.tags.includes('bulk'));
  assert.equal(assigned.body[0].profile.proxyId, proxy.body.id);
  assert.equal(assigned.body[1].ok, false);
  assert.equal((await req('POST', '/bulk/launch', { ids: ['x'], concurrency: 9 })).status, 400);
  assert.equal((await req('POST', '/bulk/stop', { ids: [], concurrency: 0 })).status, 400);
  const allOrNothing = await req('POST', '/bulk/create', { profiles: [{ name: 'Kept' }, { name: '' }] });
  assert.equal(allOrNothing.status, 400);
});

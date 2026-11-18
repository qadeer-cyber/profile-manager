import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m6-hw-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm6-hw' };
let proc;
const req = async (method, url, body) => {
  const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m6-hw', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
before(async () => { proc = await spawnServer(env); });
after(async () => { await stopServer(proc); fs.rmSync(dir, { recursive: true, force: true }); });

test('stopped profiles report host facts and do not invent browser hardware', async () => {
  const created = await req('POST', '/profiles', { name: 'Hardware' });
  const report = await req('GET', `/profiles/${created.body.id}/hardware`);
  assert.equal(report.status, 200);
  assert.equal(report.body.host.hardwareConcurrency.availability, 'observed');
  assert.equal(report.body.host.hardwareConcurrency.value, os.cpus().length);
  assert.equal(report.body.browser.availability, 'unavailable');
  assert.equal(report.body.browser.reason, 'not_running');
  assert.equal(report.body.configured.userAgent.mode, 'default');
  const facts = report.body.unsupported.map(item => item.fact);
  assert.ok(facts.includes('fonts') && facts.includes('hardwareConcurrency') && facts.includes('webgl'));
  assert.equal(JSON.stringify(report.body).includes('undetectable'), false);
  assert.equal(report.body.browser.hardwareConcurrency, undefined);
});

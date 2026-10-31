import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m9-batch-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm9-batch';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m9-batch', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('batch keeps going after a structured error and tracks status', async () => {
  const secret = 'batch-proxy-password-hidden';
  const outcome = await call('POST', '/api/v1/batch', { track: true, operations: [
    { op: 'createProfile', body: { name: 'Batched', proxy: { type: 'http', host: '127.0.0.1', port: 9, password: secret } } },
    { op: 'updateProfile', body: { name: '' } },
    { op: 'nope' },
    { op: 'launch', id: 'missing' },
  ] });
  assert.equal(outcome.status, 207);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.results[0].ok, true);
  assert.equal(outcome.body.results[1].ok, false);
  assert.equal(outcome.body.results[2].code, 'UNSUPPORTED_OPERATION');
  assert.equal(outcome.body.results[3].ok, false);
  assert.equal(outcome.text.includes(secret), false);
  assert.equal(typeof outcome.body.jobId, 'string');
  const job = await call('GET', `/api/v1/bulk/jobs/${outcome.body.jobId}`);
  assert.equal(job.body.action, 'batch');
  assert.equal(job.body.items.length, 4);
  assert.equal(job.text.includes(secret), false);
  const id = outcome.body.results[0].result.profile.id;
  const renamed = await call('POST', '/api/v1/batch', { operations: [{ op: 'updateProfile', id, body: { name: 'Renamed' } }, { op: 'stop', id }] });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.results[0].result.profile.name, 'Renamed');
});

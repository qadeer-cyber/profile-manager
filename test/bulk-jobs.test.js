import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-jobs-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'm8-jobs';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer m8-jobs', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function settle(id) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await call('GET', `/api/v1/bulk/jobs/${id}`);
    if (job.body.status === 'done' || job.body.status === 'failed') return job.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('job did not finish');
}

test('bulk jobs report per-item errors and keep the concurrency cap', async () => {
  const created = await call('POST', '/api/v1/profiles', { name: 'Jobbed' });
  const bad = await call('POST', '/api/v1/bulk/jobs', { action: 'launch', ids: [created.body.id], concurrency: 9 });
  assert.equal(bad.status, 400);
  const started = await call('POST', '/api/v1/bulk/jobs', { action: 'assign', ids: [created.body.id, 'missing-id'], folder: 'Archive' });
  assert.equal(started.status, 202);
  const job = await settle(started.body.id);
  assert.equal(job.status, 'done');
  assert.equal(job.total, 2);
  assert.equal(job.done, 2);
  assert.equal(job.items.filter(item => item.ok).length, 1);
  assert.equal(job.items.filter(item => !item.ok).length, 1);
  assert.equal(job.items.find(item => !item.ok).id, 'missing-id');
  const removed = await call('POST', '/api/v1/bulk/jobs', { action: 'delete', ids: [created.body.id], concurrency: 2 });
  const finished = await settle(removed.body.id);
  assert.equal(finished.items[0].ok, true);
  assert.equal((await call('GET', `/api/v1/profiles/${created.body.id}`)).status, 404);
});

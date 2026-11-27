// runProxyTests (web/src/lib/proxyBatch.js): bounded concurrency, real progress, cancel, failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProxyTests, batchSummary } from '../web/src/lib/proxyBatch.js';
import { plural } from '../web/src/lib.js';

const tick = (ms = 1) => new Promise(r => setTimeout(r, ms));

test('never runs more tests at once than the limit, and tests every proxy exactly once', async () => {
  let active = 0, peak = 0; const seen = [];
  const r = await runProxyTests(Array.from({ length: 20 }, (_, i) => 'p' + i), async id => { active++; peak = Math.max(peak, active); seen.push(id); await tick(3); active--; return { ok: true }; }, { concurrency: 4 });
  assert.equal(peak, 4);
  assert.deepEqual([...seen].sort(), Array.from({ length: 20 }, (_, i) => 'p' + i).sort());
  assert.deepEqual([r.total, r.done, r.ok, r.failed.length, r.cancelled], [20, 20, 20, 0, false]);
});

test('duplicates are tested once; an empty list does nothing', async () => {
  let calls = 0;
  const r = await runProxyTests(['a', 'a', 'b'], async () => { calls++; return { ok: true }; });
  assert.equal(calls, 2); assert.equal(r.total, 2);
  assert.deepEqual(await runProxyTests([], async () => { throw new Error('never'); }), { total: 0, done: 0, ok: 0, failed: [], cancelled: false });
});

test('failures are collected: a failed result, a failed status and a thrown error all count, and none stops the batch', async () => {
  const results = { a: { ok: true }, b: { ok: false, error: 'timeout', message: 'No response' }, c: { ok: true, status: 'failed', error: 'auth' } };
  const r = await runProxyTests(['a', 'b', 'c', 'd'], async id => { if (id === 'd') throw Object.assign(new Error('boom'), { code: 'X' }); return results[id]; });
  assert.deepEqual([r.done, r.ok], [4, 1]);
  assert.deepEqual(r.failed.map(f => [f.id, f.error]).sort(), [['b', 'timeout'], ['c', 'auth'], ['d', 'X']]);
  assert.equal(r.failed.find(f => f.id === 'b').message, 'No response');
});

test('progress is reported after every test and is monotonic', async () => {
  const seen = [];
  await runProxyTests(['a', 'b', 'c'], async id => ({ ok: id !== 'b' }), { concurrency: 1, onProgress: p => seen.push(p) });
  assert.deepEqual(seen, [{ total: 3, done: 1, ok: 1, failed: 0 }, { total: 3, done: 2, ok: 1, failed: 1 }, { total: 3, done: 3, ok: 2, failed: 1 }]);
});

test('cancelling stops new tests but lets running ones finish and be counted', async () => {
  let stop = false; const started = [];
  const r = await runProxyTests(Array.from({ length: 10 }, (_, i) => 'p' + i), async id => { started.push(id); if (started.length === 3) stop = true; await tick(2); return { ok: true }; }, { concurrency: 2, shouldStop: () => stop });
  assert.equal(r.cancelled, true);
  assert.ok(r.done < 10 && r.done >= 3, `done=${r.done}`);
  assert.equal(r.done, started.length, 'every started test is counted');
});

test('summary text', () => {
  assert.equal(batchSummary({ total: 48, done: 48, ok: 41, failed: new Array(7), cancelled: false }), 'Tested 48: 41 working, 7 failing.');
  assert.equal(batchSummary({ total: 10, done: 4, ok: 4, failed: [], cancelled: true }), 'Stopped after 4 of 10: 4 working.');
  assert.equal(batchSummary({ total: 0, done: 0, ok: 0, failed: [] }), 'No proxies to test.');
});

test('plural: proxy becomes proxies, other words add s, one stays singular', () => {
  assert.equal(plural(12, 'proxy'), '12 proxies');
  assert.equal(plural(1, 'proxy'), '1 proxy');
  assert.equal(plural(0, 'proxy'), '0 proxies');
  assert.equal(plural(3, 'profile'), '3 profiles');
  assert.equal(plural(2, 'day'), '2 days', 'vowel + y keeps its y');
  assert.equal(plural(1, 'profile'), '1 profile');
});

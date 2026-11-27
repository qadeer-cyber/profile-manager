// Fleet view: header model, proxy-test state, and the server filter/count for "proxy failed its last test".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetModel, proxyTestState, SCOPE_STATUS } from '../web/src/lib/fleet.js';
import { queryProfiles } from '../server/profile-table.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('the bar splits run state; proxy failed is a separate, clickable count and never part of the bar', () => {
  const m = fleetModel({ total: 10, running: 3, errors: 2, proxyFailed: 4 });
  assert.deepEqual(m.segments, [{ key: 'run', pct: 30 }, { key: 'err', pct: 20 }]);
  assert.deepEqual(m.keys.map(k => [k.key, k.count, k.scope]), [['run', 3, 'running'], ['idle', 5, null], ['err', 2, 'error'], ['proxy', 4, 'proxy_failed']]);
  assert.equal(fleetModel({ total: 10, proxyFailed: 1 }).keys.at(-1).label, 'with a failed proxy test');
  assert.equal(fleetModel({ total: 10, proxyFailed: 5 }).keys.at(-1).label, 'with a failed proxy test', 'the count is profiles, however many share one proxy');
});

test('zero profiles and zero problems stay quiet and never divide by zero', () => {
  const m = fleetModel({});
  assert.deepEqual(m.segments.map(s => s.pct), [0, 0]);
  assert.deepEqual(m.keys.map(k => k.key), ['run', 'idle']);
  assert.equal(fleetModel({ total: 4, running: 4 }).keys.find(k => k.key === 'idle').count, 0);
  assert.equal(fleetModel({ total: 2, running: 5, errors: 5 }).keys.find(k => k.key === 'idle').count, 0);
});

test('proxy test state: none, untested, ok and failed with its age', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  assert.equal(proxyTestState({ proxy: null }).state, 'none');
  assert.equal(proxyTestState({ proxy: { lastTest: { status: null } } }).state, 'untested');
  assert.equal(proxyTestState({ proxy: {} }).state, 'untested');
  assert.equal(proxyTestState({ proxy: { lastTest: { status: 'ok', testedAt: '2026-11-27T11:00:00Z' } } }, now).state, 'ok');
  const failed = proxyTestState({ proxy: { lastTest: { status: 'failed', error: 'timeout', testedAt: '2026-11-27T11:30:00Z' } } }, now);
  assert.deepEqual([failed.state, failed.error, failed.ageMinutes], ['failed', 'timeout', 30]);
  assert.equal(SCOPE_STATUS.proxy_failed, 'proxy_failed');
});

test('table filter: proxy_failed matches any run state, running and error stay as before', () => {
  const row = (id, extra) => ({ id, name: id, notes: '', tags: [], folder: '', proxy: null, ...extra });
  const rows = [
    row('a', { running: true, proxy: { lastTest: { status: 'failed' } } }),
    row('b', { running: false, proxy: { lastTest: { status: 'ok' } } }),
    row('c', { running: false, last_error: 'boom' }),
    row('d', { running: false, proxy: { lastTest: { status: 'failed' } }, last_error: 'x' }),
    row('e', { running: false, proxy: { lastTest: { status: null } } }),
  ];
  const ids = status => queryProfiles(rows, { status, folder: '__all' }).items.map(r => r.id).sort();
  assert.deepEqual(ids('proxy_failed'), ['a', 'd']);
  assert.deepEqual(ids('error'), ['c', 'd']);
  assert.deepEqual(ids('running'), ['a']);
  assert.throws(() => queryProfiles(rows, { status: 'proxy_down' }), /status filter is invalid/);
});

test('API: a failed proxy test marks its profiles, is counted in meta, and editing the proxy clears it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fleet-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'fl' });
  const h = { Authorization: 'Bearer fl', 'Content-Type': 'application/json' };
  const call = (method, route, body) => fetch(proc.url + route, { method, headers: h, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  try {
    // 127.0.0.1:1 refuses connections at once, so the test fails fast without any network.
    const dead = (await call('POST', '/api/v1/proxies', { name: 'dead', type: 'http', host: '127.0.0.1', port: 1 })).body;
    const a = (await call('POST', '/api/v1/profiles', { name: 'uses dead', proxyId: dead.id })).body;
    (await call('POST', '/api/v1/profiles', { name: 'no proxy' }));
    assert.equal((await call('GET', '/api/meta')).body.proxyFailedCount, 0, 'untested is not failed');
    const tested = await call('POST', `/api/proxies/test-batch`, { ids: [dead.id] });
    assert.equal(tested.status, 200);
    const meta = (await call('GET', '/api/meta')).body;
    assert.equal(meta.proxyFailedCount, 1);
    const table = (await call('GET', '/api/profile-table?status=proxy_failed')).body;
    assert.deepEqual(table.items.map(p => p.id), [a.id]);
    assert.equal(table.items[0].proxy.lastTest.status, 'failed');
    assert.ok(!JSON.stringify(table).includes('"password":"x'), 'no credential in the table');
    // Editing the proxy endpoint clears its stored result (the old failure no longer describes it).
    assert.equal((await call('PATCH', `/api/proxies/${dead.id}`, { name: 'dead', type: 'http', host: '127.0.0.1', port: 2 })).status, 200);
    assert.equal((await call('GET', '/api/meta')).body.proxyFailedCount, 0);
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

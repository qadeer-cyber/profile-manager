// Bulk create from a pasted proxy list: the shared helpers and the server action.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanProxyLines, formatBulkName, proxyDuplicateKey } from '../server/bulk.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('names: {n} is replaced, otherwise a number is appended, and the length is bounded', () => {
  assert.equal(formatBulkName('Shop {n}', 7), 'Shop 7');
  assert.equal(formatBulkName('US-{n}-main', 12), 'US-12-main');
  assert.equal(formatBulkName('Shop', 3), 'Shop 3');
  assert.equal(formatBulkName('', 1), 'Profile 1');
  assert.ok(formatBulkName('x'.repeat(500), 1).length <= 200);
});

test('proxy lines: blanks are dropped, limits and types are enforced, duplicates ignore the password', () => {
  assert.deepEqual(cleanProxyLines(['  a:1  ', '', '   ', 'b:2']), ['a:1', 'b:2']);
  assert.throws(() => cleanProxyLines([]), /1 to 100/);
  assert.throws(() => cleanProxyLines(['', ' ']), /1 to 100/);
  assert.throws(() => cleanProxyLines(Array.from({ length: 101 }, (_, i) => `h${i}:1`)), /1 to 100/);
  assert.throws(() => cleanProxyLines('a:1'), /array of strings/);
  assert.throws(() => cleanProxyLines([1]), /array of strings/);
  const a = { type: 'http', host: 'Host.EXAMPLE', port: '8000', username: 'u', password: 'one' };
  assert.equal(proxyDuplicateKey(a), proxyDuplicateKey({ ...a, host: 'host.example', port: 8000, password: 'two' }));
  assert.notEqual(proxyDuplicateKey(a), proxyDuplicateKey({ ...a, username: 'v' }));
  assert.notEqual(proxyDuplicateKey(a), proxyDuplicateKey({ ...a, type: 'socks5' }));
});

test('API: one profile per proxy line with its own proxy; bad and repeated lines are reported without echoing credentials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bulkcreate-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'bc' });
  const auth = { Authorization: 'Bearer bc', 'Content-Type': 'application/json' };
  const api = (route, body) => fetch(proc.url + '/api/v1' + route, { method: body ? 'POST' : 'GET', headers: auth, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  const run = async body => {
    let { status, body: job } = await api('/bulk/jobs', body);
    assert.equal(status, 202, JSON.stringify(job));
    while (job.status === 'running' || job.status === 'queued') job = (await api('/bulk/jobs/' + job.id)).body;
    return job;
  };
  try {
    const secret = 'S3cretPw';
    const job = await run({ action: 'createWithProxies', namePattern: 'Shop {n}', startAt: 5, folder: 'Batch A', tags: ['batch', 'us'],
      proxyLines: ['203.0.113.1:8000:alice:' + secret, 'socks5://bob:' + secret + '@203.0.113.2:1080', 'not a proxy', '203.0.113.1:8000:alice:other', '203.0.113.3:9000'] });
    const text = JSON.stringify(job);
    assert.ok(!text.includes(secret), 'no password appears in the job result');
    assert.equal(job.items.length, 5);
    const byIndex = Object.fromEntries(job.items.map(i => [i.index, i]));
    assert.equal(byIndex[0].ok, true); assert.equal(byIndex[0].profile.name, 'Shop 5');
    assert.equal(byIndex[1].ok, true); assert.equal(byIndex[1].profile.name, 'Shop 6');
    assert.equal(byIndex[2].ok, false); assert.equal(byIndex[2].code, 'INVALID_PROXY_LINE'); assert.match(byIndex[2].error, /^Line 3:/);
    assert.equal(byIndex[3].ok, false); assert.equal(byIndex[3].code, 'DUPLICATE_PROXY_LINE'); assert.match(byIndex[3].error, /^Line 4:/);
    assert.equal(byIndex[4].ok, true); assert.equal(byIndex[4].profile.name, 'Shop 9', 'numbers follow the line, so a failed line leaves a gap the user can see');
    const profiles = (await api('/profiles')).body;
    assert.equal(profiles.length, 3);
    for (const p of profiles) { assert.equal(p.folder, 'Batch A'); assert.deepEqual(p.tags.sort(), ['batch', 'us']); assert.ok(p.proxy?.host?.startsWith('203.0.113.')); }
    assert.equal(new Set(profiles.map(p => p.proxy.host)).size, 3, 'each profile has its own proxy');
    assert.equal(profiles.find(p => p.name === 'Shop 6').proxy.type, 'socks5');
    assert.ok(!JSON.stringify(profiles).includes(secret), 'listing never returns the password');
    // Re-running with the same proxies reuses the library entries instead of duplicating them.
    await run({ action: 'createWithProxies', proxyLines: ['203.0.113.1:8000:alice:' + secret] });
    const proxies = (await api('/proxies')).body;
    assert.equal((Array.isArray(proxies) ? proxies : proxies.proxies).filter(p => p.host === '203.0.113.1').length, 1);
    // Validation of the request itself.
    assert.equal((await api('/bulk/jobs', { action: 'createWithProxies', proxyLines: [] })).status, 400);
    assert.equal((await api('/bulk/jobs', { action: 'createWithProxies', proxyLines: 'a:1' })).status, 400);
    const bad = await run({ action: 'createWithProxies', startAt: 0, proxyLines: ['203.0.113.9:1'] });
    assert.equal(bad.status, 'failed');
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

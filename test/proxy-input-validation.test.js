// Proxy input validation through the real profile API: malformed values are refused when saved, with a clear
// message, instead of failing later at launch. Synthetic values only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxy-input-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'proxy-input';
const { startServer } = await import('../server/app.js');
let server;
const create = async proxy => {
  const r = await fetch(server.url + '/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'p', proxy }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => { await server?.close(); try { (await import('../server/db.js')).db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });

const base = { type: 'http', host: '198.51.100.7', port: 8080 };

test('ports, hosts and types outside the allowed forms are refused', async () => {
  for (const port of [0, 65536, -1, 'abc', 1.5]) assert.equal((await create({ ...base, port })).status, 400, `port ${port}`);
  for (const host of ['http://x.example', 'x.example/path', 'user@x.example', 'x example', 'x.example\r\nHost: y']) {
    assert.equal((await create({ ...base, host })).status, 400, `host ${JSON.stringify(host)}`);
  }
  for (const type of ['ftp', 'socks4', '']) assert.equal((await create({ ...base, type })).status, 400, `type ${type}`);
});

test('control characters in credentials are refused', async () => {
  for (const [field, value] of [['username', 'a\r\nb'], ['password', 'p\nq'], ['username', 'nul\u0000x'], ['password', 'tab\tok? no']]) {
    const r = await create({ ...base, username: 'u', password: 'p', [field]: value });
    assert.equal(r.status, 400, `${field} ${JSON.stringify(value)}`);
    assert.match(r.body.error, /control characters/);
  }
});

test('SOCKS5 credentials longer than 255 bytes are refused (RFC 1929); HTTP ones are not limited to that', async () => {
  const long = 'x'.repeat(256);
  const socks = await create({ ...base, type: 'socks5', username: long, password: 'p' });
  assert.equal(socks.status, 400);
  assert.match(socks.body.error, /255 bytes/);
  assert.equal((await create({ ...base, type: 'socks5', username: 'é'.repeat(128), password: 'p' })).status, 400, '256 UTF-8 bytes');
  assert.equal((await create({ ...base, type: 'socks5', username: 'x'.repeat(255), password: 'p' })).status, 201);
  assert.equal((await create({ ...base, type: 'http', username: long, password: 'p' })).status, 201);
});

test('ordinary values are accepted', async () => {
  assert.equal((await create({ ...base, username: 'user-name_1.2', password: 'p@ss:w/rd!' })).status, 201);
  assert.equal((await create({ ...base, host: '[2001:db8::7]' })).status, 201);
});

test('the proxy library applies the same credential rules on create and edit', async () => {
  const call = async (method, route, body) => {
    const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  assert.equal((await call('POST', '/proxies', { ...base, username: 'a\nb' })).status, 400);
  assert.equal((await call('POST', '/proxies', { ...base, type: 'socks5', password: 'y'.repeat(256) })).status, 400);
  const ok = await call('POST', '/proxies', { ...base, type: 'socks5', username: 'u', password: 'p' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await call('PATCH', `/proxies/${ok.body.id}`, { username: 'u'.repeat(256) })).status, 400);
  assert.equal((await call('PATCH', `/proxies/${ok.body.id}`, { password: 'bad\r\n' })).status, 400);
  assert.equal((await call('PATCH', `/proxies/${ok.body.id}`, { name: 'renamed' })).status, 200, 'edits without credentials are unaffected');
});

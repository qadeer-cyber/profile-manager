// In-process tests for server/app.js: header-only UI token, strict secrets after startup,
// automation_enabled field, and the per-launch `automation` option passed to browsers.js.
// browsers.js is replaced by a stub (node:test module mocks) so no real browser is started.
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-appsec-'));
process.env.PM_DATA_DIR = tmp; process.env.PM_API_TOKEN = 'api-tok'; delete process.env.PM_SECRET; delete process.env.PM_UI_TOKEN;

const launches = [];
const stubRun = { info: { ws_endpoint: 'ws://x', cdp_port: 1, pid: 1 }, fail: null };
const running = new Set();
mock.module(new URL('../server/browsers.js', import.meta.url).href, { namedExports: {
  events: new (await import('events')).EventEmitter(), DATA_COPY_SKIP: new Set(),
  isRunning: id => running.has(id), runningIds: () => [...running], runInfo: () => stubRun.info,
  launch: async (p, opts) => { if (stubRun.fail) throw stubRun.fail; launches.push({ id: p.id, opts }); running.add(p.id); return {}; },
  stop: async id => { running.delete(id); }, shutdown: async () => {}, recoverAfterRestart: async () => ({}), startHealthMonitor: () => {},
} });

// Seed a pre-v6 database (schema up to v5) with an inline plaintext proxy BEFORE the app opens it,
// so startup runs migration v6 (move to library) and then the secret re-encryption.
{
  const { default: Database } = await import('better-sqlite3');
  const { migrate, migrations } = await import('../server/migrations.js');
  const pre = new Database(path.join(tmp, 'profiles.db'));
  migrate(pre, migrations.filter(m => m.version <= 5));
  pre.prepare("INSERT INTO profiles (id,name,tags,folder,notes,proxy,created_at,updated_at) VALUES ('11111111-1111-1111-1111-111111111111','Legacy','[]','','',?, 't','t')")
    .run(JSON.stringify({ type: 'http', host: 'h', port: 1, username: 'u', password: 'plain-legacy' }));
  pre.close();
  fs.mkdirSync(path.join(tmp, 'profiles', '11111111-1111-1111-1111-111111111111'), { recursive: true });
}
const { db } = await import('../server/db.js');
const { startServer } = await import('../server/app.js');
let srv, B;
before(async () => { srv = await startServer({ port: 0, uiToken: 'ui-tok', staticDir: null }); B = srv.url; });
after(async () => { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const req = (m, u, b, h = {}) => fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b && JSON.stringify(b) }).then(async r => ({ s: r.status, d: r.status === 204 ? null : await r.json() }));
const ui = (m, u, b) => req(m, u, b, { 'X-UI-Token': 'ui-tok' });
const v1 = (m, u, b) => req(m, '/api/v1' + u, b, { Authorization: 'Bearer api-tok' });

test('UI token: accepted via X-UI-Token header', async () => assert.equal((await ui('GET', '/api/profiles')).s, 200));
test('UI token: rejected via ?token= query string', async () => assert.equal((await req('GET', '/api/profiles?token=ui-tok')).s, 401));
test('UI token: rejected on the SSE stream via query too', async () => {
  const r = await fetch(B + '/api/events?token=ui-tok'); assert.equal(r.status, 401); await r.body?.cancel();
});
test('UI token: missing/wrong header rejected', async () => {
  assert.equal((await req('GET', '/api/profiles')).s, 401);
  assert.equal((await req('GET', '/api/profiles', null, { 'X-UI-Token': 'nope' })).s, 401);
});

test('startup scrub: legacy plaintext password is gone from the raw db file and WAL (secure_delete + VACUUM)', () => {
  assert.equal(srv.scrubbed, true, 'startup reported a scrub');
  assert.equal(db.pragma('secure_delete', { simple: true }), 1);
  for (const f of ['profiles.db', 'profiles.db-wal']) {
    const file = path.join(tmp, f);
    if (!fs.existsSync(file)) continue;
    assert.ok(!fs.readFileSync(file).includes('plain-legacy'), `plaintext found in ${f}`);
  }
  assert.ok(fs.readFileSync(path.join(tmp, 'profiles.db')).length > 0);
});
test('startup: migration v6 moved the inline proxy to the library and re-encrypted; it still decrypts', async () => {
  const stored = db.prepare("SELECT x.password FROM proxies x JOIN profiles p ON p.proxy_id = x.id WHERE p.name='Legacy'").get().password;
  assert.match(stored, /^enc:v1:/);
  const p = (await ui('GET', '/api/profiles/11111111-1111-1111-1111-111111111111')).d;
  assert.equal(p.secretError, undefined); assert.equal(p.proxy.password, '••••');
});
test('after startup, an unprefixed secret written behind the app\'s back is rejected (not returned)', async () => {
  db.prepare("UPDATE proxies SET password='sneaky-plain' WHERE id=(SELECT proxy_id FROM profiles WHERE name='Legacy')").run();
  const warn = console.warn; const logs = []; console.warn = (...a) => logs.push(a.join(' '));
  let p; try { p = (await ui('GET', '/api/profiles/11111111-1111-1111-1111-111111111111')).d; } finally { console.warn = warn; }
  assert.match(p.secretError, /missing enc:\/ss: prefix/);
  assert.ok(!JSON.stringify(p).includes('sneaky-plain') && !logs.join().includes('sneaky-plain'));
  const r = await ui('POST', '/api/profiles/11111111-1111-1111-1111-111111111111/launch');
  assert.equal(r.s, 500); assert.match(r.d.error, /Cannot decrypt/);
});

let pid;
test('automation_enabled: defaults to false, exposed as automationEnabled, raw column hidden', async () => {
  const r = await ui('POST', '/api/profiles', { name: 'P' });
  assert.equal(r.s, 201); assert.equal(r.d.automationEnabled, false); assert.ok(!('automation_enabled' in r.d));
  pid = r.d.id;
});
test('automation_enabled: settable on create via /api/v1 and on update via UI PUT and v1 PATCH', async () => {
  const c = await v1('POST', '/profiles', { name: 'Auto', automationEnabled: true });
  assert.equal(c.d.automationEnabled, true);
  assert.equal((await ui('PUT', `/api/profiles/${pid}`, { automationEnabled: true })).d.automationEnabled, true);
  assert.equal((await v1('PATCH', `/profiles/${pid}`, { automationEnabled: false })).d.automationEnabled, false);
  assert.equal((await v1('PATCH', `/profiles/${pid}`, { notes: 'x' })).d.automationEnabled, false, 'unchanged when omitted');
  assert.equal(db.prepare('SELECT automation_enabled a FROM profiles WHERE id=?').get(c.d.id).a, 1);
});
test('automation_enabled: non-boolean rejected', async () => {
  assert.equal((await ui('POST', '/api/profiles', { name: 'x', automationEnabled: 'yes' })).s, 400);
});
test('launch passes `automation` to browsers.js: profile flag by default', async () => {
  await ui('PUT', `/api/profiles/${pid}`, { automationEnabled: true });
  launches.length = 0; running.clear();
  await ui('POST', `/api/profiles/${pid}/launch`);
  assert.equal(launches.at(-1).opts.automation, true);
  running.clear(); await ui('PUT', `/api/profiles/${pid}`, { automationEnabled: false });
  await v1('POST', `/profiles/${pid}/launch`, {});
  assert.equal(launches.at(-1).opts.automation, false);
});
test('v1 launch: per-launch {automation:true} override wins over the profile flag', async () => {
  running.clear();
  const r = await v1('POST', `/profiles/${pid}/launch`, { automation: true });
  assert.equal(r.s, 200); assert.equal(launches.at(-1).opts.automation, true);
  running.clear();
  await v1('POST', `/profiles/${pid}/launch`, { automation: false });
  assert.equal(launches.at(-1).opts.automation, false);
});
test('v1 launch: non-boolean override rejected; UI launch ignores override', async () => {
  running.clear();
  assert.equal((await v1('POST', `/profiles/${pid}/launch`, { automation: 1 })).s, 400);
  await ui('POST', `/api/profiles/${pid}/launch`, { automation: true });
  assert.equal(launches.at(-1).opts.automation, false, 'UI API has no override; uses profile flag (false)');
});

// ---------- proxy error classification + import parsing (pure functions in app.js) ----------
test('classifyProxyError maps errors to auth_failed/connect_refused/timeout/dns/protocol_unsupported/unknown', async () => {
  const { classifyProxyError: c } = await import('../server/app.js');
  assert.equal(c(Object.assign(new Error('getaddrinfo ENOTFOUND x.invalid'), { code: 'ENOTFOUND' })), 'dns');
  assert.equal(c(Object.assign(new Error('getaddrinfo EAI_AGAIN x'), { code: 'EAI_AGAIN' })), 'dns');
  assert.equal(c(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })), 'connect_refused');
  assert.equal(c(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), 'timeout');
  assert.equal(c(new Error('Socks5 Authentication failed')), 'auth_failed');
  assert.equal(c(Object.assign(new Error('Proxy authentication required (407)'), { code: 'PROXY_AUTH' })), 'auth_failed');
  assert.equal(c(new Error('Socks5 proxy rejected connection - no accepted authentication type')), 'auth_failed', 'server demands credentials we did not offer');
  assert.equal(c(new Error('Received invalid Socks5 initial handshake')), 'protocol_unsupported');
  assert.equal(c(Object.assign(new Error('Parse Error: Expected HTTP/'), { code: 'HPE_INVALID_CONSTANT' })), 'protocol_unsupported');
  assert.equal(c(Object.assign(new Error('wrong version number'), { code: 'ERR_SSL_WRONG_VERSION_NUMBER' })), 'protocol_unsupported');
  assert.equal(c(new Error('something odd')), 'unknown');
});
test('parseProxyLine handles all accepted formats', async () => {
  const { parseProxyLine: p } = await import('../server/app.js');
  assert.deepEqual(p('1.2.3.4:80'), { type: 'http', host: '1.2.3.4', port: '80', username: '', password: '' });
  assert.deepEqual(p('h:1:u:pa:ss'), { type: 'http', host: 'h', port: '1', username: 'u', password: 'pa:ss' });
  assert.deepEqual(p('socks5://u:p%40@h:9'), { type: 'socks5', host: 'h', port: '9', username: 'u', password: 'p@' });
  assert.deepEqual(p('socks5h://h:9'), { type: 'socks5', host: 'h', port: '9', username: '', password: '' });
  assert.deepEqual(p('https://[::1]:443'), { type: 'https', host: '[::1]', port: '443', username: '', password: '' });
  assert.equal(p('5.6.7.8:1', 'socks5').type, 'socks5');
  assert.throws(() => p('ftp://h:1'), /Unsupported scheme/);
  assert.throws(() => p('just-a-host'), /Unrecognized/);
  assert.throws(() => p('h:1:u'), /Unrecognized/);
});

// ---------- engine integration: cdp/pid shape, CHROMIUM_MISSING -> 503, verified installer ----------
test('running entry WITHOUT a debugging port: top-level pid, no cdp (UI + v1 launch + v1 running)', async () => {
  running.clear(); stubRun.info = { ws_endpoint: null, cdp_port: null, pid: 4321 };
  const a = await ui('POST', `/api/profiles/${pid}/launch`);
  assert.equal(a.d.pid, 4321); assert.ok(!('cdp' in a.d));
  running.clear();
  const b = await v1('POST', `/profiles/${pid}/launch`, {});
  assert.equal(b.d.pid, 4321); assert.ok(!('cdp' in b.d));
  const r = await v1('GET', '/running');
  assert.equal(r.d[0].pid, 4321); assert.ok(!('cdp' in r.d[0]));
});
test('running entry WITH a debugging port: cdp present (incl. cdp.pid for compatibility) and top-level pid', async () => {
  running.clear(); stubRun.info = { ws_endpoint: 'ws://127.0.0.1:9333/devtools/browser/x', cdp_port: 9333, pid: 99 };
  const r = await v1('POST', `/profiles/${pid}/launch`, { automation: true });
  assert.equal(r.d.pid, 99);
  assert.deepEqual(r.d.cdp, { wsEndpoint: 'ws://127.0.0.1:9333/devtools/browser/x', httpEndpoint: 'http://127.0.0.1:9333', debuggerAddress: '127.0.0.1:9333', pid: 99 });
});
test('stopped profiles carry neither pid nor cdp', async () => {
  running.clear();
  const r = await ui('GET', `/api/profiles/${pid}`);
  assert.ok(!('pid' in r.d) && !('cdp' in r.d));
});
test('CHROMIUM_MISSING -> HTTP 503 {error:"CHROMIUM_MISSING", message} in UI API, /api/v1 and bulk launch', async () => {
  running.clear();
  stubRun.fail = Object.assign(new Error('Chromium is not installed. Open Diagnostics → Download Chromium.'), { code: 'CHROMIUM_MISSING', status: 503 });
  try {
    for (const r of [await ui('POST', `/api/profiles/${pid}/launch`), await v1('POST', `/profiles/${pid}/launch`, {})]) {
      assert.equal(r.s, 503); assert.deepEqual(Object.keys(r.d).sort(), ['error', 'message']);
      assert.equal(r.d.error, 'CHROMIUM_MISSING'); assert.match(r.d.message, /Download Chromium/);
    }
    const b = await v1('POST', '/bulk/launch', { ids: [pid] });
    assert.equal(b.d[0].ok, false); assert.equal(b.d[0].error, 'CHROMIUM_MISSING'); assert.match(b.d[0].message, /not installed/);
    // a code-less error without status keeps the old 500 shape
    stubRun.fail = new Error('boom');
    const o = await ui('POST', `/api/profiles/${pid}/launch`);
    assert.equal(o.s, 500); assert.equal(o.d.error, 'boom');
  } finally { stubRun.fail = null; }
});
test('GET /api/browser includes chromiumStatus() (pinned revision, per-browser verified state)', async () => {
  const r = await ui('GET', '/api/browser');
  assert.equal(r.s, 200);
  assert.ok(r.d.chromium && r.d.chromium.revision && 'chromium' in r.d.chromium && 'chromium-headless-shell' in r.d.chromium);
  assert.equal(typeof r.d.chromium.chromium.verified, 'boolean');
  assert.ok('install' in r.d && 'installed' in r.d);
});
test('installBrowser uses the verified installer (injected): success and failure states + events', async () => {
  const { installBrowser, browserStatus } = await import('../server/app.js');
  const { events } = await import('../server/browsers.js');
  const seen = []; const h = e => e.type === 'browser:install' && seen.push(e.state); events.on('event', h);
  let calledWith;
  await installBrowser({ install: async o => { calledWith = o; o.onProgress('chromium', 50, 100); return [{ name: 'chromium', sha256: 'abc' }]; } });
  assert.equal(typeof calledWith.log, 'function'); assert.equal(browserStatus().install.state, 'done');
  assert.match(browserStatus().install.log, /chromium: 50%[\s\S]*Installed chromium \(sha256 abc\)/);
  await installBrowser({ install: async () => { throw Object.assign(new Error('SHA-256 mismatch'), { code: 'CHECKSUM_MISMATCH' }); } });
  assert.equal(browserStatus().install.state, 'failed'); assert.equal(browserStatus().install.code, 'CHECKSUM_MISMATCH');
  events.off('event', h);
  assert.deepEqual(seen, ['running', 'done', 'running', 'failed']);
});
test('app.js no longer shells out to the Playwright CLI installer', () => {
  const src = fs.readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
  assert.ok(!/cli\.js|'install', 'chromium'/.test(src));
});

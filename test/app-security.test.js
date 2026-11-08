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
const automationRuns = new Map();
const browserEvents = new (await import('events')).EventEmitter();
let stopFailure = false;
mock.module(new URL('../server/browsers.js', import.meta.url).href, { namedExports: {
  events: browserEvents, automationLaunch: id => automationRuns.get(id), DATA_COPY_SKIP: new Set(),
  isRunning: id => running.has(id), runningIds: () => [...running], runInfo: () => stubRun.info,
  resourceSnapshot: () => ({ running: running.size, sessions: [] }),
  launch: async (p, opts) => { if (stubRun.fail) throw stubRun.fail; launches.push({ id: p.id, opts }); running.add(p.id); if (opts.automation) automationRuns.set(p.id, { id: String(launches.length), endpoint: 'http://127.0.0.1:9222' }); return {}; },
  stop: async id => {
    if (stopFailure) throw new Error('fixture credential never log this');
    running.delete(id); automationRuns.delete(id);
    browserEvents.emit('event', { type: 'profile:stopped', id });
  }, shutdown: async () => {}, recoverAfterRestart: async () => ({}), startHealthMonitor: () => {},
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
after(async () => {
  try {
    await srv?.close();
  } finally {
    // On Windows, unlinking an open SQLite DB raises EBUSY. Release the
    // singleton DB handle before removing the temporary test directory.
    if (db.open) db.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
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
  assert.deepEqual(p('1.2.3.4:80'), { type: 'http', host: '1.2.3.4', port: '80', username: '', password: '', schemeSelected: false });
  assert.deepEqual(p('h:1:u:pa:ss'), { type: 'http', host: 'h', port: '1', username: 'u', password: 'pa:ss', schemeSelected: false });
  assert.deepEqual(p('socks5://u:p%40@h:9'), { type: 'socks5', host: 'h', port: '9', username: 'u', password: 'p@', schemeSelected: true });
  assert.deepEqual(p('socks5h://h:9'), { type: 'socks5', host: 'h', port: '9', username: '', password: '', schemeSelected: true });
  assert.deepEqual(p('https://[::1]:443'), { type: 'https', host: '[::1]', port: '443', username: '', password: '', schemeSelected: true });
  assert.equal(p('5.6.7.8:1', 'socks5').type, 'socks5');
  assert.deepEqual(p('h:1:u', 'https'), { type: 'https', host: 'h', port: '1', username: 'u', password: '', schemeSelected: false });
  assert.equal(p('h:1:u:').password, '');
  assert.throws(() => p('ftp://h:1'), /Unsupported scheme/);
  assert.throws(() => p('just-a-host'), /Unrecognized/);
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

test('M4 favorites are authenticated, persisted and composed with saved filters', async () => {
  const { d: profile } = await ui('POST', '/api/profiles', { name: 'M4 Favorite', folder: 'M4 Flags' });
  assert.equal(profile.favorite, false);
  const endpoint = '/api/profiles/' + profile.id + '/favorite';
  assert.equal((await req('PATCH', endpoint, { favorite: true })).s, 401);
  assert.equal((await ui('PATCH', endpoint, { favorite: 'true' })).s, 400);
  assert.equal((await ui('PATCH', endpoint, { favorite: true })).d.favorite, true);
  assert.equal(db.prepare('SELECT favorite FROM profiles WHERE id=?').get(profile.id).favorite, 1);
  const { d: view, s } = await ui('POST', '/api/views', { name: 'M4 Starred', query: { favorite: true, folder: 'M4 Flags', q: 'M4', proxy: 'none' } });
  assert.equal(s, 201);
  assert.deepEqual((await ui('GET', '/api/views')).d.find(item => item.id === view.id).query, view.query);
  const query = new URLSearchParams(view.query);
  assert.deepEqual((await ui('GET', '/api/profile-table?' + query)).d.items.map(item => item.id), [profile.id]);
  assert.equal((await ui('GET', '/api/meta')).d.favoriteCount, 1);
  await ui('PATCH', endpoint, { favorite: false });
  assert.equal((await ui('GET', '/api/profile-table?' + query)).d.total, 0);
  assert.equal((await ui('GET', '/api/profile-table?favorite=broken')).s, 400);
});

test('M4 nested folder moves preserve workspace, ciphertext, browser data, and saved queries', async () => {
  const root = '/api/profile-folders';
  assert.equal((await req('POST', root, { path: 'M4 tree' })).s, 401);
  assert.equal((await ui('POST', root, { path: 'M4 tree/Child' })).s, 404);
  assert.equal((await ui('POST', root, { path: 'M4 tree' })).s, 201);
  assert.equal((await ui('POST', root, { path: 'M4 tree/Child' })).s, 201);
  assert.equal((await ui('POST', root, { path: 'M4 tree/Empty' })).s, 201);
  assert.equal((await ui('POST', root, { path: 'M4 tree/../invalid' })).s, 400);
  assert.equal((await ui('POST', root, { path: 'M4 destination' })).s, 201);
  assert.ok((await ui('GET', '/api/meta')).d.folders.includes('M4 tree/Empty'));
  const { d: workspace } = await ui('POST', '/api/workspaces', { name: 'M4 workspace' });
  const { d: profile } = await ui('POST', '/api/profiles', {
    name: 'M4 Nested', folder: 'M4 tree/Child', workspaceId: workspace.id,
    proxy: { type: 'http', host: 'localhost', port: 8080, username: 'fixture', password: 'm4-synthetic-secret' },
  });
  const dataFile = path.join(tmp, 'profiles', profile.id, 'fixture-cookie-data');
  fs.writeFileSync(dataFile, 'fixture');
  const ciphertext = () => db.prepare('SELECT password FROM proxies WHERE id = ?').get(profile.proxyId).password;
  const encrypted = ciphertext();
  assert.match(encrypted, /^enc:/);
  const { d: view } = await ui('POST', '/api/views', { name: 'M4 Folder View', query: { folder: 'M4 tree/Child', workspaceId: workspace.id } });
  assert.equal((await ui('PATCH', root, { from: 'M4 tree', to: 'M4 tree/Child/Loop' })).s, 409);
  assert.equal((await ui('PATCH', root, { from: 'M4 tree', to: 'M4 destination' })).s, 409);
  db.prepare('UPDATE workspaces SET vault_locked = 1 WHERE id = ?').run(workspace.id);
  try {
    assert.equal((await ui('PATCH', root, { from: 'M4 tree', to: 'M4 destination/Renamed' })).s, 404);
  } finally { db.prepare('UPDATE workspaces SET vault_locked = 0 WHERE id = ?').run(workspace.id); }
  assert.equal((await ui('GET', '/api/profiles/' + profile.id)).d.folder, 'M4 tree/Child');
  assert.equal((await ui('PATCH', root, { from: 'M4 tree', to: 'M4 destination/Renamed' })).s, 200);
  const moved = (await ui('GET', '/api/profiles/' + profile.id)).d;
  assert.equal(moved.folder, 'M4 destination/Renamed/Child');
  assert.equal(moved.workspaceId, workspace.id);
  assert.equal(moved.proxy.password, '••••');
  assert.equal(ciphertext(), encrypted);
  assert.equal(fs.readFileSync(dataFile, 'utf8'), 'fixture');
  const currentView = (await ui('GET', '/api/views')).d.find(item => item.id === view.id);
  assert.equal(currentView.query.folder, moved.folder);
  assert.equal((await ui('DELETE', root, { path: 'M4 destination/Renamed' })).s, 409);
  assert.equal((await ui('DELETE', root, { path: moved.folder })).s, 409);
  assert.equal((await ui('DELETE', '/api/profiles/' + profile.id)).s, 204);
  assert.equal((await ui('DELETE', root, { path: moved.folder })).s, 409);
  assert.equal((await ui('DELETE', root, { path: 'M4 destination/Renamed/Empty' })).s, 204);
  assert.ok(!(await ui('GET', '/api/meta')).d.folders.includes('M4 destination/Renamed/Empty'));
});

test('M4 bulk settings clone reports per-profile failures and does not duplicate session data', async () => {
  const { d: source } = await ui('POST', '/api/profiles', { name: 'M4 Clone', folder: 'M4 Clones', notes: 'Keep notes', tags: ['test'] });
  fs.writeFileSync(path.join(tmp, 'profiles', source.id, 'Cookies'), 'private session');
  const endpoint = '/api/bulk/jobs';
  assert.equal((await ui('POST', endpoint, { action: 'clone', ids: [source.id, source.id] })).s, 400);
  const { d: job, s } = await ui('POST', endpoint, { action: 'clone', ids: [source.id, 'missing'] });
  assert.equal(s, 202);
  let state = job;
  for (let i = 0; i < 20 && state.status === 'running'; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    state = (await ui('GET', endpoint + '/' + job.id)).d;
  }
  assert.equal(state.status, 'done');
  assert.deepEqual(state.items.map(item => item.ok), [true, false]);
  const copy = state.items[0].profile;
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.folder, source.folder);
  assert.equal(copy.notes, source.notes);
  assert.deepEqual(copy.tags, source.tags);
  assert.ok(!fs.existsSync(path.join(tmp, 'profiles', copy.id, 'Cookies')));
  assert.equal(fs.readFileSync(path.join(tmp, 'profiles', source.id, 'Cookies'), 'utf8'), 'private session');
});

test('M4 sorts before pagination and filters by browser engine and proxy assignment', async () => {
  const { d: firefox } = await ui('POST', '/api/profiles', {
    name: 'M4 Sort Firefox', folder: 'M4 Sorting', notes: 'alpha', browserEngine: 'firefox',
    proxy: { type: 'http', host: 'localhost', port: 8080 },
  });
  const { d: chromium } = await ui('POST', '/api/profiles', {
    name: 'M4 Sort Chromium', folder: 'M4 Sorting', notes: 'zulu',
  });
  const url = '/api/profile-table?' + new URLSearchParams({ folder: 'M4 Sorting', sort: 'notes', dir: 'asc', pageSize: 1 });
  const first = await ui('GET', url);
  assert.equal(first.d.total, 2);
  assert.equal(first.d.items[0].id, firefox.id);
  assert.equal((await ui('GET', url + '&page=2')).d.items[0].id, chromium.id);
  assert.deepEqual((await ui('GET', url + '&engine=firefox&proxy=assigned')).d.items.map(p => p.id), [firefox.id]);
  assert.deepEqual((await ui('GET', url + '&engine=chromium&proxy=none')).d.items.map(p => p.id), [chromium.id]);
  assert.equal((await ui('GET', url + '&engine=unknown')).s, 400);
});

test('M4 schema upgrade preserves existing workspace and proxy references and survives reopen', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { migrate, migrations } = await import('../server/migrations.js');
  const file = path.join(tmp, 'm4-schema-fixture.db');
  const db = new Database(file);
  try {
    migrate(db, migrations.filter(m => m.version < 20));
    db.prepare('INSERT INTO workspaces (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('w', 'Existing', 't', 't');
    db.prepare('INSERT INTO proxies (id,name,type,host,port,password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('x', 'Proxy', 'http', 'localhost', 8080, 'ss:v1:synthetic', 't', 't');
    db.prepare('INSERT INTO profiles (id,name,folder,workspace_id,proxy_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('p', 'Original', 'Original folder', 'w', 'x', 't', 't');
    assert.deepEqual(migrate(db).applied, [20, 21]);
    assert.deepEqual(db.prepare('SELECT name,folder,workspace_id,proxy_id,favorite FROM profiles WHERE id=?').get('p'),
      { name: 'Original', folder: 'Original folder', workspace_id: 'w', proxy_id: 'x', favorite: 0 });
    assert.equal(db.prepare('SELECT password FROM proxies WHERE id=?').get('x').password, 'ss:v1:synthetic');
    db.prepare('UPDATE profiles SET favorite=1 WHERE id=?').run('p');
    db.prepare('INSERT INTO profile_folders (path) VALUES (?)').run('Empty folder');
  } finally { db.close(); }

  const reopened = new Database(file);
  try {
    assert.deepEqual(migrate(reopened).applied, []);
    assert.equal(reopened.prepare('SELECT favorite FROM profiles WHERE id=?').get('p').favorite, 1);
    assert.equal(reopened.prepare('SELECT path FROM profile_folders').get().path, 'Empty folder');
  } finally { reopened.close(); }
});

test('M4.2 hidden folder paths are not usable as parents and locked Trash prevents subtree changes', async () => {
  const folder = '/api/profile-folders';
  const { d: ws } = await ui('POST', '/api/workspaces', { name: 'M4.2 private' });
  await ui('POST', folder, { path: 'M4.2 Shared' });
  const { d: hidden } = await ui('POST', '/api/profiles', { name: 'Hidden', workspaceId: ws.id, folder: 'M4.2 Shared/Secret' });
  const { d: publicProfile } = await ui('POST', '/api/profiles', { name: 'Public', folder: 'M4.2 Shared' });
  await ui('DELETE', '/api/profiles/' + hidden.id);
  db.prepare('UPDATE workspaces SET vault_locked=1 WHERE id=?').run(ws.id);
  const absent = await ui('DELETE', folder, { path: 'M4.2 Unknown' });
  assert.deepEqual(await ui('DELETE', folder, { path: 'M4.2 Shared/Secret' }), absent);
  assert.deepEqual(await ui('POST', folder, { path: 'M4.2 Shared/Secret/Probe' }), absent);
  assert.deepEqual(await ui('PATCH', folder, { from: 'M4.2 Shared', to: 'M4.2 Moved' }), absent);
  assert.equal((await ui('GET', '/api/profiles/' + publicProfile.id)).d.folder, 'M4.2 Shared');
  assert.ok(!(await ui('GET', '/api/meta')).d.folders.includes('M4.2 Shared/Secret'));
  db.prepare('UPDATE workspaces SET vault_locked=0 WHERE id=?').run(ws.id);

  db.exec(`CREATE TEMP TRIGGER m42_fail_move BEFORE UPDATE OF folder ON profiles
    WHEN NEW.folder = 'M4.2 Moved/Secret' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`);
  try {
    assert.equal((await ui('PATCH', folder, { from: 'M4.2 Shared', to: 'M4.2 Moved' })).s, 500);
    assert.equal((await ui('GET', '/api/profiles/' + publicProfile.id)).d.folder, 'M4.2 Shared');
    assert.ok(!(await ui('GET', '/api/meta')).d.folders.includes('M4.2 Moved'));
  } finally { db.exec('DROP TRIGGER m42_fail_move'); }
  assert.equal((await ui('PATCH', folder, { from: 'M4.2 Shared', to: 'M4.2 Moved' })).s, 200);
  assert.equal(db.prepare('SELECT folder FROM profiles WHERE id=?').get(hidden.id).folder, 'M4.2 Moved/Secret');
});

test('M4.2 managed session authorization, exclusivity, redaction, crash and cancellation', async () => {
  const { d: a } = await ui('POST', '/api/profiles', { name: 'M4.2 Chromium', automationEnabled: true });
  const { d: b } = await ui('POST', '/api/profiles', { name: 'M4.2 Other', automationEnabled: true });
  const route = id => '/profiles/' + id + '/automation-sessions';
  const p = '/api' + route(a.id);
  assert.equal((await req('POST', p)).s, 401);
  assert.equal((await req('GET', '/api/v1' + route(a.id))).s, 401);
  assert.equal((await ui('POST', p)).s, 409);
  for (const { id } of [a, b]) assert.equal((await ui('POST', '/api/profiles/' + id + '/launch')).s, 200);
  const [left, right] = await Promise.all([ui('POST', p), v1('POST', route(a.id))]);
  assert.deepEqual([left.s, right.s].sort(), [201, 409]);
  const session = (await ui('GET', p)).d.sessions[0];
  assert.equal(session.status, 'ready');
  assert.equal((await ui('POST', '/api/profiles/' + a.id + '/webdriver/start')).s, 409);
  process.env.AZWAH_OFFICE_ENFORCE = '1';
  try { assert.equal((await v1('POST', route(b.id))).s, 402); }
  finally { delete process.env.AZWAH_OFFICE_ENFORCE; }
  assert.ok(Date.parse(session.startedAt));
  const cancel = p + '/' + session.id + '/cancel';
  assert.equal((await ui('POST', '/api' + route(b.id) + '/' + session.id + '/cancel')).s, 404);
  stopFailure = true;
  try {
    const failed = (await ui('POST', cancel)).d;
    assert.match(failed.sessions[0].error, /Retry cancellation/);
    assert.doesNotMatch(JSON.stringify(failed), /fixture credential/);
  } finally { stopFailure = false; }
  assert.equal((await ui('POST', cancel)).d.sessions[0].status, 'cancelled');
  assert.equal(running.has(b.id), true);
  const second = (await v1('POST', route(b.id))).d.sessions[0];
  running.delete(b.id); automationRuns.delete(b.id);
  browserEvents.emit('event', { type: 'profile:crashed', id: b.id, error: 'fixture credential' });
  const afterCrash = (await v1('GET', route(b.id))).d;
  assert.equal(afterCrash.endpoint, null);
  assert.equal(afterCrash.sessions[0].id, second.id);
  assert.equal(afterCrash.sessions[0].status, 'interrupted');
  assert.doesNotMatch(JSON.stringify(afterCrash), /fixture credential/);
  await ui('POST', '/api/profiles/' + b.id + '/launch');
  assert.equal((await v1('POST', route(b.id))).s, 201);
  const { recoverAutomationSessions } = await import('../server/automation-sessions.js');
  recoverAutomationSessions();
  assert.equal((await v1('GET', route(b.id))).d.sessions[0].status, 'interrupted');
});

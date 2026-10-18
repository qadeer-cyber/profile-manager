// Proxy library integration tests: spawns the server against a temp data dir plus local helper servers
// (IP-echo target, HTTP CONNECT proxy with/without auth, SOCKS5 with auth, a black hole for timeouts).
import { listenFree, spawnServer, stopServer, armWatchdog, killTracked } from './_ports.mjs';
armWatchdog(15 * 60 * 1000);
import http from 'http';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

// Ports: OS-assigned unless PM_TEST_PORT / PM_TEST_ECHO_PORT / PM_TEST_OPEN_PROXY_PORT / PM_TEST_AUTH_PROXY_PORT /
// PM_TEST_SOCKS_PORT / PM_TEST_HOLE_PORT are set.
let B; const TOKEN = 'lib-token';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxylib-'));

// IP echo target
const echo = http.createServer((q, s) => q.url === '/ip' ? s.end('{"ip":"203.0.113.9"}') : s.end('<title>via-proxy</title>'));
// HTTP CONNECT proxy, optional Basic auth
function connectProxy(port, cred) {
  return http.createServer((q, s) => s.end()).on('connect', (req, sock) => {
    sock.on('error', () => {});
    if (cred && req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from(cred).toString('base64')) { sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\nContent-Length: 0\r\n\r\n'); return; }
    const [h, p] = req.url.split(':'); const up = net.connect(p, h, () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.end());
  });
}
const open = connectProxy(), authed = connectProxy(0, 'bob:pw1');
// SOCKS5 with user/pass alice:s3cret
let socksAuthed = 0;
const socks = net.createServer(c => {
  c.on('error', () => {});
  c.once('data', () => { c.write(Buffer.from([5, 2]));
    c.once('data', a => { const ul = a[1], u = a.slice(2, 2 + ul).toString(), pl = a[2 + ul], p = a.slice(3 + ul, 3 + ul + pl).toString();
      if (u !== 'alice' || p !== 's3cret') { c.end(Buffer.from([1, 1])); return; }
      socksAuthed++; c.write(Buffer.from([1, 0]));
      c.once('data', r => { let host, i; if (r[3] === 1) { host = [...r.slice(4, 8)].join('.'); i = 8; } else { host = r.slice(5, 5 + r[4]).toString(); i = 5 + r[4]; }
        const up = net.connect(r.readUInt16BE(i), host, () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); up.pipe(c); c.pipe(up); }); up.on('error', () => c.end()); });
    });
  });
});
// black hole: accepts and never answers
const hole = net.createServer(c => c.on('error', () => {}));
const ECHO = await listenFree(echo, 'PM_TEST_ECHO_PORT'), OPEN = await listenFree(open, 'PM_TEST_OPEN_PROXY_PORT'),
  AUTHED = await listenFree(authed, 'PM_TEST_AUTH_PROXY_PORT'), SOCKS = await listenFree(socks, 'PM_TEST_SOCKS_PORT'), HOLE = await listenFree(hole, 'PM_TEST_HOLE_PORT');
const env = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: TOKEN, PM_PROXY_LOOPBACK: '1',
  PROXY_TEST_URL: `http://127.0.0.1:${ECHO}/ip`, PM_PROXY_TEST_TIMEOUT_MS: '1500' };
delete env.PM_SECRET;

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const call = async (m, u, b, h = {}) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b && JSON.stringify(b) }); const text = r.status === 204 ? '' : await r.text(); return { s: r.status, d: text ? JSON.parse(text) : null, raw: text }; };
const ui = (m, u, b) => call(m, '/api' + u, b);
const v1 = (m, u, b) => call(m, '/api/v1' + u, b, { Authorization: `Bearer ${TOKEN}` });
const SECRETS = ['s3cret', 'pw1', 'wrong-pw', 'imp-pass', 'p@ss:w/rd'];
const leaks = raw => SECRETS.some(x => raw.includes(x));
let leaked = false; const watch = r => { if (leaks(r.raw)) { leaked = true; console.log('LEAK in', r.raw.slice(0, 200)); } return r; };

let srv;
try {
  srv = await spawnServer(env); B = srv.url;
  // ---- CRUD ----
  let r = watch(await ui('POST', '/proxies', { name: 'Socks A', type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 's3cret', tags: ['eu', 'res'] }));
  ok(r.s === 201 && r.d.hasPassword === true && !('password' in r.d) && r.d.lastTest.status === null && r.d.assignedProfiles === 0, 'create proxy: 201, hasPassword, no password field, untested');
  const sock = r.d;
  r = watch(await ui('POST', '/proxies', { type: 'http', host: '127.0.0.1', port: OPEN }));
  ok(r.d.name === `http://127.0.0.1:${OPEN}` && r.d.hasPassword === false, 'default name "<type>://<host>:<port>"');
  const openP = r.d;
  for (const [body, why] of [[{ type: 'ftp', host: 'a', port: 1 }, 'bad type'], [{ type: 'http', host: 'a b', port: 1 }, 'bad host'], [{ type: 'http', host: 'a', port: 70000 }, 'bad port']])
    ok((await ui('POST', '/proxies', body)).s === 400, `create rejects ${why}`);
  ok((await ui('POST', '/proxies', { type: 'http', host: '[::1]', port: 8080 })).s === 201, 'bracketed IPv6 host accepted');
  r = await ui('GET', '/proxies?tag=eu'); ok(r.d.length === 1 && r.d[0].id === sock.id, 'list filter: tag');
  r = await ui('GET', '/proxies?q=alice'); ok(r.d.length === 1, 'list filter: q matches username');
  r = await ui('GET', '/proxies?status=untested'); ok(r.d.length === 3, 'list filter: status=untested');
  ok((await ui('GET', '/proxies/nope')).s === 404, 'GET unknown proxy -> 404');

  // ---- tests with classified errors ----
  r = watch(await ui('POST', `/proxies/${sock.id}/test`));
  ok(r.d.ok && r.d.ip === '203.0.113.9' && r.d.latencyMs >= 0 && r.d.error === null && socksAuthed > 0, 'test socks5+auth: ok, external IP parsed');
  ok(r.d.proxy.lastTest.status === 'ok' && r.d.proxy.lastTest.ip === '203.0.113.9' && r.d.proxy.lastTest.testedAt, 'test result persisted to last_test_*');
  r = await ui('POST', `/proxies/${openP.id}/test`); ok(r.d.ok && r.d.ip === '203.0.113.9', 'test http proxy: ok');
  const mk = async b => (await ui('POST', '/proxies', b)).d.id;
  const cases = [
    ['auth_failed', { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 'wrong-pw' }, 'socks5 wrong password'],
    ['auth_failed', { type: 'http', host: '127.0.0.1', port: AUTHED }, 'http proxy 407 without credentials'],
    ['auth_failed', { type: 'http', host: '127.0.0.1', port: AUTHED, username: 'bob', password: 'wrong-pw' }, 'http proxy 407 wrong credentials'],
    ['connect_refused', { type: 'http', host: '127.0.0.1', port: 1 }, 'closed port'],
    ['dns', { type: 'http', host: 'no-such-host.invalid', port: 8080 }, 'unresolvable host'],
    ['timeout', { type: 'http', host: '127.0.0.1', port: HOLE }, 'black-hole proxy'],
    ['protocol_unsupported', { type: 'socks5', host: '127.0.0.1', port: OPEN }, 'socks5 pointed at an HTTP proxy'],
    ['protocol_unsupported', { type: 'https', host: '127.0.0.1', port: OPEN }, 'https (TLS) pointed at a plain HTTP proxy'],
  ];
  // Some sandboxes answer every DNS query (fake IPs); then a real DNS failure can't be produced here.
  const fakeDns = await (await import('dns/promises')).lookup('no-such-host.invalid').then(() => true, () => false);
  for (const [code, body, why] of cases) {
    if (code === 'dns' && fakeDns) { skipped++; console.log('SKIP classified dns: resolver here resolves every name (covered by unit test of classifyProxyError)'); continue; }
    const id = await mk(body); r = watch(await ui('POST', `/proxies/${id}/test`));
    ok(r.s === 200 && r.d.ok === false && r.d.error === code && r.d.proxy.lastTest.error === code, `classified ${code}: ${why}${r.d.error !== code ? ` (got ${r.d.error}: ${r.d.message})` : ''}`);
  }
  const authedOk = await mk({ type: 'http', host: '127.0.0.1', port: AUTHED, username: 'bob', password: 'pw1' });
  r = await ui('POST', `/proxies/${authedOk.id ?? authedOk}/test`); ok(r.d.ok, 'http proxy with correct credentials: ok');

  // ---- PATCH ----
  r = watch(await ui('PATCH', `/proxies/${sock.id}`, { name: 'Socks A2', tags: 'x, y' }));
  ok(r.d.name === 'Socks A2' && r.d.tags.join() === 'x,y' && r.d.lastTest.status === 'ok' && r.d.hasPassword, 'PATCH name/tags keeps password and last test');
  r = await ui('PATCH', `/proxies/${sock.id}`, { port: HOLE }); ok(r.d.lastTest.status === null, 'PATCH endpoint field resets lastTest');
  await ui('PATCH', `/proxies/${sock.id}`, { port: SOCKS });
  r = await ui('POST', `/proxies/${sock.id}/test`); ok(r.d.ok, 'password unchanged after PATCH without password (test still authenticates)');
  r = await ui('PATCH', `/proxies/${openP.id}`, { password: 'imp-pass' }); ok(r.d.hasPassword, 'PATCH sets password');
  r = await ui('PATCH', `/proxies/${openP.id}`, { password: '' }); ok(!r.d.hasPassword, 'PATCH password "" clears it');
  ok((await ui('PATCH', `/proxies/${openP.id}`, { port: 0 })).s === 400, 'PATCH validates');

  // ---- profiles <-> proxies ----
  const prof = (await ui('POST', '/profiles', { name: 'P1' })).d;
  r = watch(await ui('POST', `/profiles/${prof.id}/proxy`, { proxyId: sock.id }));
  ok(r.d.proxyId === sock.id && r.d.proxy.id === sock.id && r.d.proxy.hasPassword && r.d.proxy.password === '••••', 'assign proxy to profile');
  ok((await ui('GET', `/proxies/${sock.id}`)).d.assignedProfiles === 1, 'assignedProfiles count');
  ok((await ui('POST', `/profiles/${prof.id}/proxy`, { proxyId: 'missing' })).s === 404, 'assign unknown proxy -> 404');
  ok((await ui('POST', `/profiles/${prof.id}/proxy`, {})).s === 400, 'assign without proxyId -> 400');
  // launch through the library proxy
  r = await ui('POST', `/profiles/${prof.id}/launch`, { url: `http://127.0.0.1:${ECHO}/` });
  const br = await chromium.connectOverCDP(r.d.cdp.wsEndpoint); const title = await br.contexts()[0].pages()[0].title(); await br.close();
  ok(r.d.running && title === 'via-proxy', 'profile launches through its library socks5+auth proxy');
  r = await ui('POST', `/profiles/${prof.id}/proxy`, { proxyId: openP.id }); ok(r.d.appliesOnNextLaunch === true, 'reassigning a running profile reports appliesOnNextLaunch');
  await ui('POST', `/profiles/${prof.id}/stop`);
  await ui('POST', `/profiles/${prof.id}/proxy`, { proxyId: sock.id });
  const prof2 = (await ui('POST', '/profiles', { name: 'P2' })).d; await ui('POST', `/profiles/${prof2.id}/proxy`, { proxyId: sock.id });
  // inline back-compat: same endpoint+password reuses the library row
  r = await ui('POST', '/profiles', { name: 'Inline', proxy: { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 's3cret' } });
  ok(r.d.proxyId === sock.id, 'inline proxy on profile create reuses the matching library entry');
  const inl = r.d;
  r = await ui('POST', '/profiles', { name: 'Inline2', proxy: { type: 'http', host: '10.9.9.9', port: 8080 } });
  ok(r.d.proxyId && r.d.proxyId !== sock.id && (await ui('GET', `/proxies/${r.d.proxyId}`)).d.host === '10.9.9.9', 'inline proxy with a new endpoint creates a library entry');
  r = await ui('PUT', `/profiles/${inl.id}`, { proxy: null }); ok(r.d.proxyId === null && r.d.proxy === null, 'inline proxy:null unassigns');
  r = await ui('POST', `/profiles/${prof.id}/clone`, {}); ok(r.d.proxyId === sock.id, 'clone shares the same library proxy');
  const cloneId = r.d.id;

  // ---- DELETE ----
  r = await ui('DELETE', `/proxies/${sock.id}`);
  ok(r.s === 409 && r.d.code === 'PROXY_IN_USE' && r.d.assignedProfiles.length === 3 && r.d.assignedProfiles.every(p => p.id && p.name), 'delete assigned proxy -> 409 with assignedProfiles');
  r = await ui('DELETE', `/proxies/${sock.id}?force=1`); ok(r.s === 204, 'delete with ?force=1 -> 204');
  ok((await ui('GET', `/profiles/${prof.id}`)).d.proxyId === null && (await ui('GET', `/profiles/${cloneId}`)).d.proxyId === null, 'force delete unassigned the profiles');
  ok((await ui('DELETE', `/proxies/${openP.id}`)).s === 204, 'delete unassigned proxy -> 204');

  // ---- import ----
  const text = ['1.2.3.4:8080', 'proxy.example.com:3128:bob:imp-pass', 'socks5://alice:p%40ss%3Aw%2Frd@10.0.0.5:1080', 'socks5h://h5.example:1081', 'https://tls.example:443',
    '', '# comment', 'bad line', 'ftp://x:21', 'host:99999', '1.2.3.4:8080'].join('\n');
  r = watch(await v1('POST', '/proxies/import', { text, tags: ['batch'] }));
  const res = r.d.results;
  ok(r.s === 200 && r.d.created === 5 && r.d.duplicates === 1 && r.d.failed === 3, `import totals created=5 dup=1 failed=3 (got ${r.d.created}/${r.d.duplicates}/${r.d.failed})`);
  ok(res.map(x => x.line).join() === '1,2,3,4,5,8,9,10,11', 'per-line results with original line numbers; blanks/comments skipped');
  ok(res[1].input === 'proxy.example.com:3128:bob:***' && res[2].input === 'socks5://alice:***@10.0.0.5:1080', 'passwords masked in import results');
  ok(res[5].error === 'Unrecognized format' && /Unsupported scheme/.test(res[6].error) && /port/.test(res[7].error), 'per-line errors are specific');
  ok(res[8].duplicate === true && res[8].id === res[0].id, 'duplicate line reported with existing id');
  const s5 = (await v1('GET', `/proxies/${res[2].id}`)).d;
  ok(s5.type === 'socks5' && s5.username === 'alice' && s5.hasPassword && s5.tags.join() === 'batch', 'URL format parsed (scheme, user, decoded password, tags)');
  ok((await v1('GET', `/proxies/${res[3].id}`)).d.type === 'socks5', 'socks5h treated as socks5');
  ok((await v1('GET', `/proxies/${res[0].id}`)).d.type === 'http', 'bare host:port uses defaultType http');
  r = await v1('POST', '/proxies/import', { text: '9.9.9.9:1', defaultType: 'socks5' }); ok((await v1('GET', `/proxies/${r.d.results[0].id}`)).d.type === 'socks5', 'defaultType honored');
  ok((await v1('POST', '/proxies/import', { text: Array(1001).fill('1.1.1.1:1').join('\n') })).s === 400, 'more than 1000 lines -> 400');
  ok((await v1('POST', '/proxies/import', {})).s === 400, 'missing text -> 400');

  // ---- /api/v1 mirror + auth ----
  ok((await call('GET', '/api/v1/proxies')).s === 401, 'v1 proxies require the API token');
  r = watch(await v1('POST', '/proxies', { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 's3cret' })); const vid = r.d.id;
  ok(r.s === 201, 'v1 create');
  ok((await v1('POST', `/proxies/${vid}/test`)).d.ok, 'v1 test');
  ok((await v1('PATCH', `/proxies/${vid}`, { name: 'v1 name' })).d.name === 'v1 name', 'v1 patch');
  r = await v1('POST', `/profiles/${prof2.id}/proxy`, { proxyId: vid }); ok(r.d.proxyId === vid, 'v1 assign');
  ok((await v1('DELETE', `/proxies/${vid}`)).s === 409 && (await v1('DELETE', `/proxies/${vid}?force=1`)).s === 204, 'v1 delete (409 then force)');
  ok(Array.isArray((await v1('GET', '/proxies')).d), 'v1 list');

  // ---- never returns passwords ----
  for (const u of ['/proxies', '/profiles']) watch(await ui('GET', u));
  watch(await v1('GET', '/proxies'));
  ok(!leaked, 'no response contained any proxy password');
  const dbRaw = fs.readFileSync(path.join(dataDir, 'profiles.db'));
  ok(!SECRETS.some(x => dbRaw.includes(x)), 'no plaintext proxy password in the database file');
} catch (e) { fail++; console.error(e); }
finally {
  if (srv) await stopServer(srv);
  killTracked();
  [echo, open, authed, socks, hole].forEach(s => s.close());
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup', e); }
  console.log(`\n${pass} passed, ${fail} failed${typeof skipped === 'number' && skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(fail ? 1 : 0);
}

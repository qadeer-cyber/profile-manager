// End-to-end tests. Spawns the server on a temp data dir plus local helper servers
// (an HTTP CONNECT proxy, a SOCKS5 proxy that requires a login, and a target web page).
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
const run = async (f, env) => (await promisify(execFile)('node', [f], { env, encoding: 'utf8' })).stdout;
import http from 'http';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { listenFree, spawnServer, stopServer, killServer, armWatchdog, killTracked, missedGracefulShutdowns } from './_ports.mjs';
armWatchdog(15 * 60 * 1000);

// Ports: OS-assigned (port 0) unless overridden via PM_TEST_PORT / PM_TEST_TARGET_PORT / PM_TEST_HTTP_PROXY_PORT / PM_TEST_SOCKS_PORT.
const TOKEN = 'test-token-123';
let B, srv, env;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
const startServer = async () => { srv = await spawnServer(env); srv.stdout.pipe(process.stdout); B = srv.url; };

// target page
const target = http.createServer((req, res) => res.end('<title>hello-target</title>ok'));
// HTTP CONNECT proxy (no auth)
const httpProxy = http.createServer((req, res) => res.end()).on('connect', (req, sock) => {
  const [h, p] = req.url.split(':'); const up = net.connect(p, h, () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); up.pipe(sock); sock.pipe(up); });
  up.on('error', () => sock.end()); sock.on('error', () => up.destroy());
});
// HTTP forward proxy for plain http GETs through it
httpProxy.on('request', (req, res) => { const u = new URL(req.url); http.get(u, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }).on('error', () => res.end()); });
// SOCKS5 proxy requiring user "alice" / pass "s3cret"
let socksAuthed = 0;
const socks = net.createServer(c => {
  c.on('error', () => {});
  c.once('data', () => { c.write(Buffer.from([5, 2])); // choose user/pass
    c.once('data', a => { const ul = a[1], u = a.slice(2, 2 + ul).toString(), pl = a[2 + ul], p = a.slice(3 + ul, 3 + ul + pl).toString();
      if (u !== 'alice' || p !== 's3cret') { c.end(Buffer.from([1, 1])); return; }
      socksAuthed++; c.write(Buffer.from([1, 0]));
      c.once('data', r => { let host, i = 4;
        if (r[3] === 1) { host = [...r.slice(4, 8)].join('.'); i = 8; } else if (r[3] === 3) { host = r.slice(5, 5 + r[4]).toString(); i = 5 + r[4]; } else { c.end(); return; }
        const port = r.readUInt16BE(i);
        const up = net.connect(port, host, () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); up.pipe(c); c.pipe(up); });
        up.on('error', () => c.end());
      });
    });
  });
});
const TARGET = await listenFree(target, 'PM_TEST_TARGET_PORT'), HTTPP = await listenFree(httpProxy, 'PM_TEST_HTTP_PROXY_PORT'), SOCKS = await listenFree(socks, 'PM_TEST_SOCKS_PORT');
const TARGET_URL = `http://127.0.0.1:${TARGET}/`;
env = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: TOKEN, PM_PROXY_LOOPBACK: '1', PROXY_TEST_URL: TARGET_URL };

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const req = async (m, u, b, h = {}) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b && JSON.stringify(b) }); return { s: r.status, d: r.status === 204 ? null : await r.json() }; };
const j = (m, u, b) => req(m, u, b);
const v1 = (m, u, b) => req(m, '/api/v1' + u, b, { Authorization: `Bearer ${TOKEN}` });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

try {
  await startServer();
  // --- CRUD + encryption ---
  let r = await j('POST', '/api/profiles', { name: 'Work', tags: ['work', 'shop'], folder: 'Clients', notes: 'main', proxy: { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 's3cret' } });
  ok(r.s === 201 && r.d.proxy.password === '••••', 'create profile (password masked in API)');
  const a = r.d;
  ok(fs.existsSync(path.join(dataDir, 'profiles', a.id)), 'user-data dir created');
  const raw = new Database(path.join(dataDir, 'profiles.db'), { readonly: true }).prepare('select x.password from proxies x join profiles p on p.proxy_id = x.id where p.id=?').get(a.id).password;
  ok(raw.includes('enc:v1:') && !raw.includes('s3cret'), 'proxy password encrypted at rest (AES-256-GCM)');
  r = await j('POST', '/api/profiles', { name: '' }); ok(r.s === 400, 'validation rejects empty name');
  r = await j('PUT', `/api/profiles/${a.id}`, { notes: 'edited', proxy: { ...a.proxy, password: '••••' } });
  ok(r.d.notes === 'edited' && r.d.proxy.username === 'alice', 'update keeps existing password when masked');
  r = await j('POST', '/api/profiles', { name: 'Personal', tags: 'home', folder: 'Me' }); const b = r.d;
  r = await j('GET', '/api/profiles?q=pers'); ok(r.d.length === 1 && r.d[0].id === b.id, 'search');
  r = await j('GET', '/api/profiles?tag=work'); ok(r.d.length === 1 && r.d[0].id === a.id, 'tag filter');
  r = await j('GET', '/api/profiles?folder=Me'); ok(r.d.length === 1, 'folder filter');

  // --- proxy test endpoint ---
  r = await j('POST', '/api/proxy/test', { proxy: { type: 'http', host: '127.0.0.1', port: HTTPP } }); ok(r.d.ok, 'proxy test: http proxy');
  r = await j('POST', `/api/profiles/${a.id}/test-proxy`); ok(r.d.ok, 'proxy test: socks5 with login (saved profile)');
  r = await j('POST', '/api/proxy/test', { proxy: { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 'wrong' } }); ok(!r.d.ok, 'proxy test: wrong socks5 password fails');

  // --- socks5 auth through local relay, attach via CDP ---
  const before = socksAuthed;
  r = await j('POST', `/api/profiles/${a.id}/launch`, { url: TARGET_URL });
  ok(r.d.running && r.d.cdp?.wsEndpoint?.startsWith('ws://127.0.0.1:'), 'launch returns CDP wsEndpoint');
  let br = await chromium.connectOverCDP(r.d.cdp.wsEndpoint);
  let pg = br.contexts()[0].pages()[0];
  ok(await pg.title() === 'hello-target' && socksAuthed > before, 'socks5-with-login proxy works via local relay (Playwright attached over CDP)');
  await br.close();

  // --- clone while running ---
  r = await j('POST', `/api/profiles/${a.id}/clone`, {}); ok(r.s === 409 && /Stop it before cloning/.test(r.d.error), 'clone of running profile refused with clear message');
  r = await j('POST', `/api/profiles/${a.id}/clone`, { copyData: false }); ok(r.s === 201, 'clone settings-only while running');
  await j('DELETE', `/api/profiles/${r.d.id}`);
  r = await j('POST', `/api/profiles/${b.id}/launch`, {}); ok(r.d.running, 'launch second profile concurrently');
  r = await j('GET', '/api/meta'); ok(r.d.running.length === 2, 'two profiles running');
  r = await j('POST', `/api/profiles/${a.id}/stop`); ok(!r.d.running, 'stop A');
  r = await j('POST', `/api/profiles/${b.id}/stop`); ok(!r.d.running, 'stop B');

  // --- clone copies data ---
  const ctx = await chromium.launchPersistentContext(path.join(dataDir, 'profiles', a.id), { headless: true });
  await ctx.addCookies([{ name: 'k', value: 'v1', domain: 'example.test', path: '/', expires: Date.now() / 1000 + 3600 }]); await ctx.close();
  r = await j('POST', `/api/profiles/${a.id}/clone`, {}); ok(r.s === 201 && r.d.name === 'Work (copy)', 'clone stopped profile');
  const c = r.d;
  ok(c.proxy.username === 'alice', 'clone keeps proxy settings');
  const ctx2 = await chromium.launchPersistentContext(path.join(dataDir, 'profiles', c.id), { headless: true });
  ok((await ctx2.cookies()).some(k => k.name === 'k' && k.value === 'v1'), 'clone carries cookies/storage'); await ctx2.close();

  // --- automation API ---
  r = await req('GET', '/api/v1/profiles'); ok(r.s === 401, 'v1 rejects missing token');
  r = await req('GET', '/api/v1/profiles', null, { Authorization: 'Bearer nope' }); ok(r.s === 401, 'v1 rejects wrong token');
  r = await req('GET', '/api/v1/profiles', null, { 'X-API-Key': TOKEN }); ok(r.s === 200, 'v1 accepts X-API-Key header');
  r = await v1('POST', '/bulk/create', { profiles: [{ name: 'bulk-1', tags: ['bulk'] }, { name: 'bulk-2', tags: ['bulk'] }] });
  ok(r.s === 201 && r.d.length === 2, 'v1 bulk create');
  const bulkIds = r.d.map(p => p.id);
  r = await v1('POST', '/bulk/create', { profiles: [{ name: 'x' }, { name: '' }] }); ok(r.s === 400, 'v1 bulk create is all-or-nothing on validation');
  r = await v1('POST', '/bulk/launch', { ids: [...bulkIds, 'missing'] });
  ok(r.d.filter(x => x.ok).length === 2 && r.d[2].error === 'not found', 'v1 bulk launch (per-item results)');
  r = await v1('GET', '/running'); ok(r.d.length === 2 && r.d.every(p => p.cdp.debuggerAddress), 'v1 running list has debuggerAddress');
  br = await chromium.connectOverCDP(r.d[0].cdp.httpEndpoint);
  pg = await br.contexts()[0].newPage(); await pg.goto(TARGET_URL);
  ok(await pg.title() === 'hello-target', 'Playwright connectOverCDP via http endpoint'); await br.close();
  r = await v1('POST', '/bulk/stop', {}); ok(r.d.stopped.length === 2, 'v1 bulk stop');

  // --- example scripts ---
  const exEnv = { ...process.env, PM_URL: B, PM_API_TOKEN: TOKEN, PROFILE_ID: b.id, TARGET_URL: TARGET_URL };
  ok((await run('examples/playwright-cdp.mjs', exEnv)).includes('hello-target'), 'examples/playwright-cdp.mjs');
  ok((await run('examples/puppeteer-connect.mjs', exEnv)).includes('hello-target'), 'examples/puppeteer-connect.mjs');
  r = await v1('GET', `/profiles/${b.id}`); ok(!r.d.running, 'examples stopped their profile');

  // --- restart recovery ---
  r = await v1('POST', `/profiles/${b.id}/launch`, {}); const pid = r.d.cdp.pid;
  ok(pid && alive(pid), `browser pid recorded (${pid})`);
  await killServer(srv);
  await startServer();
  await new Promise(r => setTimeout(r, 500));
  r = await j('GET', '/api/meta'); ok(r.d.running.length === 0, 'after crash+restart: running state cleared');
  ok(!alive(pid), 'after restart: orphaned browser process killed');
  r = await j('POST', `/api/profiles/${b.id}/launch`, {}); ok(r.d.running, 'after restart: profile relaunches (locks cleaned)');

  // --- screenshot ---
  await j('POST', `/api/profiles/${a.id}/launch`, {});
  if (fs.existsSync('web/dist/index.html')) {
    const sb = await chromium.launch(); const sp = await sb.newPage({ viewport: { width: 1360, height: 720 } });
    await sp.goto(B); await sp.waitForSelector('.mono'); await sp.screenshot({ path: 'screenshot.png' }); await sb.close();
    ok(true, 'UI screenshot -> screenshot.png');
  }
  r = await j('DELETE', `/api/profiles/${b.id}`);
  ok(r.s === 204 && fs.existsSync(path.join(dataDir, 'profiles', b.id)), 'delete running profile stops it and preserves recoverable data in Trash');
  r = await j('GET', `/api/profiles/${b.id}`); ok(r.s === 404, 'deleted profile 404');
  r = await j('GET', '/api/trash');
  const trashed = r.d.find(p => p.id === b.id);
  ok(r.s === 200 && trashed?.deletedAt && trashed.running === false, 'trashed profile is stopped and visible for recovery');
  r = await j('DELETE', `/api/trash/${b.id}`, { confirmName: 'not-the-name' });
  ok(r.s === 400 && fs.existsSync(path.join(dataDir, 'profiles', b.id)), 'incorrect purge confirmation retains all profile data');
  r = await j('DELETE', `/api/trash/${b.id}`, { confirmName: trashed.name });
  ok(r.s === 200 && !fs.existsSync(path.join(dataDir, 'profiles', b.id)), 'explicit confirmed purge removes the disposable profile data');
  r = await j('GET', '/api/trash'); ok(!r.d.some(p => p.id === b.id), 'confirmed purge also removes the Trash record');
} catch (e) { fail++; console.error(e); }
finally {
  if (srv) await stopServer(srv);
  killTracked();
  [target, httpProxy, socks].forEach(s => s.close());
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup', e); }
  fail += missedGracefulShutdowns();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

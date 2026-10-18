// Security & isolation tests: API auth, secret handling at rest, profile isolation, relay binding.
import { listenFree, spawnServer, stopServer, armWatchdog, killTracked } from './_ports.mjs';
armWatchdog(15 * 60 * 1000);
import fs from 'fs'; import os from 'os'; import path from 'path'; import net from 'net';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

// Server port: OS-assigned unless PM_TEST_PORT is set.
let B; const API = 'sec-api-token', UI = 'sec-ui-token';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sec-'));
const env = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: API, PM_UI_TOKEN: UI, PM_PROXY_LOOPBACK: '1' };
const storedPw = id => { const d = new Database(path.join(dataDir, 'profiles.db'), { readonly: true });
  try { const hasP = d.prepare("SELECT 1 FROM sqlite_master WHERE name='proxies'").get(); const pr = d.prepare('SELECT * FROM profiles WHERE id=?').get(id);
    if (hasP && pr.proxy_id) return d.prepare('SELECT password FROM proxies WHERE id=?').get(pr.proxy_id).password;
    return JSON.parse(pr.proxy).password; } finally { d.close(); } };
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; failures.push(m); console.log('FAIL', m); } };
const ui = (m, p, b) => fetch(B + '/api' + p, { method: m, headers: { 'x-ui-token': UI, 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
let srv;
try {
  srv = await spawnServer(env, { timeoutMs: 30000 }); B = srv.url; // 30s startup wait (QA 134cce5)

  // 1. Auth on every route
  const uiRoutes = [['GET','/profiles'],['GET','/meta'],['POST','/profiles'],['GET','/settings'],['PUT','/settings'],['GET','/diagnostics'],['GET','/browser'],['POST','/browser/install'],['GET','/api-token'],['POST','/proxy/test'],['GET','/events']];
  for (const [m, p] of uiRoutes) { const r = await fetch(B + '/api' + p, { method: m, signal: AbortSignal.timeout(3000) }).catch(() => ({ status: 0 })); ok(r.status === 401, `UI ${m} ${p} rejects missing token (got ${r.status})`); }
  ok((await fetch(B + '/api/profiles', { headers: { 'x-ui-token': 'wrong' } })).status === 401, 'UI rejects wrong token');
  ok((await fetch(B + '/api/profiles', { headers: { 'x-ui-token': UI.slice(0, -1) } })).status === 401, 'UI rejects prefix of token');
  ok((await fetch(B + '/api/profiles?token=' + UI)).status === 401, 'UI token NOT accepted via query string (finding #2)');
  for (const [m, p] of [['GET','/profiles'],['POST','/profiles'],['GET','/running'],['POST','/bulk/create'],['POST','/bulk/launch'],['POST','/bulk/stop']]) {
    const r = await fetch(B + '/api/v1' + p, { method: m }); ok(r.status === 401, `v1 ${m} ${p} rejects missing token (got ${r.status})`);
  }
  ok((await fetch(B + '/api/v1/profiles', { headers: { authorization: 'Bearer ' + UI } })).status === 401, 'v1 rejects UI token as API token');
  ok((await fetch(B + '/api/v1/profiles', { headers: { authorization: 'Bearer ' + API } })).status === 200, 'v1 accepts valid API token');

  // 2. Secrets at rest / in responses
  const PW = 'Sup3r-Secret-PW!';
  const a = await (await ui('POST', '/profiles', { name: 'A', proxy: { type: 'http', host: '127.0.0.1', port: 1, username: 'u', password: PW } })).json();
  const raw = storedPw(a.id);
  ok(raw.startsWith('enc:v1:') || raw.startsWith('ss:v1:'), 'proxy password encrypted at rest');
  ok(!fs.readFileSync(path.join(dataDir, 'profiles.db')).includes(PW), 'plaintext password absent from DB file bytes');
  const listTxt = await (await ui('GET', '/profiles')).text();
  ok(!listTxt.includes(PW) && !listTxt.includes(raw), 'API list never returns password or ciphertext');
  const keyMode = fs.existsSync(path.join(dataDir, 'secret.key')) ? fs.statSync(path.join(dataDir, 'secret.key')).mode & 0o077 : 0;
  ok(process.platform === 'win32' || keyMode === 0, 'secret.key not group/world readable');
  ok((await ui('PUT', '/profiles/' + a.id, { ...a, proxy: { ...a.proxy, password: '••••' } })).ok, 'saving masked password keeps it');
  const raw2 = storedPw(a.id);
  ok(raw2 && raw2 !== '••••' && !raw2.includes('••••'), 'mask placeholder never persisted as password');

  // 3. Input validation: path traversal via id
  for (const bad of ['..%2F..%2Fetc', '../x', 'not-a-uuid']) { const r = await ui('POST', `/profiles/${bad}/launch`, {}); ok(r.status >= 400 && r.status < 500, `launch rejects bad id ${bad} (got ${r.status})`); }

  // 4. Profile isolation (cookies / storage / user-data-dir)
  const p1 = await (await ui('POST', '/profiles', { name: 'Iso1', automationEnabled: true })).json();
  const p2 = await (await ui('POST', '/profiles', { name: 'Iso2', automationEnabled: true })).json();
  const site = (await import('http')).createServer((q, s) => s.end('<title>t</title>')); const SITE = `http://127.0.0.1:${await listenFree(site, 'PM_TEST_SITE_PORT')}/`;
  const l1 = await (await ui('POST', `/profiles/${p1.id}/launch`, { headless: true })).json();
  const l2 = await (await ui('POST', `/profiles/${p2.id}/launch`, { headless: true })).json();
  const ws = x => x.cdp?.wsEndpoint || x.wsEndpoint;
  if (ws(l1) && ws(l2)) {
    const b1 = await chromium.connectOverCDP(ws(l1)), b2 = await chromium.connectOverCDP(ws(l2));
    const pg1 = b1.contexts()[0].pages()[0] || await b1.contexts()[0].newPage();
    await pg1.goto(SITE); await pg1.evaluate(() => { document.cookie = 'iso=one; max-age=9999'; localStorage.setItem('iso', 'one'); });
    const pg2 = b2.contexts()[0].pages()[0] || await b2.contexts()[0].newPage();
    await pg2.goto(SITE);
    const leak = await pg2.evaluate(() => document.cookie + '|' + localStorage.getItem('iso'));
    ok(!leak.includes('iso=one') && !leak.includes('one'), 'cookies/localStorage do not leak between profiles');
    ok(l1.cdp?.debuggerAddress?.startsWith('127.0.0.1') ?? true, 'CDP bound to loopback');
    await b1.close().catch(()=>{}); await b2.close().catch(()=>{});
  } else ok(false, 'isolation: could not launch both profiles: ' + JSON.stringify([l1, l2]).slice(0, 200));
  await ui('POST', `/profiles/${p1.id}/stop`); await ui('POST', `/profiles/${p2.id}/stop`);
  // persistence: cookie survives restart of same profile
  const l1b = await (await ui('POST', `/profiles/${p1.id}/launch`, { headless: true })).json();
  if (ws(l1b)) { const b = await chromium.connectOverCDP(ws(l1b)); const pg = b.contexts()[0].pages()[0] || await b.contexts()[0].newPage(); await pg.goto(SITE);
    ok((await pg.evaluate(() => localStorage.getItem('iso'))) === 'one', 'profile storage persists across relaunch'); await b.close().catch(()=>{}); }
  await ui('POST', `/profiles/${p1.id}/stop`);
  const d1 = path.join(dataDir, 'profiles', p1.id), d2 = path.join(dataDir, 'profiles', p2.id);
  ok(fs.existsSync(d1) && fs.existsSync(d2) && d1 !== d2, 'each profile has its own user-data-dir');

  // 5. Relay binds loopback only (authenticated proxy)
  const up = net.createServer(c => c.end()); const UP = await listenFree(up, 'PM_TEST_UPSTREAM_PORT');
  const pr = await (await ui('POST', '/profiles', { name: 'Relay', proxy: { type: 'http', host: '127.0.0.1', port: UP, username: 'u', password: 'p' } })).json();
  await ui('POST', `/profiles/${pr.id}/launch`, { headless: true });
  const row = new Database(path.join(dataDir, 'profiles.db'), { readonly: true }).prepare('SELECT * FROM running').all().find(r => Object.values(r).includes(pr.id));
  const relay = row && Object.values(row).find(v => typeof v === 'string' && /^http:\/\/127\.0\.0\.1:\d+/.test(v));
  ok(!!relay, 'relay URL is loopback (' + relay + ')');
  ok(relay && !relay.includes('u:p@'), 'relay URL stored without upstream credentials');
  await ui('POST', `/profiles/${pr.id}/stop`); up.close(); site.close();
} catch (e) { ok(false, 'unexpected error: ' + e.stack); }
finally {
  if (srv) await stopServer(srv);
  killTracked();
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
}

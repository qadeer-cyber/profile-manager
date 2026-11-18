/**
 * M2 diagnostics security — DIAGNOSTICS_CONTRACT.md §1, §4, §5, §7, §8, §9 (full contract, SHA cd1ce49f…).
 * Evidence level 1 (in-process server, no browser). Live M2 routes stay todo 'Blocked: backend absent'.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import {
  validateDiagnosticsV1,
  validateDiagnosticsErrorBody,
  validateEnvironmentPostBody,
  assertCacheControlNoStore,
  validDiagnosticsFixture,
  POST_CONSENT,
  ERROR_CODES,
  DISCLOSURE,
  findForbiddenMaterial,
  findRelayValue,
} from './diagnostics-v1-validator.mjs';

// External artifact (UI agent's patch, not in the repo): override with PM_DIAG_UI_PATCH. When absent, dependent
// tests are skipped with an explicit 'external artifact absent' reason, never passed silently.
const HAS_BACKEND = fs.existsSync(new URL('../server/diagnostics.js', import.meta.url));
const UI_PATCH = process.env.PM_DIAG_UI_PATCH || '/workspace/m2ui-review/diagnostics-ui.patch';
const UI_PATCH_SKIP = fs.existsSync(UI_PATCH) ? false
  : `external artifact absent: UI patch not found at ${UI_PATCH} (set PM_DIAG_UI_PATCH)`;

export const SENTINELS = Object.freeze({
  proxyUser: 'SENTINEL_PROXY_USER_7f3a',
  proxyPass: 'SENTINEL_PROXY_PASS_9c2b',
  cookie: 'SENTINEL_COOKIE_VALUE_aa11',
  localStorage: 'SENTINEL_LOCALSTORAGE_bb22',
  userTabUrl: 'https://sentinel.example/user-tab-cc33',
  relayEndpoint: 'http://127.0.0.1:65530/sentinel-relay-dd44',
  fullCmdline: '--sentinel-full-cmdline-ee55 --password=SENTINEL_CMDLINE_PASS',
  uiToken: 'm2-ui-tok',
  apiToken: 'm2-api-tok-sentinel',
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2sec-'));
process.env.PM_DATA_DIR = tmp;
process.env.PM_API_TOKEN = SENTINELS.apiToken;
delete process.env.PM_SECRET;
delete process.env.PM_UI_TOKEN;
delete process.env.PM_AUTOMATION_DEFAULT;

let srv;
let base;

before(async () => {
  const { startServer } = await import('../server/app.js');
  srv = await startServer({ port: 0, uiToken: SENTINELS.uiToken, staticDir: null });
  base = srv.url;
});

after(async () => {
  try { await srv?.close(); } finally {
    const { db } = await import('../server/db.js');
    if (db.open) db.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function raw(method, urlPath, { headers = {}, body } = {}) {
  const r = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
  return { status: r.status, headers: r.headers, json, text };
}

function assertNoSentinels(text) {
  for (const v of Object.values(SENTINELS)) {
    // tokens may appear in our own request headers, not in response bodies
    if (v === SENTINELS.uiToken || v === SENTINELS.apiToken) continue;
    assert.ok(!text.includes(v), `sentinel leaked in response: ${v}`);
  }
  assert.ok(!/[?&]token=/.test(text), 'token must not appear as URL/query material in body');
}

test('§5: missing X-UI-Token rejected before profile access', async () => {
  const r = await raw('GET', '/api/profiles');
  assert.equal(r.status, 401);
  assertNoSentinels(r.text);
});

test('§5: ?token= query string is not accepted for UI auth', async () => {
  const r = await raw('GET', `/api/profiles?token=${SENTINELS.uiToken}`);
  assert.equal(r.status, 401);
});

test('§5: global /api/diagnostics still works with UI token (unchanged M1 health)', async () => {
  const r = await raw('GET', '/api/diagnostics', { headers: { 'X-UI-Token': SENTINELS.uiToken } });
  assert.equal(r.status, 200);
  assert.ok(r.json && typeof r.json === 'object');
  // M1 health payload may include DB `schemaVersion` (integer migration version).
  // It must NOT be a DiagnosticsV1 body (no observation/runtime/webrtc).
  assert.equal('observation' in r.json, false);
  assert.equal('runtime' in r.json, false);
  assert.equal('webrtc' in r.json, false);
  assert.ok('app' in r.json || 'versions' in r.json || 'platform' in r.json);
  assertNoSentinels(r.text);
});

test('§5: automation token via Authorization Bearer and X-API-Key both accepted on /api/v1', async () => {
  const a = await raw('GET', '/api/v1/profiles', { headers: { Authorization: `Bearer ${SENTINELS.apiToken}` } });
  assert.equal(a.status, 200);
  const b = await raw('GET', '/api/v1/profiles', { headers: { 'X-API-Key': SENTINELS.apiToken } });
  assert.equal(b.status, 200);
});

test('§1/§5 Blocked: GET /api/profiles/:id/diagnostics — backend absent (expect non-200 DiagnosticsV1)', async () => {
  const created = await raw('POST', '/api/profiles', {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
    body: { name: 'm2-sec-diag' },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const r = await raw('GET', `/api/profiles/${id}/diagnostics`, {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
  });
  // Backend absent → 404 (or similar). Must not return a DiagnosticsV1 200.
  if (!HAS_BACKEND) {
    assert.notEqual(r.status, 200);
    assert.ok([404, 405, 501].includes(r.status), `unexpected ${r.status}`);
    if (r.json && r.json.schemaVersion != null) assert.fail('DiagnosticsV1 body must not be returned while backend absent');
  } else {
    assert.equal(r.status, 200);
    assert.equal(assertCacheControlNoStore(r.headers).ok, true);
    const result = validateDiagnosticsV1(r.json, { route: 'GET' });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(r.json.observation.state, 'unavailable');
  }
  assertNoSentinels(r.text);
  // When backend lands, success AND error must set Cache-Control: no-store — cannot assert on 404 HTML/JSON today.
});

test('§1/§5: unauthenticated GET planned diagnostics path is not 200', async () => {
  const r = await raw('GET', '/api/profiles/00000000-0000-4000-8000-000000000001/diagnostics');
  assert.ok([401, 404].includes(r.status));
  assert.notEqual(r.status, 200);
  assertNoSentinels(r.text);
});

test('§1 POST body fixture rules (exact props + consent) — offline validator', () => {
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: '33333333-3333-4333-8333-333333333333',
    consent: POST_CONSENT,
  }).ok, true);
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: 'x',
    consent: POST_CONSENT,
    foo: 1,
  }).ok, false);
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: 'x',
    consent: 'open-visible-diagnostic-tab ',
  }).ok, false);
});

test('§1/§7.1–2 Blocked: live POST /diagnostics/environment — backend absent', async () => {
  const created = await raw('POST', '/api/profiles', {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
    body: { name: 'm2-sec-env' },
  });
  const id = created.json.id;
  const r = await raw('POST', `/api/profiles/${id}/diagnostics/environment`, {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
    body: { expectedLaunchId: '33333333-3333-4333-8333-333333333333', consent: POST_CONSENT },
  });
  assert.notEqual(r.status, 200);
  if (!HAS_BACKEND) assert.ok([404, 405, 501].includes(r.status), `unexpected ${r.status}`);
  else {
    assert.equal(r.status, 409);
    assert.equal(assertCacheControlNoStore(r.headers).ok, true);
    const checked = validateDiagnosticsErrorBody(r.json);
    assert.equal(checked.ok, true, checked.errors.join('\n'));
    assert.equal(r.json.error.code, 'LAUNCH_CHANGED');
  }
  assertNoSentinels(r.text);
});

test('§4 error body shape validator + allowed codes only (fixture)', () => {
  for (const code of ERROR_CODES) {
    const r = validateDiagnosticsErrorBody({
      error: { code, message: 'm', requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
    assert.equal(r.ok, true, r.errors.join(';'));
  }
  assert.equal(validateDiagnosticsErrorBody({
    error: { code: 'HACKED', message: 'm', requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  }).ok, false);
});

test('§4/§5 Cache-Control no-store helper rejects missing header', () => {
  assert.equal(assertCacheControlNoStore({ get: () => null }).ok, false);
  assert.equal(assertCacheControlNoStore({ get: () => 'no-store' }).ok, true);
  assert.equal(assertCacheControlNoStore({ get: () => 'private, no-store' }).ok, true);
});

test('no TCP debugging listener on idle API server', async () => {
  async function canConnect(port) {
    return await new Promise((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.setTimeout(200, () => { s.destroy(); resolve(false); });
    });
  }
  for (const port of [9222, 9229, 9333]) {
    assert.equal(await canConnect(port), false, `unexpected listener on ${port}`);
  }
});

test('valid DiagnosticsV1 fixture never embeds sentinel secrets', () => {
  const body = validDiagnosticsFixture();
  const text = JSON.stringify(body);
  assertNoSentinels(text);
  assert.equal(validateDiagnosticsV1(body).ok, true);
});


test('§5 static: M2 diagnostics sources must not reference /api/api-token or automation API_TOKEN', async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const m2Paths = [
    'server/diagnostics.js',
    'web/src/pages/DiagnosticsPage.jsx',
    'web/src/components/ProfileDiagnostics.jsx',
    'web/src/hooks/useProfileDiagnostics.js',
  ];
  const forbidden = [
    { re: /\/api\/api-token/, label: "'/api/api-token'" },
    { re: /\bAPI_TOKEN\b/, label: 'API_TOKEN' },
    { re: /\bPM_API_TOKEN\b/, label: 'PM_API_TOKEN' },
  ];

  for (const rel of m2Paths) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      // Skip-as-todo for files not in the baseline / not delivered yet.
      await t.test(`absent (skip): ${rel}`, { todo: true }, () => {});
      continue;
    }
    await t.test(`scan ${rel}`, () => {
      const text = fs.readFileSync(abs, 'utf8');
      for (const { re, label } of forbidden) {
        assert.equal(re.test(text), false, `${rel} must not reference ${label}`);
      }
    });
  }

  const patchPath = UI_PATCH;
  if (UI_PATCH_SKIP) return;
  await t.test('scan diagnostics-ui.patch added lines', () => {
    const added = fs.readFileSync(patchPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
    for (const { re, label } of forbidden) {
      assert.equal(re.test(added), false, `diagnostics-ui.patch added lines must not reference ${label}`);
    }
  });
});

// ---- §5: no permissive CORS on existing or planned diagnostics routes ----
test('§5: no permissive CORS on /api/diagnostics, /api/profiles or planned M2 routes (incl. preflight)', async () => {
  const origin = { Origin: 'https://evil.example' };
  const auth = { 'X-UI-Token': SENTINELS.uiToken, ...origin };
  const paths = ['/api/diagnostics', '/api/profiles', '/api/profiles/x/diagnostics', '/api/v1/profiles/x/diagnostics'];
  for (const u of paths) {
    for (const h of [auth, origin]) {
      const r = await raw('GET', u, { headers: h });
      assert.equal(r.headers.get('access-control-allow-origin'), null, `${u} ACAO`);
    }
    const pre = await fetch(base + u, { method: 'OPTIONS', headers: { ...origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-ui-token' } });
    await pre.arrayBuffer();
    assert.equal(pre.headers.get('access-control-allow-origin'), null, `${u} preflight ACAO`);
  }
});

// ---- §9: sensitive data absent from payloads AND logs (existing routes + planned M2 paths) ----
test('§9 level 1: proxy credentials never in diagnostics payloads or server logs', async () => {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map(String).join(' ')); };
  process.stdout.write = (c, ...r) => { lines.push(String(c)); return origOut(c, ...r); };
  process.stderr.write = (c, ...r) => { lines.push(String(c)); return origErr(c, ...r); };
  const bodies = [];
  try {
    const H = { 'X-UI-Token': SENTINELS.uiToken };
    const px = await raw('POST', '/api/proxies', { headers: H, body: { name: 'sentinel', type: 'http', host: '127.0.0.1', port: 65530, username: SENTINELS.proxyUser, password: SENTINELS.proxyPass } });
    assert.equal(px.status, 201, px.text);
    assert.ok(!px.text.includes(SENTINELS.proxyPass), 'proxy password echoed');
    const pr = await raw('POST', '/api/profiles', { headers: H, body: { name: 'sentinel-profile', proxy: { type: 'http', host: '127.0.0.1', port: 65530, username: SENTINELS.proxyUser, password: SENTINELS.proxyPass } } });
    assert.ok(pr.status === 200 || pr.status === 201, pr.text);
    const id = pr.json.id;
    assert.ok(!pr.text.includes(SENTINELS.proxyPass), 'profile response echoed proxy password');
    const calls = [
      ['GET', '/api/diagnostics', H], ['GET', `/api/profiles/${id}/diagnostics`, H],
      ['POST', `/api/profiles/${id}/diagnostics/environment`, H],
      ['GET', `/api/v1/profiles/${id}/diagnostics`, { Authorization: `Bearer ${SENTINELS.apiToken}` }],
      ['GET', `/api/profiles/${id}/diagnostics`, {}],
    ];
    for (const [m, u, h] of calls) {
      const r = await raw(m, u, { headers: h, body: m === 'POST' ? { expectedLaunchId: '22222222-2222-4222-8222-222222222222', consent: POST_CONSENT } : undefined });
      bodies.push(r.text);
      for (const v of [SENTINELS.proxyUser, SENTINELS.proxyPass, SENTINELS.apiToken]) assert.ok(!r.text.includes(v), `${m} ${u} leaked ${v}`);
      assert.ok(!/(https?|socks5?):\/\/[^/\s"]*:[^/\s"]*@/.test(r.text), `${m} ${u} credential-bearing proxy URL`);
      // §9 hard: no local relay endpoint, no raw command-line flags / user-data-dir / remote-debugging, no data-dir path
      assert.deepEqual(findForbiddenMaterial(r.text), [], `${m} ${u} forbidden material`);
      // data-dir path: hard for every M2 route. The M1 global health payload (/api/diagnostics) exposes the
      // data dir by M1 design. Flagged in M2_ACCEPTANCE.md, out of DiagnosticsV1 scope; not changed here.
      if (u !== '/api/diagnostics') assert.ok(!r.text.includes(tmp), `${m} ${u} leaked data-dir path`);
    }
  } finally {
    Object.assign(console, orig); process.stdout.write = origOut; process.stderr.write = origErr;
  }
  const log = lines.join('\n');
  for (const v of [SENTINELS.proxyUser, SENTINELS.proxyPass, SENTINELS.apiToken, SENTINELS.uiToken]) assert.ok(!log.includes(v), `log leaked ${v}`);
  assert.ok(!/(https?|socks5?):\/\/[^/\s"]*:[^/\s"]*@/.test(log), 'log contains credential-bearing proxy URL');
});

test('§9 level 1: running-row relay_url value never appears in diagnostics/profile responses', async () => {
  const { db } = await import('../server/db.js');
  const H = { 'X-UI-Token': SENTINELS.uiToken };
  const pr = await raw('POST', '/api/profiles', { headers: H, body: { name: 'relay-row-profile' } });
  assert.ok(pr.status === 200 || pr.status === 201, pr.text);
  const id = pr.json.id;
  const relayUrl = 'http://127.0.0.1:61987';
  // Seed the temp test DB only (PM_DATA_DIR=tmp); pid null so nothing is signalled.
  db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(id, null, null, null, relayUrl, new Date().toISOString());
  try {
    const row = db.prepare('SELECT relay_url FROM running WHERE id=?').get(id);
    assert.equal(row.relay_url, relayUrl);
    const calls = [
      ['GET', '/api/profiles', H], ['GET', `/api/profiles/${id}`, H], ['GET', '/api/diagnostics', H],
      ['GET', `/api/profiles/${id}/diagnostics`, H], ['POST', `/api/profiles/${id}/diagnostics/environment`, H],
      ['GET', `/api/v1/profiles/${id}/diagnostics`, { Authorization: `Bearer ${SENTINELS.apiToken}` }],
      ['GET', `/api/v1/profiles`, { Authorization: `Bearer ${SENTINELS.apiToken}` }],
    ];
    for (const [m, u, h] of calls) {
      const r = await raw(m, u, { headers: h, body: m === 'POST' ? { expectedLaunchId: 'launch-A1', consent: POST_CONSENT } : undefined });
      assert.deepEqual(findRelayValue(r.text, row.relay_url), [], `${m} ${u} (status ${r.status})`);
    }
  } finally {
    db.prepare('DELETE FROM running WHERE id=?').run(id);
  }
});

test('§9 hard: relay-endpoint and command-line detectors catch sentinel material', () => {
  assert.ok(findForbiddenMaterial(SENTINELS.relayEndpoint).length > 0, 'relay sentinel');
  assert.ok(findForbiddenMaterial(SENTINELS.fullCmdline).length > 0, 'cmdline sentinel');
  assert.ok(findForbiddenMaterial(`--user-data-dir=${tmp}`).length > 0);
  assert.ok(findForbiddenMaterial('--remote-debugging-port=0').length > 0);
  assert.deepEqual(findForbiddenMaterial(validDiagnosticsFixture()), []);
});

// ---- §7/§8 static: UI patch (UI agent's file, read-only) ----
function patchAddedByFile(patchPath) {
  const files = {}; let cur = null;
  for (const line of fs.readFileSync(patchPath, 'utf8').split(/\r?\n/)) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { cur = m[1]; files[cur] = files[cur] || []; continue; }
    if (cur && line.startsWith('+') && !line.startsWith('+++')) files[cur].push(line.slice(1));
  }
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.join('\n')]));
}

const UI_SOURCE = [
  'web/src/components/ProfileDiagnostics.jsx',
  'web/src/hooks/useProfileDiagnostics.js',
];
function integratedUiSources() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = Object.fromEntries(UI_SOURCE.map(rel => [rel, fs.readFileSync(path.join(root, rel), 'utf8')]));
  if (!UI_PATCH_SKIP) Object.assign(files, patchAddedByFile(UI_PATCH));
  return files;
}

test('§7 static: UI disclosure text equals the contract exactly', () => {
  const all = Object.values(integratedUiSources()).join('\n');
  const consts = [...all.matchAll(/DISCLOSURE\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  assert.ok(consts.length >= 1, 'no DISCLOSURE constant in the diagnostics UI');
  for (const c of consts) assert.equal(c, DISCLOSURE);
});

test('§7.1/§8 static: UI production code has no polling, storage, hidden probe or auto POST', () => {
  const files = integratedUiSources();
  const prod = Object.entries(files).filter(([f]) => f.startsWith('web/src/'));
  assert.ok(prod.length >= 1, 'no diagnostics UI sources');
  for (const [f, src] of prod) {
    assert.ok(!/\bsetInterval\s*\(/.test(src), `${f}: setInterval polling (§8 no polling)`);
    assert.ok(!/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.test(src), `${f}: persistent diagnostic cache (§8)`);
    assert.ok(!/\bwindow\.open\s*\(|<iframe/i.test(src), `${f}: renderer-side probe/hidden tab (§7.10)`);
  }
  const hook = Object.entries(files).find(([f]) => /useProfileDiagnostics/.test(f));
  assert.ok(hook, 'hook file missing');
  assert.ok(hook[1].includes(POST_CONSENT), 'hook sends exact consent value');
  assert.ok(/expectedLaunchId/.test(hook[1]), 'hook sends expectedLaunchId');
});

// ---- Blocked: need the M2 backend (live routes) ----
// Case 8 live spec: with PM_API_TOKEN set to a sentinel, run GET and POST diagnostics; assert response bodies
//   and headers never contain the API_TOKEN value; request log shows no GET /api/api-token from M2 flows.
test('§9: diagnostics GET/POST do not migrate the database (schema stays at currentVersion / migration head)', async () => {
  const { db } = await import('../server/db.js');
  const { migrations, currentVersion } = await import('../server/migrations.js');
  const head = migrations.at(-1).version;
  const before = currentVersion(db);
  const beforeRows = db.prepare('SELECT version, name FROM schema_version ORDER BY version').all();
  assert.equal(before, head, 'database must already be at the migration head');
  const created = await raw('POST', '/api/profiles', {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
    body: { name: 'm2-schema-sec' },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const get = await raw('GET', `/api/profiles/${id}/diagnostics`, { headers: { 'X-UI-Token': SENTINELS.uiToken } });
  const post = await raw('POST', `/api/profiles/${id}/diagnostics/environment`, {
    headers: { 'X-UI-Token': SENTINELS.uiToken },
    body: { expectedLaunchId: '33333333-3333-4333-8333-333333333333', consent: POST_CONSENT },
  });
  if (!HAS_BACKEND) {
    assert.notEqual(get.status, 200);
    assert.notEqual(post.status, 200);
  } else {
    assert.equal(get.status, 200);
    assert.equal(post.status, 409);
  }
  assert.equal(currentVersion(db), before, 'diagnostics GET/POST must not apply a migration');
  assert.equal(currentVersion(db), head);
  assert.deepEqual(db.prepare('SELECT version, name FROM schema_version ORDER BY version').all(), beforeRows);
});

// Former scaffold todos now point at executing tests (see diagnostics-coverage-pointers.test.js):
// S1 envelopes + no-store: test/diagnostics-recovery.test.js "HTTP auth before JSON..."
//    and test/diagnostics-gate.live.test.js 429 / 409 rows
// S2 auth before lookup: test/diagnostics-recovery.test.js "HTTP auth before JSON..."
// S4 foreground: test/diagnostics-live.test.js "real Chromium 156: OS process identity..."
// S5 allowlisted script: test/diagnostics-unit.test.js asserts evaluate receives readDiagnosticEnvironment
// S6 §7.8: test/diagnostics-gate.live.test.js "§7.8 (row E13)"
// S7 §7.9 open tab: test/diagnostics-gate.live.test.js "§7.9 tab stays open after success"
// S8 §7.11: test/diagnostics-gate.live.test.js "§7.11 (row S8)"
// S3 is not a DiagnosticsV1 rule. The assertion below records that, rather than a skipped todo.

test('§5 does not impose an automation /api/v1 GET-only rule (row S3)', () => {
  const contract = fs.readFileSync(new URL('../docs/handoff/m2/contracts/DiagnosticsV1.original.md', import.meta.url), 'utf8');
  const section = contract.split('## 5. Authentication and transport')[1].split('## 6.')[0];
  assert.ok(section && section.includes('X-UI-Token'));
  assert.equal(/GET-only|only GET/.test(section), false);
});

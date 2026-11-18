/**
 * M2 diagnostics e2e scaffolds (full DIAGNOSTICS_CONTRACT.md, SHA cd1ce49f…).
 * Schema/semantics covered offline (level 1) via diagnostics-v1-validator.
 * Live Chromium observation (level 2) and §7/§8 behaviour: todo 'Blocked: backend absent'.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  validateDiagnosticsV1,
  validateEnvironmentPostBody,
  validDiagnosticsFixture,
  POST_CONSENT,
} from './diagnostics-v1-validator.mjs';

const HAS_BACKEND = fs.existsSync(new URL('../server/diagnostics.js', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2e2e-'));
process.env.PM_DATA_DIR = tmp;
process.env.PM_API_TOKEN = 'm2-e2e-tok';
delete process.env.PM_SECRET;
delete process.env.PM_UI_TOKEN;

let srv;
let base;
let db;

before(async () => {
  ({ db } = await import('../server/db.js'));
  const { startServer } = await import('../server/app.js');
  srv = await startServer({ port: 0, uiToken: 'm2-e2e-ui', staticDir: null });
  base = srv.url;
});

after(async () => {
  try { await srv?.close(); } finally {
    if (db?.open) db.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function ui(method, urlPath, body) {
  const r = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-UI-Token': 'm2-e2e-ui' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
  return { status: r.status, headers: r.headers, json, text };
}

test('schema version unchanged by diagnostics GET/POST (equals migration head)', async () => {
  const { migrations, currentVersion } = await import('../server/migrations.js');
  const head = migrations.at(-1).version;
  const before = currentVersion(db);
  const beforeRows = db.prepare('SELECT version, name FROM schema_version ORDER BY version').all();
  assert.equal(before, head, 'database must already be at the migration head');
  assert.equal(typeof head, 'number');
  assert.ok(Number.isInteger(head) && head >= 1);
  const created = await ui('POST', '/api/profiles', { name: 'm2-schema-diag' });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const get = await ui('GET', `/api/profiles/${id}/diagnostics`);
  const post = await ui('POST', `/api/profiles/${id}/diagnostics/environment`, {
    expectedLaunchId: '33333333-3333-4333-8333-333333333333',
    consent: POST_CONSENT,
  });
  const rejected = await ui('POST', `/api/profiles/${id}/diagnostics/environment`, {});
  if (!HAS_BACKEND) {
    for (const r of [get, post, rejected]) assert.ok([404, 405, 501].includes(r.status), `got ${r.status}`);
  } else {
    assert.equal(get.status, 200);
    const checked = validateDiagnosticsV1(get.json, { route: 'GET' });
    assert.equal(checked.ok, true, checked.errors.join('\n'));
    assert.equal(post.status, 409);
    assert.equal(rejected.status, 400);
  }
  const after = currentVersion(db);
  assert.equal(after, before, 'diagnostics GET/POST must not apply a migration');
  assert.equal(after, head, 'schema must remain the migration head');
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v, head);
  assert.deepEqual(db.prepare('SELECT version, name FROM schema_version ORDER BY version').all(), beforeRows);
});

test('launchId already exists in server/browsers.js (compatibility with observation.launchId)', () => {
  const src = fs.readFileSync(new URL('../server/browsers.js', import.meta.url), 'utf8');
  assert.match(src, /launchId:\s*randomUUID\(\)/);
  assert.match(src, /launchId:\s*entry\?\.launchId/);
});

test('GET planned diagnostics path does not mutate profile directory (backend absent → 404)', async () => {
  const created = await ui('POST', '/api/profiles', { name: 'm2-e2e-dir' });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const dir = path.join(tmp, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'marker.txt');
  fs.writeFileSync(marker, 'before');
  const before = fs.readdirSync(dir).sort();
  const r = await ui('GET', `/api/profiles/${id}/diagnostics`);
  if (!HAS_BACKEND) assert.ok([404, 405, 501].includes(r.status), `got ${r.status}`);
  else {
    assert.equal(r.status, 200);
    const result = validateDiagnosticsV1(r.json, { route: 'GET' });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(r.json.observation.state, 'unavailable');
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'before');
});

test('offline: valid observation fixture validates; POST consent body validates', () => {
  const complete = validDiagnosticsFixture({
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: '33333333-3333-4333-8333-333333333333',
      requestedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:00:01.000Z',
      durationMs: 1000,
      validUntil: '2026-10-19T16:00:31.000Z',
      state: 'complete',
      reason: null,
    },
    environment: {
      timezone: { availability: 'available', value: 'UTC', source: 'visible_probe' },
      locale: { availability: 'available', value: 'en-US', source: 'visible_probe' },
      languages: { availability: 'available', value: ['en-US', 'en'], source: 'visible_probe' },
    },
  });
  assert.equal(validateDiagnosticsV1(complete).ok, true, validateDiagnosticsV1(complete).errors.join('\n'));
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: '33333333-3333-4333-8333-333333333333',
    consent: POST_CONSENT,
  }).ok, true);
});

test('Blocked: live valid DiagnosticsV1 observation against real Chromium (backend absent)', async () => {
  const created = await ui('POST', '/api/profiles', { name: 'm2-e2e-live' });
  const id = created.json.id;
  const r = await ui('GET', `/api/profiles/${id}/diagnostics`);
  if (!HAS_BACKEND) assert.notEqual(r.status, 200);
  else {
    assert.equal(r.status, 200);
    const result = validateDiagnosticsV1(r.json, { route: 'GET' });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(r.json.observation.state, 'unavailable');
  }
});

// Stale scaffold todos removed. These rows are pointers to executing tests.
// They are not passes by themselves. test/diagnostics-coverage-pointers.test.js
// checks that each cited test name still exists.
// E1  test/diagnostics-gate.live.test.js  "§8 (row E1): GET on a disconnected browser"
// E2  test/diagnostics-live.test.js       "real Chromium 156: OS process identity, foreground probe, cancellation and launch invalidation"
// E3  test/diagnostics-gate.live.test.js  "§8 429 DIAGNOSTICS_BUSY on overlap"
// E4  test/diagnostics-e4-merge-gate.test.js  60 s idle + restart (no observation cache, stale .pm-lock cleanup)
// E5  test/diagnostics-gate.live.test.js  "§7.9 tab stays open after success"
// E6  test/diagnostics-gate.live.test.js  "§2/§8 (row E6): launching / stopping"
// E7  test/diagnostics-gate.live.test.js  "case 6 / §8: relaunch"
// E8  test/diagnostics-gate.live.test.js  "§7.9 tab stays open after success" (case 4 stop)
// E10 test/diagnostics-gate.live.test.js  "§7.9 tab stays open after success" (case 2)
// E11 test/diagnostics-gate.live.test.js  "case 3 (row E11)"
// E12 test/diagnostics-gate.live.test.js  "case 6 / §8: relaunch"
// E13 test/diagnostics-gate.live.test.js  "§7.8 (row E13)"
// E14 Linux half: test/diagnostics-gate.live.test.js "§10 no debugging TCP port"
// E15 test/lifecycle.e2e.js via npm run test:engine
// Case 1 and case 7: test/diagnostics-live.test.js
// Case 5 (E9) and the Windows socket half of E14 stay open below.

test('PENDING case 5: forced taskkill /F still classifies Error (Windows 10/11 only)', { todo: 'Windows 10/11 release QA. Linux SIGKILL is not this case. Do not mark PASS from a Linux run.' }, () => {});
test('PENDING §10 Windows: no extra debugging TCP port during GET/POST (Get-NetTCPConnection)', { todo: 'Windows 10/11 release QA. Linux /proc + ss evidence is test/diagnostics-gate.live.test.js and does not close this half.' }, () => {});

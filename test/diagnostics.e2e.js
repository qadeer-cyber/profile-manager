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

test('§8: GET on a disconnected browser => observation unavailable/invalidated, reason browser_disconnected', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§8: probe exceeding 3 s => reason timeout, response within deadline; late completion ignored, nothing queued', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§8: overlapping request for same profile => 429 DIAGNOSTICS_BUSY; other profiles unaffected; slot released after timeout/error', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§8: no polling — zero diagnostics requests without user action over 60 s; no persistent cache after restart', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§8: resource cleanup — no leaked CDP sessions/listeners after N GET/POST/timeout cycles', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§2/§8: launching/stopping profile => unavailable with reason launching/stopping', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§8: POST with old expectedLaunchId after relaunch => 409 LAUNCH_CHANGED; launch changed mid-collection => invalidated launch_changed', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
// §8 rapid relaunch and blocked case 1 execute in test/diagnostics-live.test.js.
// Case 4 spec: with probe tab open, app Stop (POST /api/profiles/:id/stop); assert whole profile gone:
//   no browser process tree, no .pm-lock, no running row, Stopped (no last_error).
test('PENDING Blocked case 4: app Stop terminates whole profile incl. diagnostic tab (no process, .pm-lock, running row)', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
// Case 5 spec (evidence level 3+, Windows only): with probe tab open, taskkill /F the browser;
//   assert Error classification, last_error set, profile:crashed emitted, lock released.
test('PENDING Blocked case 5: forced taskkill /F still classifies Error (Windows level 3+ only)', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
// Case 7 spec (level 2): attach CDP observer; Network.requestWillBeSent on probe target only data: URLs
//   (zero external requests); no Runtime.evaluate/Runtime.callFunctionOn sent to user targets.
// Blocked case 7 executes in test/diagnostics-live.test.js.

// ---- Probe-tab lifecycle cases (specs from QA lead; Blocked: backend absent; §7.9 never auto-close, §8 launch identity) ----
// Case 2 spec:
//   1. Launch profile (full browser, one user tab). Record pid P, launchId L, last_error E.
//   2. POST /api/profiles/:id/diagnostics/environment {expectedLaunchId: L, consent:'open-visible-diagnostic-tab'}
//      -> probe tab opens.
//   3. Close the USER tab via Target.closeTarget (probe tab is now the only page).
//   4. Assert: profile running === true; last_error === E (unchanged); browser pid === P.
test('PENDING Blocked case 2: open probe tab, close user tab -> still Running, last_error unchanged, same PID', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
// Case 3 spec (continues from case 2):
//   1. Close the PROBE tab via the same Target.closeTarget path (last window close).
//   2. Assert: profile Stopped (running === false, no last_error set);
//      Default/Preferences profile.exit_type === 'Normal'; process and .pm-lock gone.
test('PENDING Blocked case 3: close probe tab via Target.closeTarget -> Stopped, exit_type Normal', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
// Case 6 spec:
//   1. Relaunch the profile; GET /api/profiles/:id/diagnostics.
//   2. Assert: observation.launchId !== previous launchId; observation.id is a new UUID
//      (!== any previous observation id); environment.timezone/locale/languages are all
//      {availability:'unavailable', value:null, source:null, reason:<Reason>} until a new POST.
test('PENDING Blocked case 6: relaunch + GET -> new launchId, new observation id, environment unavailable until new POST', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§7.8: navigating probe tab mid-observation => invalidated probe_navigated; closing it => probe_closed', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('§9/§10: observations work with automation disabled; no extra debugging TCP port during GET/POST', { todo: 'Pinned Chromium 156 integration required on a supported host; no mock substitution' }, () => {});
test('PENDING: M1 lifecycle still green — run test/lifecycle.e2e.js via npm run test:engine (level 2, separate suite)', { todo: 'not run in this packet' }, () => {});

/**
 * M2 merge-gate E4 on the integrated tree.
 * 1. The diagnostics page, with a profile selected, issues zero profile-diagnostics
 *    requests during a real 60 second idle. App-health polling of GET /api/diagnostics
 *    is the pre-existing M1 page and is counted separately. It does not collect a
 *    browser observation.
 * 2. A process restart does not replay a previous observation. A planted cache file
 *    is not served. A dead .pm-lock and a dead running row are removed on startup.
 * 3. Profile-diagnostics routes keep the auth / error / no-store contract.
 *
 * Evidence JSON is written under docs/handoff/alpha2-validation/evidence/.
 * This file does not claim a Windows result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import Database from 'better-sqlite3';
import { spawnServer, stopServer } from './_ports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'docs/handoff/alpha2-validation/evidence');
const CHROME = process.env.PM_E4_CHROME || '/usr/bin/google-chrome-stable';
const UI_TOKEN = 'e4-fixture-ui-token';
const API_TOKEN = 'e4-fixture-api-token';
const FAKE_OBSERVATION = '11111111-1111-4111-8111-111111111111';
const DEAD_PID = 4194303;
const IDLE_MS = 60_000;

function writeEvidence(name, body) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(body, null, 2) + '\n');
}

function profileDiag(pathname) {
  return /^\/api\/profiles\/[^/]+\/diagnostics\/?$/.test(pathname)
    || /^\/api\/profiles\/[^/]+\/diagnostics\/environment\/?$/.test(pathname);
}

async function api(base, method, urlPath, { token = UI_TOKEN, body, tokenInQuery = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  let url = base + urlPath;
  if (token && !tokenInQuery) headers['X-UI-Token'] = token;
  if (tokenInQuery) url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, headers: response.headers, json, text };
}

test('E4 static: profile diagnostics are not polled or written to disk', () => {
  const hook = fs.readFileSync(path.join(root, 'web/src/hooks/useProfileDiagnostics.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server/diagnostics.js'), 'utf8');
  const migrations = fs.readFileSync(path.join(root, 'server/migrations.js'), 'utf8');
  assert.equal(/\bsetInterval\s*\(/.test(hook), false, 'useProfileDiagnostics must not poll');
  assert.equal(/\bsetInterval\s*\(/.test(server), false, 'diagnostics server must not poll');
  assert.equal(/localStorage|sessionStorage/.test(hook), false);
  assert.equal(/CREATE TABLE[^;]*diagnostic/i.test(migrations), false);
  assert.match(hook, /Fetches ONLY when refresh\(\) \/ observeEnvironment\(\) is called/);
  assert.match(server, /const guards = new Map\(\)/);
});

test('E4 restart: no observation cache, stale lock cleanup, auth and error contract', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e4-restart-'));
  const env = {
    ...process.env,
    PM_DATA_DIR: dataDir,
    PM_UI_TOKEN: UI_TOKEN,
    PM_API_TOKEN: API_TOKEN,
    PM_HEALTH_INTERVAL: '60000',
  };
  delete env.PM_SECRET;
  const started = Date.now();
  let first;
  let second;
  const evidence = {
    test: 'restart-auth-stale-marker',
    host: { platform: process.platform, release: os.release(), node: process.version },
    dataDirRedacted: true,
    startedAt: new Date(started).toISOString(),
  };
  try {
    first = await spawnServer(env, { envName: 'PM_E4_PORT', echo: false });
    const created = await api(first.url, 'POST', '/api/profiles', { body: { name: 'e4-restart' } });
    assert.equal(created.status, 201);
    const id = created.json.id;
    assert.match(id, /^[0-9a-f-]{36}$/i);

    const missing = await api(first.url, 'GET', `/api/profiles/${id}/diagnostics`, { token: null });
    assert.equal(missing.status, 401);
    assert.equal(missing.json?.error?.code, 'UNAUTHORIZED');
    assert.match(missing.headers.get('cache-control') || '', /no-store/);
    assert.equal(missing.text.includes(API_TOKEN), false);
    assert.equal(missing.text.includes(UI_TOKEN), false);

    const unknownWithoutToken = await api(first.url, 'GET', '/api/profiles/00000000-0000-4000-8000-000000000099/diagnostics', { token: null });
    assert.equal(unknownWithoutToken.status, 401, 'auth must run before profile lookup');
    assert.equal(unknownWithoutToken.json?.error?.code, 'UNAUTHORIZED');

    const queryToken = await api(first.url, 'GET', `/api/profiles/${id}/diagnostics`, { token: UI_TOKEN, tokenInQuery: true });
    assert.equal(queryToken.status, 401, 'token query parameter must not authenticate');

    const badId = await api(first.url, 'GET', '/api/profiles/not-a-uuid/diagnostics');
    assert.equal(badId.status, 400);
    assert.equal(badId.json?.error?.code, 'INVALID_REQUEST');
    assert.match(badId.headers.get('cache-control') || '', /no-store/);

    const missingProfile = await api(first.url, 'GET', '/api/profiles/00000000-0000-4000-8000-000000000099/diagnostics');
    assert.equal(missingProfile.status, 404);
    assert.equal(missingProfile.json?.error?.code, 'PROFILE_NOT_FOUND');

    const badPost = await api(first.url, 'POST', `/api/profiles/${id}/diagnostics/environment`, { body: {} });
    assert.equal(badPost.status, 400);
    assert.equal(badPost.json?.error?.code, 'INVALID_REQUEST');

    const beforeFiles = fs.readdirSync(dataDir).sort();
    const firstGet = await api(first.url, 'GET', `/api/profiles/${id}/diagnostics`);
    assert.equal(firstGet.status, 200);
    assert.match(firstGet.headers.get('cache-control') || '', /no-store/);
    assert.equal(firstGet.json.observation.state, 'unavailable');
    assert.equal(firstGet.json.observation.reason, 'not_running');
    assert.equal(firstGet.json.observation.launchId, null);
    assert.equal(firstGet.json.observation.validUntil, null);
    assert.equal(firstGet.text.includes(API_TOKEN), false);
    const afterFiles = fs.readdirSync(dataDir).sort();
    assert.deepEqual(afterFiles, beforeFiles, 'GET must not create a diagnostics cache file');
    const observationA = firstGet.json.observation.id;

    const stopped = await stopServer(first);
    assert.equal(stopped, true, 'first server did not shut down cleanly');
    first = null;

    const db = new Database(path.join(dataDir, 'profiles.db'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert.equal(tables.some(name => /diagnos/i.test(name)), false, 'no diagnostics table');
    db.prepare('INSERT INTO running (id, pid, cdp_port, ws_endpoint, relay_url, started_at) VALUES (?,?,?,?,?,?)')
      .run(id, DEAD_PID, null, null, null, '2020-01-01T00:00:00.000Z');
    db.close();
    const lockBody = JSON.stringify({
      ownerPid: DEAD_PID, browserPid: DEAD_PID, startedAt: '2020-01-01T00:00:00.000Z', host: os.hostname(),
    });
    fs.writeFileSync(path.join(dataDir, 'profiles', id, '.pm-lock'), lockBody);
    const orphan = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    fs.mkdirSync(path.join(dataDir, 'profiles', orphan), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'profiles', orphan, '.pm-lock'), lockBody);
    fs.writeFileSync(path.join(dataDir, 'diagnostics-observation-cache.json'), JSON.stringify({
      observation: { id: FAKE_OBSERVATION, state: 'complete' },
      runtime: { chromiumVersion: { availability: 'available', value: 'planted', source: 'browser_protocol' } },
    }));

    second = await spawnServer(env, { envName: 'PM_E4_PORT', echo: false });
    assert.match(second.out, /Recovery: cleared \d+ running record/);
    assert.match(second.out, /stale lock/);
    assert.equal(fs.existsSync(path.join(dataDir, 'profiles', id, '.pm-lock')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'profiles', orphan, '.pm-lock')), false);
    const db2 = new Database(path.join(dataDir, 'profiles.db'), { readonly: true });
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM running').get().n, 0);
    db2.close();

    const secondGet = await api(second.url, 'GET', `/api/profiles/${id}/diagnostics`);
    assert.equal(secondGet.status, 200);
    assert.notEqual(secondGet.json.observation.id, observationA);
    assert.notEqual(secondGet.json.observation.id, FAKE_OBSERVATION);
    assert.equal(secondGet.json.observation.state, 'unavailable');
    assert.equal(secondGet.json.observation.reason, 'not_running');
    assert.equal(secondGet.json.runtime.chromiumVersion.availability, 'unavailable');
    assert.equal(secondGet.json.runtime.chromiumVersion.value, null);
    assert.equal(secondGet.text.includes('planted'), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'diagnostics-observation-cache.json')), true);

    evidence.result = 'pass';
    evidence.firstObservationId = observationA;
    evidence.secondObservationId = secondGet.json.observation.id;
    evidence.fakeObservationIgnored = FAKE_OBSERVATION;
    evidence.recoveryLog = (second.out.match(/Recovery:.*$/m) || [null])[0];
    evidence.auth = { missingToken: 401, unknownIdWithoutToken: 401, queryToken: 401, badId: 400, missingProfile: 404, badPost: 400 };
    evidence.elapsedMs = Date.now() - started;
  } finally {
    if (first) await stopServer(first);
    if (second) await stopServer(second);
    if (!evidence.result) evidence.result = 'fail';
    writeEvidence('e4-restart.json', evidence);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('E4 idle: zero profile-diagnostics requests for 60 seconds without a user action', { timeout: 180_000 }, async () => {
  assert.equal(fs.existsSync(CHROME), true, `Chrome not found at ${CHROME}`);
  const built = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', 'web'], {
    cwd: root, stdio: 'inherit',
  });
  assert.equal(built.status, 0, 'vite build web failed');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e4-idle-'));
  const env = {
    ...process.env,
    PM_DATA_DIR: dataDir,
    PM_UI_TOKEN: UI_TOKEN,
    PM_API_TOKEN: API_TOKEN,
    PM_HEALTH_INTERVAL: '60000',
  };
  delete env.PM_SECRET;
  let server;
  let browser;
  const hits = [];
  const evidence = {
    test: 'idle-60s',
    chrome: CHROME,
    idleMsRequested: IDLE_MS,
    host: { platform: process.platform, release: os.release(), node: process.version },
    note: 'GET /api/diagnostics is app-health polling on the Diagnostics page. It is not a profile observation.',
  };
  try {
    server = await spawnServer(env, { envName: 'PM_E4_PORT', echo: false });
    const created = await api(server.url, 'POST', '/api/profiles', { body: { name: 'e4-idle' } });
    assert.equal(created.status, 201);
    const id = created.json.id;

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(token => {
      window.pm = {
        desktop: true,
        uiToken: token,
        platform: 'linux',
        onEvent: () => () => {},
      };
    }, UI_TOKEN);
    const page = await context.newPage();
    page.on('request', request => {
      let pathname = '';
      try { pathname = new URL(request.url()).pathname; } catch { return; }
      hits.push({ t: Date.now(), method: request.method(), pathname });
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-nav=diagnostics]');
    await page.waitForSelector('[data-testid=profile-diagnostics]');
    await page.waitForSelector(`[data-testid=profile-diagnostics] option[value="${id}"]`);
    await page.selectOption('[data-testid=profile-diagnostics] select', id);
    await page.waitForSelector('[data-testid=profile-diagnostics] [data-empty]');
    const windowStart = Date.now();
    const before = hits.length;
    await page.waitForTimeout(IDLE_MS);
    const elapsed = Date.now() - windowStart;
    assert.ok(elapsed >= IDLE_MS, `idle window was ${elapsed}ms`);
    const during = hits.slice(before);
    const profileHits = hits.filter(hit => profileDiag(hit.pathname));
    const healthDuring = during.filter(hit => hit.pathname === '/api/diagnostics');
    assert.equal(profileHits.length, 0, `profile diagnostics requests: ${JSON.stringify(profileHits)}`);
    assert.ok(healthDuring.length >= 10, `app-health polls during the idle window: ${healthDuring.length}. The page was not alive for the full minute.`);

    const stored = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }));
    const blob = JSON.stringify(stored);
    assert.equal(blob.includes('schemaVersion'), false);
    assert.equal(/"observation"/.test(blob), false);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('[data-nav=diagnostics]');
    await page.waitForSelector(`[data-testid=profile-diagnostics] option[value="${id}"]`);
    await page.selectOption('[data-testid=profile-diagnostics] select', id);
    await page.waitForSelector('[data-testid=profile-diagnostics] [data-empty]');
    await page.waitForTimeout(1500);
    const afterReload = hits.filter(hit => profileDiag(hit.pathname));
    assert.equal(afterReload.length, 0, 'reload or reselection fetched a cached observation');

    evidence.result = 'pass';
    evidence.elapsedMs = elapsed;
    evidence.profileDiagnosticsRequests = 0;
    evidence.appHealthPollsDuringIdle = healthDuring.length;
    evidence.requestsDuringIdle = during.reduce((acc, hit) => {
      const key = hit.method + ' ' + hit.pathname;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  } finally {
    evidence.finishedAt = new Date().toISOString();
    if (!evidence.result) evidence.result = 'fail';
    writeEvidence('e4-idle.json', evidence);
    if (browser) await browser.close().catch(() => {});
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

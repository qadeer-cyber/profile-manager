// Reconstructed takeover regressions; real HTTP, injected observation adapters.
// These are level 1 evidence, never a substitute for real Windows/Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateDiagnosticsV1, validateDiagnosticsErrorBody, assertCacheControlNoStore } from './diagnostics-v1-validator.mjs';
const present = fs.existsSync(new URL('../server/diagnostics.js', import.meta.url));
const skip = !present && 'Backend not on QA-only branch; run assembled integration tree';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2-recovery-'));
process.env.PM_DATA_DIR = tmp;
process.env.PM_API_TOKEN = 'fixture-recovery-api';
let diagnostics, processAdapter, srv, db;
before(async () => {
  if (!present) return;
  diagnostics = await import('../server/diagnostics.js');
  processAdapter = await import('../server/diagnostic-process.js');
  ({ db } = await import('../server/db.js'));
  const { createApp } = await import('../server/app.js');
  srv = await new Promise((resolve, reject) => { const server = createApp({ uiToken: 'fixture-recovery-ui', staticDir: null }).listen(0, '127.0.0.1', () => resolve(server)); server.on('error', reject); });
});
after(async () => { if (srv) await new Promise(r => srv.close(r)); db?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const valid = (body, route = 'GET') => { const r = validateDiagnosticsV1(body, { route }); assert.equal(r.ok, true, r.errors.join('\n')); };
const pipe = { chromiumVersion: '156.0.8078.4', userAgent: 'fixture UA', webrtc: { kind: 'absent' } };
const view = () => ({ phase: 'connected', launchId: 'launch-fixture', proxy: { state: 'off' }, readPipeFacts: async () => pipe });

for (const phase of ['not_running', 'launching', 'stopping', 'disconnected']) {
  test(`F3 independent: ${phase}, manifest retained without partial`, { skip }, async () => {
    const body = await diagnostics.collectDiagnostics(crypto.randomUUID(), { observe: () => ({ phase, launchId: null }) });
    valid(body); assert.equal(body.observation.state, 'unavailable'); assert.equal(body.observation.validUntil, null); assert.equal(body.expected.chromiumVersion.availability, 'available');
  });
}
test('F3 independent: missing live facts and manifest', { skip }, async () => {
  const body = await diagnostics.collectDiagnostics(crypto.randomUUID(), { observe: () => ({ ...view(), proxy: { state: 'suppressed' }, readPipeFacts: async () => null }) });
  valid(body); assert.equal(body.observation.state, 'unavailable'); assert.equal(body.observation.validUntil, null);
});
test('F3 independent: deadline discards late facts without stale guard', { skip }, async () => {
  const id = crypto.randomUUID();
  const body = await diagnostics.collectDiagnostics(id, { deadlineMs: 10, observe: () => ({ ...view(), readPipeFacts: async () => { await new Promise(r => setTimeout(r, 40)); return pipe; } }) });
  valid(body); assert.equal(body.observation.state, 'unavailable'); assert.equal(body.observation.reason, 'timeout');
  await new Promise(r => setTimeout(r, 60));
  const retry = await diagnostics.collectDiagnostics(id, { observe: view }); valid(retry); assert.equal(retry.observation.state, 'complete');
});
test('B1/source: allowlisted OS source, not browser protocol', { skip }, async () => {
  const body = await diagnostics.collectDiagnostics(crypto.randomUUID(), { observe: view }); valid(body);
  assert.equal(body.webrtc.commandLinePolicy.source, 'process_command_line');
  for (const [argv, expected] of [
    [['--force-webrtc-ip-handling-policy=default'], 'present'],
    [['--webrtc-ip-handling-policy=default'], 'absent'],
    [['--', '--force-webrtc-ip-handling-policy=default'], 'absent'],
    [['--force-webrtc-ip-handling-policy', 'default'], 'unverified'],
    [['--force-webrtc-ip-handling-policy=default', '-force-webrtc-ip-handling-policy=default'], 'conflicting'],
  ]) assert.equal(processAdapter.summarizeWebRtcArguments(argv, 'linux').kind, expected);
  assert.equal(processAdapter.summarizeWebRtcArguments(['/FORCE-WEBRTC-IP-HANDLING-POLICY=default'], 'win32').kind, 'present');
});
test('launch mismatch rejects initially; mid-flight replacement has null launchId', { skip }, async () => {
  await assert.rejects(diagnostics.collectDiagnostics(crypto.randomUUID(), { mode: 'environment', expectedLaunchId: 'obsolete', observe: view }), e => e.code === 'LAUNCH_CHANGED');
  let replacement = false;
  const body = await diagnostics.collectDiagnostics(crypto.randomUUID(), { observe: () => ({ ...view(), launchId: replacement ? 'new' : 'old', readPipeFacts: async () => { replacement = true; return pipe; } }) });
  valid(body); assert.equal(body.observation.state, 'invalidated'); assert.equal(body.observation.launchId, null); assert.equal(body.runtime.userAgent.availability, 'unavailable');
});
test('HTTP auth before JSON, trailing slash errors, desktop/API separation', { skip }, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  for (const suffix of ['', '/']) {
    const url = base + '/api/profiles/00000000-0000-4000-8000-000000000001/diagnostics/environment' + suffix;
    for (const [headers, expected, code] of [
      [{}, 401, 'UNAUTHORIZED'],
      [{ authorization: 'Bearer fixture-recovery-api' }, 401, 'UNAUTHORIZED'],
      [{ 'x-ui-token': 'fixture-recovery-ui' }, 400, 'INVALID_REQUEST'],
    ]) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{' });
      assert.equal(r.status, expected); assert.equal(assertCacheControlNoStore(r.headers).ok, true);
      const body = await r.json(); const result = validateDiagnosticsErrorBody(body); assert.equal(result.ok, true, result.errors.join('\n')); assert.equal(body.error.code, code);
    }
  }
});

test('UI/backend integration: actual stopped response and error requestId survive the API client', { skip }, async () => {
  globalThis.window = { pm: { uiToken: 'fixture-recovery-ui' } };
  const { api } = await import('../web/src/api.js');
  const { validateDiagnosticsV1: validateUI } = await import('../web/src/hooks/useProfileDiagnostics.js');
  const actualFetch = globalThis.fetch;
  const base = `http://127.0.0.1:${srv.address().port}`;
  const requests = [];
  globalThis.fetch = (url, opts) => { requests.push(url); return actualFetch(base + url, opts); };
  try {
    const profile = await api('/api/profiles', { method: 'POST', body: { name: 'recovery UI/backend fixture' } });
    const body = await api(`/api/profiles/${profile.id}/diagnostics`);
    valid(body); assert.equal(validateUI(body), body); assert.equal(body.observation.state, 'unavailable');
    await assert.rejects(api('/api/profiles/00000000-0000-4000-8000-000000000099/diagnostics'), e => e.status === 404 && e.code === 'PROFILE_NOT_FOUND' && /^[0-9a-f-]{36}$/.test(e.requestId) && e.message === 'Profile does not exist.');
    assert.equal(requests.includes('/api/api-token'), false);
  } finally { globalThis.fetch = actualFetch; delete globalThis.window; }
});

test('timeout guard waits for evaluation detach acknowledgement and route cleanup', { skip }, async () => {
  let acknowledge, rejectEvaluation, hooks, url = 'about:blank', cleaned = false;
  const detached = new Promise(r => { acknowledge = r; });
  const page = { route: async () => {}, unroute: async () => { cleaned = true; }, bringToFront: async () => {},
    goto: async value => { url = value; }, url: () => url, isClosed: () => false, evaluate: async () => {},
    diagnosticEvaluate: () => {
      hooks.trackSession({ detach: async () => { await detached; rejectEvaluation(new Error('fixture detached')); } });
      return new Promise((_, reject) => { rejectEvaluation = reject; });
    }, close: () => assert.fail('diagnostic tab must remain open'),
  };
  const id = crypto.randomUUID();
  const observe = () => ({ ...view(), openDiagnosticPage: async tracked => { hooks = tracked; return page; } });
  const result = await diagnostics.collectDiagnostics(id, { mode: 'environment', expectedLaunchId: 'launch-fixture', deadlineMs: 20, observe });
  valid(result, 'POST'); assert.equal(result.observation.reason, 'timeout');
  await assert.rejects(diagnostics.collectDiagnostics(id, { observe }), e => e.code === 'DIAGNOSTICS_BUSY');
  assert.equal(cleaned, false);
  acknowledge();
  for (let i = 0; i < 40 && diagnostics.diagnosticsActiveCount(); i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(cleaned, true); assert.equal(diagnostics.diagnosticsActiveCount(), 0);
  valid(await diagnostics.collectDiagnostics(id, { observe: view }));
});

test('headless cannot open a probe; navigation back to owned URL does not rescue invalid facts', { skip }, async () => {
  let opened = 0;
  const headless = await diagnostics.collectDiagnostics(crypto.randomUUID(), { mode: 'environment', expectedLaunchId: 'launch-fixture', observe: () => ({ ...view(), headless: true, openDiagnosticPage: () => { opened++; assert.fail('hidden probe'); } }) });
  valid(headless, 'POST'); assert.equal(opened, 0); assert.equal(headless.observation.state, 'unavailable');
  let url, navigation, removed = false;
  const page = { route: async () => {}, unroute: async () => { removed = true; }, bringToFront: async () => {}, goto: async value => { url = value; },
    url: () => url, isClosed: () => false, on: (_event, fn) => { navigation = fn; }, off: (_event, fn) => { assert.equal(fn, navigation); navigation = null; },
    evaluate: async () => { navigation({}); return { visible: true, timezone: 'UTC', locale: 'en-US', languages: ['en-US'] }; },
    close: () => assert.fail('automatic close'),
  };
  const result = await diagnostics.collectDiagnostics(crypto.randomUUID(), { mode: 'environment', expectedLaunchId: 'launch-fixture', observe: () => ({ ...view(), openDiagnosticPage: async () => page }) });
  valid(result, 'POST'); assert.equal(result.observation.reason, 'probe_navigated'); assert.equal(result.environment.timezone.availability, 'unavailable'); assert.equal(navigation, null); assert.equal(removed, true);
});

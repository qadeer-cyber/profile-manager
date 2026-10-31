// DiagnosticsV1 unit coverage. No browser install and no lifecycle mutation.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';

const SENTINEL = 'sentinel9f3a7c2e';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-diag-'));
process.env.PM_DATA_DIR = path.join(tmp, 'data');
process.env.PM_API_TOKEN = `${SENTINEL}-token`;
delete process.env.PM_SECRET;
delete process.env.PM_UI_TOKEN;

const diagnostics = await import('../server/diagnostics.js');
const browsers = await import('../server/browsers.js');
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { MANIFEST } = await import('../server/chromium.js');

const VERSION = MANIFEST.browserVersion;
const CONSENT = 'open-visible-diagnostic-tab';
const PROFILE = '11111111-1111-4111-8111-111111111111';

function tokenOk(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

async function call(server, method, urlPath, { headers = {}, body, raw } = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, cache: res.headers.get('cache-control'), json, text };
}

function clock() {
  let t = Date.parse('2026-10-19T12:00:00.000Z');
  return () => {
    const v = t;
    t += 5;
    return v;
  };
}

function avail(value, source) {
  return { availability: 'available', value, source };
}
function miss(reason) {
  return { availability: 'unavailable', value: null, source: null, reason };
}

function assertFact(fact, availability) {
  if (availability === 'available') {
    assert.deepEqual(Object.keys(fact).sort(), ['availability', 'source', 'value']);
    assert.equal(fact.availability, 'available');
    assert.equal(fact.reason, undefined);
  } else {
    assert.deepEqual(Object.keys(fact).sort(), ['availability', 'reason', 'source', 'value']);
    assert.equal(fact.availability, 'unavailable');
    assert.equal(fact.value, null);
    assert.equal(fact.source, null);
  }
}

function assertSchema(body) {
  assert.deepEqual(Object.keys(body).sort(), [
    'consistency', 'environment', 'expected', 'observation', 'profileId', 'proxy', 'runtime', 'schemaVersion', 'webrtc',
  ]);
  assert.equal(body.schemaVersion, 1);
  assert.deepEqual(Object.keys(body.observation).sort(), [
    'completedAt', 'durationMs', 'id', 'launchId', 'reason', 'requestedAt', 'state', 'validUntil',
  ]);
  assert.match(body.observation.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.match(body.observation.requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(body.observation.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(Number.isFinite(body.observation.durationMs) && body.observation.durationMs >= 0, true);
  assert.deepEqual(Object.keys(body.runtime).sort(), ['chromiumVersion', 'userAgent']);
  assert.deepEqual(Object.keys(body.expected).sort(), ['chromiumVersion']);
  assert.deepEqual(Object.keys(body.environment).sort(), ['languages', 'locale', 'timezone']);
  assert.deepEqual(Object.keys(body.webrtc).sort(), ['commandLinePolicy', 'effectivePolicy', 'iceCollection']);
  assert.equal(body.webrtc.iceCollection, 'not_collected');
  assert.deepEqual(body.webrtc.effectivePolicy, miss('unsupported'));
  assert.deepEqual(Object.keys(body.consistency).sort(), ['chromiumVersion']);
  const until = body.observation.state === 'partial' || body.observation.state === 'complete';
  if (until) assert.equal(Date.parse(body.observation.validUntil) - Date.parse(body.observation.completedAt), 30000);
  else assert.equal(body.observation.validUntil, null);
}

function assertNoSentinel(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(text.includes(SENTINEL), false);
}

function pipeOk(over = {}) {
  return {
    chromiumVersion: VERSION,
    userAgent: 'Mozilla/5.0 (diagnostic-test)',
    webrtc: { kind: 'absent' },
    ...over,
  };
}

function connected(over = {}) {
  return () => ({
    phase: 'connected',
    launchId: 'launch-1',
    proxy: { state: 'off' },
    readPipeFacts: async () => pipeOk(),
    openDiagnosticPage: () => { throw new Error('diagnostic tab opened'); },
    ...over,
  });
}

async function collect(mode, observe, extra = {}) {
  const id = crypto.randomUUID();
  const body = await diagnostics.collectDiagnostics(id, { mode, observe, now: clock(), ...extra });
  assert.equal(body.profileId, id);
  assertSchema(body);
  assertNoSentinel(body);
  return body;
}

function fakePage({ env, urlAfter, closed = false, evaluateGate } = {}) {
  const dataUrl = diagnostics.diagnosticDataUrl();
  const calls = [];
  const page = {
    calls,
    routeStats: { continued: 0, aborted: 0 },
    _closed: false,
    route: async (_pattern, handler) => {
      calls.push('route');
      const once = (url) => handler({
        request: () => ({ url: () => url }),
        continue: () => { page.routeStats.continued += 1; },
        abort: () => { page.routeStats.aborted += 1; },
      });
      await once(dataUrl);
      await once('https://example.test/' + SENTINEL);
      await once('about:blank');
      await once('http://example.test/other');
    },
    bringToFront: async () => { calls.push('front'); },
    setDefaultTimeout: () => { calls.push('timeout'); },
    goto: async (url) => {
      calls.push('goto:' + url);
      page._url = urlAfter === undefined ? url : urlAfter;
      if (closed === 'after-goto') page._closed = true;
    },
    url: () => page._url || 'about:blank',
    isClosed: () => page._closed,
    evaluate: async (fn) => {
      calls.push('evaluate');
      assert.equal(fn, diagnostics.readDiagnosticEnvironment);
      if (closed === 'after-evaluate') page._closed = true;
      if (evaluateGate) return evaluateGate;
      return env ? { visible: true, ...env } : env;
    },
    close: () => { calls.push('close'); },
  };
  return page;
}

function envView(page, extra = {}) {
  let opened = 0;
  return {
    opened: () => opened,
    observe: () => ({
      phase: 'connected',
      launchId: 'launch-1',
      proxy: { state: 'off' },
      readPipeFacts: async () => pipeOk(),
      openDiagnosticPage: () => { opened += 1; return page; },
      ...extra,
    }),
  };
}

function assertError(res, status, code, message) {
  assert.equal(res.status, status);
  assert.equal(res.cache, 'no-store');
  assert.deepEqual(Object.keys(res.json).sort(), ['error']);
  assert.deepEqual(Object.keys(res.json.error).sort(), ['code', 'message', 'requestId']);
  assert.equal(res.json.error.code, code);
  if (message) assert.equal(res.json.error.message, message);
  assert.match(res.json.error.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assertNoSentinel(res.text);
}

async function withApp(deps, fn) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.body ??= {}; next(); });
  diagnostics.mountProfileDiagnostics(app, {
    uiToken: 'ui-tok',
    apiToken: process.env.PM_API_TOKEN,
    tokenOk,
    loadProfile: () => ({ id: PROFILE }),
    ...deps,
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, next) => {
    if (diagnostics.isProfileDiagnosticsRequest(req)) {
      const mapped = diagnostics.diagnosticsHttpError(err.type === 'entity.parse.failed' || err.status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR');
      res.set('Cache-Control', 'no-store');
      return res.status(mapped.status).json(mapped.body);
    }
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'invalid JSON body' : err.message });
  });
  const server = await listen(app);
  try { await fn(server); } finally { await close(server); }
}

describe('profile diagnostics', { concurrency: false }, () => {
  let desktop;
  let automation;

  before(async () => {
    desktop = await listen(createApp({ uiToken: 'ui-tok', staticDir: null }));
    automation = await listen(createApp({ uiToken: null, staticDir: null }));
  });
  after(async () => {
    if (desktop) await close(desktop);
    if (automation) await close(automation);
    if (db.open) db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('constants match the collection deadline and freshness ceiling', () => {
    assert.equal(diagnostics.COLLECTION_DEADLINE_MS, 3000);
    assert.equal(diagnostics.FRESHNESS_MS, 30000);
  });

  test('decideObservationState: each state for GET and POST', () => {
    const readFacts = (over = {}) => ({
      runtime: { chromiumVersion: avail(VERSION, 'browser_protocol'), userAgent: avail('ua', 'browser_protocol') },
      expected: avail(VERSION, 'manifest'),
      proxy: avail({ configured: false }, 'launch_snapshot'),
      webrtc: avail({ state: 'absent', value: null }, 'browser_protocol'),
      environment: {
        timezone: miss('permission_required'),
        locale: miss('permission_required'),
        languages: miss('permission_required'),
      },
      ...over,
    });
    assert.deepEqual(diagnostics.decideObservationState('read', readFacts()), { state: 'complete', reason: null });
    assert.deepEqual(
      diagnostics.decideObservationState('read', readFacts({ webrtc: miss('unsupported') })),
      { state: 'partial', reason: 'unsupported' },
    );
    assert.deepEqual(diagnostics.decideObservationState('read', {
      runtime: { chromiumVersion: miss('not_running'), userAgent: miss('not_running') },
      expected: miss('collection_failed'),
      proxy: miss('not_running'),
      webrtc: miss('not_running'),
      environment: readFacts().environment,
    }), { state: 'unavailable', reason: 'not_running' });
    assert.deepEqual(diagnostics.decideObservationState('read', readFacts(), true), { state: 'invalidated', reason: 'launch_changed' });

    const posted = readFacts({
      runtime: { chromiumVersion: miss('collection_failed'), userAgent: miss('collection_failed') },
      webrtc: miss('collection_failed'),
      environment: {
        timezone: avail('America/New_York', 'visible_probe'),
        locale: avail('en-US', 'visible_probe'),
        languages: avail(['en-US'], 'visible_probe'),
      },
    });
    assert.deepEqual(diagnostics.decideObservationState('environment', posted), { state: 'complete', reason: null });
    assert.deepEqual(diagnostics.decideObservationState('environment', readFacts({
      environment: {
        timezone: avail('America/New_York', 'visible_probe'),
        locale: miss('collection_failed'),
        languages: avail(['en-US'], 'visible_probe'),
      },
    })), { state: 'partial', reason: 'collection_failed' });
    assert.deepEqual(diagnostics.decideObservationState('environment', readFacts({
      environment: {
        timezone: miss('probe_navigated'),
        locale: miss('probe_navigated'),
        languages: miss('probe_navigated'),
      },
    })), { state: 'unavailable', reason: 'probe_navigated' });
    assert.deepEqual(diagnostics.decideObservationState('environment', posted, true), { state: 'invalidated', reason: 'launch_changed' });
  });

  test('GET observation state complete', async () => {
    let opened = 0;
    const body = await collect('read', () => ({
      phase: 'connected',
      launchId: 'launch-1',
      proxy: { state: 'on', value: { configured: true, type: 'socks5', host: 'proxy.example', port: 1080, username: `${SENTINEL}-user`, password: `${SENTINEL}-pass` } },
      relayUrl: `http://${SENTINEL}@127.0.0.1:9`,
      readPipeFacts: async () => pipeOk({ webrtc: { kind: 'conflicting' } }),
      openDiagnosticPage: () => { opened += 1; },
    }));
    assert.equal(opened, 0);
    assert.equal(body.observation.state, 'complete');
    assert.equal(body.observation.reason, null);
    assert.equal(body.observation.launchId, 'launch-1');
    assert.equal(body.observation.durationMs, 5);
    assert.deepEqual(body.runtime.chromiumVersion, avail(VERSION, 'browser_protocol'));
    assert.deepEqual(body.runtime.userAgent, avail('Mozilla/5.0 (diagnostic-test)', 'browser_protocol'));
    assert.deepEqual(body.expected.chromiumVersion, avail(VERSION, 'manifest'));
    assert.equal(body.consistency.chromiumVersion, 'match');
    assert.deepEqual(body.proxy, avail({ configured: true, type: 'socks5', host: 'proxy.example', port: 1080 }, 'launch_snapshot'));
    assert.deepEqual(body.webrtc.commandLinePolicy, avail({ state: 'conflicting', value: null }, 'process_command_line'));
    for (const fact of [body.environment.timezone, body.environment.locale, body.environment.languages]) {
      assert.deepEqual(fact, miss('permission_required'));
    }
    assertNoSentinel(body);
  });

  test('GET complete accepts absent and present WebRTC observations and a configured-false proxy', async () => {
    for (const webrtc of [{ kind: 'absent' }, { kind: 'present', value: 'disable_non_proxied_udp' }]) {
      const body = await collect('read', connected({
        proxy: { state: 'off' },
        readPipeFacts: async () => pipeOk({ webrtc, chromiumVersion: '1.2.3.4' }),
      }));
      assert.equal(body.observation.state, 'complete');
      assert.equal(body.observation.reason, null);
      assert.equal(body.consistency.chromiumVersion, 'mismatch');
      if (webrtc.kind === 'absent') assert.deepEqual(body.webrtc.commandLinePolicy.value, { state: 'absent', value: null });
      else assert.deepEqual(body.webrtc.commandLinePolicy.value, { state: 'present', value: 'disable_non_proxied_udp' });
    }
  });

  test('GET observation state partial', async () => {
    const failed = await collect('read', connected({
      readPipeFacts: async () => pipeOk({ chromiumVersion: null, userAgent: 'Mozilla/5.0 (diagnostic-test)' }),
    }));
    assert.equal(failed.observation.state, 'partial');
    assert.equal(failed.observation.reason, 'collection_failed');
    assert.deepEqual(failed.runtime.chromiumVersion, miss('collection_failed'));
    assert.equal(failed.runtime.userAgent.availability, 'available');
    assert.notEqual(failed.observation.state, 'complete');

    const unverified = await collect('read', connected({
      readPipeFacts: async () => pipeOk({ webrtc: { kind: 'unverified', value: `${SENTINEL}-policy` } }),
    }));
    assert.equal(unverified.observation.state, 'partial');
    assert.equal(unverified.observation.reason, 'collection_failed');
    assert.deepEqual(unverified.webrtc.commandLinePolicy, miss('collection_failed'));
    assertNoSentinel(unverified);

    const suppressed = await collect('read', connected({ proxy: { state: 'suppressed' } }));
    assert.equal(suppressed.observation.state, 'partial');
    assert.equal(suppressed.observation.reason, 'unsupported');
    assert.deepEqual(suppressed.proxy, miss('unsupported'));

    const stopped = await collect('read', () => ({ phase: 'not_running', launchId: null, proxy: { state: 'off' } }));
    assert.equal(stopped.observation.state, 'unavailable');
    assert.equal(stopped.observation.reason, 'not_running');
    assert.deepEqual(stopped.expected.chromiumVersion, avail(VERSION, 'manifest'));
    assert.deepEqual(stopped.runtime.chromiumVersion, miss('not_running'));
    assert.deepEqual(stopped.proxy, miss('not_running'));
    assert.deepEqual(stopped.environment.timezone, miss('permission_required'));
  });

  for (const phase of ['not_running', 'launching', 'stopping', 'disconnected']) {
    test(`F3: ${phase} plus manifest is unavailable`, async () => {
      const body = await collect('read', () => ({ phase, launchId: null }));
      assert.equal(body.observation.state, 'unavailable');
      assert.equal(body.observation.validUntil, null);
      assert.equal(body.expected.chromiumVersion.value, VERSION);
    });
  }
  test('F3: failed live required facts plus manifest are unavailable', async () => {
    const body = await collect('read', connected({ proxy: { state: 'suppressed' }, readPipeFacts: async () => null }));
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.validUntil, null);
    assert.equal(body.expected.chromiumVersion.value, VERSION);
  });
  test('F3: deadline without a live fact is unavailable', async () => {
    const body = await collect('read', connected({ readPipeFacts: async () => { await new Promise(r => setTimeout(r, 30)); return pipeOk(); } }), { deadlineMs: 5 });
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.validUntil, null);
    assert.equal(body.expected.chromiumVersion.value, VERSION);
    await new Promise(r => setTimeout(r, 40));
  });

  test('GET observation state unavailable', async () => {
    const body = await collect('read', () => ({ phase: 'not_running', launchId: null, proxy: { state: 'off' } }), { expectedVersion: null });
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.reason, 'not_running');
    for (const fact of [body.runtime.chromiumVersion, body.runtime.userAgent, body.expected.chromiumVersion, body.proxy, body.webrtc.commandLinePolicy]) {
      assert.equal(fact.availability, 'unavailable');
    }
    assert.equal(body.consistency.chromiumVersion, 'unknown');
  });

  test('GET observation state invalidated', async () => {
    let launchId = 'launch-a';
    const body = await collect('read', () => ({
      phase: 'connected',
      get launchId() { return launchId; },
      proxy: { state: 'off' },
      readPipeFacts: async () => {
        launchId = 'launch-b';
        return pipeOk({ userAgent: `${SENTINEL}-ua` });
      },
      openDiagnosticPage: () => { throw new Error('diagnostic tab opened'); },
    }));
    assert.equal(body.observation.state, 'invalidated');
    assert.equal(body.observation.reason, 'launch_changed');
    assert.equal(body.observation.launchId, null);
    assert.equal(body.runtime.userAgent.reason, 'launch_changed');
    assert.equal(body.expected.chromiumVersion.availability, 'available');
    assertNoSentinel(body);
  });

  test('GET timeout is unavailable with manifest-only metadata and drops late facts', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let detached = false;
    const id = crypto.randomUUID();
    const pending = diagnostics.collectDiagnostics(id, {
      mode: 'read',
      deadlineMs: 40,
      now: clock(),
      observe: () => ({
        phase: 'connected',
        launchId: 'launch-1',
        proxy: { state: 'off' },
        readPipeFacts: (hooks) => {
          hooks.trackSession({ detach: () => { detached = true; } });
          return gate.then(() => pipeOk({ userAgent: `${SENTINEL}-late` }));
        },
      }),
    });
    const body = await pending;
    assertSchema(body);
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.reason, 'timeout');
    assert.equal(detached, true);
    assert.deepEqual(body.runtime.userAgent, miss('timeout'));
    assert.equal(body.expected.chromiumVersion.availability, 'available');
    assertNoSentinel(body);
    assert.equal(diagnostics.diagnosticsActiveCount(), 1);
    await assert.rejects(
      () => diagnostics.collectDiagnostics(id, { observe: () => ({ phase: 'not_running' }) }),
      error => error.code === 'DIAGNOSTICS_BUSY',
    );
    release();
    for (let i = 0; i < 20 && diagnostics.diagnosticsActiveCount() !== 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(diagnostics.diagnosticsActiveCount(), 0);
    const again = await collect('read', connected());
    assert.equal(again.observation.state, 'complete');
  });

  test('POST observation state complete', async () => {
    const page = fakePage({ env: { timezone: 'America/New_York', locale: 'en-US', languages: ['en-US', 'en'] } });
    const view = envView(page, { readPipeFacts: async () => { throw new Error(`${SENTINEL} pipe`); } });
    const body = await collect('environment', view.observe, { expectedLaunchId: 'launch-1' });
    assert.equal(view.opened(), 1);
    assert.equal(body.observation.state, 'complete');
    assert.equal(body.observation.reason, null);
    assert.deepEqual(body.environment.timezone, avail('America/New_York', 'visible_probe'));
    assert.deepEqual(body.environment.locale, avail('en-US', 'visible_probe'));
    assert.deepEqual(body.environment.languages, avail(['en-US', 'en'], 'visible_probe'));
    assert.deepEqual(body.runtime.chromiumVersion, miss('collection_failed'));
    assert.equal(page.calls.includes('close'), false);
    assert.deepEqual(page.calls.filter(call => call === 'front').length, 2);
    assert.ok(page.calls.indexOf('front') < page.calls.indexOf('goto:' + diagnostics.diagnosticDataUrl()));
    assert.ok(page.calls.lastIndexOf('front') < page.calls.indexOf('evaluate'));
    assert.equal(page.routeStats.aborted, 2);
    assert.equal(page.routeStats.continued, 2);
    assertNoSentinel(body);
  });

  test('POST observation state partial', async () => {
    const page = fakePage({ env: { timezone: 'America/New_York', locale: 'not a locale', languages: ['en-US'] } });
    const view = envView(page);
    const body = await collect('environment', view.observe, { expectedLaunchId: 'launch-1' });
    assert.equal(body.observation.state, 'partial');
    assert.equal(body.observation.reason, 'collection_failed');
    assert.equal(body.environment.timezone.availability, 'available');
    assert.deepEqual(body.environment.locale, miss('collection_failed'));
    assert.equal(body.environment.languages.availability, 'available');
    assert.notEqual(body.observation.state, 'complete');
    assert.equal(page.calls.includes('close'), false);
  });

  test('POST observation state unavailable', async () => {
    const navigated = fakePage({ urlAfter: `https://evil.example/${SENTINEL}`, env: { timezone: `${SENTINEL}-tz` } });
    const navView = envView(navigated);
    const navBody = await collect('environment', navView.observe, { expectedLaunchId: 'launch-1' });
    assert.equal(navBody.observation.state, 'unavailable');
    assert.equal(navBody.observation.reason, 'probe_navigated');
    assert.deepEqual(navBody.environment.timezone, miss('probe_navigated'));
    assert.equal(navigated.calls.includes('evaluate'), false);
    assert.equal(navigated.calls.includes('close'), false);
    assertNoSentinel(navBody);

    const closed = fakePage({ closed: 'after-goto', env: { timezone: `${SENTINEL}-tz` } });
    const closedBody = await collect('environment', envView(closed).observe, { expectedLaunchId: 'launch-1' });
    assert.equal(closedBody.observation.state, 'unavailable');
    assert.equal(closedBody.observation.reason, 'probe_closed');
    assert.equal(closed.calls.includes('close'), false);
  });

  test('POST does not open a tab unless the browser is connected, and timeout stays unavailable', async () => {
    let opened = 0;
    const idle = await collect('environment', () => ({
      phase: 'not_running',
      launchId: 'launch-1',
      proxy: { state: 'off' },
      openDiagnosticPage: () => { opened += 1; },
    }), { expectedLaunchId: 'launch-1' });
    assert.equal(opened, 0);
    assert.equal(idle.observation.state, 'unavailable');
    assert.equal(idle.observation.reason, 'not_running');

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const page = fakePage({ evaluateGate: gate.then(() => ({ timezone: `${SENTINEL}-tz`, locale: 'en-US', languages: ['en-US'] })) });
    const id = crypto.randomUUID();
    const body = await diagnostics.collectDiagnostics(id, {
      mode: 'environment',
      expectedLaunchId: 'launch-1',
      deadlineMs: 40,
      now: clock(),
      observe: envView(page, {
        readPipeFacts: async () => pipeOk({ userAgent: `${SENTINEL}-ua` }),
      }).observe,
    });
    assertSchema(body);
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.reason, 'timeout');
    assert.equal(body.observation.validUntil, null);
    assert.deepEqual(body.environment.locale, miss('timeout'));
    assertNoSentinel(body);
    release();
    for (let i = 0; i < 20 && diagnostics.diagnosticsActiveCount() !== 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(diagnostics.diagnosticsActiveCount(), 0);
    assert.equal(page.calls.includes('close'), false);
  });

  test('POST observation state invalidated', async () => {
    let launchId = 'launch-1';
    const page = fakePage({ env: { timezone: `${SENTINEL}-tz`, locale: 'en-US', languages: ['en-US'] } });
    const realEvaluate = page.evaluate;
    page.evaluate = async (fn) => {
      launchId = 'launch-2';
      return realEvaluate(fn);
    };
    const body = await collect('environment', () => ({
      phase: 'connected',
      get launchId() { return launchId; },
      proxy: { state: 'off' },
      readPipeFacts: async () => pipeOk(),
      openDiagnosticPage: () => page,
    }), { expectedLaunchId: 'launch-1' });
    assert.equal(body.observation.state, 'invalidated');
    assert.equal(body.observation.reason, 'launch_changed');
    assert.equal(body.observation.launchId, null);
    assert.equal(body.environment.timezone.reason, 'launch_changed');
    assertNoSentinel(body);
    assert.equal(page.calls.includes('close'), false);
  });

  test('headless consent never creates a diagnostic tab', async () => {
    const body = await collect('environment', connected({ headless: true, openDiagnosticPage: () => { throw new Error('must not open'); } }), { expectedLaunchId: 'launch-1' });
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.reason, 'unsupported');
    assert.equal(body.observation.validUntil, null);
  });

  test('a non-visible probe provides no environment facts', async () => {
    const page = fakePage({ env: { visible: false, timezone: 'UTC', locale: 'en-US', languages: ['en-US'] } });
    const body = await collect('environment', envView(page).observe, { expectedLaunchId: 'launch-1' });
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.runtime.userAgent.availability, 'unavailable');
    assert.equal(body.environment.timezone.availability, 'unavailable');
  });

  test('timed-out evaluation detaches before guard release, cleans routes and permits retry', async () => {
    const id = crypto.randomUUID();
    let rejectEvaluation, tracked, detached = false, cleaned = false;
    const page = fakePage({});
    page.unroute = async () => { cleaned = true; };
    page.diagnosticEvaluate = () => {
      tracked.trackSession({ detach: async () => { detached = true; rejectEvaluation(new Error('detached')); } });
      return new Promise((_, reject) => { rejectEvaluation = reject; });
    };
    const view = { ...connected()(), openDiagnosticPage: async hooks => { tracked = hooks; return page; } };
    const body = await diagnostics.collectDiagnostics(id, { mode: 'environment', expectedLaunchId: 'launch-1', deadlineMs: 20, observe: () => view });
    assert.equal(body.observation.state, 'unavailable');
    assert.equal(body.observation.reason, 'timeout');
    for (let i = 0; i < 20 && diagnostics.diagnosticsActiveCount(); i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(detached, true);
    assert.equal(cleaned, true);
    assert.equal(diagnostics.diagnosticsActiveCount(), 0);
    const retry = await diagnostics.collectDiagnostics(id, { observe: connected() });
    assert.equal(retry.observation.state, 'complete');
  });

  test('navigation away and back during evaluation rejects facts and removes listeners', async () => {
    const page = fakePage({ env: { timezone: 'UTC', locale: 'en-US', languages: ['en-US'] } });
    let listener, cleaned = false;
    page.on = (_event, fn) => { listener = fn; };
    page.off = (_event, fn) => { assert.equal(fn, listener); listener = null; };
    page.unroute = async () => { cleaned = true; };
    page.evaluate = async () => { listener({}); return { visible: true, timezone: 'UTC', locale: 'en-US', languages: ['en-US'] }; };
    const body = await collect('environment', envView(page).observe, { expectedLaunchId: 'launch-1' });
    assert.equal(body.observation.reason, 'probe_navigated');
    assert.equal(body.environment.timezone.availability, 'unavailable');
    assert.equal(listener, null);
    assert.equal(cleaned, true);
  });

  test('initial launch mismatch is 409 and does not hold the guard or open a tab', async () => {
    let opened = 0;
    const id = crypto.randomUUID();
    await assert.rejects(
      () => diagnostics.collectDiagnostics(id, {
        mode: 'environment',
        expectedLaunchId: 'launch-1 ',
        observe: () => ({
          phase: 'connected',
          launchId: 'launch-1',
          openDiagnosticPage: () => { opened += 1; },
        }),
      }),
      error => error.code === 'LAUNCH_CHANGED',
    );
    assert.equal(opened, 0);
    assert.equal(diagnostics.diagnosticsActiveCount(), 0);
  });

  test('repeated observations get distinct ids', async () => {
    const first = await collect('read', connected());
    const second = await collect('read', connected());
    assert.notEqual(first.observation.id, second.observation.id);
    assert.equal(first.observation.state, 'complete');
    assert.equal(second.observation.state, 'complete');
  });

  test('WebRTC argument summary stays inside the allowlist', () => {
    const { summarizeWebRtcArguments } = browsers;
    assert.deepEqual(summarizeWebRtcArguments(['--no-sandbox']), { kind: 'absent' });
    assert.deepEqual(summarizeWebRtcArguments(['--force-webrtc-ip-handling-policy=default']), { kind: 'present', value: 'default' });
    assert.deepEqual(summarizeWebRtcArguments(['--force-webrtc-ip-handling-policy=default_public_interface_only']), { kind: 'present', value: 'default_public_interface_only' });
    assert.deepEqual(summarizeWebRtcArguments([
      '--force-webrtc-ip-handling-policy=default',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ]), { kind: 'conflicting' });
    assert.deepEqual(summarizeWebRtcArguments(['--force-webrtc-ip-handling-policy=surprise']), { kind: 'unverified' });
    assert.deepEqual(summarizeWebRtcArguments(['--force-webrtc-ip-handling-policy', `${SENTINEL}-raw`]), { kind: 'unverified' });
    assert.deepEqual(summarizeWebRtcArguments('not-an-array'), { kind: 'unreadable' });
    assert.deepEqual(summarizeWebRtcArguments(['ok', 1]), { kind: 'unreadable' });
    const summary = summarizeWebRtcArguments(['--webrtc-ip-handling-policy=default', `${SENTINEL}-argv`]);
    assert.equal(JSON.stringify(summary).includes(SENTINEL), false);
  });

  test('pipe read returns only version, UA, and an allowlisted WebRTC summary', async () => {
    const sent = [];
    let detached = false;
    const facts = await browsers.readPipeBrowserFacts({
      newBrowserCDPSession: async () => ({
        send: async (method) => {
          sent.push(method);
          if (method === 'Browser.getVersion') {
            return { product: `Chrome/${VERSION}`, userAgent: 'Mozilla/5.0 (pipe)', extra: SENTINEL, userAgentMetadata: { model: SENTINEL } };
          }
          return { arguments: ['--webrtc-ip-handling-policy=default_public_and_private_interfaces', `${SENTINEL}-arg`], spawnargs: [SENTINEL] };
        },
        detach: async () => { detached = true; },
      }),
    });
    assert.deepEqual(sent, ['Browser.getVersion']);
    assert.equal(facts.chromiumVersion, VERSION);
    assert.equal(facts.userAgent, 'Mozilla/5.0 (pipe)');
    assert.deepEqual(facts.webrtc, { kind: 'unreadable' });
    assert.equal(detached, true);
    assertNoSentinel(facts);
    const odd = await browsers.readPipeBrowserFacts({
      newBrowserCDPSession: async () => ({
        send: async (method) => method === 'Browser.getVersion'
          ? { product: 'Firefox/1.0', userAgent: 'bad\nagent' }
          : { arguments: ['--no-sandbox'] },
        detach: async () => {},
      }),
    });
    assert.equal(odd.chromiumVersion, null);
    assert.equal(odd.userAgent, null);
    assert.deepEqual(odd.webrtc, { kind: 'unreadable' });
  });

  test('proxy snapshot drops credentials and local relay endpoints', () => {
    assert.deepEqual(browsers.proxyLaunchSnapshot(null), { configured: false });
    assert.deepEqual(browsers.proxyLaunchSnapshot({ type: 'http' }), { configured: false });
    const snap = browsers.proxyLaunchSnapshot({
      type: 'https', host: 'proxy.example', port: '443', username: `${SENTINEL}-user`, password: `${SENTINEL}-pass`, url: `http://${SENTINEL}@proxy.example`,
    });
    assert.deepEqual(snap, { configured: true, type: 'https', host: 'proxy.example', port: 443 });
    assert.deepEqual(Object.keys(snap).sort(), ['configured', 'host', 'port', 'type']);
    assert.equal(browsers.proxyLaunchSnapshot({ type: 'http', host: '127.0.0.1', port: 1 }).unsafe, true);
    assert.equal(browsers.proxyLaunchSnapshot({ type: 'http', host: 'localhost', port: 1 }).unsafe, true);
    assert.equal(browsers.proxyLaunchSnapshot({ type: 'socks', host: 'proxy.example', port: 1 }).unsafe, true);
    assertNoSentinel(snap);
  });

  test('diagnostic entry view does not copy the relay, command line, or page list', async () => {
    let pagesCalled = 0;
    let newPageCalled = 0;
    const entry = {
      diagnosticHeadless: false,
      ctx: {
        browser: () => ({ isConnected: () => true }),
        newPage: () => { newPageCalled += 1; return { marker: 'page' }; },
        pages: () => { pagesCalled += 1; return [{ url: () => SENTINEL }]; },
      },
      launchId: 'launch-1',
      launchSnapshot: { configured: true, type: 'http', host: 'proxy.example', port: 8080, password: SENTINEL },
      relayUrl: `http://${SENTINEL}:secret@127.0.0.1:9`,
      argv: [`--user-data-dir=${SENTINEL}`],
    };
    const view = browsers.inspectDiagnosticEntry(entry);
    assert.equal(view.phase, 'connected');
    assert.equal(view.launchId, 'launch-1');
    assert.deepEqual(view.proxy, { state: 'on', value: { configured: true, type: 'http', host: 'proxy.example', port: 8080 } });
    assert.equal(pagesCalled, 0);
    assert.equal((await view.openDiagnosticPage({})).marker, 'page');
    assert.equal(newPageCalled, 1);
    assert.equal(pagesCalled, 0);
    assertNoSentinel(view.proxy);
    assert.equal(JSON.stringify(view.proxy).includes('127.0.0.1'), false);
    assert.equal(browsers.inspectDiagnosticEntry({ ...entry, stopping: true }).phase, 'stopping');
    assert.equal(browsers.inspectDiagnosticEntry({ ...entry, stopping: true }).openDiagnosticPage, undefined);
    assert.equal(browsers.inspectDiagnosticEntry({ ctx: { browser: () => ({ isConnected: () => false }) }, launchId: 'x' }).phase, 'disconnected');
    assert.equal(browsers.inspectDiagnosticEntry({ launchId: 'x'.repeat(129), ctx: entry.ctx }).launchId, null);
    assert.equal(browsers.inspectDiagnosticEntry({ launchId: 'has space', ctx: entry.ctx }).launchId, null);
    assert.equal(browsers.diagnosticObservation(crypto.randomUUID()).phase, 'not_running');
  });

  test('launch snapshot fields do not change termination classification', () => {
    const base = { exitCode: null, exitSignal: null, exitType: null, exitTypeState: 'missing', exitTypeFresh: false };
    const extras = { launchSnapshot: { configured: false }, relayUrl: 'http://127.0.0.1:9' };
    const samples = [
      { ...base, exitCode: 0 },
      { ...base, stillAlive: true, exitCode: 0 },
      { ...base, stopping: true, exitCode: 1 },
      { ...base, exitSignal: 'SIGKILL', exitType: 'Normal', exitTypeState: 'ok' },
    ];
    for (const entry of samples) {
      assert.equal(browsers.terminationOutcome({ ...entry, ...extras }), browsers.terminationOutcome(entry));
      assert.equal(browsers.closeOutcome({ ...entry, ...extras }), browsers.closeOutcome(entry));
    }
    assert.equal(browsers.terminationOutcome(samples[1]), 'error');
    assert.equal(browsers.closeOutcome(samples[0]), 'stopped');
  });

  test('diagnostic module does not reach for protocol dumps, tabs, storage, or tokens', () => {
    const source = fs.readFileSync(new URL('../server/diagnostics.js', import.meta.url), 'utf8');
    for (const banned of [
      'Browser.getBrowserCommandLine', 'page.close', '.pages(', 'localStorage', 'sessionStorage',
      'document.cookie', 'last_error', 'remote-debugging-port', '/api/api-token', 'PM_API_TOKEN',
    ]) assert.equal(source.includes(banned), false, banned);
    const adapter = fs.readFileSync(new URL('../server/browsers.js', import.meta.url), 'utf8');
    assert.match(adapter, /launchSnapshot:\s*proxyLaunchSnapshot\(p\.proxy\)/);
    assert.equal(/args\.push\([^)]*webrtc/i.test(adapter), false);
    assert.equal(diagnostics.readDiagnosticEnvironment.toString().includes('localStorage'), false);
    assert.equal(diagnostics.readDiagnosticEnvironment.toString().includes('cookie'), false);
  });

  test('desktop and automation HTTP auth, profile lookup, and the legacy diagnostics route', async () => {
    const ui = { 'x-ui-token': 'ui-tok' };
    const created = await call(desktop, 'POST', '/api/profiles', {
      headers: ui,
      body: {
        name: 'diag',
        notes: `${SENTINEL}-notes`,
        proxy: { type: 'http', host: 'proxy.example', port: 8080, username: `${SENTINEL}-user`, password: `${SENTINEL}-pass` },
      },
    });
    assert.equal(created.status, 201);
    const id = created.json.id;
    const before = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
    const logs = [];
    const originals = ['log', 'info', 'warn', 'error'].map(level => [level, console[level]]);
    for (const [level, fn] of originals) console[level] = (...args) => logs.push(args.map(String).join(' '));
    let observed;
    try {
      observed = await call(desktop, 'GET', `/api/profiles/${id}/diagnostics`, { headers: ui });
    } finally {
      for (const [level, fn] of originals) console[level] = fn;
    }
    assert.equal(observed.status, 200);
    assert.equal(observed.cache, 'no-store');
    assertSchema(observed.json);
    assert.equal(observed.json.observation.state, 'unavailable');
    assert.equal(observed.json.observation.reason, 'not_running');
    assert.deepEqual(observed.json.expected.chromiumVersion, avail(VERSION, 'manifest'));
    assert.deepEqual(observed.json.proxy, miss('not_running'));
    assertNoSentinel(observed.text);
    assert.equal(logs.join('\n').includes(SENTINEL), false);
    assert.equal(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, before);

    const legacy = await call(desktop, 'GET', '/api/diagnostics', { headers: ui });
    assert.equal(legacy.status, 200);
    assert.notEqual(legacy.cache, 'no-store');
    assert.equal(typeof legacy.json.pid, 'number');
    assert.equal(typeof legacy.json.platform, 'string');
    assert.equal(legacy.json.webrtc, undefined);
    assert.equal(legacy.json.observation, undefined);
    assert.equal(typeof legacy.json.schemaVersion, 'number');

    assertError(await call(desktop, 'GET', `/api/profiles/${id}/diagnostics`), 401, 'UNAUTHORIZED', 'Authentication is required.');
    assertError(await call(desktop, 'GET', `/api/profiles/${id}/diagnostics`, { headers: { authorization: 'Bearer ui-tok' } }), 401, 'UNAUTHORIZED');
    assertError(await call(desktop, 'GET', `/api/profiles/${id}/diagnostics?token=ui-tok`), 401, 'UNAUTHORIZED');
    assertError(await call(desktop, 'GET', '/api/profiles/not-a-uuid/diagnostics', { headers: ui }), 400, 'INVALID_REQUEST', 'The diagnostic request is invalid.');
    assertError(await call(desktop, 'GET', `/api/profiles/${id.toUpperCase()}/diagnostics`, { headers: ui }), 404, 'PROFILE_NOT_FOUND', 'Profile does not exist.');
    assertError(await call(desktop, 'GET', '/api/profiles/22222222-2222-4222-8222-222222222222/diagnostics', { headers: ui }), 404, 'PROFILE_NOT_FOUND');
    const unknown = await call(desktop, 'GET', '/api/not-a-route', { headers: ui });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.json, { error: 'not found' });

    const bearer = await call(automation, 'GET', `/api/profiles/${id}/diagnostics`, { headers: { authorization: `Bearer ${process.env.PM_API_TOKEN}` } });
    assert.equal(bearer.status, 200);
    assert.equal(bearer.cache, 'no-store');
    assert.equal(bearer.json.observation.state, 'unavailable');
    assertNoSentinel(bearer.text);
    const apiKey = await call(automation, 'GET', `/api/profiles/${id}/diagnostics`, { headers: { 'x-api-key': process.env.PM_API_TOKEN } });
    assert.equal(apiKey.status, 200);
    assertError(await call(automation, 'GET', `/api/profiles/${id}/diagnostics`, { headers: { 'x-ui-token': 'ui-tok' } }), 401, 'UNAUTHORIZED');
    assertError(await call(automation, 'GET', `/api/profiles/${id}/diagnostics?token=${process.env.PM_API_TOKEN}`), 401, 'UNAUTHORIZED');

    const mismatch = await call(desktop, 'POST', `/api/profiles/${id}/diagnostics/environment`, {
      headers: ui,
      body: { expectedLaunchId: 'launch-1', consent: CONSENT },
    });
    assertError(mismatch, 409, 'LAUNCH_CHANGED', 'Expected launch ID does not match.');
    const spaced = await call(desktop, 'POST', `/api/profiles/${id}/diagnostics/environment`, {
      headers: ui,
      body: { expectedLaunchId: '', consent: CONSENT },
    });
    assertError(spaced, 409, 'LAUNCH_CHANGED');
    for (const body of [
      {},
      { expectedLaunchId: 'launch-1', consent: 'nope' },
      { expectedLaunchId: 'launch-1', consent: CONSENT, extra: true },
      { expectedLaunchId: 1, consent: CONSENT },
      [],
    ]) {
      assertError(await call(desktop, 'POST', `/api/profiles/${id}/diagnostics/environment`, { headers: ui, body }), 400, 'INVALID_REQUEST');
    }
  });

  test('malformed JSON stays on the contract path only for diagnostic routes', async () => {
    const ui = { 'x-ui-token': 'ui-tok', 'content-type': 'application/json' };
    const diagnostic = await call(desktop, 'POST', `/api/profiles/${PROFILE}/diagnostics/environment`, {
      headers: ui,
      raw: `{"expectedLaunchId":"${SENTINEL}"`,
    });
    assertError(diagnostic, 400, 'INVALID_REQUEST');
    for (const suffix of ['', '/']) {
      const denied = await call(desktop, 'POST', `/api/profiles/${PROFILE}/diagnostics/environment${suffix}`, {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PM_API_TOKEN}` }, raw: '{',
      });
      assertError(denied, 401, 'UNAUTHORIZED');
      const malformed = await call(desktop, 'POST', `/api/profiles/${PROFILE}/diagnostics/environment${suffix}`, { headers: ui, raw: '{' });
      assertError(malformed, 400, 'INVALID_REQUEST');
    }
    const other = await call(desktop, 'POST', '/api/profiles', { headers: ui, raw: `{"name":"${SENTINEL}"` });
    assert.equal(other.status, 400);
    assert.deepEqual(other.json, { error: 'invalid JSON body' });
    assertNoSentinel(other.text);
  });

  test('HTTP 429, 500, and a completed POST keep the contract envelope', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let loads = 0;
    let observes = 0;
    await withApp({
      loadProfile: (id) => { loads += 1; return { id }; },
      observe: () => {
        observes += 1;
        return {
          phase: 'connected',
          launchId: 'launch-1',
          proxy: { state: 'off' },
          readPipeFacts: () => gate.then(() => pipeOk()),
          openDiagnosticPage: () => fakePage({ env: { timezone: 'UTC', locale: 'en-US', languages: ['en-US'] } }),
        };
      },
    }, async (server) => {
      const ui = { 'x-ui-token': 'ui-tok' };
      const unauthenticated = await call(server, 'GET', `/api/profiles/${PROFILE}/diagnostics`);
      assertError(unauthenticated, 401, 'UNAUTHORIZED');
      assert.equal(loads, 0);
      assert.equal(observes, 0);

      const first = call(server, 'GET', `/api/profiles/${PROFILE}/diagnostics`, { headers: ui });
      for (let i = 0; i < 50 && diagnostics.diagnosticsActiveCount() === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const busy = await call(server, 'GET', `/api/profiles/${PROFILE}/diagnostics`, { headers: ui });
      assertError(busy, 429, 'DIAGNOSTICS_BUSY', 'A diagnostic observation is already running.');
      release();
      const done = await first;
      assert.equal(done.status, 200);
      assert.equal(done.cache, 'no-store');
      assert.equal(done.json.observation.state, 'complete');
    });

    await withApp({
      loadProfile: () => { throw new Error(`${SENTINEL} stack at secret.js:1`); },
    }, async (server) => {
      const failed = await call(server, 'GET', `/api/profiles/${PROFILE}/diagnostics`, { headers: { 'x-ui-token': 'ui-tok' } });
      assertError(failed, 500, 'INTERNAL_ERROR', 'Unexpected application failure.');
    });

    await withApp({
      observe: () => ({
        phase: 'connected',
        launchId: 'launch-1',
        proxy: { state: 'off' },
        readPipeFacts: async () => { throw new Error(SENTINEL); },
        openDiagnosticPage: () => fakePage({ env: { timezone: 'UTC', locale: 'en-US', languages: ['en-US'] } }),
      }),
    }, async (server) => {
      const posted = await call(server, 'POST', `/api/profiles/${PROFILE}/diagnostics/environment`, {
        headers: { 'x-ui-token': 'ui-tok' },
        body: { expectedLaunchId: 'launch-1', consent: CONSENT },
      });
      assert.equal(posted.status, 200);
      assert.equal(posted.cache, 'no-store');
      assertSchema(posted.json);
      assert.equal(posted.json.observation.state, 'complete');
      assert.deepEqual(posted.json.environment.timezone, avail('UTC', 'visible_probe'));
      assertNoSentinel(posted.text);
    });
  });
});

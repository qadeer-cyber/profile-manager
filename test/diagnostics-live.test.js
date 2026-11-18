// Level 2 evidence only when this test actually launches the exact pinned browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import {
  validateDiagnosticsV1,
  validateDiagnosticsErrorBody,
  assertCacheControlNoStore,
  findForbiddenMaterial,
  findRelayValue,
  POST_CONSENT,
} from './diagnostics-v1-validator.mjs';
const backend = fs.existsSync(new URL('../server/diagnostics.js', import.meta.url));
const executable = chromium.executablePath();
const supported = ['linux', 'win32'].includes(process.platform);
const skip = !backend ? 'Assemble backend + UI + QA first' : !supported ? 'Real Windows/Linux process evidence requires a supported host' : !fs.existsSync(executable) ? 'Pinned Chromium executable absent' : false;

if (process.env.PM_DIAG_REQUIRE_LIVE === '1' && skip) throw new Error(String(skip));

// The acceptance test opens the server database. Later source-sign-off tests in this
// file reuse that disposable database; the process hook closes it after they finish.
let sharedTmp = null;
let sharedDb = null;

test('real Chromium 156: OS process identity, foreground probe, cancellation and launch invalidation', { skip, timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2-live-'));
  sharedTmp = tmp;
  process.env.PM_DATA_DIR = tmp;
  process.env.PM_API_TOKEN = 'fixture-live-api';
  const { db } = await import('../server/db.js');
  sharedDb = db;
  const { createApp } = await import('../server/app.js');
  const engine = await import('../server/browsers.js');
  const { collectDiagnostics, diagnosticsActiveCount } = await import('../server/diagnostics.js');
  const { diagnosticProcessStart, observeProcessPolicy } = await import('../server/diagnostic-process.js');
  let server, id;
  try {
    server = await new Promise((resolve, reject) => { const s = createApp({ uiToken: 'fixture-live-ui', staticDir: null }).listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
    const created = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ui-token': 'fixture-live-ui' }, body: JSON.stringify({ name: 'M2 live acceptance fixture' }) });
    assert.equal(created.status, 201); id = (await created.json()).id;
    await engine.launch({ id, proxy: null }, { headless: false });
    const first = await collectDiagnostics(id);
    assert.equal(first.runtime.chromiumVersion.value, '156.0.8078.4');
    assert.equal(first.webrtc.commandLinePolicy.source, 'process_command_line');
    assert.equal(first.webrtc.commandLinePolicy.value.state, 'absent');
    assert.equal(first.observation.state, 'complete');
    assert.equal(validateDiagnosticsV1(first, { route: 'GET' }).ok, true);
    assert.equal(engine.runInfo(id).cdp_port, null);
    const pid = engine.lifecycleSmokeSnapshot(id).browserPid;
    const start = await diagnosticProcessStart(Number(pid)); assert.ok(start);
    assert.deepEqual(await observeProcessPolicy({ pid, start: start + '-wrong', launchId: first.observation.launchId, stillCurrent: () => true }), { kind: 'unreadable' });
    const env = await collectDiagnostics(id, { mode: 'environment', expectedLaunchId: first.observation.launchId });
    const checked = validateDiagnosticsV1(env, { route: 'POST' }); assert.equal(checked.ok, true, checked.errors.join('\n'));
    assert.equal(env.observation.state, 'complete'); assert.equal(env.environment.timezone.source, 'visible_probe');
    // Real pending Runtime.evaluate: timeout must detach its dedicated session and
    // settle the underlying send before a second observation can own the guard.
    let page, evaluationStarted = false;
    const current = engine.diagnosticObservation(id);
    const timed = await collectDiagnostics(id, { mode: 'environment', expectedLaunchId: first.observation.launchId, deadlineMs: 3000,
      observe: () => ({ ...current, openDiagnosticPage: async hooks => {
        page = await current.openDiagnosticPage(hooks);
        page.diagnosticEvaluate = async () => {
          const session = await page.context().newCDPSession(page); hooks.trackSession(session);
          evaluationStarted = true;
          try { return await session.send('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true, returnByValue: true }); }
          finally { await session.detach().catch(() => {}); }
        };
        return page;
      } }),
    });
    assert.equal(timed.observation.reason, 'timeout');
    assert.equal(evaluationStarted, true, 'the real evaluation must actually be pending before the deadline');
    assert.ok(timed.observation.durationMs <= 3250, 'overall deadline including OS work');
    for (let i = 0; i < 100 && diagnosticsActiveCount(); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(diagnosticsActiveCount(), 0); assert.equal(page.isClosed(), false);
    assert.equal((await collectDiagnostics(id)).observation.state, 'complete');
    await engine.stop(id);
    const stopped = await collectDiagnostics(id); assert.equal(stopped.observation.state, 'unavailable');
    await engine.launch({ id, proxy: null }, { headless: false });
    const second = await collectDiagnostics(id); assert.notEqual(second.observation.launchId, first.observation.launchId);
    await assert.rejects(collectDiagnostics(id, { mode: 'environment', expectedLaunchId: first.observation.launchId }), e => e.code === 'LAUNCH_CHANGED');
  } finally {
    if (id) await engine.stop(id).catch(() => {});
    if (server) await new Promise(r => server.close(r));
  }
});


test('real OS child observation: absent/present/conflicting, identity rejection and timing', { skip, timeout: 45000 }, async () => {
  const { diagnosticProcessStart, observeProcessPolicy } = await import('../server/diagnostic-process.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2-process-'));
  const fixture = path.join(tmp, 'child with spaces.mjs');
  fs.writeFileSync(fixture, 'setTimeout(() => {}, 40000);');
  try {
    for (const [args, kind] of [[[], 'absent'], [['--force-webrtc-ip-handling-policy=default'], 'present'], [['--force-webrtc-ip-handling-policy=default', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'], 'conflicting']]) {
      const child = spawn(process.execPath, [fixture, ...args, 'private fixture with spaces and "quotes"'], { stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      try {
        const start = await diagnosticProcessStart(child.pid); assert.ok(start);
        const before = performance.now();
        const result = await observeProcessPolicy({ pid: child.pid, start, launchId: 'fixture-launch', stillCurrent: () => true });
        const durationMs = performance.now() - before;
        assert.equal(result.kind, kind);
        assert.equal(JSON.stringify(result).includes('private fixture'), false);
        if (kind === 'present') assert.equal(result.value, 'default');
        assert.deepEqual(await observeProcessPolicy({ pid: child.pid, start: 'wrong', launchId: 'fixture-launch', stillCurrent: () => true }), { kind: 'unreadable' });
        assert.deepEqual(await observeProcessPolicy({ pid: child.pid, start, launchId: 'fixture-launch', stillCurrent: () => false }), { kind: 'unreadable' });
        console.log(JSON.stringify({ evidence: 'actual_os_process_observation', platform: process.platform, state: kind, durationMs }));
      } finally {
        const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed;
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

const SIGNOFF = Object.freeze({
  apiToken: 'm2-signoff-api-token-t43u-ee55',
  uiToken: 'm2-signoff-ui-token-t43u',
  cookie: 'SENTINEL_COOKIE_t43u_aa11',
  local: 'SENTINEL_LS_t43u_bb22',
  session: 'SENTINEL_SS_t43u_cc33',
  title: 'SENTINEL_TITLE_t43u_dd44',
  path: 'SENTINEL_PATH_t43u_cc33',
  proxyUser: 'SENTINEL_PROXY_USER_t43u_7f3a',
  proxyPass: 'SENTINEL_PROXY_PASS_t43u_9c2b',
  userTz: 'Qaa/Userpage',
  userLocale: 'qaa-Upage',
});
const CDP_MARKERS = ['Runtime.evaluate', 'Network.getCookies', 'Network.getAllCookies', 'Storage.getStorageKey', 'Target.createTarget'];

function routableIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      const v4 = entry.family === 'IPv4' || entry.family === 4;
      if (v4 && !entry.internal) return entry.address;
    }
  }
  return null;
}

function installStorageGuard() {
  if (globalThis.__pmDiagGuard) return;
  const g = { cookie: 0, localStorage: 0, sessionStorage: 0, language: 0, intl: 0 };
  globalThis.__pmDiagGuard = g;
  const bump = (key, fn) => function bumped(...args) {
    if (!g.mute) g[key] += 1;
    return fn.apply(this, args);
  };
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookie && cookie.get) {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: cookie.enumerable,
      get: bump('cookie', cookie.get),
      set: cookie.set ? bump('cookie', cookie.set) : undefined,
    });
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    const desc = Object.getOwnPropertyDescriptor(Window.prototype, name);
    if (!desc || !desc.get) continue;
    Object.defineProperty(Window.prototype, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get: bump(name, desc.get),
    });
  }
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function forwardingProxy() {
  const proxy = http.createServer((req, res) => {
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    }, pres => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.on('connect', (_req, socket) => {
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.end();
  });
  return proxy;
}

let signoff = null;

async function ensureSignoff() {
  if (signoff) return signoff;
  if (!sharedDb) throw new Error('disposable diagnostics database was not opened');
  const hostIp = routableIPv4();
  if (!hostIp) throw new Error('no routable IPv4 for the proxied user page');
  process.env.PM_API_TOKEN = SIGNOFF.apiToken;
  process.env.PM_PROXY_LOOPBACK = '1';
  const { createApp } = await import('../server/app.js');
  const engine = await import('../server/browsers.js');
  const diagnostics = await import('../server/diagnostics.js');
  const { userDataDir } = await import('../server/db.js');
  const { rowStatus } = await import('../web/src/lib.js');
  const site = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': `pm_cookie=${SIGNOFF.cookie}; Path=/`,
    });
    res.end(`<!doctype html><title>${SIGNOFF.title}</title><p>${SIGNOFF.path}</p>`);
  });
  const proxy = forwardingProxy();
  const sitePort = await listen(site, '0.0.0.0');
  const proxyPort = await listen(proxy, '127.0.0.1');
  const pageUrl = `http://${hostIp}:${sitePort}/${SIGNOFF.path}`;
  const server = await new Promise((resolve, reject) => {
    const s = createApp({ uiToken: SIGNOFF.uiToken, staticDir: null }).listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const requests = [];
  server.on('request', (req) => requests.push(`${req.method} ${req.url}`));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id;
  try {
  const created = await fetch(`${base}/api/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui-token': SIGNOFF.uiToken },
    body: JSON.stringify({ name: 'm2 signoff disposable' }),
  });
  assert.equal(created.status, 201);
  id = (await created.json()).id;
  await engine.launch({
    id,
    proxy: {
      type: 'http', host: '127.0.0.1', port: proxyPort,
      username: SIGNOFF.proxyUser, password: SIGNOFF.proxyPass,
    },
  }, { headless: false, automation: true });
  const info = engine.runInfo(id);
  assert.ok(info?.relay_url, 'proxied launch must record a relay_url');
  assert.ok(info.ws_endpoint, 'automation observer needs the profile CDP endpoint');
  const browser = await chromium.connectOverCDP(info.ws_endpoint);
  const context = browser.contexts()[0];
  await context.addInitScript(installStorageGuard);
  const userPage = context.pages()[0];
  const nav = await userPage.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.equal(nav.status(), 200);
  assert.equal(userPage.url(), pageUrl);
  await userPage.evaluate(installStorageGuard);
  await userPage.evaluate(({ local, session, userTz, userLocale }) => {
    const g = globalThis.__pmDiagGuard;
    g.mute = true;
    localStorage.setItem('pm-sentinel', local);
    sessionStorage.setItem('pm-sentinel', session);
    g.mute = false;
    const Orig = Intl.DateTimeFormat;
    function Wrapped(...args) {
      if (!g.mute) g.intl += 1;
      const dtf = new Orig(...args);
      const resolved = dtf.resolvedOptions.bind(dtf);
      dtf.resolvedOptions = () => ({ ...resolved(), timeZone: userTz });
      return dtf;
    }
    Wrapped.prototype = Orig.prototype;
    Wrapped.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig);
    Intl.DateTimeFormat = Wrapped;
    const proto = Object.getPrototypeOf(navigator);
    Object.defineProperty(proto, 'language', {
      configurable: true,
      get() { if (!g.mute) g.language += 1; return userLocale; },
    });
    Object.defineProperty(proto, 'languages', {
      configurable: true,
      get() { if (!g.mute) g.language += 1; return [userLocale]; },
    });
    g.cookie = 0; g.localStorage = 0; g.sessionStorage = 0; g.language = 0; g.intl = 0;
  }, SIGNOFF);
  signoff = {
    id, engine, diagnostics, userDataDir, rowStatus, base, requests, info, browser, context, userPage, pageUrl, server, site, proxy,
  };
  return signoff;
  } catch (error) {
    if (id) await engine.stop(id).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    site.close();
    proxy.close();
    throw error;
  }
}

after(async () => {
  if (signoff) {
    await signoff.engine.stop(signoff.id).catch(() => {});
    await new Promise((resolve) => signoff.server.close(resolve));
    signoff.site.close();
    signoff.proxy.close();
    await signoff.browser.close().catch(() => {});
  }
  try { sharedDb?.close(); } catch { /* already closed */ }
  if (sharedTmp) fs.rmSync(sharedTmp, { recursive: true, force: true });
});

async function api(method, urlPath, body, headers = {}) {
  const h = await ensureSignoff();
  const res = await fetch(h.base + urlPath, {
    method,
    headers: { 'content-type': 'application/json', 'x-ui-token': SIGNOFF.uiToken, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}

function assertNoToken(res) {
  assert.equal(res.text.includes(SIGNOFF.apiToken), false, 'response body contains the automation API token');
  for (const [key, value] of res.headers) {
    assert.equal(String(key).includes(SIGNOFF.apiToken), false, 'response header name contains the automation API token');
    assert.equal(String(value).includes(SIGNOFF.apiToken), false, 'response header value contains the automation API token');
  }
}

function secretNeedles(extra = []) {
  return [
    SIGNOFF.apiToken, SIGNOFF.cookie, SIGNOFF.local, SIGNOFF.session, SIGNOFF.title,
    SIGNOFF.path, SIGNOFF.proxyUser, SIGNOFF.proxyPass, SIGNOFF.userTz, SIGNOFF.userLocale,
    ...extra, ...CDP_MARKERS,
  ];
}

function assertNeedlesAbsent(text, needles, label) {
  for (const needle of needles) {
    assert.equal(text.includes(needle), false, `${label} contains forbidden material`);
  }
}

async function readGuard(page) {
  return page.evaluate(() => {
    const g = globalThis.__pmDiagGuard;
    if (!g) return null;
    g.mute = true;
    let local = null; let session = null;
    try { local = localStorage.getItem('pm-sentinel'); } catch { local = null; }
    try { session = sessionStorage.getItem('pm-sentinel'); } catch { session = null; }
    const snap = {
      cookie: g.cookie, localStorage: g.localStorage, sessionStorage: g.sessionStorage,
      language: g.language, intl: g.intl, local, session,
    };
    g.mute = false;
    return snap;
  });
}

async function targetInfos(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const result = await session.send('Target.getTargets');
    return result.targetInfos;
  } finally {
    await session.detach().catch(() => {});
  }
}

function pageTargets(infos) {
  return infos.filter((t) => ['page', 'background_page', 'service_worker', 'shared_worker', 'iframe', 'other'].includes(t.type));
}

async function consentedPost(h) {
  const launchId = h.engine.lifecycleSmokeSnapshot(h.id).launchId;
  const beforePages = new Set(h.context.pages());
  const beforeTargets = await targetInfos(h.browser);
  const seen = [];
  const listen = (page) => {
    const onRequest = (req) => seen.push({ url: req.url(), page });
    page.on('request', onRequest);
    return () => page.off('request', onRequest);
  };
  const offs = h.context.pages().map(listen);
  const onPage = (page) => { offs.push(listen(page)); };
  h.context.on('page', onPage);
  let res;
  try {
    res = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, {
      expectedLaunchId: launchId,
      consent: POST_CONSENT,
    });
  } finally {
    h.context.off('page', onPage);
    for (const off of offs) off();
  }
  const added = h.context.pages().filter((page) => !beforePages.has(page));
  const afterTargets = await targetInfos(h.browser);
  const beforeIds = new Set(beforeTargets.map((t) => t.targetId));
  const addedTargets = pageTargets(afterTargets).filter((t) => !beforeIds.has(t.targetId));
  return { res, launchId, added, addedTargets, seen, beforeTargets, afterTargets };
}

function isBenignProbeUrl(url) {
  return url.startsWith('data:') || url === 'about:blank' || url.startsWith('about:');
}

test('§7.1: POST without exact consent body => 400 INVALID_REQUEST and no tab opened', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const launchId = h.engine.lifecycleSmokeSnapshot(h.id).launchId;
  assert.equal(h.engine.isRunning(h.id), true);
  assert.equal(h.engine.lifecycleSmokeSnapshot(h.id).launchId, launchId);
  const pagesBefore = h.context.pages().length;
  const targetsBefore = (await targetInfos(h.browser)).map((t) => t.targetId).sort();
  const bodies = [
    {},
    { expectedLaunchId: launchId },
    { expectedLaunchId: launchId, consent: 'open-visible-diagnostic-tab ' },
    { expectedLaunchId: launchId, consent: 'no' },
    { consent: POST_CONSENT },
    { expectedLaunchId: launchId, consent: POST_CONSENT, extra: true },
  ];
  for (const body of bodies) {
    const res = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, body);
    assert.equal(res.status, 400);
    assert.equal(res.json?.error?.code, 'INVALID_REQUEST');
    const checked = validateDiagnosticsErrorBody(res.json);
    assert.equal(checked.ok, true, checked.errors.join('\n'));
    assert.equal(assertCacheControlNoStore(res.headers).ok, true);
    assert.equal(h.context.pages().length, pagesBefore);
  }
  assert.deepEqual((await targetInfos(h.browser)).map((t) => t.targetId).sort(), targetsBefore);
  const opened = await consentedPost(h);
  assert.equal(opened.res.status, 200, opened.res.text);
  assert.equal(opened.added.length, 1, 'running profile must be able to open a diagnostic tab');
});

test('case 8: live GET/POST diagnostics bodies/headers never contain automation API_TOKEN value', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const get = await api('GET', `/api/profiles/${h.id}/diagnostics`);
  const post = await consentedPost(h);
  assert.equal(get.status, 200);
  assert.equal(post.res.status, 200);
  assertNoToken(get);
  assertNoToken(post.res);
  const bearer = await fetch(`${h.base}/api/profiles/${h.id}/diagnostics`, {
    headers: { authorization: `Bearer ${SIGNOFF.apiToken}` },
  });
  const bearerText = await bearer.text();
  assert.equal(bearerText.includes(SIGNOFF.apiToken), false, 'bearer error body contains the automation API token');
  for (const [key, value] of bearer.headers) {
    assert.equal(String(value).includes(SIGNOFF.apiToken), false, 'bearer response header contains the automation API token');
    assert.equal(String(key).includes(SIGNOFF.apiToken), false);
  }
  assert.equal(h.requests.some((line) => line.includes('/api/api-token')), false, 'M2 flow requested /api/api-token');
});

test('§9: live payloads/logs exclude cookies, storage, page URLs/titles, raw CDP, keys; findForbiddenMaterial (relay-shaped URLs, --flags, user-data-dir, remote-debugging) empty and findRelayValue(actual running-row relay_url of a real proxied launch) empty on every live response', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const relay = h.engine.runInfo(h.id).relay_url;
  assert.ok(relay, 'real proxied launch relay_url');
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const key of Object.keys(orig)) {
    console[key] = (...args) => {
      lines.push(args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
      orig[key](...args);
    };
  }
  let get; let post;
  try {
    get = await api('GET', `/api/profiles/${h.id}/diagnostics`);
    post = await consentedPost(h);
  } finally {
    Object.assign(console, orig);
  }
  const ws = h.engine.runInfo(h.id).ws_endpoint || '';
  const needles = secretNeedles([h.pageUrl, relay, ws, 'ws://']);
  for (const res of [get, post.res]) {
    assert.equal(res.status, 200);
    const checked = validateDiagnosticsV1(res.json, { route: res === get ? 'GET' : 'POST' });
    assert.equal(checked.ok, true, checked.errors.join('\n'));
    assert.deepEqual(findForbiddenMaterial(res.text), []);
    assert.deepEqual(findRelayValue(res.text, relay), []);
    assertNeedlesAbsent(res.text, needles, 'diagnostics payload');
  }
  const log = lines.join('\n');
  assert.deepEqual(findForbiddenMaterial(log), []);
  assert.deepEqual(findRelayValue(log, relay), []);
  assertNeedlesAbsent(log, needles, 'diagnostics log');
});

test('§7.2/§7.10: exactly one new app-owned visible tab per POST; no hidden/background target', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const opened = await consentedPost(h);
  assert.equal(opened.res.status, 200, opened.res.text);
  assert.equal(opened.added.length, 1);
  const probe = opened.added[0];
  assert.equal(probe.url(), h.diagnostics.diagnosticDataUrl());
  assert.equal(await probe.title(), 'pm-diagnostics-v1');
  assert.equal(await probe.evaluate(() => document.visibilityState), 'visible');
  assert.equal(opened.addedTargets.length, 1);
  assert.equal(opened.addedTargets[0].type, 'page');
  assert.equal(opened.addedTargets[0].url.startsWith('data:text/html'), true);
  assert.equal(opened.addedTargets.some((t) => t.type === 'background_page' || t.type === 'service_worker'), false);
});

test('§7.5: existing user targets never attached/evaluated', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const before = await readGuard(h.userPage);
  const urlBefore = h.userPage.url();
  const titleBefore = await h.userPage.title();
  const opened = await consentedPost(h);
  assert.equal(opened.res.status, 200, opened.res.text);
  const after = await readGuard(h.userPage);
  assert.equal(after.language, before.language);
  assert.equal(after.intl, before.intl);
  assert.equal(after.language, 0);
  assert.equal(after.intl, 0);
  assert.notEqual(opened.res.json?.environment?.locale?.value, SIGNOFF.userLocale);
  assert.notEqual(opened.res.json?.environment?.timezone?.value, SIGNOFF.userTz);
  assert.equal(h.userPage.url(), urlBefore);
  assert.equal(await h.userPage.title(), titleBefore);
  assert.equal(opened.res.text.includes(urlBefore), false);
  assert.equal(opened.res.text.includes(titleBefore), false);
});

test('§7.6/§7.7: probe makes zero network requests; no cookie/localStorage/sessionStorage access', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const userBefore = await readGuard(h.userPage);
  const opened = await consentedPost(h);
  assert.equal(opened.res.status, 200, opened.res.text);
  assert.equal(opened.added.length, 1);
  const probe = opened.added[0];
  const guard = await readGuard(probe);
  assert.ok(guard, 'probe document did not install the storage observer');
  assert.equal(guard.cookie, 0);
  assert.equal(guard.localStorage, 0);
  assert.equal(guard.sessionStorage, 0);
  const userAfter = await readGuard(h.userPage);
  assert.equal(userAfter.cookie, userBefore.cookie);
  assert.equal(userAfter.localStorage, userBefore.localStorage);
  assert.equal(userAfter.sessionStorage, userBefore.sessionStorage);
  const entries = await probe.evaluate(() => performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).map((entry) => entry.name));
  assert.ok(entries.every((name) => isBenignProbeUrl(name)), `probe network entries: ${entries.join(', ')}`);
  const probeHits = opened.seen.filter((hit) => hit.page === probe || isBenignProbeUrl(hit.url) === false);
  for (const hit of opened.seen) {
    if (hit.page === probe || !isBenignProbeUrl(hit.url)) assert.equal(isBenignProbeUrl(hit.url), true, hit.url);
  }
  assert.equal(probeHits.every((hit) => isBenignProbeUrl(hit.url)), true);
});

test('case 7: data: probe page makes zero external requests and inspects no user page', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const userBefore = await readGuard(h.userPage);
  const opened = await consentedPost(h);
  assert.equal(opened.res.status, 200, opened.res.text);
  assert.equal(opened.added.length, 1);
  const probe = opened.added[0];
  assert.ok(probe.url().startsWith('data:text/html'));
  assert.equal(await probe.evaluate(() => location.protocol), 'data:');
  const entries = await probe.evaluate(() => performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).map((entry) => entry.name));
  assert.equal(entries.some((name) => /^https?:/i.test(name)), false);
  for (const hit of opened.seen) {
    if (hit.page === probe) assert.equal(isBenignProbeUrl(hit.url), true, hit.url);
  }
  const userAfter = await readGuard(h.userPage);
  assert.equal(userAfter.language, userBefore.language);
  assert.equal(userAfter.intl, userBefore.intl);
  assert.equal(userAfter.cookie, userBefore.cookie);
  assert.equal(userAfter.localStorage, userBefore.localStorage);
  assert.equal(userAfter.sessionStorage, userBefore.sessionStorage);
  assert.notEqual(opened.res.json?.environment?.locale?.value, SIGNOFF.userLocale);
  assert.equal(opened.res.text.includes(h.pageUrl), false);
});

test('case 1: opening diagnostic tab does not change lifecycle classification or last_error', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const profileBefore = sharedDb.prepare('SELECT last_error FROM profiles WHERE id=?').get(h.id);
  const runningBefore = h.engine.isRunning(h.id);
  const statusBefore = h.rowStatus({ running: runningBefore, last_error: profileBefore.last_error });
  const launchBefore = h.engine.lifecycleSmokeSnapshot(h.id).launchId;
  const lockBefore = fs.readFileSync(path.join(h.userDataDir(h.id), '.pm-lock'), 'utf8');
  const events = [];
  const onEvent = (event) => { if (event?.id === h.id) events.push(event.type); };
  h.engine.events.on('event', onEvent);
  try {
    const opened = await consentedPost(h);
    assert.equal(opened.res.status, 200, opened.res.text);
    assert.equal(opened.added.length, 1);
  } finally {
    h.engine.events.off('event', onEvent);
  }
  const profileAfter = sharedDb.prepare('SELECT last_error FROM profiles WHERE id=?').get(h.id);
  const statusAfter = h.rowStatus({ running: h.engine.isRunning(h.id), last_error: profileAfter.last_error });
  assert.equal(h.engine.isRunning(h.id), true);
  assert.equal(profileAfter.last_error, profileBefore.last_error);
  assert.deepEqual(statusAfter, statusBefore);
  assert.equal(statusAfter.key, 'running');
  assert.equal(h.engine.lifecycleSmokeSnapshot(h.id).launchId, launchBefore);
  assert.equal(fs.readFileSync(path.join(h.userDataDir(h.id), '.pm-lock'), 'utf8'), lockBefore);
  assert.deepEqual(events.filter((type) => type === 'profile:crashed' || type === 'profile:stopped'), []);
});

test('§9: diagnostics failures leave last_error, lifecycle, .pm-lock, DB rows and browser storage unchanged', { skip, timeout: 120000 }, async () => {
  const h = await ensureSignoff();
  const snap = () => {
    const profile = sharedDb.prepare('SELECT * FROM profiles WHERE id=?').get(h.id);
    const running = sharedDb.prepare('SELECT * FROM running WHERE id=?').get(h.id);
    const schema = sharedDb.prepare('SELECT version, name FROM schema_version ORDER BY version').all();
    const counts = {
      profiles: sharedDb.prepare('SELECT COUNT(*) n FROM profiles').get().n,
      running: sharedDb.prepare('SELECT COUNT(*) n FROM running').get().n,
      proxies: sharedDb.prepare('SELECT COUNT(*) n FROM proxies').get().n,
    };
    return {
      profile,
      running,
      schema,
      counts,
      lock: fs.readFileSync(path.join(h.userDataDir(h.id), '.pm-lock'), 'utf8'),
      status: h.rowStatus({ running: h.engine.isRunning(h.id), last_error: profile.last_error }),
      launchId: h.engine.lifecycleSmokeSnapshot(h.id).launchId,
    };
  };
  const before = snap();
  const storageBefore = await readGuard(h.userPage);
  const cookiesBefore = await h.context.cookies(h.pageUrl);
  const rejected = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, {});
  assert.equal(rejected.status, 400);
  const mismatched = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, {
    expectedLaunchId: 'superseded-launch-id',
    consent: POST_CONSENT,
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.json?.error?.code, 'LAUNCH_CHANGED');
  const timed = await h.diagnostics.collectDiagnostics(h.id, {
    mode: 'environment',
    expectedLaunchId: before.launchId,
    deadlineMs: 1,
  });
  assert.equal(timed.observation.reason, 'timeout');
  for (let i = 0; i < 100 && h.diagnostics.diagnosticsActiveCount(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(h.diagnostics.diagnosticsActiveCount(), 0);
  assert.deepEqual(snap(), before);
  const storageAfter = await readGuard(h.userPage);
  assert.equal(storageAfter.local, SIGNOFF.local);
  assert.equal(storageAfter.session, SIGNOFF.session);
  assert.equal(storageAfter.cookie, storageBefore.cookie);
  assert.equal(storageAfter.localStorage, storageBefore.localStorage);
  assert.equal(storageAfter.sessionStorage, storageBefore.sessionStorage);
  assert.deepEqual(await h.context.cookies(h.pageUrl), cookiesBefore);
});

test('§8: rapid stop/relaunch x10 — every response launchId equals the then-active launch; no superseded facts', { skip, timeout: 420000 }, async () => {
  const h = await ensureSignoff();
  const previous = [];
  for (let i = 0; i < 10; i += 1) {
    await h.engine.stop(h.id);
    assert.equal(h.engine.isRunning(h.id), false);
    const stopped = await api('GET', `/api/profiles/${h.id}/diagnostics`);
    assert.equal(stopped.status, 200);
    const stoppedCheck = validateDiagnosticsV1(stopped.json, { route: 'GET' });
    assert.equal(stoppedCheck.ok, true, stoppedCheck.errors.join('\n'));
    assert.equal(stopped.json.observation.state, 'unavailable');
    assert.equal(stopped.json.observation.launchId, null);
    for (const old of previous) assert.equal(stopped.text.includes(old), false, 'stopped response contains a superseded launchId');
    await h.engine.launch({ id: h.id, proxy: null }, { headless: false });
    const active = h.engine.lifecycleSmokeSnapshot(h.id).launchId;
    assert.equal(typeof active, 'string');
    assert.equal(previous.includes(active), false);
    const get = await api('GET', `/api/profiles/${h.id}/diagnostics`);
    assert.equal(get.status, 200);
    const getCheck = validateDiagnosticsV1(get.json, { route: 'GET' });
    assert.equal(getCheck.ok, true, getCheck.errors.join('\n'));
    assert.equal(get.json.observation.launchId, active);
    assert.equal(get.json.observation.launchId, h.engine.lifecycleSmokeSnapshot(h.id).launchId);
    for (const old of previous) {
      assert.equal(get.text.includes(old), false, 'GET contains a superseded launchId');
      const stale = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, {
        expectedLaunchId: old,
        consent: POST_CONSENT,
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.json?.error?.code, 'LAUNCH_CHANGED');
      assert.equal(stale.text.includes(active), false, 'stale POST returned the active launch');
    }
    const post = await api('POST', `/api/profiles/${h.id}/diagnostics/environment`, {
      expectedLaunchId: active,
      consent: POST_CONSENT,
    });
    assert.equal(post.status, 200, post.text);
    const postCheck = validateDiagnosticsV1(post.json, { route: 'POST' });
    assert.equal(postCheck.ok, true, postCheck.errors.join('\n'));
    assert.equal(post.json.observation.launchId, active);
    assert.equal(post.json.observation.launchId, h.engine.lifecycleSmokeSnapshot(h.id).launchId);
    for (const old of previous) assert.equal(post.text.includes(old), false, 'POST contains a superseded launchId');
    previous.push(active);
  }
  assert.equal(new Set(previous).size, 10);
});

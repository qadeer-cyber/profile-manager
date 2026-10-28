// B1(b) closeout negatives (t46u): user actions on the quarantined (failed) M2
// diagnostic tab, and an injected diagnostic timeout. Real Chromium + real app.
// Faults are injected at the CDP command layer only; no product code is stubbed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-b1neg-'));
process.env.PM_DATA_DIR = tmp; process.env.PM_API_TOKEN = 'fixture-b1neg-api';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const engine = await import('../server/browsers.js');
const { diagnosticsActiveCount, COLLECTION_DEADLINE_MS } = await import('../server/diagnostics.js');
const { POST_CONSENT, validateDiagnosticsV1 } = await import('./diagnostics-v1-validator.mjs');
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e)));
const server = await new Promise(r => { const s = createApp({ uiToken: 'u', staticDir: null }).listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-ui-token': 'u' }, body: b && JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; };
// Every page load beacons the locale it actually ran with. A beacon from a
// non-de-DE locale (or from the quarantined tab at all) is a bypass.
const hits = [], beacons = [];
const site = await new Promise(r => { const s = http.createServer((q, res) => {
  hits.push(q.url);
  if (q.url.startsWith('/beacon')) { beacons.push(decodeURIComponent(q.url.split('?')[1] || '')); res.end('ok'); return; }
  res.setHeader('content-type', 'text/html');
  res.end(`<p>t</p><script>fetch('/beacon?' + encodeURIComponent(location.pathname + '|' + Intl.DateTimeFormat().resolvedOptions().locale + '|' + navigator.language))</script>`);
}).listen(0, '127.0.0.1', () => r(s)); });
const origin = `http://127.0.0.1:${site.address().port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms) => Promise.race([Promise.resolve(p).then(v => ({ v }), e => ({ e })), sleep(ms).then(() => 'timeout')]);
const failed = []; engine.events.on('event', e => { if (e.type === 'profile:launch-failed') failed.push(e.id); });
after(async () => { for (const id of engine.runningIds()) await engine.stop(id).catch(() => {}); server.close(); site.close(); if (db.open) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// mode: null | 'reject' | { delayMs } (delay then reject)
let mode = null, injected = 0, conn;
async function launched(name) {
  const id = (await call('POST', '/profiles', { name, browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'] } })).json.id;
  assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
  const helper = await engine.diagnosticObservation(id).openDiagnosticPage({ trackSession() {}, cancelled: () => false });
  const ctx = helper.context();
  const root = await ctx.browser().newBrowserCDPSession();
  const impl = root._connection.toImpl(root)._session;
  conn = impl._connection;
  const proto = Object.getPrototypeOf(impl);
  await root.detach();
  if (!proto.__b1neg) {
    const orig = proto.send; proto.__b1neg = true;
    proto.send = function (method, params) {
      if (mode && method === 'Emulation.setLocaleOverride') {
        injected++;
        if (mode === 'reject') return Promise.reject(new Error('INJECTED locale failure'));
        return sleep(mode.delayMs).then(() => { throw new Error('INJECTED slow locale failure'); });
      }
      return orig.call(this, method, params);
    };
  }
  const user = await ctx.newPage();
  await user.goto(`${origin}/user`);
  await user.evaluate(() => { sessionStorage.setItem('k', 'v'); });
  return { id, ctx, user };
}
const launchIdOf = async id => (await call('GET', `/profiles/${id}/diagnostics`)).json.observation.launchId;
const post = (id, launchId) => call('POST', `/profiles/${id}/diagnostics/environment`, { expectedLaunchId: launchId, consent: POST_CONSENT });
const pageTargets = async ctx => { const s = await ctx.browser().newBrowserCDPSession(); try { return (await s.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page'); } finally { await s.detach(); } };
const unchanged = async (id, snap, row, launchId, label) => {
  assert.equal(engine.isRunning(id), true, label + ': profile running');
  assert.deepEqual(engine.lifecycleSmokeSnapshot(id), snap, label + ': lifecycle snapshot');
  assert.deepEqual(engine.runInfo(id), row, label + ': running row');
  assert.equal(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, null, label + ': last_error');
  assert.deepEqual(failed.filter(x => x === id), [], label + ': no launch-failed event');
  assert.equal(await launchIdOf(id), launchId, label + ': launchId');
};
const assertRecovered = async (id, launchId, label) => {
  assert.equal(diagnosticsActiveCount(), 0, label + ': no diagnostic lock held');
  const ok = await post(id, launchId);
  console.log('# ' + label, JSON.stringify({ status: ok.status, locale: ok.json?.environment?.locale, languages: ok.json?.environment?.languages }));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.environment.locale.availability, 'available');
  assert.equal(ok.json.environment.locale.value, 'de-DE');
  assert.deepEqual(ok.json.environment.languages.value, ['de-DE', 'en-US']);
  assert.equal(diagnosticsActiveCount(), 0);
};

test('quarantined diagnostic tab: address-bar navigation, reload, manual close -> no bypass/leak/lock', { timeout: 90000 }, async () => {
  const { id, ctx, user } = await launched('b1neg-user-actions');
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id), row = engine.runInfo(id);
  const sessionsBefore = new Set(conn._sessions.keys());
  const quarantinedIds = [];
  const ROUNDS = Number(process.env.B1NEG_ROUNDS || 3);
  for (let round = 0; round < ROUNDS; round++) {
    const before = new Set((await pageTargets(ctx)).map(t => t.targetId));
    mode = 'reject'; injected = 0;
    const r = await post(id, launchId);
    mode = null;
    assert.equal(r.status, 200); assert.ok(injected >= 1);
    for (const k of ['timezone', 'locale', 'languages']) assert.equal(r.json.environment[k].availability, 'unavailable');
    const q = (await pageTargets(ctx)).filter(t => !before.has(t.targetId));
    assert.equal(q.length, 1, 'one quarantined target kept open (§7.9)');
    const qid = q[0].targetId; quarantinedIds.push(qid);
    // Independent browser-level session = the browser UI's own navigation path
    // (NavigationController via Page.navigate typed / Page.reload). It never resumes the target.
    const b = await ctx.browser().newBrowserCDPSession();
    const { sessionId } = await b.send('Target.attachToTarget', { targetId: qid, flatten: true });
    const qs = b._connection.toImpl(b)._session.createChildSession(sessionId);
    const beaconsBefore = beacons.length;
    const evalNow = async () => { const x = await within(qs.send('Runtime.evaluate', { expression: 'Intl.DateTimeFormat().resolvedOptions().locale', returnByValue: true }), 1500); return x === 'timeout' ? 'timeout' : x.e ? 'error' : x.v?.result?.value; };
    const nav = await within(qs.send('Page.navigate', { url: `${origin}/addressbar${round}`, transitionType: 'typed' }), 2500);
    await sleep(500);
    const evalAfterNav = await evalNow();
    const reload = await within(qs.send('Page.reload', { ignoreCache: true }), 2500);
    await sleep(1000);
    const evalAfterReload = await evalNow();
    const nav2 = await within(qs.send('Page.navigate', { url: `${origin}/after-reload${round}`, transitionType: 'typed' }), 2500);
    await sleep(1200);
    const evalAfterNav2 = await evalNow();
    const qinfo = (await pageTargets(ctx)).find(t => t.targetId === qid);
    const tag = x => x === 'timeout' ? 'timeout' : x.e ? 'error' : 'returned';
    const ev = { round, nav: tag(nav), evalAfterNav, reload: tag(reload), evalAfterReload, nav2: tag(nav2), evalAfterNav2, url: qinfo?.url, newBeacons: beacons.slice(beaconsBefore) };
    console.log('# B1NEG-USER-ACTIONS', JSON.stringify(ev));
    await b.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    await b.detach();
    // No locale bypass: no script ran in the quarantined tab with a non-native locale.
    for (const e of [evalAfterNav, evalAfterReload, evalAfterNav2]) assert.ok(e === 'timeout' || e === 'error' || e === 'de-DE', `round ${round}: quarantined tab executed script with locale ${e}`);
    for (const bc of beacons) assert.match(bc, /\|de-DE\|de-DE$/, 'every executed page ran with native locale: ' + bc);
    assert.ok(qinfo, '§7.9: navigation/reload did not auto-close the tab');
  }
  // No unrestricted target: every non-quarantined page still runs de-DE.
  for (const p of ctx.pages()) {
    if (quarantinedIds.includes(p._connection.toImpl(p).delegate._targetId)) continue;
    const v = await within(p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale), 2000);
    if (v !== 'timeout' && !v.e) assert.equal(v.v, 'de-DE');
  }
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k')]), ['de-DE', 'v']);
  await unchanged(id, snap, row, launchId, 'after-nav-reload');
  const quarantineSessions = [...conn._sessions.keys()].filter(k => !sessionsBefore.has(k));

  // Manual close (tab X == Target.closeTarget). Profile survives; sessions released.
  const b = await ctx.browser().newBrowserCDPSession();
  for (const qid of quarantinedIds) assert.equal((await b.send('Target.closeTarget', { targetId: qid })).success, true);
  await b.detach();
  for (let i = 0; i < 30 && (await pageTargets(ctx)).some(t => quarantinedIds.includes(t.targetId)); i++) await sleep(100);
  await sleep(500);
  assert.equal((await pageTargets(ctx)).some(t => quarantinedIds.includes(t.targetId)), false, 'tabs closed by user');
  const leaked = quarantineSessions.filter(k => conn._sessions.has(k));
  console.log('# B1NEG-MANUAL-CLOSE', JSON.stringify({ running: engine.isRunning(id), leakedSessions: leaked.length, active: diagnosticsActiveCount() }));
  assert.deepEqual(leaked, [], 'no leaked CDP session for the closed quarantined target');
  await unchanged(id, snap, row, launchId, 'after-manual-close');
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k')]), ['de-DE', 'v']);
  await assertRecovered(id, launchId, 'B1NEG-RECOVER-AFTER-CLOSE');
  // Ordinary-tab protection still armed after all of this (M3 fail-closed).
  mode = 'reject';
  void within(ctx.newPage(), 5000);
  for (let i = 0; i < 50 && engine.isRunning(id); i++) await sleep(100);
  mode = null; await sleep(300);
  assert.equal(engine.isRunning(id), false, 'ordinary tab still fail-closed');
  assert.equal(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, 'Failed to apply native browser regional locale');
});

test('injected diagnostic timeout: 3s deadline, unavailable/timeout, lifecycle untouched, next diagnostic succeeds', { timeout: 90000 }, async () => {
  assert.equal(COLLECTION_DEADLINE_MS, 3000);
  const { id, ctx, user } = await launched('b1neg-timeout');
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id), row = engine.runInfo(id);
  const before = new Set((await pageTargets(ctx)).map(t => t.targetId));
  mode = { delayMs: 4500 }; injected = 0;
  const t0 = Date.now(); const r = await post(id, launchId); const ms = Date.now() - t0;
  const env = r.json?.environment || {};
  console.log('# B1NEG-TIMEOUT', JSON.stringify({ status: r.status, ms, injected, env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.availability + ':' + v.reason])) }));
  assert.equal(r.status, 200); assert.ok(injected >= 1);
  assert.ok(ms >= 2900 && ms < 3800, 'response bound to the 3s deadline: ' + ms);
  for (const k of ['timezone', 'locale', 'languages']) {
    assert.equal(env[k].availability, 'unavailable', k);
    assert.equal(env[k].reason, 'timeout', k);
    assert.equal(env[k].value, null, k + ' carries no value (contract: unavailable value null)');
    assert.equal(env[k].source, null, k + ' carries no source');
  }
  const v = validateDiagnosticsV1(r.json, { route: 'POST' });
  assert.deepEqual(v.errors, [], 'timeout body validates against DiagnosticsV1');
  assert.equal(diagnosticsActiveCount(), 0, 'lock released at deadline');
  await unchanged(id, snap, row, launchId, 'at-deadline');
  // Let the late (post-deadline) native failure land: it must quarantine, not stop.
  await sleep(2500); mode = null;
  await unchanged(id, snap, row, launchId, 'after-late-failure');
  const q = (await pageTargets(ctx)).filter(t => !before.has(t.targetId));
  assert.equal(q.length, 1, '§7.9: timed-out diagnostic tab not auto-closed');
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k')]), ['de-DE', 'v']);
  await assertRecovered(id, launchId, 'B1NEG-RECOVER-AFTER-TIMEOUT');
  await call('POST', `/profiles/${id}/stop`);
  assert.equal(engine.isRunning(id), false, 'stop not hung');
});

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

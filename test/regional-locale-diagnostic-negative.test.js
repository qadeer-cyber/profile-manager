// B1 option (ii) negatives (t47u, addendum A1): a failed app-owned M2 diagnostic
// tab is closed by targetId before it can run script under the wrong locale, even
// with concurrent reload / typed navigation; plus an injected diagnostic timeout.
// Real Chromium + real app.
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

// mode: null | 'reject' (persistent) | { delayMs, once } (delay then reject)
let mode = null, injected = 0, conn;
const created = [], closedByApp = [], testSessions = [];
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
      if (method === 'Target.createTarget') return orig.call(this, method, params).then(r => { created.push(r.targetId); return r; });
      if (method === 'Target.closeTarget') closedByApp.push(params.targetId);
      if (mode && method === 'Emulation.setLocaleOverride') {
        injected++;
        const m = mode; if (m.once) mode = null; // per-target fault: only the next setup call
        if (m.delayMs) return sleep(m.delayMs).then(() => { throw new Error('INJECTED slow locale failure'); });
        return Promise.reject(new Error('INJECTED locale failure'));
      }
      return orig.call(this, method, params);
    };
  }
  const user = await ctx.newPage();
  await user.goto(`${origin}/user`);
  await user.evaluate(() => { sessionStorage.setItem('k', 'v'); document.cookie = 'c=1; path=/'; });
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

test('failed diagnostic tab: concurrent reload + typed navigation cannot escape before close-by-targetId; profile untouched', { timeout: 90000 }, async () => {
  const { id, ctx, user } = await launched('b1neg-user-actions');
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id), row = engine.runInfo(id);
  const cookies = await ctx.cookies();
  const sessionsBefore = new Set(conn._sessions.keys());
  const ROUNDS = Number(process.env.B1NEG_ROUNDS || 3);
  for (let round = 0; round < ROUNDS; round++) {
    const before = new Set((await pageTargets(ctx)).map(t => t.targetId));
    const createdBefore = created.length, closedBefore = closedByApp.length, beaconsBefore = beacons.length, hitsBefore = hits.length;
    // Slow failure: the target exists (paused) for ~1.2 s before setup fails,
    // giving the user-action path a real window to try to escape.
    mode = { delayMs: 1200, once: true }; injected = 0;
    const pending = post(id, launchId); pending.catch(() => {});
    let qid, actions = { reload: 0, nav: 0, evalRan: [] };
    const b = await ctx.browser().newBrowserCDPSession();
    for (let i = 0; i < 100 && !qid; i++) { qid = (await pageTargets(ctx)).map(t => t.targetId).find(t => !before.has(t)); if (!qid) await sleep(10); }
    assert.ok(qid, 'diagnostic target appeared');
    // Independent browser-level session = browser UI navigation path (typed / reload).
    const { sessionId } = await b.send('Target.attachToTarget', { targetId: qid, flatten: true });
    const bImpl = b._connection.toImpl(b)._session;
    const qs = bImpl.createChildSession(sessionId); testSessions.push(sessionId);
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && (await pageTargets(ctx)).some(t => t.targetId === qid)) {
      void within(qs.send('Page.reload', { ignoreCache: true }), 300).then(x => { if (x !== 'timeout' && !x.e) actions.reload++; });
      void within(qs.send('Page.navigate', { url: `${origin}/escape${round}`, transitionType: 'typed' }), 300).then(x => { if (x !== 'timeout' && !x.e) actions.nav++; });
      const ev = await within(qs.send('Runtime.evaluate', { expression: 'Intl.DateTimeFormat().resolvedOptions().locale', returnByValue: true }), 150);
      if (ev !== 'timeout' && !ev.e) actions.evalRan.push(ev.v?.result?.value);
      await sleep(50);
    }
    const r = await pending; mode = null;
    await sleep(800);
    const after = await pageTargets(ctx);
    const ev = { round, status: r.status, injected, env: Object.fromEntries(['timezone', 'locale', 'languages'].map(k => [k, r.json?.environment?.[k]?.availability + ':' + r.json?.environment?.[k]?.reason])),
      createdId: created.slice(createdBefore), appClosed: closedByApp.slice(closedBefore), stillOpen: after.some(t => t.targetId === qid), actions, newBeacons: beacons.slice(beaconsBefore), newHits: hits.slice(hitsBefore) };
    console.log('# B1NEG-CLOSE-ON-FAIL', JSON.stringify(ev));
    bImpl.disposeChildSession(sessionId); // the test's own probe session
    await b.detach().catch(() => {});
    assert.equal(r.status, 200); assert.ok(injected >= 1, 'fault injected');
    for (const k of ['timezone', 'locale', 'languages']) {
      assert.equal(r.json.environment[k].availability, 'unavailable', k);
      assert.equal(r.json.environment[k].reason, 'collection_failed', k);
    }
    assert.deepEqual(validateDiagnosticsV1(r.json, { route: 'POST' }).errors, []);
    // Identity: the app closed exactly the target its own Target.createTarget returned.
    assert.deepEqual(created.slice(createdBefore), [qid], 'diagnostic target identity = createTarget targetId');
    assert.deepEqual(closedByApp.slice(closedBefore), [qid], 'app closed only that targetId');
    assert.equal(ev.stillOpen, false, 'failed diagnostic tab closed');
    for (const t of before) assert.ok(after.some(x => x.targetId === t), 'pre-existing tab still open: ' + t);
    // No escape: no script ran with a non-native locale, no page beacon / page load from the diagnostic tab.
    for (const l of actions.evalRan) assert.equal(l, 'de-DE', `round ${round}: diagnostic tab executed script with ${l}`);
    assert.deepEqual(ev.newBeacons, [], 'no page script ran in failed diagnostic tab');
    assert.deepEqual(ev.newHits.filter(h => h.startsWith('/escape')), [], 'no navigation escaped before close');
    await unchanged(id, snap, row, launchId, 'round' + round);
  }
  for (const bc of beacons) assert.match(bc, /\|de-DE\|de-DE$/, 'every executed page ran with native locale: ' + bc);
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k'), document.cookie]), ['de-DE', 'v', 'c=1']);
  assert.deepEqual(await ctx.cookies(), cookies, 'cookies unchanged');
  await sleep(300);
  const leaked = [...conn._sessions.keys()].filter(k => !sessionsBefore.has(k));
  console.log('# B1NEG-LEAKS', JSON.stringify({ running: engine.isRunning(id), leakedSessions: leaked.length, leakedAreTestProbes: leaked.filter(k => testSessions.includes(k)).length, active: diagnosticsActiveCount() }));
  assert.deepEqual(leaked, [], 'no leaked CDP session');
  await unchanged(id, snap, row, launchId, 'after-rounds');
  // Subsequent diagnostic works and a successful diagnostic tab stays open (§7.9 unchanged).
  const beforeOk = new Set((await pageTargets(ctx)).map(t => t.targetId)), closedBeforeOk = closedByApp.length;
  await assertRecovered(id, launchId, 'B1NEG-RECOVER-AFTER-CLOSE');
  await sleep(500);
  const okTabs = (await pageTargets(ctx)).filter(t => !beforeOk.has(t.targetId));
  console.log('# B1NEG-SUCCESS-TAB', JSON.stringify({ newTabsOpen: okTabs.length, appClosed: closedByApp.length - closedBeforeOk }));
  assert.equal(okTabs.length, 1, 'successful diagnostic tab remains open');
  assert.equal(closedByApp.length, closedBeforeOk, 'app closed nothing on success');
  await unchanged(id, snap, row, launchId, 'after-success');
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
  mode = { delayMs: 4500, once: true }; injected = 0;
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
  // Let the late (post-deadline) native failure land: it must close only that
  // diagnostic target (addendum A1), not stop the profile.
  await sleep(2500); mode = null;
  await unchanged(id, snap, row, launchId, 'after-late-failure');
  const nowOpen = await pageTargets(ctx);
  const q = nowOpen.filter(t => !before.has(t.targetId));
  console.log('# B1NEG-TIMEOUT-LATE', JSON.stringify({ newTabsOpen: q.length, preexistingOpen: [...before].filter(t => nowOpen.some(x => x.targetId === t)).length, preexisting: before.size }));
  assert.equal(q.length, 0, 'late-failed diagnostic tab closed (A1), never released');
  for (const t of before) assert.ok((await pageTargets(ctx)).some(x => x.targetId === t), 'pre-existing tab kept');
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k')]), ['de-DE', 'v']);
  await assertRecovered(id, launchId, 'B1NEG-RECOVER-AFTER-TIMEOUT');
  await call('POST', `/profiles/${id}/stop`);
  assert.equal(engine.isRunning(id), false, 'stop not hung');
});

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

// B1(b) fault-injection regressions: M3 native locale failure on the app-owned
// M2 diagnostic target vs an ordinary tab. Real Chromium + real app; the fault is
// injected at the CDP command layer (Emulation.setLocaleOverride rejected).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-b1-'));
process.env.PM_DATA_DIR = tmp; process.env.PM_API_TOKEN = 'fixture-b1-api';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const engine = await import('../server/browsers.js');
const { diagnosticsActiveCount } = await import('../server/diagnostics.js');
const { POST_CONSENT } = await import('./diagnostics-v1-validator.mjs');
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e)));
const server = await new Promise(r => { const s = createApp({ uiToken: 'u', staticDir: null }).listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-ui-token': 'u' }, body: b && JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const site = await new Promise(r => { const s = http.createServer((q, res) => { res.setHeader('content-type', 'text/html'); res.end('<p>user</p><script>window.ran = Intl.DateTimeFormat().resolvedOptions().locale</script>'); }).listen(0, '127.0.0.1', () => r(s)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p.then(v => ({ v }), e => ({ e })), sleep(ms).then(() => 'timeout')]);
const failed = []; engine.events.on('event', e => { if (e.type === 'profile:launch-failed') failed.push(e.id); });
after(async () => { for (const id of engine.runningIds()) await engine.stop(id).catch(() => {}); server.close(); site.close(); if (db.open) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let armed = false, injected = 0;
async function launched(name) {
  const id = (await call('POST', '/profiles', { name, browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'] } })).json.id;
  assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
  // Trusted handle to the profile context, through a normal (unarmed) diagnostic page.
  const helper = await engine.diagnosticObservation(id).openDiagnosticPage({ trackSession() {}, cancelled: () => false });
  const ctx = helper.context();
  const root = await ctx.browser().newBrowserCDPSession();
  const proto = Object.getPrototypeOf(root._connection.toImpl(root)._session);
  await root.detach();
  if (!proto.__b1) {
    const orig = proto.send; proto.__b1 = true;
    proto.send = function (method, params) {
      if (armed && method === 'Emulation.setLocaleOverride') { injected++; return Promise.reject(new Error('INJECTED locale failure')); }
      return orig.call(this, method, params);
    };
  }
  const user = await ctx.newPage();
  await user.goto(`http://127.0.0.1:${site.address().port}/`);
  await user.evaluate(() => { sessionStorage.setItem('k', 'v'); });
  return { id, ctx, user };
}
const launchIdOf = async id => (await call('GET', `/profiles/${id}/diagnostics`)).json.observation.launchId;
const post = (id, launchId) => call('POST', `/profiles/${id}/diagnostics/environment`, { expectedLaunchId: launchId, consent: POST_CONSENT });
const envSummary = j => Object.fromEntries(Object.entries(j?.environment || {}).map(([k, v]) => [k, v.availability + ':' + (v.availability === 'available' ? JSON.stringify(v.value) : v.reason)]));

test('diagnostic-target locale failure: profile survives, nothing mutated, tab kept paused, no lock', { timeout: 60000 }, async () => {
  const { id, ctx, user } = await launched('b1-diag');
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id), row = engine.runInfo(id);
  const probe = await ctx.browser().newBrowserCDPSession();
  const targetsBefore = new Set((await probe.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').map(t => t.targetId));
  await probe.detach();
  armed = true; injected = 0;
  const t0 = Date.now(); const r = await post(id, launchId); const ms = Date.now() - t0;
  armed = false;
  console.log('# B1-DIAG-FAIL', JSON.stringify({ status: r.status, ms, injected, env: envSummary(r.json) }));
  assert.equal(r.status, 200); assert.ok(injected >= 1, 'fault actually injected');
  assert.ok(ms < 3000, 'within 3s deadline: ' + ms);
  for (const k of ['timezone', 'locale', 'languages']) {
    assert.equal(r.json.environment[k].availability, 'unavailable');
    assert.ok(['collection_failed', 'timeout'].includes(r.json.environment[k].reason), k + ':' + r.json.environment[k].reason);
  }
  await sleep(2500);
  assert.equal(engine.isRunning(id), true, 'profile not terminated');
  assert.deepEqual(engine.lifecycleSmokeSnapshot(id), snap, 'lifecycle/last_error/running row/launch identity unchanged');
  assert.deepEqual(engine.runInfo(id), row);
  assert.equal(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, null);
  assert.deepEqual(failed.filter(x => x === id), []);
  assert.equal(await launchIdOf(id), launchId);
  // User tab and its storage preserved, still on the native locale.
  assert.equal(user.isClosed(), false);
  assert.deepEqual(await user.evaluate(() => [Intl.DateTimeFormat().resolvedOptions().locale, sessionStorage.getItem('k')]), ['de-DE', 'v']);
  // §7.9: the failed diagnostic tab is not closed automatically; it stays paused (cannot run scripts).
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const pageTargets = targetInfos.filter(t => t.type === 'page');
  assert.equal(pageTargets.length, targetsBefore.size + 1, 'diagnostic tab kept open');
  const quarantined = pageTargets.filter(t => !targetsBefore.has(t.targetId));
  assert.equal(quarantined.length, 1, 'exactly one quarantined diagnostic target');
  const qpage = ctx.pages().find(p => p._connection.toImpl(p).delegate._targetId === quarantined[0].targetId);
  assert.ok(qpage, 'quarantined tab still present in the profile');
  const qs = await ctx.newCDPSession(qpage);
  const nav = await within(qpage.goto(`http://127.0.0.1:${site.address().port}/q`, { timeout: 2000 }), 2500);
  const ran = await within(qs.send('Runtime.evaluate', { expression: 'window.ran', returnByValue: true }), 1500);
  assert.equal(qpage.isClosed(), false, '§7.9: not auto-closed');
  assert.notEqual(nav, 'timeout'); assert.ok(nav.e, 'navigation in quarantined tab must not complete');
  assert.equal(ran, 'timeout', 'no page script ran in the quarantined tab');
  console.log('# B1-QUARANTINE', JSON.stringify({ closed: qpage.isClosed(), nav: nav === 'timeout' ? 'timeout' : nav.e ? 'error:' + nav.e.message.split('\n')[0] : 'loaded', ran: ran === 'timeout' ? 'timeout' : ran.v?.result?.value ?? null }));
  await within(qs.detach(), 1000);
  await cdp.detach();
  assert.equal(diagnosticsActiveCount?.(id) ?? 0, 0, 'no permanent diagnostic lock');
  // Normal diagnostic observation still correct afterwards (no stuck lock, correct facts).
  const ok = await post(id, launchId);
  console.log('# B1-DIAG-RECOVER', JSON.stringify({ status: ok.status, env: envSummary(ok.json) }));
  assert.equal(ok.json.environment.locale.availability, 'available');
  assert.equal(ok.json.environment.locale.value, 'de-DE');
  assert.deepEqual(ok.json.environment.languages.value, ['de-DE', 'en-US']);
  assert.equal(engine.isRunning(id), true);
  await call('POST', `/profiles/${id}/stop`);
  assert.equal(engine.isRunning(id), false, 'stop not hung by quarantined target');
});

test('ordinary-tab locale failure: M3 fail-closed unchanged (profile stopped + last_error)', { timeout: 60000 }, async () => {
  const { id, ctx } = await launched('b1-ordinary');
  armed = true; injected = 0;
  void within(ctx.newPage(), 5000);
  for (let i = 0; i < 50 && engine.isRunning(id); i++) await sleep(100);
  armed = false; await sleep(500);
  const le = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
  console.log('# B1-ORDINARY-FAIL', JSON.stringify({ injected, running: engine.isRunning(id), last_error: le, launchFailedEvent: failed.includes(id) }));
  assert.ok(injected >= 1); assert.equal(engine.isRunning(id), false);
  assert.equal(le, 'Failed to apply native browser regional locale');
  assert.ok(failed.includes(id));
});

test('concurrent diagnostic + ordinary-tab failure: no bypass, fail-closed wins', { timeout: 60000 }, async () => {
  const { id, ctx } = await launched('b1-race');
  const launchId = await launchIdOf(id);
  armed = true; injected = 0;
  const [r] = await Promise.all([post(id, launchId), within(ctx.newPage(), 5000)]);
  for (let i = 0; i < 50 && engine.isRunning(id); i++) await sleep(100);
  armed = false; await sleep(500);
  const le = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
  console.log('# B1-RACE', JSON.stringify({ injected, status: r.status, env: envSummary(r.json), running: engine.isRunning(id), last_error: le }));
  assert.equal(engine.isRunning(id), false);
  assert.equal(le, 'Failed to apply native browser regional locale');
  for (const k of ['timezone', 'locale', 'languages']) assert.equal(r.json.environment[k].availability, 'unavailable');
});

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

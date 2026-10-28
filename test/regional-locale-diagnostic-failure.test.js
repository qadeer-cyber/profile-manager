// B1(b) fault-injection regressions: M3 native locale failure on the app-owned
// M2 diagnostic target vs an ordinary tab. Real Chromium + real app; the fault is
// injected at the CDP command layer (Emulation.setLocaleOverride rejected).
import { test, after } from 'node:test';
import * as cryptoMod from 'node:crypto'; const require_crypto = () => cryptoMod;
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

// armed = number of next setLocaleOverride calls to fail (Infinity = persistent fault).
let armed = 0, injected = 0;
const created = [], closedByApp = [];
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
      if (method === 'Target.createTarget') return orig.call(this, method, params).then(r => { created.push(r.targetId); return r; });
      if (method === 'Target.closeTarget') closedByApp.push(params.targetId);
      if (armed && method === 'Emulation.setLocaleOverride') { injected++; if (armed !== Infinity) armed--; return Promise.reject(new Error('INJECTED locale failure')); }
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

test('diagnostic-target locale failure: profile survives, nothing mutated, only that tab closed by targetId, no lock', { timeout: 60000 }, async () => {
  const { id, ctx, user } = await launched('b1-diag');
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id), row = engine.runInfo(id);
  const probe = await ctx.browser().newBrowserCDPSession();
  const targetsBefore = new Set((await probe.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').map(t => t.targetId));
  await probe.detach();
  armed = 1; injected = 0;
  const createdBefore = created.length, closedBefore = closedByApp.length;
  const t0 = Date.now(); const r = await post(id, launchId); const ms = Date.now() - t0;
  armed = 0;
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
  // Addendum A1: the failed diagnostic tab is closed by its own createTarget targetId; nothing else is closed.
  const cdp = await ctx.browser().newBrowserCDPSession();
  const pageTargets = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
  await cdp.detach();
  const diagIds = created.slice(createdBefore);
  console.log('# B1-CLOSE-ON-FAIL', JSON.stringify({ created: diagIds, appClosed: closedByApp.slice(closedBefore), openNow: pageTargets.length, openBefore: targetsBefore.size }));
  assert.equal(diagIds.length, 1, 'one app-owned diagnostic target created');
  assert.deepEqual(closedByApp.slice(closedBefore), diagIds, 'app closed exactly that targetId');
  assert.equal(pageTargets.some(t => t.targetId === diagIds[0]), false, 'failed diagnostic tab closed');
  assert.deepEqual(new Set(pageTargets.map(t => t.targetId)), targetsBefore, 'every pre-existing tab still open');
  assert.equal(diagnosticsActiveCount?.(id) ?? 0, 0, 'no permanent diagnostic lock');
  // Normal diagnostic observation still correct afterwards (no stuck lock, correct facts).
  const ok = await post(id, launchId);
  console.log('# B1-DIAG-RECOVER', JSON.stringify({ status: ok.status, env: envSummary(ok.json) }));
  assert.equal(ok.json.environment.locale.availability, 'available');
  assert.equal(ok.json.environment.locale.value, 'de-DE');
  assert.deepEqual(ok.json.environment.languages.value, ['de-DE', 'en-US']);
  assert.equal(engine.isRunning(id), true);
  await call('POST', `/profiles/${id}/stop`);
  assert.equal(engine.isRunning(id), false, 'stop not hung');
});

test('ordinary-tab locale failure: M3 fail-closed unchanged (profile stopped + last_error)', { timeout: 60000 }, async () => {
  const { id, ctx } = await launched('b1-ordinary');
  armed = 1; injected = 0;
  void within(ctx.newPage(), 5000);
  for (let i = 0; i < 50 && engine.isRunning(id); i++) await sleep(100);
  armed = 0; await sleep(500);
  const le = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
  console.log('# B1-ORDINARY-FAIL', JSON.stringify({ injected, running: engine.isRunning(id), last_error: le, launchFailedEvent: failed.includes(id) }));
  assert.ok(injected >= 1); assert.equal(engine.isRunning(id), false);
  assert.equal(le, 'Failed to apply native browser regional locale');
  assert.ok(failed.includes(id));
});

test('concurrent diagnostic + ordinary-tab failure: no bypass, fail-closed wins', { timeout: 60000 }, async () => {
  const { id, ctx } = await launched('b1-race');
  const launchId = await launchIdOf(id);
  armed = Infinity; injected = 0;
  const [r] = await Promise.all([post(id, launchId), within(ctx.newPage(), 5000)]);
  for (let i = 0; i < 50 && engine.isRunning(id); i++) await sleep(100);
  armed = 0; await sleep(500);
  const le = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
  console.log('# B1-RACE', JSON.stringify({ injected, status: r.status, env: envSummary(r.json), running: engine.isRunning(id), last_error: le }));
  assert.equal(engine.isRunning(id), false);
  assert.equal(le, 'Failed to apply native browser regional locale');
  for (const k of ['timezone', 'locale', 'languages']) assert.equal(r.json.environment[k].availability, 'unavailable');
});

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

test('addendum A1: hash recorded, base contract hashes unchanged, UI note matches addendum text', () => {
  const crypto = require_crypto();
  const dir = new URL('../docs/handoff/m2/contracts/', import.meta.url);
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(new URL(f, dir))).digest('hex');
  assert.equal(sha('DiagnosticsV1.original.md'), 'cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8');
  assert.equal(sha('DiagnosticsV1.process-command-line.md'), 'e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4');
  const sums = fs.readFileSync(new URL('SHA256SUMS.addendum-A1', dir), 'utf8').trim().split(/\s+/);
  assert.equal(sha(sums[1]), sums[0], 'addendum A1 hash');
  const addendum = fs.readFileSync(new URL(sums[1], dir), 'utf8');
  const ui = fs.readFileSync(new URL('../web/src/components/ProfileDiagnostics.jsx', import.meta.url), 'utf8');
  const note = ui.match(/LOCALE_FAILURE_CLOSE_NOTE = '((?:\\.|[^'])*)'/)[1].replace(/\\'/g, "'");
  assert.ok(addendum.includes('"' + note + '"'), 'UI note equals addendum text');
});

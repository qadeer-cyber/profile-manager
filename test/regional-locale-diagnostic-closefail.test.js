// t48u B1 closeTarget-failure coverage (addendum A1 + M3 fail-closed). Real
// Chromium + real app. After a diagnostic-tab native-locale failure the app's own
// Target.closeTarget(targetId) is made to fail at the CDP command layer:
//   reject  - closeTarget throws while the target is still attached
//   false   - closeTarget resolves { success: false }
//   hang    - closeTarget never answers (closure can never be confirmed)
// In every mode the failed tab must never run script/navigate under the wrong
// locale, and the profile must fall through to M3 fail-closed (stopped +
// last_error), with no stuck diagnostic lock, CDP leak or unhandled rejection.
// No product code is stubbed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-b1close-'));
process.env.PM_DATA_DIR = tmp; process.env.PM_API_TOKEN = 'fixture-b1close-api';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const engine = await import('../server/browsers.js');
const { diagnosticsActiveCount } = await import('../server/diagnostics.js');
const { POST_CONSENT, validateDiagnosticsV1 } = await import('./diagnostics-v1-validator.mjs');
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e)));
const server = await new Promise(r => { const s = createApp({ uiToken: 'u', staticDir: null }).listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-ui-token': 'u' }, body: b && JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; };
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
const locks = () => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === '.pm-lock') out.push(p); } }; walk(tmp); return out; };
after(async () => { for (const id of engine.runningIds()) await engine.stop(id).catch(() => {}); server.close(); site.close(); if (db.open) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let localeFault = null, closeFault = null, injected = 0, closeInjected = 0;
const created = [], closeCalls = [];
async function launched(name) {
  const id = (await call('POST', '/profiles', { name, browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'] } })).json.id;
  assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
  const helper = await engine.diagnosticObservation(id).openDiagnosticPage({ trackSession() {}, cancelled: () => false });
  const ctx = helper.context();
  const root = await ctx.browser().newBrowserCDPSession();
  const impl = root._connection.toImpl(root)._session;
  const conn = impl._connection;
  const proto = Object.getPrototypeOf(impl);
  await root.detach();
  if (!proto.__b1close) {
    const orig = proto.send; proto.__b1close = true;
    proto.send = function (method, params) {
      if (method === 'Target.createTarget') return orig.call(this, method, params).then(r => { created.push(r.targetId); return r; });
      if (method === 'Target.closeTarget') {
        closeCalls.push(params.targetId);
        // Fault only the app's close of its own created diagnostic target.
        if (closeFault && created.includes(params.targetId)) {
          closeInjected++;
          if (closeFault === 'reject') return Promise.reject(new Error('INJECTED closeTarget failure'));
          if (closeFault === 'false') return Promise.resolve({ success: false });
          if (closeFault === 'hang') return new Promise(() => {});
        }
      }
      if (localeFault && method === 'Emulation.setLocaleOverride') {
        injected++; const m = localeFault; localeFault = null; // per-target fault: only the next setup call
        return sleep(m.delayMs).then(() => { throw new Error('INJECTED slow locale failure'); });
      }
      return orig.call(this, method, params);
    };
  }
  const user = await ctx.newPage();
  await user.goto(`${origin}/user`);
  return { id, ctx, conn };
}
const launchIdOf = async id => (await call('GET', `/profiles/${id}/diagnostics`)).json.observation.launchId;
const post = (id, launchId) => call('POST', `/profiles/${id}/diagnostics/environment`, { expectedLaunchId: launchId, consent: POST_CONSENT });
const pageTargets = async ctx => { const s = await ctx.browser().newBrowserCDPSession(); try { return (await s.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page'); } finally { await s.detach().catch(() => {}); } };

for (const mode of ['reject', 'false', 'hang']) {
  test(`closeTarget ${mode}: failed diagnostic tab never released; M3 fail-closed; no escape/leak/lock`, { timeout: 90000 }, async () => {
    const { id, ctx } = await launched('b1close-' + mode);
    const launchId = await launchIdOf(id);
    const pid = engine.lifecycleSmokeSnapshot(id).browserPid;
    const before = new Set((await pageTargets(ctx)).map(t => t.targetId));
    const createdBefore = created.length, closeBefore = closeCalls.length, beaconsBefore = beacons.length, hitsBefore = hits.length;
    localeFault = { delayMs: 1200 }; closeFault = mode; injected = 0; closeInjected = 0;
    const t0 = Date.now();
    let ms = null;
    const pending = post(id, launchId).then(x => { ms = Date.now() - t0; return x; }); pending.catch(() => {});
    let qid; const actions = { reload: 0, nav: 0, evalRan: [] };
    const b = await ctx.browser().newBrowserCDPSession();
    for (let i = 0; i < 100 && !qid; i++) { qid = (await pageTargets(ctx).catch(() => [])).map(t => t.targetId).find(t => !before.has(t)); if (!qid) await sleep(10); }
    assert.ok(qid, 'diagnostic target appeared');
    // Independent browser-level session = browser UI reload / typed-navigation path.
    const { sessionId } = await b.send('Target.attachToTarget', { targetId: qid, flatten: true });
    const qs = b._connection.toImpl(b)._session.createChildSession(sessionId);
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && engine.isRunning(id)) {
      void within(qs.send('Page.reload', { ignoreCache: true }), 300).then(x => { if (x !== 'timeout' && !x.e) actions.reload++; });
      void within(qs.send('Page.navigate', { url: `${origin}/escape-${mode}`, transitionType: 'typed' }), 300).then(x => { if (x !== 'timeout' && !x.e) actions.nav++; });
      const ev = await within(qs.send('Runtime.evaluate', { expression: 'Intl.DateTimeFormat().resolvedOptions().locale', returnByValue: true }), 150);
      if (ev !== 'timeout' && !ev.e) actions.evalRan.push(ev.v?.result?.value);
      await sleep(50);
    }
    const r = await pending;
    localeFault = null;
    for (let i = 0; i < 60 && engine.isRunning(id); i++) await sleep(100);
    closeFault = null; await sleep(500);
    const le = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error;
    const alive = (() => { try { process.kill(pid, 0); return true; } catch { return false; } })();
    const ev = { mode, status: r.status, ms, injected, closeInjected, env: Object.fromEntries(['timezone', 'locale', 'languages'].map(k => [k, r.json?.environment?.[k]?.availability + ':' + r.json?.environment?.[k]?.reason])),
      createdId: created.slice(createdBefore), closeCalls: closeCalls.slice(closeBefore), running: engine.isRunning(id), last_error: le, launchFailed: failed.includes(id), browserAlive: alive,
      runningRow: engine.lifecycleSmokeSnapshot(id).runningRow, locks: locks().length, active: diagnosticsActiveCount(), actions, newBeacons: beacons.slice(beaconsBefore), escapeHits: hits.slice(hitsBefore).filter(h => h.startsWith('/escape')) };
    console.log('# B1-CLOSEFAIL', JSON.stringify(ev));
    assert.ok(injected >= 1, 'locale fault injected'); assert.equal(closeInjected, 1, 'closeTarget fault injected exactly once');
    assert.deepEqual(created.slice(createdBefore), [qid], 'diagnostic identity = createTarget targetId');
    assert.ok(ev.closeCalls.includes(qid), 'app attempted close of its own targetId');
    // Response: no facts from the misconfigured tab.
    assert.equal(r.status, 200);
    assert.deepEqual(validateDiagnosticsV1(r.json, { route: 'POST' }).errors, []);
    for (const k of ['timezone', 'locale', 'languages']) {
      assert.equal(r.json.environment[k].availability, 'unavailable', k);
      assert.ok(['collection_failed', 'timeout', 'browser_disconnected', 'launch_changed', 'probe_closed'].includes(r.json.environment[k].reason), k + ':' + r.json.environment[k].reason);
      assert.equal(r.json.environment[k].value, null, k);
    }
    assert.ok(ms < 3800, 'response bound to the diagnostics deadline: ' + ms);
    // M3 fail-closed: unconfirmed close stops the whole profile and records last_error.
    assert.equal(engine.isRunning(id), false, 'profile stopped (fail-closed)');
    assert.equal(le, 'Failed to apply native browser regional locale');
    assert.ok(failed.includes(id), 'profile:launch-failed emitted');
    assert.equal(alive, false, 'browser process gone');
    assert.equal(ev.runningRow, null, 'no running row'); assert.deepEqual(locks(), [], 'no .pm-lock');
    // No escape: no script / page load in the misconfigured tab.
    for (const l of actions.evalRan) assert.equal(l, 'de-DE', `${mode}: diagnostic tab executed script with ${l}`);
    assert.deepEqual(ev.newBeacons, [], 'no page script ran in failed diagnostic tab');
    assert.deepEqual(ev.escapeHits, [], 'no navigation escaped');
    // No stuck diagnostic lock; relaunch + diagnostic works.
    assert.equal(diagnosticsActiveCount(), 0, 'no diagnostic lock held');
    assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
    const fresh = await launchIdOf(id);
    const ok = await post(id, fresh);
    assert.equal(ok.status, 200); assert.equal(ok.json.environment.locale.value, 'de-DE');
    assert.equal(diagnosticsActiveCount(), 0);
    assert.equal((await call('POST', `/profiles/${id}/stop`)).status, 200);
    assert.equal(engine.isRunning(id), false, 'stop not hung');
    assert.deepEqual(locks(), []);
  });
}

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

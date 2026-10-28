// t46u Phase 3: genuine missing M2 source/merge-gate assertions (real Chromium,
// real app, disposable PM_DATA_DIR). Faults only at the CDP command layer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gate-'));
process.env.PM_DATA_DIR = tmp; process.env.PM_API_TOKEN = 'fixture-gate-api';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const engine = await import('../server/browsers.js');
const { diagnosticsActiveCount } = await import('../server/diagnostics.js');
const { POST_CONSENT, validateDiagnosticsV1, validateDiagnosticsErrorBody, assertCacheControlNoStore } = await import('./diagnostics-v1-validator.mjs');
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e)));
const server = await new Promise(r => { const s = createApp({ uiToken: 'u', staticDir: null }).listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-ui-token': 'u' }, body: b && JSON.stringify(b) }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
after(async () => { for (const id of engine.runningIds()) await engine.stop(id).catch(() => {}); server.close(); if (db.open) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let delay = 0, conn;
async function launch(name, regional) {
  const id = (await call('POST', '/profiles', regional ? { name, browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'] } } : { name })).json.id;
  assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
  return id;
}
async function arm(id) {
  const helper = await engine.diagnosticObservation(id).openDiagnosticPage({ trackSession() {}, cancelled: () => false });
  const ctx = helper.context();
  const root = await ctx.browser().newBrowserCDPSession();
  const impl = root._connection.toImpl(root)._session; conn = impl._connection;
  const proto = Object.getPrototypeOf(impl); await root.detach();
  if (!proto.__gate) {
    const orig = proto.send; proto.__gate = true;
    proto.send = function (method, params) {
      if (delay && method === 'Emulation.setLocaleOverride') { const d = delay; return sleep(d).then(() => orig.call(this, method, params)); }
      return orig.call(this, method, params);
    };
  }
  return ctx;
}
const launchIdOf = async id => (await call('GET', `/profiles/${id}/diagnostics`)).json.observation.launchId;
const post = (id, launchId) => call('POST', `/profiles/${id}/diagnostics/environment`, { expectedLaunchId: launchId, consent: POST_CONSENT });
const pages = async ctx => { const s = await ctx.browser().newBrowserCDPSession(); try { return (await s.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page'); } finally { await s.detach(); } };
const okErr = (r, status, code) => { assert.equal(r.status, status); assert.equal(assertCacheControlNoStore(r.headers).ok, true); const v = validateDiagnosticsErrorBody(r.json); assert.equal(v.ok, true, v.errors?.join('\n')); assert.equal(r.json.error.code, code); };
const locks = () => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === '.pm-lock') out.push(p); } }; walk(tmp); return out; };

test('§8 429 DIAGNOSTICS_BUSY on overlap; other profile unaffected; slot released', { timeout: 90000 }, async () => {
  const a = await launch('gate-busy-a', true), b = await launch('gate-busy-b', false);
  await arm(a);
  const la = await launchIdOf(a), lb = await launchIdOf(b);
  delay = 1500;
  const first = post(a, la);
  await sleep(300);
  const second = await post(a, la);
  const otherGet = await call('GET', `/profiles/${b}/diagnostics`);
  delay = 0;
  const other = await post(b, lb);
  const r1 = await first;
  console.log('# GATE-429', JSON.stringify({ second: second.status, code: second.json?.error?.code, other: other.status, otherGet: otherGet.status, first: r1.status, firstLocale: r1.json?.environment?.locale }));
  okErr(second, 429, 'DIAGNOSTICS_BUSY');
  assert.equal(otherGet.status, 200); assert.equal(other.status, 200);
  assert.equal(validateDiagnosticsV1(other.json, { route: 'POST' }).errors.length, 0);
  assert.equal(r1.status, 200);
  assert.equal(diagnosticsActiveCount(), 0, 'slot released');
  const again = await post(a, la);
  assert.equal(again.status, 200); assert.equal(again.json.environment.locale.value, 'de-DE');
  await call('POST', `/profiles/${a}/stop`); await call('POST', `/profiles/${b}/stop`);
});

test('§7.9 tab stays open after success; case 2 closing user tab keeps Running; §8 no CDP session growth over cycles; case 4 stop', { timeout: 120000 }, async () => {
  const id = await launch('gate-lifecycle', true);
  const ctx = await arm(id);
  const launchId = await launchIdOf(id);
  const snap = engine.lifecycleSmokeSnapshot(id);
  const user = await ctx.newPage(); await user.goto('data:text/html,<p>user</p>');
  const before = (await pages(ctx)).length;
  const r = await post(id, launchId);
  assert.equal(r.status, 200); assert.equal(r.json.environment.locale.value, 'de-DE');
  await sleep(1000);
  assert.equal((await pages(ctx)).length, before + 1, '§7.9 probe tab not auto-closed after a successful response');
  // case 2: close the user tab (probe tab remains) -> still Running, same PID, last_error unchanged.
  await user.close();
  await sleep(1000);
  const after2 = engine.lifecycleSmokeSnapshot(id);
  assert.equal(engine.isRunning(id), true);
  assert.equal(after2.browserPid, snap.browserPid); assert.equal(after2.launchId, snap.launchId); assert.equal(after2.last_error, null);
  // §8 cleanup: N GET/POST cycles leave no growth in CDP sessions beyond the kept-open tabs.
  const s0 = conn._sessions.size, p0 = (await pages(ctx)).length;
  const N = 5;
  for (let i = 0; i < N; i++) { assert.equal((await call('GET', `/profiles/${id}/diagnostics`)).status, 200); assert.equal((await post(id, launchId)).status, 200); }
  await sleep(1000);
  const s1 = conn._sessions.size, p1 = (await pages(ctx)).length;
  console.log('# GATE-CLEANUP', JSON.stringify({ sessionsBefore: s0, sessionsAfter: s1, pagesBefore: p0, pagesAfter: p1, active: diagnosticsActiveCount() }));
  assert.equal(p1, p0 + N, 'one kept-open tab per POST');
  // Each kept-open tab legitimately holds Playwright page + regional child sessions; anything beyond 3/tab is a leak.
  assert.ok(s1 - s0 <= 3 * N, `CDP sessions grew by ${s1 - s0} for ${N} tabs`);
  assert.equal(diagnosticsActiveCount(), 0);
  // case 4: app Stop terminates the whole profile including the diagnostic tabs.
  const pid = engine.lifecycleSmokeSnapshot(id).browserPid;
  assert.equal((await call('POST', `/profiles/${id}/stop`)).status, 200);
  await sleep(500);
  const end = engine.lifecycleSmokeSnapshot(id);
  console.log('# GATE-STOP', JSON.stringify({ running: engine.isRunning(id), runningRow: end.runningRow, locks: locks().length, alive: (() => { try { process.kill(pid, 0); return true; } catch { return false; } })() }));
  assert.equal(engine.isRunning(id), false); assert.equal(end.runningRow, null); assert.deepEqual(locks(), []);
  assert.throws(() => process.kill(pid, 0), 'browser process gone');
  assert.equal(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, null);
});

test('§10 no debugging TCP port during GET/POST (Linux /proc + ss evidence)', { timeout: 60000, skip: process.platform !== 'linux' && 'Linux-only process evidence; Windows equivalent is a release-gate item' }, async () => {
  const id = await launch('gate-no-tcp', false);
  const launchId = await launchIdOf(id);
  assert.equal((await call('GET', `/profiles/${id}/diagnostics`)).status, 200);
  const inflight = post(id, launchId);
  const pid = engine.lifecycleSmokeSnapshot(id).browserPid;
  // §10: no remote-debugging TCP port on the browser process during GET/POST.
  const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  assert.equal(cmd.some(a => /^--remote-debugging-port/.test(a)), false, 'no --remote-debugging-port');
  assert.ok(cmd.includes('--remote-debugging-pipe'), 'pipe transport');
  const pids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).concat(String(pid));
  const ss = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' });
  const owned = ss.split('\n').filter(l => pids.some(p => l.includes(`pid=${p},`)));
  console.log('# GATE-NO-TCP', JSON.stringify({ pid, listeners: owned }));
  assert.deepEqual(owned, [], 'browser process tree listens on no TCP port');
  assert.equal((await inflight).status, 200);
  await call('POST', `/profiles/${id}/stop`);
});

test('case 6 / §8: relaunch -> new launchId, environment unavailable until new POST; old expectedLaunchId -> 409', { timeout: 90000 }, async () => {
  const id = await launch('gate-relaunch', false);
  const old = await launchIdOf(id);
  assert.equal((await post(id, old)).status, 200);
  await call('POST', `/profiles/${id}/stop`);
  assert.equal((await call('POST', `/profiles/${id}/launch`, { headless: false })).status, 200);
  const g = await call('GET', `/profiles/${id}/diagnostics`);
  const fresh = g.json.observation.launchId;
  console.log('# GATE-RELAUNCH', JSON.stringify({ old, fresh, envLocale: g.json.environment?.locale?.availability, envReason: g.json.environment?.locale?.reason }));
  assert.notEqual(fresh, old);
  assert.equal(validateDiagnosticsV1(g.json, { route: 'GET' }).errors.length, 0);
  for (const k of ['timezone', 'locale', 'languages']) assert.equal(g.json.environment[k].availability, 'unavailable', 'GET never carries a prior launch environment: ' + k);
  okErr(await post(id, old), 409, 'LAUNCH_CHANGED');
  assert.equal(diagnosticsActiveCount(), 0);
  const ok = await post(id, fresh);
  assert.equal(ok.status, 200); assert.equal(ok.json.observation.launchId, fresh);
  await call('POST', `/profiles/${id}/stop`);
});

test('no unhandled rejections', () => { assert.deepEqual(unhandled, []); });

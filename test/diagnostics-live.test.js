// Level 2 evidence only when this test actually launches the exact pinned browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { validateDiagnosticsV1 } from './diagnostics-v1-validator.mjs';
const backend = fs.existsSync(new URL('../server/diagnostics.js', import.meta.url));
const executable = chromium.executablePath();
const supported = ['linux', 'win32'].includes(process.platform);
const skip = !backend ? 'Assemble backend + UI + QA first' : !supported ? 'Real Windows/Linux process evidence requires a supported host' : !fs.existsSync(executable) ? 'Pinned Chromium executable absent' : false;

if (process.env.PM_DIAG_REQUIRE_LIVE === '1' && skip) throw new Error(String(skip));

test('real Chromium 156: OS process identity, foreground probe, cancellation and launch invalidation', { skip, timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m2-live-'));
  process.env.PM_DATA_DIR = tmp;
  process.env.PM_API_TOKEN = 'fixture-live-api';
  const { db } = await import('../server/db.js');
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
    db.close(); fs.rmSync(tmp, { recursive: true, force: true });
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

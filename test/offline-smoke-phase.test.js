// Offline smoke phase dispatch. No Electron: the handlers run against fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import {
  SMOKE_PHASES, selectSmokePhase, classifyLaunch, writeSmokeRejection, dispatchSmokePhase, phaseHandlers,
  runCleanPhase, runUpgradePhase, runLifecyclePhase, runSeedPhase, runCheckPhase, commonSmokeFacts,
  portsFromNetstat, portsFromProcNet,
} from '../electron/smoke-phases.js';

const noop = async () => {};
const base = (over = {}) => ({
  call: async () => ({ s: 200, d: {} }),
  sleep: noop,
  log: () => {},
  fs, path, http,
  listen: (server, port = 0) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  }),
  userData: '',
  dataDir: '',
  env: { PM_SMOKE_TLS_PORT: '9' },
  win: null,
  nativeModulePath: () => '/app.asar.unpacked/better_sqlite3.node',
  processCommandLine: async () => 'C:\\Program Files\\resources\\browsers\\chromium-1\\chrome.exe',
  manifest: { revision: '1248' },
  execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Profile Manager\\Profile Manager.exe',
  taskkill: noop,
  closeLastWindow: async () => ({ method: 'last-window' }),
  readExitType: async () => 'Normal',
  listeningPorts: async () => [],
  proxyPassword: async () => 'enc:v1:test',
  decrypt: async () => 'alpha-secret',
  backendUrl: 'http://127.0.0.1:1',
  ...over,
});

test('selectSmokePhase accepts only the five phases and rejects everything else', () => {
  for (const phase of SMOKE_PHASES) assert.equal(selectSmokePhase(phase), phase);
  for (const bad of [undefined, null, '', 'seeded', 'CHECK', 'clean ', 0]) {
    assert.throws(() => selectSmokePhase(bad), /PM_SMOKE_PHASE must be one of clean, upgrade, seed, check, lifecycle/);
  }
});

test('each phase dispatches to its own handler and keeps that handler result', async () => {
  for (const phase of SMOKE_PHASES) {
    const seen = [];
    const handlers = Object.fromEntries(SMOKE_PHASES.map(name => [name, async () => {
      seen.push(name);
      return { [name]: { ok: true } };
    }]));
    const out = await dispatchSmokePhase(phase, handlers);
    assert.deepEqual(seen, [phase]);
    assert.equal(out.phase, phase);
    assert.deepEqual(out[phase], { ok: true });
  }
  await assert.rejects(() => dispatchSmokePhase(undefined, {}), /got \(missing\)/);
  await assert.rejects(() => dispatchSmokePhase('nope', {}), /got "nope"/);
});

test('clean returns the diagnostics shape the install acceptance reads', async () => {
  const backup = path.join(os.tmpdir(), 'profiles.db.stamp.bak');
  const out = await runCleanPhase(base({
    userData: 'C:\\Users\\me\\AppData\\Roaming\\profile-manager',
    call: async () => ({ s: 200, d: {
      app: { version: '0.5.0-alpha.3' }, schemaVersion: 7,
      migration: { from: 0, backup }, dataDir: 'C:\\Users\\me\\AppData\\Roaming\\profile-manager\\data',
    } }),
  }));
  assert.equal(out.clean.version, '0.5.0-alpha.3');
  assert.equal(out.clean.schemaVersion, 7);
  assert.equal(out.clean.from, 0);
  assert.equal(out.clean.backup, backup);
  assert.equal(out.clean.userData.endsWith('profile-manager'), true);
  assert.equal(out.clean.dataDir.endsWith(`${path.sep}data`) || out.clean.dataDir.endsWith('\\data'), true);
});

test('upgrade returns the acceptance shape and detaches the dead proxy before the local read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-upgrade-phase-'));
  const backup = path.join(dir, 'profiles.db.stamp.bak');
  fs.writeFileSync(backup, 'bak');
  fs.writeFileSync(path.join(dir, 'upgrade-expect.json'), JSON.stringify({
    id: 'leg', name: 'Legacy', proxyName: 'LegacyProxy', password: 'alpha-secret', port: 0,
  }));
  const calls = [];
  const out = await runUpgradePhase(base({
    dataDir: dir,
    call: async (m, u, b) => {
      calls.push({ m, u, b });
      if (u === '/api/diagnostics') return { s: 200, d: { app: { version: '0.5.0-alpha.3' }, schemaVersion: 7, migration: { from: 6, backup }, dataDir: dir } };
      if (u === '/api/profiles' && m === 'GET') return { s: 200, d: [{ id: 'leg', name: 'Legacy', secretError: null, proxy: { name: 'LegacyProxy', hasPassword: true } }] };
      if (u === '/api/proxies') return { s: 200, d: [{ name: 'LegacyProxy' }] };
      if (u.endsWith('/launch')) return { s: 200, d: { running: true } };
      return { s: 200, d: {} };
    },
  }));
  const detach = calls.findIndex(c => c.u === '/api/profiles/leg/proxy' && c.b?.proxyId === null);
  const launch = calls.findIndex(c => c.u === '/api/profiles/leg/launch');
  assert.ok(detach >= 0 && launch > detach, 'the unreachable proxy is removed before the cookie page is opened');
  assert.equal(out.upgrade.from, 6);
  assert.equal(out.upgrade.schemaVersion > 6, true);
  assert.equal(out.upgrade.backupExists, true);
  assert.equal(out.upgrade.name, 'Legacy');
  assert.equal(out.upgrade.proxy, true);
  assert.equal(out.upgrade.secretError, null);
  assert.equal(out.upgrade.hasPassword, true);
  assert.equal(out.upgrade.decrypted, true);
  assert.ok('read' in out.upgrade && 'launch' in out.upgrade);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lifecycle asks for CDP, closes that endpoint, and returns Stopped then Error then running', async () => {
  let stage = 'new';
  const calls = [];
  const closed = [];
  const diagnosticLogs = [];
  const out = await runLifecyclePhase(base({
    call: async (m, u, b) => {
      calls.push({ m, u, b });
      if (m === 'POST' && u === '/api/profiles') return { s: 201, d: { id: 'win-1' } };
      if (m === 'POST' && u.endsWith('/launch')) {
        stage = stage === 'new' ? 'open' : stage === 'closed' ? 'reopen' : 'restart';
        if (stage === 'open') return { s: 200, d: { running: true, pid: 111, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/abc', debuggerAddress: '127.0.0.1:9' } } };
        if (stage === 'reopen') return { s: 200, d: { running: true, pid: 222, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/def', debuggerAddress: '127.0.0.1:9' } } };
        return { s: 200, d: { running: true, pid: 333, last_error: null, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/ghi', debuggerAddress: '127.0.0.1:9' } } };
      }
      if (m === 'GET' && u === '/api/profiles') {
        if (stage === 'closed') return { s: 200, d: [{ id: 'win-1', running: false, last_error: null }] };
        if (stage === 'killed') return { s: 200, d: [{ id: 'win-1', running: false, last_error: 'Browser exited unexpectedly (exit code 1, exit_type missing)' }] };
        return { s: 200, d: [{ id: 'win-1', running: true, last_error: null }] };
      }
      return { s: 200, d: {} };
    },
    closeLastWindow: async ws => { closed.push(ws); stage = 'closed'; return { method: 'last-window' }; },
    taskkill: async () => { stage = 'killed'; return { exitStatus: 0, stdout: 'SUCCESS', stderr: '', exception: null }; },
    log: line => diagnosticLogs.push(line),
    lifecycleSnapshot: async (_id, pid) => ({ observedPid: pid, observedPidAlive: stage !== 'killed', settling: false, runningRow: stage === 'killed' ? null : { pid } }),
  }));
  assert.deepEqual(calls[0].b, { name: 'Window', automationEnabled: true });
  assert.deepEqual(closed, ['ws://127.0.0.1:9/devtools/browser/abc']);
  assert.equal(out.lifecycle.close.running, false);
  assert.equal(out.lifecycle.close.error, null);
  assert.equal(out.lifecycle.close.exitType, 'Normal');
  assert.equal(out.lifecycle.close.method, 'last-window');
  assert.equal(out.lifecycle.close.address, '127.0.0.1:9');
  assert.equal(out.lifecycle.kill.running, false);
  assert.match(out.lifecycle.kill.error, /unexpectedly|died|exit code|signal|Crashed/i);
  assert.equal(out.lifecycle.kill.taskkill, null);
  assert.equal(out.lifecycle.restart.status, 200);
  assert.equal(out.lifecycle.restart.running, true);
  assert.equal(out.lifecycle.restart.error, null);
  assert.equal(out.diagnostics.taskkill.exitStatus, 0);
  assert.equal(out.diagnostics.errorWait.matched, true);
  assert.equal(out.diagnostics.errorWait.timedOut, false);
  const timeline = out.diagnostics.timeline;
  assert.ok(timeline.findIndex(x => x.stage === 'before-taskkill') < timeline.findIndex(x => x.stage === 'after-taskkill'));
  assert.ok(timeline.findIndex(x => x.stage === 'wait-for-error') < timeline.findIndex(x => x.stage === 'before-relaunch'));
  assert.equal(timeline.find(x => x.stage === 'before-taskkill').snapshot.observedPid, 222);
  assert.equal(timeline.find(x => x.stage === 'after-taskkill').snapshot.observedPidAlive, false);
  assert.equal(timeline.at(-1).stage, 'after-final-stop');
  assert.equal(diagnosticLogs.length, timeline.length);
});

test('lifecycle CDP must be loopback and is not opened for a public address', async () => {
  await assert.rejects(() => runLifecyclePhase(base({
    call: async (m, u) => {
      if (m === 'POST' && u === '/api/profiles') return { s: 201, d: { id: 'win-1' } };
      if (m === 'POST' && u.endsWith('/launch')) return { s: 200, d: { running: true, pid: 5, cdp: { wsEndpoint: 'ws://0.0.0.0:9/devtools/browser/abc', debuggerAddress: '0.0.0.0:9' } } };
      return { s: 200, d: {} };
    },
  })), /not loopback-only/);
});

test('lifecycle without a CDP endpoint fails instead of reporting a false Stopped', async () => {
  await assert.rejects(() => runLifecyclePhase(base({
    call: async (m, u) => {
      if (m === 'POST' && u === '/api/profiles') return { s: 201, d: { id: 'win-1' } };
      if (m === 'POST' && u.endsWith('/launch')) return { s: 200, d: { running: true, pid: 5 } };
      return { s: 200, d: {} };
    },
  })), /CDP endpoint/);
});

test('seed and check return the objects the acceptance script reads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-seed-phase-'));
  const win = {
    loadURL() {},
    webContents: {
      once(ev, fn) { if (ev === 'did-finish-load') queueMicrotask(fn); },
      async executeJavaScript(src) {
        if (String(src).includes('innerText')) return 'Profiles';
        return true;
      },
    },
  };
  const ctx = base({
    userData: dir,
    win,
    call: async (m, u) => {
      if (u === '/api/browser/install') return { s: 200, d: { installed: true, install: { state: 'done', code: 'ALREADY_INSTALLED' } } };
      if (u === '/api/proxy/test') return { s: 200, d: { ok: false, message: 'self-signed certificate' } };
      if (u === '/api/profiles' && m === 'POST') return { s: 201, d: { id: 'p1' } };
      if (u === '/api/profiles' && m === 'GET') return { s: 200, d: [{ id: 'p1', name: 'Plain', running: true, pid: 9, cdp: null, last_error: null }, { id: 'persist', name: 'Persist' }] };
      if (u === '/api/proxies' && m === 'GET') return { s: 200, d: [{ name: 'PersistProxy' }] };
      if (String(u).endsWith('/launch')) return { s: 200, d: { running: true, cdp: { debuggerAddress: '127.0.0.1:9222' } } };
      return { s: 200, d: {} };
    },
  });
  const seed = await runSeedPhase(ctx);
  assert.equal(seed.install.code, 'ALREADY_INSTALLED');
  assert.equal(seed.install.installed, true);
  assert.equal(seed.userBrowsersUnchanged, true);
  assert.equal(seed.tls.ok, false);
  assert.match(seed.tls.message, /self-signed/);
  assert.equal(seed.bannerBefore, false);
  assert.equal(seed.launchClicked, true);
  assert.equal(seed.bannerAfter, false);
  assert.equal(seed.plain.status, 200);
  assert.equal(seed.plain.cdp, false);
  assert.equal(seed.plain.automationEnabled, false);
  assert.deepEqual(seed.plain.listening, []);
  assert.equal(seed.auto.cdp, true);
  assert.equal(seed.auto.status, 200);
  assert.equal(seed.persist.status, 200);
  assert.equal(typeof seed.persist.wrote, 'boolean');
  const check = await runCheckPhase(ctx);
  assert.equal(check.saved.profile, true);
  assert.equal(check.saved.proxy, true);
  assert.ok('read' in check.saved);
  assert.equal(check.saved.launch, 200);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the handler table is exactly the five phases', () => {
  const handlers = phaseHandlers(base());
  assert.deepEqual(Object.keys(handlers), [...SMOKE_PHASES]);
  for (const name of SMOKE_PHASES) assert.equal(typeof handlers[name], 'function');
});

test('a missing phase is rejected only after both smoke gates are set', () => {
  assert.deepEqual(classifyLaunch({}), { mode: 'app' });
  assert.deepEqual(classifyLaunch({ PM_SMOKE_PHASE: 'nope' }), { mode: 'app' });
  assert.deepEqual(classifyLaunch({ PM_SMOKE: '1' }), { mode: 'desktop-smoke' });
  assert.deepEqual(classifyLaunch({ PM_SMOKE: '1', PM_SMOKE_PHASE: 'seed' }), { mode: 'desktop-smoke' });
  assert.deepEqual(classifyLaunch({ PM_SMOKE_OFFLINE: '1', PM_SMOKE_PHASE: 'clean' }), { mode: 'app' });
  const missing = classifyLaunch({ PM_SMOKE: '1', PM_SMOKE_OFFLINE: '1' });
  assert.equal(missing.mode, 'rejected');
  assert.equal(missing.body.phase, null);
  assert.match(missing.error, /PM_SMOKE_PHASE must be one of clean, upgrade, seed, check, lifecycle; got \(missing\)/);
  const bad = classifyLaunch({ PM_SMOKE: '1', PM_SMOKE_OFFLINE: '1', PM_SMOKE_PHASE: 'seeded' });
  assert.equal(bad.mode, 'rejected');
  assert.equal(bad.body.phase, 'seeded');
  assert.match(bad.error, /got "seeded"/);
  assert.deepEqual(classifyLaunch({ PM_SMOKE: '1', PM_SMOKE_OFFLINE: '1', PM_SMOKE_PHASE: 'lifecycle' }), { mode: 'offline', phase: 'lifecycle' });
});

test('a rejected phase writes a result file the harness can read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-phase-reject-'));
  const file = path.join(dir, 'result.json');
  const decision = classifyLaunch({ PM_SMOKE: '1', PM_SMOKE_OFFLINE: '1', PM_SMOKE_PHASE: 'seeded', PM_SMOKE_RESULT: file });
  writeSmokeRejection({ PM_SMOKE_RESULT: file }, decision.body, fs.writeFileSync);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), decision.body);
  assert.match(decision.body.error, /got "seeded"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('packaged entry rejects a bad offline phase before the backend starts', () => {
  const src = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const ready = src.slice(src.indexOf('app.whenReady'));
  const gate = ready.indexOf("process.env.PM_SMOKE === '1' && process.env.PM_SMOKE_OFFLINE === '1'");
  const exit = ready.indexOf('app.exit(1)');
  const start = ready.indexOf('await startBackend()');
  assert.ok(gate >= 0 && exit > gate && start > exit, 'rejection exits before startBackend');
  assert.equal(src.includes('selectSmokePhase'), false, 'main does not validate the phase on its own');
  const offline = fs.readFileSync(new URL('../electron/offline-smoke.js', import.meta.url), 'utf8');
  const flag = offline.indexOf("process.env.PM_SMOKE !== '1' || process.env.PM_SMOKE_OFFLINE !== '1'");
  const rejectExit = offline.indexOf('app.exit(1)');
  const go = offline.indexOf('await dispatchSmokePhase');
  assert.ok(flag >= 0 && rejectExit > flag && go > rejectExit, 'dispatch follows the gate and the non-zero exit');
  assert.ok(offline.indexOf('app.quit()') > go, 'quit is the success path');
});

test('workflow smoke steps that enter offline smoke set PM_SMOKE_PHASE explicitly', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/windows-native-validation.yml', import.meta.url), 'utf8');
  const step = name => {
    const start = yml.indexOf(`- name: ${name}`);
    assert.ok(start >= 0, name);
    const next = yml.indexOf('\n      - name:', start + 1);
    return yml.slice(start, next === -1 ? undefined : next);
  };
  const ui = step('UI smoke');
  const desktop = step('Electron desktop smoke on Windows');
  const offline = step('Offline smoke of the installed app');
  assert.equal(ui.includes('PM_SMOKE'), false);
  assert.equal(desktop.includes('PM_SMOKE'), false);
  assert.match(desktop, /npm run test:electron/);
  assert.match(offline, /node test\/electron-smoke-offline\.js/);
  assert.equal(offline.includes('PM_SMOKE_PHASE:'), false, 'one YAML value cannot name all five phases');
  const harness = fs.readFileSync(new URL('./electron-smoke-offline.js', import.meta.url), 'utf8');
  assert.match(harness, /env\.PM_SMOKE_PHASE = phase/);
  for (const phase of SMOKE_PHASES) assert.match(harness, new RegExp(`runPhase\\('${phase}'`));
  const desktopSmoke = fs.readFileSync(new URL('./electron-smoke.js', import.meta.url), 'utf8');
  assert.match(desktopSmoke, /PM_SMOKE: '1'/);
  assert.match(desktopSmoke, /delete smokeEnv\.PM_SMOKE_OFFLINE/);
  assert.match(desktopSmoke, /delete smokeEnv\.PM_SMOKE_PHASE/);
  assert.equal(/PM_SMOKE_PHASE\s*=/.test(desktopSmoke), false);
  assert.equal(/PM_SMOKE_OFFLINE\s*=/.test(desktopSmoke), false);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.main, 'electron/main.js');
  assert.ok(pkg.build.files.includes('electron/**'));
});

test('listening-port parsers keep only LISTEN sockets for the named pids', () => {
  const netstat = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       4',
    '  TCP    127.0.0.1:9222         0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:9223         0.0.0.0:0              ESTABLISHED     4242',
    '  TCP    [::1]:9224             [::]:0                 LISTENING       4243',
  ].join('\n');
  assert.deepEqual(portsFromNetstat(netstat, [4242, 4243]), [9222, 9224]);
  const proc = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:2406 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 99 1 0000000000000000 100 0 0 10 0',
    '   1: 0100007F:2407 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 99 1 0000000000000000 100 0 0 10 0',
  ].join('\n');
  assert.deepEqual(portsFromProcNet(proc, new Set(['99'])), [0x2406]);
});

test('common facts keep the native and bundled-browser fields', async () => {
  const facts = await commonSmokeFacts(base({
    call: async () => ({ s: 200, d: { installed: true, path: 'C:\\resources\\browsers\\chromium-1248\\chrome.exe' } }),
  }));
  assert.equal(facts.browserBefore.installed, true);
  assert.equal(facts.revision, '1248');
  assert.equal(typeof facts.headlessShellExists, 'boolean');
  assert.match(facts.native.path, /better_sqlite3\.node$/);
});



test('lifecycle diagnostics retain taskkill failure and the original 80-poll timeout', async () => {
  let polls = 0;
  const failure = Object.assign(new Error('taskkill failed'), { taskkillEvidence: {
    exitStatus: 128, stdout: '', stderr: 'process not found', exception: 'taskkill failed',
  } });
  const out = await runLifecyclePhase(base({
    call: async (m, u) => {
      if (m === 'POST' && u === '/api/profiles') return { s: 201, d: { id: 'timeout' } };
      if (u.endsWith('/launch')) return { s: 200, d: { running: true, pid: 7, cdp: {
        wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/test', debuggerAddress: '127.0.0.1:9',
      } } };
      if (m === 'GET' && u === '/api/profiles') { polls++; return { s: 200, d: [{ id: 'timeout', running: false, last_error: null }] }; }
      return { s: 200, d: {} };
    },
    taskkill: async () => { throw failure; },
  }));
  assert.equal(out.diagnostics.taskkill.exitStatus, 128);
  assert.equal(out.diagnostics.taskkill.stderr, 'process not found');
  assert.equal(out.lifecycle.kill.taskkill, 'taskkill failed');
  assert.equal(out.lifecycle.kill.error, null);
  assert.deepEqual(out.diagnostics.errorWait, { attempt: 80, matched: false, timedOut: true });
  assert.equal(polls, 81); // One clean-close poll, then the unchanged 80 Error polls.
});

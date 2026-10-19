// Offline smoke phase dispatch. No Electron: the handlers run against fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import {
  SMOKE_PHASES, selectSmokePhase, dispatchSmokePhase, phaseHandlers,
  runCleanPhase, runUpgradePhase, runLifecyclePhase, runSeedPhase, runCheckPhase, commonSmokeFacts,
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
  browserClose: noop,
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
      app: { version: '0.5.0-alpha.1' }, schemaVersion: 7,
      migration: { from: 0, backup }, dataDir: 'C:\\Users\\me\\AppData\\Roaming\\profile-manager\\data',
    } }),
  }));
  assert.equal(out.clean.version, '0.5.0-alpha.1');
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
      if (u === '/api/diagnostics') return { s: 200, d: { app: { version: '0.5.0-alpha.1' }, schemaVersion: 7, migration: { from: 6, backup }, dataDir: dir } };
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
  const out = await runLifecyclePhase(base({
    call: async (m, u, b) => {
      calls.push({ m, u, b });
      if (m === 'POST' && u === '/api/profiles') return { s: 201, d: { id: 'win-1' } };
      if (m === 'POST' && u.endsWith('/launch')) {
        stage = stage === 'new' ? 'open' : stage === 'closed' ? 'reopen' : 'restart';
        if (stage === 'open') return { s: 200, d: { running: true, pid: 111, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/abc' } } };
        if (stage === 'reopen') return { s: 200, d: { running: true, pid: 222, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/def' } } };
        return { s: 200, d: { running: true, pid: 333, last_error: null, cdp: { wsEndpoint: 'ws://127.0.0.1:9/devtools/browser/ghi' } } };
      }
      if (m === 'GET' && u === '/api/profiles') {
        if (stage === 'closed') return { s: 200, d: [{ id: 'win-1', running: false, last_error: null }] };
        if (stage === 'killed') return { s: 200, d: [{ id: 'win-1', running: false, last_error: 'Browser exited unexpectedly (exit code 1, exit_type missing)' }] };
        return { s: 200, d: [{ id: 'win-1', running: true, last_error: null }] };
      }
      return { s: 200, d: {} };
    },
    browserClose: async ws => { closed.push(ws); stage = 'closed'; },
    taskkill: async () => { stage = 'killed'; },
  }));
  assert.deepEqual(calls[0].b, { name: 'Window', automationEnabled: true });
  assert.deepEqual(closed, ['ws://127.0.0.1:9/devtools/browser/abc']);
  assert.equal(out.lifecycle.close.running, false);
  assert.equal(out.lifecycle.close.error, null);
  assert.equal(out.lifecycle.kill.running, false);
  assert.match(out.lifecycle.kill.error, /unexpectedly|died|exit code|signal|Crashed/i);
  assert.equal(out.lifecycle.kill.taskkill, null);
  assert.equal(out.lifecycle.restart.status, 200);
  assert.equal(out.lifecycle.restart.running, true);
  assert.equal(out.lifecycle.restart.error, null);
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

test('common facts keep the native and bundled-browser fields', async () => {
  const facts = await commonSmokeFacts(base({
    call: async () => ({ s: 200, d: { installed: true, path: 'C:\\resources\\browsers\\chromium-1248\\chrome.exe' } }),
  }));
  assert.equal(facts.browserBefore.installed, true);
  assert.equal(facts.revision, '1248');
  assert.equal(typeof facts.headlessShellExists, 'boolean');
  assert.match(facts.native.path, /better_sqlite3\.node$/);
});

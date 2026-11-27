// First-run guide (web/src/lib/onboarding.js): every state comes from real data, never from a click.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onboardingSteps, guideVisible, guideProgress, readDismissed, writeDismissed, GUIDE_KEY } from '../web/src/lib/onboarding.js';
import { spawnServer, stopServer } from './_ports.mjs';

const by = (steps, id) => steps.find(s => s.id === id);
const ready = { installed: true, runtime: 'chromium' };

test('a fresh install with a browser: create-profile is the next step and launching waits for it', () => {
  const steps = onboardingSteps({ browser: ready, meta: { profileCount: 0, proxyCount: 0, launchedCount: 0 } });
  assert.deepEqual(steps.map(s => [s.id, s.state]), [['browser', 'done'], ['proxy', 'todo'], ['profile', 'todo'], ['launch', 'blocked']]);
  assert.equal(by(steps, 'profile').action, 'create');
  assert.equal(by(steps, 'proxy').required, false);
  assert.deepEqual(guideProgress(steps), { done: 1, total: 3 });
  assert.equal(guideVisible(steps), true);
});

test('browser step: unknown while loading, AZWAH Chromium counts even without Chrome, missing offers the right fix', () => {
  assert.equal(by(onboardingSteps({ browser: null, meta: {} }), 'browser').state, 'unknown');
  const native = by(onboardingSteps({ browser: { installed: false, azwahNative: true, runtime: 'stable-chrome' }, meta: {} }), 'browser');
  assert.equal(native.state, 'done'); assert.match(native.detail, /AZWAH Chromium/);
  const noChrome = by(onboardingSteps({ browser: { installed: false, runtime: 'stable-chrome' }, meta: {} }), 'browser');
  assert.deepEqual([noChrome.state, noChrome.action], ['todo', 'get-chrome']);
  const noChromium = by(onboardingSteps({ browser: { installed: false, runtime: 'chromium' }, meta: {} }), 'browser');
  assert.deepEqual([noChromium.state, noChromium.action], ['todo', 'diagnostics']);
});

test('launch needs a browser and a profile; it is done only after a profile was really launched', () => {
  assert.equal(by(onboardingSteps({ browser: { installed: false }, meta: { profileCount: 2 } }), 'launch').state, 'blocked');
  assert.equal(by(onboardingSteps({ browser: ready, meta: { profileCount: 2, launchedCount: 0 } }), 'launch').state, 'todo');
  const done = onboardingSteps({ browser: ready, meta: { profileCount: 2, launchedCount: 1, proxyCount: 0 } });
  assert.equal(by(done, 'launch').state, 'done');
  assert.equal(guideVisible(done), false, 'the optional proxy step does not keep the guide open');
  assert.equal(guideVisible(done, { forced: true }), true, 'it can be reopened on request');
});

test('dismissing hides an unfinished guide; forcing reopens it', () => {
  const steps = onboardingSteps({ browser: ready, meta: { profileCount: 0 } });
  assert.equal(guideVisible(steps, { dismissed: true }), false);
  assert.equal(guideVisible(steps, { dismissed: true, forced: true }), true);
});

test('dismissal storage is guarded: it works, and a failing or missing storage never throws', () => {
  const mem = new Map();
  const ok = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  assert.equal(readDismissed(ok), false);
  writeDismissed(true, ok); assert.equal(mem.get(GUIDE_KEY), '1'); assert.equal(readDismissed(ok), true);
  writeDismissed(false, ok); assert.equal(readDismissed(ok), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readDismissed(broken), false);
  assert.doesNotThrow(() => writeDismissed(true, broken));
  assert.equal(readDismissed(null), false);
  assert.doesNotThrow(() => writeDismissed(true, null));
});

test('API: meta reports proxyCount and launchedCount, and /browser reports azwahNative', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-onboard-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'ob', PM_TEST_AZWAH_NATIVE_AVAILABLE: '1' });
  const h = { Authorization: 'Bearer ob', 'Content-Type': 'application/json' };
  const get = route => fetch(proc.url + route, { headers: h }).then(r => r.json());
  try {
    const empty = await get('/api/meta');
    assert.deepEqual([empty.profileCount, empty.proxyCount, empty.launchedCount], [0, 0, 0]);
    assert.equal((await get('/api/browser')).azwahNative, true);
    await fetch(proc.url + '/api/v1/proxies', { method: 'POST', headers: h, body: JSON.stringify({ name: 'p', type: 'http', host: '203.0.113.5', port: 80 }) });
    await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: h, body: JSON.stringify({ name: 'one' }) });
    const after = await get('/api/meta');
    assert.deepEqual([after.profileCount, after.proxyCount, after.launchedCount], [1, 1, 0], 'created is not launched');
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

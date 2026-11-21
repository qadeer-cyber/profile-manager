// Native launcher lifecycle with a FAKE executable (test/fixtures/fake-browser/fake-native.mjs). Proves the
// launcher's process, isolation and error contract only; it is not Chromium acceptance evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchNativeChromium } from '../server/browser-runtime/native-chromium.js';
import { killTree, isAlive } from '../server/proc.js';

const fake = fileURLToPath(new URL('./fixtures/fake-browser/fake-native.mjs', import.meta.url));
const skip = process.platform === 'win32' && 'the fake executable uses a POSIX shebang';
const plan = dir => ({ executablePath: fake, dir, args: ['--lang=en-US', '--no-first-run'], openUrls: ['http://127.0.0.1:9/'], regional: {} });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-native-life-'));
const record = async dir => { for (let i = 0; i < 100; i++) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'fake-launch.json'), 'utf8')); } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('fake browser did not start'); };

test('two profiles launch as separate owned processes; stopping one leaves the other running', { skip }, async () => {
  process.env.PM_API_TOKEN = 'must-not-reach-the-browser';
  const a = tmp(), b = tmp();
  const ra = await launchNativeChromium(plan(a));
  const rb = await launchNativeChromium(plan(b));
  try {
    assert.notEqual(ra.browserPid, rb.browserPid);
    const fa = await record(a), fb = await record(b);
    assert.ok(fa.argv.includes(`--user-data-dir=${a}`) && fb.argv.includes(`--user-data-dir=${b}`));
    assert.deepEqual(fa.secrets, [], 'no AZWAH secrets in the browser environment');
    // The ownership guard: killing with the wrong profile directory is refused.
    assert.equal(await killTree(rb.browserPid, { expect: a }), false, 'cannot stop B by naming A');
    assert.equal(isAlive(rb.browserPid), true);
    assert.equal(await killTree(ra.browserPid, { expect: a }), true);
    assert.equal(isAlive(ra.browserPid), false);
    assert.equal(isAlive(rb.browserPid), true, 'B unaffected');
  } finally {
    await killTree(rb.browserPid, { expect: b });
    delete process.env.PM_API_TOKEN;
  }
});

test('a forbidden automation switch is refused before anything starts', async () => {
  const dir = tmp();
  await assert.rejects(launchNativeChromium({ ...plan(dir), args: ['--remote-debugging-pipe'] }), e => e.code === 'NATIVE_LAUNCH_FORBIDDEN_ARG');
  assert.equal(fs.existsSync(path.join(dir, 'fake-launch.json')), false);
});

test('a missing executable path is a clear error', async () => {
  await assert.rejects(launchNativeChromium({ ...plan(tmp()), executablePath: '' }), e => e.code === 'CHROMIUM_MISSING');
});

test('an executable that does not exist is a clear error and does not crash the process', async () => {
  const crashes = [];
  const onUncaught = e => crashes.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    await assert.rejects(launchNativeChromium({ ...plan(tmp()), executablePath: path.join(tmp(), 'no-such-chrome') }),
      e => e.code === 'NATIVE_SPAWN_FAILED');
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(crashes.map(e => e.code), [], 'no uncaught spawn error');
  } finally { process.off('uncaughtException', onUncaught); }
});

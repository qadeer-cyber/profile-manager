// Smoke harness logic with a FAKE browser executable (test/fixtures/fake-browser). Proves the harness steps and
// verdicts only; it is not evidence about any real browser. Windows runs the real harness in the chain workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { smoke } from '../scripts/native-smoke.mjs';

const fake = fileURLToPath(new URL('./fixtures/fake-browser/fake-chrome.mjs', import.meta.url));
const opts = { settleMs: 50, timeoutMs: 10000 };
const skip = process.platform === 'win32' && 'the fake executable uses a POSIX shebang';

test('fake browser that keeps profile data: every step passes', { skip }, async () => {
  delete process.env.AZWAH_FAKE_BROWSER;
  const r = await smoke(fake, { ...opts, expectVersion: '159.0.8153.0' });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.deepEqual(r.steps.map(s => s.name), ['version', 'launch and load page', 'graceful close', 'relaunch keeps profile data', 'remove temporary profile']);
});

test('fake browser that loses data on close: the restart step fails', { skip }, async () => {
  process.env.AZWAH_FAKE_BROWSER = 'lose-data';
  try {
    const r = await smoke(fake, opts);
    assert.equal(r.ok, false);
    assert.match(r.steps.find(s => s.name === 'relaunch keeps profile data').error, /stored value after restart was "new"/);
  } finally { delete process.env.AZWAH_FAKE_BROWSER; }
});

test('wrong version is reported', { skip }, async () => {
  const r = await smoke(fake, { ...opts, expectVersion: '160.0.0.0' });
  assert.equal(r.ok, false);
  assert.match(r.steps[0].error, /does not contain 160\.0\.0\.0/);
});

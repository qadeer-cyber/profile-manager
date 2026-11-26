// The in-browser exit-IP check (Controlled proxy launch) retries one transient network failure, like the
// server-side probe. A wrong exit IP still fails at once. (Seen in CI on 61b6ff4: one failed ipify request
// failed the whole launch.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStableBrowserLocation } from '../server/browser-runtime/chrome-stable.js';

const expected = { ip: '8.8.8.8', timezone: 'UTC', latitude: 0, longitude: 0, accuracy: 1 };
function fakeContext(responses) {
  let gotos = 0;
  const page = {
    goto: async () => { const r = responses[gotos++]; if (r instanceof Error) throw r; return r; },
    evaluate: async (fn, dates) => dates ? { timezone: 'UTC', offsets: dates.map(() => 0) } : null,
    close: async () => {},
  };
  return { context: { newPage: async () => page, grantPermissions: async () => {}, clearPermissions: async () => {} }, gotos: () => gotos };
}
const ok = ip => ({ ok: () => true, url: () => 'https://api64.ipify.org/?format=json', json: async () => ({ ip }) });

test('one transient failure of the exit-IP request is retried', async () => {
  const f = fakeContext([new Error('net::ERR_CONNECTION_RESET'), ok('8.8.8.8')]);
  await verifyStableBrowserLocation(f.context, expected, { verifyCoordinates: false, retryDelayMs: 1 });
  assert.equal(f.gotos(), 2);
});

test('a non-OK response is retried once, then fails', async () => {
  const bad = { ok: () => false, url: () => 'https://api64.ipify.org/?format=json', json: async () => ({}) };
  const f = fakeContext([bad, bad]);
  await assert.rejects(verifyStableBrowserLocation(f.context, expected, { verifyCoordinates: false, retryDelayMs: 1 }), e => e.code === 'PROXY_BROWSER_IDENTITY_FAILED');
  assert.equal(f.gotos(), 2);
});

test('a wrong exit IP fails at once, without a retry', async () => {
  const f = fakeContext([ok('1.1.1.1'), ok('8.8.8.8')]);
  await assert.rejects(verifyStableBrowserLocation(f.context, expected, { verifyCoordinates: false, retryDelayMs: 1 }), e => e.code === 'PROXY_BROWSER_IDENTITY_FAILED');
  assert.equal(f.gotos(), 1);
});

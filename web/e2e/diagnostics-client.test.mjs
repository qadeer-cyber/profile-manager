import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { pm: { uiToken: 'fixture-ui' } };
const { api } = await import('../src/api.js');
const { validateDiagnosticsV1 } = await import('../src/hooks/useProfileDiagnostics.js');
const requestId = '11111111-1111-4111-8111-111111111111';
test('diagnostics preserves safe envelope and request transport', async () => {
  let received;
  globalThis.fetch = async (url, opts) => { received = { url, opts }; return { ok: false, status: 409, json: async () => ({ error: { code: 'LAUNCH_CHANGED', message: 'Expected launch ID does not match.', requestId } }) }; };
  await assert.rejects(api('/api/profiles/fixture/diagnostics/environment', { method: 'POST', body: { consent: 'fixture' } }), e => e.status === 409 && e.code === 'LAUNCH_CHANGED' && e.message === 'Expected launch ID does not match.' && e.requestId === requestId);
  assert.equal(received.opts.headers['X-UI-Token'], 'fixture-ui');
  assert.equal(received.opts.headers.Authorization, undefined);
  assert.equal(received.opts.body, '{"consent":"fixture"}');
});
test('ordinary errors retain their established behavior', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'ordinary failure', code: 'ordinary-code' }) });
  await assert.rejects(api('/api/profiles'), e => e.message === 'ordinary failure' && e.code === 'ordinary-code' && e.requestId === undefined);
});
test('malformed diagnostics metadata is not copied', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'private-value', message: 'bad\nmessage', requestId: 'private-value' } }) });
  await assert.rejects(api('/api/profiles/fixture/diagnostics'), e => e.code === undefined && e.requestId === undefined && e.message === '[object Object]');
});
test('strict UI validation accepts process source and rejects unknown policy/source/fields', () => {
  const A = (value, source) => ({ availability: 'available', value, source });
  const U = { availability: 'unavailable', value: null, source: null, reason: 'permission_required' };
  const d = { schemaVersion: 1, profileId: 'fixture', observation: { id: requestId, launchId: 'fixture', requestedAt: '2026-10-19T00:00:00Z', completedAt: '2026-10-19T00:00:00Z', durationMs: 0, validUntil: '2026-10-19T00:00:30Z', state: 'complete', reason: null }, runtime: { chromiumVersion: A('156.0.8078.4', 'browser_protocol'), userAgent: A('fixture UA', 'browser_protocol') }, expected: { chromiumVersion: A('156.0.8078.4', 'manifest') }, environment: { timezone: U, locale: U, languages: U }, proxy: A({ configured: false }, 'launch_snapshot'), webrtc: { commandLinePolicy: A({ state: 'present', value: 'default' }, 'process_command_line'), effectivePolicy: { ...U, reason: 'unsupported' }, iceCollection: 'not_collected' }, consistency: { chromiumVersion: 'match' } };
  assert.equal(validateDiagnosticsV1(d), d);
  for (const mutate of [x => { x.webrtc.commandLinePolicy.source = 'unknown'; }, x => { x.webrtc.commandLinePolicy.value.value = 'arbitrary'; }, x => { x.extra = true; }]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => validateDiagnosticsV1(bad));
  }
});

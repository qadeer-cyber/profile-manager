import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWebRtcArguments } from '../server/diagnostic-process.js';
import { DEFAULT_WEBRTC_SETTINGS, WEBRTC_MODES, chromiumPolicyArgs, validateWebRtcSettings as validate } from '../server/webrtc-policy.js';

test('browser default is stable and adds no Chromium flag', () => {
  assert.deepEqual(validate({}), DEFAULT_WEBRTC_SETTINGS);
  assert.deepEqual(chromiumPolicyArgs({}), []);
  assert.deepEqual(summarizeWebRtcArguments(chromiumPolicyArgs({})), { kind: 'absent' });
});

test('each supported Chromium policy is forced as exactly one flag', () => {
  for (const mode of WEBRTC_MODES.filter(mode => mode !== 'browser_default')) {
    const args = chromiumPolicyArgs({ mode });
    assert.deepEqual(args, [`--force-webrtc-ip-handling-policy=${mode}`]);
    assert.deepEqual(summarizeWebRtcArguments(args), { kind: 'present', value: mode });
  }
});

test('partial update keeps the saved mode', () => {
  const saved = validate({ mode: 'default_public_interface_only' });
  assert.deepEqual(validate({}, saved), saved);
  assert.deepEqual(validate({ mode: 'browser_default' }, saved), DEFAULT_WEBRTC_SETTINGS);
});

for (const value of [null, [], '', 1, { mode: 'disabled' }, { mode: 'disable' }, { mode: 'off' }, { mode: 'none' }, { mode: 'spoof' }, { mode: 'default ' }, { mode: '--force-webrtc-ip-handling-policy=default' }, { mode: 'disable_non_proxied_udp', leakProof: true }, { anonymize: true }]) {
  test(`reject unsupported WebRTC settings ${JSON.stringify(value)}`, () => {
    assert.throws(() => validate(value), e => e.status === 400 && e.code === 'INVALID_WEBRTC_SETTINGS');
  });
}

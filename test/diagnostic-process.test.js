import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticProcessStart, observeProcessPolicy, summarizeWebRtcArguments as summarize } from '../server/diagnostic-process.js';

for (const platform of ['linux', 'win32']) {
  test(`Chromium syntax, allowlist, terminator and privacy (${platform})`, () => {
    for (const prefix of platform === 'win32' ? ['--', '-', '/'] : ['--', '-']) {
      assert.deepEqual(summarize([`${prefix}force-webrtc-ip-handling-policy=default`], platform), { kind: 'present', value: 'default' });
    }
    assert.deepEqual(summarize(['--', '--force-webrtc-ip-handling-policy=default'], platform), { kind: 'absent' });
    assert.deepEqual(summarize(['--webrtc-ip-handling-policy=default'], platform), { kind: 'absent' });
    assert.deepEqual(summarize(['--force-webrtc-ip-handling-policy', 'default'], platform), { kind: 'unverified' });
    assert.deepEqual(summarize(['--force-webrtc-ip-handling-policy=fixture-private'], platform), { kind: 'unverified' });
    assert.deepEqual(summarize(['--force-webrtc-ip-handling-policy=default', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'], platform), { kind: 'conflicting' });
    assert.deepEqual(summarize(['--FORCE-WEBRTC-IP-HANDLING-POLICY=default'], platform), platform === 'win32' ? { kind: 'present', value: 'default' } : { kind: 'absent' });
  });
}

test('OS observation rejects a wrong process start and obsolete launch', async () => {
  const start = await diagnosticProcessStart(process.pid);
  assert.deepEqual(await observeProcessPolicy({ pid: process.pid, start: 'wrong', launchId: 'fixture', stillCurrent: () => true }), { kind: 'unreadable' });
  assert.deepEqual(await observeProcessPolicy({ pid: process.pid, start, launchId: 'fixture', stillCurrent: () => false }), { kind: 'unreadable' });
});

test('real host process identity and policy read', { skip: !['linux', 'win32'].includes(process.platform) && 'OS argv observation is fail-closed on this host; Windows/Linux required' }, async () => {
  const start = await diagnosticProcessStart(process.pid);
  assert.ok(start);
  assert.deepEqual(await observeProcessPolicy({ pid: process.pid, start, launchId: 'fixture', stillCurrent: () => true }), { kind: 'absent' });
});

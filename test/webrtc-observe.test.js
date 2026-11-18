import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iceConsistencyFinding, summarizeIceCandidates } from '../server/webrtc-observe.js';

test('ICE lines are summarized by type without keeping full addresses', () => {
  const summary = summarizeIceCandidates([
    'candidate:1 1 udp 2130706431 192.168.1.5 54321 typ host',
    'candidate:2 1 udp 1694498815 203.0.113.9 54321 typ srflx raddr 192.168.1.5 rport 54321',
  ]);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.types.host, 1);
  assert.equal(summary.types.srflx, 1);
  assert.match(summary.note, /not compared to the proxy/);
});

test('ICE findings never claim a proxy match', () => {
  const pass = iceConsistencyFinding('browser_default', summarizeIceCandidates(['candidate:1 1 udp 2130706431 127.0.0.1 1 typ host']));
  assert.equal(pass.status, 'pass');
  assert.match(pass.summary, /not compared to the proxy/);
  const warn = iceConsistencyFinding('disable_non_proxied_udp', summarizeIceCandidates([
    'candidate:1 1 udp 1694498815 203.0.113.9 1 typ srflx raddr 0.0.0.0 rport 1',
  ]));
  assert.equal(warn.status, 'warning');
  assert.match(warn.summary, /not compared to the proxy IP/);
});

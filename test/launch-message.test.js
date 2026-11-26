// Launch toast wording: an unfinished proxy check is never presented as verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchMessage } from '../web/src/lib/launchMessage.js';

test('no proxy check: plain message', () => {
  assert.deepEqual(launchMessage('A', { id: 'x' }), { text: 'Launched A', kind: 'success' });
});
test('verified: names the exit', () => {
  assert.deepEqual(launchMessage('A', { proxyPreflight: { state: 'verified', exitIp: '8.8.8.8', country: 'US' } }),
    { text: 'Launched A. Proxy checked: exit 8.8.8.8, US.', kind: 'success' });
});
test('inconclusive: a warning that says why, never "verified"', () => {
  const m = launchMessage('A', { proxyPreflight: { state: 'inconclusive', code: 'PROXY_LOCATION_UNAVAILABLE' } });
  assert.equal(m.kind, 'warning');
  assert.match(m.text, /could not finish \(the location database had no answer\); traffic still goes only through the proxy/);
  assert.doesNotMatch(m.text, /verified|checked:/i);
  assert.match(launchMessage('A', { proxyPreflight: { state: 'inconclusive', code: 'NEW_CODE' } }).text, /unknown reason/);
});

// Manual proxy preflight outcomes (owner evidence: proxy profiles on a real 8 GB Windows laptop). Unit-level only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualProxyPreflight, BLOCKING_CODES } from '../server/browser-runtime/proxy-preflight.js';

const err = (code, message = code) => Object.assign(new Error(message), code ? { code } : {});

test('a completed check is verified, with only non-secret facts', () => {
  assert.deepEqual(manualProxyPreflight({ ip: '8.8.8.8', country: 'US', source: 'DB-IP City Lite', password: 'x' }),
    { state: 'verified', exitIp: '8.8.8.8', country: 'US', source: 'DB-IP City Lite' });
});

test('wrong credentials, an unresolvable proxy host and an offline proxy block the launch', () => {
  for (const code of ['PROXY_AUTH_REQUIRED', 'PROXY_DNS_FAILED', 'PROXY_UPSTREAM_UNAVAILABLE']) {
    assert.deepEqual(manualProxyPreflight(null, err(code)), { state: 'block', code });
  }
  assert.deepEqual([...BLOCKING_CODES].sort(), ['PROXY_AUTH_REQUIRED', 'PROXY_DNS_FAILED', 'PROXY_UPSTREAM_UNAVAILABLE']);
});

test('an unfinished check is inconclusive, never verified and never a proxy failure', () => {
  const cases = {
    PROXY_PROBE_TIMEOUT: 'proxy probe timed out',
    PROXY_EXIT_SERVICE_UNAVAILABLE: 'exit-IP service 5xx',
    PROXY_LOCATION_UNAVAILABLE: 'location database unavailable',
    PROXY_EXIT_ROTATED: 'exit IP changed during the check',
    GEOIP_CREDENTIALS_UNAVAILABLE: 'GeoIP setup missing',
  };
  for (const code of Object.keys(cases)) assert.deepEqual(manualProxyPreflight(null, err(code)), { state: 'inconclusive', code }, cases[code]);
  assert.deepEqual(manualProxyPreflight(null, err(undefined, 'proxy check timed out')), { state: 'inconclusive', code: 'PROXY_CHECK_TIMEOUT' }, 'the 8-second cap');
  assert.deepEqual(manualProxyPreflight(null, err(undefined, 'boom')), { state: 'inconclusive', code: 'PROXY_CHECK_FAILED' });
});

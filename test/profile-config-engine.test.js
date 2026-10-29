import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileConfigInput, profileConfigWarnings, profileConfigJsonSchema, BROWSER_ENGINES } from '../server/profile-config-engine.js';

test('schema lists browser engines', () => {
  const s = profileConfigJsonSchema();
  assert.deepEqual(s.properties.browserEngine.enum, [...BROWSER_ENGINES]);
});

test('firefox config emits honest warnings', () => {
  const config = normalizeProfileConfigInput({ browserEngine: 'firefox', webrtcSettings: { mode: 'disable_non_proxied_udp' } }, {});
  const w = profileConfigWarnings(config);
  assert.ok(w.some(x => x.code === 'FIREFOX_EXTENSIONS_UNSUPPORTED'));
  assert.ok(w.some(x => x.code === 'FIREFOX_COOKIES_READ_ONLY'));
  assert.ok(w.some(x => x.code === 'FIREFOX_WEBRTC_GECKO_PREFS'));
});

test('rejects invalid browserEngine', () => {
  assert.throws(() => normalizeProfileConfigInput({ browserEngine: 'safari' }, {}), /chromium or firefox/);
});

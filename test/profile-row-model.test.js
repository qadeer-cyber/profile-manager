import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineLabel, compactDate, proxyLabel, proxyVerificationLevel, proxyEvidenceFields, proxyEvidenceSummary, nativeVerification, tabRestoreBadge, isNativeRuntime, cdpLabel } from '../web/src/lib/profileRow.js';

test('engine labels keep the full honest label and a visible qualifier', () => {
  assert.deepEqual(engineLabel({ browserEngine: 'firefox', advancedSettings: { runtime: 'azwah-native' } }), { short: 'Firefox', full: 'Firefox', qualifier: '' });
  assert.deepEqual(engineLabel({ advancedSettings: { runtime: 'azwah-native' } }), { short: 'Native Chromium', full: 'Azwah Native Chromium (development)', qualifier: 'dev' });
  assert.equal(engineLabel({ advancedSettings: { runtime: 'custom-native-chromium' } }).qualifier, 'dev');
  assert.deepEqual(engineLabel({ advancedSettings: { runtime: 'privacy' } }), { short: 'Privacy Engine', full: 'Azwah Privacy Engine (experimental)', qualifier: 'exp' });
  assert.equal(engineLabel({ advancedSettings: { runtime: 'stable-chrome' } }).full, 'Google Chrome Stable');
  assert.equal(engineLabel({}).short, 'Chromium');
  assert.equal(engineLabel(null).short, 'Chromium');
});

test('compactDate is short and stable', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  assert.equal(compactDate(new Date(2026, 10, 19, 9, 5), now), 'Today 09:05');
  assert.equal(compactDate(new Date(2026, 1, 3, 18, 40), now), 'Feb 3, 18:40');
  assert.equal(compactDate(new Date(2024, 0, 9, 1, 2), now), 'Jan 9, 2024');
  assert.equal(compactDate(null, now), '');
  assert.equal(compactDate('not a date', now), '');
});

test('proxy label never exposes credentials', () => {
  assert.deepEqual(proxyLabel(null), { text: 'Direct', title: 'Direct connection', direct: true, authenticated: false });
  const px = proxyLabel({ type: 'http', host: 'h.example', port: 8080, username: 'alice', hasPassword: true });
  assert.equal(px.text, 'h.example:8080');
  assert.equal(px.title, 'http://h.example:8080');
  assert.equal(px.authenticated, true);
  assert.doesNotMatch(JSON.stringify(px), /alice/);
  assert.equal(proxyLabel({ name: 'Pool', type: 'socks5', host: 'x', port: 1 }).text, 'Pool');
});

test('verification level reflects only the checks that ran', () => {
  assert.equal(proxyVerificationLevel(null), null);
  assert.equal(proxyVerificationLevel({}).key, 'probe');
  assert.equal(proxyVerificationLevel({ browserExitVerifiedAt: 1 }).label, 'Browser exit checked at launch');
  assert.equal(proxyVerificationLevel({ browserExitVerifiedAt: 1, browserTimezoneVerifiedAt: 1 }).key, 'browser-timezone');
  assert.equal(proxyVerificationLevel({ browserVerifiedAt: 1 }).key, 'browser-full');
});

test('proxy evidence keeps every field the inline row used to show', () => {
  const loc = { ip: '203.0.113.9', city: 'Newark', region: 'NJ', country: 'US', timezone: 'America/New_York', utcOffsetMinutes: -300, latitude: 40.7357, longitude: -74.1724, radiusKm: null, source: 'DB-IP Lite', expiresAt: 186_400_000 };
  const fields = Object.fromEntries(proxyEvidenceFields(loc, d => d.toISOString()));
  assert.equal(fields['Proxy exit'], '203.0.113.9');
  assert.equal(fields['Approximate location'], 'Newark, NJ, US');
  assert.equal(fields['UTC offset'], '-300 min');
  assert.equal(fields.Coordinates, '40.74, -74.17');
  assert.equal(fields.Accuracy, 'Provider accuracy radius unavailable');
  assert.equal(fields.Verification, 'Proxy probe only');
  assert.equal(fields.Checked, new Date(100_000_000).toISOString());
  assert.match(proxyEvidenceSummary(loc), /^Proxy exit 203\.0\.113\.9 · Approx\.: Newark, NJ, US · America\/New_York · Proxy probe only$/);
  assert.deepEqual(proxyEvidenceFields(null), []);
});

test('native verification statements stay conservative', () => {
  assert.deepEqual(nativeVerification({ browserEngine: 'firefox', advancedSettings: { runtime: 'azwah-native' } }), []);
  assert.equal(isNativeRuntime({ advancedSettings: { runtime: 'azwah-native' } }), true);
  const stopped = Object.fromEntries(nativeVerification({ advancedSettings: { runtime: 'azwah-native' }, proxy: { host: 'x' }, running: false, lastProxyLocation: { browserExitVerifiedAt: 1 } }));
  assert.equal(stopped['Proxy exit'], 'No current browser verification');
  assert.equal(stopped['Geolocation API, DNS and WebRTC'], 'Not verified');
  assert.match(stopped['MAC isolation'], /^Unavailable/);
  const running = Object.fromEntries(nativeVerification({ advancedSettings: { runtime: 'azwah-native' }, proxy: { host: 'x' }, running: true, lastProxyLocation: { browserExitVerifiedAt: 1, nativeTimezoneVerifiedAt: 1 } }));
  assert.equal(running['Proxy exit'], 'Verified at startup');
  assert.equal(running.Timezone, 'Native ICU checked at startup');
  assert.deepEqual(nativeVerification({ advancedSettings: { runtime: 'azwah-native' } }).map(([k]) => k), ['MAC isolation']);
});

test('tab restore badge', () => {
  assert.equal(tabRestoreBadge(null), null);
  assert.equal(tabRestoreBadge({ enabled: false }), null);
  assert.deepEqual(tabRestoreBadge({ enabled: true, savedCount: 3 }, false), { text: 'Tabs 3', title: '3 tab(s) saved for next launch' });
  assert.equal(tabRestoreBadge({ enabled: true }, true).title, 'Tab restore on — saved on graceful stop');
});

test('cdp label keeps the endpoint visible as a port', () => {
  assert.equal(cdpLabel(null), null);
  assert.equal(cdpLabel({}), null);
  assert.deepEqual(cdpLabel({ debuggerAddress: '127.0.0.1:9333' }), { text: ':9333', endpoint: '127.0.0.1:9333' });
  assert.deepEqual(cdpLabel({ wsEndpoint: 'ws://127.0.0.1:41234/devtools/browser/abc', debuggerAddress: '127.0.0.1:41234' }), { text: ':41234', endpoint: 'ws://127.0.0.1:41234/devtools/browser/abc' });
  assert.equal(cdpLabel({ debuggerAddress: 'pipe' }).text, 'pipe');
});

test('Chrome Stable edition: the engine cell names the real browser and its launch mode', () => {
  const manual = engineLabel({ browserEngine: 'chromium', advancedSettings: { runtime: 'compatibility' }, chromeLaunchMode: { mode: 'manual', reasons: [] } });
  assert.deepEqual([manual.short, manual.full], ['Chrome Stable', 'Google Chrome Stable · manual browser (no remote control)']);
  const controlled = engineLabel({ browserEngine: 'chromium', advancedSettings: {}, chromeLaunchMode: { mode: 'controlled', reasons: ['proxy', 'timezone'] } });
  assert.equal(controlled.short, 'Chrome Stable');
  assert.match(controlled.full, /controlled.*proxy.*timezone/);
  assert.equal(engineLabel({ browserEngine: 'chromium', advancedSettings: {} }).short, 'Chromium', 'other editions unchanged');
});

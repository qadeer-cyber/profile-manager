import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationOrigin, permitsGeolocation, validateEngineConfig, validateProfileId } from '../engine-prototype/config.js';

const location = { latitude: 37.4, longitude: -122.1, accuracy: 65000 };
test('engine config validates identity, timezone and location without synthesizing accuracy', () => {
  assert.equal(validateProfileId('A0000000-0000-0000-0000-000000000001'), 'a0000000-0000-0000-0000-000000000001');
  assert.throws(() => validateProfileId('../personal-chrome'));
  assert.throws(() => validateEngineConfig({ version: 2 }));
  assert.throws(() => validateEngineConfig({ version: 1, timezone: 'Invalid/Zone' }));
  assert.throws(() => validateEngineConfig({ version: 1, location: { latitude: 1, longitude: 2 } }));
  assert.deepEqual(validateEngineConfig({ version: 1, location, timezone: 'America/Los_Angeles' }).location, location);
});
test('geolocation permission is scoped to the configured top-level HTTPS origin', () => {
  const origin = 'https://example.test';
  const config = validateEngineConfig({ version: 1, location, geolocationOrigin: origin });
  assert.equal(permitsGeolocation(config, origin, origin), true);
  assert.equal(permitsGeolocation(config, origin, 'https://another.test'), false);
  assert.equal(permitsGeolocation(config, 'https://another.test', origin), false);
  assert.equal(navigationOrigin('https://person:password@example.test'), null);
  assert.equal(navigationOrigin('file:///C:/secret'), null);
  assert.equal(navigationOrigin('http://127.0.0.1:8000'), null);
  assert.equal(navigationOrigin('http://127.0.0.1:8000', true), 'http://127.0.0.1:8000');
  assert.equal(navigationOrigin('http://example.test', true), null);
});

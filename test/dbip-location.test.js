import assert from 'node:assert/strict';
import test from 'node:test';
import { dbipRecordLocation, parseDbipRelease } from '../server/dbip-location.js';
import { resolveProxyLocation } from '../server/proxy-location.js';

const cases = [
  ['8.8.8.8', 'US', 37.422, -122.085, 'America/Los_Angeles', ['GMT-08:00', 'GMT-07:00']],
  ['1.1.1.1', 'DE', 52.52, 13.405, 'Europe/Berlin', ['GMT+01:00', 'GMT+02:00']],
  ['9.9.9.9', 'PK', 24.86, 67.01, 'Asia/Karachi', ['GMT+05:00', 'GMT+05:00']],
];
const location = ([ip, country, latitude, longitude]) =>
  dbipRecordLocation({ country: { iso_code: country }, location: { latitude, longitude } }, ip);
test('coordinate-based timezones use IANA summer and winter rules', () => {
  for (const row of cases) {
    const result = location(row);
    assert.equal(result.country, row[1]);
    assert.equal(result.timezone, row[4]);
    assert.equal(result.radiusKm, null);
    assert.equal(result.approximate, true);
    const format = new Intl.DateTimeFormat('en', { timeZone: result.timezone, timeZoneName: 'longOffset' });
    assert.deepEqual(['2026-01-15T12:00Z', '2026-07-15T12:00Z'].map(date =>
      format.formatToParts(new Date(date)).find(part => part.type === 'timeZoneName').value), row[5]);
  }
});
test('download integrity is bound to the MMDB release, not the CSV checksum', () => {
  const sha1 = 'a'.repeat(40);
  const html = '<dt>SHA1SUM</dt><dd>' + sha1 + '</dd></dl><div><a href="https://download.db-ip.com/free/dbip-city-lite-2026-11.mmdb.gz">';
  assert.deepEqual(parseDbipRelease(html), { sha1, month: '2026-11',
    url: 'https://download.db-ip.com/free/dbip-city-lite-2026-11.mmdb.gz' });
  assert.throws(() => parseDbipRelease(html.replace('download.db-ip.com', 'example.com')));
  assert.throws(() => dbipRecordLocation(null, '8.8.8.8'));
});
test('no credentials are needed, rotating exits invalidate cache and mismatches fail closed', async () => {
  const proxy = { id: 'auto', type: 'http', host: '127.0.0.1', port: 8888, username: 'test', password: 'test' };
  let row = cases[0];
  let cached;
  const options = {
    credentials: () => ({}), request: async () => ({ ip: row[0] }),
    offlineLookup: async () => location(row), read: () => cached, save: value => { cached = value; },
  };
  assert.equal((await resolveProxyLocation(proxy, options)).timezone, cases[0][4]);
  row = cases[1];
  assert.equal((await resolveProxyLocation(proxy, options)).timezone, cases[1][4]);
  await assert.rejects(resolveProxyLocation(proxy, { ...options, read: undefined, offlineLookup: async () => location(cases[0]) }), /did not confirm/);
  await assert.rejects(resolveProxyLocation(proxy, { ...options, read: undefined, offlineLookup: async () => { throw new Error('unavailable'); } }), /could not be verified/);
});

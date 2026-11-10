import assert from 'node:assert/strict';
import test from 'node:test';
import { publicIp, probeProxyExit, resolveProxyLocation, validateProxyLocation } from '../server/proxy-location.js';

const ip = '8.8.8.8';
const fixture = {
  traits: { ip_address: ip },
  location: { latitude: 37.4, longitude: -122.1, accuracy_radius: 65, time_zone: 'America/Los_Angeles' },
  country: { iso_code: 'US' },
};
const proxy = { id: 'first', type: 'socks5', host: '127.0.0.1', port: 1234, username: 'synthetic', password: 'secret' };

test('rejects private, local, special and invalid proxy IPs', () => {
  for (const candidate of ['10.1.1.1', '127.0.0.1', '100.64.0.1', '203.0.113.2', '::1', '::ffff:8.8.8.8', 'fe80::1', '2001:db8::1', '999.1.1.1', null]) {
    assert.equal(publicIp(candidate), null, String(candidate));
  }
  assert.equal(publicIp(ip), ip);
  assert.equal(publicIp('2606:4700:0000::1111'), '2606:4700::1111');
});

test('requires matching IP, IANA timezone and provider accuracy', () => {
  assert.equal(validateProxyLocation(fixture, ip).accuracy, 65000);
  assert.throws(() => validateProxyLocation(fixture, '1.1.1.1'), /did not confirm/);
  for (const patch of [{ accuracy_radius: undefined }, { time_zone: 'invalid/zone' }, { latitude: 100 }]) {
    assert.throws(() => validateProxyLocation({ ...fixture, location: { ...fixture.location, ...patch } }, ip), /GeoIP/);
  }
});

test('reprobes each launch, caches only matching live exit and rejects exit rotation', async () => {
  const { AZWAH_MAXMIND_ACCOUNT_ID: oldAccount, AZWAH_MAXMIND_LICENSE_KEY: oldKey } = process.env;
  process.env.AZWAH_MAXMIND_ACCOUNT_ID = 'fixture-account';
  process.env.AZWAH_MAXMIND_LICENSE_KEY = 'fixture-key';
  let cached, count = 0;
  const calls = [];
  const request = async (url, agent, headers) => {
    assert.equal(agent.shouldLookup, false, 'SOCKS performs remote target DNS');
    calls.push([new URL(url).hostname, Boolean(headers)]);
    if (url.includes('maxmind')) return fixture;
    return { ip: ++count >= 4 ? '1.1.1.1' : ip };
  };
  const config = { request, read: () => cached, save: value => { cached = value; }, now: () => 1000 };
  try {
    const first = await resolveProxyLocation(proxy, config);
    assert.equal(first.ip, ip);
    assert.equal(first.approximate, true);
    assert.equal(await resolveProxyLocation(proxy, config), first);
    assert.deepEqual(calls, [['api64.ipify.org', false], ['geoip.maxmind.com', true], ['api64.ipify.org', false], ['api64.ipify.org', false]]);
    await assert.rejects(resolveProxyLocation(proxy, config), /did not confirm/);
    count = 0;
    let observations = 0;
    await assert.rejects(resolveProxyLocation({ ...proxy, id: 'second' }, {
      ...config,
      request: async url => url.includes('maxmind') ? fixture : { ip: ++observations === 1 ? ip : '1.1.1.1' },
    }), /changed during/);
    assert.equal(cached, first);
  } finally {
    if (oldAccount == null) delete process.env.AZWAH_MAXMIND_ACCOUNT_ID; else process.env.AZWAH_MAXMIND_ACCOUNT_ID = oldAccount;
    if (oldKey == null) delete process.env.AZWAH_MAXMIND_LICENSE_KEY; else process.env.AZWAH_MAXMIND_LICENSE_KEY = oldKey;
  }
});

test('revalidates GeoIP after editing the assigned proxy even when its exit IP is unchanged', async () => {
  let cached;
  let lookups = 0;
  const options = {
    credentials: () => ({ account: 'fixture-account', license: 'fixture-key' }),
    read: () => cached,
    save: value => { cached = value; },
    now: () => 1000,
    request: async url => {
      if (!url.includes('maxmind')) return { ip };
      lookups++;
      return fixture;
    },
  };
  const assignment = { ...proxy, revision: 'revision-one' };
  const first = await resolveProxyLocation(assignment, options);
  assert.equal(first.proxyRevision, 'revision-one');
  assert.equal(await resolveProxyLocation(assignment, options), first);
  const updated = await resolveProxyLocation({ ...assignment, revision: 'revision-two' }, options);
  assert.equal(updated.proxyRevision, 'revision-two');
  assert.equal(updated.ip, first.ip);
  assert.equal(lookups, 2);
});

test('keeps simultaneous proxy GeoIP identities distinct and preserves IANA DST rules', async () => {
  const cases = [
    { ip: '8.8.8.8', timezone: 'America/Los_Angeles', offsets: ['GMT-08:00', 'GMT-07:00'] },
    { ip: '1.1.1.1', timezone: 'Europe/Berlin', offsets: ['GMT+01:00', 'GMT+02:00'] },
    { ip: '9.9.9.9', timezone: 'Asia/Karachi', offsets: ['GMT+05:00', 'GMT+05:00'] },
  ];
  const results = await Promise.all(cases.map((row, index) => resolveProxyLocation({ ...proxy, id: 'proxy-' + index }, {
    credentials: () => ({ account: 'fixture', license: 'fixture' }),
    request: async url => url.includes('maxmind') ? {
      traits: { ip_address: row.ip },
      location: { latitude: index, longitude: index, accuracy_radius: 25, time_zone: row.timezone },
    } : { ip: row.ip },
  })));
  for (const [index, result] of results.entries()) {
    const row = cases[index];
    assert.equal(result.ip, row.ip);
    assert.equal(result.timezone, row.timezone);
    assert.equal(result.latitude, index);
    assert.equal(result.accuracy, 25000);
    const format = new Intl.DateTimeFormat('en-US', { timeZone: result.timezone, timeZoneName: 'longOffset' });
    const offsets = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']
      .map(date => format.formatToParts(new Date(date)).find(part => part.type === 'timeZoneName').value);
    assert.deepEqual(offsets, row.offsets);
  }
});

test('inventory probe verifies an exit without a GeoIP lookup and GeoLite uses its own trusted origin', async () => {
  const calls = [];
  const request = async (url, agent, headers) => {
    assert.equal(agent.shouldLookup, false);
    calls.push([new URL(url).hostname, Boolean(headers?.Authorization)]);
    return new URL(url).hostname === 'geolite.info' ? fixture : { ip };
  };
  assert.equal((await probeProxyExit(proxy, { request })).ip, ip);
  const result = await resolveProxyLocation(proxy, {
    request, service: 'geolite', credentials: () => ({ account: 'fixture', license: 'fixture' }),
    read: () => ({ ip, proxyId: proxy.id, expiresAt: Infinity, source: 'MaxMind GeoIP City' }),
  });
  assert.equal(result.source, 'MaxMind GeoLite City');
  assert.deepEqual(calls, [['api64.ipify.org', false], ['api64.ipify.org', false], ['geolite.info', true], ['api64.ipify.org', false]]);
});

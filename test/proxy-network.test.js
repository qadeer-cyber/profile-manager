// Owner-approved diagnostic: show which network a proxy's exit IP belongs to (offline DB-IP ASN Lite) and say
// plainly when the network owner is a known hosting/cloud provider, a common reason sites challenge even
// ordinary Chrome. Diagnosis only: nothing about the browser is changed or hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDbipRelease, classifyNetwork, dbipRecordNetwork } from '../server/dbip-location.js';

test('the ASN release page is parsed with its own file prefix', () => {
  const html = '<dl><dt>SHA1SUM</dt><dd class="x">' + 'a'.repeat(40) + '</dd></dl><div><a href="https://download.db-ip.com/free/dbip-asn-lite-2026-11.mmdb.gz">x</a>';
  assert.deepEqual(parseDbipRelease(html, 'dbip-asn-lite'), { url: 'https://download.db-ip.com/free/dbip-asn-lite-2026-11.mmdb.gz', month: '2026-11', sha1: 'a'.repeat(40) });
  assert.throws(() => parseDbipRelease(html), e => e.code === 'PROXY_LOCATION_UNAVAILABLE', 'the city parser does not accept the ASN file');
});

test('known hosting and cloud networks are named; anything else is not guessed', () => {
  for (const org of ['Amazon.com, Inc.', 'Google LLC', 'Microsoft Corporation', 'DigitalOcean, LLC', 'OVH SAS', 'Hetzner Online GmbH', 'M247 Europe SRL', 'Leaseweb Netherlands B.V.', 'Contabo GmbH', 'Akamai Connected Cloud', 'The Constant Company, LLC', 'Datacamp Limited', 'Example Hosting Ltd', 'Some Data Center Inc']) {
    assert.equal(classifyNetwork(org).type, 'hosting', org);
  }
  for (const org of ['Comcast Cable Communications, LLC', 'Pakistan Telecommunication Company Limited', 'Deutsche Telekom AG', '', null]) {
    assert.equal(classifyNetwork(org).type, 'unknown', String(org));
  }
});

test('an ASN record becomes a network summary', () => {
  assert.deepEqual(dbipRecordNetwork({ autonomous_system_number: 16509, autonomous_system_organization: 'Amazon.com, Inc.' }, '203.0.113.7'),
    { ip: '203.0.113.7', asn: 16509, organization: 'Amazon.com, Inc.', type: 'hosting', source: 'DB-IP ASN Lite' });
  assert.deepEqual(dbipRecordNetwork({ autonomous_system_number: 7922, autonomous_system_organization: 'Comcast Cable Communications, LLC' }, '198.51.100.9'),
    { ip: '198.51.100.9', asn: 7922, organization: 'Comcast Cable Communications, LLC', type: 'unknown', source: 'DB-IP ASN Lite' });
  assert.throws(() => dbipRecordNetwork(null, '192.0.2.1'), e => e.code === 'PROXY_NETWORK_UNAVAILABLE');
});

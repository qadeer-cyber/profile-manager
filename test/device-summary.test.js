// Device card and MAC lookup: the device a profile reports, the MAC query parser, and the API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deviceSummaryFor, gpuDisplayName, windowsName, deviceCode } from '../server/device-summary.js';
import { normalizeMacQuery, deriveMacLabel } from '../server/mac-label.js';
import { nativeIdentityFor } from '../server/browser-runtime/native-identity.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { queryProfiles } from '../server/profile-table.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('GPU names are shown the way a person reads them', () => {
  assert.equal(gpuDisplayName('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'Intel UHD Graphics 620');
  assert.equal(gpuDisplayName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'NVIDIA GeForce RTX 3060');
  assert.equal(gpuDisplayName('Something else'), 'Something else');
  assert.equal(windowsName('10.0.0'), 'Windows 10'); assert.equal(windowsName('15.0.0'), 'Windows 11'); assert.equal(windowsName('19.0.0'), 'Windows 11');
});

test('a profile with hardware identity reports exactly the identity the browser is given', () => {
  const profile = { id: 'profile-a', macLabel: '02:AB:CD:EF:01:23', advancedSettings: { runtime: 'azwah-native', experimental: { hardwareIdentity: 'prototype' }, deviceName: ' Ali laptop ' } };
  const d = deviceSummaryFor(profile);
  const id = nativeIdentityFor('profile-a');
  assert.equal(d.source, 'profile');
  assert.equal(d.facts.cores, id.hardwareConcurrency); assert.equal(d.facts.memoryGiB, id.deviceMemory); assert.equal(d.facts.screen, id.screen);
  assert.match(d.reportsAs, /^Windows (10|11) PC · .+ · \d+ cores · \d+ GB · \d+×\d+$/);
  assert.equal(d.name, 'Ali laptop'); assert.ok(d.label.startsWith('Ali laptop · Windows'));
  assert.equal(d.mac, '02:AB:CD:EF:01:23');
  assert.match(d.code, /^DEV-[0-9A-F]{6}$/); assert.equal(d.code, deviceCode('02:ab:cd:ef:01:23'), 'the code does not depend on letter case');
  // A new fingerprint generation changes what the device reports, as it changes what the browser reports.
  const next = deviceSummaryFor({ ...profile, advancedSettings: { ...profile.advancedSettings, experimental: { hardwareIdentity: 'prototype', seedEpoch: 1 } } });
  assert.deepEqual(next.facts, (({ platformVersion, webglRenderer, hardwareConcurrency, deviceMemory, screen }) => ({ os: windowsName(platformVersion), gpu: gpuDisplayName(webglRenderer), cores: hardwareConcurrency, memoryGiB: deviceMemory, screen }))(nativeIdentityFor('profile-a', 1)));
});

test('without hardware identity the device is this computer; a declared preset says it is only declared', () => {
  const plain = deviceSummaryFor({ id: 'x', macLabel: deriveMacLabel('x'), advancedSettings: { runtime: 'azwah-native' } });
  assert.deepEqual([plain.source, plain.reportsAs, plain.name, plain.facts], ['host', 'This computer (real hardware)', null, null]);
  const declared = deviceSummaryFor({ id: 'x', macLabel: deriveMacLabel('x'), advancedSettings: { deviceIdentity: { preset: 'windows-11' } } });
  assert.equal(declared.source, 'declared'); assert.match(declared.reportsAs, /Windows 11 desktop \(declared/);
});

test('MAC queries: any separator style works, fragments need 4 digits, junk is refused', () => {
  for (const text of ['02:AB:CD:EF:01:23', '02-ab-cd-ef-01-23', '02ab.cdef.0123', '02abcdef0123', ' 02:ab:cd:ef:01:23 ']) assert.deepEqual(normalizeMacQuery(text), { hex: '02abcdef0123', full: true }, text);
  assert.deepEqual(normalizeMacQuery('AB:CD'), { hex: 'abcd', full: false });
  for (const bad of ['', 'ab', 'a:b:c', 'zz:zz:zz', '02:AB:CD:EF:01:23:45', 'hello world', '02:AB:CD:EF:01:2G']) assert.throws(() => normalizeMacQuery(bad), e => e.status === 400 && e.code === 'INVALID_MAC_QUERY', JSON.stringify(bad));
});

test('deviceName: trimmed, optional, bounded, and cleared by an empty value', () => {
  assert.equal(validateAdvancedSettings({ deviceName: '  Dell Latitude  ' }).deviceName, 'Dell Latitude');
  assert.equal('deviceName' in validateAdvancedSettings({ deviceName: '   ' }), false);
  assert.equal('deviceName' in validateAdvancedSettings({ deviceName: '' }, { ...validateAdvancedSettings({}), deviceName: 'Old' }), false, 'empty clears a saved name');
  for (const bad of ['x'.repeat(61), 'line\nbreak', 123, {}]) assert.throws(() => validateAdvancedSettings({ deviceName: bad }), /deviceName/);
});

test('the profile search box finds a profile by MAC (any format, fragment) and by device name', () => {
  const row = (name, mac, deviceName) => ({ id: name, name, notes: '', tags: [], folder: '', macLabel: mac, advancedSettings: deviceName ? { deviceName } : {} });
  const rows = [row('a', '02:AB:CD:EF:01:23', 'Dell Latitude'), row('b', '06:11:22:33:44:55'), row('c', '0A:AB:00:00:00:01')];
  const find = q => queryProfiles(rows, { q, folder: '__all' }).items.map(r => r.id).sort();
  assert.deepEqual(find('02:ab:cd'), ['a']); assert.deepEqual(find('02abcdef0123'), ['a']); assert.deepEqual(find('02-AB-CD-EF-01-23'), ['a']);
  assert.deepEqual(find('ab'), ['a', 'c'], 'a short query is plain text matched against the label as written');
  assert.deepEqual(find('zz'), [], 'and matches nothing it should not');
  assert.deepEqual(find('3344'), ['b']); assert.deepEqual(find('latitude'), ['a']);
});

test('API: lookup by MAC returns the profile and its device; the profile list carries the device; fragments and errors behave', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-device-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'dv' });
  const h = { Authorization: 'Bearer dv', 'Content-Type': 'application/json' };
  const call = (method, route, body) => fetch(proc.url + route, { method, headers: h, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  try {
    const created = (await call('POST', '/api/v1/profiles', { name: 'Shop US 01', advancedSettings: { macLabel: '02:AB:CD:EF:01:23', macLabelMode: 'manual', deviceName: 'Ali Dell laptop' } })).body;
    await call('POST', '/api/v1/profiles', { name: 'Other', advancedSettings: { macLabel: '06:11:22:33:44:55', macLabelMode: 'manual' } });
    assert.equal(created.device.name, 'Ali Dell laptop'); assert.equal(created.device.mac, '02:AB:CD:EF:01:23'); assert.match(created.device.code, /^DEV-/);
    const full = (await call('GET', '/api/mac-lookup?mac=02-ab-cd-ef-01-23')).body;
    assert.equal(full.matches.length, 1); assert.deepEqual([full.matches[0].name, full.matches[0].exact, full.matches[0].device.name], ['Shop US 01', true, 'Ali Dell laptop']);
    const part = (await call('GET', '/api/mac-lookup?mac=ef:01')).body;
    assert.deepEqual([part.full, part.matches.map(m => m.name)], [false, ['Shop US 01']]);
    assert.deepEqual((await call('GET', '/api/mac-lookup?mac=ff:ff:ff:ff:ff:ff')).body.matches, []);
    assert.equal((await call('GET', '/api/mac-lookup?mac=ab')).status, 400);
    assert.equal((await call('GET', '/api/mac-lookup')).status, 400);
    const found = (await call('GET', '/api/profile-table?q=EF01')).body;
    assert.deepEqual(found.items.map(p => p.name), ['Shop US 01']);
    assert.equal((await call('POST', '/api/v1/profiles', { name: 'Bad', advancedSettings: { deviceName: 'x'.repeat(61) } })).status, 400);
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

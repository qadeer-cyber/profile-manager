// Owner-chosen: each profile has its own saved MAC label. Websites cannot read a MAC address, so the
// label is never passed to Chrome and AZWAH never changes a network adapter; the UI says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMacLabel, randomMacLabel, validateMacLabel, MAC_LABEL_NOTE } from '../server/mac-label.js';

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const localUnicast = mac => (parseInt(mac.slice(0, 2), 16) & 0b11) === 0b10;

test('a profile id gives a stable, locally administered unicast MAC label', () => {
  const a = deriveMacLabel('5b0c2f9e-1111-4c1a-9d1e-aaaaaaaaaaaa');
  assert.match(a, MAC);
  assert.ok(localUnicast(a), a);
  assert.equal(deriveMacLabel('5b0c2f9e-1111-4c1a-9d1e-aaaaaaaaaaaa'), a, 'stable');
  const many = new Set(Array.from({ length: 2000 }, (_, i) => deriveMacLabel('id-' + i)));
  assert.equal(many.size, 2000, 'different profiles get different labels');
});

test('regenerated labels are valid and differ', () => {
  const r = randomMacLabel();
  assert.match(r, MAC);
  assert.ok(localUnicast(r));
  assert.notEqual(randomMacLabel(), r);
});

test('validation normalizes case and separators and refuses multicast or malformed values', () => {
  assert.equal(validateMacLabel('02-ab-cd-ef-01-23'), '02:AB:CD:EF:01:23');
  for (const bad of ['01:00:5E:00:00:01', '02:AB:CD', 'zz:zz:zz:zz:zz:zz', 42]) {
    assert.throws(() => validateMacLabel(bad), e => e.code === 'INVALID_MAC_LABEL', String(bad));
  }
  assert.match(MAC_LABEL_NOTE, /cannot read/);
});

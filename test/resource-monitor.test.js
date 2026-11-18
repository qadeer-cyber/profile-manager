import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostResourceSample, processMemoryMiB, profileResourceRows } from '../server/resource-monitor.js';

test('host resource sample reports real totals', () => {
  const sample = hostResourceSample();
  assert.ok(sample.totalMemGiB > 0);
  assert.ok(sample.freeMemGiB >= 0);
  assert.equal(typeof sample.cpuCount, 'number');
});

test('process memory uses proc on Linux when available', () => {
  const self = processMemoryMiB(process.pid);
  if (process.platform === 'linux') {
    assert.ok(self != null && self > 0);
  } else {
    assert.equal(self, null);
  }
  const rows = profileResourceRows([{ id: 'x', name: 'X', pid: process.pid }]);
  assert.equal(rows.profiles[0].id, 'x');
});

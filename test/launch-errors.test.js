import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLaunchError } from '../server/launch-errors.js';

test('launch errors include actionable categories', () => {
  const low = classifyLaunchError(Object.assign(new Error('low mem'), { code: 'LOW_MEMORY' }));
  assert.equal(low.category, 'resources');
  assert.match(low.action, /minFreeMemoryGiB/);
  const cancel = classifyLaunchError(Object.assign(new Error('nope'), { code: 'LAUNCH_CANCELLED' }));
  assert.equal(cancel.category, 'cancelled');
});

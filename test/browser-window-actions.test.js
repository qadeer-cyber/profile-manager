import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateRunningBrowserSession } from '../server/browser-window-actions.js';

test('locate on non-Windows returns unavailable without throwing', async () => {
  if (process.platform === 'win32') return;
  const out = await locateRunningBrowserSession({ pid: 12345, cdpPort: null });
  assert.equal(out.availability, 'unavailable');
  assert.match(out.reason, /windows/i);
});

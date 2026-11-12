import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('launch guard compares available bytes without rounding up to the minimum', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-memory-guard-'));
  process.env.PM_DATA_DIR = dir;
  const { db, setSetting } = await import('../server/db.js');
  try {
    const { assertLaunchResources } = await import('../server/launch-limits.js');
    setSetting('minFreeMemoryGiB', 1);
    const threshold = 1024 ** 3;
    assert.throws(() => assertLaunchResources(0, { freeMemBytes: Math.floor(threshold * 0.75) }), { code: 'LOW_MEMORY' });
    assert.doesNotThrow(() => assertLaunchResources(0, { freeMemBytes: threshold }));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

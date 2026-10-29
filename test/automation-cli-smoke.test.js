import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('pm-cli help exits 0', () => {
  const r = spawnSync(process.execPath, [path.join('scripts', 'pm-cli.mjs'), 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /list/);
});

test('pm-cli without token exits non-zero', () => {
  const env = { ...process.env, PM_API_TOKEN: '' };
  delete env.PM_API_TOKEN;
  const r = spawnSync(process.execPath, [path.join('scripts', 'pm-cli.mjs'), 'list'], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
});

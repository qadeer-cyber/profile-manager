import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseWindowsProcessRows,
  buildProfileProcessMetrics,
  aggregateBrowserMemory,
  chromeProcessRole,
} from '../server/process-catalog.js';

const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/win32-chrome-processes.json'), 'utf8'));

test('Windows fixture rows parse and classify Chromium roles', () => {
  const rows = parseWindowsProcessRows(fixture);
  assert.equal(rows.length, 4);
  assert.equal(chromeProcessRole(rows[1].commandLine), 'gpu');
  assert.equal(chromeProcessRole(rows[3].commandLine), 'renderer');
});

test('profile metrics assign processes by user-data-dir without double counting totals', () => {
  const rows = parseWindowsProcessRows(fixture);
  const profiles = buildProfileProcessMetrics([
    { id: 'aaa', name: 'A', pid: 4000, userDataDir: 'C:\\Data\\profiles\\aaa' },
    { id: 'bbb', name: 'B', pid: 5000, userDataDir: 'C:\\Data\\profiles\\bbb' },
  ], rows, { platform: 'win32' }).profiles;
  assert.equal(profiles[0].processCount, 2);
  assert.equal(profiles[1].processCount, 2);
  const total = aggregateBrowserMemory(profiles);
  assert.ok(total > 200);
  assert.ok(total < 400);
});

test('terminated or unknown processes are omitted from fixture assignment', () => {
  const rows = parseWindowsProcessRows([]);
  const profiles = buildProfileProcessMetrics([
    { id: 'x', userDataDir: 'C:\\missing', pid: 1 },
  ], rows, { platform: 'win32' }).profiles;
  assert.equal(profiles[0].processCount, 0);
  assert.equal(profiles[0].memoryMiB, null);
});

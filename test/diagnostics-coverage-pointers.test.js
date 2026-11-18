/**
 * Hygiene for the M2 scaffold todos that already have an executing test.
 * A pointer passes only when the cited test name is still present. It does not
 * re-run that test and it is not Windows evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const POINTERS = [
  ['test/diagnostics-gate.live.test.js', '§8 (row E1): GET on a disconnected browser'],
  ['test/diagnostics-live.test.js', 'real Chromium 156: OS process identity, foreground probe, cancellation and launch invalidation'],
  ['test/diagnostics-gate.live.test.js', '§8 429 DIAGNOSTICS_BUSY on overlap'],
  ['test/diagnostics-e4-merge-gate.test.js', 'E4 idle: zero profile-diagnostics requests for 60 seconds'],
  ['test/diagnostics-e4-merge-gate.test.js', 'E4 restart: no observation cache, stale lock cleanup'],
  ['test/diagnostics-gate.live.test.js', '§7.9 tab stays open after success'],
  ['test/diagnostics-gate.live.test.js', '§2/§8 (row E6): launching / stopping'],
  ['test/diagnostics-gate.live.test.js', 'case 6 / §8: relaunch'],
  ['test/diagnostics-gate.live.test.js', 'case 3 (row E11)'],
  ['test/diagnostics-gate.live.test.js', '§7.8 (row E13)'],
  ['test/diagnostics-gate.live.test.js', '§10 no debugging TCP port'],
  ['test/diagnostics-gate.live.test.js', '§7.11 (row S8)'],
  ['test/diagnostics-recovery.test.js', 'HTTP auth before JSON, trailing slash errors, desktop/API separation'],
  ['test/diagnostics-unit.test.js', 'assert.equal(fn, diagnostics.readDiagnosticEnvironment)'],
  ['test/diagnostics-security.test.js', '§5 does not impose an automation /api/v1 GET-only rule'],
  ['test/lifecycle.e2e.js', 'lifecycle'],
];

test('stale M2 scaffold markers point at tests that still exist', () => {
  const e2e = read('test/diagnostics.e2e.js');
  const security = read('test/diagnostics-security.test.js');
  assert.equal(e2e.includes("todo: 'Pinned Chromium 156 integration required"), false);
  assert.equal(security.includes('Live pinned Chromium and backend integration acceptance pending'), false);
  assert.match(e2e, /PENDING case 5: forced taskkill/);
  assert.match(e2e, /PENDING §10 Windows: no extra debugging TCP port/);
  for (const [file, needle] of POINTERS) {
    assert.ok(read(file).includes(needle), `${file} is missing ${needle}`);
  }
});

// The chain can continue from an earlier run's last hand-over instead of starting from zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wf = fs.readFileSync(new URL('../.github/workflows/azwah-chromium-chain.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('resume input exists and defaults to starting from zero', () => {
  assert.match(wf, /workflow_dispatch:\n    inputs:\n      resume_run_id:/);
  assert.match(wf, /default: ''/);
});

test('resume downloads both hand-overs from the named run, only in stage 1, and refuses a missing build directory', () => {
  for (const kind of ['sccache', 'ninja-out']) {
    assert.ok(wf.includes(`name: azwah-${kind}-\${{ inputs.resume_run_id }}\n          run-id: \${{ inputs.resume_run_id }}`), kind);
  }
  const conds = wf.match(/if: github\.job == 'stage-1' && inputs\.resume_run_id != ''/g) || [];
  assert.equal(conds.length, 3);
  assert.match(wf, /Resume requested but no build directory/);
  assert.match(wf, /actions: read/);
});

test('hand-over artifacts live long enough to resume', () => {
  assert.doesNotMatch(wf, /retention-days: [12]\n/);
});

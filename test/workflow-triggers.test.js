// What a push to feature/azwah-ultimate-2 can start (audited 2026-11-21). The expensive Chromium chain must
// start only on its commit-message tag or a manual dispatch; later stages only continue a budget-stopped
// stage; evidence steps can never block the cache hand-over; and nothing publishes a release from this branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = new URL('../.github/workflows/', import.meta.url);
const load = name => {
  // Windows checkouts use CRLF line endings.
  const text = fs.readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n');
  return { text };
};
const BRANCH = 'feature/azwah-ultimate-2';
const TAG = '[' + 'chromium-chain' + ']';

test('the Chromium chain starts only on its tag or a manual dispatch', () => {
  const { text } = load('azwah-chromium-chain.yml');
  assert.match(text, /on:\n  push:\n    branches: \[feature\/azwah-ultimate-2\]\n  workflow_dispatch:/);
  const qualify = text.slice(text.indexOf('  qualify:'), text.indexOf('  stage-1:'));
  assert.match(qualify, /github\.event_name == 'workflow_dispatch'/);
  assert.ok(qualify.includes(`contains(github.event.head_commit.message, '${TAG}')`), 'tag gate');
  for (let n = 1; n <= 6; n++) {
    const start = text.indexOf(`  stage-${n}:`);
    assert.ok(start > 0, `stage-${n}`);
    const job = text.slice(start, n < 6 ? text.indexOf(`  stage-${n + 1}:`) : undefined);
    assert.match(job, new RegExp(`needs: ${n === 1 ? 'qualify' : `stage-${n - 1}`}\\n`));
    if (n > 1) assert.match(job, new RegExp(`if: needs\\.stage-${n - 1}\\.outputs\\.complete == 'false'`), 'continues only a budget-stopped stage');
    const minutes = Number(/timeout-minutes: (\d+)/.exec(job)[1]);
    assert.ok(minutes <= 360, 'within the free hosted-runner job limit');
  }
});

test('evidence steps cannot fail a stage; the hand-over runs whenever the build stopped at its budget or finished', () => {
  const { text } = load('azwah-chromium-chain.yml');
  for (const name of ['Compiler cache statistics', 'Record build inputs for cache diagnosis', 'Upload build-input diagnostics']) {
    const at = text.indexOf(`- name: ${name}`);
    assert.ok(at > 0, name);
    assert.match(text.slice(at, at + 400), /continue-on-error: true/, name);
  }
  const both = /if: \$\{\{ !cancelled\(\) && \(steps\.build\.outputs\.complete == 'false' \|\| steps\.build\.outputs\.complete == 'true'\) \}\}/;
  for (const name of ['Hand the compiler cache to the next job', 'Pack the Ninja build directory for the next job']) {
    const at = text.indexOf(`- name: ${name}`);
    assert.ok(at > 0, name);
    assert.match(text.slice(at, at + 400), both, name);
  }
  const smoke = text.indexOf('- name: Verify and smoke-test the finished browser');
  assert.ok(text.indexOf('- name: Hand the compiler cache to the next job') < smoke, 'hand-over happens before the smoke test can fail');
});

test('no workflow publishes a release on a push to this branch', () => {
  for (const file of fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(fileURLToPath(dir), file), 'utf8');
    if (!text.includes(BRANCH)) continue;
    assert.doesNotMatch(text, /softprops\/action-gh-release|gh release create|actions\/create-release/, `${file} would publish a release`);
  }
});

test('the chain tag does not appear in this repository\'s own workflow descriptions by accident', () => {
  // A commit message that merely mentions the tag starts a multi-hour build; keep the literal out of docs and
  // templates that might be pasted into a commit message.
  const docs = fs.readdirSync(new URL('../docs/', import.meta.url)).filter(f => f.endsWith('.md'));
  for (const f of docs) {
    assert.ok(!fs.readFileSync(new URL(`../docs/${f}`, import.meta.url), 'utf8').includes(TAG), `docs/${f} contains the chain tag`);
  }
});

test('the AZWAH Chromium live qualification starts only on its tag or a manual dispatch', () => {
  const { text } = load('azwah-native-live.yml');
  const job = text.slice(text.indexOf('  live:'));
  assert.match(job, /github\.event_name == 'workflow_dispatch'/);
  assert.ok(job.includes("contains(github.event.head_commit.message, '[" + "azwah-native-live]')"), 'tag gate');
});

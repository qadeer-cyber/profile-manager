import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionCommandArgs } from '../server/extensions.js';
import { launchShapeReport, dnsDualStack } from '../server/google-compat-report.js';

test('profiles without extensions ignore Playwright --disable-extensions default', () => {
  const plan = extensionCommandArgs([]);
  assert.deepEqual(plan.ignoreDefaultArgs, ['--disable-extensions']);
  assert.deepEqual(plan.args, []);
});

test('google compat report lists architectural deltas and mitigations', () => {
  const r = launchShapeReport(null);
  assert.equal(r.mitigations.ignoreDisableExtensionsWhenNoExtensions, true);
  assert.ok(Array.isArray(r.playwrightInjectedSwitches));
  assert.ok(r.classification.knownArchitecturalDeltas.length >= 2);
});

test('dns dual-stack probe returns structured A/AAAA lists', async () => {
  const d = await dnsDualStack('localhost');
  assert.equal(d.host, 'localhost');
  assert.ok(Array.isArray(d.a) || Array.isArray(d.aaaa));
});

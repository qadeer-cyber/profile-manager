// UI status and notification helpers (web/src/lib.js): pure functions, no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, rowStatus, crashSummary, makeDedupe, refreshesNow, toastKey } from '../web/src/lib.js';

test('normal close: no running row and no error shows Stopped', () => {
  assert.equal(statusOf({ running: false, last_error: null }), 'stopped');
  assert.deepEqual(rowStatus({ running: false, last_error: null }), { key: 'stopped', label: 'Stopped', showError: false });
});
test('real crash shows Error with the message', () => {
  const r = rowStatus({ running: false, last_error: 'Browser exited unexpectedly (exit code 1, exit_type Crashed)' });
  assert.equal(r.key, 'error'); assert.equal(r.showError, true);
});
test('running wins over a stale error', () => {
  assert.equal(rowStatus({ running: true, last_error: 'old' }).key, 'running');
});
test('relaunch in flight hides the previous error and shows Starting', () => {
  assert.deepEqual(rowStatus({ running: false, last_error: 'old crash' }, true), { key: 'stopped', label: 'Starting', showError: false });
});
test('crash summaries are plain language and actionable', () => {
  assert.match(crashSummary('Browser process died (detected by health monitor) (exit code 1, exit_type Crashed)'), /ended outside Profile Manager.*Launch the profile again/);
  assert.match(crashSummary('Browser exited unexpectedly (exit_type missing)'), /closed unexpectedly.*Diagnostics/);
  assert.match(crashSummary('Browser exited unexpectedly (signal SIGKILL)'), /closed unexpectedly/);
  assert.equal(crashSummary('Failed to launch browser: proxy refused'), 'Failed to launch browser: proxy refused');
  assert.equal(crashSummary(''), 'The browser closed unexpectedly.');
});
test('identical notifications within the window show once', () => {
  let t = 0; const ok = makeDedupe(2000, () => t);
  assert.equal(ok('error|A crashed'), true);
  assert.equal(ok('error|A crashed'), false);
  assert.equal(ok('error|B crashed'), true);
  t = 2000; assert.equal(ok('error|A crashed'), true);
});
test('every profile lifecycle event refreshes the list immediately', () => {
  for (const type of ['profile:started', 'profile:stopped', 'profile:crashed', 'profile:launch-failed']) assert.equal(refreshesNow({ type }), true, type);
  assert.equal(refreshesNow({ type: 'browser:install' }), false);
  assert.equal(refreshesNow(null), false);
});
test('dedupe never hides a separate real failure', () => {
  const ok = makeDedupe(2000, () => 0), msg = 'P1: The browser closed unexpectedly.';
  assert.equal(ok(toastKey('error', msg, 'profile:crashed|p1|T1')), true);
  assert.equal(ok(toastKey('error', msg, 'profile:crashed|p1|T1')), false, 're-delivered event collapses');
  assert.equal(ok(toastKey('error', msg, 'profile:crashed|p1|T2')), true, 'second crash, same text, still shows');
  assert.equal(ok(toastKey('error', msg, 'profile:crashed|p2|T1')), true, 'other profile still shows');
  assert.notEqual(toastKey('error', 'x'), toastKey('info', 'x'));
});

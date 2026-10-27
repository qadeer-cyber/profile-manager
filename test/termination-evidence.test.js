import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { captureTermination, waitForTermination, readPreferences, observePreferences, processCorrelation } from '../server/termination-evidence.js';
import { terminationOutcome, waitForCloseEvidence } from '../server/browsers.js';

const makeChild = pid => Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null });
const launch = (value = 'Normal') => ({ launchId: 'current', stopping: false, stillAlive: false,
  exitCode: null, exitSignal: null, exitTypeFresh: false,
  preferencesBaseline: { state: 'ok', value, digest: 'old' }, processCorrelation: 'same-pid-owned' });

test('PID correlation distinguishes browser, legitimate launcher ancestry, mismatch and missing ownership', () => {
  assert.equal(processCorrelation(7, 7, true), 'same-pid-owned');
  assert.equal(processCorrelation(5, 7, true, [{ pid: 7, parentPid: 6 }, { pid: 6, parentPid: 5 }]), 'launcher-ancestor');
  assert.equal(processCorrelation(5, 7, true, [{ pid: 7, parentPid: 8 }, { pid: 8, parentPid: 7 }]), 'mismatched-pid');
  assert.equal(processCorrelation(7, 7, false), 'unverified-owner');
  assert.equal(processCorrelation(null, 7, true), 'missing-pid');
});

test('inherited clean Preferences and unrelated file rewrites remain unknown', () => {
  for (const value of ['Normal', 'SessionEnded']) {
    const e = launch(value);
    observePreferences(e, { state: 'ok', value, digest: 'old' });
    assert.equal(terminationOutcome(e), 'unknown');
    observePreferences(e, { state: 'ok', value, digest: 'unrelated-rewrite' });
    assert.equal(terminationOutcome(e), 'unknown');
  }
});

test('current-launch crash-to-clean transition establishes fresh Normal or SessionEnded', () => {
  for (const value of ['Normal', 'SessionEnded']) {
    const e = launch(value);
    observePreferences(e, { state: 'ok', value: 'Crashed', digest: 'opened' });
    assert.equal(terminationOutcome(e), 'error');
    observePreferences(e, { state: 'ok', value, digest: 'closed' });
    assert.equal(e.exitTypeFresh, true);
    assert.equal(terminationOutcome(e), 'stopped');
  }
});

test('known exit status wins over stale, missing or unreadable Preferences; Stop and fresh SessionEnded keep precedence', () => {
  for (const state of ['missing', 'unreadable', 'ok']) {
    for (const code of [0, 1, 137]) {
      assert.equal(terminationOutcome({ ...launch(), exitTypeState: state, exitType: 'Normal', exitCode: code }), code === 0 ? 'stopped' : 'error');
    }
    assert.equal(terminationOutcome({ ...launch(), exitTypeState: state, exitSignal: 'SIGKILL' }), 'error');
    assert.equal(terminationOutcome({ ...launch(), exitTypeState: state }), 'unknown');
  }
  assert.equal(terminationOutcome({ ...launch(), stopping: true, exitCode: 1 }), 'stopped');
  assert.equal(terminationOutcome({ ...launch(), exitTypeState: 'ok', exitType: 'SessionEnded', exitTypeFresh: true, exitCode: 1 }), 'stopped');
  assert.equal(terminationOutcome({ ...launch(), exitTypeState: 'ok', exitType: 'SessionEnded', exitCode: 1 }), 'error');
});

test('rapid close/relaunch/kill waits for delayed matching-child exit despite inherited Normal', async () => {
  for (const code of [0, 1]) {
    const previous = launch(); previous.launchId = 'previous';
    const oldChild = makeChild(6); captureTermination(previous, oldChild);
    oldChild.emit('exit', 0, null); previous.readTermination();
    const current = launch(); const child = makeChild(7); captureTermination(current, child);
    observePreferences(current, { state: 'ok', value: 'Normal', digest: 'old' });
    assert.equal(terminationOutcome(current), 'unknown');
    const pending = waitForTermination(current, 500);
    const timer = setTimeout(() => child.emit('exit', code, null), 25);
    try { await pending; } finally { clearTimeout(timer); }
    assert.equal(current.exitEventSeen, true);
    assert.equal(current.exitEvidenceTimedOut, false);
    assert.equal(terminationOutcome(current), code === 0 ? 'stopped' : 'error');
    assert.equal(previous.exitCode, 0);
    previous.detachTermination(); current.detachTermination();
  }
});

test('missing or mismatched child and launcher-parent evidence never invent a browser exit', async () => {
  for (const correlation of ['missing-pid', 'mismatched-pid', 'launcher-ancestor', 'unverified-owner']) {
    const e = { ...launch(), processCorrelation: correlation };
    const child = makeChild(5); captureTermination(e, child);
    child.emit('exit', 1, null); await waitForTermination(e, 50);
    assert.equal(e.childExitCode, 1);
    assert.equal(e.exitCode, null);
    assert.equal(terminationOutcome(e), 'unknown');
    e.detachTermination();
  }
  const e = launch(); captureTermination(e, null); await waitForTermination(e, 50);
  assert.equal(terminationOutcome(e), 'unknown');
});

test('bounded missing-event timeout stays unknown; a late old event cannot affect a newer launch', async () => {
  const old = launch(); const child = makeChild(7); captureTermination(old, child);
  await waitForTermination(old, 10);
  assert.equal(old.exitEvidenceTimedOut, true);
  assert.equal(terminationOutcome(old), 'unknown');
  old.detachTermination();
  const next = launch(); next.launchId = 'next'; captureTermination(next, makeChild(8));
  child.emit('exit', 1, null);
  assert.equal(next.exitEventSeen, false);
  assert.equal(next.exitCode, null);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('close'), 0);
  next.detachTermination();
});

test('already-delivered status, signals and duplicate exit/close events preserve the first terminal evidence', async () => {
  for (const initial of [{ exitCode: 0 }, { exitCode: 1 }, { signalCode: 'SIGKILL' }]) {
    const e = launch(); const child = Object.assign(makeChild(7), initial);
    captureTermination(e, child); await waitForTermination(e, 50);
    assert.equal(e.exitEventSeen, true);
    const first = e.childExitCode;
    child.emit('close', 99, null); e.readTermination();
    assert.equal(e.childExitCode, first);
    assert.equal(terminationOutcome(e), initial.exitCode === 0 ? 'stopped' : 'error');
    e.detachTermination();
  }
});

test('Preferences snapshots distinguish missing, unreadable and content changes without timestamps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-exit-evidence-'));
  try {
    assert.equal(readPreferences(dir).state, 'missing');
    fs.mkdirSync(path.join(dir, 'Default'));
    const file = path.join(dir, 'Default', 'Preferences');
    fs.writeFileSync(file, '{broken'); assert.equal(readPreferences(dir).state, 'unreadable');
    fs.writeFileSync(file, JSON.stringify({ profile: { exit_type: 'Normal' } }));
    const baseline = readPreferences(dir); const stamp = fs.statSync(file).mtime;
    fs.writeFileSync(file, JSON.stringify({ profile: { exit_type: 'Crashed' } }));
    fs.utimesSync(file, stamp, stamp);
    const e = { ...launch(), preferencesBaseline: baseline };
    observePreferences(e, readPreferences(dir));
    assert.equal(e.exitTypeFresh, true);
    assert.equal(terminationOutcome(e), 'error');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('production close-evidence wait does not stop at PID death or inherited Normal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-close-wait-'));
  try {
    fs.mkdirSync(path.join(dir, 'Default'));
    fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ profile: { exit_type: 'Normal' } }));
    const e = { ...launch(), browserPid: 2 ** 22 + 12345, preferencesBaseline: readPreferences(dir) };
    const child = makeChild(e.browserPid); captureTermination(e, child);
    let delivered = false;
    const timer = setTimeout(() => { delivered = true; child.emit('exit', 1, null); }, 25);
    try { await waitForCloseEvidence(e, dir, { exitStatusMs: 500, prefsMs: 0 }); }
    finally { clearTimeout(timer); e.detachTermination(); }
    assert.equal(delivered, true, 'dead PID and stale Normal did not bypass the status wait');
    assert.equal(e.exitTypeFresh, false);
    assert.equal(terminationOutcome(e), 'error');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

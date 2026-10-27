// Per-launch observations only. No database, UI state, or browser control.
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export function readPreferences(dir) {
  try {
    const bytes = fs.readFileSync(path.join(dir, 'Default', 'Preferences'));
    const value = JSON.parse(bytes.toString('utf8'))?.profile?.exit_type;
    return { state: typeof value === 'string' && value ? 'ok' : 'missing',
      value: typeof value === 'string' ? value : null,
      digest: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) { return { state: err.code === 'ENOENT' ? 'missing' : 'unreadable', value: null, digest: null }; }
}

export function observePreferences(entry, reading) {
  entry.exitTypeState = reading.state;
  entry.exitType = reading.value ?? null;
  const baseline = entry.preferencesBaseline;
  if (!baseline) return; // Legacy classifier fixtures have no launch provenance.
  const changed = reading.state === 'ok' && reading.digest !== baseline.digest;
  if (changed && reading.value === 'Crashed') entry.sawLaunchCrashed = true;
  // An unrelated Preferences rewrite with an inherited clean value is not proof.
  entry.exitTypeFresh = changed && (reading.value !== baseline.value || !!entry.sawLaunchCrashed);
}

// Attach before asynchronous PID discovery. Late events update only this entry,
// never a database row or another launch. The promise survives context disconnect.
export function captureTermination(entry, proc) {
  entry.proc = proc || null;
  entry.childPid = proc?.pid ?? null;
  entry.exitEventSeen = false;
  entry.childExitCode = null;
  entry.childExitSignal = null;
  let resolve;
  entry.termination = new Promise(r => { resolve = r; });
  const collect = (code, signal, source) => {
    if (entry.exitEventSeen || (code == null && !signal)) return;
    entry.exitEventSeen = true;
    entry.childExitCode = code ?? null;
    entry.childExitSignal = signal ?? null;
    entry.exitEvidenceSource = source;
    entry.exitObservedAt = Date.now();
    resolve();
  };
  const onExit = (code, signal) => collect(code, signal, 'exit');
  const onClose = (code, signal) => collect(code, signal, 'close');
  proc?.once('exit', onExit);
  proc?.once('close', onClose);
  entry.readTermination = () => {
    if (proc && (proc.exitCode != null || proc.signalCode)) collect(proc.exitCode, proc.signalCode, 'status');
    if (entry.processCorrelation === 'same-pid-owned' && entry.exitEventSeen) {
      entry.exitCode = entry.childExitCode;
      entry.exitSignal = entry.childExitSignal;
    }
  };
  entry.detachTermination = () => {
    proc?.removeListener('exit', onExit);
    proc?.removeListener('close', onClose);
  };
  entry.readTermination();
}

// PID death does not imply the child event has reached the JS event loop.
export async function waitForTermination(entry, ms = 3000) {
  entry.readTermination?.();
  if (entry.exitEventSeen || !entry.proc) return;
  let timer;
  try { await Promise.race([entry.termination, new Promise(r => { timer = setTimeout(r, ms); })]); }
  finally { clearTimeout(timer); }
  entry.readTermination?.();
  entry.exitEvidenceTimedOut = !entry.exitEventSeen;
}

export function processCorrelation(childPid, browserPid, owned, parents = []) {
  if (!childPid || !browserPid) return 'missing-pid';
  if (!owned) return 'unverified-owner';
  if (Number(childPid) === Number(browserPid)) return 'same-pid-owned';
  const byPid = new Map(parents.map(p => [Number(p.pid), Number(p.parentPid)]));
  const seen = new Set();
  let pid = Number(browserPid);
  while (pid && !seen.has(pid)) {
    seen.add(pid); pid = byPid.get(pid);
    if (pid === Number(childPid)) return 'launcher-ancestor';
  }
  return 'mismatched-pid';
}

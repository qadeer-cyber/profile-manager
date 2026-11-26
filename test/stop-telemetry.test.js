// Owner lifecycle export (2026-11-20): a requested Stop recorded exitEventSeen=false and exitType=Crashed.
// Reproduces the race (the pid is gone before Node delivers the child's exit event) and checks that every
// exit is labelled RequestedStop / ForcedTermination / NormalWindowClose / BrowserCrash / Unknown truthfully.
import './_isolated-data.mjs';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const realProc = await import('../server/proc.js');
const procs = new Map(); // pid -> { proc, alive }
let force = false;
mock.module('../server/proc.js', { namedExports: { ...realProc,
  isAlive: pid => procs.has(pid) ? procs.get(pid).alive : realProc.isAlive(pid),
  pidMatches: async pid => procs.has(pid),
  // The pid dies at once; Node's 'exit' event for the child arrives 200 ms later (the race in the export).
  killTree: async (pid, opts = {}) => {
    const p = procs.get(pid);
    if (force) opts.onForce?.();
    p.alive = false;
    setTimeout(() => { p.proc.exitCode = force ? 1 : 0; p.proc.emit('exit', p.proc.exitCode, null); }, 200);
    return true;
  },
} });
let nextPid = 525000;
mock.module('../server/browser-runtime/launch-plan.js', { namedExports: { buildProfileLaunchPlan: async () => ({ runtime: 'native', args: [], plan: {}, regional: {}, relayUrl: null }) } });
mock.module('../server/browser-runtime/native-chromium.js', { namedExports: { launchNativeChromium: async () => {
  const proc = Object.assign(new EventEmitter(), { pid: ++nextPid, exitCode: null, signalCode: null });
  procs.set(proc.pid, { proc, alive: true });
  return { proc, browserPid: proc.pid, spawnPid: proc.pid, argv: [] };
} } });
const { db, userDataDir } = await import('../server/db.js');
const { launch, stop, lifecycleReport, terminationKind } = await import('../server/browsers.js');

function profile(name) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, name, '[]', '', '', now, now);
  fs.mkdirSync(userDataDir(id), { recursive: true });
  return id;
}
const lastExit = id => lifecycleReport().events.filter(e => e.kind === 'browser-exit' && e.id === id).at(-1);
const writePrefs = (id, exitType) => {
  fs.mkdirSync(path.join(userDataDir(id), 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir(id), 'Default', 'Preferences'), JSON.stringify({ profile: { exit_type: exitType } }));
};

test('a graceful requested Stop waits for the exit event and is labelled RequestedStop', async () => {
  force = false;
  const id = profile('graceful stop');
  await launch({ id, proxy: null }, { automation: false });
  writePrefs(id, 'Normal');
  await stop(id);
  const e = lastExit(id);
  assert.equal(e.exitEventSeen, true, 'exit event observed, not raced');
  assert.equal(e.childExitCode, 0);
  assert.equal(e.stopEscalation, 'graceful');
  assert.equal(e.terminationKind, 'RequestedStop');
  assert.equal(e.chosen, 'stopped');
});

test('a Stop that had to force the process is labelled ForcedTermination, not a crash', async () => {
  force = true;
  const id = profile('forced stop');
  await launch({ id, proxy: null }, { automation: false });
  writePrefs(id, 'Crashed'); // Chrome never wrote its clean-exit marker
  await stop(id);
  const e = lastExit(id);
  assert.equal(e.stopEscalation, 'forced');
  assert.equal(e.terminationKind, 'ForcedTermination');
  assert.equal(e.chosen, 'stopped', 'the profile is Stopped (the user asked for it), not Crashed');
  force = false;
});

test('labels for exits AZWAH did not request', () => {
  assert.equal(terminationKind({ stopping: false }, 'stopped'), 'NormalWindowClose');
  assert.equal(terminationKind({ stopping: false }, 'error'), 'BrowserCrash');
  assert.equal(terminationKind({ stopping: false }, 'unknown'), 'Unknown');
  assert.equal(terminationKind({ stopping: true, stopEscalation: 'graceful' }, 'stopped'), 'RequestedStop');
  assert.equal(terminationKind({ stopping: true, stopEscalation: 'forced' }, 'stopped'), 'ForcedTermination');
});

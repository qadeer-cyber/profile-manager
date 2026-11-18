import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { workingSetToMiB, buildProfileProcessMetrics, parseWindowsProcessRows } from '../server/process-catalog.js';
import { sweepAbandonedLocks } from '../server/crash-recovery.js';
import { readLock, LOCK_NAME } from '../server/lock.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m17-rec-'));
process.env.PM_DATA_DIR = dir;
const { db, userDataDir } = await import('../server/db.js');
const engine = await import('../server/browsers.js');

after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('working set zero or missing reports unavailable memory not zero MiB', () => {
  assert.equal(workingSetToMiB(0), null);
  assert.equal(workingSetToMiB(null), null);
  assert.ok(workingSetToMiB(5 * 1024 * 1024) > 0);
});

test('Windows fixture with zero working set does not fabricate memory', () => {
  const rows = parseWindowsProcessRows([{ ProcessId: 1, ParentProcessId: 0, CommandLine: 'chrome.exe --user-data-dir=C:\\p\\a', WorkingSetSize: 0 }]);
  const metrics = buildProfileProcessMetrics([{ id: 'a', userDataDir: 'C:\\p\\a' }], rows, { platform: 'win32' }).profiles[0];
  assert.equal(metrics.memoryMiB, null);
  assert.equal(metrics.processes[0].memoryMiB, null);
});

test('recoverAfterRestart clears orphan running row and preserves profile files', async () => {
  const id = '33333333-3333-3333-3333-333333333333';
  db.prepare('DELETE FROM running WHERE id=?').run(id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  const now = new Date().toISOString();
  const profileDir = userDataDir(id);
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'Default', 'Preferences'), '{}');
  fs.writeFileSync(path.join(profileDir, 'cookie-marker.txt'), 'keep');
  db.prepare(`INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at,proxy_id,browser_settings,webrtc_settings)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, 'Rec', '[]', '', '', now, now, null, '{}', '{}');
  db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(id, 999999, null, null, null, now);
  fs.writeFileSync(path.join(profileDir, LOCK_NAME), JSON.stringify({
    ownerPid: 999999,
    browserPid: 999999,
    startedAt: now,
    host: os.hostname(),
  }));
  const report = await engine.recoverAfterRestart();
  assert.ok(report.cleared >= 1);
  assert.equal(db.prepare('SELECT id FROM running WHERE id=?').get(id), undefined);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cookie-marker.txt'), 'utf8'), 'keep');
});

test('sweepAbandonedLocks skips processes that still own the profile directory', async () => {
  const id = '22222222-2222-2222-2222-222222222222';
  const profileDir = userDataDir(id);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, LOCK_NAME), JSON.stringify({
    ownerPid: 999999,
    browserPid: process.pid,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
  }));
  const report = await sweepAbandonedLocks({
    browserOwnedByProfile: async (pid) => pid === process.pid,
    killTree: async () => false,
  });
  assert.equal(report.skippedLive, 1);
  assert.equal(fs.existsSync(path.join(profileDir, LOCK_NAME)), true);
});

test('recovery-status API returns snapshot', async () => {
  const { spawnServer, stopServer } = await import('./_ports.mjs');
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm17r' });
  try {
    const body = await fetch(proc.url + '/api/v1/recovery-status', { headers: { Authorization: 'Bearer m17r' } }).then(r => r.json());
    assert.equal(typeof body.runningRows, 'number');
    assert.equal(typeof body.chromium.chromium.present, 'boolean');
  } finally {
    await stopServer(proc);
  }
});

// Local crash/orphan reconciliation — never kill processes outside profile user-data dirs.
import fs from 'fs';
import path from 'path';
import { db, userDataDir } from './db.js';
import { readLock, recoverLock, isStale } from './lock.js';
import { isAlive } from './proc.js';

const CHROME_LOCKS = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];

export function clearChromeSingletonLocks(dir) {
  for (const name of CHROME_LOCKS) fs.rmSync(path.join(dir, name), { force: true });
}

export function profilesRoot() {
  return path.dirname(userDataDir('00000000-0000-0000-0000-000000000000'));
}

export async function sweepAbandonedLocks({ browserOwnedByProfile, killTree, onlyProfileIds = null } = {}) {
  const report = { abandonedLocks: 0, chromeSingletons: 0, skippedLive: 0 };
  const root = profilesRoot();
  if (!fs.existsSync(root)) return report;
  for (const id of fs.readdirSync(root)) {
    if (onlyProfileIds && !onlyProfileIds.has(id)) continue;
    const dir = path.join(root, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const lock = readLock(dir);
    if (!lock || lock.corrupt || !isStale(lock)) continue;
    const cleared = await recoverLock(dir, async current => {
      if (!current || current.corrupt) return false;
      const pid = current.browserPid;
      if (pid && await browserOwnedByProfile(pid, dir)) return false;
      if (pid && isAlive(pid)) return false;
      clearChromeSingletonLocks(dir);
      return true;
    });
    if (cleared) { report.abandonedLocks++; report.chromeSingletons++; }
    else report.skippedLive++;
  }
  return report;
}

export async function reconcileStaleRunningRows({ liveIds, launchingIds, browserOwnedByProfile, killTree, setProfileError }) {
  const report = { clearedRows: 0, clearedLocks: 0, skippedActive: 0 };
  for (const row of db.prepare('SELECT * FROM running').all()) {
    if (liveIds.has(row.id) || launchingIds.has(row.id)) {
      report.skippedActive += 1;
      continue;
    }
    let dir;
    try { dir = userDataDir(row.id); } catch {
      db.prepare('DELETE FROM running WHERE id=?').run(row.id);
      report.clearedRows += 1;
      continue;
    }
    const cleared = await recoverLock(dir, async lock => {
      const current = db.prepare('SELECT * FROM running WHERE id=?').get(row.id);
      if (!current || current.pid !== row.pid || current.started_at !== row.started_at) return false;
      const pid = row.pid || lock?.browserPid;
      if (await browserOwnedByProfile(pid, dir)) {
        if (killTree) await killTree(pid, { expect: dir });
        if (await browserOwnedByProfile(pid, dir)) return false;
      }
      clearChromeSingletonLocks(dir);
      db.prepare('DELETE FROM running WHERE id=?').run(row.id);
      setProfileError?.(row.id, 'Browser session ended unexpectedly. The running record was cleared during recovery.');
      return true;
    });
    if (cleared) { report.clearedRows++; report.clearedLocks++; }
    else report.skippedActive++;
  }
  return report;
}

export function recoverySnapshot({ liveCount = 0, launchingCount = 0 } = {}) {
  const runningRows = db.prepare('SELECT id, pid, started_at FROM running').all();
  let staleLockEstimate = 0;
  try {
    const root = profilesRoot();
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const lock = readLock(path.join(root, entry.name));
        if (lock && !lock.corrupt && isStale(lock)) staleLockEstimate += 1;
      }
    }
  } catch { /* best effort */ }
  return {
    generatedAt: new Date().toISOString(),
    liveInProcess: liveCount,
    launchingInProcess: launchingCount,
    runningRows: runningRows.length,
    staleLockEstimate,
    note: 'Recovery never targets Chromium processes that fail the user-data-dir command-line check.',
  };
}

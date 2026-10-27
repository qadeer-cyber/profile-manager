// Per-profile lock file: <userDataDir>/.pm-lock containing JSON {ownerPid, browserPid, startedAt, host}.
// A lock is stale if its owner process is no longer alive (or it is unreadable).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isAlive } from './proc.js';

export const LOCK_NAME = '.pm-lock';
const lockPath = dir => path.join(dir, LOCK_NAME);

export function readLock(dir) {
  try { return JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')); } catch (e) { return e.code === 'ENOENT' ? null : { corrupt: true }; }
}
export function isStale(lock, alive = isAlive) {
  if (!lock) return false;
  if (lock.corrupt) return true;
  if (lock.host && lock.host !== os.hostname()) return false; // can't verify a remote owner; treat as held
  return !alive(lock.ownerPid);
}
export class LockedError extends Error {
  constructor(lock) { super(`Profile is in use by another process (pid ${lock.ownerPid}, since ${lock.startedAt}). Close it there first.`); this.status = 409; this.lock = lock; }
}

// Atomically create the lock (O_EXCL). Removes a stale lock once and retries.
export function acquireLock(dir, { ownerPid = process.pid, alive = isAlive } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath(dir), 'wx');
      fs.writeSync(fd, JSON.stringify({ ownerPid, browserPid: null, startedAt: new Date().toISOString(), host: os.hostname() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const lock = readLock(dir);
      if (lock && !lock.corrupt && lock.ownerPid === ownerPid) throw Object.assign(new Error('Profile is already being launched or running'), { status: 409 });
      if (!isStale(lock, alive)) throw new LockedError(lock);
      fs.rmSync(lockPath(dir), { force: true });
    }
  }
  throw new LockedError(readLock(dir) || {});
}
export function updateLock(dir, fields) {
  const l = readLock(dir);
  if (l && !l.corrupt) fs.writeFileSync(lockPath(dir), JSON.stringify({ ...l, ...fields }));
}
export function releaseLock(dir, ownerPid = process.pid) {
  const l = readLock(dir);
  if (!l || l.corrupt || l.ownerPid === ownerPid) fs.rmSync(lockPath(dir), { force: true });
}

// Per-profile lock file: <userDataDir>/.pm-lock containing JSON {ownerPid, browserPid, startedAt, host}.
// A lock is stale if its owner process is no longer alive (or it is unreadable).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isAlive } from './proc.js';

export const LOCK_NAME = '.pm-lock';
const lockPath = dir => path.join(dir, LOCK_NAME);

// On Windows another process (commonly antivirus scanning a just-written file) can hold the lock
// briefly, so a read fails with EBUSY/EPERM/EACCES, and a reader can catch a write half-way. Those
// are retried for about 200 ms before the lock is treated as corrupt.
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function readLock(dir, { attempts = 10, delayMs = 20 } = {}) {
  for (let i = 0; ; i++) {
    try { return JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') return null;
      if ((TRANSIENT.has(e.code) || e instanceof SyntaxError) && i < attempts - 1) { pause(delayMs); continue; }
      return { corrupt: true };
    }
  }
}
// Write via a temporary file and rename so readers never see a truncated lock.
function writeLockAtomic(dir, value, { attempts = 10, delayMs = 20 } = {}) {
  const target = lockPath(dir), temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  for (let i = 0; ; i++) {
    try { fs.renameSync(temp, target); return; }
    catch (e) {
      if (TRANSIENT.has(e.code) && i < attempts - 1) { pause(delayMs); continue; }
      fs.rmSync(temp, { force: true });
      throw e;
    }
  }
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
// Only the process that acquired the lock calls this. A lock that stays unreadable is rewritten
// with this owner instead of silently keeping browserPid: null (which hid the browser from
// crash recovery and ownership checks on Windows).
export function updateLock(dir, fields, { ownerPid = process.pid } = {}) {
  const l = readLock(dir);
  if (!l) return;
  const base = l.corrupt ? { ownerPid, browserPid: null, startedAt: new Date().toISOString(), host: os.hostname() } : l;
  writeLockAtomic(dir, { ...base, ...fields });
}
export function releaseLock(dir, ownerPid = process.pid) {
  const l = readLock(dir);
  if (!l || l.corrupt || l.ownerPid === ownerPid) fs.rmSync(lockPath(dir), { force: true });
}

// Per-profile lock file: <userDataDir>/.pm-lock containing JSON {ownerPid, browserPid, startedAt, host}.
// Invalid JSON can be recovered. An inaccessible lock must never be mistaken for stale JSON.
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { isAlive } from './proc.js';

export const LOCK_NAME = '.pm-lock';
const LOCK_GUARD = '.azwah-profile-locks.sqlite';
const owned = new Map();
// A short SQLite writer transaction serializes filesystem mutations, including on Windows.
// The OS releases it after a crash. Never unlink the guard while other processes may use it.
function guarded(dir, fn) {
  const db = new Database(path.join(path.dirname(fs.realpathSync(dir)), LOCK_GUARD), { timeout: 5000 });
  try { return db.transaction(fn).immediate(); } finally { db.close(); }
}
const lockPath = dir => path.join(dir, LOCK_NAME);

// On Windows another process (commonly antivirus scanning a just-written file) can hold the lock
// briefly, so a read fails with EBUSY/EPERM/EACCES, and a reader can catch a write half-way. Those
// are retried for about 200 ms before reporting the underlying failure.
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function readLock(dir, { attempts = 10, delayMs = 20 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8'));
      return Number.isInteger(lock?.ownerPid) && lock.ownerPid > 0 ? lock : { corrupt: true };
    }
    catch (e) {
      if (e.code === 'ENOENT') return null;
      if ((TRANSIENT.has(e.code) || e instanceof SyntaxError) && i < attempts - 1) { pause(delayMs); continue; }
      if (e instanceof SyntaxError) return { corrupt: true };
      throw e;
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

function remember(dir, lock) {
  const { dev, ino } = fs.statSync(lockPath(dir), { bigint: true });
  owned.set(path.resolve(dir), { lock, dev, ino });
}
function claim(dir, ownerPid, browserPid = null) {
  const lock = { ownerPid, browserPid, startedAt: new Date().toISOString(), host: os.hostname(), token: randomUUID() };
  writeLockAtomic(dir, lock);
  remember(dir, lock);
  return lock;
}

export function acquireLock(dir, { ownerPid = process.pid, alive = isAlive } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  return guarded(dir, () => {
    const lock = readLock(dir);
    if (lock?.ownerPid === ownerPid) throw Object.assign(new Error('Profile is already being launched or running'), { status: 409 });
    if (lock && (!isStale(lock, alive) || (lock.browserPid && alive(lock.browserPid)))) throw new LockedError(lock);
    claim(dir, ownerPid);
    return true;
  });
}

export function updateLock(dir, fields, { ownerPid = process.pid } = {}) {
  const key = path.resolve(dir);
  const entry = owned.get(key);
  const lease = entry?.lock;
  if (!lease || lease.ownerPid !== ownerPid) return;
  guarded(dir, () => {
    let lock;
    try { lock = readLock(dir); } catch (e) {
      // An acquired lease cannot be taken over from a living owner. Check existence
      // independently before repairing metadata after a persistent sharing error.
      if (!TRANSIENT.has(e.code)) throw e;
      lock = { corrupt: true };
    }
    if (!lock || (!lock.corrupt && lock.token !== lease.token)) return;
    if (lock.corrupt) {
      const { dev, ino } = fs.statSync(lockPath(dir), { bigint: true });
      if (dev !== entry.dev || ino !== entry.ino) return;
    }
    const next = { ...lease, ...fields };
    writeLockAtomic(dir, next);
    remember(dir, next);
  });
}

export function releaseLock(dir, ownerPid = process.pid) {
  const key = path.resolve(dir);
  const entry = owned.get(key);
  const lease = entry?.lock;
  if (!lease || lease.ownerPid !== ownerPid) return;
  guarded(dir, () => {
    const current = readLock(dir);
    if (current?.token === lease.token) fs.unlinkSync(lockPath(dir));
    owned.delete(key);
  });
}

// Reserve the profile across asynchronous PID checks, cleanup and running-row updates.
// Returning false (or throwing) restores the original metadata for the next recovery pass.
export async function recoverLock(dir, work) {
  fs.mkdirSync(dir, { recursive: true });
  let previous;
  const lease = guarded(dir, () => {
    previous = readLock(dir);
    if (previous && !isStale(previous)) return null;
    return claim(dir, process.pid, previous?.browserPid);
  });
  if (!lease) return false;
  let cleared = false;
  try {
    cleared = await work(previous);
    return cleared;
  } finally {
    guarded(dir, () => {
      if (readLock(dir)?.token !== lease.token) return;
      if (!cleared && previous) writeLockAtomic(dir, previous);
      else fs.unlinkSync(lockPath(dir));
      owned.delete(path.resolve(dir));
    });
  }
}

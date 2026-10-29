// Serialize burst launch requests; expire abandoned reservations without killing browsers.
import { getSetting } from './db.js';

const reservations = new Map();
let activeSlots = 0;
const waitQueue = [];

const httpErr = (status, msg, code) => Object.assign(new Error(msg), { status, code });

function reservationTtlMs() {
  const seconds = Number(getSetting('launchReservationSeconds', 120));
  return Math.max(30, Math.min(600, seconds)) * 1000;
}

function maxConcurrentLaunches() {
  const n = Number(getSetting('maxConcurrentLaunches', 2));
  return Math.max(1, Math.min(4, n));
}

export function sweepLaunchReservations() {
  const now = Date.now();
  for (const [id, row] of reservations) {
    if (!row.active && row.expiresAt <= now) reservations.delete(id);
  }
}

export function launchQueueState() {
  sweepLaunchReservations();
  return {
    activeLaunches: activeSlots,
    queuedLaunches: waitQueue.length,
    reservations: reservations.size,
    maxConcurrentLaunches: maxConcurrentLaunches(),
    reservationTtlSeconds: reservationTtlMs() / 1000,
  };
}

function releaseSlot() {
  activeSlots = Math.max(0, activeSlots - 1);
  const next = waitQueue.shift();
  if (next) {
    activeSlots += 1;
    next.resolve();
  }
}

function acquireSlot() {
  if (activeSlots < maxConcurrentLaunches()) {
    activeSlots += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => waitQueue.push({ resolve }));
}

export async function runWithLaunchQueue(profileId, fn) {
  sweepLaunchReservations();
  if (reservations.has(profileId)) {
    throw httpErr(409, 'This profile already has a launch in progress or queued.', 'LAUNCH_QUEUED');
  }
  const expiresAt = Date.now() + reservationTtlMs();
  reservations.set(profileId, { expiresAt, active: false });
  await acquireSlot();
  const row = reservations.get(profileId);
  if (row) row.active = true;
  try {
    return await fn();
  } finally {
    reservations.delete(profileId);
    releaseSlot();
  }
}

export function pendingLaunchCount() {
  sweepLaunchReservations();
  return reservations.size;
}

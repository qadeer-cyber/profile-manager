// Local resource guards for multi-profile use on ~8 GiB machines.
import os from 'os';
import { getSetting } from './db.js';

const httpErr = (status, msg, code) => Object.assign(new Error(msg), { status, code });

export function launchLimits({ runningCount = 0, totalMemBytes = os.totalmem(), freeMemBytes = os.freemem() } = {}) {
  const maxRunning = Number(getSetting('maxRunningProfiles', 4));
  const minFreeGiB = Number(getSetting('minFreeMemoryGiB', 1));
  const totalGiB = Math.round(totalMemBytes / 1024 / 1024 / 1024);
  const freeGiB = Math.round(freeMemBytes / 1024 / 1024 / 1024);
  return {
    maxRunningProfiles: maxRunning,
    minFreeMemoryGiB: minFreeGiB,
    runningCount,
    hostTotalGiB: totalGiB,
    hostFreeGiB: freeGiB,
    note: 'These are local guards only. They do not reserve RAM for Chromium and they do not change profile isolation.',
  };
}

export function assertLaunchResources(runningCount) {
  const limits = launchLimits({ runningCount, freeMemBytes: os.freemem(), totalMemBytes: os.totalmem() });
  if (runningCount >= limits.maxRunningProfiles) {
    throw httpErr(429, `This computer already has ${runningCount} profiles running. Stop one first or raise maxRunningProfiles in Settings.`, 'TOO_MANY_PROFILES');
  }
  if (limits.hostFreeGiB < limits.minFreeMemoryGiB) {
    throw httpErr(503, `Free memory is about ${limits.hostFreeGiB} GiB, below the ${limits.minFreeMemoryGiB} GiB guard. Stop a profile or close other apps, then try again.`, 'LOW_MEMORY');
  }
  return limits;
}

export function resourceLimitsSummary({ runningCount = 0, queuePending = 0 } = {}) {
  const limits = launchLimits({ runningCount: runningCount + queuePending });
  return {
    ...limits,
    queuePending,
    concurrencyNote: 'maxRunningProfiles counts live browsers. maxConcurrentLaunches limits parallel startup work only.',
  };
}

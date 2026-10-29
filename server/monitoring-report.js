import os from 'os';
import { hostResourceSample } from './resource-monitor.js';
import { buildProfileProcessMetrics, aggregateBrowserMemory } from './process-catalog.js';
import { cachedProcessSnapshot, refreshProcessSnapshot } from './process-snapshot.js';
import { launchQueueState } from './launch-queue.js';
import { getLaunchMetrics } from './launch-metrics.js';

export async function buildMonitoringReport(sessionInputs, { refresh = true } = {}) {
  const snapshot = refresh ? await refreshProcessSnapshot({ force: false }) : cachedProcessSnapshot();
  const host = hostResourceSample();
  host.cpuPercent = host.loadAvg?.[0] != null && host.cpuCount
    ? Math.min(100, Math.round((host.loadAvg[0] / host.cpuCount) * 1000) / 10)
    : null;
  const profiles = buildProfileProcessMetrics(sessionInputs, snapshot.rows, { platform: process.platform }).profiles;
  const queue = launchQueueState();
  return {
    generatedAt: new Date().toISOString(),
    observation: snapshot.source,
    observationError: snapshot.error,
    cacheAgeMs: snapshot.at ? Date.now() - snapshot.at : null,
    host,
    queue,
    profiles,
    totals: {
      runningProfiles: sessionInputs.length,
      totalBrowserMemoryMiB: aggregateBrowserMemory(profiles),
      assignedProcesses: profiles.reduce((n, p) => n + (p.processes?.length || 0), 0),
    },
    environment: {
      platform: process.platform,
      arch: os.arch(),
      release: os.release(),
      cpuModel: os.cpus()[0]?.model || null,
      logicalCores: os.cpus().length,
    },
  };
}

export function enrichSessionsForMonitoring(sessions) {
  return sessions.map(session => ({
    ...session,
    launchMetrics: getLaunchMetrics(session.id),
  }));
}

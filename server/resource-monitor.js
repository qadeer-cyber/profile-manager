// Observed host and per-browser memory (best-effort; no fabricated savings).
import fs from 'fs';
import os from 'os';
import { buildProfileProcessMetrics, aggregateBrowserMemory } from './process-catalog.js';
import { cachedProcessSnapshot } from './process-snapshot.js';

export function processMemoryMiB(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (process.platform === 'linux') {
    try {
      const status = fs.readFileSync(`/proc/${n}/status`, 'utf8');
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      return match ? Math.round(Number(match[1]) / 1024 * 10) / 10 : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function hostResourceSample() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalMemGiB: Math.round(total / 1024 / 1024 / 1024 * 10) / 10,
    freeMemGiB: Math.round(free / 1024 / 1024 / 1024 * 10) / 10,
    loadAvg: process.platform === 'win32' ? null : os.loadavg().map(v => Math.round(v * 100) / 100),
    cpuCount: os.cpus().length,
    memoryObservation: process.platform === 'linux' ? 'linux_proc_meminfo' : (process.platform === 'win32' ? 'win32_cim_cached' : 'host_totals_only'),
    lowMemoryWarning: free / 1024 / 1024 / 1024 < 1,
    note: 'Browser memory sums Chromium subprocesses matched by user-data-dir. CPU on Windows is host load only until a second sample exists.',
  };
}

export function profileResourceRows(entries) {
  const snap = cachedProcessSnapshot();
  if (snap.rows?.length && entries.every(entry => entry.userDataDir)) {
    const detailed = buildProfileProcessMetrics(entries, snap.rows).profiles;
    return {
      profiles: detailed.map(row => ({
        id: row.id,
        name: row.name,
        pid: row.rootPid,
        memoryMiB: row.memoryMiB,
        memoryObserved: row.memoryObserved,
        processCount: row.processCount,
      })),
      totalBrowserMemoryMiB: aggregateBrowserMemory(detailed),
      profilesObserved: detailed.filter(row => row.memoryObserved).length,
      perProcessObservation: snap.source,
    };
  }
  let total = 0;
  let observed = 0;
  const profiles = entries.map(entry => {
    const memoryMiB = processMemoryMiB(entry.pid);
    if (memoryMiB != null) {
      total += memoryMiB;
      observed += 1;
    }
    return {
      id: entry.id,
      name: entry.name ?? null,
      pid: entry.pid ?? null,
      memoryMiB,
      memoryObserved: memoryMiB != null,
      processCount: memoryMiB != null ? 1 : 0,
    };
  });
  return {
    profiles,
    totalBrowserMemoryMiB: observed ? Math.round(total * 10) / 10 : null,
    profilesObserved: observed,
    perProcessObservation: process.platform === 'linux' ? 'linux_proc_rss_root_only' : 'awaiting_process_snapshot',
  };
}

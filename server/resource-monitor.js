// Observed host and per-browser memory (best-effort; no fabricated savings).
import fs from 'fs';
import os from 'os';

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
    memoryObservation: process.platform === 'linux' ? 'linux_proc_meminfo' : 'host_totals_only',
    lowMemoryWarning: free / 1024 / 1024 / 1024 < 1,
    note: 'Per-process RSS is read from /proc on Linux only. Totals are not a guarantee of free RAM for the next launch.',
  };
}

export function profileResourceRows(entries) {
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
    };
  });
  return {
    profiles,
    totalBrowserMemoryMiB: observed ? Math.round(total * 10) / 10 : null,
    profilesObserved: observed,
    perProcessObservation: process.platform === 'linux' ? 'linux_proc_rss' : 'unavailable_on_this_os',
  };
}

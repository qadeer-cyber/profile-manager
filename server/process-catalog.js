// Assign Chromium subprocess trees to profiles without double-counting PIDs.
const normPath = (value, platform = process.platform) => {
  if (!value) return '';
  let s = String(value).replace(/\\/g, '/');
  if (platform === 'win32') s = s.toLowerCase();
  return s.replace(/\/+$/, '');
};

export function chromeProcessRole(commandLine) {
  const line = String(commandLine || '');
  if (!/(chrome|chromium)/i.test(line)) return null;
  if (/--type=renderer\b/.test(line)) return 'renderer';
  if (/--type=gpu-process\b/.test(line)) return 'gpu';
  if (/--type=utility\b/.test(line)) return 'utility';
  if (/--type=/.test(line)) return 'child';
  return 'browser';
}

export function profileDirInCommandLine(commandLine, userDataDir, platform = process.platform) {
  const hay = normPath(commandLine, platform);
  const needle = normPath(userDataDir, platform);
  if (!needle || !hay.includes(needle)) return false;
  const index = hay.indexOf(needle);
  const next = hay[index + needle.length];
  return !next || next === '/' || next === ' ' || next === '"';
}

export function parseWindowsProcessRows(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map(row => ({
    pid: Number(row.ProcessId ?? row.pid),
    ppid: Number(row.ParentProcessId ?? row.ppid),
    name: row.Name ?? row.name ?? '',
    commandLine: row.CommandLine ?? row.commandLine ?? '',
    workingSetBytes: Number(row.WorkingSetSize ?? row.workingSetBytes ?? 0) || 0,
    cpuPercent: row.cpuPercent ?? null,
  })).filter(row => Number.isInteger(row.pid) && row.pid > 0);
}

export function buildProfileProcessMetrics(profiles, processRows, { platform = process.platform } = {}) {
  const assigned = new Map();
  const out = profiles.map(profile => {
    const processes = [];
    for (const row of processRows) {
      if (!profileDirInCommandLine(row.commandLine, profile.userDataDir, platform)) continue;
      if (assigned.has(row.pid) && assigned.get(row.pid) !== profile.id) continue;
      const role = chromeProcessRole(row.commandLine) || 'child';
      processes.push({
        pid: row.pid,
        ppid: row.ppid,
        role,
        memoryMiB: row.workingSetBytes ? Math.round(row.workingSetBytes / 1024 / 1024 * 10) / 10 : null,
        cpuPercent: row.cpuPercent ?? null,
      });
      assigned.set(row.pid, profile.id);
    }
    const memoryMiB = processes.length
      ? Math.round(processes.reduce((sum, item) => sum + (item.memoryMiB || 0), 0) * 10) / 10
      : null;
    processes.sort((a, b) => a.role.localeCompare(b.role) || a.pid - b.pid);
    return {
      id: profile.id,
      name: profile.name ?? null,
      rootPid: profile.pid ?? null,
      processCount: processes.length,
      memoryMiB,
      memoryObserved: processes.some(item => item.memoryMiB != null),
      processes,
      launchMetrics: profile.launchMetrics ?? null,
      lastError: profile.lastError ?? null,
      status: profile.status ?? 'running',
    };
  });
  return { profiles: out, assignedPidCount: assigned.size };
}

export function aggregateBrowserMemory(profileMetrics) {
  const seen = new Set();
  let total = 0;
  for (const profile of profileMetrics) {
    for (const proc of profile.processes || []) {
      if (seen.has(proc.pid) || proc.memoryMiB == null) continue;
      seen.add(proc.pid);
      total += proc.memoryMiB;
    }
  }
  return seen.size ? Math.round(total * 10) / 10 : null;
}

// Bounded process sampling with short TTL cache (one Windows query per refresh).
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { chromeProcessRole, profileDirInCommandLine } from './process-catalog.js';

const TTL_MS = 3000;
let cache = { at: 0, rows: [], source: 'none', error: null };

const execJson = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 12000 }, (err, stdout) => {
    if (err) reject(err);
    else resolve(String(stdout || ''));
  });
});

function linuxProcessRows() {
  const rows = [];
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch { return rows; }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let cmdline = '';
    try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch { continue; }
    if (!chromeProcessRole(cmdline) && !/chrome|chromium/i.test(cmdline)) continue;
    let ppid = 0;
    let rssKb = 0;
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const pp = status.match(/^PPid:\s+(\d+)/m);
      const rss = status.match(/^VmRSS:\s+(\d+)/m);
      ppid = pp ? Number(pp[1]) : 0;
      rssKb = rss ? Number(rss[1]) : 0;
    } catch { /* terminated */ }
    rows.push({ pid, ppid, commandLine: cmdline, workingSetBytes: rssKb * 1024, name: path.basename(cmdline.split(' ')[0] || '') });
  }
  return rows;
}

async function windowsProcessRows() {
  const script = [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'chrome|chromium\' } | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize,Name | ConvertTo-Json -Compress',
  ];
  const stdout = await execJson('powershell.exe', script);
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return []; }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map(row => ({
    pid: Number(row.ProcessId),
    ppid: Number(row.ParentProcessId),
    commandLine: row.CommandLine || '',
    workingSetBytes: Number(row.WorkingSetSize) || 0,
    name: row.Name || '',
  })).filter(row => row.pid > 0);
}

export async function refreshProcessSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.at && now - cache.at < TTL_MS) return cache;
  try {
    let rows = [];
    let source = 'none';
    if (process.platform === 'linux') {
      rows = linuxProcessRows();
      source = 'linux_proc';
    } else if (process.platform === 'win32') {
      rows = await windowsProcessRows();
      source = 'win32_cim';
    }
    cache = { at: now, rows, source, error: null };
  } catch (error) {
    cache = { at: now, rows: cache.rows, source: cache.source, error: error.message };
  }
  return cache;
}

export function cachedProcessSnapshot() {
  return cache;
}

export function filterRowsForProfiles(rows, profiles, platform = process.platform) {
  const needles = profiles.map(p => ({ id: p.id, dir: p.userDataDir }));
  return rows.filter(row => needles.some(n => profileDirInCommandLine(row.commandLine, n.dir, platform)));
}

export function startProcessSnapshotSampler(intervalMs = 4000) {
  const tick = () => refreshProcessSnapshot().catch(() => {});
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// Read-only OS evidence. Raw command lines never leave this module.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const POLICIES = new Set(['default', 'default_public_and_private_interfaces',
  'default_public_interface_only', 'disable_non_proxied_udp']);

// Chromium base/command_line.cc: '=' values, '-'/'--' prefixes, Windows '/'
// prefix and case folding, and '--' terminator. Space-separated values are args.
export function summarizeWebRtcArguments(argv, platform = process.platform) {
  if (!Array.isArray(argv) || argv.length > 5000 || argv.some(a => typeof a !== 'string')) return { kind: 'unreadable' };
  const found = [];
  for (const arg of argv) {
    if (arg === '--') break;
    const parsed = (platform === 'win32' ? /^(?:--?|\/)([^=]+)(?:=(.*))?$/ : /^--?([^=]+)(?:=(.*))?$/).exec(arg);
    if (!parsed) continue;
    const key = platform === 'win32' ? parsed[1].toLowerCase() : parsed[1];
    if (key !== 'force-webrtc-ip-handling-policy') continue;
    if (!POLICIES.has(parsed[2])) return { kind: 'unverified' };
    found.push(parsed[2]);
  }
  if (!found.length) return { kind: 'absent' };
  if (found.length > 1) return { kind: 'conflicting' };
  return { kind: 'present', value: found[0] };
}

// Windows CRT/CommandLineToArgvW quoting rules: backslashes escape a following
// quote in pairs. No shell evaluation, environment expansion, or subprocess args.
function windowsArguments(line) {
  const args = [];
  let i = 0;
  while (i < line.length) {
    while (/[ \t]/.test(line[i] || '') && i < line.length) i++;
    if (i === line.length) break;
    let value = '', quoted = false;
    while (i < line.length && (quoted || !/[ \t]/.test(line[i]))) {
      let slashes = 0;
      while (line[i] === '\\') { slashes++; i++; }
      if (line[i] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"';
        else if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
        i++;
      } else {
        value += '\\'.repeat(slashes);
        if (i < line.length && (quoted || !/[ \t]/.test(line[i]))) value += line[i++];
      }
    }
    if (quoted) throw new Error('unreadable');
    args.push(value);
  }
  return args;
}

function run(args, signal) {
  return new Promise(resolve => {
    let output = null;
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args],
      { windowsHide: true, timeout: 2400, maxBuffer: 1024 * 1024, signal },
      (error, stdout) => { output = error ? null : stdout; });
    // Abort can report an error before process exit. Keep ownership until the
    // helper has actually closed and its stdio can no longer deliver evidence.
    child.once('close', () => resolve(output));
  });
}

async function snapshot(pid, command, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || signal?.aborted) return null;
  try {
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal });
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      if (!/^\d+$/.test(start)) return null;
      const argv = command ? (await readFile(`/proc/${pid}/cmdline`, { encoding: 'utf8', signal })).replace(/\0$/, '').split('\0') : null;
      const after = await readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal });
      if (after.slice(after.lastIndexOf(')') + 2).split(' ')[19] !== start || signal?.aborted) return null;
      return { start, argv };
    }
    if (process.platform === 'win32') {
      const out = await run(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($null -ne $p) { [pscustomobject]@{pid=$p.ProcessId; start=$p.CreationDate.ToUniversalTime().Ticks.ToString(); ${command ? 'command=$p.CommandLine' : ''}} | ConvertTo-Json -Compress }`, signal);
      if (!out) return null;
      const result = JSON.parse(out.replace(/^\uFEFF/, ''));
      if (result.pid !== pid || !/^\d+$/.test(result.start)) return null;
      if (command && (typeof result.command !== 'string' || !result.command)) return null;
      return { start: result.start, argv: command ? windowsArguments(result.command) : null };
    }
    // ps cannot preserve arbitrary argv boundaries. Fail closed on this host.
    return null;
  } catch { return null; }
}

export async function diagnosticProcessStart(pid) {
  return (await snapshot(Number(pid), false))?.start ?? null;
}

export async function observeProcessPolicy({ pid, start, launchId, stillCurrent, signal }) {
  if (!start || !launchId || !stillCurrent()) return { kind: 'unreadable' };
  const observed = await snapshot(Number(pid), true, signal);
  if (!observed || observed.start !== start || !stillCurrent() || signal?.aborted) return { kind: 'unreadable' };
  const summary = summarizeWebRtcArguments(observed.argv.slice(1));
  // Recheck the same process after parsing; never retain raw evidence.
  observed.argv = null;
  const after = await snapshot(Number(pid), false, signal);
  return after?.start === start && stillCurrent() && !signal?.aborted ? summary : { kind: 'unreadable' };
}

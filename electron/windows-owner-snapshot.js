import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const lockScript = `
$ErrorActionPreference='Stop'
$handles = [Collections.Generic.List[IO.FileStream]]::new()
try {
  $db = $env:AZWAH_LEGACY_SNAPSHOT_DB
  $root = Split-Path -Parent (Split-Path -Parent $db)
  $live = Get-CimInstance Win32_Process -Property Name,CommandLine | Where-Object {
    $_.Name -match '^Azwah.*Owner.*\\.exe$' -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0)
  }
  if ($live) { throw 'Legacy processes still running' }
  foreach ($suffix in @('', '-wal', '-shm', '-journal')) {
    $file = $db + $suffix
    if ($suffix -eq '' -or (Test-Path -LiteralPath $file)) {
      $handles.Add([IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
    }
  }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  [void][Console]::In.ReadLine()
} finally {
  foreach ($handle in $handles) { $handle.Dispose() }
}
`;

export async function withStoppedWindowsOwner(db, operation) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoProfile','-NonInteractive','-Command',lockScript], {
    env:{...process.env,AZWAH_LEGACY_SNAPSHOT_DB:db}, stdio:['pipe','pipe','ignore'], windowsHide:true,
  });
  child.stdin.on('error', () => {});
  const assertLocked = () => {
    try { process.kill(child.pid, 0); }
    catch { throw new Error('The legacy database lock was lost. Retry after closing legacy Owner and its browsers.'); }
  };
  try {
    await new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('Legacy Owner or a database writer is active, or Windows could not lock the source. Close legacy Owner and its browsers, then retry.'));
      };
      const timer = setTimeout(fail, 20000);
      child.once('error', fail);
      child.once('exit', fail);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assertLocked();
    return operation(assertLocked);
  } finally {
    child.stdin.end('\n');
    if (child.pid) child.kill();
  }
}

function checksum(bytes, littleEndian, state = [0,0]) {
  let [a,b] = state;
  const word = offset => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  for (let i=0; i<bytes.length; i+=8) {
    a = (a + word(i) + b) >>> 0;
    b = (b + word(i+4) + a) >>> 0;
  }
  return [a,b];
}

function validateWal(file, header, pageSize, size) {
  const littleEndian = header.readUInt32BE(0) === 0x377f0682;
  let state = checksum(header.subarray(0,24),littleEndian);
  const match = (bytes, offset) => state[0] === bytes.readUInt32BE(offset) && state[1] === bytes.readUInt32BE(offset+4);
  if (!match(header,24)) throw new Error('Owner WAL header checksum failed.');
  const fd = fs.openSync(file,'r');
  try {
    const frame = Buffer.alloc(24+pageSize);
    for (let offset=32;offset<size;offset+=frame.length) {
      const read = fs.readSync(fd,frame,0,frame.length,offset);
      if (read >= 16 && !frame.subarray(8,16).equals(header.subarray(16,24))) break; // Tail from the previous WAL generation.
      if (read !== frame.length || frame.readUInt32BE(0) === 0) throw new Error('Owner WAL contains an incomplete frame.');
      state = checksum(frame.subarray(0,8),littleEndian,state);
      state = checksum(frame.subarray(24),littleEndian,state);
      if (!match(frame,16)) throw new Error('Owner WAL frame checksum failed.');
    }
  } finally {fs.closeSync(fd);}
}

function readHeader(file, count, offset = 0) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(count);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, count, offset));
  } finally { fs.closeSync(fd); }
}

export function recoverOwnerSnapshot(directory) {
  const file = path.join(directory, 'profiles.db');
  const wal = fs.statSync(file + '-wal', {throwIfNoEntry:false});
  const journal = fs.statSync(file + '-journal', {throwIfNoEntry:false});
  if (wal?.size && journal?.size) throw new Error('Owner has overlapping SQLite journals. Open and close legacy Owner to recover them before retrying.');
  if (wal?.size) {
    const header = readHeader(file + '-wal', 32);
    const dbHeader = readHeader(file, 100);
    const pageSize = dbHeader.length === 100 ? dbHeader.readUInt16BE(16) || 0 : 0;
    if (header.length !== 32 || ![0x377f0682,0x377f0683].includes(header.readUInt32BE(0)) ||
        header.readUInt32BE(4) !== 3007000 || header.readUInt32BE(8) !== (pageSize === 1 ? 65536 : pageSize)) {
      throw new Error('Owner WAL header cannot be validated. Open and close legacy Owner before retrying.');
    }
    validateWal(file + '-wal',header,header.readUInt32BE(8),wal.size);
  }
  if (journal?.size) {
    const header = readHeader(file + '-journal', 8);
    if (journal.size > 16 && readHeader(file + '-journal',8,journal.size-8).toString('hex') === 'd9d505f920a163d7') {
      throw new Error('Owner has a multi-database rollback journal. Recover it in legacy Owner before retrying.');
    }
    if (header.length !== 8 || (!header.every(byte => byte === 0) && header.toString('hex') !== 'd9d505f920a163d7')) {
      throw new Error('Owner rollback journal header cannot be validated. Open and close legacy Owner before retrying.');
    }
  }
  const db = new DatabaseSync(file);
  try {
    const check = () => {
      const rows = db.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('Owner snapshot failed SQLite integrity validation.');
    };
    check();
    const mode = db.prepare('PRAGMA journal_mode=DELETE').get();
    if (Object.values(mode)[0] !== 'delete') throw new Error('Owner snapshot could not be consolidated.');
    check();
  } finally { db.close(); }
}

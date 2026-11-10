import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const error = (code, message) => Object.assign(new Error(message), { code, status: 503 });
const versionPattern = /^\d+\.\d+\.\d+\.\d+$/;

export function assertProfileVersion(dir, version) {
  let previous;
  try { previous = fs.readFileSync(path.join(dir, 'Last Version'), 'utf8').trim(); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  if (!versionPattern.test(previous)) throw error('CHROME_PROFILE_VERSION_UNKNOWN', 'Chrome profile version could not be verified.');
  const left = previous.split('.').map(Number);
  const right = version.split('.').map(Number);
  const difference = left.map((n, i) => n - right[i]).find(n => n !== 0) ?? 0;
  if (difference > 0) throw error('CHROME_PROFILE_DOWNGRADE', 'This profile was opened by a newer Chrome version. Update Chrome Stable before reopening it.');
}

export async function resolveWindowsChromeStable({ run = execute } = {}) {
  const command = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
Import-Module (Join-Path $env:PSModulePath 'Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')
$paths = @($env:LOCALAPPDATA, $env:ProgramFiles, \${env:ProgramFiles(x86)}) |
  Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Google\\Chrome\\Application\\chrome.exe' }
$registry = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')
foreach ($key in $registry) {
  $entry = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
  if ($entry) {
    $candidate = [Environment]::ExpandEnvironmentVariables([string]$entry.GetValue('')).Trim([char]34)
    if ($candidate -match '^[A-Z]:\\\\.*\\\\Google\\\\Chrome\\\\Application\\\\chrome\\.exe$') { $paths += $candidate }
  }
}
foreach ($candidate in ($paths | Select-Object -Unique)) {
  if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
  $file = Get-Item -LiteralPath $candidate
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )CN=Google LLC(,|$)') { continue }
  if ($file.VersionInfo.ProductName -ne 'Google Chrome') { continue }
  $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($file.FullName))
  try {
    if ($reader.ReadUInt16() -ne 0x5A4D) { continue }
    $reader.BaseStream.Position = 60
    $offset = $reader.ReadUInt32()
    if ($offset -lt 64 -or ($offset + 26) -gt $reader.BaseStream.Length) { continue }
    $reader.BaseStream.Position = $offset
    if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { continue }
    $reader.BaseStream.Position = $offset + 24
    if ($reader.ReadUInt16() -ne 0x20B) { continue }
  } finally { $reader.Dispose() }
  @{path=$file.FullName;version=$file.VersionInfo.ProductVersion} | ConvertTo-Json -Compress
  exit 0
}
`;
  let result;
  try {
    const system = process.env.SystemRoot || 'C:\\Windows';
    const { stdout } = await run(path.win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 20000, windowsHide: true });
    result = stdout.trim() ? JSON.parse(stdout) : null;
  } catch { throw error('CHROME_STABLE_UNVERIFIED', 'Chrome Stable identity could not be verified. Check the official installation and try again.'); }
  if (!result || !path.win32.isAbsolute(result.path) || !versionPattern.test(result.version)) {
    throw error('CHROME_STABLE_MISSING', 'Install Google Chrome Stable from https://www.google.com/chrome/ and retry. Chrome for Testing is reserved for automated tests.');
  }
  if (Number(result.version.split('.')[0]) < 136) throw error('CHROME_STABLE_TOO_OLD', 'Update Chrome Stable to a supported version before launch.');
  return result;
}

export async function verifyStableBrowserLocation(context, expected, { verifyCoordinates = true } = {}) {
  let page;
  let permissionsGranted = false;
  try {
    page = await context.newPage();
    const response = await page.goto('https://api64.ipify.org/?format=json', { timeout: 15000 });
    const { publicIp } = await import('../proxy-location.js');
    if (!response?.ok() || publicIp((await response.json())?.ip) !== expected.ip) {
      throw new Error('Exit IP mismatch');
    }
    const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone !== expected.timezone) {
      throw new Error('Timezone mismatch');
    }
    if (verifyCoordinates) {
      await context.grantPermissions(['geolocation'], { origin: 'https://api64.ipify.org' });
      permissionsGranted = true;
      const coordinates = await page.evaluate(() => new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(({ coords }) => resolve({
          latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        }), reject, { timeout: 5000, maximumAge: 0 });
      }));
      if (!['latitude', 'longitude', 'accuracy'].every(key => Number.isFinite(coordinates[key]) &&
        Math.abs(coordinates[key] - expected[key]) < 0.000001)) throw new Error('Coordinates mismatch');
    }
  } catch {
    throw error('PROXY_BROWSER_IDENTITY_FAILED', 'Chrome could not verify the proxy exit IP or page location. Check the proxy and retry.');
  } finally {
    try { if (permissionsGranted) await context.clearPermissions(); }
    finally { await page?.close().catch(() => {}); }
  }
}

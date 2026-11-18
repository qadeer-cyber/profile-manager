#Requires -Version 5.1
<#
M13 Dell Latitude 5480 runner — process RAM/CPU via app monitoring API, launch/stop, test:m13.
BLOCKED when not Windows_NT. Uses temp PM_DATA_DIR; does not touch production profiles.
#>
[CmdletBinding()]
param(
  [string] $ProxyUrl = '',
  [string] $ExpectedCommit = ''
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
  Write-Host 'BLOCKED: Run on Windows 10 x64 (Latitude 5480 target).'
  exit 2
}
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..', '..'))
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-M13') ("lat5480-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$report = Join-Path $runRoot 'REPORT.txt'
function Step([string] $Message) {
  $line = (Get-Date).ToUniversalTime().ToString('o') + ' ' + $Message
  Add-Content -LiteralPath $report -Value $line
  Write-Host $line
}
Step "Source: $sourceRoot"
Push-Location $sourceRoot
try {
  $actual = (git rev-parse HEAD).ToLowerInvariant()
  Step "HEAD: $actual"
  if ($ExpectedCommit -and $actual -ne $ExpectedCommit.ToLowerInvariant()) { throw "HEAD mismatch" }
  Step 'Hardware snapshot'
  Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory | Format-List | Out-File (Join-Path $runRoot 'hardware.txt')
  Get-CimInstance Win32_Processor | Select-Object Name, NumberOfLogicalProcessors | Format-List | Out-File (Join-Path $runRoot 'cpu.txt') -Append
  Step 'npm ci + playwright chromium + test:m13'
  & npm ci --no-audit --no-fund 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'npm-ci.log')
  & npx playwright install chromium 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'playwright.log')
  & npm run test:m13 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test-m13.log')
  if ($LASTEXITCODE -ne 0) { throw "test:m13 exit $LASTEXITCODE" }
  if ($ProxyUrl) { Step "Proxy URL supplied — exercise manually against /api/v1/profiles (not automated here)." }
  Step 'Manual: Advanced Monitoring UI — verify per-profile Working Set and Intel HD 620 WebGL (not SwiftShader).'
  Step 'PASS: automated M13 on Windows. See REPORT.txt and logs under run folder.'
  exit 0
} catch {
  Step ("FAIL: " + $_.Exception.Message)
  exit 1
} finally {
  Pop-Location
}

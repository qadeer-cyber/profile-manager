#Requires -Version 5.1
<#
M17 Latitude 5480 validation — isolated PM_DATA_DIR under %LOCALAPPDATA%; never touches owner profiles.
Exit: 0 PASS | 1 FAIL | 2 BLOCKED (non-Windows)
#>
[CmdletBinding()]
param(
  [string] $ExpectedCommit = '',
  [switch] $SkipDeps
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { Write-Host 'BLOCKED: Windows 10 x64 required.'; exit 2 }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..', '..'))
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-M17') "run-$stamp"
$isolatedData = Join-Path $runRoot 'PM_DATA_DIR'
New-Item -ItemType Directory -Path $isolatedData -Force | Out-Null
$jsonPath = Join-Path $runRoot 'REPORT.json'
$txtPath = Join-Path $runRoot 'REPORT.txt'
function Log([string] $m) { Add-Content $txtPath $m; Write-Host $m }
$report = @{
  status = 'RUNNING'
  head = (git -C $repo rev-parse HEAD)
  isolatedDataDir = $isolatedData
  steps = @()
  prereqs = @{}
}
Push-Location $repo
try {
  if ($ExpectedCommit -and ($report.head.ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant())) { throw "HEAD $($report.head) != $ExpectedCommit" }
  $report.prereqs.node = (node -v)
  $report.prereqs.npm = (npm -v)
  if (-not $SkipDeps) {
    Log 'npm ci'
    & npm ci --no-audit --no-fund 2>&1 | Out-File (Join-Path $runRoot 'npm-ci.log')
    if ($LASTEXITCODE -ne 0) { throw "npm ci $LASTEXITCODE" }
    Log 'playwright install chromium'
    & npx playwright install chromium 2>&1 | Out-File (Join-Path $runRoot 'pw.log')
  } else {
    Log 'SkipDeps: using workflow-installed dependencies'
  }
  $env:PM_DATA_DIR = $isolatedData
  $env:PM_API_TOKEN = 'm17-win-smoke'
  foreach ($suite in @('test:m17-regression')) {
    Log $suite
    & npm run $suite 2>&1 | Out-File (Join-Path $runRoot ($suite -replace ':','-') + '.log')
    if ($LASTEXITCODE -ne 0) { throw "$suite exit $LASTEXITCODE" }
    $report.steps += @{ name = $suite; exitCode = 0 }
  }
  Log 'GPU probe'
  $gpu = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion
  $gpu | ConvertTo-Json | Set-Content (Join-Path $runRoot 'gpu.json')
  $report.gpu = ($gpu | Select-Object -ExpandProperty Name -First 1)
  Log 'Manual: confirm HD 620 (not SwiftShader), Advanced Monitoring RAM, 1366x768 UI.'
  $report.status = 'PASS'
  Log 'PASS automated M17 regression on Windows (isolated data dir).'
} catch {
  $report.status = 'FAIL'
  $report.error = $_.Exception.Message
  Log ("FAIL: " + $report.error)
} finally {
  $report | ConvertTo-Json -Depth 6 | Set-Content $jsonPath
  Pop-Location
  if ($report.status -eq 'PASS') { exit 0 }
  if ($report.status -eq 'FAIL') { exit 1 }
  exit 2
}

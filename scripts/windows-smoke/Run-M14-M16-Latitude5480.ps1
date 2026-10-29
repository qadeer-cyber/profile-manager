#Requires -Version 5.1
<#
M14–M16 Latitude 5480 validation — temp data dir only; does not modify user profiles.
BLOCKED when not Windows_NT.
#>
[CmdletBinding()]
param([string] $ExpectedCommit = '')
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { Write-Host 'BLOCKED: Windows 10 x64 required.'; exit 2 }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..', '..'))
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-M14-M16') ("run-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$report = Join-Path $runRoot 'REPORT.json'
$log = Join-Path $runRoot 'REPORT.txt'
function Log([string] $m) { Add-Content $log $m; Write-Host $m }
Push-Location $root
$results = @{ status = 'RUNNING'; head = (git rev-parse HEAD); steps = @() }
try {
  if ($ExpectedCommit -and ((git rev-parse HEAD).ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant())) { throw 'HEAD mismatch' }
  Log 'npm ci'; & npm ci --no-audit --no-fund 2>&1 | Out-File (Join-Path $runRoot 'npm-ci.log')
  Log 'playwright chromium'; & npx playwright install chromium 2>&1 | Out-File (Join-Path $runRoot 'pw.log')
  foreach ($suite in @('test:m10','test:m11','test:m12','test:m13','test:m14')) {
    Log $suite; & npm run $suite 2>&1 | Out-File (Join-Path $runRoot ($suite -replace ':','-') + '.log')
    if ($LASTEXITCODE -ne 0) { throw "$suite failed $LASTEXITCODE" }
    $results.steps += @{ suite = $suite; exit = 0 }
  }
  Log 'Hardware'; Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json | Out-File (Join-Path $runRoot 'gpu.json')
  $results.status = 'PASS'
  $results.note = 'Automated suites passed. Confirm Intel HD 620 WebGL manually; proxy tests need credentials.'
} catch {
  $results.status = 'FAIL'
  $results.error = $_.Exception.Message
  Log ('FAIL: ' + $results.error)
} finally {
  $results | ConvertTo-Json -Depth 5 | Set-Content $report
  Pop-Location
  if ($results.status -eq 'PASS') { exit 0 }
  if ($results.status -eq 'FAIL') { exit 1 }
  exit 2
}

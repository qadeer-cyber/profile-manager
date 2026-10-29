#Requires -Version 5.1
<#
Dell Latitude 5480 (i5-7300U, 8 GB RAM, Intel HD 620, Windows 10) — M12 validation runner.
BLOCKED on non-Windows hosts. Produces PASS/FAIL with logs under %LOCALAPPDATA%\ProfileManager-M12\.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string] $ExpectedCommit = ''
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    Write-Host 'BLOCKED: native Windows required (Latitude 5480 target).'
    exit 2
}
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..', '..'))
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-M12') ("lat5480-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
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
    if ($ExpectedCommit -and $actual -ne $ExpectedCommit.ToLowerInvariant()) { throw "HEAD mismatch (expected $ExpectedCommit)" }
    Step 'npm ci'
    & npm ci --no-audit --no-fund 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'npm-ci.log')
    if ($LASTEXITCODE -ne 0) { throw "npm ci exit $LASTEXITCODE" }
    Step 'playwright install chromium'
    & npx playwright install chromium 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'playwright.log')
    Step 'npm run test:m12'
    & npm run test:m12 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test-m12.log')
    if ($LASTEXITCODE -ne 0) { throw "test:m12 exit $LASTEXITCODE" }
    Step 'Manual: verify WebGL renderer is Intel HD 620 (not SwiftShader); exercise SOCKS5/HTTP proxy; concurrent profiles; backup/rollback in Settings/Diagnostics.'
    Step 'PASS: automated M12 suite on Windows. Complete manual GPU/proxy checks above.'
    exit 0
} catch {
    Step ("FAIL: " + $_.Exception.Message)
    exit 1
} finally {
    Pop-Location
}

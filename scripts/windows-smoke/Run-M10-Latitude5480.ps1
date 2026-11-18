#Requires -Version 5.1
<#
Native Windows verification for Dell Latitude 5480 class hardware (Intel HD 620, Win10/11).
Execution status: BLOCKED on Linux cloud agents — run only on the physical laptop.
No installers, releases, git writes, or cloud services.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string] $ExpectedCommit = '29ef2d113546b64d2482aea988ede0900ee7ee3b'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    Write-Host 'BLOCKED: this script requires native Windows (Latitude 5480 target). Current OS is not Windows_NT.'
    exit 2
}
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..', '..'))
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-M10') ("lat5480-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$log = Join-Path $runRoot 'run.log'
function Write-Step([string] $Message) {
    $line = (Get-Date).ToUniversalTime().ToString('o') + ' ' + $Message
    Add-Content -LiteralPath $log -Value $line
    Write-Host $line
}
Write-Step "Source: $sourceRoot"
Write-Step "Expected commit: $ExpectedCommit"
Push-Location $sourceRoot
try {
    $actual = (git rev-parse HEAD).ToLowerInvariant()
    if ($actual -ne $ExpectedCommit.ToLowerInvariant()) { throw "HEAD is $actual, expected $ExpectedCommit" }
    Write-Step 'npm ci'
    & npm ci --no-audit --no-fund 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'npm-ci.log')
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with $LASTEXITCODE" }
    Write-Step 'playwright install chromium'
    & npx playwright install chromium 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'playwright-install.log')
    Write-Step 'npm run build'
    & npm run build 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'build.log')
    Write-Step 'npm run test:m10'
    & npm run test:m10 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test-m10.log')
    if ($LASTEXITCODE -ne 0) { throw "test:m10 failed with $LASTEXITCODE" }
    Write-Step 'npm run test:m11'
    & npm run test:m11 2>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test-m11.log')
    if ($LASTEXITCODE -ne 0) { throw "test:m11 failed with $LASTEXITCODE" }
    Write-Step 'PASS: automated M10/M11 suites finished on Windows. Inspect WebGL renderer manually for Intel HD 620 (not SwiftShader).'
    exit 0
} catch {
    Write-Step ("FAIL: " + $_.Exception.Message)
    exit 1
} finally {
    Pop-Location
}

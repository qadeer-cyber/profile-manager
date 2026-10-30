#Requires -Version 5.1
<#
.SYNOPSIS
  Local Windows 10/11 M8 qualification (no installer publish, no PR).

.DESCRIPTION
  Reproduces npm run test:m8:acceptance on a developer machine when GitHub-hosted
  windows-2022 jobs fail before execution (billing/spending limit). Collect evidence
  under $EvidenceRoot for handoff.

.PARAMETER EvidenceRoot
  Folder for logs and SHA stamp (created if missing).

.PARAMETER SkipDeps
  Skip npm ci / Playwright browser install (use when deps are already present).
#>
param(
  [string] $EvidenceRoot = (Join-Path $env:TEMP "pm-m8-windows-qualification"),
  [switch] $SkipDeps
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
  throw "Repository root not found (expected package.json under $repoRoot)"
}

New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$log = Join-Path $EvidenceRoot 'm8-qualification.log'
Start-Transcript -Path $log -Force | Out-Null

try {
  Set-Location $repoRoot
  $sha = (git rev-parse HEAD).Trim()
  @(
    "branch=$(git branch --show-current)"
    "sha=$sha"
    "os=$([Environment]::OSVersion.VersionString)"
    "time=$(Get-Date -Format o)"
  ) | Set-Content -Path (Join-Path $EvidenceRoot 'run-metadata.txt') -Encoding UTF8

  if (-not $SkipDeps) {
    npm ci
    npx playwright install chromium
    if (-not (Get-Command firefox -ErrorAction SilentlyContinue)) {
      Write-Host 'Installing Mozilla Firefox via Chocolatey (stock build)...'
      choco install firefox -y --no-progress
    }
  }

  npm run build
  npm run test:m8:acceptance
  'PASS' | Set-Content -Path (Join-Path $EvidenceRoot 'm8-acceptance.result') -Encoding UTF8
  Write-Host "M8 acceptance PASS at $sha. Evidence: $EvidenceRoot"
}
catch {
  'FAIL' | Set-Content -Path (Join-Path $EvidenceRoot 'm8-acceptance.result') -Encoding UTF8
  throw
}
finally {
  Stop-Transcript | Out-Null
}

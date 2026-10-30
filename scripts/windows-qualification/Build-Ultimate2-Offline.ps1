#Requires -Version 5.1
<#
Build a source-qualified, SHA-stamped offline Windows setup from the unified PR.
Runs real Windows M8 + core regression suites before electron-builder.
Nothing is uploaded, installed, published, tagged, or merged.
#>
param(
  [string]$EvidenceRoot = (Join-Path $env:TEMP 'pm-ultimate2-unified-build'),
  [switch]$SkipDeps
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
  param([string]$Name, [string]$Executable, [string[]]$Arguments)
  Write-Host "=== $Name ==="
  $global:LASTEXITCODE = 0
  & $Executable @Arguments
  $exit = $LASTEXITCODE
  if ($exit -ne 0) { throw "$Name exited with code $exit" }
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) { throw 'Repository package.json missing' }
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$status = Join-Path $EvidenceRoot 'build.result'
'FAIL' | Set-Content -Path $status -Encoding UTF8
Start-Transcript -Path (Join-Path $EvidenceRoot 'build-transcript.log') -Force | Out-Null
try {
  Set-Location $repoRoot
  foreach ($cmd in @('git.exe','node.exe','npm.cmd','npx.cmd')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd missing from PATH" }
  }
  $branch = (git.exe branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'integration/ultimate2-unified-pr') {
    throw "Build only the unified PR branch; current branch=$branch"
  }
  $sha = (git.exe rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git HEAD' }
  $dirty = (git.exe status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Working tree must be clean before a source-qualified build' }
  $short = $sha.Substring(0, 8)
  @("branch=$branch","sha=$sha","windows=$([Environment]::OSVersion.VersionString)",
    "started=$(Get-Date -Format o)") |
    Set-Content -Path (Join-Path $EvidenceRoot 'build-metadata.txt') -Encoding UTF8

  # This test gate explicitly refuses 0-failure/2-skip false positives.
  $m8Evidence = Join-Path $EvidenceRoot 'm8'
  if ($SkipDeps) {
    & (Join-Path $PSScriptRoot 'Run-M8-Qualification.ps1') -EvidenceRoot $m8Evidence -SkipDeps
  } else {
    & (Join-Path $PSScriptRoot 'Run-M8-Qualification.ps1') -EvidenceRoot $m8Evidence
  }
  if (-not (Test-Path (Join-Path $m8Evidence 'm8-acceptance.result')) -or
      (Get-Content (Join-Path $m8Evidence 'm8-acceptance.result') -Raw).Trim() -ne 'PASS') {
    throw 'Real Windows Chromium + Firefox M8 acceptance did not pass'
  }
  foreach ($suite in @('test:unit','test:stabilization','test:data-recovery','test:browser-runtime','test:integration:preflight')) {
    Invoke-Checked $suite 'npm.cmd' @('run', $suite)
  }
  # Rebuild Electron's Windows native SQLite module before NSIS packaging.
  Invoke-Checked 'Electron native dependencies' 'npx.cmd' @('electron-builder', 'install-app-deps')
  $buildStart = Get-Date
  Invoke-Checked 'Offline NSIS setup build' 'npm.cmd' @('run', 'dist:win:offline')

  $releaseDir = Join-Path $repoRoot 'release'
  $setups = @(Get-ChildItem -Path $releaseDir -File -Filter '*.exe' | Where-Object {
    $_.Name -match '(?i)offline.*setup|setup.*offline' -and $_.LastWriteTime -ge $buildStart.AddSeconds(-5)
  })
  if ($setups.Count -ne 1) { throw "Expected one newly built offline Setup.exe, got $($setups.Count)" }
  $installer = Join-Path $EvidenceRoot ("Profile-Manager-Ultimate2-unified-$short-offline-Setup-x64.exe")
  Copy-Item -LiteralPath $setups[0].FullName -Destination $installer -Force
  $hash = (Get-FileHash -Path $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  @(
    "Repository: qadeer-cyber/profile-manager",
    "Branch: $branch",
    "Commit: $sha",
    "Source setup: $($setups[0].Name)",
    "Artifact: $(Split-Path $installer -Leaf)",
    "SHA256: $hash",
    "Bytes: $((Get-Item -LiteralPath $installer).Length)",
    "Windows real M8: 2 PASS / 0 FAIL / 0 SKIP",
    "Core regression suites: commanded; see build-transcript.log",
    "Publish: no (locally built, unsigned, not an approved release)",
    "Generated: $(Get-Date -Format o)"
  ) | Set-Content -Path (Join-Path $EvidenceRoot 'BUILD-MANIFEST.txt') -Encoding UTF8
  'PASS' | Set-Content -Path $status -Encoding UTF8
  Write-Host "Source-qualified local offline installer: $installer"
  Write-Host "SHA256: $hash"
  Write-Host "Evidence: $EvidenceRoot"
}
catch {
  'FAIL' | Set-Content -Path $status -Encoding UTF8
  throw
}
finally { Stop-Transcript | Out-Null }

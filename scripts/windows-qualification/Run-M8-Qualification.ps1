#Requires -Version 5.1
<#
  Real Windows M8 evidence gate. Always fails closed if an external command fails
  or if the TAP result does not confirm 2 PASS / 0 FAIL / 0 SKIP.
  No installer, GitHub release, deployment or branch mutation.
#>
param(
  [string]$EvidenceRoot = (Join-Path $env:TEMP 'pm-m8-windows-qualification'),
  [switch]$SkipDeps,
  [switch]$SkipNativeBootstrap,
  [switch]$SelfTestNativeFailure
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-NodeGypEnv.ps1')
function Invoke-Checked {
  param([string]$Name, [string]$Executable, [string[]]$Arguments)
  $global:LASTEXITCODE = 0
  & $Executable @Arguments
  $exit = $LASTEXITCODE
  if ($exit -ne 0) { throw "$Name failed with exit code $exit" }
}
function Find-Firefox {
  if ($env:PM_FIREFOX_EXECUTABLE -and (Test-Path -LiteralPath $env:PM_FIREFOX_EXECUTABLE)) {
    return $env:PM_FIREFOX_EXECUTABLE
  }
  $roots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'))
  foreach ($root in $roots) {
    if ($root) {
      $candidate = Join-Path $root 'Mozilla Firefox\firefox.exe'
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  return $null
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) { throw 'Missing repository package.json' }
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$stamp = Join-Path $EvidenceRoot 'm8-acceptance.result'
'FAIL' | Set-Content -Path $stamp -Encoding UTF8
Start-Transcript -Path (Join-Path $EvidenceRoot 'm8-qualification.log') -Force | Out-Null
try {
  Set-Location $repoRoot
  if ($SelfTestNativeFailure) {
    $trapped = $false
    try { Invoke-Checked 'intentional failure self-test' 'cmd.exe' @('/d', '/c', 'exit 7') }
    catch { $trapped = $true }
    if (-not $trapped) { throw 'Native exit-code guard failed its own negative test' }
    'SELF_TEST_PASS' | Set-Content (Join-Path $EvidenceRoot 'native-guard.result') -Encoding UTF8
    Write-Host 'Native exit-code guard correctly rejected exit 7.'
    return
  }
  foreach ($name in @('git.exe', 'node.exe', 'npm.cmd', 'npx.cmd')) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$name not found in PATH" }
  }
  $sha = (git.exe rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
  $branch = (git.exe branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'git branch failed' }
  $node = (node.exe --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $node -notmatch '^v22\.') { throw "Node.js 22.x is required, found $node" }
  @("branch=$branch", "sha=$sha", "node=$node",
    "os=$([Environment]::OSVersion.VersionString)", "time=$(Get-Date -Format o)") |
    Set-Content (Join-Path $EvidenceRoot 'run-metadata.txt') -Encoding UTF8
  if (-not $SkipDeps) {
    $prereqEvidence = Join-Path $EvidenceRoot 'native-prereqs'
    $prereqScript = Join-Path $PSScriptRoot 'Ensure-WindowsNativeBuildPrereqs.ps1'
    $prereqParams = @{ EvidenceRoot = $prereqEvidence }
    if ($SkipNativeBootstrap) { $prereqParams.SkipBootstrap = $true }
    & $prereqScript @prereqParams
    Import-WindowsNodeGypEnv -EvidenceRoot $prereqEvidence
    Invoke-Checked 'npm ci' 'npm.cmd' @('ci')
    Invoke-Checked 'Playwright Chromium install' 'npx.cmd' @('playwright', 'install', 'chromium')
  }
  $firefox = Find-Firefox
  if (-not $firefox -and -not $SkipDeps) {
    if (Get-Command choco.exe -ErrorAction SilentlyContinue) {
      Invoke-Checked 'Install stock Firefox' 'choco.exe' @('install', 'firefox', '-y', '--no-progress')
    } elseif (Get-Command winget.exe -ErrorAction SilentlyContinue) {
      Invoke-Checked 'Install stock Firefox' 'winget.exe' @('install', '--id', 'Mozilla.Firefox', '-e', '--accept-package-agreements', '--accept-source-agreements')
    }
    $firefox = Find-Firefox
  }
  if (-not $firefox) { throw 'Stock Firefox executable not found. Install Mozilla Firefox and rerun.' }
  $env:PM_FIREFOX_EXECUTABLE = $firefox
  "firefox=$firefox" | Add-Content (Join-Path $EvidenceRoot 'run-metadata.txt')
  Invoke-Checked 'Vite UI build' 'npm.cmd' @('run', 'build')

  # Capture the TAP summary rather than inferring success from the process exit alone.
  $tap = Join-Path $EvidenceRoot 'm8-acceptance.tap.log'
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    $result = @(& npm.cmd run test:m8:acceptance 2>&1)
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldPreference
  }
  $result | Out-File -FilePath $tap -Encoding utf8
  $result | ForEach-Object { Write-Host $_ }
  if ($exit -ne 0) { throw "M8 acceptance exited $exit" }
  $body = Get-Content -LiteralPath $tap -Raw
  if ($body -notmatch '(?m)^\s*# pass\s+2\s*$' -or
      $body -notmatch '(?m)^\s*# fail\s+0\s*$' -or
      $body -notmatch '(?m)^\s*# skipped\s+0\s*$') {
    throw 'M8 TAP summary is missing 2 PASS / 0 FAIL / 0 SKIP; no PASS stamp'
  }
  'PASS' | Set-Content -Path $stamp -Encoding UTF8
  Write-Host "M8 WINDOWS ACCEPTANCE PASS on $sha. Evidence: $EvidenceRoot"
}
catch {
  'FAIL' | Set-Content -Path $stamp -Encoding UTF8
  Write-Error $_
  throw
}
finally {
  Stop-Transcript | Out-Null
}

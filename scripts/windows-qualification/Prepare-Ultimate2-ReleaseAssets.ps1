#Requires -Version 5.1
<#
  Prepare Ultimate 2.0 pre-release files from a PASS-qualified Build-Ultimate2-Offline evidence dir.
  Does NOT create git tags or GitHub releases (fail-closed). Owner runs gh release create separately.
#>
param(
  [Parameter(Mandatory)]
  [string]$EvidenceRoot,
  [string]$RcTag = '',
  [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EvidenceRoot)) {
  throw "EvidenceRoot not found: $EvidenceRoot"
}
$buildResult = Join-Path $EvidenceRoot 'build.result'
if (-not $Force) {
  if (-not (Test-Path -LiteralPath $buildResult)) {
    throw 'build.result missing — run Build-Ultimate2-Offline.ps1 first'
  }
  if ((Get-Content -LiteralPath $buildResult -Raw).Trim() -ne 'PASS') {
    throw 'build.result is not PASS; refusing to prepare release assets'
  }
}
$m8Result = Join-Path $EvidenceRoot 'm8\m8-acceptance.result'
$m8Summary = 'NOT VERIFIED'
if ((Test-Path -LiteralPath $m8Result) -and (Get-Content -LiteralPath $m8Result -Raw).Trim() -eq 'PASS') {
  $m8Summary = '2 PASS / 0 FAIL / 0 SKIP (see m8-acceptance.tap.log)'
}

$exes = @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Filter 'Profile-Manager-Ultimate2-unified-*-offline-Setup-x64.exe')
if ($exes.Count -ne 1) {
  throw "Expected exactly one Profile-Manager-Ultimate2-unified-*-offline-Setup-x64.exe under $EvidenceRoot, found $($exes.Count)"
}
$exe = $exes[0]
$hash = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($exe.Name)" | Set-Content -Path (Join-Path $EvidenceRoot 'SHA256SUMS.txt') -Encoding ascii

$metaPath = Join-Path $EvidenceRoot 'build-metadata.txt'
$sha = 'unknown'
if (Test-Path -LiteralPath $metaPath) {
  $line = Get-Content -LiteralPath $metaPath | Where-Object { $_ -match '^sha=' } | Select-Object -First 1
  if ($line) { $sha = $line.Split('=', 2)[1].Trim() }
}
if ($sha -eq 'unknown') {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $sha = (git.exe -C $repoRoot rev-parse HEAD 2>$null).Trim()
}
$short = if ($sha.Length -ge 8) { $sha.Substring(0, 8) } else { '00000000' }
if (-not $RcTag) {
  $RcTag = "ultimate2-unified-rc.$short"
}

$manifestPath = Join-Path $EvidenceRoot 'BUILD-MANIFEST.txt'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  @(
    "Repository: qadeer-cyber/profile-manager",
    "Branch: integration/ultimate2-unified-pr",
    "Commit: $sha",
    "Artifact: $($exe.Name)",
    "SHA256: $hash",
    "Bytes: $($exe.Length)",
    "Windows real M8: $m8Summary",
    "Publish: prepared-only (not uploaded)",
    "Suggested RC tag: $RcTag",
    "Generated: $(Get-Date -Format o)"
  ) | Set-Content -Path $manifestPath -Encoding UTF8
} else {
  Add-Content -Path $manifestPath -Value "Release prep: $(Get-Date -Format o)"
  Add-Content -Path $manifestPath -Value "Suggested RC tag: $RcTag"
  Add-Content -Path $manifestPath -Value "SHA256SUMS.txt: refreshed"
}

$template = Join-Path $PSScriptRoot 'PRE-RELEASE-NOTES.template.md'
$draft = Join-Path $EvidenceRoot 'PRE-RELEASE-NOTES-DRAFT.md'
if (-not (Test-Path -LiteralPath $template)) {
  throw "Missing template: $template"
}
$body = Get-Content -LiteralPath $template -Raw
$body = $body.Replace('{{FULL_SHA}}', $sha)
$body = $body.Replace('{{RC_TAG}}', $RcTag)
$body = $body.Replace('{{M8_SUMMARY}}', $m8Summary)
$body = $body.Replace('{{EXE_NAME}}', $exe.Name)
$body = $body.Replace('{{SHA256}}', $hash)
$body = $body.Replace('{{BYTES}}', [string]$exe.Length)
$body = $body.Replace('{{UTC_TIMESTAMP}}', (Get-Date -Format o))
$body | Set-Content -Path $draft -Encoding UTF8

Write-Host "Release assets prepared (not published):"
Write-Host "  EXE: $($exe.FullName)"
Write-Host "  SHA256SUMS.txt"
Write-Host "  BUILD-MANIFEST.txt"
Write-Host "  PRE-RELEASE-NOTES-DRAFT.md"
Write-Host "  Suggested tag: $RcTag (create manually with gh release create --prerelease)"

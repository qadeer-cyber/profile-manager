# Strict Windows Chromium patch qualification. Never bypass failed hunks.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string] $Source,
  [Parameter(Mandatory)][string] $Patch,
  [switch] $Apply,
  [switch] $AlreadyApplied
)
$ErrorActionPreference = 'Stop'
if ($Apply -and $AlreadyApplied) { throw 'Choose Apply or AlreadyApplied.' }
$Source = (Resolve-Path -LiteralPath $Source).ProviderPath
$Patch = (Resolve-Path -LiteralPath $Patch).ProviderPath
$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$patchBytes = [IO.File]::ReadAllBytes($Patch)
$patchText = $utf8.GetString($patchBytes)
if (!$patchBytes.Length -or $patchText.StartsWith([char]0xFEFF) -or $patchText.Contains("`r")) {
  throw 'Azwah patch must be UTF-8 without BOM and LF-only. Check .gitattributes and checkout conversion.'
}
$headers = [regex]::Matches($patchText, '(?m)^diff --git a/(?<path>[^ \r\n]+) b/\k<path>\nindex (?<old>[0-9a-f]{40})\.\.(?<new>[0-9a-f]{40}) 100644$')
$allHeaders = [regex]::Matches($patchText, '(?m)^diff --git ')
if ($headers.Count -ne 10 -or $allHeaders.Count -ne $headers.Count) {
  throw "Expected 10 fully specified Azwah patch files; got $($headers.Count) matching of $($allHeaders.Count) total."
}
$records = @($headers | ForEach-Object {
  [pscustomobject]@{ Path = $_.Groups['path'].Value; Old = $_.Groups['old'].Value; New = $_.Groups['new'].Value }
})
$paths = @($records | ForEach-Object { $_.Path })
if (@($paths | Sort-Object -Unique).Count -ne $paths.Count) { throw 'Duplicate patch path.' }
Write-Output "PATCH QUALIFICATION: $($paths.Count) files; UTF-8, no BOM, LF patch."
Write-Output 'Effective core.autocrlf (with config origin):'
& $git -C $Source config --show-origin --get core.autocrlf
if ($LASTEXITCODE -gt 1) { throw 'Failed reading git core.autocrlf.' }
Write-Output 'Chromium checkout .gitattributes (effective text/eol):'
& $git -C $Source check-attr text eol -- @paths
if ($LASTEXITCODE -ne 0) { throw 'git check-attr failed.' }
Write-Output 'Git index and Windows worktree EOL:'
& $git -C $Source ls-files --eol -- @paths
if ($LASTEXITCODE -ne 0) { throw 'git ls-files --eol failed.' }
function Read-IndexBlob {
  param([string] $Object)
  $start = [Diagnostics.ProcessStartInfo]::new($git)
  foreach ($arg in @('-C', $Source, 'cat-file', 'blob', $Object)) { $start.ArgumentList.Add($arg) }
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  $memory = [IO.MemoryStream]::new()
  try {
    $process.StandardOutput.BaseStream.CopyTo($memory)
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git cat-file failed for $($Object): $errorText" }
    return ,$memory.ToArray()
  } finally {
    $memory.Dispose()
    $process.Dispose()
  }
}
function Hash-Bytes {
  param([byte[]] $Value)
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Value))
}
$staged = @(& $git -C $Source diff --cached --name-only)
if ($LASTEXITCODE -ne 0 -or $staged.Count) { throw 'Chromium staged changes present; refusing to overwrite anything.' }
$normalize = [Collections.Generic.List[string]]::new()
foreach ($record in $records) {
  $indexSha = (& $git -C $Source rev-parse ":$($record.Path)").Trim()
  if ($LASTEXITCODE -ne 0 -or $indexSha -cne $record.Old) {
    throw "Pinned Chromium index mismatch: $($record.Path), expected $($record.Old), found $indexSha."
  }
  $indexBytes = Read-IndexBlob $indexSha
  $path = Join-Path $Source ($record.Path.Replace('/', [IO.Path]::DirectorySeparatorChar))
  $workingBytes = [IO.File]::ReadAllBytes($path)
  $indexHash = Hash-Bytes $indexBytes
  $workingHash = Hash-Bytes $workingBytes
  if ($AlreadyApplied) {
    $actual = (& $git -C $Source hash-object --no-filters -- $path).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -cne $record.New) {
      throw "Patched working file does not match expected Azwah result $($record.Path): $actual."
    }
    Write-Output "PASS applied $($record.Path): old=$indexSha new=$actual"
  } elseif ($indexHash -cne $workingHash) {
    $converted = $utf8.GetBytes($utf8.GetString($workingBytes).Replace("`r`n", "`n"))
    if ((Hash-Bytes $converted) -cne $indexHash) {
      throw "Non-EOL working-tree mismatch for $($record.Path): index SHA256=$indexHash, working SHA256=$workingHash."
    }
    $normalize.Add($record.Path)
    Write-Output "CRLF-only worktree conversion CONFIRMED: $($record.Path); index SHA256=$indexHash, worktree SHA256=$workingHash"
  } else {
    Write-Output "PASS identical index/worktree bytes $($record.Path) SHA256=$indexHash"
  }
}
# Check the pristine Git index separately from Windows working-tree patching.
& $git -C $Source apply --cached --check -- $Patch
if ($LASTEXITCODE -ne 0) { throw 'git apply --cached --check FAILED: index or patch context mismatch; no fallback.' }
Write-Output 'PASS git apply --cached --check.'
if ($AlreadyApplied) {
  $changed = @(& $git -C $Source diff --name-only HEAD)
  if ($LASTEXITCODE -ne 0) { throw 'git diff --name-only failed.' }
  if ((@($changed | Sort-Object) -join "`n") -cne (@($paths | Sort-Object) -join "`n")) {
    throw "Applied patch changed an unexpected tracked file set: $($changed -join ', ')."
  }
  & $git -C $Source apply --reverse --check -- $Patch
  if ($LASTEXITCODE -ne 0) { throw 'Reverse patch check failed.' }
  & $git -C $Source diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Patched diff contains whitespace errors.' }
  Write-Output 'PASS all 10 applied blob hashes, exact file set, reverse check and diff --check.'
  return
}
& $git -C $Source apply --check -- $Patch
$initialWorkingPass = ($LASTEXITCODE -eq 0)
Write-Output "Initial working-tree git apply --check: $(if ($initialWorkingPass) { 'PASS' } else { 'FAIL' }); cached check: PASS."
if ($normalize.Count) {
  Write-Output "Checking out only $($normalize.Count) files with byte-proven CRLF conversion, using core.autocrlf=false."
  & $git -C $Source -c core.autocrlf=false checkout-index --force -- @($normalize.ToArray())
  if ($LASTEXITCODE -ne 0) { throw 'Safe LF checkout failed.' }
  foreach ($name in $normalize) {
    $record = @($records | Where-Object { $_.Path -eq $name })[0]
    $path = Join-Path $Source ($name.Replace('/', [IO.Path]::DirectorySeparatorChar))
    $rawSha = (& $git -C $Source hash-object --no-filters -- $path).Trim()
    if ($LASTEXITCODE -ne 0 -or $rawSha -cne $record.Old) {
      throw "Post-checkout bytes do not equal original Git index blob for $name ($rawSha)."
    }
  }
}
& $git -C $Source apply --check -- $Patch
if ($LASTEXITCODE -ne 0) { throw 'Working-tree patch check still fails despite exact index source; this is not an EOL-only fix.' }
Write-Output 'PASS git apply --check (working tree).'
if ($Apply) {
  & $git -C $Source apply -- $Patch
  if ($LASTEXITCODE -ne 0) { throw 'Patch application failed.' }
  & $git -C $Source apply --reverse --check -- $Patch
  if ($LASTEXITCODE -ne 0) { throw 'Applied patch reverse verification failed.' }
  & $git -C $Source diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Applied source whitespace validation failed.' }
  foreach ($record in $records) {
    $path = Join-Path $Source ($record.Path.Replace('/', [IO.Path]::DirectorySeparatorChar))
    $actual = (& $git -C $Source hash-object --no-filters -- $path).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -cne $record.New) {
      throw "Azwah output blob differs from patch result for $($record.Path): $actual."
    }
  }
  Write-Output "PASS exactly $($records.Count) Azwah patch files applied, with correct final blobs and reverse check."
} else {
  Write-Output 'PASS read-only patch qualification.'
}

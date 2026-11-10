# Experimental cross-runner Ninja checkpoint proof with actual pinned Chromium zlib units.
# This does not use Chromium GN's real production build graph.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('shard','merge')][string]$Mode,
  [string]$Shard
)
$ErrorActionPreference = 'Stop'
$pin = 'b0cbb99d9f0f9fbbb6c6780e73b17984e991c866'
if ($Mode -eq 'shard' -and $Shard -notin @('adler32','crc32')) { throw 'Unknown shard' }
git config --global core.autocrlf false
if ($Mode -eq 'merge') {
  # Shards already verified their pinned Chromium commit. Avoid a third
  # remote fetch: restore authenticated artifacts and validate source hashes.
  New-Item -ItemType Directory -Force 'chromium/third_party/zlib' | Out-Null
} elseif (!(Test-Path 'chromium/.git')) {
  New-Item -ItemType Directory -Force chromium | Out-Null
  git -C chromium init --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
  git -C chromium remote add origin https://chromium.googlesource.com/chromium/src.git
  git -C chromium sparse-checkout init --no-cone
  if ($LASTEXITCODE -ne 0) { throw 'sparse setup failed' }
  git -C chromium sparse-checkout set --no-cone -- third_party/zlib
  if ($LASTEXITCODE -ne 0) { throw 'sparse paths failed' }
  git -C chromium fetch --depth=1 --filter=blob:none origin $pin
  if ($LASTEXITCODE -ne 0) { throw 'Pinned source fetch failed' }
  git -C chromium checkout --detach FETCH_HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Pinned source checkout failed' }
}
if ($Mode -eq 'shard' -and (git -C chromium rev-parse HEAD) -ne $pin) { throw 'Wrong Chromium revision' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsroot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1
if (!$vsroot) { throw 'MSVC toolchain missing' }
$toolset = Get-ChildItem (Join-Path $vsroot 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$bin = Join-Path $toolset.FullName 'bin/Hostx64/x64'
$cl = Join-Path $bin 'cl.exe'
$lib = Join-Path $bin 'lib.exe'
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Include'
$sdk = Get-ChildItem $sdkRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'ucrt/stddef.h') } | Sort-Object Name -Descending | Select-Object -First 1
if (!$sdk) { throw 'Windows UCRT headers missing' }
$ninjaCmd = Get-Command ninja.exe -ErrorAction SilentlyContinue
if (!$ninjaCmd) {
  python -m pip install --disable-pip-version-check --quiet ninja==1.13.0
  if ($LASTEXITCODE -ne 0) { throw 'Ninja install failed' }
  $ninjaDir = python -c 'import ninja; print(ninja.BIN_DIR)'
  $env:Path = "$ninjaDir;$env:Path"
  $ninjaCmd = Get-Command ninja.exe -ErrorAction Stop
}
$ninja = $ninjaCmd.Source
$env:AZWAH_CL = $cl
$env:AZWAH_LIB = $lib
$env:AZWAH_ZLIB_INC = (Resolve-Path 'chromium/third_party/zlib').Path
$env:AZWAH_VC_INC = Join-Path $toolset.FullName 'include'
$env:AZWAH_UCRT_INC = Join-Path $sdk.FullName 'ucrt'
$cc = @'
@echo off
"%AZWAH_CL%" /nologo /c /W3 /TC /I"%AZWAH_ZLIB_INC%" /I"%AZWAH_VC_INC%" /I"%AZWAH_UCRT_INC%" /Fo"%~2" "%~1"
'@
$archive = @'
@echo off
"%AZWAH_LIB%" /NOLOGO /MACHINE:X64 /OUT:"%~1" "%~2" "%~3"
'@
Set-Content -LiteralPath 'qa-ninja-cc.cmd' -Value $cc -Encoding ascii
Set-Content -LiteralPath 'qa-ninja-lib.cmd' -Value $archive -Encoding ascii
$graph = @'
rule cc
  command = cmd /c qa-ninja-cc.cmd $in $out
  description = COMPILING $out
rule archive
  command = cmd /c qa-ninja-lib.cmd $out $in
  description = ARCHIVING $out
build out/adler32.obj: cc chromium/third_party/zlib/adler32.c
build out/crc32.obj: cc chromium/third_party/zlib/crc32.c
build out/azwah-ninja-zlib.lib: archive out/adler32.obj out/crc32.obj
default out/azwah-ninja-zlib.lib
'@
Set-Content -LiteralPath 'qa-two-shard.ninja' -Value $graph -Encoding ascii
New-Item -ItemType Directory -Force out | Out-Null
if ($Mode -eq 'shard') {
  & $ninja -f qa-two-shard.ninja "out/$Shard.obj"
  if ($LASTEXITCODE -ne 0) { throw "Ninja shard $Shard failed" }
  New-Item -ItemType Directory -Force checkpoint | Out-Null
  $src = "chromium/third_party/zlib/$Shard.c"
  $obj = "out/$Shard.obj"
  Copy-Item -LiteralPath $obj -Destination (Join-Path checkpoint "$Shard.obj")
  Copy-Item -LiteralPath $src -Destination (Join-Path checkpoint "source-$Shard.c")
  Copy-Item -LiteralPath '.ninja_log' -Destination (Join-Path checkpoint "log-$Shard.txt")
  [ordered]@{
    revision = $pin
    shard = $Shard
    source_sha256 = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant()
    object_sha256 = (Get-FileHash -LiteralPath $obj -Algorithm SHA256).Hash.ToLowerInvariant()
    compiler_sha256 = (Get-FileHash -LiteralPath $cl -Algorithm SHA256).Hash.ToLowerInvariant()
    ninja_version = ((& $ninja --version) | Select-Object -First 1)
    toolset = $toolset.Name
  } | ConvertTo-Json | Set-Content -LiteralPath checkpoint/manifest.json -Encoding utf8
  Write-Output "SHARD OK: $Shard; object stored for merge runner"
  exit 0
}
$manifests = @{}
$logRows = @('# ninja log v5')
foreach ($name in @('adler32','crc32')) {
  $folder = "incoming/chromium-ninja-$name"
  $manifest = Get-Content -LiteralPath "$folder/manifest.json" -Raw | ConvertFrom-Json
  $src = "chromium/third_party/zlib/$name.c"
  $obj = "$folder/$name.obj"
  if ($manifest.revision -cne $pin -or $manifest.shard -cne $name) { throw "Invalid provenance: $name" }
  $shardSource = "$folder/source-$name.c"
  if (!(Test-Path -LiteralPath $shardSource)) { throw "Missing pinned source: $name" }
  if ((Get-FileHash $shardSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.source_sha256) { throw "Source hash mismatch: $name" }
  Copy-Item -LiteralPath $shardSource -Destination $src -Force
  if ((Get-FileHash $obj -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.object_sha256) { throw "Object hash mismatch: $name" }
  if ((Get-FileHash $cl -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.compiler_sha256) { throw "Toolchain mismatch: $name" }
  if ($manifest.ninja_version -cne ((& $ninja --version) | Select-Object -First 1)) { throw "Ninja version mismatch: $name" }
  $manifests[$name] = $manifest
  Copy-Item -LiteralPath $obj -Destination "out/$name.obj"
  $log = @(Get-Content -LiteralPath "$folder/log-$name.txt")
  if (!$log.Count -or $log[0] -cne '# ninja log v5') { throw "Unexpected Ninja log: $name" }
  $logRows += $log | Select-Object -Skip 1
  # Artifact transfer changes mtimes; source integrity is guaranteed above by SHA256.
  (Get-Item -LiteralPath $src).LastWriteTimeUtc = [datetime]'2020-01-01T00:00:00Z'
}
Set-Content -LiteralPath '.ninja_log' -Value $logRows -Encoding ascii
$dry = (& $ninja -f qa-two-shard.ninja -n -v 'out/azwah-ninja-zlib.lib') | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Ninja dry run failed' }
Write-Output "DRY-RUN: $dry"
if ($dry -match 'qa-ninja-cc.cmd') { throw 'Ninja attempted to rebuild a transferred object' }
if ($dry -notmatch 'qa-ninja-lib.cmd') { throw 'Ninja did not schedule archive edge' }
& $ninja -f qa-two-shard.ninja 'out/azwah-ninja-zlib.lib'
if ($LASTEXITCODE -ne 0) { throw 'Ninja archive edge failed' }
$built = 'out/azwah-ninja-zlib.lib'
$members = (& $lib /NOLOGO /LIST $built) | Out-String
if ($LASTEXITCODE -ne 0 -or $members -notmatch 'adler32.obj' -or $members -notmatch 'crc32.obj') { throw 'Missing archive members' }
New-Item -ItemType Directory -Force merged | Out-Null
Copy-Item -LiteralPath $built -Destination merged/
$hash = (Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  '## Azwah Ninja two-runner checkpoint proof'
  '- Both pinned Chromium zlib units compiled via a Ninja graph on separate Windows workers.'
  '- Objects + Ninja logs transferred across hosted runners with SHA256 provenance.'
  '- Final Ninja dry-run scheduled the archive but no object recompilation.'
  '- Combined static library contains both compiled objects.'
  "- SHA256: $hash"
  '- Not proven: Chromium GN dependency graph, full browser sharding, production installer.'
) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
Write-Output "NINJA CROSS-RUNNER PROOF PASS: $hash"

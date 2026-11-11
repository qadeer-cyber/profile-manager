[CmdletBinding()]
param([switch] $Restore, [switch] $Payload)

$ErrorActionPreference = 'Stop'
$transfer = Join-Path $env:RUNNER_TEMP 'azwah-checkpoint-transfer'
$limit = 4GB
if ($Restore) {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $transfer 'checkpoint.json') | ConvertFrom-Json
    $archive = Get-Item -LiteralPath (Join-Path $transfer 'compiler-cache.zip')
    $identity = Get-FileHash -LiteralPath (Join-Path $transfer 'identity.json')
    $sourceRun = if ($env:GITHUB_JOB -eq 'build') { '42962642150' } else { $env:GITHUB_RUN_ID }
    $sourceCommit = if ($env:GITHUB_JOB -eq 'build') { '747344682ad4ce9bff797b799a0deef10c2b23b1' } else { $env:GITHUB_SHA }
    $sourceAttempt = if ($env:GITHUB_JOB -eq 'build') { '1' } else { $env:GITHUB_RUN_ATTEMPT }
    if ($manifest.run -cne $sourceRun -or $manifest.commit -cne $sourceCommit -or
        $manifest.attempt -cne $sourceAttempt -or $archive.Length -gt $limit -or
        $archive.Length -ne $manifest.bytes -or $identity.Hash -cne $manifest.identity_sha256 -or
        (Get-FileHash -LiteralPath $archive.FullName).Hash -cne $manifest.archive_sha256) {
        throw 'Checkpoint integrity or provenance failed.'
    }
    if (Test-Path -LiteralPath $env:SCCACHE_DIR) { throw 'Restore requires an empty compiler cache destination.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($archive.FullName)
    try {
        $expanded = ($zip.Entries | Measure-Object -Property Length -Sum).Sum
        if ($expanded -le 0 -or $expanded -gt $limit) { throw 'Checkpoint expanded size is invalid.' }
    } finally {
        $zip.Dispose()
    }
    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $env:SCCACHE_DIR
    Write-Output "Restored compiler cache bytes=$($archive.Length) expanded_bytes=$expanded"
    return
}

if ($Payload) {
    $source = Join-Path $env:AZWAH_BUILD_WORKSPACE 'src'
    $out = Join-Path $source 'out/azwah-checkpoint-probe'
    $stage = Join-Path $env:RUNNER_TEMP 'azwah-linked-browser'
    $gn = Join-Path $source 'buildtools/win/gn.exe'
    $deps = & $gn desc $out //chrome:chrome runtime_deps --root=$source
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate Chromium runtime dependencies.' }
    $paths = @($deps | ForEach-Object { $_.Trim() } | Where-Object { $_ }) +
        @('chrome.exe','chrome.dll','icudtl.dat','resources.pak','BASELINE-MANIFEST.json')
    $files = foreach ($path in ($paths | Sort-Object -Unique)) {
        $absolute = [IO.Path]::GetFullPath($path, $out)
        $relative = [IO.Path]::GetRelativePath($out, $absolute)
        if ([IO.Path]::IsPathRooted($relative) -or $relative -match '^\.\.(\\|/|$)') {
            throw "Runtime dependency escapes the Chromium output directory: $path"
        }
        $file = Get-Item -LiteralPath $absolute
        if ($file.PSIsContainer) { throw "Expected a file runtime dependency: $path" }
        $destination = Join-Path $stage $relative
        New-Item -Force -ItemType Directory -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $absolute -Destination $destination
        [ordered]@{ path = $relative; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $destination).Hash }
    }
    if (!(Get-ChildItem -LiteralPath (Join-Path $stage 'locales') -Filter '*.pak' -File)) {
        throw 'Chromium locale payload is missing.'
    }
    $buildIdentity = Get-Content -Raw -LiteralPath (Join-Path $env:RUNNER_TEMP 'azwah-full-identity.json') | ConvertFrom-Json
    [ordered]@{ identity = $buildIdentity; files = @($files) } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'RUNTIME-MANIFEST.json')
    return
}

$identityFile = Join-Path $env:RUNNER_TEMP 'azwah-full-identity.json'
if (!(Test-Path -LiteralPath $identityFile -PathType Leaf)) { throw 'No verified full-build identity to checkpoint.' }
$stage = Join-Path $env:RUNNER_TEMP 'azwah-full-cache'
New-Item -ItemType Directory -Path $stage | Out-Null
$stats = & sccache.exe --show-stats
if ($LASTEXITCODE -ne 0) { throw 'Cannot read compiler cache statistics.' }
$stats | Set-Content -LiteralPath (Join-Path $stage 'sccache.txt')
$stats | Write-Output
& sccache.exe --stop-server
if ($LASTEXITCODE -ne 0) { throw 'Cannot stop the compiler cache server.' }
$archive = Join-Path $stage 'compiler-cache.zip'
Copy-Item -LiteralPath $identityFile -Destination (Join-Path $stage 'identity.json')
[IO.Compression.ZipFile]::CreateFromDirectory($env:SCCACHE_DIR, $archive, [IO.Compression.CompressionLevel]::NoCompression, $false)
$bytes = (Get-Item -LiteralPath $archive).Length
if ($bytes -gt $limit) { throw "Compiler cache archive exceeds the 4 GiB transfer ceiling: $bytes bytes." }
[ordered]@{
    commit = $env:GITHUB_SHA
    run = $env:GITHUB_RUN_ID
    attempt = $env:GITHUB_RUN_ATTEMPT
    bytes = $bytes
    archive_sha256 = (Get-FileHash -LiteralPath $archive).Hash
    identity_sha256 = (Get-FileHash -LiteralPath $identityFile).Hash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'checkpoint.json')
Write-Output "Saved compiler checkpoint bytes=$bytes"

if ($env:AZWAH_NINJA_CHECKPOINT) {
    $out = Join-Path $env:AZWAH_BUILD_WORKSPACE 'src/out/azwah-checkpoint-probe'
    $bundle = Join-Path $stage 'ninja.zip'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bundle) | Out-Null
    & python.exe (Join-Path $PSScriptRoot 'native-ninja-checkpoint.py') save $out $bundle $identityFile
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Ninja output checkpoint was not saved; the compiler checkpoint is still available.'
    }
}

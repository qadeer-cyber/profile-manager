[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Restore', 'Measure')]
    [string] $Stage,

    [switch] $StartupGraph
)

$ErrorActionPreference = 'Stop'
$transfer = Join-Path $env:RUNNER_TEMP 'azwah-checkpoint-transfer'
$archive = Join-Path $transfer 'compiler-cache.zip'
$manifest = Join-Path $transfer 'checkpoint.json'
$maxArchive = if ($StartupGraph) { 512MB } else { 128MB }
$maxExpanded = if ($StartupGraph) { 1GB } else { 512MB }
$replay = $env:GITHUB_JOB -eq 'replay'

if ($Stage -eq 'Restore') {
    $seed = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $item = Get-Item -LiteralPath $archive
    if ($seed.commit -cne $env:GITHUB_SHA -or $seed.run -cne $env:GITHUB_RUN_ID -or
        $seed.attempt -cne $env:GITHUB_RUN_ATTEMPT -or $item.Length -gt $maxArchive -or
        $item.Length -ne $seed.bytes -or (Get-FileHash -LiteralPath $archive).Hash -cne $seed.archive_sha256 -or
        (Get-FileHash -LiteralPath (Join-Path $transfer 'identity.json')).Hash -cne $seed.identity_sha256) {
        throw 'Checkpoint provenance or integrity check failed.'
    }
    if ($StartupGraph -and !$seed.completed) { throw 'A partial archive cannot qualify as a completed replay seed.' }
    if (Test-Path -LiteralPath $env:SCCACHE_DIR) { throw 'Replay cache directory must be fresh.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entries = @($zip.Entries | Where-Object Name)
        $expanded = ($entries | Measure-Object Length -Sum).Sum
        if (!$entries.Count -or $expanded -gt $maxExpanded) { throw 'Unexpected expanded checkpoint size.' }
    } finally {
        $zip.Dispose()
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $env:SCCACHE_DIR
    return
}

$evidence = Join-Path $env:RUNNER_TEMP 'azwah-checkpoint-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$stats = (& sccache.exe --show-stats | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not collect compiler cache statistics.' }
Set-Content -LiteralPath (Join-Path $evidence 'sccache.txt') -Value $stats
Write-Output $stats
& sccache.exe --stop-server
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the compiler cache server cleanly.' }

function Get-Counter([string] $Name) {
    $match = [regex]::Match($stats, "(?m)^$Name[ \t]+(\d+)[ \t]*\r?$")
    if (!$match.Success) { throw "Compiler cache counter missing: $Name" }
    return [long] $match.Groups[1].Value
}

$icuFile = Join-Path $env:RUNNER_TEMP 'azwah-icu-object.sha256'
$objectHash = if (Test-Path -LiteralPath $icuFile) { (Get-Content -LiteralPath $icuFile -Raw).Trim() }
$startupFile = Join-Path $env:RUNNER_TEMP 'azwah-startup-build.json'
$build = if (Test-Path -LiteralPath $startupFile) { Get-Content -LiteralPath $startupFile -Raw | ConvertFrom-Json }
$completed = [bool]($objectHash -and (!$StartupGraph -or $build))
$hits = Get-Counter 'Cache hits'
$misses = Get-Counter 'Cache misses'
$noncacheable = Get-Counter 'Non-cacheable calls'
if ($replay) {
    $seed = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $passed = $hits -ge $seed.cacheable_calls -and $misses -eq 0 -and $noncacheable -eq 0 -and
        $completed -and $objectHash -ceq $seed.object_sha256
    if ($StartupGraph) {
        $passed = $passed -and ($build.outputs | ConvertTo-Json -Compress) -ceq
            ($seed.build.outputs | ConvertTo-Json -Compress)
    }
    [ordered]@{
        passed = $passed
        commit = $env:GITHUB_SHA
        cache_hits = $hits
        cache_misses = $misses
        noncacheable_calls = $noncacheable
        object_sha256 = $objectHash
        replay_build = $build
        compile_seconds_saved = if ($StartupGraph -and $build) { $seed.build.elapsed_seconds - $build.elapsed_seconds }
        seed = $seed
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'replay.json')
    if (!$passed) { throw 'Fresh-runner replay did not prove cache reuse and object hash parity.' }
    Write-Output "PASS fresh Windows runner: $hits hits, zero misses; ICU SHA256=$objectHash"
    return
}

if ($misses -lt 1 -or (!$StartupGraph -and (!$completed -or $noncacheable -ne 0))) {
    throw 'Seed did not produce reusable compiler work.'
}
$completed = $completed -and $noncacheable -eq 0
if (!(Test-Path -LiteralPath (Join-Path $transfer 'identity.json'))) { throw 'Missing build identity.' }
[IO.Compression.ZipFile]::CreateFromDirectory($env:SCCACHE_DIR, $archive)
$size = (Get-Item -LiteralPath $archive).Length
if ($size -gt $maxArchive) { throw "Seed checkpoint exceeded the configured experiment budget: $size bytes." }
[ordered]@{
    commit = $env:GITHUB_SHA
    run = $env:GITHUB_RUN_ID
    attempt = $env:GITHUB_RUN_ATTEMPT
    bytes = $size
    archive_sha256 = (Get-FileHash -LiteralPath $archive).Hash
    identity_sha256 = (Get-FileHash -LiteralPath (Join-Path $transfer 'identity.json')).Hash
    object_sha256 = $objectHash
    completed = $completed
    build = $build
    noncacheable_calls = $noncacheable
    cacheable_calls = $hits + $misses
    cache_hits = $hits
    cache_misses = $misses
} | ConvertTo-Json | Set-Content -LiteralPath $manifest
Write-Output "Seed cache checkpoint bytes=$size; ICU SHA256=$objectHash"

if ($env:GITHUB_OUTPUT) { 'retained=true' | Add-Content -LiteralPath $env:GITHUB_OUTPUT }
if (!$completed) { throw 'Retained a partial compiler checkpoint; this run did not qualify for replay.' }

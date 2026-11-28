# Compile pinned upstream Chromium or the Azwah development source on Windows.
# Outputs stay in the dedicated Chromium build workspace.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string] $ChromiumCommit,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string] $DepotToolsCommit,

    [Parameter(Mandatory)]
    [string] $Workspace,

    [Parameter(Mandatory)]
    [string] $DepotTools,

    [ValidateRange(1, 16)]
    [int] $Jobs = 2,

    [ValidateRange(4, 32)]
    [int] $ReserveGiB = 8,

    [switch] $AzwahSource,

    [switch] $CheckpointProbe,

    # Chained free-runner build: compile through sccache and stop cleanly at the time budget so the
    # next job can continue from the compiler cache. 0 means no budget.
    [switch] $Sccache,

    # Chained build: a tar of the previous stage's Ninja build directory (outputs, .ninja_log, .ninja_deps).
    # Restored after sync and patch, with the freshly synced sources set to a fixed old timestamp, so Ninja
    # skips finished work instead of replaying it from sccache (run 44848736628: replay took ~3.9 of 4.5 h
    # in stage 4).
    [string] $RestoreOutArchive = '',

    # Shipping build: Chromium's internal DCHECKs off (they are on by default in non-official builds and turn
    # minor internal issues into crashes). Owner-approved 2026-11-24.
    [switch] $Shipping,

    # Opt-in canvas readback protection (native-chromium/canvas-noise.patch, original AZWAH code). Applied after the
    # main patch; its SHA-256 is recorded in the manifest so AZWAH offers the setting only for builds that have it.
    [switch] $CanvasPatch,

    [ValidateRange(0, 360)]
    [int] $TimeBudgetMinutes = 0
)

$ErrorActionPreference = 'Stop'
if ($CheckpointProbe -and (!$AzwahSource -or !(Get-Command sccache.exe -ErrorAction SilentlyContinue))) {
    throw 'The checkpoint probe requires Azwah source and the verified sccache executable on PATH.'
}
if ($Sccache -and !(Get-Command sccache.exe -ErrorAction SilentlyContinue)) {
    throw 'The chained build requires the verified sccache executable on PATH.'
}
$deadline = if ($TimeBudgetMinutes -gt 0) { (Get-Date).AddMinutes($TimeBudgetMinutes) } else { $null }
$script:BudgetReached = $false
$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-chromium'
$sourcePatch = Join-Path $sourceRoot 'windows-source.patch'
$canvasPatchFile = Join-Path $sourceRoot 'canvas-noise.patch'
$identityPatchFile = Join-Path $sourceRoot 'identity.patch'
$audioScreenPatchFile = Join-Path $sourceRoot 'audio-screen.patch'
$gpuFontsPatchFile = Join-Path $sourceRoot 'gpu-fonts.patch'
$rectsUaPatchFile = Join-Path $sourceRoot 'rects-webgl-ua.patch'
$mediaWebrtcPatchFile = Join-Path $sourceRoot 'media-webrtc.patch'
$workersPatchFile = Join-Path $sourceRoot 'workers.patch'
$batterySpeechPatchFile = Join-Path $sourceRoot 'battery-speech.patch'
if ($AzwahSource) {
    $upstream = Get-Content -LiteralPath (Join-Path $sourceRoot 'upstream.json') -Raw | ConvertFrom-Json
    if ($ChromiumCommit -ne $upstream.revision) {
        throw "The Azwah source patch requires Chromium $($upstream.revision)."
    }
}
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'An x64 Windows build worker is required.'
}

function Invoke-BuildTool {
    param([string] $Program, [string[]] $Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program exited with code $LASTEXITCODE."
    }
}

function Invoke-BoundedBuildStage {
    param([string] $Program, [string[]] $Arguments, [switch] $Budgeted)
    # An encoded command keeps path quoting in PowerShell and gives us an
    # owned process tree to stop if the build volume reaches its reserve.
    $words = (@($Program) + $Arguments) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
    $command = '$ErrorActionPreference = ''Stop''; & ' + ($words -join ' ') + '; exit $LASTEXITCODE'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $shell = (Get-Process -Id $PID).Path
    if ($drive.AvailableFreeSpace -le $ReserveGiB * 1GB) { throw 'Free disk space is below the build reserve.' }
    $started = Get-Date
    Write-Output "BEGIN $([IO.Path]::GetFileName($Program)) free_bytes=$($drive.AvailableFreeSpace)"
    $nextReport = $started.AddMinutes(5)
    $stage = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) `
        -WorkingDirectory (Get-Location).ProviderPath -NoNewWindow -PassThru
    try {
        while (!$stage.WaitForExit(1000)) {
            $now = Get-Date
            if ($now -ge $nextReport) {
                Write-Output "PROGRESS $([IO.Path]::GetFileName($Program)) elapsed_seconds=$([int]($now - $started).TotalSeconds) free_bytes=$($drive.AvailableFreeSpace)"
                $nextReport = $now.AddMinutes(5)
            }
            if ($drive.AvailableFreeSpace -le $ReserveGiB * 1GB) {
                throw "Stopped $Program because the build volume reached its free-space reserve."
            }
            if ($Budgeted -and $deadline -and $now -ge $deadline) {
                # Stop here; finished objects are already in the compiler cache for the next job.
                Write-Output "BUDGET reached for $([IO.Path]::GetFileName($Program)); stopping so the next job can continue."
                $script:BudgetReached = $true
                & "$env:SystemRoot/System32/taskkill.exe" /PID $stage.Id /T /F | Out-Null
                $stage.WaitForExit(30000) | Out-Null
                return
            }
        }
        if ($stage.ExitCode -ne 0) { throw "$Program exited with code $($stage.ExitCode)." }
    } finally {
        if (!$stage.HasExited) {
            & "$env:SystemRoot/System32/taskkill.exe" /PID $stage.Id /T /F | Out-Null
        }
        Write-Output "END $([IO.Path]::GetFileName($Program)) elapsed_seconds=$([int]((Get-Date) - $started).TotalSeconds) free_bytes=$($drive.AvailableFreeSpace)"
        $stage.Dispose()
    }
}

$Workspace = (Resolve-Path -LiteralPath $Workspace).ProviderPath
$DepotTools = (Resolve-Path -LiteralPath $DepotTools).ProviderPath
if ($Workspace -notmatch '^[A-Za-z]:\\\S+$') {
    throw 'Use a dedicated, space-free checkout directory on a local drive.'
}
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Workspace))
if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') {
    throw 'The Chromium workspace needs a fixed NTFS drive.'
}
if ($drive.AvailableFreeSpace -le $ReserveGiB * 1GB) {
    throw 'Free disk space is below the build reserve.'
}
$memory = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
if ($memory -lt 8GB) {
    throw 'The build worker needs at least 8 GiB of physical RAM.'
}

$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$toolsHead = Invoke-BuildTool $git @('-C', $DepotTools, 'rev-parse', 'HEAD')
$toolsChanges = Invoke-BuildTool $git @('-C', $DepotTools, 'status', '--porcelain', '--untracked-files=no')
if ($toolsHead -ne $DepotToolsCommit -or $toolsChanges) {
    throw 'Use a clean depot_tools checkout at the requested revision.'
}
$gclient = Join-Path $DepotTools 'gclient.bat'
$gn = Join-Path $DepotTools 'gn.bat'
$autoninja = Join-Path $DepotTools 'autoninja.bat'
foreach ($tool in @($gclient, $gn, $autoninja)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing depot_tools command $tool" }
}

# Isolate the toolchain environment from the caller.
$originalPath = $env:Path
$originalUpdate = $env:DEPOT_TOOLS_UPDATE
$originalToolchain = $env:DEPOT_TOOLS_WIN_TOOLCHAIN
Push-Location -LiteralPath $Workspace
try {
    $env:Path = "$DepotTools;$originalPath"
    $env:DEPOT_TOOLS_UPDATE = '0'
    $env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'

    # Hard fail before gclient sync if pinned depot_tools was not initialized.
    # The CI bootstrap happens in the preceding readiness step.
    & (Join-Path $PSScriptRoot 'qualify-native-depot-tools.ps1') -DepotTools $DepotTools -ExpectedCommit $DepotToolsCommit -VerifyOnly

    $marker = Join-Path $Workspace '.azwah-native-baseline'
    $kind = if ($AzwahSource) { 'azwah-native-source-development' } else { 'upstream-chromium-build-baseline' }
    $pins = "$ChromiumCommit $DepotToolsCommit"
    if ($AzwahSource) { $pins += " $kind" }
    if (Test-Path -LiteralPath $marker -PathType Leaf) {
        if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $pins) {
            throw 'Create a new build workspace for different source or tooling pins.'
        }
    } else {
        if (Get-ChildItem -LiteralPath $Workspace -Force | Select-Object -First 1) {
            throw 'Use an empty workspace for the first build.'
        }
        Set-Content -LiteralPath $marker -Value $pins -Encoding ascii
    }

    # A source checkout or applied patch alone does not prove that DEPS sync finished.
    $syncMarker = Join-Path $Workspace '.azwah-native-deps-synced'
    $depsSynced = (Test-Path -LiteralPath $syncMarker -PathType Leaf) -and
        ((Get-Content -LiteralPath $syncMarker -Raw).Trim() -ceq $pins)
    if ($depsSynced -and !(Test-Path -LiteralPath 'src/.git')) {
        throw 'The synchronized workspace is missing its Chromium checkout.'
    }
    if (!$depsSynced -and $drive.AvailableFreeSpace -lt 100GB) {
        throw 'A fresh Chromium dependency sync needs at least 100 GiB free.'
    }

    $patchApplied = $false
    if (Test-Path -LiteralPath 'src/.git') {
        $sourceChanges = Invoke-BuildTool $git @('-C', 'src', 'status', '--porcelain', '--untracked-files=no')
        if ($sourceChanges -and $AzwahSource) {
            if (!$depsSynced) {
                throw 'Patched checkout has no matching completed sync receipt. Use a separate clean workspace.'
            }
            $patchApplied = $true
        } elseif ($sourceChanges) {
            throw 'The Chromium source has local changes.'
        }
    }
    if (!$depsSynced) {
        if (-not (Test-Path -LiteralPath '.gclient')) {
            Invoke-BuildTool $gclient @('config', '--unmanaged', 'https://chromium.googlesource.com/chromium/src.git')
        }
        Invoke-BoundedBuildStage $gclient @('sync', '--no-history', '--revision', "src@$ChromiumCommit", '--jobs', "$Jobs")
    }
    $sourceHead = Invoke-BuildTool $git @('-C', 'src', 'rev-parse', 'HEAD')
    if ($sourceHead -ne $ChromiumCommit) { throw 'The synced Chromium revision did not match the build pin.' }
    if (!$depsSynced) {
        Set-Content -LiteralPath $syncMarker -Value $pins -Encoding ascii
    } else {
        Write-Output 'Reusing the synchronized workspace and existing Ninja outputs, if present.'
    }
    Write-Output "Synced Chromium revision: $sourceHead; free_bytes=$($drive.AvailableFreeSpace)"

    Push-Location -LiteralPath 'src'
    try {
        if ($AzwahSource -and -not $patchApplied) {
            # Validate the Git index and raw Windows checkout before GN/Ninja.
            & (Join-Path $PSScriptRoot 'qualify-native-chromium-patch.ps1') -Source (Get-Location).ProviderPath -Patch $sourcePatch -Apply
        }
        if ($AzwahSource -and $patchApplied) {
            & (Join-Path $PSScriptRoot 'qualify-native-chromium-patch.ps1') -Source (Get-Location).ProviderPath -Patch $sourcePatch -AlreadyApplied
        }
        if ($AzwahSource -and $CanvasPatch) {
            # Fingerprint patches, in order (each is written against the source with the previous ones applied).
            foreach ($fp in @($canvasPatchFile, $identityPatchFile, $audioScreenPatchFile, $gpuFontsPatchFile, $rectsUaPatchFile, $mediaWebrtcPatchFile, $workersPatchFile, $batterySpeechPatchFile)) {
                $name = Split-Path -Leaf $fp
                & $git apply --reverse --check -- $fp 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Output "FINGERPRINT_PATCH $name already applied (reverse check passed)."
                } else {
                    & $git apply --check -- $fp
                    if ($LASTEXITCODE -ne 0) { throw "$name does not apply to the pinned, patched source." }
                    & $git apply -- $fp
                    if ($LASTEXITCODE -ne 0) { throw "$name application failed." }
                    & $git apply --reverse --check -- $fp
                    if ($LASTEXITCODE -ne 0) { throw "Applied $name reverse verification failed." }
                    Write-Output "FINGERPRINT_PATCH $name applied sha256=$((Get-FileHash -LiteralPath $fp -Algorithm SHA256).Hash.ToLowerInvariant())"
                }
            }
            $global:LASTEXITCODE = 0
        }
        $out = if ($AzwahSource) { 'out/azwah-native-development' } else { 'out/azwah-baseline' }
        if ($RestoreOutArchive) {
            if (!(Test-Path -LiteralPath $RestoreOutArchive -PathType Leaf)) { throw "Build directory archive not found: $RestoreOutArchive" }
            $started = Get-Date
            # Sources from this fresh sync get one fixed, old timestamp; outputs keep their own (newer) times.
            $fixed = [DateTime]::new(2001, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
            $root = (Get-Location).ProviderPath
            $count = 0
            foreach ($file in [IO.Directory]::EnumerateFiles($root, '*', [IO.SearchOption]::AllDirectories)) {
                if ($file.StartsWith((Join-Path $root 'out') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
                try { [IO.File]::SetLastWriteTimeUtc($file, $fixed); $count++ } catch { }
            }
            Write-Output "SOURCE_TIMESTAMPS files=$count seconds=$([int]((Get-Date) - $started).TotalSeconds)"
            $started = Get-Date
            & tar -xf $RestoreOutArchive -C $root
            if ($LASTEXITCODE -ne 0) { throw 'Could not extract the previous build directory.' }
            $restored = (Get-ChildItem -LiteralPath (Join-Path $root $out) -Recurse -File | Measure-Object Length -Sum)
            Write-Output "OUT_RESTORED files=$($restored.Count) bytes=$($restored.Sum) seconds=$([int]((Get-Date) - $started).TotalSeconds)"
            # Files changed by the fingerprint patches must look newer than the restored outputs, or Ninja keeps the
            # previous objects (run 45427549124: all four patches applied, "ninja: no work to do", no feature compiled).
            if ($CanvasPatch) {
                $now = [DateTime]::UtcNow
                $touched = 0
                foreach ($fp in @($canvasPatchFile, $identityPatchFile, $audioScreenPatchFile, $gpuFontsPatchFile, $rectsUaPatchFile, $mediaWebrtcPatchFile, $workersPatchFile, $batterySpeechPatchFile)) {
                    foreach ($match in [regex]::Matches((Get-Content -Raw -LiteralPath $fp), '(?m)^diff --git a/(\S+) b/')) {
                        $path = Join-Path $root ($match.Groups[1].Value.Replace('/', [IO.Path]::DirectorySeparatorChar))
                        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Patched file missing: $path" }
                        [IO.File]::SetLastWriteTimeUtc($path, $now)
                        $touched++
                    }
                }
                Write-Output "FINGERPRINT_SOURCES_TOUCHED files=$touched"
                $script:fingerprintRestoreTime = $now
            }
        }
        if ($CheckpointProbe) { $out = 'out/azwah-checkpoint-probe' }
        $manifest = Join-Path $out 'BASELINE-MANIFEST.json'
        if (Test-Path -LiteralPath $manifest -PathType Leaf) {
            Remove-Item -LiteralPath $manifest
        }
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        $gnArgs = @'
is_debug = false
is_component_build = false
is_chrome_branded = false
target_cpu = "x64"
symbol_level = 0
'@
        if ($CheckpointProbe -or $Sccache) {
            $gnArgs += "`n" + 'cc_wrapper = "sccache"' + "`n" + 'use_siso = false'
        }
        if ($Sccache) {
            # Precompiled headers and Clang header modules make compiles uncacheable for sccache. Measured on
            # run 44706934362 stage 1: all 23,303 compile requests were non-cacheable (-fmodules-cache-path),
            # from use_clang_modules (build/config/c++/c++.gni at the pinned revision).
            $gnArgs += "`n" + 'enable_precompiled_headers = false' + "`n" + 'use_clang_modules = false'
        }
        if ($Shipping) { $gnArgs += "`n" + 'dcheck_always_on = false' }
        $argsFile = Join-Path $out 'args.gn'
        if (!(Test-Path -LiteralPath $argsFile -PathType Leaf) -or
            ((Get-Content -LiteralPath $argsFile -Raw).TrimEnd() -cne $gnArgs.TrimEnd())) {
            Set-Content -LiteralPath $argsFile -Value $gnArgs -Encoding ascii
        }
        # Check the real GN binary from synchronized Chromium DEPS, then generate.
        Write-Output 'BEGIN GN executable readiness (actual synced Chromium GN --version).'
        Invoke-BoundedBuildStage $gn @('--version')
        Write-Output 'PASS synced Chromium GN executable.'
        Invoke-BoundedBuildStage $gn @('gen', $out)
        if (!(Test-Path -LiteralPath (Join-Path $out 'build.ninja') -PathType Leaf)) {
            throw 'GN reported success but did not create build.ninja.'
        }
        Write-Output "PASS GN generated native Windows x64 build.ninja at $out."
        if ($CheckpointProbe) {
            $probeTargets = @(Invoke-BuildTool $autoninja @('-C', $out, '-t', 'targets', 'all') |
                ForEach-Object {
                    if ($_ -match '^(obj/[^:]+/icu_util\.obj):\s+cxx') { $Matches[1] }
                } | Sort-Object -Unique)
            if (!$probeTargets.Count) {
                throw 'No C++ object targets found for patched base/i18n/icu_util.cc.'
            }
            # GN can compile the same source into multiple targets. Keep the
            # same deterministic default-toolchain selection on both runners.
            Write-Output "ICU probe candidates: $($probeTargets -join ', ')"
            $probeTarget = $probeTargets[0]
            Write-Output "Selected ICU probe target: $probeTarget"
            $commands = Invoke-BuildTool $autoninja @('-C', $out, '-t', 'commands', $probeTarget)
            if (!($commands | Where-Object { $_ -match 'sccache.*base[/\\]i18n[/\\]icu_util\.cc' })) {
                throw 'The probe compile command does not wrap the patched source with sccache.'
            }
            Invoke-BoundedBuildStage $autoninja @('-C', $out, '-j', "$Jobs", $probeTarget)
            $probeObject = Join-Path $out $probeTarget
            if (!(Test-Path -LiteralPath $probeObject -PathType Leaf)) { throw 'Probe object is missing.' }
            $probeHash = (Get-FileHash -LiteralPath $probeObject).Hash
            Write-Output "Probe object $probeTarget SHA256=$probeHash"
            if ($env:GITHUB_OUTPUT) { "object_sha256=$probeHash" | Add-Content -LiteralPath $env:GITHUB_OUTPUT }
            return
        }
        if ($Sccache) {
            # sccache writes cached objects with ordinary Windows paths, which stop at 260 characters
            # (run 44798415536 stage 2 failed on an object whose full path was exactly 260). Check every
            # build output now instead of failing hours into the build.
            # Every output of the build graph is measured by scripts/chain-path-preflight.mjs (unit-tested
            # with the real failing object); it fails closed on an empty target list.
            $outRoot = (Resolve-Path -LiteralPath $out).ProviderPath
            $targets = Invoke-BuildTool $autoninja @('-C', $out, '-t', 'targets', 'all')
            $preflight = Join-Path $PSScriptRoot 'chain-path-preflight.mjs'
            if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required for the path preflight.' }
            $targets | & node $preflight $outRoot
            if ($LASTEXITCODE -ne 0) { throw 'Path preflight failed: a build output path is too long for sccache (see above).' }
            # Fail within minutes, not after a full job, if compiles still cannot be cached. Skipped when the
            # previous build directory was restored: //base is then already built and compiles nothing.
            if (!$RestoreOutArchive) {
            Write-Output 'BEGIN cacheability check: compile //base through sccache.'
            Invoke-BoundedBuildStage $autoninja @('-C', $out, '-j', "$Jobs", 'base') -Budgeted
            $stats = (& sccache.exe --show-stats | Out-String)
            Write-Output $stats
            $requests = if ($stats -match '(?m)^Compile requests\s+(\d+)') { [int]$Matches[1] } else { 0 }
            $uncacheable = if ($stats -match '(?m)^Non-cacheable calls\s+(\d+)') { [int]$Matches[1] } else { 0 }
            $stored = if ($stats -match '(?m)^Cache misses\s+(\d+)') { [int]$Matches[1] } else { 0 }
            $hits = if ($stats -match '(?m)^Cache hits\s+(\d+)') { [int]$Matches[1] } else { 0 }
            Write-Output "CACHEABILITY requests=$requests stored=$stored hits=$hits uncacheable=$uncacheable"
            if ($requests -eq 0 -or ($stored + $hits) -eq 0 -or $uncacheable -gt [Math]::Floor($requests / 10)) {
                throw "Compiles are not cacheable by sccache (requests=$requests, stored=$stored, hits=$hits, non-cacheable=$uncacheable). Stopping before the full build."
            }
            }
        }
        Write-Output 'BEGIN real Azwah Chromium native chrome target compilation.'
        $targets = @('chrome')
        $outputFiles = @('chrome.exe', 'chrome.dll')
        if (-not $AzwahSource) {
            $targets += 'mini_installer'
            $outputFiles += 'mini_installer.exe'
        }
        Invoke-BoundedBuildStage $autoninja (@('-C', $out, '-j', "$Jobs") + $targets) -Budgeted
        if ($script:BudgetReached) {
            if ($env:GITHUB_OUTPUT) { 'complete=false' | Add-Content -LiteralPath $env:GITHUB_OUTPUT }
            Write-Output 'INCOMPLETE the time budget ended before chrome finished; continue in the next job.'
            # Stopping at the budget is the expected outcome; do not let taskkill's exit code fail the step
            # (run 44706934362 stage 1 failed this way and skipped the cache hand-over).
            $global:LASTEXITCODE = 0
            return
        }
        if ($env:GITHUB_OUTPUT) { "complete=true`nout=$out" | Add-Content -LiteralPath $env:GITHUB_OUTPUT }
        $files = $outputFiles | ForEach-Object {
            $file = Get-Item -LiteralPath (Join-Path $out $_)
            @{
                name = $file.Name
                bytes = $file.Length
                sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
        # A fingerprint build that resumed from older outputs must have relinked chrome.dll after the patched sources
        # were refreshed; otherwise the manifest would claim features the binary does not have.
        if ($CanvasPatch -and $script:fingerprintRestoreTime -and
            (Get-Item -LiteralPath (Join-Path $out 'chrome.dll')).LastWriteTimeUtc -le $script:fingerprintRestoreTime) {
            throw 'Fingerprint patches were applied but chrome.dll was not rebuilt; refusing to record them in the manifest.'
        }
        @{
            kind = $kind
            chromiumCommit = $ChromiumCommit
            depotToolsCommit = $DepotToolsCommit
            buildHost = [Environment]::OSVersion.VersionString
            files = @($files)
            dchecks = if ($Shipping) { 'off' } else { 'on' }
            canvasPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $canvasPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            identityPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $identityPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            rectsUaPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $rectsUaPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            mediaWebrtcPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $mediaWebrtcPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            workersPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $workersPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            batterySpeechPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $batterySpeechPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            gpuFontsPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $gpuFontsPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            audioScreenPatchSha256 = if ($AzwahSource -and $CanvasPatch) { (Get-FileHash -LiteralPath $audioScreenPatchFile -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
            sourcePatchSha256 = if ($AzwahSource) { (Get-FileHash -LiteralPath $sourcePatch -Algorithm SHA256).Hash.ToLowerInvariant() }
        } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest -Encoding utf8
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
    $env:Path = $originalPath
    $env:DEPOT_TOOLS_UPDATE = $originalUpdate
    $env:DEPOT_TOOLS_WIN_TOOLCHAIN = $originalToolchain
}

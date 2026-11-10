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

    [switch] $UseSccache,

    [string[]] $BuildTargets = @()
)

$ErrorActionPreference = 'Stop'
if (($CheckpointProbe -or $UseSccache) -and (!$AzwahSource -or !(Get-Command sccache.exe -ErrorAction SilentlyContinue))) {
    throw 'sccache mode requires Azwah source and the verified sccache executable on PATH.'
}
$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-chromium'
$sourcePatch = Join-Path $sourceRoot 'windows-source.patch'
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
    param([string] $Program, [string[]] $Arguments)
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
        $out = if ($AzwahSource) { 'out/azwah-native-development' } else { 'out/azwah-baseline' }
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
        if ($CheckpointProbe -or $UseSccache) {
            $gnArgs += "`n" + 'cc_wrapper = "sccache"' + "`n" + 'use_siso = false' + "`n" + 'use_clang_modules = false'
        }
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
        if ($BuildTargets.Count -gt 0) {
            Write-Output "BEGIN bounded subsystem targets compilation: $($BuildTargets -join ', ')"
            Invoke-BoundedBuildStage $autoninja (@('-C', $out, '-j', "$Jobs") + $BuildTargets)
            return
        }
        Write-Output 'BEGIN real Azwah Chromium native chrome target compilation.'
        $targets = @('chrome')
        $outputFiles = @('chrome.exe', 'chrome.dll')
        if (-not $AzwahSource) {
            $targets += 'mini_installer'
            $outputFiles += 'mini_installer.exe'
        }
        Invoke-BoundedBuildStage $autoninja (@('-C', $out, '-j', "$Jobs") + $targets)
        $files = $outputFiles | ForEach-Object {
            $file = Get-Item -LiteralPath (Join-Path $out $_)
            @{
                name = $file.Name
                bytes = $file.Length
                sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
        @{
            kind = $kind
            chromiumCommit = $ChromiumCommit
            depotToolsCommit = $DepotToolsCommit
            buildHost = [Environment]::OSVersion.VersionString
            files = @($files)
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

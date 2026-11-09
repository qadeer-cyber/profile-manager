# Compile a pinned upstream Windows baseline before applying Azwah source changes.
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
    [string] $DepotTools
)

$ErrorActionPreference = 'Stop'
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

$Workspace = (Resolve-Path -LiteralPath $Workspace).ProviderPath
$DepotTools = (Resolve-Path -LiteralPath $DepotTools).ProviderPath
if ($Workspace -notmatch '^[A-Za-z]:\\\S+$') {
    throw 'Use a dedicated, space-free checkout directory on a local drive.'
}
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Workspace))
if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS' -or $drive.AvailableFreeSpace -lt 100GB) {
    throw 'The Chromium workspace needs a fixed NTFS drive with at least 100 GiB free.'
}
$memory = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
if ($memory -lt 8GB) {
    throw 'The build worker needs at least 8 GiB of physical RAM.'
}

$git = (Get-Command git.exe -CommandType Application).Source
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

    $marker = Join-Path $Workspace '.azwah-native-baseline'
    $pins = "$ChromiumCommit $DepotToolsCommit"
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

    if (Test-Path -LiteralPath 'src/.git') {
        $sourceChanges = Invoke-BuildTool $git @('-C', 'src', 'status', '--porcelain', '--untracked-files=no')
        if ($sourceChanges) { throw 'The Chromium source has local changes.' }
    }
    if (-not (Test-Path -LiteralPath '.gclient')) {
        Invoke-BuildTool $gclient @('config', '--unmanaged', 'https://chromium.googlesource.com/chromium/src.git')
    }
    Invoke-BuildTool $gclient @('sync', '--no-history', '--revision', "src@$ChromiumCommit")
    $sourceHead = Invoke-BuildTool $git @('-C', 'src', 'rev-parse', 'HEAD')
    if ($sourceHead -ne $ChromiumCommit) { throw 'The synced Chromium revision did not match the build pin.' }

    Push-Location -LiteralPath 'src'
    try {
        $out = 'out/azwah-baseline'
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        @'
is_debug = false
is_component_build = false
is_chrome_branded = false
target_cpu = "x64"
symbol_level = 0
'@ | Set-Content -LiteralPath (Join-Path $out 'args.gn') -Encoding ascii
        Invoke-BuildTool $gn @('gen', $out)
        Invoke-BuildTool $autoninja @('-C', $out, 'chrome', 'mini_installer')
        $files = @('chrome.exe', 'chrome.dll', 'mini_installer.exe') | ForEach-Object {
            $file = Get-Item -LiteralPath (Join-Path $out $_)
            @{
                name = $file.Name
                bytes = $file.Length
                sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
        @{
            kind = 'upstream-chromium-build-baseline'
            chromiumCommit = $ChromiumCommit
            depotToolsCommit = $DepotToolsCommit
            buildHost = [Environment]::OSVersion.VersionString
            files = @($files)
        } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'BASELINE-MANIFEST.json') -Encoding utf8
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
    $env:Path = $originalPath
    $env:DEPOT_TOOLS_UPDATE = $originalUpdate
    $env:DEPOT_TOOLS_WIN_TOOLCHAIN = $originalToolchain
}

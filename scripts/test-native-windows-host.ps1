[CmdletBinding()]
param([Parameter(Mandatory)][string] $Workspace)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pin = Get-Content -LiteralPath (Join-Path $root 'native-chromium/upstream.json') -Raw | ConvertFrom-Json
$workspacePath = (Resolve-Path -LiteralPath $Workspace).ProviderPath
$disk = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($workspacePath))
$os = Get-CimInstance Win32_OperatingSystem
$machine = Get-CimInstance Win32_ComputerSystem
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = $null
if (Test-Path -LiteralPath $vswhere) {
    $vs = & $vswhere -version '[18.0,19.0)' -products '*' -latest -format json | ConvertFrom-Json | Select-Object -First 1
}
$tools = @()
if ($vs) {
    $tools = @(Get-ChildItem -LiteralPath (Join-Path $vs.installationPath 'VC/Tools/MSVC') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $dir = $_.FullName
        [ordered]@{
            version = $_.Name
            x64Compiler = Test-Path -LiteralPath (Join-Path $dir 'bin/Hostx64/x64/cl.exe')
            x64Runtime = Test-Path -LiteralPath (Join-Path $dir 'lib/x64/libcmt.lib')
            atlHeader = Test-Path -LiteralPath (Join-Path $dir 'atlmfc/include/atlbase.h')
            atlLibrary = Test-Path -LiteralPath (Join-Path $dir 'atlmfc/lib/x64/atls.lib')
            mfcHeader = Test-Path -LiteralPath (Join-Path $dir 'atlmfc/include/afx.h')
        }
    })
}
$kits = (Get-ItemProperty -LiteralPath 'HKLM:/SOFTWARE/Microsoft/Windows Kits/Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
$sdkVersions = @()
$sdkFiles = [ordered]@{}
$debugger = $null
if ($kits) {
    $sdkVersions = @(Get-ChildItem -LiteralPath (Join-Path $kits 'Include') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $v = $pin.windowsSdkVersion
    foreach ($relative in @("Include/$v/um/Windows.h", "Include/$v/um/dcomp.h", "Lib/$v/um/x64/kernel32.lib", "Lib/$v/ucrt/x64/ucrt.lib", "bin/$v/x64/rc.exe")) {
        $sdkFiles[$relative] = Test-Path -LiteralPath (Join-Path $kits $relative) -PathType Leaf
    }
    $dbghelp = Get-Item -LiteralPath (Join-Path $kits 'Debuggers/x64/dbghelp.dll') -ErrorAction SilentlyContinue
    if ($dbghelp) {
        $f = $dbghelp.VersionInfo
        $debugger = "$($f.FileMajorPart).$($f.FileMinorPart).$($f.FileBuildPart).$($f.FilePrivatePart)"
    }
}
$dia = [bool]($vs -and (Test-Path -LiteralPath (Join-Path $vs.installationPath 'DIA SDK/bin/amd64/msdia140.dll')))
$storageOK = $disk.DriveType -eq 'Fixed' -and $disk.DriveFormat -eq 'NTFS' -and $disk.AvailableFreeSpace -ge 100GB
$toolsetOK = [bool]($tools | Where-Object { $_.x64Compiler -and $_.x64Runtime -and $_.atlHeader -and $_.atlLibrary -and $_.mfcHeader })
$sdkOK = $sdkFiles.Count -eq 5 -and !($sdkFiles.Values -contains $false)
[ordered]@{
    chromiumRevision = $pin.revision
    toolchainHash = $pin.windowsToolchainHash
    imageOS = $env:ImageOS
    imageVersion = $env:ImageVersion
    architecture = $env:PROCESSOR_ARCHITECTURE
    logicalCPUs = $machine.NumberOfLogicalProcessors
    totalMemoryBytes = [long]$machine.TotalPhysicalMemory
    freeMemoryBytes = [long]$os.FreePhysicalMemory * 1024
    driveFormat = $disk.DriveFormat
    driveTotalBytes = $disk.TotalSize
    workspaceFreeBytes = $disk.AvailableFreeSpace
    requiredFreeBytes = 100GB
    localCacheCapacityUpperBoundBytes = $disk.AvailableFreeSpace
    actionsCacheAllocatedBytes = 0
    storageMeetsMinimum = $storageOK
    visualStudioVersion = $vs.installationVersion
    msvcToolsets = $tools
    installedSdkDirectories = $sdkVersions
    requiredSdkInstaller = $pin.windowsSdkInstallerBuild
    requiredSdkFiles = $sdkFiles
    x64DbgHelpVersion = $debugger
    requiredDebuggerVersion = $pin.minimumWindowsDebuggerVersion
    x64Dia = $dia
    toolchainPresent = [bool]($toolsetOK -and $sdkOK -and $debugger -and
        [version]$debugger -ge [version]$pin.minimumWindowsDebuggerVersion -and $dia)
}

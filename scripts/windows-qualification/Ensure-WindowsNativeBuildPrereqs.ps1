#Requires -Version 5.1
<#
  Ensures node-gyp can compile native modules (better-sqlite3) on Windows x64.
  Provisions Python 3.x and MSVC Build Tools when missing (winget, then Chocolatey).
  Writes node-gyp.env.ps1 under EvidenceRoot; callers must dot-source it in the parent process.
  Does not skip native compile, downgrade dependencies, or alter package-lock.json.
#>
param(
  [string]$EvidenceRoot = (Join-Path $env:TEMP 'pm-windows-native-prereqs'),
  [switch]$SkipBootstrap
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Windows-NodeGypEnv.ps1')

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($machine -and $user) { $env:Path = "$machine;$user" }
  elseif ($machine) { $env:Path = $machine }
}

function Write-PrereqEvidence {
  param([string]$Line)
  if (-not (Test-Path -LiteralPath $EvidenceRoot)) {
    New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
  }
  $path = Join-Path $EvidenceRoot 'native-prereqs.log'
  Add-Content -Path $path -Value (Redact-PrereqLine $Line) -Encoding UTF8
}

function Redact-PrereqLine {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $out = $Text
  foreach ($name in @($env:USERNAME, $env:USERDOMAIN, $env:COMPUTERNAME)) {
    if ($name -and $name.Length -ge 2) { $out = $out.Replace($name, '[redacted]') }
  }
  if ($env:USERPROFILE) { $out = $out.Replace($env:USERPROFILE, '%USERPROFILE%') }
  return $out
}

function Find-PythonExecutable {
  Refresh-ProcessPath
  $candidates = @()
  if ($env:PYTHON -and (Test-Path -LiteralPath $env:PYTHON)) {
    $candidates += $env:PYTHON
  }
  if ($env:npm_config_python -and (Test-Path -LiteralPath $env:npm_config_python)) {
    $candidates += $env:npm_config_python
  }
  foreach ($cmd in @('python.exe', 'py.exe')) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) { $candidates += $found.Source }
  }
  if (Get-Command py.exe -ErrorAction SilentlyContinue) {
    $global:LASTEXITCODE = 0
    $fromLauncher = (& py.exe -3 -c "import sys; print(sys.executable)" 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $fromLauncher) { $candidates += $fromLauncher }
  }
  $localApp = $env:LOCALAPPDATA
  if ($localApp) {
    $glob = Join-Path $localApp 'Programs\Python\Python3*\python.exe'
    $candidates += @(Get-ChildItem -Path $glob -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  }
  foreach ($exe in ($candidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $exe)) { continue }
    $global:LASTEXITCODE = 0
    $ver = (& $exe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { continue }
    $parts = $ver.Split('.')
    if ($parts.Count -ge 2 -and [int]$parts[0] -ge 3 -and [int]$parts[1] -ge 8) {
      return $exe
    }
  }
  return $null
}

function Install-Python3 {
  Write-PrereqEvidence 'Installing Python 3 (required for node-gyp / better-sqlite3)...'
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    & winget.exe install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget Python install failed with exit $LASTEXITCODE" }
    Refresh-ProcessPath
    return
  }
  if (Get-Command choco.exe -ErrorAction SilentlyContinue) {
    & choco.exe install python312 -y --no-progress
    if ($LASTEXITCODE -ne 0) { throw "choco Python install failed with exit $LASTEXITCODE" }
    Refresh-ProcessPath
    return
  }
  throw 'Python 3.8+ is required for node-gyp. Install from https://www.python.org/downloads/ or enable winget/Chocolatey.'
}

function Find-VsWhere {
  $programFiles = ${env:ProgramFiles(x86)}
  if (-not $programFiles) { $programFiles = $env:ProgramFiles }
  $vswhere = Join-Path $programFiles 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) { return $vswhere }
  return $null
}

function Test-VsComponentInstalled {
  param([string[]]$Requires)
  $vswhere = Find-VsWhere
  if (-not $vswhere) { return $false }
  $args = @('-latest', '-products', '*', '-property', 'installationPath')
  foreach ($req in $Requires) { $args += @('-requires', $req) }
  $global:LASTEXITCODE = 0
  $install = (& $vswhere @args 2>$null).Trim()
  return ($LASTEXITCODE -eq 0 -and $install)
}

function Test-MsvcBuildTools {
  return (Test-VsComponentInstalled -Requires @(
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
  ))
}

function Test-WindowsSdkInstalled {
  $sdkIds = @(
    'Microsoft.VisualStudio.Component.Windows11SDK.22621',
    'Microsoft.VisualStudio.Component.Windows11SDK.22000',
    'Microsoft.VisualStudio.Component.Windows10SDK.20348',
    'Microsoft.VisualStudio.Component.Windows10SDK.19041',
    'Microsoft.VisualStudio.Component.Windows10SDK'
  )
  foreach ($id in $sdkIds) {
    if (Test-VsComponentInstalled -Requires @($id)) { return $true }
  }
  return $false
}

function Install-MsvcBuildTools {
  Write-PrereqEvidence 'Installing Visual Studio 2022 Build Tools (VCTools + Windows 10/11 SDK for node-gyp)...'
  $override = @(
    '--wait', '--passive', '--norestart',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--add', 'Microsoft.VisualStudio.Component.Windows10SDK.19041',
    '--includeRecommended'
  ) -join ' '
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    & winget.exe install --id Microsoft.VisualStudio.2022.BuildTools -e --override $override --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget VS Build Tools install failed with exit $LASTEXITCODE" }
    return
  }
  if (Get-Command choco.exe -ErrorAction SilentlyContinue) {
    $params = '--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows10SDK.19041 --includeRecommended --quiet --wait'
    & choco.exe install visualstudio2022buildtools -y --no-progress --package-parameters="$params"
    if ($LASTEXITCODE -ne 0) { throw "choco VS Build Tools install failed with exit $LASTEXITCODE" }
    return
  }
  throw 'MSVC Build Tools are required when better-sqlite3 must compile. Install VS 2022 Build Tools with "Desktop development with C++" and a Windows 10/11 SDK.'
}

function Apply-NodeGypEnvironment {
  param([string]$PythonExe)
  Set-WindowsNodeGypProcessEnv -PythonExe $PythonExe -MsvsVersion '2022'
  $written = Write-WindowsNodeGypEnvFile -EvidenceRoot $EvidenceRoot -PythonExe $PythonExe -MsvsVersion '2022'
  Write-PrereqEvidence "env_file=$written"
  Write-PrereqEvidence "PYTHON=$PythonExe"
  Write-PrereqEvidence 'GYP_MSVS_VERSION=2022'
}

function Assert-WindowsX64 {
  if ($env:PROCESSOR_ARCHITECTURE -notmatch '64') {
    throw "Windows x64 is required; PROCESSOR_ARCHITECTURE=$($env:PROCESSOR_ARCHITECTURE)"
  }
  if ($env:OS -ne 'Windows_NT') {
    throw 'Ensure-WindowsNativeBuildPrereqs.ps1 must run on Windows'
  }
}

Assert-WindowsX64
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
Write-PrereqEvidence "started=$(Get-Date -Format o)"
Write-PrereqEvidence "os=$([Environment]::OSVersion.VersionString)"

$python = Find-PythonExecutable
if (-not $python) {
  if ($SkipBootstrap) {
    throw 'Python 3.8+ not found. Re-run without -SkipNativeBootstrap to auto-install, or install Python manually.'
  }
  Install-Python3
  $python = Find-PythonExecutable
  if (-not $python) { throw 'Python install completed but python.exe is still not discoverable. Restart PowerShell and retry.' }
}
Write-PrereqEvidence "python=$python"
Apply-NodeGypEnvironment -PythonExe $python

if (-not (Test-MsvcBuildTools)) {
  if ($SkipBootstrap) {
    throw 'MSVC Build Tools (VC.Tools.x86.x64) not found. Re-run without -SkipNativeBootstrap or install VS 2022 Build Tools.'
  }
  Install-MsvcBuildTools
  if (-not (Test-MsvcBuildTools)) {
    throw 'VS Build Tools install finished but VC toolchain is still missing. Reboot may be required before npm ci.'
  }
}
Write-PrereqEvidence 'msvc=ok'

if (-not (Test-WindowsSdkInstalled)) {
  if ($SkipBootstrap) {
    throw 'Windows 10/11 SDK component not detected (required for node-gyp). Install SDK via VS Build Tools or re-run without -SkipNativeBootstrap.'
  }
  Install-MsvcBuildTools
  if (-not (Test-WindowsSdkInstalled)) {
    throw 'Windows SDK still missing after Build Tools install. Open Visual Studio Installer and add Windows 10/11 SDK, then retry.'
  }
}
Write-PrereqEvidence 'windows_sdk=ok'

$global:LASTEXITCODE = 0
$ngv = (& npx.cmd --yes node-gyp --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "node-gyp probe failed: $ngv" }
Write-PrereqEvidence "node-gyp=$ngv"

$global:LASTEXITCODE = 0
$pyProbe = (& $python -c "import sys; print(sys.version.replace(chr(10),' '))" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Python probe failed: $pyProbe" }
Write-PrereqEvidence "python_version=$pyProbe"

'PASS' | Set-Content -Path (Join-Path $EvidenceRoot 'native-prereqs.result') -Encoding UTF8
Write-Host "Windows native build prerequisites OK. Dot-source $(Get-WindowsNodeGypEnvPath -EvidenceRoot $EvidenceRoot) before npm ci in this process."

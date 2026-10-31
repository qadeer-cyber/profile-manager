#Requires -Version 5.1
<#
  Ensures node-gyp can compile native modules (better-sqlite3) on Windows x64.
  Provisions Python 3.x and MSVC Build Tools when missing (winget, then Chocolatey).
  Does not skip native compile, downgrade dependencies, or alter package-lock.json.
#>
param(
  [string]$EvidenceRoot = (Join-Path $env:TEMP 'pm-windows-native-prereqs'),
  [switch]$SkipBootstrap
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
  $npmPython = $null
  try {
    $global:LASTEXITCODE = 0
    $npmPython = (& npm.cmd config get python 2>$null).Trim()
  } catch { $npmPython = $null }
  if ($npmPython -and $npmPython -ne 'undefined' -and (Test-Path -LiteralPath $npmPython)) {
    $candidates += $npmPython
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

function Test-MsvcBuildTools {
  $vswhere = Find-VsWhere
  if (-not $vswhere) { return $false }
  $global:LASTEXITCODE = 0
  $install = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null).Trim()
  return ($LASTEXITCODE -eq 0 -and $install)
}

function Install-MsvcBuildTools {
  Write-PrereqEvidence 'Installing Visual Studio 2022 Build Tools (Desktop C++ workload for node-gyp)...'
  $override = '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    & winget.exe install --id Microsoft.VisualStudio.2022.BuildTools -e --override $override --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget VS Build Tools install failed with exit $LASTEXITCODE" }
    return
  }
  if (Get-Command choco.exe -ErrorAction SilentlyContinue) {
    $params = '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait'
    & choco.exe install visualstudio2022buildtools -y --no-progress --package-parameters="$params"
    if ($LASTEXITCODE -ne 0) { throw "choco VS Build Tools install failed with exit $LASTEXITCODE" }
    return
  }
  throw 'MSVC Build Tools are required when better-sqlite3 must compile. Install VS 2022 Build Tools with "Desktop development with C++".'
}

function Set-NodeGypPython {
  param([string]$PythonExe)
  $env:PYTHON = $PythonExe
  $global:LASTEXITCODE = 0
  & npm.cmd config set python $PythonExe
  if ($LASTEXITCODE -ne 0) { throw 'npm config set python failed' }
  & npm.cmd config set msvs_version 2022
  if ($LASTEXITCODE -ne 0) { throw 'npm config set msvs_version failed' }
  Write-PrereqEvidence "PYTHON=$PythonExe"
  Write-PrereqEvidence 'npm msvs_version=2022'
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
Set-NodeGypPython -PythonExe $python

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

$global:LASTEXITCODE = 0
$ngv = (& npx.cmd --yes node-gyp --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "node-gyp probe failed: $ngv" }
Write-PrereqEvidence "node-gyp=$ngv"

$global:LASTEXITCODE = 0
$pyProbe = (& $python -c "import sys; print(sys.version.replace(chr(10),' '))" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Python probe failed: $pyProbe" }
Write-PrereqEvidence "python_version=$pyProbe"

'PASS' | Set-Content -Path (Join-Path $EvidenceRoot 'native-prereqs.result') -Encoding UTF8
Write-Host "Windows native build prerequisites OK. Evidence: $EvidenceRoot"

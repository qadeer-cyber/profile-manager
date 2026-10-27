#Requires -Version 5.1
<#
Source-only Windows x64 QA. Run in a separate powershell.exe process.
No execution-policy changes, installers, releases, Git writes, or profile cleanup.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string] $ExpectedCommit
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This runner requires native Windows 10/11 x64.' }
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable.' }

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runId = 'M3-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'ProfileManager-QA') $runId
$logs = Join-Path $runRoot 'logs'
$workspace = Join-Path $runRoot 'workspace'
$tempRoot = Join-Path $runRoot 'tmp'
$screenshots = Join-Path $runRoot 'screenshots'
foreach ($dir in @($runRoot, $logs, $tempRoot, $screenshots)) {
    [void](New-Item -ItemType Directory -Path $dir)
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$script:results = New-Object 'System.Collections.Generic.List[object]'
$originalEnvironment = @{}
$summary = [ordered]@{
    RunId = $runId; ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
    ActualCommit = $null; StartedUTC = [DateTime]::UtcNow.ToString('o')
    FinishedUTC = $null; Overall = 'RUNNING'; ReadyForAcceptance = $false
    OS = $null; PowerShell = $PSVersionTable.PSVersion.ToString()
    Node = $null; SourceDirectory = $sourceRoot; Workspace = $workspace
    OutputDirectory = $runRoot; FatalError = $null; PinnedInputs = @{}; ChromiumManifest = $null; Steps = @()
}
$exitCode = 2
$consoleEncoding = [Console]::OutputEncoding

function Write-QAMessage([string] $Message) {
    $line = [DateTime]::UtcNow.ToString('o') + ' ' + $Message
    Write-Host $line
    [IO.File]::AppendAllText((Join-Path $runRoot 'runner.log'), $line + [Environment]::NewLine, $utf8)
}
function Save-Results {
    $summary.Steps = @($script:results.ToArray())
    [IO.File]::WriteAllText((Join-Path $runRoot 'results.json'), ($summary | ConvertTo-Json -Depth 12), $utf8)
    if ($script:results.Count -gt 0) {
        $script:results.ToArray() | Select-Object Stage, Kind, Status, ExitCode, CleanupExitCode, TimedOut, StartedUTC, FinishedUTC, StdoutLog, StderrLog |
            Export-Csv -LiteralPath (Join-Path $runRoot 'results.csv') -NoTypeInformation -Encoding UTF8
    }
}
function Quote-NativeArgument([AllowEmptyString()][string] $Value) {
    # Windows argv quoting; never send user paths through cmd.exe or Invoke-Expression.
    if ($Value -ne '' -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}
function Invoke-QAProcess {
    param([string] $Stage, [string] $Kind, [string] $FilePath,
          [string[]] $Arguments, [string] $WorkingDirectory)
    $prefix = '{0:D2}-{1}' -f ($script:results.Count + 1), $Stage
    $stdout = Join-Path $logs ($prefix + '.stdout.log')
    $stderr = Join-Path $logs ($prefix + '.stderr.log')
    $started = [DateTime]::UtcNow.ToString('o')
    $code = -1
    $timedOut = $false
    $cleanupCode = $null
    $process = $null
    Write-QAMessage ('START ' + $Stage)
    try {
        $argumentLine = (@($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
        $startOptions = @{
            FilePath = $FilePath; ArgumentList = $argumentLine; WorkingDirectory = $WorkingDirectory
            RedirectStandardOutput = $stdout; RedirectStandardError = $stderr
            PassThru = $true; NoNewWindow = $true
        }
        $process = Start-Process @startOptions
        if (-not $process.WaitForExit(1800000)) {
            $timedOut = $true
            # Only this runner-created process tree; never kill by image name or scan user browsers.
            if (-not $process.HasExited) {
                $killOptions = @{
                    FilePath = (Join-Path $env:SystemRoot 'System32\taskkill.exe')
                    ArgumentList = ('/PID ' + $process.Id + ' /T /F')
                    PassThru = $true; Wait = $true; NoNewWindow = $true
                    RedirectStandardOutput = (Join-Path $logs ($prefix + '.cleanup.stdout.log'))
                    RedirectStandardError = (Join-Path $logs ($prefix + '.cleanup.stderr.log'))
                }
                $killer = Start-Process @killOptions
                $killer.Refresh()
                $cleanupCode = $killer.ExitCode
                $killer.Dispose()
            }
            [void]$process.WaitForExit(10000)
            $code = 124
        } else {
            $process.WaitForExit()
            $process.Refresh()
            $code = $process.ExitCode
        }
    } catch {
        [IO.File]::AppendAllText($stderr, $_.Exception.Message + [Environment]::NewLine, $utf8)
    } finally {
        if ($null -ne $process) { $process.Dispose() }
    }
    $record = [pscustomobject][ordered]@{
        Stage = $Stage; Kind = $Kind; Status = $(if ($code -eq 0) { 'PASS' } else { 'FAIL' })
        ExitCode = $code; CleanupExitCode = $cleanupCode; TimedOut = $timedOut; StartedUTC = $started
        FinishedUTC = [DateTime]::UtcNow.ToString('o')
        Executable = $FilePath; Arguments = @($Arguments)
        StdoutLog = [IO.Path]::GetFileName($stdout); StderrLog = [IO.Path]::GetFileName($stderr)
    }
    $script:results.Add($record)
    Save-Results
    Write-QAMessage ('END ' + $Stage + ' exit=' + $code)
    return $record
}
function Require-Success($Record) {
    if ($Record.ExitCode -ne 0) { throw ('Required setup failed: ' + $Record.Stage + '; inspect its stdout/stderr logs.') }
}
function Set-QAEnvironment([string] $Name, [AllowNull()][string] $Value) {
    if (-not $originalEnvironment.ContainsKey($Name)) {
        $originalEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

# Split chained npm scripts so a failure never hides the next independent suite.
$testStages = @(
    @{ Name = 'm3-targeted'; Npm = $true; Args = @('run', 'test:m3') },
    @{ Name = 'm3-browser'; Npm = $false; Args = @('--test', 'test/browser-settings-browser.test.js', 'test/regional-locale-browser.test.js') },
    @{ Name = 'unit'; Npm = $true; Args = @('run', 'test:unit') },
    @{ Name = 'desktop-unit'; Npm = $false; Args = @('--test', 'test/desktop-unit.test.js', 'test/termination-evidence.test.js') },
    @{ Name = 'desktop-engine'; Npm = $false; Args = @('test/desktop-engine.e2e.js') },
    @{ Name = 'api'; Npm = $false; Args = @('scripts/run-with-automation.mjs', 'test/api.e2e.js') },
    @{ Name = 'engine'; Npm = $false; Args = @('scripts/run-with-automation.mjs', 'test/engine.e2e.js') },
    @{ Name = 'lifecycle'; Npm = $false; Args = @('scripts/run-with-automation.mjs', 'test/lifecycle.e2e.js') },
    @{ Name = 'proxies'; Npm = $false; Args = @('scripts/run-with-automation.mjs', 'test/proxy-library.e2e.js') },
    @{ Name = 'security'; Npm = $false; Args = @('test/security.e2e.js') },
    @{ Name = 'security-migration'; Npm = $false; Args = @('test/security-migration.e2e.js') },
    @{ Name = 'ui'; Npm = $false; Args = @('test/ui-smoke.run.js') }
)
try {
    [Console]::OutputEncoding = $utf8
    Write-QAMessage ('Output: ' + $runRoot)
    $git = (Get-Command git.exe -CommandType Application -ErrorAction Stop).Source
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $head = Invoke-QAProcess 'verify-head' 'Preflight' $git @('-C', $sourceRoot, 'rev-parse', 'HEAD') $sourceRoot
    Require-Success $head
    $summary.ActualCommit = ([IO.File]::ReadAllText((Join-Path $logs $head.StdoutLog))).Trim()
    if ($summary.ActualCommit -ine $ExpectedCommit) { throw ('HEAD mismatch. Expected ' + $ExpectedCommit + ', found ' + $summary.ActualCommit) }
    $clean = Invoke-QAProcess 'verify-tracked-clean' 'Preflight' $git @('-C', $sourceRoot, 'status', '--porcelain', '--untracked-files=no') $sourceRoot
    Require-Success $clean
    if (([IO.File]::ReadAllText((Join-Path $logs $clean.StdoutLog))).Trim()) { throw 'Tracked changes exist. Commit/stash them yourself or use a separate clean checkout; the runner will not reset files.' }

    # Snapshot only tracked commit contents, excluding personal data, .env files and node_modules.
    $archive = Join-Path $runRoot 'source.zip'
    $snapshot = Invoke-QAProcess 'snapshot-source' 'Setup' $git @('-C', $sourceRoot, 'archive', '--format=zip', ('--output=' + $archive), $ExpectedCommit) $sourceRoot
    Require-Success $snapshot
    Expand-Archive -LiteralPath $archive -DestinationPath $workspace
    foreach ($relative in @('package-lock.json', 'server/chromium-manifest.json')) {
        $summary.PinnedInputs[$relative] = (Get-FileHash -LiteralPath (Join-Path $workspace $relative) -Algorithm SHA256).Hash
    }
    $summary.ChromiumManifest = Get-Content -LiteralPath (Join-Path $workspace 'server/chromium-manifest.json') -Raw | ConvertFrom-Json

    # Scope every override to this process and restore it in finally. Never dump environment values.
    foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
        if ($entry.Key -match '^(PM_|PLAYWRIGHT_|ELECTRON_)') { Set-QAEnvironment ([string]$entry.Key) $null }
    }
    if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') { throw 'NODE_TLS_REJECT_UNAUTHORIZED=0 is unsafe. Remove that setting before validation.' }
    foreach ($name in @('NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'PWDEBUG', 'DEBUG', 'PROFILE_ID', 'TARGET_URL', 'PROXY_TEST_URL',
                         'HEADLESS', 'OUT_DIR', 'npm_config_target', 'npm_config_runtime',
                         'npm_config_arch', 'npm_config_target_arch', 'npm_config_nodedir', 'npm_config_disturl')) {
        Set-QAEnvironment $name $null
    }
    Set-QAEnvironment 'TEMP' $tempRoot
    Set-QAEnvironment 'TMP' $tempRoot
    Set-QAEnvironment 'TMPDIR' $tempRoot
    Set-QAEnvironment 'PM_DATA_DIR' (Join-Path $runRoot 'app-data')
    Set-QAEnvironment 'PM_USER_DATA' (Join-Path $runRoot 'user-data')
    Set-QAEnvironment 'PLAYWRIGHT_BROWSERS_PATH' (Join-Path $runRoot 'browsers')
    Set-QAEnvironment 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD' '1'
    Set-QAEnvironment 'ELECTRON_SKIP_BINARY_DOWNLOAD' '1'
    Set-QAEnvironment 'OUT_DIR' $screenshots
    Set-QAEnvironment 'npm_config_cache' (Join-Path $runRoot 'npm-cache')
    Set-QAEnvironment 'npm_config_devdir' (Join-Path $runRoot 'node-headers')
    Set-QAEnvironment 'npm_config_strict_ssl' 'true'

    # Windows fixtures spawn sleep.exe; Git for Windows supplies it (not the PS sleep alias).
    $gitDir = Split-Path -Parent $git
    $sleepDir = $null
    foreach ($candidate in @((Join-Path $gitDir '..\usr\bin'), (Join-Path $gitDir '..\..\usr\bin'))) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'sleep.exe')) { $sleepDir = [IO.Path]::GetFullPath($candidate); break }
    }
    if (-not $sleepDir) {
        $sleepCommand = Get-Command sleep.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($null -eq $sleepCommand) { throw 'sleep.exe is required by unchanged desktop fixtures. Install Git for Windows with its usr\bin tools.' }
        $sleepDir = Split-Path -Parent $sleepCommand.Source
    }
    Set-QAEnvironment 'PATH' ((Split-Path -Parent $node) + ';' + $sleepDir + ';' + $env:PATH)

    $runtime = Invoke-QAProcess 'node-version' 'Preflight' $node @('-p', "JSON.stringify({version:process.version,major:Number(process.versions.node.split('.')[0]),arch:process.arch,platform:process.platform,execPath:process.execPath})") $workspace
    Require-Success $runtime
    $summary.Node = ([IO.File]::ReadAllText((Join-Path $logs $runtime.StdoutLog))) | ConvertFrom-Json
    if ($summary.Node.major -ne 22 -or $summary.Node.arch -ne 'x64' -or $summary.Node.platform -ne 'win32') { throw 'Use Node.js 22 x64 on native Windows. No version is installed or switched by this runner.' }
    try { $summary.OS = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture }
    catch { $summary.OS = [Environment]::OSVersion.VersionString }

    # Invoke npm-cli with the verified Node executable; avoid .cmd shell quoting and PS npm.ps1 policy issues.
    $npmCli = $null
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
    $npmDirs = @((Split-Path -Parent $summary.Node.execPath), (Split-Path -Parent $node))
    if ($null -ne $npmCommand) { $npmDirs += (Split-Path -Parent $npmCommand.Source) }
    foreach ($dir in $npmDirs) {
        $candidate = Join-Path $dir 'node_modules\npm\bin\npm-cli.js'
        if (Test-Path -LiteralPath $candidate) { $npmCli = $candidate; break }
    }
    if (-not $npmCli) { throw 'npm-cli.js not found beside Node/npm. Use an official Node.js 22 x64 installation including npm.' }
    $npmVersion = Invoke-QAProcess 'npm-version' 'Preflight' $node @($npmCli, '--version') $workspace
    Require-Success $npmVersion
    $dependencies = Invoke-QAProcess 'locked-dependencies' 'Setup' $node @($npmCli, 'ci', '--include=dev', '--no-audit', '--no-fund') $workspace
    Require-Success $dependencies
    $native = Invoke-QAProcess 'node-native-sqlite' 'Setup' $node @('scripts/confirm-node-native.mjs') $workspace
    Require-Success $native
    $browser = Invoke-QAProcess 'verified-google-chromium' 'Setup' $node @('scripts/m3-install-runtime.mjs', '--source=google') $workspace
    Require-Success $browser
    $build = Invoke-QAProcess 'build-ui' 'Setup' $node @($npmCli, 'run', 'build') $workspace
    Require-Success $build

    foreach ($stage in $testStages) {
        $stageArgs = @($stage.Args)
        if ($stage.Npm) { $stageArgs = @($npmCli) + $stageArgs }
        $result = Invoke-QAProcess $stage.Name 'Test' $node $stageArgs $workspace
        if ($result.TimedOut) { throw ('Timed out: ' + $stage.Name + '. Remaining suites are blocked; owned-process cleanup logs were preserved.') }
    }
    if (@($script:results.ToArray() | Where-Object { $_.ExitCode -ne 0 }).Count -gt 0) {
        $summary.Overall = 'FAIL'; $exitCode = 1
    } else {
        $summary.Overall = 'SOURCE_QA_PASS'; $exitCode = 0
    }
} catch {
    $summary.FatalError = $_.Exception.Message
    $summary.Overall = 'BLOCKED'
    $exitCode = 2
    Write-QAMessage ('BLOCKED: ' + $summary.FatalError)
} finally {
    foreach ($stage in $testStages) {
        if (@($script:results.ToArray() | Where-Object { $_.Stage -eq $stage.Name }).Count -eq 0) {
            $script:results.Add([pscustomobject][ordered]@{
                Stage = $stage.Name; Kind = 'Test'; Status = 'BLOCKED'; ExitCode = $null; CleanupExitCode = $null; TimedOut = $false
                StartedUTC = $null; FinishedUTC = $null; Executable = $null; Arguments = @()
                StdoutLog = $null; StderrLog = $null
            })
        }
    }
    [Console]::OutputEncoding = $consoleEncoding
    foreach ($name in $originalEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
    foreach ($relative in $summary.PinnedInputs.Keys) {
        try {
            $after = (Get-FileHash -LiteralPath (Join-Path $workspace $relative) -Algorithm SHA256).Hash
            if ($after -ne $summary.PinnedInputs[$relative]) { throw ('Pinned input changed: ' + $relative) }
        } catch {
            $summary.FatalError = $_.Exception.Message
            $summary.Overall = 'BLOCKED'; $exitCode = 2
            Write-QAMessage $summary.FatalError
        }
    }
    $summary.FinishedUTC = [DateTime]::UtcNow.ToString('o')
    Save-Results
    try {
        $apiScreenshot = Join-Path $workspace 'screenshot.png'
        if (Test-Path -LiteralPath $apiScreenshot) { Copy-Item -LiteralPath $apiScreenshot -Destination (Join-Path $screenshots 'api.png') }
        Write-QAMessage ('Result: ' + $summary.Overall + '; exit=' + $exitCode + '; acceptance still requires review.')
        $evidence = @($logs, $screenshots, (Join-Path $runRoot 'results.json'), (Join-Path $runRoot 'results.csv'), (Join-Path $runRoot 'runner.log'))
        Compress-Archive -LiteralPath $evidence -DestinationPath (Join-Path $runRoot 'evidence.zip')
    } catch {
        $summary.FatalError = 'Evidence packaging failed: ' + $_.Exception.Message
        $summary.Overall = 'BLOCKED'; $exitCode = 2
        Save-Results
        Write-QAMessage $summary.FatalError
    }
    Write-Host ('Return this file: ' + (Join-Path $runRoot 'evidence.zip'))
    Write-Host ('All output retained at: ' + $runRoot)
}
exit $exitCode

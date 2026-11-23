[CmdletBinding()]
param([Parameter(Mandatory)][string] $Workspace)
$ErrorActionPreference = 'Stop'
$out = Join-Path $Workspace 'src/out/azwah-native-development'
$manifest = Get-Content -LiteralPath (Join-Path $out 'BASELINE-MANIFEST.json') -Raw | ConvertFrom-Json
$repo = Split-Path -Parent $PSScriptRoot
$pin = Get-Content -LiteralPath (Join-Path $repo 'native-chromium/upstream.json') -Raw | ConvertFrom-Json
$patchHash = (Get-FileHash -LiteralPath (Join-Path $repo 'native-chromium/windows-source.patch')).Hash
if ($manifest.kind -ne 'azwah-native-source-development' -or $manifest.chromiumCommit -ne $pin.revision -or
    $manifest.sourcePatchSha256 -ne $patchHash) { throw 'The build manifest does not match the Azwah source pins.' }
foreach ($name in @('chrome.exe', 'chrome.dll')) {
    $file = Get-Item -LiteralPath (Join-Path $out $name)
    $record = @($manifest.files | Where-Object { $_.name -eq $name })
    if ($record.Count -ne 1 -or $record[0].bytes -ne $file.Length -or
        $record[0].sha256 -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw "$name failed manifest verification." }
    $stream = [IO.File]::OpenRead($file.FullName)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "$name lacks the DOS header." }
        $stream.Position = 60
        $offset = $reader.ReadUInt32()
        if ($offset -lt 64 -or $offset + 26 -gt $stream.Length) { throw "$name has an invalid PE header offset." }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw "$name is not Windows x64." }
        $stream.Position = $offset + 24
        if ($reader.ReadUInt16() -ne 0x20b) { throw "$name is not PE32+." }
    } finally {
        $stream.Dispose()
    }
}
$exe = Get-Item -LiteralPath (Join-Path $out 'chrome.exe')
if ($exe.VersionInfo.ProductName -ne 'Azwah Browser') { throw "Unexpected product name: $($exe.VersionInfo.ProductName)" }
foreach ($name in @('icudtl.dat', 'resources.pak')) {
    if (!(Test-Path -LiteralPath (Join-Path $out $name) -PathType Leaf)) { throw "Missing runtime file: $name" }
}
$smoke = Join-Path $Workspace ('smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smoke | Out-Null
$stdout = Join-Path $smoke 'stdout.txt'
$stderr = Join-Path $smoke 'stderr.txt'
$launch = @{
    FilePath = $exe.FullName
    ArgumentList = @('--headless', '--no-first-run', ('"--user-data-dir=' + (Join-Path $smoke 'profile') + '"'),
        '--dump-dom', 'data:text/html,%3Ctitle%3EAzwahNativeSmoke%3C/title%3E')
    PassThru = $true
    RedirectStandardOutput = $stdout
    RedirectStandardError = $stderr
}
$process = Start-Process @launch
try {
    if (!$process.WaitForExit(45000)) { throw 'The native browser smoke test timed out.' }
    if ($process.ExitCode -ne 0 -or !(Select-String -LiteralPath $stdout -SimpleMatch '<title>AzwahNativeSmoke</title>' -Quiet)) {
        Write-Output "SMOKE_FAILED exit=$($process.ExitCode)"
        Write-Output '--- stderr (first 80 lines) ---'; Get-Content -LiteralPath $stderr -TotalCount 80
        Write-Output '--- stderr (last 40 lines) ---'; Get-Content -LiteralPath $stderr -Tail 40
        Write-Output '--- stdout (first 20 lines) ---'; Get-Content -LiteralPath $stdout -TotalCount 20
        # Diagnosis only: these variants never turn a failure into a pass.
        $variants = [ordered]@{ 'headless-new' = @('--headless=new'); 'no-gpu' = @('--headless', '--disable-gpu');
            'no-sandbox-diagnostic' = @('--headless', '--no-sandbox'); 'single-process-diagnostic' = @('--headless', '--single-process') }
        foreach ($name in $variants.Keys) {
            $dir = Join-Path $smoke $name; New-Item -ItemType Directory -Path $dir | Out-Null
            $args2 = @($variants[$name]) + @('--no-first-run', ('"--user-data-dir=' + (Join-Path $dir 'profile') + '"'), '--enable-logging=stderr', '--v=0',
                '--dump-dom', 'data:text/html,%3Ctitle%3EAzwahNativeSmoke%3C/title%3E')
            $p2 = Start-Process -FilePath $exe.FullName -ArgumentList $args2 -PassThru -RedirectStandardOutput (Join-Path $dir 'out.txt') -RedirectStandardError (Join-Path $dir 'err.txt')
            $ok = $p2.WaitForExit(45000)
            if (!$ok) { & "$env:SystemRoot/System32/taskkill.exe" /PID $p2.Id /T /F | Out-Null }
            $dom = Select-String -LiteralPath (Join-Path $dir 'out.txt') -SimpleMatch '<title>AzwahNativeSmoke</title>' -Quiet
            Write-Output "SMOKE_VARIANT name=$name exited=$ok exit=$(if ($ok) { $p2.ExitCode }) dom=$dom"
            Get-Content -LiteralPath (Join-Path $dir 'err.txt') -TotalCount 25 | Where-Object { $_ -match 'FATAL|ERROR|Check failed|NOTREACHED' } | Select-Object -First 8
        }
        throw 'Native Chromium failed the headless DOM smoke test.'
    }
} finally {
    if (!$process.HasExited) { & "$env:SystemRoot/System32/taskkill.exe" /PID $process.Id /T /F | Out-Null }
    $process.Dispose()
}
$manifest | ConvertTo-Json -Depth 6
Write-Output 'Native Azwah Chromium PE headers, branding, hashes and DOM startup verified.'

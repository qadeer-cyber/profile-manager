[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Workspace,
    [string] $OutputDirectory = 'src/out/azwah-native-development'
)
$ErrorActionPreference = 'Stop'
$out = Join-Path $Workspace $OutputDirectory
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
        Get-Content -LiteralPath $stderr -Tail 30
        throw 'Native Chromium failed the headless DOM smoke test.'
    }
} finally {
    if (!$process.HasExited) { & "$env:SystemRoot/System32/taskkill.exe" /PID $process.Id /T /F | Out-Null }
    $process.Dispose()
}
$manifest | ConvertTo-Json -Depth 6
Write-Output 'Native Azwah Chromium PE headers, branding, hashes and DOM startup verified.'

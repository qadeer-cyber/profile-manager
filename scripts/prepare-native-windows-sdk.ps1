[CmdletBinding()]
param([Parameter(Mandatory)][string] $Workspace)

$ErrorActionPreference = 'Stop'
$report = & (Join-Path $PSScriptRoot 'test-native-windows-host.ps1') -Workspace $Workspace
if (!$report.storageMeetsMinimum) { throw 'The workspace needs at least 100 GiB free on NTFS before SDK preparation.' }
if ($report.requiredSdkInstaller -ne '10.0.28000.2270') { throw 'Review the official download for the new SDK pin.' }
if (!$report.toolchainPresent) {
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('azwah-sdk-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    try {
        $installer = Join-Path $scratch 'winsdksetup.exe'
        # Microsoft Learn lists this URL for the exact 10.0.28000.2270 release.
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2370315' -OutFile $installer
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation(?:,|$)') {
            throw 'The downloaded SDK bootstrapper did not verify as Microsoft-signed.'
        }
        $sha = (Get-FileHash -LiteralPath $installer).Hash
        if ($sha -ne 'E9F1BDE566381355E594E2F90DAF4F714EB5C7EF2C45C501CE236AFE2ABEA300') {
            throw 'The signed SDK bootstrapper changed. Reverify the official release before updating its checksum.'
        }
        Write-Output "Microsoft SDK bootstrapper SHA-256: $sha"
        $features = @('OptionId.DesktopCPPx64')
        if (!$report.x64DbgHelpVersion -or [version]$report.x64DbgHelpVersion -lt [version]$report.requiredDebuggerVersion) {
            $features += 'OptionId.WindowsDesktopDebuggers'
        }
        $log = Join-Path $scratch 'sdk-install.log'
        $arguments = @('/quiet', '/norestart', '/ceip', 'off', '/log', ('"' + $log + '"'), '/features') + $features
        $setup = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
        if ($setup.ExitCode -ne 0) {
            if (Test-Path -LiteralPath $log -PathType Leaf) {
                Get-Content -LiteralPath $log -Tail 25
            }
            throw "SDK installation returned $($setup.ExitCode)."
        }
    } finally {
        if (Test-Path -LiteralPath $installer -PathType Leaf) { Remove-Item -LiteralPath $installer }
        if (!(Get-ChildItem -LiteralPath $scratch -Force)) { Remove-Item -LiteralPath $scratch }
    }
}
$report = & (Join-Path $PSScriptRoot 'test-native-windows-host.ps1') -Workspace $Workspace
$report | ConvertTo-Json -Depth 6
if (!$report.storageMeetsMinimum -or !$report.toolchainPresent) {
    throw 'The pinned toolchain or required free disk space did not pass the post-install inventory.'
}

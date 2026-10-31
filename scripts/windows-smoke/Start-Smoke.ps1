#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 10/11 x64 smoke evidence collector for Profile Manager alpha.2.

.DESCRIPTION
  Non-destructive unless -AllowDestructive is set. Never prints passwords,
  tokens, or unredacted profile paths. Does not mark a scenario PASS unless
  that scenario's id is PASS in -ManualResults. An unattended run cannot
  report an overall PASS.

  On a non-Windows host the script writes a BLOCKED summary and exits 2.
#>
[CmdletBinding()]
param(
    [string]$Alpha2Exe,
    [string]$Alpha1Exe,
    [string]$EvidenceRoot,
    [switch]$AllowDestructive,
    [switch]$NonInteractive,
    [string]$ManualResults
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$Expected = @{
    Alpha2Sha256 = '053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4'
    Alpha1Sha256 = '98a6444d744876b7689db5e67e1fc22a121946ebac0003af6c43ad394ecd848d'
    Alpha2Url = 'https://github.com/qadeer-cyber/profile-manager/releases/download/v0.5.0-alpha.2-m1-m9/Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe'
    Alpha1Url = 'https://github.com/qadeer-cyber/profile-manager/releases/download/v0.5.0-alpha.1-m4-m5/Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe'
    SourceCommit = '1e1a957e9f40f9a3e8a8bd02d4a3ddc256914c95'
}

$Scenarios = @(
    @{ Id = '01-fresh-install'; Destructive = $true; Title = 'Fresh install and first launch'; Steps = @(
        'Confirm the alpha.2 SHA-256 before launching the installer.',
        'Install for the current user. Expect an unsigned-file / SmartScreen warning. Do not disable it.',
        'Launch Profile Manager. Confirm the window title and that no second copy of the data folder is created.',
        'Quit from the window. Leave %APPDATA%\profile-manager in place.') },
    @{ Id = '02-upgrade-alpha1-to-alpha2'; Destructive = $true; Title = 'Upgrade alpha.1 to alpha.2 with a database backup'; Steps = @(
        'On a copy of the machine state, install alpha.1 first and create one named profile.',
        'Copy %APPDATA%\profile-manager\data\profiles.db to a backup path you choose. Do not paste that path into chat without redaction.',
        'Install alpha.2 over alpha.1 without uninstalling first.',
        'Launch alpha.2 and confirm the named profile is still listed. Do not delete the backup.') },
    @{ Id = '03-profile-userdata-preservation'; Destructive = $false; Title = 'Profile and Chromium user-data preservation'; Steps = @(
        'Launch one profile, open a page, create a bookmark or local note that is not a password, then quit the browser from Profile Manager.',
        'Quit Profile Manager and start it again. Launch the same profile.',
        'Confirm the bookmark or note is still there. Do not record page contents that contain credentials.') },
    @{ Id = '04-sqlite-migrations-10-11-12'; Destructive = $false; Title = 'SQLite migrations 10, 11, and 12'; Steps = @(
        'If sqlite3.exe is on PATH, the script reads schema_version only.',
        'Confirm versions 10 (extensions), 11 (advanced settings), and 12 (saved views, proxy checks, provider accounts, bulk jobs) are present after alpha.2 has opened the database.',
        'Confirm the profile row from alpha.1 is still present. Do not dump table contents.') },
    @{ Id = '05-chromium-156-launch-terminate'; Destructive = $false; Title = 'Chromium 156 launch and terminate'; Steps = @(
        'Launch a profile. In the browser, open chrome://version and confirm 156.0.8078.4.',
        'Stop the profile from Profile Manager. Confirm no chrome.exe remains for that profile.',
        'Do not record the full command line. It contains the user-data directory.') },
    @{ Id = '06-multiple-profiles'; Destructive = $false; Title = 'Multiple independent profiles'; Steps = @(
        'Create two profiles with different names.',
        'Launch both. Confirm two browser windows and that a cookie or bookmark set in one is absent from the other.',
        'Stop both.') },
    @{ Id = '07-webrtc-policy'; Destructive = $false; Title = 'WebRTC policy behavior'; Steps = @(
        'Set one profile to the product WebRTC policy that disables non-proxied UDP, and leave another on the browser default.',
        'Relaunch each profile so the setting is applied.',
        'Record only the policy name shown in Profile Manager and whether the browser stayed running. Do not claim that this proves zero WebRTC leaks.') },
    @{ Id = '08-proxy-config-auth-connectivity'; Destructive = $false; Title = 'Proxy configuration, authentication, and connectivity'; Steps = @(
        'Use a proxy you are allowed to test. Enter the password only in the product UI.',
        'Save, relaunch, and run the in-app proxy test.',
        'Record status and latency only. Do not copy the password, username, or proxy URL into the evidence file.') },
    @{ Id = '09-extension-load-persist'; Destructive = $false; Title = 'Extension load and persistence'; Steps = @(
        'Add one unpacked extension you trust to the library and assign it to one profile.',
        'Launch, confirm it is listed in chrome://extensions, quit, and launch again.',
        'Confirm it is still assigned. Do not install an extension whose purpose is fingerprint evasion.') },
    @{ Id = '10-dpapi-encrypt-decrypt'; Destructive = $false; Title = 'Windows DPAPI encrypt and decrypt'; Steps = @(
        'On the Diagnostics page, record only the secret-storage backend name (expect electron-safeStorage when DPAPI is available).',
        'Save a proxy password, quit, and relaunch. Confirm the proxy still works without re-entering the password.',
        'Do not copy the password or the secret.key file.') },
    @{ Id = '11-cookie-import-export'; Destructive = $false; Title = 'Cookie import, export, and unsupported_encryption'; Steps = @(
        'With the profile stopped, import one non-secret test cookie and confirm it is listed.',
        'Launch the profile. If Chromium wrote a DPAPI cookie, the product should report unsupported_encryption for that value rather than a wrong plaintext.',
        'Do not import or export session cookies from a real account.') },
    @{ Id = '12-backup-restore'; Destructive = $true; Title = 'Backup and restore, including encrypted backups'; Steps = @(
        'Create an encrypted backup with a passphrase you do not record.',
        'Confirm a restore without the passphrase is rejected.',
        'Restore onto a spare Windows user or a copy of the data directory, not over the only copy of your profiles, and confirm the test profile returns.') },
    @{ Id = '13-dashboard-views-bulk'; Destructive = $false; Title = 'Dashboard, saved views, and bulk operations'; Steps = @(
        'Open Dashboard and confirm profile counts match the Profiles page.',
        'Save a view, leave the page, and return. Confirm the view is still listed.',
        'Run one bulk tag or folder change on the two test profiles. Do not bulk-delete.') },
    @{ Id = '14-restart-crash-uninstall'; Destructive = $true; Title = 'Restart, crash recovery, and uninstall'; Steps = @(
        'Quit Profile Manager from the tray or window and start it again. Confirm profiles remain.',
        'If you exercise a crash, end the application from Task Manager once, start it again, and confirm a stale profile lock does not block launch.',
        'Uninstall. deleteAppDataOnUninstall is false: %APPDATA%\profile-manager\data\profiles.db must remain. Confirm that file still exists. Do not delete it as part of this test.') }
)

function Get-ManualMap {
    param([string]$Path)
    $map = @{}
    if ([string]::IsNullOrWhiteSpace($Path)) { return $map }
    if (-not (Test-Path -LiteralPath $Path)) { throw "ManualResults file not found." }
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $parsed = $raw | ConvertFrom-Json
    foreach ($prop in $parsed.PSObject.Properties) {
        $value = [string]$prop.Value
        if ($value -ne 'PASS' -and $value -ne 'FAIL') {
            throw "Manual result for $($prop.Name) must be PASS or FAIL."
        }
        $map[$prop.Name] = $value
    }
    return $map
}

$evidence = $null
if (-not [string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $evidence = New-EvidenceDirectory -Root $EvidenceRoot
} elseif ($env:OS -eq 'Windows_NT' -and $env:LOCALAPPDATA) {
    $evidence = New-EvidenceDirectory
} else {
    $fallback = Join-Path (Get-Location) 'windows-smoke-evidence'
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    $evidence = (Resolve-Path $fallback).Path
}

$summary = [ordered]@{
    Product = 'Profile Manager'
    Phase = 'alpha.2 Windows smoke'
    Execution = 'BLOCKED'
    Overall = 'BLOCKED'
    Reason = $null
    AllowDestructive = [bool]$AllowDestructive
    SourceCommit = $Expected.SourceCommit
    Host = [ordered]@{ OS = $env:OS; Platform = $null }
    Hashes = @()
    Scenarios = @()
    GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
}

if ($env:OS -ne 'Windows_NT') {
    $summary.Reason = 'This host is not Windows 10/11. The package was not executed. Do not treat this file as a Windows PASS.'
    $summary.Execution = 'BLOCKED'
    $summary.Overall = 'BLOCKED'
    Write-EvidenceText -Path (Join-Path $evidence 'summary.json') -Text ($summary | ConvertTo-Json -Depth 6)
    Write-EvidenceText -Path (Join-Path $evidence 'README.txt') -Text "BLOCKED. Run Start-Smoke.ps1 on Mohammad's Dell Latitude 5480 (Windows 10 x64) or another Windows 10/11 x64 machine. See RUNBOOK.md."
    Write-Host "BLOCKED: Windows smoke was not executed on this host. Evidence: $evidence"
    exit 2
}

$summary.Host.Platform = 'windows'
$summary.Host.Release = Redact-Text ([Environment]::OSVersion.VersionString)
$summary.Host.Is64Bit = [Environment]::Is64BitOperatingSystem
$summary.Execution = 'STARTED'
$summary.Overall = 'INCOMPLETE'

$manual = Get-ManualMap -Path $ManualResults

function Add-HashResult {
    param([string]$Label, [string]$Path, [string]$ExpectedHash)
    $row = [ordered]@{ Label = $Label; Expected = $ExpectedHash; Actual = $null; Result = 'SKIPPED' }
    if ([string]::IsNullOrWhiteSpace($Path)) {
        $row.Result = 'SKIPPED'
        $row.Note = 'path not provided'
    } elseif (-not (Test-Path -LiteralPath $Path)) {
        $row.Result = 'FAIL'
        $row.Note = 'file missing'
    } else {
        $row.Actual = Get-FileSha256 -Path $Path
        if ($row.Actual -eq $ExpectedHash) { $row.Result = 'PASS' } else { $row.Result = 'FAIL' }
        $row.Bytes = (Get-Item -LiteralPath $Path).Length
    }
    $summary.Hashes += $row
}

Add-HashResult -Label 'alpha.2' -Path $Alpha2Exe -ExpectedHash $Expected.Alpha2Sha256
Add-HashResult -Label 'alpha.1' -Path $Alpha1Exe -ExpectedHash $Expected.Alpha1Sha256

$db = Join-Path $env:APPDATA 'profile-manager\data\profiles.db'
$schema = Get-SchemaVersionReadonly -DatabasePath $db
Write-EvidenceText -Path (Join-Path $evidence 'schema-version.txt') -Text (ConvertTo-RedactedJson $schema)

$anyFail = $false
foreach ($scenario in $Scenarios) {
    $row = [ordered]@{
        Id = $scenario.Id
        Title = $scenario.Title
        Destructive = [bool]$scenario.Destructive
        Steps = $scenario.Steps
        Result = 'MANUAL-PENDING'
        Note = ''
    }
    if ($scenario.Destructive -and -not $AllowDestructive) {
        $row.Result = 'SKIPPED-NEEDS-APPROVAL'
        $row.Note = 'Re-run with -AllowDestructive after Mohammad approves this destructive scenario. A manual PASS without that switch is ignored.'
    } elseif ($manual.ContainsKey($scenario.Id)) {
        $row.Result = $manual[$scenario.Id]
        $row.Note = 'Recorded from -ManualResults. The script did not observe the UI itself.'
        if ($row.Result -eq 'FAIL') { $anyFail = $true }
    } else {
        $row.Note = 'A person still has to perform the steps and return a ManualResults JSON entry of PASS or FAIL.'
    }
    if ($scenario.Id -eq '04-sqlite-migrations-10-11-12' -and $schema.Available) {
        $joined = ($schema.Versions -join "`n")
        $has10 = $joined -match '(^|\n)10 '
        $has11 = $joined -match '(^|\n)11 '
        $has12 = $joined -match '(^|\n)12 '
        $row.SchemaRead = @($has10, $has11, $has12) -join ','
        if (-not $manual.ContainsKey($scenario.Id)) {
            if ($has10 -and $has11 -and $has12) {
                $row.Note = 'schema_version contains 10, 11, and 12. Profile preservation still needs the manual check.'
            } else {
                $row.Result = 'FAIL'
                $row.Note = 'schema_version is missing version 10, 11, or 12.'
                $anyFail = $true
            }
        }
    }
    $summary.Scenarios += $row
    Write-EvidenceText -Path (Join-Path $evidence ($scenario.Id + '.txt')) -Text (ConvertTo-RedactedJson $row)
}

$pending = @($summary.Scenarios | Where-Object { $_.Result -eq 'MANUAL-PENDING' -or $_.Result -eq 'SKIPPED-NEEDS-APPROVAL' })
if ($anyFail -or @($summary.Hashes | Where-Object { $_.Result -eq 'FAIL' }).Count -gt 0) {
    $summary.Overall = 'FAIL'
    $summary.Execution = 'EXECUTED-WITH-FAILURES'
} elseif ($pending.Count -eq 0 -and @($summary.Scenarios | Where-Object { $_.Result -ne 'PASS' }).Count -eq 0) {
    $summary.Overall = 'PASS'
    $summary.Execution = 'EXECUTED'
    $summary.Reason = 'Every scenario id was PASS in ManualResults and every destructive scenario was run with -AllowDestructive. This is human evidence, not a lab certificate.'
} else {
    $summary.Overall = 'INCOMPLETE'
    $summary.Execution = 'AWAITING-HUMAN-EVIDENCE'
    $summary.Reason = 'Automated collection finished. Overall PASS is withheld until every scenario has a human PASS and destructive scenarios were explicitly approved.'
}

Write-EvidenceText -Path (Join-Path $evidence 'summary.json') -Text ($summary | ConvertTo-Json -Depth 8)
Write-Host ("Smoke evidence: {0}" -f (Redact-Text $evidence))
Write-Host ("Overall: {0}  Execution: {1}" -f $summary.Overall, $summary.Execution)
if ($summary.Overall -eq 'FAIL') { exit 1 }
if ($summary.Overall -eq 'PASS') { exit 0 }
exit 3

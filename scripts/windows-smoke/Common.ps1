# Shared helpers for the Alpha.2 Windows smoke package.
# PowerShell 5.1. Does not print secrets, tokens, or raw profile paths.

Set-StrictMode -Version 2.0

function Redact-Text {
    param([AllowNull()][string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $out = $Text
    foreach ($name in @($env:USERNAME, $env:USERDOMAIN, $env:COMPUTERNAME)) {
        if (-not [string]::IsNullOrEmpty($name) -and $name.Length -ge 2) {
            $out = $out.Replace($name, '[redacted]')
        }
    }
    if (-not [string]::IsNullOrEmpty($env:USERPROFILE)) {
        $out = $out.Replace($env:USERPROFILE, '%USERPROFILE%')
    }
    if (-not [string]::IsNullOrEmpty($env:LOCALAPPDATA)) {
        $out = $out.Replace($env:LOCALAPPDATA, '%LOCALAPPDATA%')
    }
    if (-not [string]::IsNullOrEmpty($env:APPDATA)) {
        $out = $out.Replace($env:APPDATA, '%APPDATA%')
    }
    $out = [regex]::Replace($out, '(?i)(password|passphrase|secret|authorization|api[_-]?key|x-ui-token|x-api-key|bearer)\s*[:=]\s*\S+', '$1=[redacted]')
    $out = [regex]::Replace($out, '(?i)(token)\s*[:=]\s*[A-Za-z0-9_\-]{8,}', '$1=[redacted]')
    return $out
}

function ConvertTo-RedactedJson {
    param($Value)
    return (Redact-Text ($Value | ConvertTo-Json -Depth 6 -Compress:$false))
}

function New-EvidenceDirectory {
    param([string]$Root)
    if ([string]::IsNullOrWhiteSpace($Root)) {
        $base = Join-Path $env:LOCALAPPDATA 'ProfileManager-Alpha2Smoke'
        $Root = Join-Path $base ((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
    }
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    return (Resolve-Path $Root).Path
}

function Write-EvidenceText {
    param([string]$Path, [string]$Text)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, (Redact-Text $Text))
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hash = $sha.ComputeHash($stream)
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
    return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function Get-SchemaVersionReadonly {
    param([string]$DatabasePath)
    $result = [ordered]@{ Available = $false; Versions = @(); Note = '' }
    if (-not (Test-Path -LiteralPath $DatabasePath)) {
        $result.Note = 'database not present'
        return $result
    }
    $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if (-not $sqlite) {
        $result.Note = 'sqlite3.exe is not on PATH; schema was not read'
        return $result
    }
    $query = 'SELECT version || '' '' || name FROM schema_version ORDER BY version;'
    $raw = & $sqlite.Source -readonly $DatabasePath $query 2>&1
    if ($LASTEXITCODE -ne 0) {
        $result.Note = 'sqlite3 read failed'
        return $result
    }
    $result.Available = $true
    $result.Versions = @($raw | ForEach-Object { Redact-Text ([string]$_) })
    return $result
}

# Run from the repository root on a Windows client with dependencies installed.
$ErrorActionPreference = 'Stop'
function Read-PrivateText([string] $Prompt) {
    $secret = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secret.Dispose()
    }
}
try {
    $service = (Read-Host 'Location lookup: geolite, geoip, or none').Trim().ToLowerInvariant()
    $config = @{
        endpoints = @((Read-Host 'Paste authorized IPv4:port endpoints separated by spaces') -split '\s+' | Where-Object { $_ })
        username = Read-PrivateText 'Shared proxy username'
        password = Read-PrivateText 'Shared proxy password'
        service = $service
    }
    if ($service -in @('geolite', 'geoip')) {
        $config.account = Read-Host 'MaxMind account ID'
        $config.license = Read-PrivateText 'MaxMind license key'
    }
    $config | ConvertTo-Json -Depth 4 -Compress | node scripts/test-proxy-inventory.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Proxy inventory did not complete successfully.' }
} finally { Remove-Variable config -ErrorAction SilentlyContinue }

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
    $config = @{
        account = Read-Host 'MaxMind City account ID'
        license = Read-PrivateText 'MaxMind City license key'
        proxies = @(foreach ($label in @('A', 'B')) {
            @{
                endpoint = Read-PrivateText "Proxy $label URL with scheme, credentials and explicit port"
                ip = Read-Host "Proxy $label independently expected public exit IP"
                timezone = Read-Host "Proxy $label independently expected IANA timezone"
            }
        })
    }
    $config | ConvertTo-Json -Depth 4 -Compress | node scripts/test-stable-regional-proxies.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Regional proxy acceptance failed.' }
} finally { Remove-Variable config -ErrorAction SilentlyContinue }

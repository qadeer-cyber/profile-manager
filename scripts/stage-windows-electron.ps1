$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$electronDir = Join-Path $PWD 'node_modules/electron'
$package = Get-Content (Join-Path $electronDir 'package.json') -Raw | ConvertFrom-Json
$asset = "electron-v$($package.version)-win32-x64.zip"
$checksums = Get-Content (Join-Path $electronDir 'checksums.json') -Raw | ConvertFrom-Json -AsHashtable
$expected = $checksums[$asset]
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Pinned Electron checksum unavailable' }
$zip = Join-Path $env:RUNNER_TEMP $asset
gh release download "v$($package.version)" --repo electron/electron --pattern $asset --output $zip --clobber
if ($LASTEXITCODE -ne 0) {
  curl.exe --fail --location --retry 2 --retry-delay 5 --max-time 120 --output $zip "https://github.com/electron/electron/releases/download/v$($package.version)/$asset"
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Electron download unavailable through both routes' }
}
$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Pinned Electron checksum mismatch' }
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $electronDir 'dist') -Force
if (!(Test-Path -LiteralPath (Join-Path $electronDir 'dist/electron.exe'))) { throw 'Electron archive missing executable' }

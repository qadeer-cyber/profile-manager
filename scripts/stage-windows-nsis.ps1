$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
if (!(Test-Path -LiteralPath $sevenZip -PathType Leaf)) { throw '7-Zip is required' }
function Stage-Tool($tag, $expected) {
  $name = "$tag.7z"
  $archive = Join-Path $env:RUNNER_TEMP $name
  $folder = Join-Path $env:RUNNER_TEMP $tag
  gh release download $tag --repo electron-userland/electron-builder-binaries --pattern $name --output $archive --clobber
  if ($LASTEXITCODE -ne 0) { throw "Pinned $tag download failed" }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw "Pinned $tag checksum mismatch" }
  & $sevenZip x $archive "-o$folder" -y | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Pinned $tag extraction failed" }
  return $folder
}
# Versions and checksums match electron-builder 26.15.3's Windows toolset.
$nsis = Stage-Tool 'nsis-3.0.4.1' '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'
$resources = Stage-Tool 'nsis-resources-3.4.1' '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'
foreach ($item in @((Join-Path $nsis 'Bin/makensis.exe'), (Join-Path $nsis 'elevate.exe'), (Join-Path $resources 'plugins/x86-unicode'))) {
  if (!(Test-Path -LiteralPath $item)) { throw "Pinned NSIS bundle incomplete: $item" }
}
"ELECTRON_BUILDER_NSIS_DIR=$nsis" >> $env:GITHUB_ENV
"ELECTRON_BUILDER_NSIS_RESOURCES_DIR=$resources" >> $env:GITHUB_ENV
"ELECTRON_BUILDER_7ZIP_PATH=$sevenZip" >> $env:GITHUB_ENV

# Cold-launch stress for AZWAH Chromium (Windows). Each iteration starts a fresh node process that runs the real
# launch test once (proxied profile plus a direct profile at once), alternating HTTP and SOCKS5 proxies, with Chromium's
# own log written per iteration. Prints one line per iteration, the output and log tail of every failure, and a summary.
param([int]$Iterations = 16)
$ErrorActionPreference = 'Continue'
$rows = @()
for ($i = 1; $i -le $Iterations; $i++) {
  $protocol = if ($i % 2 -eq 0) { 'socks5' } else { 'http' }
  $log = Join-Path $env:RUNNER_TEMP "stress-$i.chrome.log"
  $out = Join-Path $env:RUNNER_TEMP "stress-$i.out.txt"
  $env:PM_TEST_SOCKS5 = if ($protocol -eq 'socks5') { '1' } else { '0' }
  $env:AZWAH_NATIVE_CYCLES = '1'
  $env:AZWAH_NATIVE_TEST_EXTRA_ARGS = "--enable-logging --v=0 --log-file=$log"
  $started = Get-Date
  node --test --test-force-exit test/azwah-native-windows-live.test.js *> $out
  $code = $LASTEXITCODE
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  $rows += [pscustomobject]@{ iteration = $i; protocol = $protocol; ok = ($code -eq 0); seconds = $seconds }
  Write-Output ("STRESS iteration {0,2} {1,-6} {2} {3}s" -f $i, $protocol, $(if ($code -eq 0) { 'PASS' } else { 'FAIL' }), $seconds)
  if ($code -ne 0) {
    Write-Output "--- output of failed iteration $i"
    Get-Content $out -Tail 50
    Write-Output "--- chromium log of failed iteration $i"
    if (Test-Path $log) { Get-Content $log -Tail 40 } else { Write-Output '(no log written)' }
  }
  Start-Sleep -Seconds 2
}
$failed = @($rows | Where-Object { -not $_.ok })
$byProtocol = $rows | Group-Object protocol | ForEach-Object { "$($_.Name) $(@($_.Group | Where-Object { -not $_.ok }).Count)/$($_.Count) failed" }
Write-Output "STRESS_SUMMARY total=$Iterations failed=$($failed.Count) ($($byProtocol -join '; ')) failedIterations=$(($failed | ForEach-Object { $_.iteration }) -join ',')"
if ($failed.Count -gt 0) { exit 1 }

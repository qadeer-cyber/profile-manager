// Phase 6: honest engine capability states (do not inflate product scorecard).
export function browserEngineCapabilityMatrix() {
  return {
    generatedAt: new Date().toISOString(),
    legend: { IMPLEMENTED: 'working + tested', PARTIAL: 'some paths only', UNSUPPORTED: 'stock CfT limit', BLOCKED: 'needs owner HW or custom build' },
    rows: [
      { id: 'manual_native_launch', title: 'Manual browse without Playwright pipe', state: 'IMPLEMENTED', evidence: 'test/browser-runtime-native-launch.test.js' },
      { id: 'profile_isolation', title: 'Per-profile userDataDir + lock', state: 'IMPLEMENTED', evidence: 'existing M1–M17 tests' },
      { id: 'proxy_socks_auth', title: 'SOCKS5 with auth via local relay', state: 'IMPLEMENTED', evidence: 'native --proxy-server + relay' },
      { id: 'extensions', title: 'Unpacked extensions on command line', state: 'IMPLEMENTED', evidence: 'extensions-launch tests' },
      { id: 'webrtc_policy', title: 'WebRTC IP handling flags', state: 'IMPLEMENTED', evidence: 'webrtc launch tests' },
      { id: 'webgl_restrict', title: 'WebGL disable flag', state: 'IMPLEMENTED', evidence: 'fingerprint-settings' },
      { id: 'canvas_noise', title: 'Canvas fingerprint noise', state: 'UNSUPPORTED', evidence: 'privacy-engine-report' },
      { id: 'webdriver_false', title: 'navigator.webdriver false on manual native', state: 'IMPLEMENTED', note: 'No automation switches on native path' },
      { id: 'regional_locale_cdp', title: 'ICU locale override via CDP', state: 'PARTIAL', note: 'Playwright path only; native uses --lang/--accept-lang' },
      { id: 'tab_restore_native', title: 'Tab restore on native close', state: 'PARTIAL', note: 'Startup URLs open; live tab snapshot needs future native hook' },
      { id: 'advanced_monitoring_pipe', title: 'Advanced Monitoring CDP pipe facts', state: 'PARTIAL', note: 'Requires Playwright-connected session' },
      { id: 'custom_chromium_build', title: 'Dedicated compiled browser binary', state: 'BLOCKED', evidence: 'CHROMIUM-DERIVED-FEASIBILITY.md' },
      { id: 'google_sorry_loop', title: 'Google Search CAPTCHA-free guarantee', state: 'UNSUPPORTED', note: 'Environmental + Google policy; see P1 findings' },
      { id: 'latitude_ipv6', title: 'Owner Latitude direct IPv6 path', state: 'BLOCKED', note: 'Not in GHA windows-2022' },
    ],
  };
}

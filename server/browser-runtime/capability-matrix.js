// Phase 6: honest engine capability states (do not inflate product scorecard).
export function browserEngineCapabilityMatrix() {
  return {
    generatedAt: new Date().toISOString(),
    legend: { IMPLEMENTED: 'working + tested', PARTIAL: 'some paths only', UNSUPPORTED: 'stock CfT limit', BLOCKED: 'needs owner HW or custom build' },
    rows: [
      { id: 'manual_native_launch', title: 'Manual browse without Playwright pipe', state: 'IMPLEMENTED', evidence: 'test/browser-runtime-native-launch.test.js' },
      { id: 'firefox_gecko_runtime', title: 'Firefox second runtime (native spawn)', state: 'PARTIAL', evidence: 'test/firefox-launch-plan.test.js', note: 'Requires host Firefox; extensions N/A' },
      { id: 'profile_config_engine_v2', title: 'Typed profile config + warnings', state: 'IMPLEMENTED', evidence: 'test/profile-config-engine.test.js' },
      { id: 'profile_isolation', title: 'Per-profile userDataDir + lock', state: 'IMPLEMENTED', evidence: 'existing M1–M17 tests' },
      { id: 'proxy_socks_auth', title: 'SOCKS5 with auth via local relay', state: 'IMPLEMENTED', evidence: 'native --proxy-server + relay' },
      { id: 'extensions', title: 'Unpacked extensions on command line', state: 'IMPLEMENTED', evidence: 'extensions-launch tests' },
      { id: 'webrtc_policy', title: 'WebRTC IP handling flags', state: 'IMPLEMENTED', evidence: 'webrtc launch tests' },
      { id: 'webgl_restrict', title: 'WebGL disable flag', state: 'IMPLEMENTED', evidence: 'fingerprint-settings' },
      { id: 'canvas_noise', title: 'Canvas fingerprint noise', state: 'UNSUPPORTED', evidence: 'privacy-engine-report' },
      { id: 'webdriver_false', title: 'navigator.webdriver false on manual native', state: 'IMPLEMENTED', note: 'No automation switches on native path' },
      { id: 'regional_locale_cdp', title: 'ICU locale override via CDP', state: 'PARTIAL', note: 'Playwright path only; native uses --lang/--accept-lang' },
      { id: 'tab_restore_native', title: 'Tab restore on native close', state: 'PARTIAL', evidence: 'test/session-harvest.test.js + resolveNativeTabUrlsForSave on stop/health', note: 'Playwright path still uses ctx pages' },
      { id: 'quick_profiles', title: 'Quick temporary profiles', state: 'IMPLEMENTED', evidence: 'POST /api/profiles/quick' },
      { id: 'trash_bin', title: 'Trash restore / purge', state: 'IMPLEMENTED', evidence: 'test/profile-lifecycle.test.js' },
      { id: 'profile_templates', title: 'Template library + UI', state: 'IMPLEMENTED', evidence: 'TemplatesPage + bulk fromTemplate job + test/profile-lifecycle.test.js' },
      { id: 'advanced_monitoring_pipe', title: 'Advanced Monitoring CDP pipe facts', state: 'PARTIAL', note: 'Requires Playwright-connected session' },
      { id: 'custom_chromium_build', title: 'Dedicated compiled browser binary', state: 'BLOCKED', evidence: 'CHROMIUM-DERIVED-FEASIBILITY.md' },
      { id: 'google_sorry_loop', title: 'Google Search CAPTCHA-free guarantee', state: 'UNSUPPORTED', note: 'Environmental + Google policy; see P1 findings' },
      { id: 'latitude_ipv6', title: 'Owner Latitude direct IPv6 path', state: 'BLOCKED', note: 'Not in GHA windows-2022' },
    ],
  };
}

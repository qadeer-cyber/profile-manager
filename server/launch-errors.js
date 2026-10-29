// Actionable launch failure classification (local desktop; no cloud telemetry).
const CATALOG = Object.freeze({
  CHROMIUM_MISSING: {
    category: 'browser_install',
    action: 'Install Chromium from Settings → Browser, or run the bundled download helper on this machine.',
  },
  CHROMIUM_VERSION_MISMATCH: {
    category: 'browser_install',
    action: 'Clear the custom executable path or reinstall Chromium to the pinned build shown in Diagnostics.',
  },
  TOO_MANY_PROFILES: {
    category: 'resources',
    action: 'Stop a running profile or raise maxRunningProfiles in Settings (Latitude 5480 defaults assume ~8 GiB RAM).',
  },
  LOW_MEMORY: {
    category: 'resources',
    action: 'Close other applications or stop a profile, then retry. Lower minFreeMemoryGiB only if you accept the risk.',
  },
  ALREADY_RUNNING: {
    category: 'concurrency',
    action: 'Stop the profile in this app, or close the other Profile Manager instance that holds the lock.',
  },
  LAUNCH_CANCELLED: {
    category: 'cancelled',
    action: 'Launch was cancelled during startup. Start the profile again when ready.',
  },
  LAUNCH_FAILED: {
    category: 'browser_start',
    action: 'Check Diagnostics for disk space and Chromium path. If the profile directory is damaged, inspect storage cleanup options.',
  },
  WEBRTC_LAUNCH_MISMATCH: {
    category: 'configuration',
    action: 'Save WebRTC settings again and relaunch. Do not edit launch flags manually.',
  },
  FINGERPRINT_LAUNCH_MISMATCH: {
    category: 'configuration',
    action: 'Save fingerprint settings again and relaunch.',
  },
  CORRUPT_DIR: {
    category: 'profile_data',
    action: 'The profile user-data path is not a directory. Remove the blocking file or recreate the profile.',
  },
  INVALID_BROWSER_SETTINGS: {
    category: 'configuration',
    action: 'Fix locale, timezone, or language settings on the profile.',
  },
});

export function classifyLaunchError(error) {
  const code = error?.code || 'LAUNCH_FAILED';
  const meta = CATALOG[code] || CATALOG.LAUNCH_FAILED;
  return {
    code,
    category: meta.category,
    message: error?.message || String(error),
    action: meta.action,
  };
}

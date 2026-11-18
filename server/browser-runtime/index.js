export { buildProfileLaunchPlan, launchRuntimeMode } from './launch-plan.js';
export { launchNativeChromium, nativeArgv, assertNativeLaunchArgs, defaultChromiumExecutable } from './native-chromium.js';
export { browserUpdateManagerReport } from './update-manager.js';
export { automationAdapterReport, AUTOMATION_ADAPTER } from './automation-adapter.js';
export { buildProfileConfigModel } from './profile-config.js';
export { browserEngineCapabilityMatrix } from './capability-matrix.js';

export function browserEngineArchitectureReport() {
  return {
    generatedAt: new Date().toISOString(),
    layers: {
      desktopUi: 'Electron shell + web UI (Profile Manager)',
      profileStorage: 'SQLite + per-profile userDataDir (M1–M17)',
      browserRuntime: {
        manual: 'native-chromium spawn (no Playwright pipe)',
        automationHeadless: 'playwright launchPersistentContext adapter',
      },
      privacyEngine: 'Validated settings → launch args + Preferences (see privacy-engine-report)',
      automationAdapter: 'playwright-persistent-context (on demand)',
      updateManager: 'Verified CDN install + manifest pin (rollback scaffold)',
    },
    manualBrowsingRequiresPlaywright: false,
  };
}

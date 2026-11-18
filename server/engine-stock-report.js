// Honest M2/M3 stock engine facts for Diagnostics (not Mimic/Stealthfox antidetect claims).
import fs from 'fs';
import { chromiumIdentity } from './chromium-identity.js';
import { expectedExecutable, MANIFEST, platformKey } from './chromium.js';
import { resolveFirefoxExecutable } from './browser-runtime/firefox-launch.js';
import { browserEngineArchitectureReport } from './browser-runtime/index.js';
import { browserEngineCapabilityMatrix } from './browser-runtime/capability-matrix.js';
import { getSetting } from './db.js';

export function buildEngineStockReport() {
  const key = platformKey();
  let chromiumPath = null;
  let chromiumInstalled = false;
  try {
    chromiumPath = key ? expectedExecutable('chromium') : null;
    chromiumInstalled = !!(chromiumPath && fs.existsSync(chromiumPath));
  } catch {
    chromiumInstalled = false;
  }
  const chromium = chromiumIdentity();
  const firefoxPath = resolveFirefoxExecutable();
  const firefoxConfigured = String(getSetting('firefoxExecutablePath', '') || process.env.PM_FIREFOX_EXECUTABLE || '').trim();
  const arch = browserEngineArchitectureReport();
  return {
    generatedAt: new Date().toISOString(),
    m2: {
      productLabel: 'Stock Chromium (CfT pin)',
      mimicEquivalent: false,
      installed: chromiumInstalled,
      executablePath: chromiumPath,
      pinnedRevision: MANIFEST.revision,
      browserVersion: chromium.version,
      versionSource: chromium.source,
      manualLaunchRuntime: arch.layers?.browserRuntime?.manual || 'native-chromium spawn',
      automationLaunchRuntime: arch.layers?.browserRuntime?.automationHeadless || 'playwright adapter',
      note: 'No custom Mimic compile. Native manual launch does not open a CDP port unless automation is enabled.',
    },
    m3: {
      productLabel: 'Stock Mozilla Firefox / Gecko',
      stealthfoxEquivalent: false,
      installed: !!firefoxPath,
      executablePath: firefoxPath,
      configuredPath: firefoxConfigured || null,
      prefsSurface: 'user.js managed block (proxy, locale, timezone, WebRTC ICE)',
      note: 'No Stealthfox patches. Chromium extensions and CookieRobot do not apply.',
    },
    architecture: arch,
    capabilityMatrix: browserEngineCapabilityMatrix(),
  };
}

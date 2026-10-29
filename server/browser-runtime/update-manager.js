// Browser update / integrity / rollback — scaffold (uses verified Playwright CDN installs today).
import fs from 'fs';
import { chromiumStatus, MANIFEST, manifestMatchesPlaywright } from '../chromium.js';
import { getSetting } from '../db.js';

export function browserUpdateManagerReport() {
  const status = chromiumStatus();
  const customPath = getSetting('executablePath', '') || '';
  const custom = customPath && fs.existsSync(customPath)
    ? { path: customPath, verified: false, note: 'User-supplied executable; no PM checksum pin' }
    : null;
  return {
    generatedAt: new Date().toISOString(),
    channel: 'playwright-pinned-cft',
    revision: MANIFEST.revision,
    browserVersion: MANIFEST.browserVersion,
    manifestMatchesPlaywright: manifestMatchesPlaywright(),
    installs: status,
    customExecutable: custom,
    rollback: {
      supported: false,
      reason: 'No side-by-side browser slot registry yet; reinstall uses chromium-manifest pin only',
    },
    dedicatedBuild: {
      status: 'NOT_BUILT',
      reason: 'No custom Chromium compile in CI or owner laptop; see docs/handoff/dedicated-browser-engine/CHROMIUM-DERIVED-FEASIBILITY.md',
    },
  };
}

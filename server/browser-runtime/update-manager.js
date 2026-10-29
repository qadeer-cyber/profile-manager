// Browser update / integrity / dual-slot rollback (verified Playwright CfT installs).
import fs from 'fs';
import { chromiumStatus, MANIFEST, manifestMatchesPlaywright } from '../chromium.js';
import { getSetting } from '../db.js';
import {
  interruptedInstallState, listInstallBackups, rollbackLatest, installVerifiedChromiumWithBackup,
} from '../chromium-lifecycle.js';

const BROWSER_NAMES = ['chromium', 'chromium-headless-shell'];

export function browserInstallSlots() {
  return BROWSER_NAMES.map(name => ({
    name,
    active: interruptedInstallState(name),
    backups: listInstallBackups(name),
    standby: listInstallBackups(name)[0] || null,
  }));
}

export async function upgradeVerifiedBrowsers(opts = {}) {
  return installVerifiedChromiumWithBackup(opts);
}

export function rollbackBrowserSlot(name) {
  const slot = name === 'chromium-headless-shell' ? 'chromium-headless-shell' : 'chromium';
  return { name: slot, restored: rollbackLatest(slot) };
}

export function browserUpdateManagerReport() {
  const status = chromiumStatus();
  const customPath = getSetting('executablePath', '') || '';
  const custom = customPath && fs.existsSync(customPath)
    ? { path: customPath, verified: false, note: 'User-supplied executable; no PM checksum pin' }
    : null;
  const slots = browserInstallSlots();
  const rollbackReady = slots.some(s => s.backups.length > 0);
  return {
    generatedAt: new Date().toISOString(),
    channel: 'playwright-pinned-cft',
    revision: MANIFEST.revision,
    browserVersion: MANIFEST.browserVersion,
    manifestMatchesPlaywright: manifestMatchesPlaywright(),
    installs: status,
    slots,
    customExecutable: custom,
    rollback: {
      supported: true,
      available: rollbackReady,
      mechanism: 'Before reinstall, the active tree is renamed to <installDir>.pm-backup-<timestamp> (side-by-side standby slot).',
      endpoints: {
        report: 'GET /api/browser-engine/update-manager',
        backups: 'GET /api/browser/backups',
        rollback: 'POST /api/browser/rollback { name: chromium | chromium-headless-shell }',
        install: 'POST /api/browser/install (uses installVerifiedChromiumWithBackup)',
      },
    },
    dedicatedBuild: {
      status: 'NOT_BUILT',
      reason: 'No custom Chromium compile in CI or owner laptop; see docs/handoff/dedicated-browser-engine/CHROMIUM-DERIVED-FEASIBILITY.md',
    },
  };
}

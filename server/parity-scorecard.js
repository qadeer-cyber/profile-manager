// Evidence-backed local product parity (not Multilogin SaaS scope).
export const SCORECARD = Object.freeze([
  { id: 'profiles', area: 'Profile management', status: 'VERIFIED', evidence: 'test/m7-browser.test.js, SQLite profiles CRUD' },
  { id: 'proxy', area: 'Proxy library + SOCKS auth relay', status: 'VERIFIED', evidence: 'test/proxy-library.e2e.js, encrypted creds' },
  { id: 'browser_config', area: 'Browser regional + advanced settings', status: 'VERIFIED', evidence: 'test/m3, test/m6 launch tests' },
  { id: 'fingerprint_controls', area: 'Fingerprint privacy controls (stock)', status: 'PARTIAL', evidence: 'FINGERPRINT_PARITY_MATRIX.md — mask/noise rows custom Chromium' },
  { id: 'fingerprint_diagnostics', area: 'Fingerprint diagnostics + consistency', status: 'VERIFIED', evidence: 'test/fingerprint-browser.test.js, test/fingerprint-gaps-browser.test.js' },
  { id: 'cookies', area: 'Cookies + local storage', status: 'VERIFIED', evidence: 'test/m7-browser.test.js isolation' },
  { id: 'extensions', area: 'Extensions per profile', status: 'VERIFIED', evidence: 'test/m4 extensions launch' },
  { id: 'backup', area: 'Backup/restore + encryption', status: 'VERIFIED', evidence: 'test/backup*.test.js' },
  { id: 'bulk', area: 'Bulk ops + jobs', status: 'VERIFIED', evidence: 'test/bulk-jobs.test.js' },
  { id: 'automation_api', area: 'Automation API /api/v1', status: 'VERIFIED', evidence: 'test/api.e2e.js' },
  { id: 'performance', area: 'Launch metrics + queue + resources', status: 'VERIFIED', evidence: 'test/m12, test/m13 benchmark' },
  { id: 'windows_stability', area: 'Windows process monitoring + smoke runner', status: 'BLOCKED', evidence: 'Run-M13-Latitude5480.ps1 — not executed on Linux agent' },
  { id: 'desktop_ui', area: 'Premium desktop UI + Advanced Monitoring', status: 'VERIFIED', evidence: 'web build; MonitoringPage separate from Dashboard' },
  { id: 'webrtc_ice', area: 'WebRTC policy + ICE diagnostics', status: 'VERIFIED', evidence: 'test/webrtc-observe.test.js, fingerprint-gaps-browser' },
  { id: 'geolocation_modes', area: 'Geolocation Allow/Ask/Deny', status: 'VERIFIED', evidence: 'test/fingerprint-gaps-browser.test.js' },
  { id: 'chromium_lifecycle', area: 'Chromium install backup/rollback', status: 'VERIFIED', evidence: 'test/chromium-lifecycle.test.js' },
  { id: 'crash_recovery', area: 'Crash/orphan recovery + locks', status: 'PARTIAL', evidence: 'test/m17-crash-recovery.test.js; Windows crash matrix BLOCKED' },
  { id: 'multilogin_mask_parity', area: 'Multilogin-style masked fingerprints', status: 'UNSUPPORTED', evidence: 'Requires custom Chromium — privacy-engine-report.js' },
]);

const WEIGHT = Object.freeze({
  VERIFIED: 1,
  PARTIAL: 0.5,
  UNSUPPORTED: 0,
  BLOCKED: 0,
  MISSING: 0,
});

export function computeParityCoverage(items = SCORECARD) {
  const rows = items.map(item => ({ ...item, credit: WEIGHT[item.status] ?? 0 }));
  const total = rows.length;
  const earned = rows.reduce((sum, row) => sum + row.credit, 0);
  const percent = total ? Math.round((earned / total) * 1000) / 10 : 0;
  return {
    formula: 'sum(credit)/count × 100 where VERIFIED=1, PARTIAL=0.5, UNSUPPORTED|BLOCKED|MISSING=0',
    totalItems: total,
    earnedCredits: earned,
    localProductParityPercent: percent,
    rows,
    multiloginControlParityNote: 'Multilogin masked/noise fingerprint controls are UNSUPPORTED on stock Chromium; local-product score excludes SaaS/cloud features by design.',
  };
}

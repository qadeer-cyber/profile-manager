#!/usr/bin/env node
// Scaffold for owner-run Latitude / low-memory profiling. Does not invent hardware scores.
// Usage:
//   PM_API_TOKEN=… node scripts/latitude-resource-benchmark.mjs [--base http://127.0.0.1:PORT]
// Or offline: node scripts/latitude-resource-benchmark.mjs --print-template
import os from 'os';

const args = process.argv.slice(2);
const printOnly = args.includes('--print-template');
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : process.env.PM_BENCHMARK_BASE || '';

const template = {
  purpose: 'Record real launch and memory samples on owner hardware (e.g. Latitude 5480 / 8 GiB).',
  notIncluded: 'No synthetic HD620 GPU scores or Multilogin parity percentages.',
  suggestedSteps: [
    'Set PM_DATA_DIR to a disposable folder.',
    'Start Profile Manager; PUT /api/settings with minFreeMemoryGiB and maxRunningProfiles you intend to ship.',
    'Use POST /api/v1/profiles/:id/launch with automation:true headless:true twice; read launchMetrics from GET /api/v1/monitoring.',
    'Log cold_ms, warm_ms, totalBrowserMemoryMiB from GET /api/resources.',
    'Paste results into docs/handoff/multilogin-platform/LATITUDE_RESOURCE_GUARDS.md under owner evidence.',
  ],
  hostSnapshot: {
    platform: process.platform,
    arch: process.arch,
    logicalCores: os.cpus().length,
    totalMemoryGiB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    note: 'This agent VM is not Latitude hardware; do not treat these numbers as product targets.',
  },
};

if (printOnly || !base) {
  console.log(JSON.stringify(template, null, 2));
  if (!base) {
    console.error('\nPass --base http://127.0.0.1:<port> with PM_API_TOKEN set to pull live /api/resources and /api/dashboard snapshots.');
    process.exit(printOnly ? 0 : 1);
  }
}

const token = process.env.PM_API_TOKEN || process.env.PM_UI_TOKEN;
if (!token) {
  console.error('PM_API_TOKEN or PM_UI_TOKEN is required for live snapshot mode.');
  process.exit(1);
}
const headers = token.length > 20 && !token.includes(' ')
  ? { Authorization: `Bearer ${token}` }
  : { 'X-UI-Token': token };

async function get(path) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

const live = {
  capturedAt: new Date().toISOString(),
  base,
  template,
  dashboard: await get('/api/dashboard'),
  resources: await get('/api/resources'),
};
console.log(JSON.stringify(live, null, 2));

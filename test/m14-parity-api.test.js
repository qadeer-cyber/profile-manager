import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';
import { computeParityCoverage } from '../server/parity-scorecard.js';
import { privacyEngineReport } from '../server/privacy-engine-report.js';

test('parity scorecard computes evidence-backed percentage', () => {
  const report = computeParityCoverage();
  assert.ok(report.localProductParityPercent >= 0 && report.localProductParityPercent <= 100);
  assert.match(report.formula, /VERIFIED=1/);
  assert.ok(report.rows.some(row => row.id === 'fingerprint_controls' && row.status === 'PARTIAL'));
});

test('privacy engine report lists controls vs diagnostics per category', () => {
  const report = privacyEngineReport({ platform: 'linux' });
  assert.equal(report.categories.length, 9);
  assert.ok(report.categories.every(cat => Array.isArray(cat.controls) && Array.isArray(cat.diagnostics)));
  assert.match(report.feasibility.recommendation, /stock Chromium/);
});

test('API exposes parity and privacy engine reports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m14-api-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm14' });
  const auth = { Authorization: 'Bearer m14' };
  try {
    const parity = await fetch(proc.url + '/api/parity-scorecard', { headers: auth }).then(r => r.json());
    const privacy = await fetch(proc.url + '/api/privacy-engine', { headers: auth }).then(r => r.json());
    assert.ok(parity.localProductParityPercent >= 0);
    assert.equal(privacy.categories.length, 9);
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

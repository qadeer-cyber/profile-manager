/**
 * The Windows smoke package must exist and must refuse to report PASS on its own.
 * This test does not execute the package on Windows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/windows-smoke');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');

const SCENARIOS = [
  '01-fresh-install',
  '02-upgrade-alpha1-to-alpha2',
  '03-profile-userdata-preservation',
  '04-sqlite-migrations-10-11-12',
  '05-chromium-156-launch-terminate',
  '06-multiple-profiles',
  '07-webrtc-policy',
  '08-proxy-config-auth-connectivity',
  '09-extension-load-persist',
  '10-dpapi-encrypt-decrypt',
  '11-cookie-import-export',
  '12-backup-restore',
  '13-dashboard-views-bulk',
  '14-restart-crash-uninstall',
];

test('Windows smoke package lists every scenario and blocks an unattended PASS', () => {
  const runner = read('Start-Smoke.ps1');
  const common = read('Common.ps1');
  const runbook = read('RUNBOOK.md');
  for (const id of SCENARIOS) assert.match(runner, new RegExp(id), id);
  assert.match(runner, /Windows_NT/);
  assert.match(runner, /BLOCKED/);
  assert.match(runner, /AllowDestructive/);
  assert.match(runner, /ManualResults/);
  assert.match(common, /function Redact-Text/);
  assert.match(common, /\[redacted\]/);
  assert.equal(/Write-Host[^\n]*\$?(password|passphrase|secret|token)/i.test(runner + common), false);
  assert.match(runbook, /053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4/);
  assert.match(runbook, /98a6444d744876b7689db5e67e1fc22a121946ebac0003af6c43ad394ecd848d/);
  assert.match(runbook, /v0\.5\.0-alpha\.2-m1-m9/);
  assert.match(runbook, /v0\.5\.0-alpha\.1-m4-m5/);
  assert.match(runbook, /BLOCKED/);
  assert.match(runbook, /1e1a957e9f40f9a3e8a8bd02d4a3ddc256914c95/);
});

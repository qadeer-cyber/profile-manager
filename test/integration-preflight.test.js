import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { spawnServer, stopServer } from './_ports.mjs';
const candidate = process.env.PM_CANDIDATE_CLI;
test('side-by-side Grok CLI contract probe reports actual reconciliation blockers', { skip: !candidate && 'Provide PM_CANDIDATE_CLI pointing to the reviewed feature checkout', timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-integration-contract-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'disposable-integration-token' }; delete env.PM_SECRET; delete env.PM_UI_TOKEN;
  const proc = await spawnServer(env);
  t.after(async () => { assert.equal(await stopServer(proc), true); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const result = spawnSync(process.execPath, ['scripts/integration-preflight.mjs', '--candidate-cli', candidate], { env: { ...env, PM_API_BASE: proc.url + '/api/v1', PM_INTEGRATION_DISPOSABLE: '1' }, encoding: 'utf8', timeout: 20000 });
  assert.ok([0, 3].includes(result.status), result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sourceIntegrated, false);
  assert.ok(report.checks.find(c => c.gate === 'CLI create → Codex API').passed);
  assert.ok(report.checks.find(c => c.gate === 'CLI configure → Codex API').passed);
  fs.writeFileSync(process.env.PM_INTEGRATION_REPORT || path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  // A passing probe test means the report is valid, not that integration gates passed.
  assert.equal(result.status === 3, report.blocked > 0);
});

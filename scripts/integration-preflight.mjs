#!/usr/bin/env node
// Side-by-side contract probe: executes the candidate CLI against a DISPOSABLE backend.
// Does not merge files, create branches, or change feature source.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const args = process.argv.slice(2), index = args.indexOf('--candidate-cli');
const cli = index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : null;
const base = process.env.PM_API_BASE;
if (!cli || !base || process.env.PM_INTEGRATION_DISPOSABLE !== '1') {
  console.error('Use --candidate-cli /absolute/pm-cli.mjs with PM_API_BASE, PM_API_TOKEN and PM_INTEGRATION_DISPOSABLE=1 for an isolated temporary backend.'); process.exit(2);
}
const url = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) { console.error('Preflight accepts loopback fixture backends only'); process.exit(2); }
const checks = [];
function invoke(command, parameters = [], json = true) {
  const r = spawnSync(process.execPath, [cli, ...(json ? ['--json'] : []), command, ...parameters], { env: process.env, timeout: 15000 });
  let body;
  if (json) { try { body = JSON.parse(r.stdout.toString()); } catch {} }
  return { status: r.status, body, bytes: r.stdout };
}
const profile = invoke('create', [JSON.stringify({ name: 'Disposable integration contract fixture', automationEnabled: false })]);
checks.push({ gate: 'CLI create → Codex API', passed: profile.status === 0 && !!profile.body?.id });
if (profile.body?.id) {
  const id = profile.body.id;
  const updated = invoke('update', [id, JSON.stringify({ notes: 'contract update', browserSettings: { locale: 'en-US', languages: ['en-US'], timezoneId: 'UTC' } })]);
  checks.push({ gate: 'CLI configure → Codex API', passed: updated.status === 0 });
  const exported = invoke('backup-export', [id], false);
  checks.push({ gate: 'CLI encrypted portable export contract', passed: exported.status === 0 && exported.bytes.subarray(0, 4).toString() === 'PMBE', exitCode: exported.status,
    reconciliation: 'CLI must send confirmSensitive:true and a passphrase through a protected prompt/environment/input source; new streaming endpoint is available. Never place passphrases in argv or query strings.' });
  exported.bytes.fill(0);
}
const workspace = invoke('workspace-create', [JSON.stringify({ name: 'Disposable integration workspace' })]);
checks.push({ gate: 'CLI workspace create → Codex API', passed: workspace.status === 0 && !!workspace.body?.id });
if (workspace.body?.id) {
  const exported = invoke('workspace-export', [workspace.body.id]);
  const imported = invoke('workspace-import', [JSON.stringify(exported.body)]);
  checks.push({ gate: 'CLI workspace import route', passed: imported.status === 0, exitCode: imported.status, reconciliation: 'Grok import/bulk routes are absent on the isolated Codex backend until owner-approved source reconciliation.' });
}
const failed = checks.filter(c => !c.passed).length;
console.log(JSON.stringify({ disposableFixture: true, sourceIntegrated: false, candidateCli: cli, checks, blocked: failed }, null, 2));
process.exitCode = failed ? 3 : 0;

// Record every suite, retain failing assertions, and fail the job on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), output = path.join(root, '.m2/evidence');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, PM_DIAG_REPOSITORY: root,
  PM_DIAG_CONTRACT: path.join(root, 'docs/handoff/m2/contracts/DiagnosticsV1.original.md'),
  PM_DIAG_AMENDED_CONTRACT: path.join(root, 'docs/handoff/m2/contracts/DiagnosticsV1.process-command-line.md'),
  PM_DIAG_UI_PATCH: path.join(output, 'ui-source.patch'), PM_DIAG_REQUIRE_LIVE: '1', OUT_DIR: output,
};
const uiPatch = spawnSync('git', ['-C', '.m2/ui', 'diff', 'd7a000eeadd4f4645a608a1e0cc2b8ad154a75d9', 'HEAD', '--', 'web'], { encoding: 'utf8' });
if (uiPatch.status !== 0) throw new Error('Cannot obtain UI evidence');
fs.writeFileSync(env.PM_DIAG_UI_PATCH, uiPatch.stdout);
const test = (...files) => ['--test', '--test-reporter=spec', ...files];
const jobs = [
  ['build', ['node_modules/vite/bin/vite.js', 'build', 'web']],
  ['qa-contract', test('test/diagnostics-contract.test.js')],
  ['qa-security', test('test/diagnostics-security.test.js')],
  ['qa-e2e', test('test/diagnostics.e2e.js')],
  ['qa-recovery', test('test/diagnostics-recovery.test.js')],
  ['qa-live', test('test/diagnostics-live.test.js')],
  ['unit', ['--experimental-test-module-mocks', ...test('test/unit.test.js', 'test/app-security.test.js', 'test/shutdown-ack.test.js', 'test/shutdown-durable.test.js', 'test/testflags.test.js', 'test/ui-status.test.js', 'test/offline-smoke-phase.test.js', 'test/diagnostics-unit.test.js', 'test/diagnostic-process.test.js')]],
  ['desktop-unit', test('test/desktop-unit.test.js')],
  ['desktop-engine', ['test/desktop-engine.e2e.js']],
  ['api', ['scripts/run-with-automation.mjs', 'test/api.e2e.js']],
  ['engine', ['scripts/run-with-automation.mjs', 'test/engine.e2e.js']],
  ['lifecycle', ['scripts/run-with-automation.mjs', 'test/lifecycle.e2e.js']],
  ['proxies', ['scripts/run-with-automation.mjs', 'test/proxy-library.e2e.js']],
  ['security', ['test/security.e2e.js']],
  ['security-migration', ['test/security-migration.e2e.js']],
  ['ui-client', test('web/e2e/diagnostics-client.test.mjs')],
  ['ui-diagnostics', ['web/e2e/diagnostics-ui.mjs']],
  ['ui-smoke', ['test/ui-smoke.run.js']],
];
const results = [];
// Browser launch failures may include an OS command line: remove that line before
// retaining evidence. Never retain GitHub tokens or raw browser command lines.
const sanitize = text => text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').map(line =>
  /<launching>|(?:chrome|chromium)(?:\.exe)?["']?\s+--|spawnargs\s*[:=]/i.test(line) ? '[browser command line redacted]' : line
).join('\n').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[credential redacted]');
for (const [name, args] of jobs) {
  const started = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  const log = sanitize((r.stdout || '') + (r.stderr || ''));
  fs.writeFileSync(path.join(output, name + '.log'), log);
  const counts = log.split('\n').filter(line => /^(?:ℹ (?:tests|pass|fail|skipped|todo|cancelled)\b|\d+ passed, \d+ failed)/.test(line));
  const row = { name, exit: r.status, signal: r.signal, error: r.error?.code ?? null, durationMs: Date.now() - started, counts };
  results.push(row); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(row));
  if (r.status !== 0) console.log(log.slice(-7000));
}
process.exitCode = results.some(row => row.exit !== 0) ? 1 : 0;

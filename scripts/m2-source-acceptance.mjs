// M2+M3 source acceptance runner (no installers). Runs against the checked-out
// integrated tree as-is: never assembles or overwrites files from other commits.
// Strict: a suite fails the job on non-zero exit, any fail/cancelled, a missing
// test file, or missing counts. skip/todo are recorded verbatim, never as pass.
// Required-live suites also fail when a test is skipped (TAP summary or `ok # SKIP`).
// Node exits 0 for an all-skip file, so the exit code alone is not a pass.
// The one exception is the documented Linux-only socket check (Windows half is a
// release-gate item, not a source-live requirement).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), output = path.join(root, '.m2/evidence');
fs.mkdirSync(output, { recursive: true });
const BASELINE = 'd7a000eeadd4f4645a608a1e0cc2b8ad154a75d9';
const INSTALLER_WORKFLOW = '.github/workflows/windows-native-validation.yml';
const INSTALLER_WORKFLOW_BLOB = process.env.PM_INSTALLER_WORKFLOW_BLOB; // pinned in the workflow
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const preflight = [];
const gate = (name, ok, detail) => { preflight.push({ name, ok, detail }); };
gate('full history: M1 baseline is a real tree', git('cat-file', '-t', BASELINE).stdout.trim() === 'commit', git('cat-file', '-t', BASELINE).stderr.trim());
gate('M1 baseline is an ancestor of HEAD', git('merge-base', '--is-ancestor', BASELINE, 'HEAD').status === 0, '');
const blob = git('rev-parse', `HEAD:${INSTALLER_WORKFLOW}`).stdout.trim();
gate('installer workflow byte-identical to main', !!INSTALLER_WORKFLOW_BLOB && blob === INSTALLER_WORKFLOW_BLOB, `HEAD blob ${blob}`);
gate('no assemble overlay (worktree clean before tests)', git('status', '--porcelain', '--untracked-files=no').stdout.trim() === '', '');
const uiPatch = git('diff', BASELINE, 'HEAD', '--', 'web');
gate('UI evidence patch', uiPatch.status === 0, uiPatch.stderr.trim());
fs.writeFileSync(path.join(output, 'ui-source.patch'), uiPatch.stdout || '');
const env = { ...process.env, PM_DIAG_REPOSITORY: root,
  PM_DIAG_CONTRACT: path.join(root, 'docs/handoff/m2/contracts/DiagnosticsV1.original.md'),
  PM_DIAG_AMENDED_CONTRACT: path.join(root, 'docs/handoff/m2/contracts/DiagnosticsV1.process-command-line.md'),
  PM_DIAG_UI_PATCH: path.join(output, 'ui-source.patch'), PM_DIAG_REQUIRE_LIVE: '1', OUT_DIR: output,
};
const t = (...files) => ['--test', '--test-reporter=tap', ...files];
const tm = (...files) => ['--experimental-test-module-mocks', ...t(...files)];
// [name, node args, required-live (skip counts as failure)]
const jobs = [
  ['build', ['node_modules/vite/bin/vite.js', 'build', 'web'], false],
  ['m1-unit', tm('test/unit.test.js', 'test/app-security.test.js', 'test/shutdown-ack.test.js', 'test/shutdown-durable.test.js', 'test/testflags.test.js', 'test/ui-status.test.js', 'test/offline-smoke-phase.test.js', 'test/diagnostics-unit.test.js', 'test/diagnostic-process.test.js'), false],
  ['m1-api', ['scripts/run-with-automation.mjs', 'test/api.e2e.js'], false],
  ['m1-engine', ['scripts/run-with-automation.mjs', 'test/engine.e2e.js'], false],
  ['m1-lifecycle', ['scripts/run-with-automation.mjs', 'test/lifecycle.e2e.js'], false],
  ['m1-proxies', ['scripts/run-with-automation.mjs', 'test/proxy-library.e2e.js'], false],
  ['m1-security', ['test/security.e2e.js'], false],
  ['m1-security-migration', ['test/security-migration.e2e.js'], false],
  ['m2-contract', t('test/diagnostics-contract.test.js'), false],
  ['m2-security', t('test/diagnostics-security.test.js'), false],
  ['m2-e2e', t('test/diagnostics.e2e.js'), false],
  ['m2-recovery', t('test/diagnostics-recovery.test.js'), true],
  ['m2-live', t('test/diagnostics-live.test.js'), true],
  ['m2-gate', t('test/diagnostics-gate.live.test.js'), true],
  ['m3-unit', tm('test/browser-settings.test.js', 'test/browser-settings-api.test.js', 'test/browser-settings-launch.test.js', 'test/regional-locale-adapter.test.js'), false],
  ['m3-browser', t('test/browser-settings-browser.test.js', 'test/regional-locale-browser.test.js'), true],
  ['b1-fault', t('test/regional-locale-diagnostic-failure.test.js', 'test/regional-locale-diagnostic-negative.test.js', 'test/regional-locale-diagnostic-closefail.test.js'), true],
  ['ui-client', t('web/e2e/diagnostics-client.test.mjs'), false],
  ['ui-diagnostics', ['web/e2e/diagnostics-ui.mjs'], false],
  ['ui-smoke', ['test/ui-smoke.run.js'], false],
];
const sanitize = text => text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').map(line =>
  /<launching>|(?:chrome|chromium)(?:\.exe)?["']?\s+--|spawnargs\s*[:=]/i.test(line) ? '[browser command line redacted]' : line
).join('\n').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[credential redacted]');
const count = (log, k) => { const m = [...log.matchAll(new RegExp(`^# ${k} (\\d+)$`, 'gm'))]; return m.length ? m.reduce((a, x) => a + Number(x[1]), 0) : null; };
const countLast = (log, k) => { const m = [...log.matchAll(new RegExp(`^# ${k} (\\d+)$`, 'gm'))]; return m.length ? Number(m.at(-1)[1]) : null; };
// Exact reason from diagnostics-gate.live.test.js §10. Not a required live result on Windows.
const RELEASE_ONLY_SKIP = 'Linux-only process evidence; Windows equivalent is a release-gate item';
const skipDirectives = log => [...log.matchAll(/^ok \d+ .* # SKIP(?: (.*))?$/gm)].map(m => (m[1] || '').trim());
const results = [];
for (const [name, args, requiredLive] of jobs) {
  const files = args.filter(a => /\.(m?js)$/.test(a) && !a.startsWith('--'));
  const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
  const started = Date.now();
  let r = { status: null, signal: null, stdout: '', stderr: '' };
  if (!missing.length) r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const log = sanitize((r.stdout || '') + (r.stderr || ''));
  fs.writeFileSync(path.join(output, name + '.log'), log);
  const isTap = args.includes('--test-reporter=tap');
  const c = isTap ? { tests: count(log, 'tests'), pass: count(log, 'pass'), fail: count(log, 'fail'), cancelled: count(log, 'cancelled'), skipped: count(log, 'skipped'), todo: count(log, 'todo') } : null;
  const problems = [];
  if (missing.length) problems.push('missing test file(s): ' + missing.join(', '));
  if (r.status !== 0) problems.push(`exit ${r.status}${r.signal ? ' signal ' + r.signal : ''}${r.error ? ' ' + r.error.code : ''}`);
  if (c) {
    if (c.tests == null) problems.push('no TAP summary');
    if (c.fail) problems.push(`${c.fail} failed`);
    if (c.cancelled) problems.push(`${c.cancelled} cancelled`);
    if (requiredLive) {
      const directives = skipDirectives(log);
      const allowed = directives.filter(reason => reason === RELEASE_ONLY_SKIP).length;
      const skippedSummaries = [...log.matchAll(/^# skipped (\d+)$/gm)].map(m => Number(m[1]));
      const summarySkipped = skippedSummaries.length ? skippedSummaries.at(-1) : null;
      // Max, not sum: a repeated summary must not double-count, and a later `# skipped 0`
      // must not hide an earlier skip. A `# SKIP` directive counts even if the summary says 0.
      const observed = Math.max(0, ...skippedSummaries, directives.length);
      if (summarySkipped == null) problems.push('required-live suite has no TAP skip count');
      if (c.tests === 0) problems.push('required-live suite ran 0 tests');
      const unexplained = observed - allowed;
      if (unexplained > 0) problems.push(`${unexplained} skipped in a required-live suite`);
      if (allowed > observed) problems.push('release-only skip was not in the TAP skip count');
    }
  }
  const row = { name, ok: problems.length === 0, problems, counts: c, durationMs: Date.now() - started };
  results.push(row);
  console.log(JSON.stringify(row));
  if (!row.ok) console.log(log.slice(-7000));
}
const totals = results.reduce((a, r) => { for (const k of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) a[k] += r.counts?.[k] ?? 0; return a; }, { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
const summary = { platform: process.platform, node: process.version, head: git('rev-parse', 'HEAD').stdout.trim(), preflight, results, totals, ok: preflight.every(p => p.ok) && results.every(r => r.ok) };
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## M2+M3 source acceptance — ' + process.platform, '', `HEAD \`${summary.head}\` · Node ${process.version} · **${summary.ok ? 'PASS' : 'FAIL'}**`, '',
    '| preflight | ok | detail |', '|---|---|---|', ...preflight.map(p => `| ${p.name} | ${p.ok ? '✅' : '❌'} | ${p.detail || ''} |`), '',
    '| suite | ok | tests | pass | fail | cancelled | skipped | todo | problems |', '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...results.map(r => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.counts?.tests ?? '-'} | ${r.counts?.pass ?? '-'} | ${r.counts?.fail ?? '-'} | ${r.counts?.cancelled ?? '-'} | ${r.counts?.skipped ?? '-'} | ${r.counts?.todo ?? '-'} | ${r.problems.join('; ')} |`),
    '', `Totals: ${JSON.stringify(totals)}`, '', 'Skips and todos are reported, never counted as passes. Linux results do not qualify Windows.'];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
console.log(JSON.stringify({ preflight, totals, ok: summary.ok }));
process.exitCode = summary.ok ? 0 : 1;

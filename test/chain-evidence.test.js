// Honest progress evidence for the Chromium chain. Real fixtures are sanitized excerpts of the GitHub job logs
// named in each file name (scripts/chain-evidence.mjs --extract). Synthetic fixtures are labelled as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessStage, extractEvidence } from '../scripts/chain-evidence.mjs';

const real = name => fs.readFileSync(new URL(`./fixtures/chain/${name}.log`, import.meta.url), 'utf8');

test('real: run 44706934362 stage 1 - every compile was non-cacheable (Clang modules), nothing kept', () => {
  const r = assessStage(real('run44706934362-stage1-modules'), { firstStage: true });
  assert.equal(r.evidence.stats.requests, 23303);
  assert.equal(r.evidence.stats.nonCacheable, 23303);
  assert.equal(r.evidence.stats.reasons['-fmodules-cache-path'], 23302);
  assert.equal(r.fresh_work_proven, false);
  assert.equal(r.forward_progress_proven, false);
  assert.match(r.run_blocker.line, /^##\[error\]Process completed with exit code 1/);
  assert.ok(r.cannot_assess.some(x => /cache size/.test(x)));
});

test('real: run 44749921438 stage 1 - new work compiled but never handed over (evidence step failed)', () => {
  const r = assessStage(real('run44749921438-stage1-diagnostics-failed'), { firstStage: true });
  assert.deepEqual(r.evidence.preflight, { requests: 1999, stored: 1780, hits: 219, uncacheable: 0 });
  assert.equal(r.newCompiles, 14508);
  assert.equal(r.cacheWriteErrors, 1, 'the write error is reported, not hidden');
  assert.equal(r.fresh_work_proven, true);
  assert.equal(r.cache_handover_proven, false);
  assert.equal(r.forward_progress_proven, false, 'work that was not handed on is not progress');
  assert.match(r.run_blocker.step, /chain-diagnostics/);
});

test('real: run 44798415536 stage 1 - fresh work and a hand-over with its digest', () => {
  const r = assessStage(real('run44798415536-stage1-handover'), { firstStage: true });
  assert.equal(r.newCompiles, 14076);
  assert.equal(r.evidence.cacheBytes, 339979000);
  assert.deepEqual(r.evidence.handover, { bytes: 343182422, artifactId: '14680752122', sha256: '71adf8ac59bd977d7966626ea15ea83163b2bdfdbae619601569b252ff954fab' });
  assert.equal(r.forward_progress_proven, true);
  assert.equal(r.run_blocker, null);
});

test('real: run 44798415536 stage 2 - 11,115 replayed hits, 0 misses and a path error is NOT forward progress', () => {
  const r = assessStage(real('run44798415536-stage2-path260'));
  assert.equal(r.evidence.stats.hits, 11115);
  assert.equal(r.evidence.stats.misses, 0);
  assert.equal(r.evidence.restore.downloadedSha256, r.evidence.restore.expectedSha256);
  assert.equal(r.cache_reuse_proven, true);
  assert.equal(r.fresh_work_proven, false);
  assert.equal(r.forward_progress_proven, false);
  assert.match(r.run_blocker.line, /^FAILED: obj\/third_party\/xnnpack\//);
  assert.match(r.run_blocker.detail, /os error 3/);
});

// ---- synthetic fixtures (not CI evidence) ----
const stats = ({ requests, hits, misses, failures = 0, write = 0, noncache = 0 }) => [
  `Compile requests                  ${requests}`, `Cache hits                        ${hits}`, `Cache misses                      ${misses}`,
  `Cache write errors                    ${write}`, `Compilation failures                  ${failures}`, `Non-cacheable calls                   ${noncache}`, ''].join('\n');
const restore = (digest = 'a'.repeat(64), got = digest) => [
  `- azwah-sccache-1 (ID: 9, Size: 1000, Expected Digest: sha256:${digest})`,
  `SHA256 digest of downloaded artifact is ${got}`, 'Artifact download completed successfully.'].join('\n');
const handover = ['SHA256 digest of uploaded artifact zip is ' + 'b'.repeat(64),
  'Artifact azwah-sccache-1 has been successfully uploaded! Final size is 2000 bytes. Artifact ID is 10'].join('\n');

test('synthetic: replay, then new successful compiles and a larger hand-over IS forward progress', () => {
  const log = [restore(), 'LONGEST_OUTPUT_PATH length=226 obj/x.obj', 'CACHEABILITY requests=10 stored=0 hits=10 uncacheable=0',
    'BUDGET reached for autoninja.bat; stopping so the next job can continue.', 'FAILED: obj/killed-at-budget.obj',
    'INCOMPLETE the time budget ended', stats({ requests: 500, hits: 300, misses: 200 }), 'CACHE_BYTES 5000', handover].join('\n');
  const r = assessStage(log);
  assert.equal(r.cache_reuse_proven, true);
  assert.equal(r.fresh_work_proven, true);
  assert.equal(r.forward_progress_proven, true);
  assert.equal(r.run_blocker, null, 'a compile killed by the budget stop is not a blocker');
  assert.deepEqual(r.cannot_assess, []);
});

test('synthetic: misses that all failed to compile are not fresh work', () => {
  const r = assessStage([restore(), stats({ requests: 50, hits: 10, misses: 40, failures: 40 }), 'CACHE_BYTES 1', handover].join('\n'));
  assert.equal(r.fresh_work_proven, false);
  assert.equal(r.forward_progress_proven, false);
});

test('synthetic: a restored cache whose digest does not match is not reuse', () => {
  const r = assessStage([restore('a'.repeat(64), 'c'.repeat(64)), stats({ requests: 5, hits: 5, misses: 0 })].join('\n'));
  assert.equal(r.cache_reuse_proven, false);
});

test('synthetic: a truncated or empty log is reported as unassessable, not guessed', () => {
  for (const log of ['', 'some unrelated line', '[12/56561] CXX obj/a.obj']) {
    const r = assessStage(log);
    assert.equal(r.fresh_work_proven, false);
    assert.equal(r.forward_progress_proven, false);
    assert.ok(r.cannot_assess.some(x => /sccache statistics/.test(x)), JSON.stringify(r.cannot_assess));
    assert.ok(r.cannot_assess.some(x => /cache restore/.test(x)));
  }
});

test('synthetic: a finished browser archive is recognised', () => {
  const r = assessStage([restore(), stats({ requests: 9, hits: 4, misses: 5 }), 'CACHE_BYTES 9',
    'AZWAH_CHROMIUM_ZIP bytes=123 sha256=' + 'd'.repeat(64)].join('\n'));
  assert.equal(r.browser_produced, true);
  assert.equal(r.forward_progress_proven, true);
});

test('extraction drops signed URLs and tokens and keeps the evidence lines', () => {
  const raw = ['2026-11-21T00:02:16.6Z Redirecting to blob download url: https://x.blob.core.windows.net/a?sig=SECRET',
    '2026-11-21T00:02:16.7Z Authorization: Bearer abc', '2026-11-21T00:10:00.0Z [1/9] CXX a', '2026-11-21T00:11:00.0Z [8/9] CXX b',
    '2026-11-21T00:12:00.0Z CACHE_BYTES 5'].join('\n');
  const out = extractEvidence(raw);
  assert.doesNotMatch(out, /sig=|SECRET|Bearer|https?:/);
  assert.match(out, /\[8\/9\] CXX b/);
  assert.doesNotMatch(out, /\[1\/9\]/, 'only the last progress line of a graph is kept');
  assert.match(out, /CACHE_BYTES 5/);
});

test('synthetic: build-directory restore and pack lines are reported', () => {
  const r = assessStage(['OUT_RESTORED files=41000 bytes=7000000000 seconds=180', 'OUT_PACKED bytes=7100000000 seconds=240'].join('\n'));
  assert.deepEqual(r.evidence.buildDirRestored, { files: 41000, bytes: 7000000000, seconds: 180 });
  assert.deepEqual(r.evidence.buildDirPacked, { bytes: 7100000000, seconds: 240 });
});

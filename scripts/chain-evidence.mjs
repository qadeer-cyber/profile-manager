// Evidence from one Chromium chain stage log (GitHub Actions job log of azwah-chromium-chain.yml).
//
// Reports only what the log shows. Every conclusion is a boolean with the evidence behind it, and anything
// the log does not contain is listed in cannotAssess instead of guessed. Ninja [N/total] counts are recorded
// per stage but never compared across stages: each stage generates its own build graph.
//
// sccache statistics are per job: each stage starts a new sccache server, so its counters start at zero.
// The "CACHEABILITY" line is a snapshot after the //base check; the final stats block includes it.
//
//   node scripts/chain-evidence.mjs <job.log> [--first-stage]     prints JSON
//   node scripts/chain-evidence.mjs --extract <job.log> > fixture  sanitized excerpt for tests

const STAT_FIELDS = {
  'Compile requests': 'requests',
  'Cache hits': 'hits',
  'Cache misses': 'misses',
  'Cache errors': 'errors',
  'Cache read errors': 'readErrors',
  'Cache write errors': 'writeErrors',
  'Compilations': 'compilations',
  'Compilation failures': 'compilationFailures',
  'Non-cacheable calls': 'nonCacheable',
};

// GitHub prefixes each line with an ISO timestamp.
const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;
function split(text) {
  return String(text || '').split(/\r?\n/).map(raw => {
    const m = TS.exec(raw);
    return { at: m ? Date.parse(m[1]) : null, text: m ? raw.slice(m[0].length) : raw };
  });
}
const seconds = (a, b) => (a != null && b != null ? Math.round((b - a) / 1000) : null);

function lastStatsBlock(lines) {
  let block = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^Compile requests\s+\d+\s*$/.test(lines[i].text)) continue;
    const stats = { reasons: {} };
    let inReasons = false;
    for (let j = i; j < Math.min(lines.length, i + 60); j++) {
      const t = lines[j].text;
      if (j > i && /^Compile requests\s+\d+\s*$/.test(t)) break;
      const m = /^([A-Za-z][A-Za-z ()/+-]*?)\s{2,}(\d+)\s*$/.exec(t);
      if (m && STAT_FIELDS[m[1]] && !inReasons) stats[STAT_FIELDS[m[1]]] = Number(m[2]);
      if (/^Non-cacheable reasons:/.test(t)) { inReasons = true; continue; }
      if (inReasons) {
        const r = /^(\S.*?)\s{2,}(\d+)\s*$/.exec(t);
        if (r) stats.reasons[r[1]] = Number(r[2]); else if (t.trim() === '' || /^Cache location/.test(t)) inReasons = false;
      }
    }
    block = stats;
  }
  return block;
}

export function assessStage(logText, { firstStage = false } = {}) {
  const lines = split(logText);
  const find = re => lines.find(l => re.test(l.text));
  const findAll = re => lines.filter(l => re.test(l.text));
  const cannotAssess = [];

  const syncEnd = find(/^END gclient\.bat elapsed_seconds=(\d+)/);
  const revision = find(/^Synced Chromium revision: ([0-9a-f]{40})/);
  const longest = find(/^LONGEST_OUTPUT_PATH length=(\d+) (\S+)/);
  const cacheability = find(/^CACHEABILITY requests=(\d+) stored=(\d+) hits=(\d+) uncacheable=(\d+)/);
  const budget = find(/^BUDGET reached for autoninja/);
  const incomplete = find(/^INCOMPLETE the time budget ended/);
  const cacheBytes = find(/^CACHE_BYTES\b/);
  const uploaded = find(/^Artifact azwah-sccache-\S+ has been successfully uploaded! Final size is (\d+) bytes\. Artifact ID is (\d+)/);
  const uploadIndex = uploaded ? lines.indexOf(uploaded) : -1;
  const uploadDigest = uploadIndex > 0 ? [...lines.slice(Math.max(0, uploadIndex - 6), uploadIndex)].reverse()
    .find(l => /^SHA256 digest of uploaded artifact zip is ([0-9a-f]{64})/.test(l.text)) : null;
  const restorePlan = find(/^- azwah-sccache-\S+ \(ID: (\d+), Size: (\d+), Expected Digest: sha256:([0-9a-f]{64})\)/);
  const restoreDigest = find(/^SHA256 digest of downloaded artifact is ([0-9a-f]{64})/);
  const restoreDone = find(/^Artifact download completed successfully/);
  const browserZip = find(/^AZWAH_CHROMIUM_ZIP bytes=(\d+) sha256=([0-9a-f]{64})/);
  const stats = lastStatsBlock(lines);

  const m = (line, re) => (line ? re.exec(line.text) : null);
  const evidence = {
    chromiumRevision: m(revision, /([0-9a-f]{40})/)?.[1] ?? null,
    syncSeconds: m(syncEnd, /elapsed_seconds=(\d+)/) ? Number(m(syncEnd, /elapsed_seconds=(\d+)/)[1]) : null,
    longestOutputPath: longest ? { length: Number(m(longest, /length=(\d+)/)[1]), path: m(longest, /length=\d+ (\S+)/)[1] } : null,
    preflight: cacheability ? Object.fromEntries(['requests', 'stored', 'hits', 'uncacheable']
      .map(k => [k, Number(new RegExp(`${k}=(\\d+)`).exec(cacheability.text)[1])])) : null,
    stats,
    cacheBytes: cacheBytes && /\d/.test(cacheBytes.text) ? Number(/(\d+)/.exec(cacheBytes.text)[1]) : null,
    budgetReached: !!budget,
    incomplete: !!incomplete,
    handover: uploaded ? { bytes: Number(m(uploaded, /Final size is (\d+)/)[1]), artifactId: m(uploaded, /Artifact ID is (\d+)/)[1],
      sha256: uploadDigest ? /([0-9a-f]{64})/.exec(uploadDigest.text)[1] : null } : null,
    restore: restorePlan ? { artifactId: m(restorePlan, /ID: (\d+)/)[1], bytes: Number(m(restorePlan, /Size: (\d+)/)[1]),
      expectedSha256: m(restorePlan, /sha256:([0-9a-f]{64})/)[1],
      downloadedSha256: restoreDigest ? /([0-9a-f]{64})/.exec(restoreDigest.text)[1] : null, completed: !!restoreDone } : null,
    browser: browserZip ? { zipBytes: Number(m(browserZip, /bytes=(\d+)/)[1]), sha256: m(browserZip, /sha256=([0-9a-f]{64})/)[1] } : null,
  };

  // Earliest fatal line. A budget stop kills running compiles, so FAILED lines after BUDGET are expected.
  const budgetIndex = budget ? lines.indexOf(budget) : Infinity;
  const fatal = lines.map((l, i) => ({ ...l, i })).find(l =>
    /^sccache: (error|encountered fatal error)/.test(l.text) ||
    /^(\x1b\[[0-9;]*m)*Exception:/.test(l.text) ||
    (/^FAILED: /.test(l.text) && l.i < budgetIndex) ||
    /^##\[error\]/.test(l.text));
  let runBlocker = null;
  if (fatal) {
    const step = [...lines.slice(0, fatal.i)].reverse().find(l => /^##\[group\]Run /.test(l.text));
    const near = lines.slice(fatal.i + 1, fatal.i + 8).map(l => l.text).find(t => /^sccache: error|os error \d+|Exception/.test(t));
    runBlocker = { line: fatal.text.slice(0, 300), detail: near ? near.slice(0, 300) : null,
      step: step ? step.text.replace(/^##\[group\]Run /, '').slice(0, 120) : null };
  }

  if (!stats) cannotAssess.push('sccache statistics (no "Compile requests" block)');
  if (evidence.cacheBytes == null) cannotAssess.push('cache size (CACHE_BYTES missing or empty)');
  if (!firstStage && !evidence.restore) cannotAssess.push('cache restore (no download record)');
  if (!longest) cannotAssess.push('longest output path (no LONGEST_OUTPUT_PATH line)');

  const restoreOk = !!(evidence.restore && evidence.restore.completed &&
    evidence.restore.downloadedSha256 && evidence.restore.downloadedSha256 === evidence.restore.expectedSha256);
  const newCompiles = stats ? Math.max(0, (stats.misses ?? 0) - (stats.compilationFailures ?? 0)) : 0;
  const writeErrors = stats ? (stats.writeErrors ?? 0) : null;
  const cacheReuseProven = !firstStage && restoreOk && !!stats && (stats.hits ?? 0) > 0;
  // A compile killed at the budget stop can leave one write error; the count is always reported.
  const freshWorkProven = !!stats && newCompiles - (writeErrors ?? 0) > 0;
  const cacheHandoverProven = !!(evidence.handover && evidence.handover.bytes > 0 && evidence.handover.sha256);
  const browserProduced = !!evidence.browser;
  // Forward progress: new compiles that were kept (handed on, or a finished browser), on top of reused
  // earlier work unless this is the first stage. The blocker is reported separately.
  const forwardProgressProven = freshWorkProven && (cacheHandoverProven || browserProduced) && (firstStage || cacheReuseProven);

  return {
    firstStage,
    evidence,
    newCompiles,
    cacheWriteErrors: stats ? (stats.writeErrors ?? 0) : null,
    cache_reuse_proven: cacheReuseProven,
    fresh_work_proven: freshWorkProven,
    cache_handover_proven: cacheHandoverProven,
    forward_progress_proven: forwardProgressProven,
    browser_produced: browserProduced,
    run_blocker: runBlocker,
    cannot_assess: cannotAssess,
  };
}

// Keeps only the lines the assessment reads, plus the last Ninja progress line of each build graph.
// Drops anything that can carry a signed URL or token.
export function extractEvidence(logText) {
  const keep = /^(END gclient|Synced Chromium|BEGIN cacheability|CACHEABILITY|LONGEST_OUTPUT_PATH|BUDGET|INCOMPLETE|FAILED: |sccache: |ninja: build stopped|##\[error\]|##\[group\]Run |CACHE_BYTES|Artifact azwah-|SHA256 digest of|Preparing to download|- azwah-sccache-|Artifact download completed|Total of \d+ artifact|AZWAH_CHROMIUM_ZIP|(\x1b\[[0-9;]*m)*Exception:|Compile requests|Cache (hits|misses|errors|read errors|write errors)\s|Compilations\s|Compilation failures|Non-cacheable (calls|reasons)|-\S+\s{2,}\d+$)/;
  const out = [];
  const lastProgress = new Map();
  for (const raw of String(logText).split(/\r?\n/)) {
    if (/https?:\/\/|sig=|token|Authorization|password/i.test(raw)) continue;
    const m = TS.exec(raw);
    const text = m ? raw.slice(m[0].length) : raw;
    const p = /^\[(\d+)\/(\d+)\] /.exec(text);
    if (p) { lastProgress.set(p[2], raw.slice(0, 200)); continue; }
    if (keep.test(text)) {
      for (const [total, line] of lastProgress) { out.push(line); lastProgress.delete(total); }
      out.push(/##\[group\]Run /.test(text) ? raw.slice(0, (m ? m[0].length : 0) + 120) : raw.slice(0, 400));
    }
  }
  for (const line of lastProgress.values()) out.push(line);
  return out.join('\n') + '\n';
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const fs = await import('node:fs');
  const args = process.argv.slice(2);
  if (args[0] === '--extract') process.stdout.write(extractEvidence(fs.readFileSync(args[1], 'utf8')));
  else console.log(JSON.stringify(assessStage(fs.readFileSync(args[0], 'utf8'), { firstStage: args.includes('--first-stage') }), null, 2));
}

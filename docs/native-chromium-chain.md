# Native Chromium chained build: operations and evidence

How the experimental AZWAH Chromium is compiled on free GitHub-hosted Windows runners, how a run is judged, and what to do when it fails. The dated history is in `docs/native-engine-worklog.md`; this file is the reference.

Workflow: `.github/workflows/azwah-chromium-chain.yml`. Build script: `scripts/build-native-chromium-baseline.ps1 -AzwahSource -Sccache -TimeBudgetMinutes <n>`.

## Runs so far

| Run | Source | Result | First fatal error |
| --- | --- | --- | --- |
| [44706934362](https://github.com/qadeer-cyber/profile-manager/actions/runs/44706934362) | `6cd3bb3` | Stage 1 ran its budget; nothing cached | 23,302 of 23,303 compiles non-cacheable (`-fmodules-cache-path`); budget stop reported as failure |
| [44749921438](https://github.com/qadeer-cyber/profile-manager/actions/runs/44749921438) | `43cf7df` | Stage 1 cached 14,508 compiles; no hand-over | Evidence step failed (sample target `dom.obj` absent, Ninja exit 1) and skipped the hand-over |
| [44798415536](https://github.com/qadeer-cyber/profile-manager/actions/runs/44798415536) | `d807e3b` | Stage 1 handed over 343,182,422 bytes; stage 2 restored it (digest match) and replayed 11,115 hits, 0 misses | `sccache: failed to persist temporary file (os error 3)` on an xnnpack object whose full path was exactly 260 characters |
| [44848736628](https://github.com/qadeer-cyber/profile-manager/actions/runs/44848736628) | `da174b0` | In progress | — |

Evaluate any finished stage with `node scripts/chain-evidence.mjs <job.log> [--first-stage]`.

## What counts as progress

A stage advances the build only when all three hold, from its own log:

1. **Reuse** (not stage 1): the restored archive's downloaded SHA-256 equals the digest uploaded by the previous stage, and sccache reports hits.
2. **Fresh work**: cache misses (new compiles) minus compilation failures minus cache write errors is above zero. Misses that all failed are not fresh work.
3. **Kept**: the enlarged cache was uploaded (bytes and digest in the log), or the browser archive was produced.

Not evidence of progress: a green job, Ninja `[N/total]` compared across stages (each stage generates its own graph; totals differed, 56,561 vs 58,771), a cache check that only replays, or a hand-over without fresh work. sccache counters start at zero in each job; the `CACHEABILITY` line is a snapshot after the `//base` check and is included in the final stats.

## Hand-over

- Stage N uploads `SCCACHE_DIR` as artifact `azwah-sccache-<run id>` (compression off, retention 2 days, `overwrite: true`) when its build stopped at the time budget (`complete=false`). The step runs whenever that is true, regardless of later evidence steps.
- Stage N+1 downloads it by name before the build. `actions/download-artifact` logs the artifact ID, size and expected digest and checks the downloaded digest; `chain-evidence.mjs` compares them. Verified once: run 44798415536, ID 14680752122, 343,182,422 bytes, `71adf8ac…4fab` uploaded and downloaded.
- A missing artifact fails the restore step and therefore the stage; nothing continues on an empty cache by accident.
- Not yet observed: more than one hand-over in a run (the second upload overwrites the same name). Check the IDs and digests of each stage when it happens.

## Failure taxonomy (observed instances)

| Class | Symptom | Seen | Guard now |
| --- | --- | --- | --- |
| Non-cacheable compiles | `Non-cacheable reasons: -fmodules-cache-path` | 44706934362/1 | `use_clang_modules = false`; `//base` check stops within minutes if over 10% non-cacheable |
| Budget stop treated as failure | `##[error]Process completed with exit code 1` after `INCOMPLETE` | 44706934362/1 | Exit code reset after an expected budget stop |
| Evidence step blocks hand-over | Diagnostics step exit 1, hand-over skipped | 44749921438/1 | Evidence steps `continue-on-error`; hand-over condition independent of them (pinned by `test/workflow-triggers.test.js`) |
| Windows path limit | `os error 3` persisting a cached object at 260 characters | 44798415536/2 | Workspace `D:\az\c` (that object: 224); `scripts/chain-path-preflight.mjs` checks every output after GN (limit 250) |
| Repeated //base compiles | Objects from the `//base` check compiled again in the main build | 44798415536/2 | Not fixed. Hypothesis: no `/showIncludes` deps for cache-served compiles. Read-only diagnostic step records `ninja -t deps` and `-d explain` for four objects |
| Not yet seen | source sync, patch apply, GN, disk, link, packaging, runtime launch | — | Patch checked in `qualify`; free disk logged in every build phase; packaging verifies the manifest; fresh-runner smoke job |

## Finished browser (when a stage reports `complete=true`)

1. On the build runner: `scripts/test-native-chromium-build.ps1` (manifest, PE checks, smoke), then the packaging step writes `AZWAH-NATIVE-MANIFEST.json` (`scripts/native-artifact.mjs`: every file with SHA-256, source pins, patch and `args.gn` hashes, toolchain, run) and verifies it before zipping.
2. `fresh-runner-smoke` job on a clean runner: download, verify manifest and hashes, `scripts/native-smoke.mjs` (version, local page, graceful close, relaunch keeps localStorage, cleanup).
3. Only then does part 2 of the worklog count as done. Windows 10/11 client checks remain separate.

## Operations playbook

Read-only (safe at any time):

- `gh api repos/qadeer-cyber/profile-manager/actions/runs/<run>/jobs` — job and step states. A running job's log is not available until the job ends; that is not a failure.
- `gh api repos/qadeer-cyber/profile-manager/actions/jobs/<job>/logs > job.log` then `node scripts/chain-evidence.mjs job.log`.
- `node scripts/chain-evidence.mjs --extract job.log` — sanitized excerpt for a test fixture (drops URLs and tokens).

Starting a chain: a commit on `feature/azwah-ultimate-2` whose message contains the chain tag (see the `qualify` job condition), or a manual dispatch. Every push creates a chain run whose jobs are skipped without the tag, so never write the tag in a commit message by accident. `[skip ci]` skips all workflows.

Start a new chain only when: the previous run has ended; its first fatal error is identified from the log; a fix for it is committed and covered by a test where possible. Never cancel, re-run or duplicate a running chain to get evidence sooner.

Owner approval needed for: merging to `main`, publishing a release, enabling the native engine by default, paid runners or services, changing real users' profiles.

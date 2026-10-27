# M2 source evidence — Run 52, Attempt 2

Status: **VERIFIED IN SOURCE TEST EXECUTION; NOT SIGNED OFF**.
Recorded 2026-10-27. This packet is preserved on the M3 feature branch; no M2
implementation or QA branch head is moved.

## Exact sources

| Source | Full SHA |
|---|---|
| Frozen M1 | `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9` |
| M2 backend | `d41eb1c6c5d65fa2f2a3ba861c1a8c509ac50838` |
| M2 UI | `14beab8ea27905c6a8fdd387babe6de83ad41c51` |
| M2 QA/workflow | `bca3a9d6dec9ae43c30ac13765fdf90cdf078a57` |

[Run 52, Attempt 2](https://github.com/qadeer-cyber/profile-manager/actions/runs/40533634628/attempts/2)
concluded **failure**. Source acceptance succeeded on both platforms; artifact
upload failed on both. Do not describe this workflow as green.

| Platform | Job/log URL | Source acceptance step | Upload step |
|---|---|---|---|
| Windows 2022 | [122301673909](https://github.com/qadeer-cyber/profile-manager/actions/runs/40533634628/job/122301673909) | success | failure |
| Ubuntu 22.04 | [122301674406](https://github.com/qadeer-cyber/profile-manager/actions/runs/40533634628/job/122301674406) | success | failure |

Decoded log endpoints: `/repos/qadeer-cyber/profile-manager/actions/jobs/122301673909/logs`
and `/repos/qadeer-cyber/profile-manager/actions/jobs/122301674406/logs` on
`https://api.github.com`. GitHub redirects these to temporary download URLs;
the job URLs above are the durable links.

## Results from both job logs

All listed commands exited 0 on each platform. Counts below are per platform.

| Suite | Passed | Failed | Skipped | Todo |
|---|---:|---:|---:|---:|
| QA contract | 54 | 0 | 0 | 1 |
| QA security | 24 | 0 | 0 | 16 |
| QA existing E2E | 5 | 0 | 0 | 18 |
| QA recovery | 12 | 0 | 0 | 0 |
| QA real-browser live | 2 | 0 | 0 | 0 |
| Unit | 133 | 0 | 0 | 0 |
| Desktop unit | 11 | 0 | 0 | 0 |
| API | 41 | 0 | not reported | not reported |
| Engine | 42 | 0 | not reported | not reported |
| Lifecycle | 79 | 0 | not reported | not reported |
| Proxies | 62 | 0 | not reported | not reported |
| Security | 37 | 0 | not reported | not reported |
| Security migration | 4 | 0 | not reported | not reported |
| UI client | 4 | 0 | 0 | 0 |
| UI diagnostics | 54 | 0 | not reported | not reported |
| UI smoke | 25 | 0 | not reported | not reported |

Build and desktop-engine also exited 0; their summary records did not include
assertion totals. Do not invent counts. **35 QA todos remain**; a successful
runner exit is not proof those cases executed. Existing approval/provisional
contract questions and manual/installer QA gates remain open as applicable.

## Infrastructure exception

Both upload steps report `Failed to CreateArtifact` and an artifact storage quota
error. The diagnostic states usage is recalculated every 6–12 hours. This is a
GitHub diagnostic, not a promised recovery deadline. The run artifacts endpoint
returned `total_count: 0` when this packet was recorded.

The machine-readable companion `run-52-attempt-2.json` preserves exact job step
states, timestamps, per-suite exit codes/counts, source SHAs and quota errors,
extracted from the original decoded logs. Its SHA-256 is:
`5f77079f7ef908f1352418a0d8a223f7fb6c4cc077466d13cdb5a71c3981c9d0`.
This is a log-derived evidence summary, **not a recovered artifact bundle**.

## Remaining gate and recovery

Formal M2 sign-off stays pending, including uploaded evidence if the approved
contract requires it. No tests, failure statuses or required gates are waived.
No rerun is needed merely to rediscover quota exhaustion. Do not rerun or claim
to recover the original ephemeral workspace from an upload-only retry.

When authoritative capacity is available, recover preserved evidence through an
authorized upload mechanism; if source execution must be repeated to recreate
lost runner files, record it as a new attempt and retain this attempt's evidence.
Do not replace original logs, change source pins, generate installers, merge,
release, or silently convert remaining todos to passing checks.

M3 proceeds independently from frozen M1 on its own feature branch.

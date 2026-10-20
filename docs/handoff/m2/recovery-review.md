# M2 recovery review — WIP / NOT ACCEPTED

Date: 2026-10-19. Owner-approved sequential Codex takeover. No independent
milestone sign-off is claimed. No PR, merge, installer dispatch, release, or later
milestone implementation. Tested on macOS 13 x64 / Node 24.19.0.

## Preserved checkpoints

| Branch | Original checkpoint |
|---|---|
| Frozen M1 / development/v0.5.0 | d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9 |
| Backend | 32f90895e7ee9f3ac2b60f2337e8604d9c3117d8 |
| UI | 204152cbd1b9e670b13c674c84ff77520be774a7 |
| QA | 20649252417b1bf4b4656c273bfc6b657edf007e |
| Parity docs | 634ad711c7035a513dfd311da5961d153ec8656d |
| Master directive | ecf4aedb54e672ccc3b13456875b176aeccf7bf8 |

All five M2/documentation branches were verified descendants of M1 in a full,
non-shallow clone. Initial checkout was clean. Ordinary fast-forward feature
pushes only. No original commits rewritten.

Backend recovery checkpoint: 9f375ef8d2b398e18e920f6477846a606f29d44a.
UI recovery checkpoint: see feature/m2-diagnostics-ui (full SHA in owner packet).
QA recovery checkpoint: see test/m2-diagnostics-acceptance after this commit.

## Contract preservation

Original full DiagnosticsV1 is byte-preserved in backend branch at
`docs/handoff/m2/contracts/DiagnosticsV1.original.md`.
SHA-256: cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8.

Separately versioned `DiagnosticsV1.process-command-line.md` adds exactly one
Source enum line: `process_command_line`. Nothing else in the full text changes.
SHA-256: e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4.
Both complete files and SHA256SUMS are committed; original Markdown line-ending
spaces are intentionally retained to preserve the authoritative hash. State,
auth, cancellation and tab decisions are the owner's takeover instructions; no
new fields, per-fact timestamps or observation cache were invented.

## Findings and requirement coverage

The original unpushed F1–F10 report is unavailable. Only F3 is explicitly mapped
in the supplied takeover. The other IDs below are a **reconstructed tracking
index**, not a claim to have recovered QA's original numbering. All topics in the
owner's approved request are covered; original evidence is not fabricated.

| Tracking ID | Topic | Status / evidence |
|---|---|---|
| F1 (reconstructed) | Chromium policy name, '=' syntax, prefixes, Windows case, '--' | Implemented; parser unit + QA regressions pass. Actual Windows parser behavior pending. |
| F2 (reconstructed) / B1 | Live OS process observation and source | Implemented Linux /proc + Windows CIM, with launchId/PID/start checks; source synchronized across backend/UI/QA. Real Windows/Linux evidence pending; high-severity B1 remains acceptance-blocking. |
| F3 (authoritative) | Manifest-only state | Implemented; six backend and six QA negative/regression cases pass; unavailable has null validUntil and retains manifest. |
| F4 (reconstructed) | Visible new application-owned tab, no headless probe, navigation rejection | Implemented; backend + QA unit cases pass. Real foreground/network/user-tab behavior remains unverified. |
| F5 (reconstructed) | Hung evaluation, deadline, detach, cleanup, guard | Dedicated page CDP session; detach cancels evaluation; guard retained until work/cleanup settles. Unit and separate QA acknowledgement regressions pass. Actual browser detach acceptance pending. |
| F6 (reconstructed) | Initial mismatch vs mid-flight invalidation | Initial mismatch 409 LAUNCH_CHANGED; mid-flight 200 invalidated/launch_changed with null launchId and scrubbed facts. Backend + QA pass. |
| F7 (reconstructed) | Unauthorized malformed JSON | Diagnostics auth before body parser. Actual HTTP tests pass. Ordinary API middleware unchanged. |
| F8 (reconstructed) | Trailing slash error envelope / no-store | Actual HTTP tests pass for both slash forms. |
| F9 (reconstructed) | Desktop/API token separation + UI metadata | Auth tests pass; api.js exception is diagnostics-only. UI tests preserve transport and ordinary error behavior. |
| F10 (reconstructed) | Include diagnostics in test:unit | Implemented; unchanged M1 assertions retained; combined run has one real-browser prerequisite failure. |

B2's original wording/numbering was not in Git or the supplied request. The
reported parsing/visibility/timeout/invalidation/security issues have explicit
coverage above; no invented B2 acceptance claim is made.

## Actual verification results

All counts below are new local runs, not prior Grok results or GitHub CI.
Source assembly combines exact backend/UI checkpoint files with QA changes in a
scratch directory; no Git merge or shared integration branch was created.

| Suite | Pass | Fail | Skip | Todo |
|---|---:|---:|---:|---:|
| Backend diagnostics unit + process tests | 37 | 0 | 1 | 0 |
| QA contract (original + amendment hashes included) | 54 | 0 | 0 | 1 |
| QA security | 24 | 0 | 0 | 16 |
| QA existing E2E scaffolds / stopped HTTP checks | 5 | 0 | 0 | 18 |
| Reconstructed QA recovery / actual HTTP / client integration | 12 | 0 | 0 | 0 |
| New real pinned-browser acceptance suite | 0 | 0 | 1 | 0 |
| Combined unchanged M1 unit + diagnostics | 131 | 1 | 1 | 0 |
| Unchanged M1 engine | 5 | 2 | 0 | 0 |
| Unchanged M1 lifecycle | 0 | 1 | 0 | 0 |
| Unchanged M1 proxy | 32 | 1 | 0 | 0 |
| Unchanged M1 security | 32 | 3 | 0 | 0 |
| Unchanged M1 security migration | 4 | 0 | 0 | 0 |
| UI client validation/metadata | 4 | 0 | 0 | 0 |

QA total (five QA suites): 95 pass / 0 fail / 1 skip / 35 todo.
Vite production build succeeds, 33 modules. UI Chromium e2e exits 1 before
browser assertions because the pinned executable is missing (no fabricated
pass/fail assertion count). The unchanged M1 engine/lifecycle/proxy/security
failures follow missing Chromium/absent launch results; the combined unit failure
is the existing real-browser-child test. No M1 assertion was edited.

Pinned install attempted using repository Playwright: it refuses this host with
`Playwright does not support chromium on mac13`. No platform override or security
bypass was used. Existing installed Chrome was not substituted for pinned 156.
The real OS helper test is explicitly skipped outside Windows/Linux. Windows CIM
and Linux /proc code have **no actual platform evidence in this packet**.
Mock/injected-adapter tests are level 1 only. The real browser suite remains
available in `test/diagnostics-live.test.js` for supported-host execution.

## Changed files by ownership

Backend:
- package.json (diagnostics added to existing unit command)
- server/app.js (diagnostics-only pre-parser auth)
- server/browsers.js (diagnostic identity/read adapter; no launch-flag/classifier changes)
- server/diagnostics.js
- server/diagnostic-process.js (new)
- test/diagnostics-unit.test.js (updated superseded expectations; assertions preserved)
- test/diagnostic-process.test.js (new)
- docs/handoff/m2/backend.md
- docs/handoff/m2/contracts/DiagnosticsV1.original.md
- docs/handoff/m2/contracts/DiagnosticsV1.process-command-line.md
- docs/handoff/m2/contracts/SHA256SUMS

UI:
- web/src/api.js (owner-authorized error-metadata exception only)
- web/src/hooks/useProfileDiagnostics.js
- web/src/components/ProfileDiagnostics.jsx
- web/e2e/diagnostics-ui.mjs (new source fixture)
- web/e2e/diagnostics-client.test.mjs (new)
- docs/handoff/m2/ui.md

QA:
- test/diagnostics-v1-validator.mjs (source enum + unavailable freshness validation)
- test/diagnostics-contract.test.js (source fixtures, frozen-M1 inspection, hashes)
- test/diagnostics-security.test.js (retain absent-backend assertions; assert strict live response when present)
- test/diagnostics.e2e.js (same, and explicit outstanding browser todos)
- test/diagnostics-recovery.test.js (new)
- test/diagnostics-live.test.js (new, actual supported-host browser gate)
- docs/handoff/m2/qa.md
- docs/handoff/m2/recovery-review.md
- docs/v0.5.0/M2_ACCEPTANCE.md

## Review and next gate

Diffs were locally inspected and scanned for credential/private-key patterns;
no real credentials, databases, profiles, archives, generated executables or
installer artifacts are included. This is source review, not independent QA
sign-off. All existing QA negatives remain; obsolete "backend absent" checks
still apply when it is absent and have strict status/schema assertions when it
is present. Frozen-M1 absence is now checked against its exact Git object.

Required before acceptance: supported Linux + exact Chromium 156.0.8078.4 live
runs; actual Windows CIM/quoting/process identity/timing evidence; real visible
probe/network/no-user-page/cleanup/lifecycle coverage; all M1 failures resolved
on that supported environment; independent review. Review this packet before
any separately authorized Windows source CI. Installer approval is a later,
separate gate. No installer workflow may be dispatched from this packet.

# M2 QA handoff — Independent Security/QA (DiagnosticsV1 acceptance)

Status: **WIP / UNVERIFIED beyond evidence level 1.** This is not M2 acceptance. QA does not approve M2.
Branch URL: https://github.com/qadeer-cyber/profile-manager/tree/test/m2-diagnostics-acceptance

```text
AGENT ROLE: Independent Security/QA (M2 Read-only Diagnostics)
REPOSITORY: qadeer-cyber/profile-manager
ASSIGNED BRANCH: test/m2-diagnostics-acceptance (created from d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9)
LAST PUSHED REMOTE SHA: 3c2a3e510f3050632e2882366a8ba6a05bdbbd30
LAST COMMIT: "wip(m2): QA DiagnosticsV1 acceptance tests and matrix, level 1 only (WIP / UNVERIFIED)"
FILES CHANGED (all new; nothing else touched; package.json/lock unchanged):
  docs/handoff/m2/qa.md
  docs/v0.5.0/M2_ACCEPTANCE.md
  test/diagnostics-contract.test.js
  test/diagnostics-security.test.js
  test/diagnostics.e2e.js
  test/diagnostics-v1-validator.mjs   (test-only helper, not production)
TEST COMMANDS AND PASS/FAIL/SKIP (Node 22.12.0, Linux box, evidence level 1 only, external artifacts present):
  node --test test/diagnostics-contract.test.js   52 pass / 0 fail / 0 skip / 1 todo
  node --test test/diagnostics-security.test.js   21 pass / 0 fail / 0 skip / 19 todo
  node --test test/diagnostics.e2e.js              5 pass / 0 fail / 0 skip / 18 todo
  npm run test:unit (M1, unchanged)               95 pass / 0 fail
  (artifacts absent: contract 49/0/3 skip/1, security 18/0/3 skip/19; every skip says "external artifact absent")
DONE VS WIP: DONE = level-1 validator (§2/§3 schema; §1/§3/§6/§8/§9 semantics; owner per-operation state rules),
  static UI-patch checks, auth/CORS/log-capture/relay/cmdline checks, §10 matrix.
  WIP = all live M2 tests (todo "Blocked: backend absent").
BLOCKERS: The M2 backend (feature/m2-diagnostics-backend, server/diagnostics.js) is not available to QA.
  The box has no GitHub credentials; pushes go via a cloud agent.
NEXT EXACT IMPLEMENTATION STEP: see "Next action".
CAN CODEX SAFELY TAKE OVER? YES (QA tests only; level 1; backend absent)
```

## Baselines and contract
- Last successful baseline: `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9` (frozen M1).
- Contract: DiagnosticsV1 §1–12, SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`. The contract is **not in the repo**.
  Tests read it from `PM_DIAG_CONTRACT` (default `/workspace/DIAGNOSTICS_CONTRACT.md`) and pin the SHA.
- UI patch (UI agent's file, read-only): `PM_DIAG_UI_PATCH` (default `/workspace/m2ui-review/diagnostics-ui.patch`).
- If either artifact is absent, the dependent tests SKIP with `external artifact absent: …`. They never pass silently.
- Directive: `MASTER_DIRECTIVE.md` @ `ecf4aedb54e672ccc3b13456875b176aeccf7bf8`, blob `f2c820c3d1feaac7c004b12f5055e579856ced55`, §1–20.

## How to run
```
PM_DIAG_CONTRACT=/path/DIAGNOSTICS_CONTRACT.md PM_DIAG_UI_PATCH=/path/diagnostics-ui.patch \
  node --test test/diagnostics-contract.test.js test/diagnostics-security.test.js test/diagnostics.e2e.js
npm run test:unit
```
Box-only environment issue: `better-sqlite3@13.0.3` segfaults on the Linux box. The workaround was `npm install better-sqlite3@9.6.0 --no-save`; it is not committed.

## Evidence levels
1 mocked/unit · 2 real Chromium (Linux) · 3 Windows push CI · 4 installed EXE · 5 manual Windows QA. **Only level 1 has been run.**

## Owner decision enforced (not provisional)
- Per-operation required facts:
  - GET: chromiumVersion, userAgent, manifest expected version, proxy, commandLinePolicy.
  - POST: timezone, locale, languages from `visible_probe`, plus a launch identity.
- State definitions: `complete`, `partial`, `unavailable` and `invalidated`, as defined by the owner.
- `effectivePolicy` unavailable and `iceCollection: 'not_collected'` never block completion.
- Four required negative fixtures, all rejected.
- Flagged QA interpretations:
  - The manifest version doesn't count as an "obtained" fact for state.
  - No route means the GET ∪ POST union.
  - POST `unavailable` carries no launch facts (§3).

## Provisional rules enforced (pending owner confirmation; `PROVISIONAL` export)
- GET env facts unavailable with `permission_required`.
- `effectivePolicy` reason `unsupported`.
- `commandLinePolicy` source `browser_protocol`.
- durationMs: ≤3000 ms clean, ≤3250 ms flagged, >3250 ms fails.
- `expectedLaunchId` is opaque and must match exactly.

## Known issues / gaps
- **Unrun §10 items:**
  - automation-disabled observations
  - no page inspection / no external requests
  - lifecycle regressions (`npm run test:engine` not run here)
  - proxy/storage/upgrade/uninstall suites (only partially covered)
- **WebRTC allowlist** is a QA-lead assumption; the contract does not enumerate the values.
- **Source of `expectedLaunchId` is unspecified.** `/api/profiles` does not expose `launchId`; the UI takes it from the GET.
- **Known M1 exposure, not an M2 finding:** global `/api/diagnostics` returns the data-dir path (endpoint unchanged per contract).
- **Baseline-only test:** `baseline still has no server/diagnostics.js` will fail on the backend branch. When QA runs against the backend, replace it with the live tests; don't just delete it.

## Security blockers
None found in the existing code at level 1. All live M2 §7/§9 checks are pending the backend.

## Outstanding approvals
- Owner confirmation of the provisional rules and the flagged interpretations.
- No merge, PR, installer or workflow dispatch is requested.

## Next action (one)
When `feature/m2-diagnostics-backend` is pushed:
1. Check out its head on top of d7a000e in a scratch tree.
2. Run the three diagnostics suites with `PM_DIAG_CONTRACT` set.
3. Convert the "Blocked: backend absent" todos into live level-1/2 tests, starting with:
   - GET/POST bodies through `validateDiagnosticsV1(body, {route})`
   - the 400/401/404/409/429/500 error bodies and `Cache-Control: no-store`
   - then §7 visible-tab cases 1–8 on real Chromium (level 2)

## Codex recovery — 2026-10-19, WIP / NOT ACCEPTED

See `recovery-review.md` for reconstructed findings, exact contract hashes,
changed-file ownership, actual new test counts and supported-host blockers.
Original QA checkpoint 20649252417b1bf4b4656c273bfc6b657edf007e is preserved.
No independent QA sign-off is claimed by Codex. Backend absence assertions remain
for absent-backend trees; frozen-M1 absence is verified from its exact Git object.
The assembled backend/UI tree now has strict live HTTP status/schema checks.
Original schema negatives remain, with only owner-authorized Source updates and
stronger unavailable-validUntil validation. No failing M1 assertions removed.

Final QA runs: contract 54/0/0 skip/1 todo; security 24/0/0 skip/16 todo;
existing E2E 5/0/0 skip/18 todo; recovery 12/0/0 skip/0 todo; real browser 0/0/1 skip.
Real Linux/Windows Chromium is pending. No CI or installer dispatch performed.

## Supported-host source CI authorization — 2026-10-21

Owner approved proceeding from the review packet with Linux/Windows source tests.
Only the QA branch's version of the registered Windows workflow is changed: it
contains a manual-only Linux/Windows source matrix and no installer, packaging,
Electron-rebuild, merge, tag or release commands. build_installers must be false.
Protected branches and their original workflow are unchanged. Read-only checkout
permissions; checkout credentials are not persisted for test scripts.

Assembly pins backend d41eb1c6c5d65fa2f2a3ba861c1a8c509ac50838 and UI
5a2aea74ecb4f117b6a05def042726a868033c25. QA is the workflow's own full commit.
Assembly checks M1 ancestry, changed-file ownership and both complete contract
hashes. A disposable local rehearsal succeeded. No source merge is performed.

The evidence runner records each suite independently and fails the job if any
suite fails, while retaining later suite evidence. CI requires the real pinned
browser test to execute; missing platform/browser prerequisites cannot become a
quiet skip. The live cancellation case uses the actual 3000 ms contract deadline
and verifies that evaluation really began. A separate real-OS child fixture
checks absent/present/conflicting extraction, mismatched identity and elapsed
read time without modifying Chromium launch flags or exposing raw command lines.

Local checks: syntax, whitespace, disposable assembly, and live-suite skip path
(0 pass / 0 fail / 2 explicit skips on unsupported/unassembled macOS tree).
These are preparation checks, not Linux/Windows execution evidence. Actual run
IDs, source SHAs and suite results follow only after the remote jobs complete.

## Run 39664578427 fixes — 2026-10-27

GitHub Actions run [39664578427](https://github.com/qadeer-cyber/profile-manager/actions/runs/39664578427) on `ebf84461cce79b80d07d630574f30ebd8248f86b` failed both matrix legs. No installer was built.

Windows `source-tests (windows-2022)` stopped in assembly with `Contract checksum mismatch`. Checkout writes the backend contract markdown with CRLF. The pins stay `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8` and `e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4`. `scripts/m2-assemble.mjs` and `test/diagnostics-contract.test.js` hash a CRLF→LF normalization of those bytes and do not rewrite the contract files.

Linux `source-tests (ubuntu-22.04)` reached the suites. `unit` failed one test, `workflow smoke steps that enter offline smoke set PM_SMOKE_PHASE explicitly` (`test/offline-smoke-phase.test.js`), because the committed workflow is the M2 source-only variant and has no `UI smoke` step. After the source copy and before contract hashing, assembly writes `git show d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9:.github/workflows/windows-native-validation.yml` onto `.github/workflows/windows-native-validation.yml`, sets `manifest.restoredFromBaseline`, and throws if that path is owned by a source snapshot. That write is not committed. The committed workflow remains the source-only variant; its only edit is the UI checkout pin.

`ui-diagnostics` was 53 passed, 1 failed: `HTTP 500 INTERNAL_ERROR shows specific text, no raw message - support hint`. The UI checkout pin moves from `5a2aea74ecb4f117b6a05def042726a868033c25` to `14beab8ea27905c6a8fdd387babe6de83ad41c51` (`fix(m2-ui): assert requestId support hint on INTERNAL_ERROR`) in the assembler and the workflow checkout. The backend pin stays `d41eb1c6c5d65fa2f2a3ba861c1a8c509ac50838`.

## Owner ratification — process_command_line — 2026-10-27

Mohammad t43u ratified `DiagnosticsV1.process-command-line.md`.

- SHA-256: `e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4`
- Scope: add `process_command_line` to the Source enum only
- Original contract preserved: `DiagnosticsV1.original.md` SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`
- The amendment does not allow raw browser command lines, credentials, proxy secrets, tokens, or sensitive launch arguments in diagnostics payloads or logs
- Sanitization, authentication, timeout, and lifecycle rules from the original contract stay in force

Neither contract file was rewritten for this record. Local SHA-256 of those two backend objects matched the pins above.

## Source-sign-off execution — 2026-10-27

Node v22.23.4, Linux. Pinned browser used for the assembled run: Playwright Chromium `156.0.8078.4` (revision 1248). Profiles were disposable directories under `os.tmpdir()`. No CI workflow was dispatched.

The ten source-sign-off cases are real tests in `test/diagnostics-live.test.js`. They skip, and are not counted as passes, when `server/diagnostics.js` or the pinned Chromium executable is absent. Schema checks in `test/diagnostics.e2e.js` and `test/diagnostics-security.test.js` compare `currentVersion(db)` before and after diagnostics GET/POST with `migrations.at(-1).version`. They do not hardcode schema 7. This checkout's migration head is 7, and that is the database those assertions executed against. A v8 database was not in this tree, so v8 was not executed; the same comparison is what a v8 head would use.

### Assembled working tree (not committed)

Backend `d41eb1c6c5d65fa2f2a3ba861c1a8c509ac50838` and, for recovery only, UI `14beab8ea27905c6a8fdd387babe6de83ad41c51` (`web/src/api.js`, `web/src/hooks/useProfileDiagnostics.js`) were copied into the working tree for the run and then removed. Contract bytes were read from those same backend objects via `PM_DIAG_CONTRACT` and `PM_DIAG_AMENDED_CONTRACT`.

```
node --test --test-reporter=tap test/diagnostics-live.test.js
# tests 12 / pass 12 / fail 0 / skipped 0 / todo 0

PM_DIAG_CONTRACT=<DiagnosticsV1.original.md> PM_DIAG_AMENDED_CONTRACT=<DiagnosticsV1.process-command-line.md> \
  node --test --test-reporter=tap test/diagnostics-contract.test.js
# tests 55 / pass 54 / fail 0 / skipped 0 / todo 1

node --test --test-reporter=tap test/diagnostics.e2e.js
# tests 20 / pass 5 / fail 0 / skipped 0 / todo 15

node --test --test-reporter=tap test/diagnostics-security.test.js
# tests 33 / pass 21 / fail 0 / skipped 3 / todo 9

node --test --test-reporter=tap test/diagnostics-recovery.test.js
# tests 12 / pass 12 / fail 0 / skipped 0 / todo 0
```

All ten sign-off tests passed in the live file on that assembled tree. The other two live passes are the existing Chromium 156 acceptance test and the real OS child-process test.

### QA tree as committed (no `server/diagnostics.js`)

```
node --test --test-reporter=tap test/diagnostics-live.test.js
# tests 12 / pass 0 / fail 0 / skipped 12 / todo 0

node --test --test-reporter=tap test/diagnostics.e2e.js
# tests 20 / pass 5 / fail 0 / skipped 0 / todo 15

node --test --test-reporter=tap test/diagnostics-security.test.js
# tests 33 / pass 19 / fail 0 / skipped 3 / todo 11

node --test --test-reporter=tap test/diagnostics-recovery.test.js
# tests 12 / pass 0 / fail 0 / skipped 12 / todo 0

PM_DIAG_CONTRACT=<DiagnosticsV1.original.md> PM_DIAG_AMENDED_CONTRACT=<DiagnosticsV1.process-command-line.md> \
  node --test --test-reporter=tap test/diagnostics-contract.test.js
# tests 55 / pass 54 / fail 0 / skipped 0 / todo 1
```

On this tree the ten sign-off tests are skipped. They are not passes.

### Ten cases

| Case | Executed assertion | Assembled result |
|---|---|---|
| case 8: API token absent from live GET/POST bodies and headers | `test/diagnostics-live.test.js` | pass |
| §9 live payloads/logs, `findForbiddenMaterial`, `findRelayValue` on a real proxied launch | same file | pass |
| §9 failures leave last_error, lifecycle, `.pm-lock`, DB rows, and browser storage unchanged | same file | pass |
| §7.2/§7.10 one new visible app-owned tab; no hidden/background target | same file | pass |
| §7.5 existing user targets not evaluated | same file | pass |
| §7.6/§7.7 probe network and storage access | same file | pass |
| §7.1 missing consent is 400 and opens no tab on a running profile | same file | pass |
| §8 rapid stop/relaunch ×10 | same file | pass |
| case 1: diagnostic tab does not change classification or last_error | same file | pass |
| case 7: `data:` probe makes no external request and does not inspect the user page | same file | pass |

Empty `{ todo }` stubs for these ten were removed from `test/diagnostics-security.test.js` and `test/diagnostics.e2e.js`.

### Still open

These stubs were not part of the ten and are still todos: live §4 error-envelope matrix, §5 auth-before-lookup, §5 automation GET-only, §7.3 foreground ordering, §7.4 allowlisted script, §7.8 invalidation, §7.9 probe left open, §7.11 permissions, e2e disconnect/timeout/429/polling/cleanup/launching/stopping, e2e cases 2–6, Windows taskkill case 5, automation-disabled observation, and the contract-file live-body todo. `npm run test:engine` was not run. M2 is not accepted.

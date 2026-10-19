# M2 QA handoff — Independent Security/QA (DiagnosticsV1 acceptance)

Status: **WIP / UNVERIFIED beyond evidence level 1.** This is not M2 acceptance. QA does not approve M2.
Branch URL: https://github.com/qadeer-cyber/profile-manager/tree/test/m2-diagnostics-acceptance

```text
AGENT ROLE: Independent Security/QA (M2 Read-only Diagnostics)
REPOSITORY: qadeer-cyber/profile-manager
ASSIGNED BRANCH: test/m2-diagnostics-acceptance (created from d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9)
LAST PUSHED REMOTE SHA: <pending: the QA commit is pushed by a cloud agent; record the SHA here in a follow-up wip(m2) commit>
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
CAN CODEX SAFELY TAKE OVER? YES only after the QA commit is verified on the remote branch (compare d7a000e...branch shows
  exactly these 6 files) and this file records that SHA. The Grok QA agent then stops editing this branch. Until then: NO.
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

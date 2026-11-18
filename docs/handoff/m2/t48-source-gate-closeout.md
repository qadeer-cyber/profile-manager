# t48u — M2 final source-gate closeout (DISPOSABLE tree, local only — NOT pushed)

Owner auth t48u / t49u (Mohammad Abbas, 2026-10-28 PKT). Tree `/workspace/m2-m3-integrate/repo`,
branch `DISPOSABLE-m2-m3-integration`, base `564b1d5`. Node v22.14.0 (`/workspace/m2-m3-integrate/nodebin`).
Runner: `/workspace/m2-m3-integrate/t48-run.sh`; logs `logs/t48-*.log`, summary `logs/t48-summary.txt`.
No push, PR, merge, CI dispatch, installer or release. Contracts unchanged (sha256sum -c OK):
original `cd1ce49f…59d8`, amendment `e80ce2d5…dbf4`, addendum A1 `6290869b…add4`.

## 1. B1 closeTarget-failure — PASS (4/4, `logs/t48-b1-closefail.log`)
`test/regional-locale-diagnostic-closefail.test.js`, real Chromium, fault at CDP layer only, after a
(slow, 1.2 s) diagnostic-tab locale failure the app's own `Target.closeTarget(targetId)` is made to
`reject` / return `{success:false}` / `hang`. Each mode, with concurrent reload + typed navigation +
Runtime.evaluate attempts from an independent browser session:
- POST 200, DiagnosticsV1-valid, env unavailable:`collection_failed`, value null, <3.8 s;
- M3 fail-closed: profile stopped, `last_error = Failed to apply native browser regional locale`,
  `profile:launch-failed`, browser pid dead, no running row, no `.pm-lock`;
- `evalRan=[]`, zero beacons, zero `/escape` hits (no wrong-locale script/navigation);
- `diagnosticsActiveCount()==0`; relaunch + POST → `de-DE`; stop not hung; no unhandled rejections.
Real gap found and fixed: pre-fix `hang` left the profile running with the paused tab and a never-settling
setup job (`logs/t48-closefail-pre.log`, 3/4). `server/regional-locale.js` now bounds close confirmation
(`CLOSE_CONFIRM_MS = 1000`); unconfirmed ⇒ fail-closed. §7.9 ordinary/race fail-closed unchanged
(b1-fault 5/5, b1neg 3/3).
A1 UI visibility: `web/e2e/diagnostics-ui.mjs` disclosure step now asserts `[data-disclosure-addendum]`
is visible (layout box, visibility, opacity) with exact A1 text inside the dialog with zero POSTs
(before consent) — 54/0. `DISCLOSURE` unchanged.

## 2. Five source-sign-off TODOs — all implemented, PASS (`test/diagnostics-gate.live.test.js` 10/10)
Classification: `docs/handoff/m2/t48-todo-classification.md` (24 rows).
- S8 §7.11 permissions/persisted settings unchanged after POST — gate #5 PASS
- E1 §8 browser_disconnected — gate #6 PASS (product fix: `server/browsers.js` settling entry not from app Stop ⇒ phase `disconnected`)
- E6 §2/§8 launching/stopping reasons — gate #7 PASS
- E13 §7.8 live probe_navigated / probe_closed — gate #8 PASS
- E11 case 3 close probe → Stopped, exit_type Normal — gate #9 PASS
Merge-gate (kept separate, not implemented): E4 60 s/restart; stale-marker cleanup; integrated-tree CI run.
Release-only (preserved): E9 taskkill /F; E14 Windows socket half.

## 3. Counts (exact commands in t48-run.sh)
| Suite | Command | tests/pass/fail/skip/todo |
|---|---|---|
| B1 closefail | node --test test/regional-locale-diagnostic-closefail.test.js | 4/4/0/0/0 |
| B1 fault | node --test test/regional-locale-diagnostic-failure.test.js | 5/5/0/0/0 |
| B1 neg | node --test test/regional-locale-diagnostic-negative.test.js | 3/3/0/0/0 |
| M3 unit | npm run -s test:m3 | 34/34/0/0/0 |
| M3 browser | node --test browser-settings-browser + regional-locale-browser | 2/2/0/0/0 |
| M3 browser script | npm run -s test:m3:browser | 14/14/0/0/0 |
| M2 live | node --test test/diagnostics-live.test.js | 12/12/0/0/0 |
| M2 gate | node --test test/diagnostics-gate.live.test.js | 10/10/0/0/0 |
| M2 recovery | node --test test/diagnostics-recovery.test.js | 12/12/0/0/0 |
| M2 security | node --test test/diagnostics-security.test.js | 33/25/0/0/8 |
| M2 e2e | node --test test/diagnostics.e2e.js | 20/5/0/0/15 |
| M2 contract | PM_DIAG_REPOSITORY/CONTRACT/AMENDED_CONTRACT set; node --test test/diagnostics-contract.test.js | 55/53/1/0/1 (fail = B4) |
| M2 UI diagnostics | node web/e2e/diagnostics-ui.mjs | 54 passed / 0 failed |
| M1 unit | npm run -s test:unit | 133/133/0/0/0 |
| M1 unit + termination | same 9 files + test/termination-evidence.test.js | 143/143/0/0/0 |
| M1 engine / lifecycle / api | scripts/run-with-automation.mjs … | 42/0, 79/0, 41/0 |
| M1 security / migration | node test/security.e2e.js / security-migration.e2e.js | 37/0, 4/0 |
| M2×M3 probe | node ../scratch/m2m3-probe.mjs | pass, schema v8 |

## 4. M1 unit 143 vs 133
`npm run test:unit` runs 9 files = 133 tests (t47 and t48 identical). The 143 figure is
`logs/unit.log` (2026-10-28 09:00 PKT), an ad-hoc run that ALSO included `test/termination-evidence.test.js`
(10 `test(` calls; not in any package.json script) and had 1 failure (offline-smoke-phase:287 ENOENT
`test/electron-smoke-offline.js`, file added later in commit 14b85e9). Name-diff 143−133 = exactly the 10
termination-evidence tests. Re-run today: 9 files 133/133; 10 files 143/143. No test removed.

## 5. Schema v8
`server/migrations.js` head = v8 ("per-profile browser regional settings"). security §9 schema test is
baseline-relative (`migrations.at(-1).version` / `currentVersion(db)` + `schema_version` rows equal before/after
real GET/POST) and passes; M2×M3 probe reports v8; security-migration 4/0.

## 6. B4 — ENVIRONMENT-BLOCKED
contract #5 `git ls-tree d7a000e…` → `fatal: not a tree object` (synthetic disposable history). Assertion unchanged.

## 7. B2 workflow
`.github/workflows/m2-source-acceptance.yml`: `workflow_dispatch` with NO inputs; job `if: github.ref ==
'refs/heads/integration/m2-m3-source-gate'`; checkout `ref: ${{ github.sha }}`; asserts HEAD == github.sha;
asserts frozen ancestors 281b0b2/d41eb1c/14beab8/eb1b9c8; `sha256sum -c` SHA256SUMS + addendum and the three
pinned hashes; installer workflow blob. Runner adds closefail to b1-fault. Installer workflow blob
`c9a8e5259a811ba9e99342185ec153850cb278cc` (= main 281b0b2) byte-identical. Not dispatched.

## 8. Tip
See report (commit containing this file). Intended branch `integration/m2-m3-source-gate`. NOT pushed.

## 9. Blockers
- PUSH BLOCKER: this tree's history is synthetic (none of 281b0b2/d41eb1c/14beab8/eb1b9c8/d7a000e exist as
  objects). An ordinary push of this tip would NOT preserve frozen ancestry (and the B2 provenance step would
  fail, by design). The t46u–t48u deltas must be replayed as new commits onto a genuine checkout whose
  history contains those SHAs, then re-verified; no git credentials on this box.
- B4 env-blocked until run on genuine history. Independent QA on this tip pending. E4 merge gate open.
- Formal M2 source sign-off, merge, CI, release remain owner-held.

# M2 Acceptance — Read-only Browser Diagnostics (DiagnosticsV1)

**Branch:** `test/m2-diagnostics-acceptance` (remote created at d7a000e; QA commit **not pushed**, see `docs/handoff/m2/qa.md`) · **Baseline:** `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`
**Contract:** `/workspace/DIAGNOSTICS_CONTRACT.md`, full text §1–12 + END marker,
SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8` (measured == claimed; pinned in `diagnostics-contract.test.js`).
**Verdict:** **DO NOT ACCEPT M2. QA is not approving it.** The M2 backend (`server/diagnostics.js`, `feature/m2-diagnostics-backend`) is not in this tree, so every live row is Blocked.

## Evidence levels
1 = mocked/unit (in-process server, fixtures, static) · 2 = real Chromium integration (Linux box) · 3 = Windows push CI · 4 = installed EXE smoke · 5 = manual Windows QA.
This packet reached **level 1 only**. No row may claim a higher level.

## Run results (2026-10-19, Node 22.12.0, Linux box)
| Suite | Pass | Fail | Todo |
|---|---|---|---|
| `node --test test/diagnostics-contract.test.js` | 52 | 0 | 1 |
| `node --test test/diagnostics-security.test.js` | 21 | 0 | 19 |
| `node --test test/diagnostics.e2e.js` | 5 | 0 | 18 |
| `npm run test:unit` (M1, unchanged) | 95 | 0 | 0 |

External artifacts (not in the repo): the contract, via `PM_DIAG_CONTRACT` (default `/workspace/DIAGNOSTICS_CONTRACT.md`, SHA-256 `cd1ce49f…59d8`), and the UI patch, via `PM_DIAG_UI_PATCH` (default `/workspace/m2ui-review/diagnostics-ui.patch`). When either is absent, the dependent tests SKIP with "external artifact absent: …" (contract 3, security 3). They never pass silently. The counts above have both present.

Environment note: `better-sqlite3@13.0.3` segfaults on this box (Node 20 and 22). The box-only workaround is `npm install better-sqlite3@9.6.0 --no-save`. No lockfile or production change was made.
All todos use the reason `Blocked: backend absent`, except: the static scans of absent M2 files (skip as todo), and the M1 lifecycle pointer (`not run in this packet`).

## Lead clarifications (hard, from contract)
| Rule | Tests | Level | Status |
|---|---|---|---|
| §9 fixtures: no relay-shaped URL (`scheme://[userinfo@]127.x\|localhost\|[::1]:port`) anywhere in a response | `RELAY_ENDPOINT_RE` in `findForbiddenMaterial` (inside `validateDiagnosticsV1`); contract `§9 hard: relay-shaped URLs…` | 1 | PASS |
| §9 no false positives: `proxy.host='127.0.0.1'`/`localhost` with a separate `port` field, bare hosts and bare `host:port` are allowed | contract `§9 no false positives…` | 1 | PASS |
| §9 live: a response must not contain the actual running-row `relay_url` (full URL or its `host:port`) | `findRelayValue`; security `§9 level 1: running-row relay_url…` seeds a `running` row in the temp DB and checks M1 profile routes, `/api/diagnostics`, and the planned M2 GET/POST plus `/api/v1` | 1 | PASS (seeded row); real proxied launch + M2 handler Blocked: backend absent |
| §9: no raw command-line material (`--` switches, `user-data-dir`, `remote-debugging`, data-dir path) | contract `§9 hard: raw command-line flags…`; security log-capture (all routes) + detector test | 1 | PASS; live Blocked |
| §6: `webrtc.effectivePolicy` always unavailable in M2 | contract `§6 hard: effective WebRTC policy…` (enforced even with `provisional:false`) | 1 | PASS |
| durationMs: 3000 ms deadline, ≤250 ms overshoot tolerance | 3001–3250 ms gives a `warnings` entry (flag); >3250 ms fails | 1 | PASS |
| expectedLaunchId is opaque and must match exactly | contract `lead default: expectedLaunchId…` (no UUID requirement, case- and whitespace-sensitive) | 1 | PASS |

## PROVISIONAL backend working defaults (pending Mohammad's confirmation)
Enforced by default in `validateDiagnosticsV1`. `{ provisional: false }` gives contract-only checking. All values live in the `PROVISIONAL` export, so a change is a one-line edit.
| Provisional rule | Test | Level | Status |
|---|---|---|---|
| GET timezone/locale/languages unavailable with reason `permission_required` (exact code provisional) | `PROVISIONAL: GET timezone/locale/languages…` | 1 | **provisional** PASS |
| `effectivePolicy` reason `unsupported` | `PROVISIONAL: effectivePolicy reason…` | 1 | **provisional** PASS |
| `commandLinePolicy` source `browser_protocol` (fixtures moved from `launch_snapshot`) | same test | 1 | **provisional** PASS |
| ~~GET never complete~~ and ~~`complete` = every collectable fact~~ | **removed**; replaced by the owner decision below | — | superseded |
**Decided (lead):** when the whole observation is `unavailable` or `invalidated`, every fact may carry the observation-level reason (`not_running`, `launch_changed`, …) instead of the provisional per-fact reason. The validator accepts this.

## OWNER DECISION — observation states per operation (not provisional)
Rules: `complete` = every fact the operation requires was obtained. `partial` = some obtained, others failed or unavailable. `unavailable` = no meaningful required fact obtained. `invalidated` = launch identity changed or the observation is invalid. `effectivePolicy` may always be unavailable, and `iceCollection: 'not_collected'` never counts against completion.

| Operation | Required facts (`GET_REQUIRED_FACTS` / `POST_REQUIRED_FACTS`) | Does not block | Tests | Level | Status |
|---|---|---|---|---|---|
| GET | runtime.chromiumVersion, runtime.userAgent (browser level), expected.chromiumVersion (manifest), proxy (current launch), webrtc.commandLinePolicy (allowlisted value or verified absent/conflicting) | environment unavailable(`permission_required`), effectivePolicy, iceCollection | `owner GET: complete with env unavailable…`, `owner NEG: GET complete with any required GET fact failed…` | 1 | PASS |
| POST | environment.timezone/locale/languages from `visible_probe`, plus a non-null launchId (consent body rule: `validateEnvironmentPostBody`) | runtime/proxy/webrtc not recollected | `owner POST: complete when…`, `owner NEG: POST complete without a verified launch identity…` | 1 | PASS |
| Required negatives | GET complete with chromiumVersion unavailable; POST complete with timezone unavailable; partial with zero required facts (must be unavailable); unavailable with some required facts available | — | `owner NEG: …` (4 named tests) | 1 | PASS (all rejected) |
| Supporting | partial with every required fact obtained (must be complete); invalidated carries no launch facts on GET and POST | — | `owner: partial = …`, `owner: invalidated …` | 1 | PASS |

QA interpretations (flagged for owner):
- (a) The manifest `expected.chromiumVersion` is launch-independent. It is required for GET completion but does not count as a "meaningful obtained" fact, so a stopped profile is still `unavailable`.
- (b) No `route` means a conservative union of the GET and POST required sets.
- (c) The §3 rule still applies: an `unavailable` or `invalidated` observation returns no launch-derived facts. A POST that is `unavailable` but still carries runtime facts is therefore rejected. Owner to confirm.

## §10 QA acceptance mapping
| # | §10 requirement | Tests (file → test) | Level run | Status | Level still required |
|---|---|---|---|---|---|
| 1 | Strict schema and enum validation | contract: validator self-tests, limits, enums, Fact union, §2 absent/conflicting, 12 negative fixtures, semantics (§1/§3/§6/§8) | 1 | PASS (fixtures) | 2: live bodies (todo) |
| 2 | Authentication and access restrictions | security: missing X-UI-Token 401, `?token=` rejected, Bearer + X-API-Key, unauth planned path ≠200, no permissive CORS/preflight, §5 static no `/api/api-token`/API_TOKEN; todos: auth-before-lookup, /api/v1 GET-only | 1 | PASS (existing routes); live Blocked | 2 |
| 3 | Status and error responses | contract + security: error-body validator, ERROR_CODES, POST body exact props/consent; todos: live 400/401/404/409/429/500 envelopes | 1 | PASS fixtures; live Blocked | 2 |
| 4 | `Cache-Control: no-store` | security: `assertCacheControlNoStore` helper self-test; live todo in §4 envelope row | 1 (helper) | Live Blocked | 2 |
| 5 | Sensitive-data exclusion from payloads **and logs** | security: §9 log-capture (sentinel proxy creds, relay endpoints, cmdline flags, data-dir path across existing + planned routes; console/stdout/stderr), detector test, fixture-no-sentinel; todos: case 8, cookies/storage/page URLs/cmdline/relay/raw CDP | 1 | PASS (current server); live Blocked | 2 |
| 6 | Browser observations with automation disabled | e2e: `§9/§10: observations work with automation disabled…` (todo) | — | Blocked | 2 |
| 7 | No extra debugging TCP port | security: no listener on 9222/9229/9333 (idle server); e2e todo during GET/POST | 1 | PASS idle; live Blocked | 2, 3 |
| 8 | Visible-tab consent and foreground behavior | security: DISCLOSURE in UI patch == contract text, hook sends exact consent + expectedLaunchId, no window.open/iframe; todos §7.1, §7.2/§7.10, §7.3, §7.4, §7.9, §7.11 | 1 (static) | Static PASS; live Blocked | 2, 5 |
| 9 | No existing-page inspection; no external requests | todos §7.5, §7.6/§7.7, e2e case 7 | — | Blocked | 2 |
| 10 | Stale launch identity and rapid relaunch | contract: `canCombineSnapshots`, fresh observation ids, invalidated ⇒ no launch facts; e2e todos: 409 LAUNCH_CHANGED, rapid relaunch ×10, case 6 | 1 (fixtures) | Live Blocked | 2 |
| 11 | Timeouts, concurrency and resource cleanup | contract: 3 s / 30 s constants, validUntil ≤ completedAt+30 s; security static: no setInterval/storage in UI; e2e todos: timeout, 429, no polling, cleanup | 1 (fixtures/static) | Live Blocked | 2 |
| 12 | Unavailable, disconnected and invalidated responses | contract: unavailable/not_running and invalidated (launch_changed/probe_closed/probe_navigated) fixtures; e2e todos: browser_disconnected, launching/stopping, §7.8 | 1 (fixtures) | Live Blocked | 2 |
| 13 | Existing lifecycle and recovery regressions | e2e cases 1–5 (todo); `npm run test:engine` pointer (todo, not run) | — | **Not run here** | 2, 3 (case 5 taskkill: 3+) |
| 14 | Existing proxy, storage, upgrade and uninstall preservation | e2e: schema stays v7, profile dir not mutated by GET; security todos: no migration, no diagnostic state changes. Existing suites (`test:proxies`, offline smoke, uninstall step) **not run in this packet** | 1 (partial) | Partial | 2, 4 |
| 15 | Preserve all existing M1 test assertions | `npm run test:unit` 95/95. `git diff` shows only the five QA files changed (no M1 test or production file) | 1 | PASS | 3 (Windows CI) |

**§10 items with no executed test:** #6 (automation disabled), #9 (no page inspection / external requests), #13 (lifecycle regressions: only todos plus an unexecuted suite pointer). #14 is only partially covered here (upgrade/uninstall/proxy suites not run).

## Regression items 1–8 (QA lead) vs contract
| Case | Spec | Contract basis | Status |
|---|---|---|---|
| 1 | Tab doesn't change classification / last_error | §9 failures don't touch last_error/lifecycle | Blocked |
| 2 | Probe open + user tab closed → Running, same PID, last_error unchanged | §7.9, §9 | Blocked |
| 3 | Close probe via Target.closeTarget → Stopped, exit_type Normal | §7.9 (user close, not auto-close) | Blocked |
| 4 | App Stop kills all (no process, .pm-lock, running row) | §8 stop invalidates; user action, not an auto-close | Blocked |
| 5 | taskkill /F → Error | §9 lifecycle unchanged | Blocked (level 3+) |
| 6 | Relaunch → new launchId, new observation id, env unavailable until new POST | §3, §8 | Blocked (fixture helpers PASS) |
| 7 | data: probe makes zero external requests, no Runtime.evaluate on user targets | §7.5, §7.6 | Blocked |
| 8 | No API_TOKEN / `/api/api-token` in M2 | §5 | Static PASS (UI patch); live Blocked |
No contract conflict found with items 1–8.

## Known M1 exposure (not an M2 finding)
- The global `/api/diagnostics` (M1 health, UI-token only) returns the data-dir path. Per the contract that endpoint stays unchanged, so it is exempt from the data-dir assertion only. Relay, command-line and credential checks still apply to it and pass. This is not counted against M2.

## Contract conflicts / gaps (for contract owner)
1. **WebRTC allowlist** (`default`, `default_public_and_private_interfaces`, `default_public_interface_only`, `disable_non_proxied_udp`) comes from the QA lead. §3 says only "recognized values" and gives no list. The validator enforces the list as a QA assumption.
2. **Source of `expectedLaunchId` for POST is unspecified** (format: opaque + exact-match, lead default). `/api/profiles` (`publicP`) does not expose `launchId`. The UI patch takes it from the GET `observation.launchId`, so the POST depends on a prior GET.
3. **`launchId` format:** resolved provisionally as opaque. Real IDs are `randomUUID()`; the UI mock `'launch-A1'` is valid.
4. **complete/partial/unavailable/invalidated:** resolved by the owner decision (per-operation required facts; see the section above). `effectivePolicy` is "otherwise unavailable" and GET environment facts are always unavailable, so `complete` may never be reachable from GET.
5. **GET environment reason:** provisionally `permission_required`.
6. **WebRTC sources:** provisionally `commandLinePolicy` comes from `browser_protocol`; effectivePolicy is always unavailable (`unsupported`, provisional).
7. **`durationMs`:** lead default ≤3000 clean, ≤3250 flagged, >3250 fails.
8. **The consistency rule is implied by "never fabricated", not stated.** The validator derives it: unknown if either version is unavailable; otherwise match or mismatch by string equality.
9. **Relay URL is stored in the `running` table.** §9 forbids returning it; this is now a hard validator/security failure (level 1), with a live todo.
10. **Assumption changed:** the earlier "unavailable-with-reason" form for absent/conflicting WebRTC is removed. §2 (available `{state, value:null}`) is final.

## Commands
```
export PATH="/tmp/node-v22.12.0-linux-x64/bin:$PATH"; cd /workspace/pm-m2qa
node --test test/diagnostics-contract.test.js
node --test test/diagnostics-security.test.js
node --test test/diagnostics.e2e.js
npm run test:unit
```
Files (QA-owned only): `docs/handoff/m2/qa.md`, `test/diagnostics-v1-validator.mjs` (test-only helper), `test/diagnostics-contract.test.js`, `test/diagnostics-security.test.js`, `test/diagnostics.e2e.js`, `docs/v0.5.0/M2_ACCEPTANCE.md`. UI patch `/workspace/m2ui-review/diagnostics-ui.patch` read only, not modified.

## Codex recovery packet — supersedes prior local-results narrative only

M2 remains NOT ACCEPTED. See `../handoff/m2/recovery-review.md` for the complete
new packet, preserved hashes, scope, files, actual pass/fail/skip/todo counts and
remaining high-severity platform-evidence blockers. The earlier QA test intent
and every negative assertion are retained. Source enum expectations are updated
only for the authorized process_command_line amendment. No mock result is
represented as Windows or real Chromium evidence. Installer dispatch forbidden.

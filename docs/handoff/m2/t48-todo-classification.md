# t48u — 24-item M2 TODO classification (DISPOSABLE tree, local only)

Inventory = every `{ todo }` marker still present on this tree (executed counts unchanged: they still
report as TODO, never as pass): `test/diagnostics-contract.test.js` 1, `test/diagnostics-security.test.js` 8
(loop at :440-448), `test/diagnostics.e2e.js` 15 (:153-192). Row ids map to the Remediation Packet rows
(canvas 0bad4f6c, 35 rows; the 11 PASS rows there already had no live marker or are listed here).
A row is PASS only when a cited executed assertion covers it on this tree (skip ≠ pass, todo ≠ pass).
Markers were NOT removed or converted; QA can re-derive each status from the cited test.

Logs: `/workspace/m2-m3-integrate/logs/t48-*.log` (gate = `t48-m2-gate.log`, live = `t48-m2-live.log`).

| # | File:line | Test (marker) | Packet row | Status | Evidence (executed on this tip) | Implemented this tip |
|---|---|---|---|---|---|---|
| C1 | contract:659 | live GET/POST bodies pass validateDiagnosticsV1 / error body | 1 | PASS | live #1 validator on real GET/POST; gate #1/#4 `validateDiagnosticsErrorBody` 429/409 | no |
| S1 | security:440 | §4 live 400/401/404/409/429/500 envelopes + no-store | 3 | PASS | recovery 12/12 (400/401/404 + no-store); gate #1 429 + no-store; gate #4 409 + no-store; unit 133 | no |
| S2 | security:441 | §5 auth before profile lookup (401 not 404) | 4 | PASS | recovery (unknown id, no token → 401) | no |
| S3 | security:442 | §5 automation /api/v1 GET-only | 5 | N/A | Contract §5 has no such rule (needs amendment to become a requirement) | no |
| S4 | security:443 | §7.3 probe foreground | 11 | PASS | live #1 `visible_probe` source; gate #1/#7.11 POST complete | no |
| S5 | security:444 | §7.4 only allowlisted script | 12 | PASS | unit static bans + strict body (unit 133) | no |
| S6 | security:445 | §7.8 invalidation (level 1) | 15 | PASS | unit probe_navigated/probe_closed/launch_changed; live counterpart = E13 | no |
| S7 | security:446 | §7.9 probe still open after response | 16 | PASS | gate #2 pages +1 after success; b1neg success-tab open | no |
| S8 | security:447 | §7.11 permissions + persisted settings unchanged after POST | 17 | **REQUIRED BEFORE SOURCE SIGN-OFF → PASS** | gate #5 (Preferences content_settings exceptions/defaults/managed/intl, profiles row, browserSettings equal before/after 2×POST) | **yes** |
| E1 | e2e:153 | §8 GET on disconnected browser → browser_disconnected | 18 | **REQUIRED BEFORE SOURCE SIGN-OFF → PASS** | gate #6 SIGKILL browser → `unavailable:browser_disconnected` (product fix in `server/browsers.js`) | **yes** |
| E2 | e2e:154 | §8 probe >3 s → timeout, late ignored | 19 | PASS | b1neg #2 3 s deadline; live #1 | no |
| E3 | e2e:155 | §8 429 + other profile unaffected + slot released | 20 | PASS | gate #1 | no (t46) |
| E4 | e2e:156 | §8 no polling 60 s; no persistent cache after restart | 21 | REQUIRED BEFORE MERGE | UI e2e covers page-load/selection no-fetch only; no 60 s window / server restart | no (merge gate) |
| E5 | e2e:157 | §8 resource cleanup N cycles | 22 | PASS | gate #2 (N=5, sessions ≤3/tab, active 0); b1neg leak check | no (t46) |
| E6 | e2e:158 | §2/§8 launching/stopping → reason launching/stopping | 23 | **REQUIRED BEFORE SOURCE SIGN-OFF → PASS** | gate #7 GET polled during real launch/stop: `unavailable:launching`, `unavailable:stopping` | **yes** |
| E7 | e2e:159 | §8 old expectedLaunchId → 409; mid-collection → launch_changed | 24 | PASS | gate #4 409; live #12 ×10 relaunch; gate #6 mid-collection `invalidated:launch_changed` | no |
| E8 | e2e:163 | case 4 Stop terminates whole profile | 27 | PASS | gate #2 (no pid, no .pm-lock, no running row, last_error null) | no (t46) |
| E9 | e2e:166 | case 5 taskkill /F → Error (Windows level 3+) | 28 | RELEASE-ONLY | Windows 10/11 release QA | no (release) |
| E10 | e2e:178 | case 2 close user tab → Running, same PID | 30 | PASS | gate #2; gate #9 step 1 | no (t46) |
| E11 | e2e:183 | case 3 close probe via Target.closeTarget → Stopped, exit_type Normal | 31 | **REQUIRED BEFORE SOURCE SIGN-OFF → PASS** | gate #9 (Stopped, last_error null, Preferences exit_type Normal, pid gone, no .pm-lock) | **yes** |
| E12 | e2e:189 | case 6 relaunch → new launchId, env unavailable | 32 | PASS | gate #4 | no |
| E13 | e2e:190 | §7.8 live navigate → probe_navigated; close → probe_closed | 33 | **REQUIRED BEFORE SOURCE SIGN-OFF → PASS** | gate #8 (allowlisted read held; real Page.navigate / Target.closeTarget mid-observation) | **yes** |
| E14 | e2e:191 | §9/§10 automation off; no debugging TCP port | 34 | PASS (Linux) / RELEASE-ONLY (Windows socket half) | gate #3 /proc cmdline + `ss -ltnp` empty; Windows `Get-NetTCPConnection` half is skipped off-Linux by design | no |
| E15 | e2e:192 | M1 lifecycle still green | 35 | PASS | `t48-m1-lifecycle.log` 79/0, `t48-m1-engine.log` 42/0 | no |

Totals: PASS 15 (+5 newly implemented = 20 executed), REQUIRED BEFORE SOURCE SIGN-OFF 5 (all implemented
and green on this tip), REQUIRED BEFORE MERGE 1 test row (E4), RELEASE-ONLY 2 (E9; E14 Windows half),
N/A 1 (S3). 

Split vs the owner's "5 source / 3 merge / 2 release": 5 source and 2 release reproduce from file
evidence. Only ONE merge-gate *test* row remains among the 24 markers (E4). The other two merge-gate items
in the same audit are not test rows: (M2) replace the 20 stale todo markers with pointers to the executing
suites (hygiene; deliberately not done here so counts stay verifiable), (M3) one M2 source-acceptance run
on the integrated tree on GitHub (needs CI dispatch, owner-held). Kept separate, not implemented.

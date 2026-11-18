# Stage 2 — durable local data recovery checkpoint

Branch: `codex/ultimate2-local-completion`. Parent: `401b0a4d86d30728458b816c047ce0e65f71e7b2`. Exact delivery SHA is the commit containing this report (`git rev-parse HEAD`). No shared feature branch changes or integration were performed.

## Delivered behavior

- Public portable export now creates a v2 manifest inside the existing AES-256-GCM/scrypt envelope. Passphrase (8–1024 characters) and explicit sensitive-data confirmation are mandatory. No local encryption key, API token or provider-account token is exported. Proxy passwords are decrypted only inside the exporting process, carried inside the authenticated encrypted archive, and encrypted under the receiving installation's secret backend. Exported files stay local.
- Explicit workspace/proxy/extension records and assignments restore into a clean installation. Referenced extension assets are included for both engine libraries. Conflicting dependency IDs are remapped and reported; unrelated destination records/assets are retained. Browser engine, regional/privacy settings, workspace linkage, proxy linkage, enabled assignments and supported raw browser data are preserved.
- Full backups now use SQLite serialization instead of copying only the main database after a best-effort WAL checkpoint. Export collects metadata under an immediate transaction, refuses active sessions or pending recovery, and has a regression with a concurrent older reader pinning WAL pages.
- File SHA-256 inventories must cover every portable payload file. Missing/foreign dependencies, unsafe paths, symlinks, malformed manifests/configuration, newer schemas, altered checksums and plaintext-v2 downgrades fail before a profile is installed. Archives have bounded counts, depth, member size, total payload, manifest size and transfer-container size. Oversized exports fail rather than emit an archive the HTTP restore endpoint cannot read.
- Legacy v1 `.pmp` archives remain readable. V1 cannot manufacture dependency assets that were never archived: unavailable dependencies now fail closed with an actionable error. Valid older dependency-free fixtures continue to restore. V2 accepts supported older source schema numbers. The archive envelope version remains 1; the inner portable manifest is version 2.
- New `pm_recovery_operations`, `pm_recovery_profile_locks` and `pm_recovery_path_locks` tables coordinate staged moves and SQLite commit markers. Journal plans contain relative paths, hashes and IDs, not credential values or file contents. FULL SQLite synchronization is enabled. Staging is under the application data root, so swaps stay on one filesystem.
- Full and portable restore flows use the journal. Existing data is parked before installation, the domain updates and committed journal marker share a SQLite transaction, and previous copies are removed only after verification. Interrupted pre-commit restores roll back by renaming retained copies; startup never deletes recovery copies. Committed interrupted restores remain locked until explicit verification/cleanup. Database dependency hashes and filesystem hashes must both agree.
- Purge first quarantines the complete profile tree. Deletion failure leaves the trash row and available files. Startup reports pending purge operations without retrying deletion. Explicit recovery moves surviving bytes back to Trash, distinguishes complete from partial recovery, and preserves a blocking error when bytes are missing. Explicit confirmed retry completes remaining deletion. SQLite errors, EBUSY-like partial deletion and repeated restarts are covered. Stop failures abort before staging.
- Profile/path locks block overlapping restores, purge/trash races, queued launches and profile mutation endpoints while recovery is unresolved. Path ownership is case folded for Windows. Active database/browser-lock ownership blocks data operations.
- Profiles now opens a dedicated encrypted export dialog. Diagnostics has authenticated, confirmed recovery/cleanup actions. The HTTP export contract deliberately rejects old callers that omit encryption/confirmation fields.
- Windows CI now runs the deterministic data-recovery suite before browser regression. No job timeout was increased. The human-input browser fixture now runs headless, validates bounded CDP readiness, checks process exit/spawn errors, navigates explicitly to the local page and registers cleanup hooks. Its original typing assertion remains.

## Verification

Exact commands, counts and durations: `STAGE2_TEST_EVIDENCE.json`. Counts overlap and are not a unique-test total.

| Check | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Stabilization | 90 | 0 | 0 |
| Full recovery aggregate | 47 | 0 | 0 |
| Final portable/cross-process cases | 27 | 0 | 0 |
| Final purge/lock cases | 10 | 0 | 0 |
| Final real HTTP API workflow | 1 | 0 | 0 |
| Final export/WAL snapshot regressions | 13 | 0 | 0 |
| Final Firefox/older-schema snapshot checks | 2 | 0 | 0 |
| Source subset | 141 | 0 | 1 |
| Full unit command | 132 | 2 | 0 |
| Human-input browser gate | 1 | 1 | 0 |

Frontend build and syntax/diff checks pass. The source subset retains the previous six explicit local browser exclusions, while the full CI script still runs them. The single subset skip is absent host Firefox.

Unit failures: pinned Chromium headless-shell binary is absent; the Linux host process-identity test also returned null instead of its required OS start ID. No assertion was removed and no browser download was retried. The human-input gate now fails promptly with the explicit unavailable-binary error rather than leaking its HTTP fixture. Real browser, rendered UI, Windows filesystem/DPAPI and physical display/device validation remain unqualified.

Fresh A→B tests use separate Node processes and SQLite installations, valid fixture SQLite files and distinct Chromium/Gecko directory trees. They verify raw cookie-database bytes, local-storage fixture bytes, dependency restoration, encryption and isolation. These are not claims of browser-generated cookie portability, Firefox XPI signing, real browser readback, or DPAPI decryption on another computer.

Crash tests terminate fixture processes inside staging, profile/extension park/install moves, before/after SQLite commit, during cleanup boundaries, and purge quarantine/deletion/commit. Recovery runs repeatedly in new processes. Fault hooks are internal test options, never HTTP-controlled environment injection in the application.

## Windows CI evidence

Codex historical run: https://github.com/qadeer-cyber/profile-manager/actions/runs/41052856450 — FAILED. Completed job log shows `test/human-input.test.js:19`, `typeHumanTextOverCdp`, a 30000ms CDP initialization timeout after WebSocket connection; the test file then hits its 180000ms deadline. Totals: 146 PASS, 1 FAIL, 1 cancelled, 1 SKIP, duration 270763.5931ms. This proves the failing test and leaked lifetime, not a verified Windows fix. The new fixture requires a new source run.

Grok historical run: https://github.com/qadeer-cyber/profile-manager/actions/runs/41046838158 — API still reports IN PROGRESS in browser regression at last inspection. Its log endpoint returned 404; no exact Grok test diagnosis is claimed. Neither run was cancelled or rerun by this work. Installer jobs are skipped. One ordinary source CI run may start from this checkpoint push; no installer dispatch.

## Scope and scorecards

Original 45-category score is unchanged: **18 VERIFIED, 20 PARTIAL, 5 UNSUPPORTED, 0 MISSING, 2 cloud-excluded**. `(18 + 0.5 × 20) / 43 × 100 = 65.1%`. Previous **65.1%**, current **65.1%**, increase **0.0 points**; no category promoted. M8 requires native browser readback and Windows/application workflow evidence before promotion.

`FEASIBLE_LOCAL_ACCEPTANCE_V1.json` freezes 42 local capability groups, excluding only the two cloud categories and the impossible CAPTCHA-free guarantee. Proprietary masking guarantees are outside scope; permissible native privacy restrictions remain included. Every group requires implementation, persistence/security, API/unit tests, actual workflows and applicable platform evidence. **0/42 groups are fully requalified against that stricter complete-feature gate on this revision; 42 incomplete, including 3 external device/display/provider qualification blockers; 0% fully qualified.** This is a conservative qualification inventory, not a replacement for the historical 65.1% score and not a claim that existing functionality regressed. Difficult feasible implementation remains in the denominator.

## Integration risk — review only, no merge

Inspected heads: feature branch `b872f13d96ecdb2165875b7a740849d6e5f8dc96`, Codex parent `401b0a4d86d30728458b816c047ce0e65f71e7b2`. GitHub comparison reports the feature branch behind the Codex parent by one commit, with no additional committed feature changes at inspection. Uncommitted Grok work is not observable through GitHub.

| Surface | Reconciliation required |
|---|---|
| `server/app.js` | Preserve recovery startup, profile safety middleware, authenticated recovery routes, and encrypted export body contract while retaining Grok routes. |
| `server/browsers.js` | Preserve pending-operation guards both before queueing and immediately before actual launch; do not bypass recovery locks. |
| `server/backup.js`, `server/archive.js` | Keep portable v2/dependency validation and durable journal coordination. Do not restore the old transaction-only filesystem implementation. |
| `package.json`, Windows workflow | Union test scripts and source CI checks; retain existing installer-smoke restrictions. |
| Profiles/Diagnostics UI | Preserve dedicated export/recovery components while reconciling workspace controls; no broad redesign was made. |
| Workspace/proxy/extension records | Portable dependency mappers whitelist actual destination columns; additional defaults or fields introduced by Grok need explicit validation/export/restore tests. Do not silently discard newly added required fields. |
| Migrations | Numeric application schema stays v18; no numbered migration was added. Version-1 recovery tables are additive/owned by the journal module. Future migration/schema changes must preserve them. |
| CLI | No CLI source changed here. Clients must POST `{passphrase, confirmSensitive:true}` for export and handle encrypted `.pmp`; restore uses existing passphrase headers. Passphrases must never appear in argv, query strings or logs. |
| Tests | Keep the original typed-value assertion and fixture cleanup; do not run duplicate test fixes from both workers without reconciliation. |

Proposed integration order (owner approval still required): review the security parent and this recovery checkpoint first; reconcile server/backup/browser safety hooks; then integrate Grok feature commits preserving encrypted export and journal contracts; run union source/API/browser suites once; qualify installed desktop separately only when authorized. No cherry-pick, merge or PR was performed.

## Remaining limitations and P0/P1 gates

- Windows crash/rename/file-lock behavior and actual UI workflow acceptance remain pending. Directory fsync is attempted; Windows directory handles can reject fsync. No physical power-loss durability guarantee is claimed; process-interruption tests do not substitute for storage-controller/OS power-failure qualification.
- Browser-encrypted passwords/cookies may be machine/OS bound. Portable v2 preserves supported raw data and explicitly warns users; it cannot decrypt unsupported browser/OS encryption formats.
- Recovery snapshots are intentionally bounded (32 MiB per file, 128 MiB tree fingerprint budget, 20000 tree entries); portable transfer is limited to 64 MiB. Larger profiles fail safely and need a future streaming design, not silent truncation.
- Recovery cannot recreate bytes already deleted by a partial purge. It retains and recovers remaining files, marks them incomplete, and allows backup replacement after explicit recovery. Recovery copies require explicit cleanup after interrupted operations.
- Genuine signed Firefox installation lifecycle, M35 CLI, local workspace/defaults, ADB real-device qualification, proxy live-provider/traffic qualification and other fixed local requirements remain incomplete. Concurrent feature-worker files were not modified. No 100% completion claim.
- Standard browser and full unit gates remain red/unavailable locally. Reproduction on authorized Windows source CI: `npm ci`, `npx playwright install chromium`, `npm run test:data-recovery`, `npm run test:browser-runtime`, `npm run test:unit`, `npm run build`. No installer-smoke dispatch is needed for those source checks.

No PR, merge, main/feature branch write, force push, preview tag, release, paid service, installer-smoke dispatch or personal-profile upload. Installer-qualified `b3349af0fd236cb7a4898dd5083eca5e2210840b` remains untouched. Owner §19 sign-off is withheld.

## Files changed

- `.github/workflows/dedicated-browser-engine-win.yml`
- `docs/handoff/multilogin-platform/FEASIBLE_LOCAL_ACCEPTANCE_V1.json`
- `docs/handoff/multilogin-platform/MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`
- `docs/handoff/multilogin-platform/STAGE2_TEST_EVIDENCE.json`
- `package.json`
- `server/app.js`
- `server/archive.js`
- `server/backup.js`
- `server/browsers.js`
- `server/portable-backup.js`
- `server/profile-lifecycle.js`
- `server/recovery-journal.js`
- `test/_chromium-cdp-fixture.mjs`
- `test/backup-selective.test.js`
- `test/fixtures/portable-recovery-worker.mjs`
- `test/human-input.test.js`
- `test/portable-api.test.js`
- `test/portable-recovery.test.js`
- `test/profile-backup-export.test.js`
- `test/profile-lifecycle-purge.test.js`
- `test/recovery-locks.test.js`
- `web/src/components/PortableExportDialog.jsx`
- `web/src/components/RecoveryPanel.jsx`
- `web/src/pages/DiagnosticsPage.jsx`
- `web/src/pages/ProfilesPage.jsx`
- `docs/handoff/multilogin-platform/STAGE2_RECOVERY_CHECKPOINT.md`

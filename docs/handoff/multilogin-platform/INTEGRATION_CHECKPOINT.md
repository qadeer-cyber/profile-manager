# Integration checkpoint — `integration/ultimate2-stock-secure`

**No pull request.** This branch was not merged to `main`. No installer-smoke, preview, release, or Windows CI dispatch.

**Checkpoint commit:** `be48117972f615a16a5d0936118420e8a8105a8a` (parent of the commit that records this line).

**Branch tip:** child of that checkpoint commit on `integration/ultimate2-stock-secure`. A commit cannot contain its own hash; resolve the tip with `git rev-parse HEAD`.

Parent integration merge: `abf10757eaccf9e5c5f5088efe07d3a58a94ef4c`.

## Parents and preserved commits

| Role | SHA | Reachable |
|------|-----|-----------|
| Integration merge | `abf10757eaccf9e5c5f5088efe07d3a58a94ef4c` | tip parent |
| Merge first parent (docs alignment on Codex) | `d10b7396e59f257e9d5c56e13583467b8b526662` | yes |
| Merge second parent (Grok feasible tip) | `8251394d27bda34fc4625a276e109752a419bec5` | yes |
| Codex security checkpoint (branch start) | `0723c54251c33732b6c6f45fdf91ac990f831bd3` | yes |
| Dedicated-engine freeze | `1df952a1ee1c3fe59b87ee74fb4a4a22fc2bd478` | yes (ancestor of `8251394`) |
| Installer baseline | `b3349af0fd236cb7a4898dd5083eca5e2210840b` | yes |

No custom Chromium or Firefox tree was added. Stock CfT and stock Firefox only.

## Feasible-local 22/23 document alignment

Docs only. Acceptance criteria were not added, removed, or reclassified.

The closeout said **22/22** and **8 BLOCKED**. The negative file already covers two stock criteria (invalid modes are rejected and not persisted; restricted settings persist across restart and stay isolated). Those were one collapsed row, which is the 22-versus-23 mismatch. The matrix has **7** BLOCKED rows, not 8.

Aligned denominator: **23 PASS / 0 FAIL = 23/23 (100%)**. **BLOCKED_CUSTOM_ENGINE stays outside the denominator.**

## Dual scorecards

Historical matrix on this branch stays the Codex checkpoint: **18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 NOT_APPLICABLE_CLOUD = 65.1%**. Grok promotions of M2, M3, M8, M12, M14, M17, M18, M33, M35, M36, M37, M38, and M40 to VERIFIED were **not adopted**. Phase Six’s ≈80.2% figure remains a record of `970dbc8`, not the score of this tip.

Feasible-local stock scorecard (separate): **23/23 PASS**, 7 BLOCKED rows excluded.

## M8

**M8 is not VERIFIED.** No real Windows browser acceptance was run. The historical row stays **PARTIAL**.

`npm run test:m8:acceptance` on this Linux host: **0 pass / 2 fail**.

- Chromium: encrypted UI export reached a `PMBE` archive, then Playwright could not read the `restore-stream` response body (`response.json` evicted after navigation). Not treated as acceptance.
- Firefox: `FIREFOX_MISSING` (Firefox is not installed here).

## Security reconciliation

Codex won the security contracts. These files were not replaced by the Grok tree: encrypted portable v2, streaming backup, recovery journal, locks, XPI validation, browser fixtures.

- CLI `backup-export` posts `confirmSensitive: true` and `PM_BACKUP_PASSPHRASE` to `POST /profiles/:id/backup/export-stream`. Passphrases are not accepted on argv or in the query string. Output must start with `PMBE`. Missing passphrase is a usage error and does not write an archive.
- Unencrypted portable export is not the default or the acceptance path. `createLegacyProfileBackup` remains only for existing unit coverage of the old packer. HTTP portable routes require the encrypted v2 contract.
- Workspace import and bulk assign call `assertProfileOperationAvailable` for every affected profile, including routes outside `/profiles/:id`.
- Gecko signing policy stays the Codex sentence: Firefox verifies signatures on installation; this importer does not. The Grok API test now asserts that sentence.
- `observeBrowser` hard-stop remains **35000 ms**, with the WebGPU adapter cap and a cleared deadline timer so a finished observation does not hang or reject later.

**STOP:** no security path was abandoned. The unencrypted Grok export was not copied over Codex. Callers were adapted.

## Local suites

No installer smoke. Counts are from this host after the integration fixes.

| Suite | Result |
|-------|--------|
| `npm run test:unit` | **134 pass / 0 fail / 0 skipped** |
| `npm run test:stabilization` | **90 pass / 0 fail / 0 skipped** |
| `npm run test:data-recovery` (recovery, streaming, portable, locks) | **63 pass / 0 fail / 0 skipped** |
| `npm run test:browser-runtime` (CLI, workspace, proxy, feasible-local, negative fingerprint, XPI) | **186 pass / 0 fail / 1 skipped** |
| `npm run test:integration:preflight` | **1 pass / 0 fail**. Disposable probe **blocked: 0** (create, configure, refuse unencrypted export, encrypted `PMBE` stream, workspace create, workspace import) |
| `npm run test:m8:acceptance` | **0 pass / 2 fail** (see M8). Not a verification. |

Browser-runtime skip: `firefox spawn smoke when host Firefox is installed` — no Firefox executable on this host.

Negative security coverage that passed inside the suites above includes `test/app-security.test.js`, `test/fingerprint-feasible-local-negative.test.js`, and `test/fingerprint-stock-reject.test.js`. Security tests were not edited to drop assertions. The Grok portable API test and Gecko report test were pointed at the Codex encrypted and signing contracts.

## Feature notes

Stock-feasible CLI, workspace import, proxy library/switch, ADB mock scope, human-input (Codex headless fixture plus Unicode and geckodriver report), and fingerprint acceptance tests are on this branch.

Unresolved on this host: M8 rendered restore readback, host Firefox, Windows browser acceptance. No custom engine work.

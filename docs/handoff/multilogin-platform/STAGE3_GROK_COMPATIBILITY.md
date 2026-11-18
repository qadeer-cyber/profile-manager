# Stage 3 pinned integration evidence

Compared Codex f78d88a43ac7be03210275d18a1119bc0b593111 plus this checkpoint with observed Grok 35b9ab6985e5ab7bb78c9919708201900ccfaf6d (newer than owner-provided 2bd93dbe9a4ff7314d01dc30b15c5351b867c658). Read-only comparison; no merge, cherry-pick, rebase or Grok ref write.

| Surface | Required reconciliation |
|---|---|
| server/app.js | Preserve authenticated stream routes, recovery diagnostics and all profile recovery guards while adding Grok CLI/workspace/proxy/ADB routes. Workspace import/bulk paths must lock every affected profile, including paths outside /profiles/:id. |
| scripts/pm-cli.mjs | Actual pinned Grok CLI creates/configures profiles and creates workspaces against Codex API. Export fails because it sends neither passphrase nor confirmSensitive. Add protected prompt/input handling, streaming encrypted download/upload and binary-safe output; never put passphrase in argv/query. Workspace import route is absent on isolated Codex backend until reconciliation. |
| server/workspaces.js and portable dependencies | Preserve deterministic dependency ID mapping, existing workspace fields/defaults/vault boundaries. Test import collisions, missing references, restart and locks. |
| proxy-library / provider APIs | Preserve restored concrete proxy credentials under local encryption. Do not export provider account/API tokens implicitly. Recheck provider/group schema after Grok finishes M17/M18. |
| test/human-input.test.js / server/human-input.js | Preserve Codex isolated headless fixture/shutdown and Grok Firefox/Unicode/input-value assertions. Review special-key encoding against W3C WebDriver; source sends Enter-like strings, requiring browser qualification. |
| Firefox extensions/launch | Preserve XPI validation, stock unsigned-extension limitation and selected Marionette port. Retest GeckoDriver and native launch together. |
| package.json / workflow | Union required tests once; retain finite fixture/file timeouts. New source unit, data recovery and M8 acceptance gates must remain. No installer smoke. |
| database startup | Both inspected branches use schema 18; retain durable journal initialization before launch/mutation and idempotent migrations. Shared version number alone does not prove equivalent migrations. |
| SettingsPage / ProfilesPage / RecoveryPanel | Preserve streaming File upload, encrypted confirmation, private passphrase state, partial recovery feedback and explicit orphan transfer cleanup when incorporating workspace/proxy UI. |
| historical matrix | Keep historical claims separate; require independent combined gates before promoting any feature. |

Deterministic probe: obtain scripts/pm-cli.mjs at pinned Grok SHA without integrating source; run PM_CANDIDATE_CLI=<absolute path> npm run test:integration:preflight. It starts an isolated disposable Codex backend and uses authenticated loopback APIs. The script also requires PM_INTEGRATION_DISPOSABLE=1 when invoked directly. Latest report: create/configure/workspace-create pass; encrypted backup contract and workspace-import blocked. A green report-generator test is not green combined functionality.

Proposed order after explicit owner integration authorization: reconcile schema/startup and recovery guards; resolve workspace/proxy dependency contracts; reconcile backup CLI and streaming UI; combine human-input fixtures without dropping assertions; union scripts; then run unit, stabilization, data recovery, CLI/workspace/proxy API, XPI, real Chromium/Firefox/driver and Windows source suites. No integration performed.

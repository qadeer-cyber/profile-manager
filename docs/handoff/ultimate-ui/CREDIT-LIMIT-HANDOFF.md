# Ultimate credit-limit handoff

Status: incomplete and experimental. Not verified for release. Not merged to `main`. No unified prerelease was published by this handoff.

Codex owns every remaining implementation change, Windows qualification, and release decision. This document preserves the branch, the retained installer, the checks that actually ran, and the Firefox failure that is still open.

## Identifiers

| Item | Value |
| --- | --- |
| Branch | `integration/azwah-ultimate-ui-release` |
| Pull request | https://github.com/qadeer-cyber/profile-manager/pull/11 (draft, base `feature/azwah-office-edition`) |
| Installer source SHA | `8baf1ffe13387bf3fba056d756a448da8b0e1e29` |
| Latest harness SHA before this handoff | `bd7714d1df625122f7bdec40a175a2e694b50e30` |
| Installer | `Azwah-Multi-Browser-Ultimate-Setup-x64.exe` |
| Bytes | 854726925 |
| SHA-256 | `c007a4a9f08ffd29cffef74aae782b54400b0c44d35eb840732af9be95f7e142` |
| Build run | https://github.com/qadeer-cyber/profile-manager/actions/runs/42392300409 |
| Unified tag | `azwah-multi-browser-ultimate-unified-8baf1ffe1338` was not found at handoff |

The installer bytes and the harness commits are different. Later commits on this branch change tests and evidence. They do not replace the EXE.

## Installer retention

The EXE is a GitHub Actions artifact, not a Git blob and not a release asset.

- Name: `ultimate-installer-8baf1ffe13387bf3fba056d756a448da8b0e1e29`
- Artifact id: `13582203390`
- Zip size reported by the API: 854864763 bytes
- Created: 2026-11-07T16:46:46Z
- Expires: 2026-11-21T16:46:21Z
- Expired at handoff: no
- Run: https://github.com/qadeer-cyber/profile-manager/actions/runs/42392300409
- Small sibling artifact `ultimate-unified-8baf1ffe13387bf3fba056d756a448da8b0e1e29` (id `13582268413`) expires 2026-12-07T16:48:50Z. That zip holds the early acceptance JSON, not the EXE.

Download and check before the expiry, without rebuilding:

```powershell
gh run download 42392300409 --repo qadeer-cyber/profile-manager --name ultimate-installer-8baf1ffe13387bf3fba056d756a448da8b0e1e29 --dir release-ultimate
Get-Item release-ultimate\Azwah-Multi-Browser-Ultimate-Setup-x64.exe | Select-Object Length
(Get-FileHash release-ultimate\Azwah-Multi-Browser-Ultimate-Setup-x64.exe -Algorithm SHA256).Hash.ToLowerInvariant()
```

Expected length is `854726925`. Expected hash is `c007a4a9f08ffd29cffef74aae782b54400b0c44d35eb840732af9be95f7e142`.

GitHub does not extend an existing artifact's expiry. Copying the EXE onto a release would publish a product, so this handoff does not do that. After 2026-11-21T16:46:21Z the artifact download fails unless someone has stored the same bytes elsewhere. The hash above is the durable identity.

Do not overwrite these existing releases:

- `azwah-multi-browser-owner-experimental.1`
- `azwah-license-admin-experimental.1`
- `azwah-multi-browser-ultimate-79b262b4f995`
- `azwah-license-admin-ultimate-79b262b4f995`

## What the retained EXE has shown

Windows Server 2022 only. Windows 10 is not qualified. Authenticode is not applied. A copy while Owner or Admin is still running is not qualified. `203.0.113.50` in these logs is the fixture address, not an observed public IP.

### Acceptance run 42394760001, harness `d6ea0f8`

https://github.com/qadeer-cyber/profile-manager/actions/runs/42394760001

Passed, on this EXE: clean Owner and Admin AppData, previous Owner profile, previous Admin public key, Firefox file and license notice present, packaged `server/ultimate-admin.js`, `scripts/license-admin/admin.mjs`, `issuer.mjs`, and `server/office/license.js` readable, issuance dependency link, no issuer certificate or vault in the archive, single Ultimate application, browser features without employee activation, migrated Owner database and Admin vault with sources unchanged, locked vault, profile creation while locked, wrong vault password rejected, unlocked public key without a private key, issue, reissue, export, encrypted backup restore, generated Office installer, employee package without issuance module or private key, employee package contains Firefox and Chromium files, employee window has no license-administration section, Office rejects a different device and a tampered signature.

Stopped there. Exact failure line:

`UNIFIED_ACCEPTANCE_FAILURE locator.waitFor: Timeout 30000ms exceeded.`

The later harness commit `b382ab9080c460deba8236d155b406a7ac31d436` says that timeout happened because the textarea still held the previous device token. That explanation was not re-run on the full acceptance script. Standard-account activation, expired-license rejection on a separate account, cookie and extension persistence, and uninstall/reinstall retention are not passed by this run.

An earlier acceptance JSON from the build run records a false failure, `Unified package contains the in-process license administration module`, caused by Windows ASAR separators. Run 42394760001 later read those same packaged files successfully. The early JSON is kept at `docs/handoff/ultimate-ui/evidence/acceptance-42392300409.json`.

### Essential run 42396463912, harness `129a2bd`

https://github.com/qadeer-cyber/profile-manager/actions/runs/42396463912

Passed organization creation, one authenticated CONNECT for Test Proxy, sealed proxy storage (`ss:v1`), saved-library proxy reload, Chromium `/azwah-route` through that proxy, Chromium image inside the installer tree, Chromium stop and restart, and Firefox profile creation.

Firefox launch returned a non-200 status in about 2.9 seconds. That harness discarded the response body, so this run does not contain the API message. Evidence: `docs/handoff/ultimate-ui/evidence/essential-42396463912.json`.

### Essential run 42397008724, harness `bd7714d`

https://github.com/qadeer-cyber/profile-manager/actions/runs/42397008724

Same passes as 42396463912, then the captured Firefox response, then cookie import and extension import. Publish was skipped. Evidence:

- `docs/handoff/ultimate-ui/evidence/essential-42397008724.json`
- `docs/handoff/ultimate-ui/evidence/essential-42397008724-transcript.log`

## Firefox launch

This is not a pass. System Firefox search stayed disabled. The result is not full offline Firefox support.

### Facts

Repro used by harness `bd7714d` against the retained EXE:

- Silent install of `Azwah-Multi-Browser-Ultimate-Setup-x64.exe`.
- Electron environment `PM_FIREFOX_NO_SYSTEM=1`, `PATH=C:\Windows\System32`, `ProgramFiles` and `ProgramFiles(x86)` pointed at empty directories, `PM_FIREFOX_EXECUTABLE` and `PM_FIREFOX_RESOURCES` removed.
- `POST /api/profiles` with `browserEngine: "firefox"` and `browserSettings: {firefoxSessionMode: "bidi", timezoneId: "UTC"}`. Profile creation returned 201.
- `POST /api/profiles/:id/launch` with `{headless: true, automation: true}` through the UI route. That route does not pass `allowOverride`, so the `automation` field in the body is ignored by `doLaunch`.

Captured response from run 42397008724:

```text
HTTP 409
code: FIREFOX_SESSION_UNAVAILABLE
message: Firefox process ownership could not be verified
```

In installer source `8baf1ffe13387bf3fba056d756a448da8b0e1e29`, that exact message is thrown only at `server/firefox-session-manager.js` after BiDi `session.new` and `firefoxSessionIdentity` have already returned a PID, when `pidMatches` then returns false. `pidMatches` on Windows reads the command line with `powershell.exe` and falls back to `wmic` (`server/proc.js`).

Independent existing probe, not started by this handoff: https://github.com/qadeer-cyber/profile-manager/actions/runs/42397046696 on `codex/azwah-owner-qualification` at `c463580decec642c534da1f5b88aa633f7168a10`. It checked the same SHA-256 before launching. Its log lines:

```text
FIREFOX_PROBE {"includesPowerShell":false,"shellProbe":{"code":"ENOENT","ok":false},"launched":{"status":409,"body":{"error":"Firefox process ownership could not be verified","code":"FIREFOX_SESSION_UNAVAILABLE"}}}
FIREFOX_PROBE {"includesPowerShell":true,"shellProbe":{"code":null,"ok":true},"launched":{"status":500,"body":{"error":"Firefox BiDi unknown command: emulation.setTimezoneOverride","code":"LAUNCH_FAILED"}}}
```

`server/firefox-bidi.js` `setFirefoxTimezone` sends `emulation.setTimezoneOverride`. `ownFirefoxSession` calls it when the profile has a timezone, which this repro sets to `UTC`.

### Hypotheses, not claimed as the only cause

- The 409 on the essential harness is the ownership lookup failing because `powershell.exe` is not on `PATH=C:\Windows\System32`. The Codex probe's `ENOENT` supports that. The essential run itself did not log the spawn error.
- With PowerShell available, the same EXE continues and the BiDi session rejects `emulation.setTimezoneOverride` with HTTP 500 `LAUNCH_FAILED`. That is a product response from the retained build. Clearing it requires a production change and a new installer. Do not describe the current EXE as launching bundled Firefox.

Firefox image path and Firefox stop were not reached.

## Extension assignment blocker

Run 42397008724 continued after the Firefox failure, imported a cookie and an unpacked extension, then failed `The extension can be assigned` and stopped. The harness required HTTP 200 and did not record the response body.

Fact from installer source `server/app.js`: `POST /profiles/:id/extensions` responds `201` on success. Codex PR 14 changes the harness expectation to 201. That status was not captured on run 42397008724, so 201 is the source contract, not a logged response from that run.

Because this check throws, the run did not execute cookie persistence after reopen, extension persistence, Office generation, the separate standard account, expiry rejection, Office activation, Office Firefox, or uninstall/reinstall retention.

## Codex pull requests, reviewed and not merged

### PR 14

https://github.com/qadeer-cyber/profile-manager/pull/14

- Draft. Base `integration/azwah-ultimate-ui-release`. Head `d9fb969bc5a5e0580103b098deeaaa9e24383642` on `codex/azwah-pre-release-hardening`.
- Test-only files: `scripts/installed-acceptance-helpers.mjs`, `scripts/ultimate-essential-followup.mjs`, `scripts/ultimate-unified-acceptance.mjs`, `test/installed-acceptance-helpers.test.js`.
- GitHub reported it mergeable against `bd7714d1df625122f7bdec40a175a2e694b50e30`. `git merge-tree --write-tree` against that SHA exited 0. Not merged.
- The diff puts `WindowsPowerShell\v1.0` on `PATH`, expects extension assignment HTTP 201, and tightens Office token and trust checks. Those harness changes are not the qualified result of the retained EXE.

### PR 15

https://github.com/qadeer-cyber/profile-manager/pull/15

- Draft. Base `integration/azwah-ultimate-ui-release`. Head `af8631103e28be05840c323ef8a62b0d05d5a9eb` on `codex/azwah-migration-atomic`.
- Production files: `electron/ultimate-migrate.js`, `test/ultimate-migrate.test.js`.
- Commits: stage Owner data and refuse an incomplete retry; refuse migration while legacy SQLite journals exist.
- `git merge-tree --write-tree` against `bd7714d1df625122f7bdec40a175a2e694b50e30` exited 0. At the same review, the pull-request API still reported base SHA `bff93178dda3ee7711e2cf8f80582d35a069a6e4`. Use the merge-tree result, then recheck after this handoff commit. Not merged.
- Incorporating it changes application bytes. The retained EXE does not contain it. A new Windows build and installed migration qualification are required before any release that claims the fix. The PR text says local migration regressions passed and that live-process snapshots are unqualified. This handoff did not re-run those tests.

## Auto-publish risk

Do not cancel runs from this account. Cancellation of https://github.com/qadeer-cyber/profile-manager/actions/runs/42394760001 returned HTTP 403 `Resource not accessible by integration`. No second cancellation was attempted. Record: `docs/run-42394760001-cancel-rejected.md`.

`.github/workflows/azwah-ultimate-essential-followup.yml` runs on a push to this branch that touches `scripts/ultimate-essential-followup.mjs` or that workflow file. If the test step exits 0, the next step creates tag `azwah-multi-browser-ultimate-unified-8baf1ffe1338` and then clears the draft flag. Run 42397008724 failed its test step, and the publish step was skipped. A later green push of that script will publish.

The handoff commit avoids those paths and includes `[skip ci]`.

At the time this document was written, Codex already had https://github.com/qadeer-cyber/profile-manager/actions/runs/42397283885 in progress (`codex/azwah-pre-release-evidence`, "Independent Ultimate installed qualification"). Its workflow file on that branch downloads the retained artifact and has no `gh release` step. This handoff did not start it and did not cancel it.

## Next commands for Codex

Recheck the open pull requests. Do not merge them only to inspect:

```powershell
gh pr view 14 --repo qadeer-cyber/profile-manager
gh pr diff 14 --repo qadeer-cyber/profile-manager
gh pr view 15 --repo qadeer-cyber/profile-manager
gh pr diff 15 --repo qadeer-cyber/profile-manager
git merge-tree --write-tree origin/integration/azwah-ultimate-ui-release origin/codex/azwah-pre-release-hardening
git merge-tree --write-tree origin/integration/azwah-ultimate-ui-release origin/codex/azwah-migration-atomic
```

Before changing Firefox production code, reproduce both probe results on the retained EXE: `PATH` without PowerShell returns 409, and `PATH` with `WindowsPowerShell\v1.0` returns 500 `emulation.setTimezoneOverride`. A fix belongs in the timezone BiDi call, with system search still disabled. Then build one new installer. Do not call the current EXE fixed.

Before changing extension product code, record the assignment status. The installer source already returns 201.

Disable or gate the essential workflow's `gh release create` / `gh release edit --draft=false` before pushing another harness that can exit 0. Publish only after the essential checks pass, including bundled Firefox launch and image, standard-account activation, expiry, tamper, wrong device, persistence, and reinstall. Then download the release asset separately and match length `854726925` only if the bytes are still this EXE. A rebuilt installer needs its own length and SHA-256 in the notes. Never replace the experimental.1 releases, and do not merge to `main` from this handoff.

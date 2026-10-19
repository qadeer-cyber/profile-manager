# AI handoff

Read this file, [ARCHITECTURE.md](ARCHITECTURE.md), [DEVELOPMENT.md](DEVELOPMENT.md), and [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md) before changing the tree. The source of truth is the code and the GitHub Actions logs, not older notes in `docs/WINDOWS_BUILD.md` or `WINDOWS_NATIVE_VALIDATION.md`.

## Where the work is

- Repository: `qadeer-cyber/profile-manager`
- Validation branch: `windows-validation`
- Documented commit: `be575c770a8b76596e6bbcb9f8dda1b12cc79be0`
- This documentation branch: `docs/ai-handoff` (docs only; do not merge it on your own)
- v0.5.0 work: `development/v0.5.0`, branched from `21e67e1`. Do not push this work onto `windows-validation` or `docs/ai-handoff`.
- Do not use `main`. Do not edit pull request #1. Do not move or delete tag `v0.4.0`. Do not publish a release.

## v0.5.0 milestone 1

M1 is the browser lifecycle fix. Closing the last window used to call `onClosed` with `stopping` still false, so every such close was stored as `Browser exited unexpectedly` and the UI showed Error (`web/src/lib.js` treats any `last_error` as error).

`server/browsers.js` now reads the launched Chromium child's exit status. Exit code 0 is Stopped and clears `last_error`. A signal or a non-zero code is still Error, with that status in the message. App Stop still sets `stopping` first, so it stays Stopped. The profile row and `.pm-lock` are released before the SOCKS relay is closed. One page closing does not close the context.

Regression coverage is `test/lifecycle.e2e.js`, run from `npm run test:engine` on Linux and on the Windows workflow for this branch. Local result before the Windows run: lifecycle 21 passed, 0 failed; existing engine suite 42 passed, 0 failed. See [docs/v0.5.0/RESEARCH.md](docs/v0.5.0/RESEARCH.md) for the rest of the milestone plan.

## v0.4.0 build 30

Workflow run number 30, [39178407526](https://github.com/qadeer-cyber/profile-manager/actions/runs/39178407526), `workflow_dispatch` with `build_installers=true` on `be575c770a8b76596e6bbcb9f8dda1b12cc79be0`, conclusion **success**.

`Profile Manager-offline-Setup-0.4.0-x64.exe` is 354,396,221 bytes. SHA-256 `b102b46655525e82582f890f6e4a82894d91b892a65417963e5e3358d7332762`. Artifact id `12155741698`. The file is unsigned (see [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md)).

Suite results on that run:

| Suite | Result |
|---|---|
| Unit | 55 pass, 0 fail, 0 skipped |
| Desktop unit | 11 pass, 0 fail, 0 skipped |
| Desktop engine | 12 passed, 0 failed |
| API | 41 passed, 0 failed |
| Engine | 42 passed, 0 failed |
| Proxy library | 62 passed, 0 failed |
| Security | 37 passed, 0 failed |
| Security migration | 4 passed, 0 failed |
| UI smoke | 24 passed, 0 failed |
| Offline smoke | 24 passed, 0 failed |

The Electron desktop smoke step succeeded. Uninstall kept `%APPDATA%\profile-manager\data\profiles.db`.

## Completed features that tests cover

Only items with a test or with a passing assertion on run 30:

- Schema migrations 1–6, including legacy adoption and rollback (`test/unit.test.js`).
- Profile locks, stale and corrupt locks, and process-tree kill (`test/unit.test.js`, engine e2e).
- Secret prefixes, re-encryption, and no plaintext left in `profiles.db` (`test/unit.test.js`, `test/security.e2e.js`, `test/security-migration.e2e.js`).
- UI token only in `X-UI-Token`, not in the query string (`test/app-security.test.js`, security e2e).
- IPC shutdown: `{type:'shutdown-done'}` only after checkpoint and `db.close()` both succeed; a failed checkpoint or close exits 1 with no ack; a missing ack within 15 seconds fails the suite (`test/shutdown-ack.test.js`, `test/shutdown-durable.test.js`, `test/_ports.mjs`).
- Electron quit uses that same shutdown helper (`test/shutdown-durable.test.js` reads `electron/main.js`).
- Packaged apps ignore the three dev switches; the names stay inside `server/testflags.js` (`test/testflags.test.js`).
- CDP stays off unless automation is explicitly on; `/api/v1` may override one launch (`test/app-security.test.js`, engine and API e2e, offline smoke).
- Proxy library CRUD, import, classified errors, and no password in responses (`test/proxy-library.e2e.js`).
- Separate cookies and localStorage per profile, crash recovery, and failed launch releasing the lock (engine e2e, desktop engine e2e).
- In-app installer will not download into `resources/browsers` (`test/testflags.test.js`).
- Offline installed app: bundled Chromium 1248 and headless shell, no download, no Download Chromium banner, persistence of `pm_v` and `pm_c`, exactly one `--proxy-bypass-list=<-loopback>`, bad TLS rejected, explicit CDP on `127.0.0.1`, sqlite ABI 149 (`test/electron-smoke-offline.js` on run 30).
- Uninstall keeps `profiles.db` (run 30 uninstall step).

## Known limitations

These are limits, not defects that were fixed:

- **Unsigned EXE.** No Authenticode signature. The certificate table is empty.
- **CI-only Windows verification.** The green job is `windows-2022`. It is not a laptop or desktop test.
- **Manual Windows 10 and Windows 11 test still pending.** Do not call the candidate release-ready before that.
- No auto-update and no custom icon.
- A packaged app cannot honor the three dev switches. Setting them on an installed build does nothing.
- `safeStorage` secrets (`ss:v1:`) cannot be decrypted by `npm start`.
- `.gitignore` does not name `.env`, `*.pem`, `*.pfx`, or `screenshot.png`. Those files are not tracked. `data/` is ignored, which covers the default database directory.

## Decisions already made

- **IPC shutdown.** On Windows, SIGTERM does not run Node signal handlers. The test parent forks with an IPC channel and waits for `shutdown-done`.
- **Test-flag gating.** `applyPackagedFlag` runs before the server import. Packaged builds ignore `PM_AUTOMATION_DEFAULT`, `PM_PROXY_LOOPBACK`, and `PM_PROXY_TEST_INSECURE_TLS`.
- **No CDP by default.** The debugging port is added only for an explicit automation launch. Playwright's `--remote-debugging-pipe` is not that port.
- **`<-loopback>` through the proxy.** One `--proxy-bypass-list=<-loopback>` argument is expected on a proxied launch. It sends loopback to the proxy. The packaged app must not add a second copy.
- **userData path.** `%APPDATA%\profile-manager`, because `package.json` `"name"` is `profile-manager`. The installer directory still uses the product name `Profile Manager`.
- **Clean-room policy.** This tree is the source you edit. Do not copy in another product's source, do not replace tag `v0.4.0` or its published binaries, and do not commit profiles, databases, keys, certificates, or built executables.
- **No publish token.** Offline electron-builder always gets `--publish never`.

## Rules

- Do not merge to `main` without explicit approval from Mohammad.
- Do not open or merge a pull request unless asked.
- Do not put secrets, PEMs, profile databases, or real proxy passwords in git. Tests may use obvious local placeholders.
- Do not add `GH_TOKEN` to make electron-builder publish.
- Do not change `test/electron-smoke.js` to serve the offline installer. That file stays the standard smoke.
- `electron/offline-smoke.js` must not contain a PEM private key. `test/shutdown-durable.test.js` checks that.

## Next tasks

1. Install `Profile Manager-offline-Setup-0.4.0-x64.exe` from artifact `12155741698` on a real Windows 10 machine and a real Windows 11 machine. Confirm SmartScreen (expected, because the file is unsigned), first launch without a download, a profile launch, quit, and that uninstall leaves `%APPDATA%\profile-manager\data\profiles.db`.
2. If a signing certificate is provided later, sign that EXE and re-check the certificate table. Do not invent a certificate.
3. Leave `main`, pull request #1, and tag `v0.4.0` alone until Mohammad says otherwise.
4. Optional: extend `.gitignore` for `.env`, `*.pem`, `*.pfx`, and `screenshot.png`. That is not required for the current tree.

## Resume

```text
Branch windows-validation at be575c770a8b76596e6bbcb9f8dda1b12cc79be0 is the validated source.
Build 30 (run 39178407526) produced an unsigned offline NSIS EXE, SHA-256 b102b46655525e82582f890f6e4a82894d91b892a65417963e5e3358d7332762.
CI on windows-2022 is green, including offline smoke 24 passed, 0 failed. A manual Win10/11 test is still pending.
Do not merge to main, do not touch PR #1 or tag v0.4.0, and do not commit secrets or binaries.
Read AI_HANDOFF.md, ARCHITECTURE.md, DEVELOPMENT.md, and BUILD_AND_RELEASE.md before editing.
```

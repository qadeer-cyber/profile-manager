# Build and release

This file is the current Windows build procedure. `docs/WINDOWS_BUILD.md` is the older Linux cross-build note.

## What CI builds

Workflow: `.github/workflows/windows-native-validation.yml`  
Name: Windows native build and validation  
Runner: `windows-2022`  
Permissions: `contents: read`  
Timeout: 120 minutes

Triggers:

- `push` to `windows-validation` (tests only)
- `pull_request` to `main` (tests only)
- `workflow_dispatch` with boolean input `build_installers` (default `false`)

The offline installer steps run only when the event is `workflow_dispatch` and `build_installers` is true. A push does not build the EXE.

The deliverable is one NSIS setup:

`Profile Manager-offline-Setup-0.4.0-x64.exe`

`electron-builder.offline.cjs` keeps NSIS only (no portable target), `perMachine: false`, desktop shortcut, Start Menu shortcut, and `deleteAppDataOnUninstall: false`. Chromium is copied from `build/bundled-browsers` to `resources/browsers`.

## Dispatch

On `windows-validation`, at the commit you intend to ship:

1. Actions → Windows native build and validation → Run workflow.
2. Set **Build Windows installers** (`build_installers`) to true.
3. Do not set `GH_TOKEN`. The build command is:

```text
npx electron-builder --config electron-builder.offline.cjs --win nsis --x64 --publish never
```

`--publish never` is also on `npm run dist:win:offline`. electron-builder would otherwise try to publish on CI and stop with "GitHub Personal Access Token is not set".

The same job, before the installer, runs the test suites, confirms the Node prebuild, rebuilds `better-sqlite3` for Electron, and runs `npm run test:electron`.

## After the EXE exists

The next step hashes the single `*-offline*Setup*.exe` (extension `.exe` only, so `.blockmap` and `latest.yml` do not count) and writes:

```text
release/SHA256-offline-setup.txt
<64 hex chars>  Profile Manager-offline-Setup-0.4.0-x64.exe
```

Then the job:

1. Points `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, and `playwright.azureedge.net` at `127.0.0.1` in the hosts file.
2. Installs silently with `/S` into `%LOCALAPPDATA%\Programs\Profile Manager\`.
3. Checks the exe, the Desktop shortcut, and the Start Menu shortcut.
4. Runs `node test/electron-smoke-offline.js` with `PM_AUTOMATION_DEFAULT`, `PM_PROXY_LOOPBACK`, and `PM_PROXY_TEST_INSECURE_TLS` set to `1`, and `PLAYWRIGHT_DOWNLOAD_HOST=http://127.0.0.1:9`. Both browser-path variables are unset.
5. Uninstalls with `Uninstall Profile Manager.exe /S` and `_?=<install dir>` last and unquoted. It expects `%APPDATA%\profile-manager\data\profiles.db` to still exist.

The offline smoke covers the bundled `chromium-1248` path and `chromium_headless_shell-1248`, no download, no Download Chromium banner before or after Launch, cookie and localStorage across a graceful quit, no default CDP port, an explicit automation CDP address on `127.0.0.1`, rejection of a bad TLS certificate, exactly one `--proxy-bypass-list=<-loopback>` argument, and the Electron ABI 149 sqlite module.

Artifacts:

- `profile-manager-windows-native-artifacts`: the EXE and the SHA-256 file
- `windows-test-logs`

## The installer is unsigned

No certificate is configured. `osslsigncode verify` on the build 30 EXE reports `No signature found` and `Unable to extract existing signature`. The PE checksum field is `0x00000000` (calculated checksum differs). `IMAGE_DIRECTORY_ENTRY_SECURITY` is `VirtualAddress=0`, `Size=0`, so the certificate table is empty. SmartScreen will warn. Do not disable that warning as a workaround.

## Build 30

| Field | Value |
|---|---|
| Workflow run | [39178407526](https://github.com/qadeer-cyber/profile-manager/actions/runs/39178407526) (run number 30) |
| Event | `workflow_dispatch`, `build_installers=true` |
| Commit | `be575c770a8b76596e6bbcb9f8dda1b12cc79be0` |
| Conclusion | success |
| File | `Profile Manager-offline-Setup-0.4.0-x64.exe` |
| Size | 354,396,221 bytes |
| SHA-256 | `b102b46655525e82582f890f6e4a82894d91b892a65417963e5e3358d7332762` |
| Artifact | `12155741698` |

Offline smoke on that run: 24 passed, 0 failed. Uninstall removed the exe and kept `C:\Users\runneradmin\AppData\Roaming\profile-manager\data\profiles.db`.

## What this is not

Do not tag, draft a GitHub release, or merge to `main` from this workflow. Do not replace the existing v0.4.0 tag or the older cross-built EXEs. A green `windows-2022` job is not a Windows 10 or Windows 11 sign-off.

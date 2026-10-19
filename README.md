# Profile Manager

Local browser profile manager: Electron, React, Express, SQLite, and Playwright Chromium. Each profile is its own Chromium user-data directory, with an optional proxy and a local automation API.

Version in `package.json` is **0.4.0**. The branch `windows-validation` is a Windows-native validation candidate. It is not merged to `main`, and it does not replace the tagged v0.4.0 release. See [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md) and [AI_HANDOFF.md](AI_HANDOFF.md).

`docs/WINDOWS_BUILD.md` and `WINDOWS_NATIVE_VALIDATION.md` describe the earlier Linux cross-build. The current Windows procedure is [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md).

## Windows app

Two different packages exist:

- **Online** (`npm run dist:win`): NSIS setup plus a portable exe. Chromium is not inside the installer. The first launch shows **Download Chromium** and stores the browser under the app data `browsers` directory.
- **Offline** (`npm run dist:win:offline`, and the CI dispatch below): one per-user NSIS setup, `Profile Manager-offline-Setup-<version>-x64.exe`. Chromium revision 1248 is bundled under `resources\browsers`. This is the package CI builds.

The offline installer is **unsigned**. Windows SmartScreen will warn. There is no auto-update and no custom app icon.

Per-user install path:

`%LOCALAPPDATA%\Programs\Profile Manager\Profile Manager.exe`

Desktop and Start Menu shortcuts are created. Uninstall does not delete profile data (`deleteAppDataOnUninstall: false`).

Profile data follows the npm package name `profile-manager`, not the product name:

`%APPDATA%\profile-manager\data\profiles.db`

Profile directories are `%APPDATA%\profile-manager\data\profiles\<id>\`. The desktop log is `%APPDATA%\profile-manager\logs\main.log`.

## Developers

Node.js 22. A clean clone uses the lockfile:

```bash
npm ci
npx playwright install chromium
npm run app          # Electron
npm start            # web UI and API at http://127.0.0.1:3000
npm test
```

Native-module order, every suite, and operator environment variables are in [DEVELOPMENT.md](DEVELOPMENT.md). Layout is in [ARCHITECTURE.md](ARCHITECTURE.md). The proxy HTTP API is in [docs/proxy-api.md](docs/proxy-api.md).

## Tests on this commit

GitHub Actions run [39178407526](https://github.com/qadeer-cyber/profile-manager/actions/runs/39178407526) (workflow run number 30, `workflow_dispatch`, `build_installers=true`, commit `be575c770a8b76596e6bbcb9f8dda1b12cc79be0`) succeeded with:

| Suite | Result |
|---|---|
| Unit | 55 pass, 0 fail, 0 skipped |
| Desktop unit | 11 pass, 0 fail, 0 skipped |
| Desktop engine | 12 passed, 0 failed |
| API | 41 passed, 0 failed |
| Engine | 42 passed, 0 failed |
| Proxy library | 62 passed, 0 failed |
| Security | 37 passed, 0 failed, then migration 4 passed, 0 failed |
| UI smoke | 24 passed, 0 failed |
| Offline smoke of the installed app | 24 passed, 0 failed |

The Electron desktop smoke step on that run also succeeded. The unpackaged Windows smoke (`npm run test:electron`) prints 15 passed, 0 failed; two further assertions run only when `PM_APP_EXE` points at a packaged binary.

## Known limitations

- The offline EXE is unsigned.
- Windows checks so far are GitHub-hosted `windows-2022` only. A manual Windows 10 and Windows 11 test of this EXE is still pending.
- Packaged apps ignore `PM_AUTOMATION_DEFAULT`, `PM_PROXY_LOOPBACK`, and `PM_PROXY_TEST_INSECURE_TLS`.
- CDP is off unless the profile has `automationEnabled` or `/api/v1` passes `automation: true`.

# Windows-native validation candidate — NOT a verified release

This is a **separate copy** of the original v0.4.0 source. The unmodified original release remains unchanged.

## Why this copy exists
The original release was cross-built under Linux, with `build.npmRebuild=false`, despite using the compiled `better-sqlite3` Node addon. That combination creates a serious risk of shipping the Linux-native binary or an Electron ABI-incompatible module in a Windows artifact. A valid EXE SHA-256 does not verify that compiled native modules can load.

## Changes
- `package.json`: change `build.npmRebuild` from false to true.
- `.github/workflows/windows-native-validation.yml`: Windows Server 2022 GitHub Actions job. Installs Node 22 dependencies on Windows, rebuilds native addons for Electron, runs npm tests, runs Electron desktop smoke, builds standard Windows EXEs, tests a packaged app, builds offline EXEs, and produces SHA-256 manifests.

## To execute
1. Put this source in a **private GitHub repository** (do not publish secrets or real profile data).
2. Push a `windows-validation` branch or manually run `Windows native build and validation` under GitHub Actions.
3. Inspect failing tests and `Profile Manager.exe` startup diagnostics, if any.
4. Collect the Actions build artifacts if the job passes. They are **new** Windows-native builds and have different hashes from the existing Linux cross-built EXEs.
5. Independently test on Windows 10 and Windows 11. GitHub Server 2022 tests do not replace real client OS tests.

## Limitations
- This candidate has not been built or run on a Windows host in the present session.
- CI depends on a private GitHub repository and available Windows runners; it cannot run without those.
- The workflow tests with a real Chromium download and thus needs network access.
- Generated installers remain unsigned; evaluate SmartScreen warnings rather than disabling system defenses.
- On app startup, check `%APPDATA%\Profile Manager\logs\main.log` if the process fails.
- `npmRebuild=true` mitigates a packaging risk; it is not itself proof that `better-sqlite3` is Windows-compatible.

Do not replace the tagged v0.4.0 source or original EXEs with this candidate until a Windows build and test have passed.

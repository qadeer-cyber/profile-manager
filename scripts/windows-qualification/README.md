# Ultimate 2.0 — Unified Windows Offline Build

Target branch: integration/ultimate2-unified-pr (Codex-secure integration + Grok feasible/advanced privacy + M8 QA).

The Linux M8 acceptance was reported 2/2 PASS at QA 66bf4af, but this newly combined branch has NOT passed complete Windows tests. GitHub-hosted Windows jobs are billing/spending-limit blocked. The existing alpha.3 release is NOT the latest unified installer.

## Requirements

- Windows 10/11 x64; Node.js 22.x; Git; free disk space; npm and browser download access
- **Native compile:** `npm ci` runs `better-sqlite3` via node-gyp when no matching prebuild exists. `Ensure-WindowsNativeBuildPrereqs.ps1` installs **Python 3.8+**, **VS 2022 Build Tools (VCTools)**, and a **Windows 10/11 SDK** when missing (winget/Chocolatey). It sets **`PYTHON`**, **`npm_config_python`**, **`GYP_MSVS_VERSION`**, and **`npm_config_msvs_version`** (npm 10 rejects legacy `npm config set python`). It writes **`node-gyp.env.ps1`** under the evidence directory; **dot-source it in the same PowerShell process before `npm ci`** (`Import-WindowsNodeGypEnv` in `Run-M8-Qualification.ps1` / `Build-Ultimate2-Offline.ps1`). Child `powershell.exe` runs do not inherit these variables automatically.
- Stock Mozilla Firefox (installed or available via winget/Chocolatey)
- A clean Git working tree checked out on integration/ultimate2-unified-pr
- PowerShell 5.1+. The locally built installer may be unsigned.

## Build locally

    cd C:\path\to\profile-manager
    git fetch origin
    git checkout integration/ultimate2-unified-pr
    git pull --ff-only
    Set-ExecutionPolicy -Scope Process Bypass
    .\scripts\windows-qualification\Build-Ultimate2-Offline.ps1

The builder runs M8 REAL Chromium + Firefox acceptance, requiring TAP # pass 2, # fail 0, and # skipped 0. Then it runs unit, stabilization, recovery, browser-runtime, integration preflight and builds offline NSIS setup via npm run dist:win:offline.

Output: %TEMP%\pm-ultimate2-unified-build\Profile-Manager-Ultimate2-unified-<SHA8>-offline-Setup-x64.exe
Also writes BUILD-MANIFEST.txt (commit and SHA-256) plus the build transcript. Output is an unsigned LOCAL CANDIDATE, not a published/released installer; it never installs, tags, merges or uploads.

## Bootstrap node-gyp only (Python + MSVC)

    .\scripts\windows-qualification\Ensure-WindowsNativeBuildPrereqs.ps1

Use `-SkipBootstrap` to verify without installing. Evidence: `%TEMP%\pm-windows-native-prereqs\`.

## Run M8 only

    .\scripts\windows-qualification\Run-M8-Qualification.ps1

## Self-test the exit-code guard

    .\scripts\windows-qualification\Run-M8-Qualification.ps1 -SelfTestNativeFailure

The guard must create native-guard.result=SELF_TEST_PASS. A failed native command must never write a PASS M8 result.

## Known limitations

- The connected environment cannot execute Windows installer builds and did not run Windows acceptance.
- The combined source requires real full regression and a data-preserving upgrade smoke.
- Stock CfT/Firefox are not Mimic/Stealthfox; Canvas/WebGL page hooks remain opt-in experimental prototypes, not custom engines.
- Strict unified matrix is 18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 cloud-excluded until independent qualification.
- Do not merge to main or publish until Windows tests, security review, installer smoke, checksum and owner sign-off are completed.

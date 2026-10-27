# Windows build & test guide

> Superseded for the current candidate. Use [../BUILD_AND_RELEASE.md](../BUILD_AND_RELEASE.md). The sizes and `%APPDATA%\Profile Manager` paths below describe the older Linux cross-build, not build 30.

> Status: the Windows artifacts below were **cross-built on Linux (wine)** and have **never been run on Windows**.
> Everything in the "Windows 10/11 manual test checklist" is **NOT YET RUN**.

## Prerequisites (on a Windows 10/11 x64 build machine)
- Node.js **22.x** LTS x64 (same major as CI/dev: `node -v` → v22.*)
- Git, ~3 GB free disk
- Optional (only if `better-sqlite3` has no prebuild for your Electron ABI): Visual Studio 2022 Build Tools with "Desktop development with C++" and Python 3.

## Build
```powershell
git clone <repo> profile-manager; cd profile-manager
git checkout <release tag/branch>
npm ci
# better-sqlite3 ships prebuilt win32-x64 binaries; if Electron fails to load it ("was compiled against a different Node.js version"):
npx @electron/rebuild -f -w better-sqlite3
npm test                  # optional; e2e suites need Chromium: npx playwright install chromium
npm run dist:win          # online build (Chromium downloaded on first run)
npm run dist:win:offline  # offline build (pinned, SHA-256-verified Chromium bundled)
```

Outputs in `release/` (sizes from the Linux cross-build of 0.3.0 at commit on `desktop/engine-hardening`):

| Script | File | Size |
|---|---|---|
| dist:win | `Profile Manager-Setup-<ver>-x64.exe` (NSIS, per-user, choose dir) | ~116 MiB |
| dist:win | `Profile Manager-<ver>-x64-portable.exe` | ~116 MiB |
| dist:win:offline | `Profile Manager-Setup-<ver>-x64-offline.exe` | ~339 MiB |
| dist:win:offline | `Profile Manager-<ver>-x64-offline-portable.exe` | ~339 MiB |

`release/win-unpacked/` holds whichever variant was built last. Binaries are **unsigned** (no certificate configured): SmartScreen will warn.

## Chromium
- **Online build:** Diagnostics → Download Chromium installs into `%APPDATA%\Profile Manager\browsers`.
  `server/chromium.js` downloads only from `https://cdn.playwright.dev` over HTTPS, checks size + SHA-256 against
  `server/chromium-manifest.json` **before** extracting, and refuses on mismatch (`CHECKSUM_MISMATCH`).
  Launching without Chromium returns HTTP 503 `{code: "CHROMIUM_MISSING"}` for the UI to prompt.
- **Offline build:** `scripts/fetch-bundled-chromium.mjs win64` fetches+verifies the same pinned archives into
  `build/bundled-browsers`, packaged as `resources\browsers`. `electron/main.js` uses it as `PLAYWRIGHT_BROWSERS_PATH` when present.
- **Pinned checksums:** Playwright does not publish checksums. After upgrading `playwright`, run
  `npm run chromium:manifest`: it downloads each archive from cdn.playwright.dev **and** Google's Chrome for Testing
  bucket, fails if they differ, and rewrites the manifest. Commit the result. Until regenerated, installs fail with `MANIFEST_STALE`.

## Automation (CDP) port
Off by default. Enabled per profile (`automationEnabled`) or per `/api/v1` launch `{automation:true}`; then bound to 127.0.0.1 only.
Orphan recovery no longer needs CDP: it kills a recorded pid only if its command line contains that profile's
user-data-dir (Windows: `Get-CimInstance Win32_Process`, fallback `wmic`).

## Logs
`%APPDATA%\Profile Manager\logs\main.log` (uncaught exceptions, renderer/child process crashes, backend restarts).

## Windows 10/11 manual test checklist — NOT YET RUN
Run on both Windows 10 22H2 and Windows 11 23H2+, as a standard (non-admin) user. Record pass/fail + build hash.
1. [ ] Installer: SmartScreen prompt shown (unsigned); install to custom dir; Start-menu + desktop shortcuts; app launches.
2. [ ] Portable EXE runs from a USB/Downloads folder without install; data goes to `%APPDATA%\Profile Manager`.
3. [ ] Second launch focuses the existing window (single-instance lock); no second tray/process.
4. [ ] Fresh online install: launching a profile shows the "Chromium missing" prompt (CHROMIUM_MISSING), not a crash.
5. [ ] Diagnostics → Download Chromium completes; `.pm-verified.json` exists in `browsers\chromium-1248`; profile launches.
6. [ ] Tamper test: corrupt one byte of a pinned SHA in the manifest (dev build) → download refused, nothing installed.
7. [ ] Offline build: profile launches with network disabled; Diagnostics shows browsers path `...\resources\browsers`.
8. [ ] better-sqlite3 loads (app starts, profiles persist across restart).
9. [ ] Proxy credentials encrypted with DPAPI (Diagnostics shows electron-safeStorage, stored prefix `ss:v1:`).
10. [ ] Profile without automation: `netstat -ano | findstr LISTENING` shows no debugging port for chrome.exe; with automation: port on 127.0.0.1 only.
11. [ ] Stop profile: chrome.exe tree gone in Task Manager within 5 s.
12. [ ] Kill `Profile Manager.exe` via Task Manager while 2 profiles run; restart app → orphans killed, locks cleared, profiles show stopped.
13. [ ] PID-reuse: after step 12, an unrelated process is never killed (check main.log "killed N").
14. [ ] Kill a profile's chrome.exe externally → profile marked crashed within ~3 s.
15. [ ] Quit app with profiles running → all chrome.exe exit; cookies persist on next launch.
16. [ ] Paths with spaces/non-ASCII in user name (e.g. `C:\Users\José Ü`) work for data dir and Chromium.
17. [ ] Uninstall keeps `%APPDATA%\Profile Manager` (deleteAppDataOnUninstall=false).

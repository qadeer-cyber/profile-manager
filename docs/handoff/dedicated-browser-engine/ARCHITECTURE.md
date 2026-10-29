# Dedicated browser engine — Phase 1 architecture

**Branch:** `feature/dedicated-browser-engine` (from P1 @ `90f0d40`)  
**Owner:** Mohammad Abbas

## Layers

| Layer | Role |
|-------|------|
| **A. Desktop UI** | Electron + React (unchanged M1–M17 shell) |
| **B. Profile / storage** | SQLite + per-profile `userDataDir`, locks, backup |
| **C. Browser runtime** | **Manual:** `spawn(chrome.exe)` with profile args — no Playwright pipe. **Automation/headless:** Playwright `launchPersistentContext` |
| **D. Privacy config engine** | Validated settings → CLI args + `Default/Preferences` (`profile-config.js`, existing advanced/webrtc modules) |
| **E. Automation adapter** | Playwright only when `automation` or headless (see `automation-adapter.js`) |
| **F. Update manager** | Verified Playwright CDN install + manifest pin; rollback scaffold (`update-manager.js`) |

## Proof — independent manual launch

1. Start a profile from the UI (or `POST /api/profiles/:id/start`) with default options (not headless, automation off).
2. Server logs `NATIVE-LAUNCH` with `runtime: native` and argv without `--remote-debugging-pipe` / `--enable-automation`.
3. `GET /api/browser-engine/architecture` → `manualBrowsingRequiresPlaywright: false`.
4. Tests: `npm run test:browser-runtime` (plan + argv guards); Windows CI may run optional spawn smoke when Chromium is installed.

## Env overrides (tests only)

`PM_MANUAL_LAUNCH_RUNTIME=playwright` forces the legacy Playwright path for mocked launch-boundary tests.

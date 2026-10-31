# Custom browser engine blocker inventory (Phase C)

**Branch:** `feature/dedicated-browser-engine`  
**Purpose:** Honest record of what cannot be delivered with stock Chromium (CfT) and stock Firefox without owner-funded custom builds. No fake compile claims.

## BLOCKED — custom Chromium (Mimic-class)

| Capability | Why blocked | Evidence in repo |
|------------|-------------|------------------|
| Canvas/audio noise fingerprint | Requires patched Chromium | `server/fingerprint-settings.js` `FINGERPRINT_REJECTED`; matrix M24–M27 UNSUPPORTED/BLOCKED |
| WebGL vendor/renderer spoof | Invented GPU strings | `validateFingerprint` rejects masked/custom WebGL |
| Navigator hardwareConcurrency / deviceMemory spoof | No stock per-profile API | `hardware.js` `UNSUPPORTED_OVERRIDES` |
| Client hints / UA version mismatch vs installed CfT | Coherent UA derived from pinned CfT only | `advanced-launch.js` `buildUserAgent` |
| Custom Mimic compile / proprietary antidetect | Owner gate + licensing; clean-room policy | `MASTER_EXECUTION_ORDER` §2; no Mimic source |

**Owner action to unblock:** Separate approval for paid custom-Chromium infrastructure and legal review. Until then status stays **BLOCKED**, not PARTIAL-with-claims.

## BLOCKED — Stealthfox-class Firefox patches

| Capability | Why blocked | Evidence |
|------------|-------------|----------|
| Antidetect Gecko patches | Stock Firefox only | `firefox-launch.js`, matrix M3 PARTIAL (prefs/spawn) |
| Marionette CookieRobot warming | Not implemented | `cookie-robot-jobs.js` `FIREFOX_UNSUPPORTED` |

## UNSUPPORTED — observable without custom engine (diagnostics only)

| ID | Topic | Local behavior |
|----|-------|----------------|
| M33 | Keystroke / typing automation for unauthorized flows | Not in scope; authorized automation via CDP/WebDriver only |
| M42 | Undetectability guarantees | Diagnostics + honest labels only; no deceptive claims |
| WebGPU disable with verified effect | CfT did not remove `navigator.gpu` in tested build | `fingerprint-settings.js` WebGPU note |
| Port-scan result masking | No stock whitelist | `portScan` fixed to `real` |

## PARTIAL — stock-supported only (maxed in Phase B tests)

| ID | Stock lever | Test / API evidence |
|----|-------------|---------------------|
| M20–M23 | Locale, TZ, screen, UA | `fingerprint-observable-api.test.js`, `regional-locale-browser.test.js` |
| M28–M30 | local-fonts deny, media deny, WebGL off, no PNA weakening | `fingerprint-privacy-launch.test.js`, `privateNetworkWeakening()` |
| M2/M3 | CfT + Gecko spawn | `browser-runtime-native-launch.test.js`, `firefox-regional-observable.test.js` |

## CI / environment blockers (not product bugs)

| Item | Blocker | Notes |
|------|---------|-------|
| Installer-smoke on every SHA | Owner policy | Only final candidate SHA |
| Latitude physical IPv6 smoke | GHA windows-2022 | `capability-matrix.js` `latitude_ipv6` BLOCKED |
| Real GeckoDriver + Firefox navigation in CI | Optional Mozilla install on runner | Stub session tests in `geckodriver-bridge.test.js`; real FF in `firefox-spawn-smoke.test.js` when installed |

## No action taken in Phase C

- No download or compile of custom Chromium/Firefox forks.
- No CAPTCHA or account-security bypass implementations.
- No fabricated benchmark scores (`benchmark:latitude-scaffold` template only).

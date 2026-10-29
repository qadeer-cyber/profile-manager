# §23 Final engineering report (checkpoint — workspaces + CookieRobot + geckodriver)

**Model:** Composer 2.5 Fast  
**Branch:** `feature/dedicated-browser-engine`  
**Baseline:** Alpha.3 `2d65207` frozen · prior tip `ecbdb10` (rollback/WebDriver @ `dc60291`)

## 1. Branch + commit SHA
**Branch:** `feature/dedicated-browser-engine` · **Commit:** _(after push)_

## 2. Multilogin technology audit
M38 workspaces **PARTIAL→local IMPLEMENTED**; M32 CookieRobot **PARTIAL** (job runner); M37 WebDriver **PARTIAL** (+ geckodriver Firefox path); M3 Firefox automation **PARTIAL** (-marionette + geckodriver bridge).

## 3–8. Architecture / privacy / custom EXE
Unchanged honest status; no custom Chromium EXE.

## 9. Profile management
Workspaces assign profiles locally; vault lock when `electron-safeStorage` available.

## 10. CookieRobot-local
Queued jobs with task log, cancel/retry; blocks Google account/CAPTCHA URL patterns; Chromium automation only.

## 13. Automation
ChromeDriver + Geckodriver bridges (not bundled); Firefox `automation:true` uses native `-marionette`.

## 14. Workspaces
**Local-only** — no SaaS sync.

## 16. Performance / Latitude
Documented soft caps in `LATITUDE_RESOURCE_GUARDS.md`; no invented HD 620 metrics.

## 19. Windows testing
`npm run test:browser-runtime` — **60 pass / 0 fail** target on `dedicated-browser-engine-win.yml`.  
Migration test covers schema **v13–v16** (Alpha.3 upgrade path fields). Full Electron EXE upgrade smoke remains **BLOCKED** without release artifacts on CI.  
**Preview installer §19: NO-GO.**

## 20. Next milestone
Bundled drivers optional pack; Latitude physical smoke; custom Chromium **BLOCKED**.

**No Multilogin equivalence percentage claimed.**

# §23 Final engineering report (checkpoint — Phase A6 + Phase B increment)

**Branch:** `feature/dedicated-browser-engine`  
**Prior checkpoint:** `8935f6b` (Phase A code `278c5a3`)

## 1. Commits (this package)
- **Code:** backup manifest checksums, A6 E2E increments, M12 window args test, M17 proxy duplicate-as-template, pm-cli `proxies`, WebDriver stub session smoke.
- **Docs:** matrix rows M8/M12/M17/M35; this §23 checkpoint.

## 2. Phase A6 (progress)
- CookieRobot **full job lifecycle** over live CDP (`test/cookie-robot-lifecycle.test.js`).
- ChromeDriver bridge **/status + /session** against stub chromedriver (`webdriver-bridge.test.js`).
- Tab restore **real browser E2E** remains in `test/tab-restore-browser.test.js` (not in `test:browser-runtime`).
- Installer clean/upgrade/recovery: branch upgrade seed at A5; full installer matrix deferred to Phase F.

## 3. Phase B (increment)
- **M8:** `meta.fileChecksums` on backup create; restore verifies when present; inspect reports `fileChecksumCount`.
- **M12:** `1366x768` + window position launch args (`advanced-launch-window.test.js`).
- **M17:** `POST /api/v1/proxies/:id/duplicate` with `asTemplate: true` + tag filter.
- **M35:** `pm-cli proxies [tag]`.

## 4. Tests
`npm run test:browser-runtime` — **98 pass / 0 fail** (was 94).  
`node --test test/backup.test.js` — **2 pass / 0 fail**.

## 5. §19 / publish / CI
Still **NO-GO publish** without owner sign-off.  
**No** `[ci:installer-smoke]` on this SHA. Last green installer-smoke: Actions **40934718409** @ `98dbc0c`.

**No Multilogin equivalence percentage claimed.**
